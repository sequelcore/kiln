import type { DeliberationResolution } from "@kilnai/core";
import { buildPreamble } from "../wrapper/preamble-builder.js";
import type {
  ProviderId,
  SessionRequirements,
  PermissionEvaluator,
  ApprovalMatchQuery,
  ApprovalMemoryRecord,
} from "../wrapper/index.js";
import {
  assertScopedExecutionSessionToolEvent,
  resolveExecutionCostEvidence,
  type ExecutionCostEvidence,
  type ExecutionSessionBindingEvidence,
  type ProviderRequestEvidence,
} from "@kilnai/core";
import { createPermissionEvaluator } from "../wrapper/index.js";
import type {
  ProviderCreateConfig,
  SessionRegistry,
} from "../wrapper/session-registry.js";
import type { DirectProviderAccountBinding } from "../wrapper/direct-provider-adapter-factory.js";
import type { SessionRunOptions } from "../wrapper/session.js";
import type { PersistedProviderTokenUsage } from "../wrapper/session-store.js";
import { isDirectApiProvider } from "../wrapper/session-registry.js";
import type { CleanupRegistry } from "../wrapper/cleanup-registry.js";
import type { SessionManager } from "../wrapper/session-manager.js";
import type { SessionContext } from "../wrapper/index.js";
import { normalizeMcpSelector } from "../wrapper/mcp-selector.js";
import { SessionHooks } from "./session-hooks.js";
import { governSessionContext } from "./context-governance.js";
import type { RunOutputSink } from "./run-output.js";
import type { OperatorTranscriptEntryEvent } from "./operator-transcript-projection.js";

export interface RunSessionTranscriptEvent {
  readonly seq: number;
  readonly ts: string;
  readonly event: OperatorTranscriptEntryEvent;
}

export interface RunSessionOptions {
  readonly registry: SessionRegistry;
  readonly cleanupRegistry: CleanupRegistry;
  readonly manager: SessionManager;
  readonly context: SessionContext;
  readonly requirements: SessionRequirements;
  readonly routeCandidates?: readonly RunSessionRouteCandidate[];
  readonly sessionConfig: ProviderCreateConfig;
  readonly permissionPolicy: ProviderCreateConfig["permissionPolicy"];
  readonly permissionAgent?: string;
  readonly sessionId?: string;
  readonly approvalMemoryStore?: ApprovalMemoryLookup;
  readonly env: Record<string, string>;
  readonly sessionHooks: SessionHooks;
  readonly abortSignal?: AbortSignal;
  readonly toolSandbox?: SessionRunOptions["toolSandbox"];
  readonly output?: RunOutputSink;
  readonly requestApproval?: SessionRunOptions["requestApproval"];
}

export interface RunSessionRouteCandidate {
  readonly provider: ProviderId;
  readonly model?: string;
  readonly accountBinding?: DirectProviderAccountBinding;
  readonly deliberationResolution?: DeliberationResolution;
}

export interface RunSessionAttemptResult {
  readonly providerId: ProviderId;
  readonly model?: string;
  readonly succeeded: boolean;
  readonly error: string | null;
}

export interface ApprovalMemoryLookup {
  consumeOnce(query: ApprovalMatchQuery): Promise<ApprovalMemoryRecord | null>;
  findMatch(query: ApprovalMatchQuery): Promise<ApprovalMemoryRecord | null>;
}

