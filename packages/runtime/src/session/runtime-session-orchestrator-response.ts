import type { ContentPart, ProviderAdapter, ToolCall } from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import type { ProviderRequestEvidence } from "@kilnai/core";
import type { OrchestratorDeps, OrchestrateResult, ToolExecutionSummary } from "./runtime-session-orchestrator.types.js";
import { measureProviderRequestRegions, type OrchestratorUsageSnapshot, type OrchestratorResponseUsage, type ProviderRequestCachePartitionInput, type ProviderRequestRegionEvidence } from "./runtime-session-orchestrator-telemetry.js";
import type { EscalationSignal } from "./support/escalation/escalation-detector.js";

export interface FinalizeRuntimeSessionResponseInput {
  readonly deps: OrchestratorDeps;
  readonly session: RuntimeSession;
  readonly parts: readonly ContentPart[];
  readonly usage: OrchestratorResponseUsage;
  readonly usageTotals: OrchestratorUsageSnapshot;
  readonly providerRequests?: readonly ProviderRequestEvidence[];
  readonly toolExecutions: readonly ToolExecutionSummary[];
  readonly stopReason?: string;
  readonly routingDecision?: {
    readonly provider: string;
    readonly model: string;
    readonly routingTier: string;
    readonly reasoning: string;
  };
  readonly preLlmEscalation?: EscalationSignal;
}

export async function finalizeRuntimeSessionResponse(
  input: FinalizeRuntimeSessionResponseInput,
): Promise<OrchestrateResult> {
  let escalation = input.preLlmEscalation;

  input.session.addAssistantMessage(input.parts);

  if (!escalation && input.deps.escalationDetector) {
    const postSignal = input.deps.escalationDetector.checkPostLLM(input.session, input.parts);
    if (postSignal) escalation = postSignal;
  }

  let contextSummary: string | undefined;
  if (escalation && input.deps.contextSummarizer) {
    try {
      contextSummary = await input.deps.contextSummarizer.summarize(input.session);
    } catch {
      // Non-critical: proceed without summary.
    }
  }

  return {
    parts: input.parts,
    inputTokens: input.usageTotals.inputTokens,
    outputTokens: input.usageTotals.outputTokens,
    cacheReadTokens: input.usageTotals.cacheReadTokens,
    cacheWriteTokens: input.usageTotals.cacheWriteTokens,
    ...(input.providerRequests && input.providerRequests.length > 0
      ? { providerRequests: input.providerRequests }
      : {}),
    queued: false,
    escalation,
    contextSummary,
    ...(input.stopReason !== undefined ? { stopReason: input.stopReason } : {}),
    toolExecutions: input.toolExecutions.length > 0 ? input.toolExecutions : undefined,
    routingDecision: input.routingDecision,
  };
}

export async function requestRuntimeSessionFallbackResponse(
  provider: ProviderAdapter,
  system: string,
  session: RuntimeSession,
  maxTokens: number | undefined,
  cachePartition?: ProviderRequestCachePartitionInput,
): Promise<{
  readonly parts: readonly ContentPart[];
  readonly toolCalls: readonly ToolCall[];
  readonly usage: OrchestratorResponseUsage;
  readonly request: ProviderRequestRegionEvidence;
  readonly stopReason?: string;
}> {
  const messages = [...session.conversationHistory];
  const response = await provider.createMessage({
    sessionId: session.id,
    system,
    messages,
    maxTokens,
  });

  return {
    parts: response.parts,
    toolCalls: response.toolCalls,
    ...(response.stopReason !== undefined ? { stopReason: response.stopReason } : {}),
    usage: {
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      cacheReadTokens: response.cacheReadTokens,
      cacheWriteTokens: response.cacheWriteTokens,
      contextUsage: response.contextUsage,
    },
    request: measureProviderRequestRegions({
      system,
      messages,
      toolCount: 0,
      cachePartition,
      ...(response.stopReason ? { stopReason: response.stopReason } : {}),
    }),
  };
}
