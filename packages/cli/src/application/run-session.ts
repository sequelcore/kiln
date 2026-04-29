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
  readonly sessionConfig: ProviderCreateConfig;
  readonly permissionPolicy: ProviderCreateConfig["permissionPolicy"];
  readonly permissionAgent?: string;
  readonly sessionId?: string;
  readonly approvalMemoryStore?: ApprovalMemoryLookup;
  readonly env: Record<string, string>;
  readonly sessionHooks: SessionHooks;
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
  readonly toolCallCount: number;
  readonly turnDepth: number;
  readonly successfulProviderId?: ProviderId;
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
  const candidates: ProviderId[] = (preferredProvider && isDirectApiProvider(preferredProvider))
    ? [preferredProvider]
    : (() => {
        const selection = options.registry.selectBest(options.requirements);
        return [selection.primary, ...selection.orderedFallbacks];
      })();

  let finalCostUsd = 0;
  let sessionSucceeded = false;
  let lastError: string | null = null;
  let accumulatedText = "";
  let toolCallCount = 0;
  let turnDepth = 0;
  let successfulProviderId: ProviderId | undefined;
  const transcript: PersistedTranscriptEvent[] = [];
  const exactArtifacts = new Set<string>();
  let submittedPlan: string | undefined;
  let transcriptSeq = 0;
  let isFirstDeltaOfTurn = false;
  let awaitingTurnStart = true;
  let lastToolName: string | undefined;

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const providerId = candidates[candidateIndex]!;
    let isPreflightCrash = false;
    let providerDeniedByPolicy = false;

    const session = options.registry.createSession(providerId, options.sessionConfig);
    options.cleanupRegistry.register(async () => session.dispose());

    try {
      for await (const event of session.run({
        prompt: buildPreamble(governedContext, options.permissionPolicy, undefined),
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
                lastError = `Provider ${providerId} denied tool "${event.toolName}" by policy`;
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
                lastError = `Provider ${providerId} denied MCP tool "${event.toolName}" by policy`;
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
                  lastError = `Provider ${providerId} denied command "${command}" by policy`;
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
                lastError = `Provider ${providerId} denied file path "${filePath}" by policy`;
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
                lastError = `Provider ${providerId} denied tool "${event.toolName}" by policy`;
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
                lastError = `Provider ${providerId} denied command "${command}" by policy`;
                options.registry.reportFailure(providerId, false);
                providerDeniedByPolicy = true;
                break;
              }
            }

            transcript.push({
              seq: ++transcriptSeq,
              ts: new Date().toISOString(),
              event: { type: "tool_use", toolName: event.toolName },
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
              lastError = `Provider ${providerId} crashed before starting`;
              exactArtifacts.add(lastError);
              options.registry.reportFailure(providerId, true);
              break;
            }
            if (event.isError) {
              lastError = `Provider ${providerId} ended with error`;
              exactArtifacts.add(lastError);
              options.registry.reportFailure(providerId, false);
              break;
            }
            sessionSucceeded = true;
            successfulProviderId = providerId;
            options.registry.reportSuccess(providerId);
            break;
          }
          case "error": {
            lastError = event.message;
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
    toolCallCount,
    turnDepth,
    successfulProviderId,
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
  const withPlan = input as { plan?: unknown };
  return typeof withPlan.plan === "string" ? withPlan.plan : undefined;
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