export interface RunSessionResult {
  readonly finalCostUsd: number;
  readonly finalCostEvidence: ExecutionCostEvidence;
  readonly sessionSucceeded: boolean;
  readonly lastError: string | null;
  readonly accumulatedText: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly providerRequests: readonly ProviderRequestEvidence[];
  readonly toolCallCount: number;
  readonly turnDepth: number;
  readonly successfulProviderId?: ProviderId;
  readonly successfulModelId?: string;
  readonly attempts: readonly RunSessionAttemptResult[];
  readonly transcript: RunSessionTranscriptEvent[];
  readonly providersUsed: readonly string[];
  readonly providerTokenUsage: readonly PersistedProviderTokenUsage[];
  readonly executionBindings: readonly ExecutionSessionBindingEvidence[];
  readonly exactArtifacts: readonly string[];
  readonly submittedPlan?: string;
  /** True when at least one managed_agent.invoke or managed_agent.start was dispatched
   *  during the session. Set from the session event loop. */
  readonly managedChildDispatched: boolean;
}

export async function runSession(options: RunSessionOptions): Promise<RunSessionResult> {
  const governedContext = governSessionContext(options.context, options.permissionPolicy);
  const permissionEvaluator: PermissionEvaluator = createPermissionEvaluator(
    options.permissionPolicy,
    { agent: options.permissionAgent },
  );
  const scopedMcpToolAllowlist = permissionEvaluator.scope.matchedScope && permissionEvaluator.scope.mcpTools
    ? new Set(permissionEvaluator.scope.mcpTools.map((selector) => normalizeMcpSelector(selector)))
    : undefined;
  const preferredProvider = options.requirements.preferredProvider;
  const candidates: readonly RunSessionRouteCandidate[] = options.routeCandidates && options.routeCandidates.length > 0
    ? options.routeCandidates
    : ((preferredProvider && isDirectApiProvider(preferredProvider))
    ? [preferredProvider]
    : (() => {
        const selection = options.registry.selectBest(options.requirements);
        return [selection.primary, ...selection.orderedFallbacks];
      })()).map((provider) => ({ provider }));

  let finalCostUsd = 0;
  let finalCostEvidence: ExecutionCostEvidence = {
    kind: "unknown",
    currency: "unknown",
    amountUsd: 0,
    comparable: false,
    reason: "metered pricing is missing for provider/model",
  };
  let sessionSucceeded = false;
  let lastError: string | null = null;
  let accumulatedText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let providerRequests: readonly ProviderRequestEvidence[] = [];
  let toolCallCount = 0;
  let turnDepth = 0;
  let successfulProviderId: ProviderId | undefined;
  let successfulModelId: string | undefined;
  const providerTokenUsage = new Map<string, PersistedProviderTokenUsage>();
  const executionBindings = new Map<string, ExecutionSessionBindingEvidence>();
  const providersUsed = new Set<string>();
  const attempts: RunSessionAttemptResult[] = [];
  const transcript: RunSessionTranscriptEvent[] = [];
  const exactArtifacts = new Set<string>();
  let submittedPlan: string | undefined;
  let managedChildDispatched = false;
  let transcriptSeq = 0;
  let isFirstDeltaOfTurn = false;
  let awaitingTurnStart = true;
  let lastToolName: string | undefined;
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex]!;
    const providerId = candidate.provider;
    providersUsed.add(providerId);
    const candidateDeliberation = candidate.deliberationResolution ?? options.sessionConfig.deliberationResolution;
    const effectiveSessionConfig = {
      ...options.sessionConfig,
      ...(candidate.model ? { model: candidate.model } : {}),
      ...(candidate.accountBinding ? { accountBinding: candidate.accountBinding } : {}),
      ...(candidateDeliberation ? { deliberationResolution: candidateDeliberation } : {}),
      ...(scopedMcpToolAllowlist ? { mcpToolAllowlist: scopedMcpToolAllowlist } : {}),
    };
    let isPreflightCrash = false;
    let providerDeniedByPolicy = false;
    let attemptError: string | null = null;
    const pendingToolEvidence: Array<{
      readonly toolCallId?: string;
      readonly toolName: string;
      readonly command?: string;
      readonly filePath?: string;
    }> = [];
    const accumulatedTextBeforeAttempt = accumulatedText.length;

    const session = options.registry.createSession(providerId, effectiveSessionConfig);
    options.cleanupRegistry.register(async () => session.dispose());

    try {
      for await (const event of session.run({
        kilnSessionId: options.sessionId ?? session.sessionId,
        turnId: `attempt:${candidateIndex + 1}`,
        prompt: buildPreamble(governedContext, options.permissionPolicy, undefined),
        promptKind: "kiln-preamble",
        cwd: options.context.workingDirectory,
        toolSandbox: options.toolSandbox,
        env: options.env,
        abortSignal: options.abortSignal,
        deliberationResolution: candidateDeliberation,
        requestedAuthority: options.sessionConfig.requestedAuthority,
        requestApproval: options.requestApproval,
      })) {
        switch (event.type) {
          case "text_delta": {
            if (event.isThinking) {
              break;
            }
            transcript.push({
              seq: ++transcriptSeq,
              ts: new Date().toISOString(),
              event: { type: "text_delta", content: event.content },
            });
            if (awaitingTurnStart) {
              turnDepth++;
              awaitingTurnStart = false;
            }
            if (isFirstDeltaOfTurn) {
              isFirstDeltaOfTurn = false;
              options.sessionHooks.userPromptSubmit();
            }
            if (options.output) {
              options.output.writeAssistantDelta(event.content);
            } else {
              process.stdout.write(event.content);
            }
            accumulatedText += event.content;
            break;
          }
          case "tool_use": {
            assertScopedExecutionSessionToolEvent(event);
            const decision = permissionEvaluator.evaluateTool(event.toolName);
            const stableSessionId = options.sessionId;
            let matchedToolApprovalMemory: ApprovalMemoryRecord | null = null;
            if (decision.action === "deny") {
              matchedToolApprovalMemory = await findToolApprovalMemory(
                options.approvalMemoryStore,
                event.toolName,
                stableSessionId,
              );
              if (!matchedToolApprovalMemory) {
                transcript.push({
                  seq: ++transcriptSeq,
                  ts: new Date().toISOString(),
                  event: {
                    type: "tool_use",
                    toolCallId: event.toolCallId,
                    toolCallScopeId: event.toolCallScopeId,
                    toolName: `${event.toolName} [DENIED]`,
                  },
                });
                attemptError = `Provider ${providerId} denied tool "${event.toolName}" by policy`;
                lastError = attemptError;
                options.registry.reportFailure(providerId, false);
                providerDeniedByPolicy = true;
                break;
              }
            }

            const scopedMcpTools = permissionEvaluator.scope.mcpTools;
            const hasScopedMcpRestriction =
              event.source === "mcp"
              && permissionEvaluator.scope.matchedScope
              && scopedMcpTools !== undefined;
            if (hasScopedMcpRestriction) {
              const normalizedScopedMcpTools = new Set(scopedMcpTools.map((selector) => normalizeMcpSelector(selector)));
              const eventSelector = normalizeMcpSelector(event.mcpSelector ?? event.toolName);
              if (!normalizedScopedMcpTools.has(eventSelector)) {
                transcript.push({
                  seq: ++transcriptSeq,
                  ts: new Date().toISOString(),
                  event: {
                    type: "tool_use",
                    toolCallId: event.toolCallId,
                    toolCallScopeId: event.toolCallScopeId,
                    toolName: `${event.toolName} [DENIED]`,
                  },
                });
                attemptError = `Provider ${providerId} denied MCP tool "${event.toolName}" by policy`;
                lastError = attemptError;
                options.registry.reportFailure(providerId, false);
                providerDeniedByPolicy = true;
                break;
              }
            }

            const isBashLikeTool = event.toolName === "Bash" || event.toolName === "bash";
            const command = extractCommandFromToolInput(event.input);
            let matchedCommandApprovalMemory: ApprovalMemoryRecord | null = null;
            if (isBashLikeTool && command !== undefined) {
              const commandDecision = permissionEvaluator.evaluateCommand(command, "bash");
              matchedCommandApprovalMemory = commandDecision.action === "deny"
                ? await findCommandApprovalMemory(
                  options.approvalMemoryStore,
                  command,
                  stableSessionId,
                )
                : null;
              if (commandDecision.action === "deny") {
                if (!matchedCommandApprovalMemory) {
                  transcript.push({
                    seq: ++transcriptSeq,
                    ts: new Date().toISOString(),
                    event: {
                      type: "tool_use",
                      toolCallId: event.toolCallId,
                      toolCallScopeId: event.toolCallScopeId,
                      toolName: `${event.toolName} [DENIED]`,
                    },
                  });
                  attemptError = `Provider ${providerId} denied command "${command}" by policy`;
                  lastError = attemptError;
                  options.registry.reportFailure(providerId, false);
                  providerDeniedByPolicy = true;
                  break;
                }
              }
            }

            const filePath = extractFilePathFromToolInput(event.input);
            if (filePath !== undefined) {
              const fileDecision = permissionEvaluator.evaluateFile(filePath);
              if (fileDecision.action === "deny") {
                transcript.push({
                  seq: ++transcriptSeq,
                  ts: new Date().toISOString(),
                  event: {
                    type: "tool_use",
                    toolCallId: event.toolCallId,
                    toolCallScopeId: event.toolCallScopeId,
                    toolName: `${event.toolName} [DENIED]`,
                  },
                });
                attemptError = `Provider ${providerId} denied file path "${filePath}" by policy`;
                lastError = attemptError;
                exactArtifacts.add(lastError);
                options.registry.reportFailure(providerId, false);
                providerDeniedByPolicy = true;
                break;
              }
            }

            if (matchedToolApprovalMemory?.scope === "once") {
              const consumed = await consumeToolApprovalOnce(
                options.approvalMemoryStore,
                event.toolName,
                stableSessionId,
              );
              if (!consumed) {
                transcript.push({
                  seq: ++transcriptSeq,
                  ts: new Date().toISOString(),
                  event: {
                    type: "tool_use",
                    toolCallId: event.toolCallId,
                    toolCallScopeId: event.toolCallScopeId,
                    toolName: `${event.toolName} [DENIED]`,
                  },
                });
                attemptError = `Provider ${providerId} denied tool "${event.toolName}" by policy`;
                lastError = attemptError;
                options.registry.reportFailure(providerId, false);
                providerDeniedByPolicy = true;
                break;
              }
            }

            if (matchedCommandApprovalMemory?.scope === "once" && command !== undefined) {
              const consumed = await consumeCommandApprovalOnce(
                options.approvalMemoryStore,
                command,
                stableSessionId,
              );
              if (!consumed) {
                transcript.push({
                  seq: ++transcriptSeq,
                  ts: new Date().toISOString(),
                  event: {
                    type: "tool_use",
                    toolCallId: event.toolCallId,
                    toolCallScopeId: event.toolCallScopeId,
                    toolName: `${event.toolName} [DENIED]`,
                  },
                });
                attemptError = `Provider ${providerId} denied command "${command}" by policy`;
                lastError = attemptError;
                options.registry.reportFailure(providerId, false);
                providerDeniedByPolicy = true;
                break;
              }
            }

            transcript.push({
              seq: ++transcriptSeq,
              ts: new Date().toISOString(),
              event: {
                type: "tool_use",
                toolCallId: event.toolCallId,
                toolCallScopeId: event.toolCallScopeId,
                toolName: event.toolName,
                input: event.input,
              },
            });
            if (event.toolName === "submit_plan") {
              const submitted = extractPlanFromToolInput(event.input);
              if (submitted !== undefined) {
                submittedPlan = submitted;
              }
            }
            const managedProvider = extractManagedProviderRouteIdFromToolUse(event.toolName, event.input);
            if (managedProvider !== undefined) {
              providersUsed.add(managedProvider);
            }
            if (
              event.toolName === "managed_agent.invoke" || event.toolName === "managed_agent.start"
            ) {
              managedChildDispatched = true;
            }
            if (options.output) {
              options.output.writeToolUse(event.toolName);
            } else {
              console.log(`[tool] ${event.toolName}`);
            }
            toolCallCount++;
            lastToolName = event.toolName;
            pendingToolEvidence.push({
              ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
              toolName: event.toolName,
              ...(command ? { command } : {}),
              ...(filePath ? { filePath } : {}),
            });
            options.sessionHooks.preToolUse(event.toolName);
            break;
          }
          case "tool_result": {
            assertScopedExecutionSessionToolEvent(event);
            const pendingEvidenceIndex = pendingToolEvidence.findIndex((candidate) =>
              event.toolCallId
                ? candidate.toolCallId === event.toolCallId
                : candidate.toolName.toLowerCase() === event.toolName.toLowerCase());
            const pendingEvidence = pendingEvidenceIndex >= 0
              ? pendingToolEvidence.splice(pendingEvidenceIndex, 1)[0]
              : undefined;
            if (!event.isError && pendingEvidence) {
              if (pendingEvidence.command) {
                exactArtifacts.add(`Command executed: ${pendingEvidence.command}`);
              }
              if (pendingEvidence.filePath) {
                const access = isFileMutationTool(pendingEvidence.toolName) ? "modified" : "inspected";
                exactArtifacts.add(`File ${access}: ${pendingEvidence.filePath}`);
              }
            }
            transcript.push({
              seq: ++transcriptSeq,
              ts: new Date().toISOString(),
              event: {
                type: "tool_result",
                toolCallId: event.toolCallId,
                toolCallScopeId: event.toolCallScopeId,
                toolName: event.toolName,
                output: event.output,
                ...(event.outputSummary !== undefined ? { outputSummary: event.outputSummary } : {}),
                ...(event.isError !== undefined ? { isError: event.isError } : {}),
              },
            });
            isFirstDeltaOfTurn = true;
            awaitingTurnStart = true;
            if (lastToolName) {
              options.sessionHooks.postToolUse(lastToolName);
            }
            break;
          }
          case "tool_output_delta": {
            if (options.output) {
              options.output.writeToolOutputDelta(event.delta);
            } else {
              process.stderr.write(event.delta);
            }
            break;
          }
          case "cost_update": {
            if (event.executionBinding) {
              recordExecutionBinding(executionBindings, event.executionBinding);
            }
            finalCostUsd = event.usd;
            inputTokens = event.inputTokens ?? inputTokens;
            outputTokens = event.outputTokens ?? outputTokens;
            providerRequests = event.providerRequests ?? providerRequests;
            finalCostEvidence = event.costEvidence ?? resolveExecutionCostEvidence({
              inputTokens: event.inputTokens ?? 0,
              outputTokens: event.outputTokens ?? 0,
              cacheReadTokens: event.cacheReadTokens ?? 0,
              cacheWriteTokens: event.cacheWriteTokens ?? 0,
            }, {
              provider: event.provider ?? providerId,
              model: event.model ?? effectiveSessionConfig.model,
              canonicalModel: event.canonicalModel,
              billingMode: event.billingMode,
            });
            recordProviderTokenUsage(providerTokenUsage, {
              provider: event.provider ?? providerId,
              ...(event.model ? { model: event.model } : {}),
              inputTokens: event.inputTokens ?? 0,
              outputTokens: event.outputTokens ?? 0,
              cacheReadTokens: event.cacheReadTokens ?? 0,
              cacheWriteTokens: event.cacheWriteTokens ?? 0,
            });
            options.manager.trackCostUpdate(
              event.inputTokens ?? 0,
              event.outputTokens ?? 0,
              event.cacheReadTokens ?? 0,
              event.usd,
            );
            break;
          }
          case "completed": {
            isPreflightCrash = event.isPreflightCrash;
            if (event.isPreflightCrash) {
              attemptError = attemptError
                ? `Provider ${providerId} crashed before starting: ${attemptError}`
                : `Provider ${providerId} crashed before starting`;
              lastError = attemptError;
              exactArtifacts.add(lastError);
              options.registry.reportFailure(providerId, true);
              break;
            }
            if (event.outcome !== "completed") {
              attemptError ??= `Provider ${providerId} ended with terminal outcome '${event.outcome}'`;
              lastError = attemptError;
              exactArtifacts.add(lastError);
              options.registry.reportFailure(providerId, false);
              break;
            }
            sessionSucceeded = true;
            lastError = null;
            successfulProviderId = providerId;
            successfulModelId = effectiveSessionConfig.model;
            options.registry.reportSuccess(providerId);
            break;
          }
          case "error": {
            if (event.executionBinding) {
              recordExecutionBinding(executionBindings, event.executionBinding);
            }
            attemptError = event.message;
            lastError = attemptError;
            if (event.message.trim() !== "") {
              exactArtifacts.add(`Provider error: ${event.message}`);
            }
            if (!event.isRetryable) {
              options.registry.reportFailure(providerId, false);
            }
            break;
          }
        }

        if (providerDeniedByPolicy) {
          break;
        }
      }
    } finally {
      await session.dispose();
    }

    attempts.push({
      providerId,
      ...(effectiveSessionConfig.model ? { model: effectiveSessionConfig.model } : {}),
      succeeded: sessionSucceeded && successfulProviderId === providerId,
      error: attemptError,
    });

    if (sessionSucceeded) break;

    const hasMoreCandidates = candidateIndex < candidates.length - 1;
    if (!isPreflightCrash && !sessionSucceeded && hasMoreCandidates) {
      accumulatedText = accumulatedText.slice(0, accumulatedTextBeforeAttempt);
      if (options.output?.mode !== "human") {
        options.output?.resetAssistantAnswer(accumulatedText);
      }
      if (options.output) {
        options.output.writeProviderFallback(providerId);
      } else {
        console.error(`[kiln] Provider ${providerId} failed, trying next...`);
      }
    }
  }

  return {
    finalCostUsd,
    finalCostEvidence,
    sessionSucceeded,
    lastError,
    accumulatedText,
    inputTokens,
    outputTokens,
    providerRequests,
    toolCallCount,
    turnDepth,
    successfulProviderId,
    successfulModelId,
    attempts,
    transcript,
    providersUsed: [...providersUsed],
    providerTokenUsage: [...providerTokenUsage.values()],
    executionBindings: [...executionBindings.values()],
    exactArtifacts: [...exactArtifacts],
    submittedPlan,
    managedChildDispatched,
  };
}

