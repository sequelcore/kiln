import type { PersistedTranscriptEvent } from "@kilnai/core";
import { buildPreamble } from "../wrapper/preamble-builder.js";
import type {
  ProviderId,
  SessionRequirements,
  PermissionEvaluator,
  ApprovalMatchQuery,
  ApprovalMemoryRecord,
} from "../wrapper/index.js";
import { createPermissionEvaluator } from "../wrapper/index.js";
import type {
  ProviderCreateConfig,
  SessionRegistry,
} from "../wrapper/session-registry.js";
import { isDirectApiProvider } from "../wrapper/session-registry.js";
import type { CleanupRegistry } from "../wrapper/cleanup-registry.js";
import type { SessionManager } from "../wrapper/session-manager.js";
import type { SessionContext } from "../wrapper/index.js";
import { normalizeMcpSelector } from "../wrapper/mcp-selector.js";
import { SessionHooks } from "./session-hooks.js";
import { governSessionContext } from "./context-governance.js";

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
}

export interface RunSessionRouteCandidate {
  readonly provider: ProviderId;
  readonly model?: string;
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
  readonly sessionSucceeded: boolean;
  readonly lastError: string | null;
  readonly accumulatedText: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCallCount: number;
  readonly turnDepth: number;
  readonly successfulProviderId?: ProviderId;
  readonly successfulModelId?: string;
  readonly attempts: readonly RunSessionAttemptResult[];
  readonly transcript: PersistedTranscriptEvent[];
  readonly exactArtifacts: readonly string[];
  readonly submittedPlan?: string;
}

export async function runSession(options: RunSessionOptions): Promise<RunSessionResult> {
  const governedContext = governSessionContext(options.context, options.permissionPolicy);
  const permissionEvaluator: PermissionEvaluator = createPermissionEvaluator(
    options.permissionPolicy,
    { agent: options.permissionAgent },
  );
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
  let sessionSucceeded = false;
  let lastError: string | null = null;
  let accumulatedText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;
  let turnDepth = 0;
  let successfulProviderId: ProviderId | undefined;
  let successfulModelId: string | undefined;
  const attempts: RunSessionAttemptResult[] = [];
  const transcript: PersistedTranscriptEvent[] = [];
  const exactArtifacts = new Set<string>();
  let submittedPlan: string | undefined;
  let transcriptSeq = 0;
  let isFirstDeltaOfTurn = false;
  let awaitingTurnStart = true;
  let lastToolName: string | undefined;

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex]!;
    const providerId = candidate.provider;
    const candidateSessionConfig = candidate.model
      ? { ...options.sessionConfig, model: candidate.model }
      : options.sessionConfig;
    let isPreflightCrash = false;
    let providerDeniedByPolicy = false;
    let attemptError: string | null = null;

    const session = options.registry.createSession(providerId, candidateSessionConfig);
    options.cleanupRegistry.register(async () => session.dispose());

    try {
      for await (const event of session.run({
        prompt: buildPreamble(governedContext, options.permissionPolicy, undefined),
        system: options.context.systemPrompt,
        cwd: process.cwd(),
        env: options.env,
        reasoningEffort: options.sessionConfig.reasoningEffort,
      })) {
        switch (event.type) {
          case "text_delta": {
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
            process.stdout.write(event.content);
            accumulatedText += event.content;
            break;
          }
          case "tool_use": {
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
                  event: { type: "tool_use", toolName: `${event.toolName} [DENIED]` },
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
                  event: { type: "tool_use", toolName: `${event.toolName} [DENIED]` },
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
            if (command !== undefined) {
              exactArtifacts.add(`Command executed: ${command}`);
            }
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
                    event: { type: "tool_use", toolName: `${event.toolName} [DENIED]` },
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
              exactArtifacts.add(`File path touched: ${filePath}`);
            }
            if (filePath !== undefined) {
              const fileDecision = permissionEvaluator.evaluateFile(filePath);
              if (fileDecision.action === "deny") {
                transcript.push({
                  seq: ++transcriptSeq,
                  ts: new Date().toISOString(),
                  event: { type: "tool_use", toolName: `${event.toolName} [DENIED]` },
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
                  event: { type: "tool_use", toolName: `${event.toolName} [DENIED]` },
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
                  event: { type: "tool_use", toolName: `${event.toolName} [DENIED]` },
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
              event: { type: "tool_use", toolName: event.toolName, input: event.input },
            });
            if (event.toolName === "submit_plan") {
              const submitted = extractPlanFromToolInput(event.input);
              if (submitted !== undefined) {
                submittedPlan = submitted;
              }
            }
            console.log(`[tool] ${event.toolName}`);
            toolCallCount++;
            lastToolName = event.toolName;
            options.sessionHooks.preToolUse(event.toolName);
            break;
          }
          case "tool_result": {
            transcript.push({
              seq: ++transcriptSeq,
              ts: new Date().toISOString(),
              event: { type: "tool_result" },
            });
            isFirstDeltaOfTurn = true;
            awaitingTurnStart = true;
            if (lastToolName) {
              options.sessionHooks.postToolUse(lastToolName);
            }
            break;
          }
          case "cost_update": {
            finalCostUsd = event.usd;
            inputTokens = event.inputTokens ?? inputTokens;
            outputTokens = event.outputTokens ?? outputTokens;
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
              attemptError = `Provider ${providerId} crashed before starting`;
              lastError = attemptError;
              exactArtifacts.add(lastError);
              options.registry.reportFailure(providerId, true);
              break;
            }
            if (event.isError) {
              lastError = attemptError ?? `Provider ${providerId} ended with error`;
              exactArtifacts.add(lastError);
              options.registry.reportFailure(providerId, false);
              break;
            }
            sessionSucceeded = true;
            successfulProviderId = providerId;
            successfulModelId = candidateSessionConfig.model;
            options.registry.reportSuccess(providerId);
            break;
          }
          case "error": {
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
      ...(candidateSessionConfig.model ? { model: candidateSessionConfig.model } : {}),
      succeeded: sessionSucceeded && successfulProviderId === providerId,
      error: attemptError,
    });

    if (sessionSucceeded) break;

    const hasMoreCandidates = candidateIndex < candidates.length - 1;
    if (!isPreflightCrash && !sessionSucceeded && hasMoreCandidates) {
      console.error(`[kiln] Provider ${providerId} failed, trying next...`);
    }
  }

  return {
    finalCostUsd,
    sessionSucceeded,
    lastError,
    accumulatedText,
    inputTokens,
    outputTokens,
    toolCallCount,
    turnDepth,
    successfulProviderId,
    successfulModelId,
    attempts,
    transcript,
    exactArtifacts: [...exactArtifacts],
    submittedPlan,
  };
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