function recordExecutionBinding(
  bindings: Map<string, ExecutionSessionBindingEvidence>,
  binding: ExecutionSessionBindingEvidence,
): void {
  bindings.set(`${binding.virtualModelId}\0${binding.accountId}`, binding);
}

function recordProviderTokenUsage(
  usageByProvider: Map<string, PersistedProviderTokenUsage>,
  usage: PersistedProviderTokenUsage,
): void {
  const existing = usageByProvider.get(usage.provider);
  usageByProvider.set(usage.provider, {
    provider: usage.provider,
    ...(usage.model ?? existing?.model ? { model: usage.model ?? existing?.model } : {}),
    inputTokens: Math.max(usage.inputTokens ?? 0, existing?.inputTokens ?? 0),
    outputTokens: Math.max(usage.outputTokens ?? 0, existing?.outputTokens ?? 0),
    cacheReadTokens: Math.max(usage.cacheReadTokens ?? 0, existing?.cacheReadTokens ?? 0),
    cacheWriteTokens: Math.max(usage.cacheWriteTokens ?? 0, existing?.cacheWriteTokens ?? 0),
  });
}

function extractCommandFromToolInput(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const withCommand = input as { command?: unknown };
  return typeof withCommand.command === "string" ? withCommand.command : undefined;
}

function extractFilePathFromToolInput(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const withPath = input as { filePath?: unknown; path?: unknown };
  if (typeof withPath.filePath === "string") return withPath.filePath;
  if (typeof withPath.path === "string") return withPath.path;
  return undefined;
}

function isFileMutationTool(toolName: string): boolean {
  return /^(write|edit|apply_patch|delete|move|copy)$/i.test(toolName);
}

function extractPlanFromToolInput(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const withPlan = input as {
    plan?: unknown;
    objective?: unknown;
    nonGoals?: unknown;
    operatorDecisionsRequired?: unknown;
    expectedEvidence?: unknown;
    verificationGates?: unknown;
    approvalBoundaries?: unknown;
    residualRisks?: unknown;
    riskClassification?: unknown;
    workGovernanceRecommendation?: unknown;
    sourceSpecificationId?: unknown;
    clarificationRecordIds?: unknown;
    affectedSurfaces?: unknown;
    assumptions?: unknown;
    managedAgentDelegationCandidates?: unknown;
    rollbackNotes?: unknown;
    proposedWorkItems?: unknown;
  };
  if (typeof withPlan.plan === "string") {
    return withPlan.plan;
  }
  if (typeof withPlan.objective !== "string") {
    return undefined;
  }
  const objective = withPlan.objective.trim();
  const list = (value: unknown) => Array.isArray(value)
    ? value.flatMap((item) => typeof item === "string" ? [item.trim()] : []).filter((item) => item.length > 0)
    : [];
  const recommendation = withPlan.workGovernanceRecommendation
    && typeof withPlan.workGovernanceRecommendation === "object"
    && !Array.isArray(withPlan.workGovernanceRecommendation)
    ? withPlan.workGovernanceRecommendation as Record<string, unknown>
    : undefined;
  const proposedWorkItems = Array.isArray(withPlan.proposedWorkItems)
    ? withPlan.proposedWorkItems.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) as Record<string, unknown>[]
    : [];
  const lines = [
    objective,
    typeof withPlan.riskClassification === "string" ? `- risk: ${withPlan.riskClassification}` : undefined,
    typeof recommendation?.posture === "string" ? `- posture: ${recommendation.posture}` : undefined,
    typeof recommendation?.workflowProfile === "string" ? `- workflow: ${recommendation.workflowProfile}` : undefined,
    typeof recommendation?.rationale === "string" ? `- governance rationale: ${recommendation.rationale}` : undefined,
    typeof withPlan.sourceSpecificationId === "string" ? `- source specification: ${withPlan.sourceSpecificationId}` : undefined,
    ...list(withPlan.clarificationRecordIds).map((clarification) => `- clarification: ${clarification}`),
    ...list(withPlan.affectedSurfaces).map((surface) => `- affected surface: ${surface}`),
    ...list(withPlan.nonGoals).map((goal) => `- non-goal: ${goal}`),
    ...list(withPlan.assumptions).map((assumption) => `- assumption: ${assumption}`),
    ...list(withPlan.operatorDecisionsRequired).map((decision) => `- decision: ${decision}`),
    ...list(withPlan.expectedEvidence).map((evidence) => `- evidence: ${evidence}`),
    ...list(withPlan.verificationGates).map((gate) => `- gate: ${gate}`),
    ...list(withPlan.managedAgentDelegationCandidates).map((candidate) => `- delegation candidate: ${candidate}`),
    ...list(withPlan.approvalBoundaries).map((boundary) => `- approval boundary: ${boundary}`),
    typeof withPlan.rollbackNotes === "string" && withPlan.rollbackNotes.trim().length > 0
      ? `- rollback: ${withPlan.rollbackNotes.trim()}`
      : undefined,
    ...list(withPlan.residualRisks).map((risk) => `- residual risk: ${risk}`),
    ...proposedWorkItems.flatMap((item) => {
      const itemId = typeof item.id === "string" ? item.id.trim() : "";
      const itemSummary = typeof item.summary === "string" ? item.summary.trim() : "";
      const itemWorkflow = typeof item.workflowProfile === "string" ? item.workflowProfile.trim() : "";
      const itemRisk = typeof item.risk === "string" ? item.risk.trim() : "";
      const itemEvidence = list(item.expectedEvidence);
      const itemGates = list(item.verificationGates);
      const itemDeps = list(item.dependencies);
      return [
        itemSummary || itemId ? `- work item ${itemId || "item"}: ${itemSummary || "(no summary)"}` : undefined,
        itemWorkflow ? `  workflow: ${itemWorkflow}` : undefined,
        itemRisk ? `  risk: ${itemRisk}` : undefined,
        ...itemEvidence.map((evidence) => `  evidence: ${evidence}`),
        ...itemGates.map((gate) => `  gate: ${gate}`),
        ...itemDeps.map((dependency) => `  depends on: ${dependency}`),
      ];
    }),
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  return lines.join("\n");
}

function extractManagedProviderRouteIdFromToolUse(toolName: string, input: unknown): string | undefined {
  if (toolName !== "managed_agent.invoke" && toolName !== "managed_agent.start") {
    return undefined;
  }
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const providerRoute = (input as { providerRoute?: unknown }).providerRoute;
  if (typeof providerRoute !== "object" || providerRoute === null) {
    return undefined;
  }
  const providerId = (providerRoute as { providerId?: unknown }).providerId;
  return typeof providerId === "string" && providerId.trim().length > 0 ? providerId.trim() : undefined;
}

async function findToolApprovalMemory(
  approvalMemoryStore: ApprovalMemoryLookup | undefined,
  toolName: string,
  sessionId: string | undefined,
): Promise<ApprovalMemoryRecord | null> {
  if (!approvalMemoryStore || sessionId === undefined) return null;

  const query: ApprovalMatchQuery = {
    surface: "tool",
    selector: toolName,
    action: "allow",
    sessionId,
  };

  try {
    return await approvalMemoryStore.findMatch(query);
  } catch {
    return null;
  }
}

async function consumeToolApprovalOnce(
  approvalMemoryStore: ApprovalMemoryLookup | undefined,
  toolName: string,
  sessionId: string | undefined,
): Promise<boolean> {
  if (!approvalMemoryStore || sessionId === undefined) return false;

  const query: ApprovalMatchQuery = {
    surface: "tool",
    selector: toolName,
    action: "allow",
    sessionId,
  };

  try {
    return (await approvalMemoryStore.consumeOnce(query)) !== null;
  } catch {
    return false;
  }
}

async function findCommandApprovalMemory(
  approvalMemoryStore: ApprovalMemoryLookup | undefined,
  command: string,
  sessionId: string | undefined,
): Promise<ApprovalMemoryRecord | null> {
  if (!approvalMemoryStore || sessionId === undefined) return null;

  const query: ApprovalMatchQuery = {
    surface: "command",
    selector: command,
    action: "allow",
    sessionId,
  };

  try {
    return await approvalMemoryStore.findMatch(query);
  } catch {
    return null;
  }
}

async function consumeCommandApprovalOnce(
  approvalMemoryStore: ApprovalMemoryLookup | undefined,
  command: string,
  sessionId: string | undefined,
): Promise<boolean> {
  if (!approvalMemoryStore || sessionId === undefined) return false;

  const query: ApprovalMatchQuery = {
    surface: "command",
    selector: command,
    action: "allow",
    sessionId,
  };

  try {
    return (await approvalMemoryStore.consumeOnce(query)) !== null;
  } catch {
    return false;
  }
}
