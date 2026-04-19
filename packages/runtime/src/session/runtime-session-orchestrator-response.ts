import type { ContentPart, ProviderAdapter } from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import type { OrchestratorDeps, OrchestrateResult, ToolExecutionSummary } from "./runtime-session-orchestrator.types.js";
import type { OrchestratorUsageSnapshot, OrchestratorResponseUsage } from "./runtime-session-orchestrator-telemetry.js";
import type { EscalationSignal } from "./support/escalation/escalation-detector.js";

export interface FinalizeRuntimeSessionResponseInput {
  readonly deps: OrchestratorDeps;
  readonly session: RuntimeSession;
  readonly parts: readonly ContentPart[];
  readonly usage: OrchestratorResponseUsage;
  readonly usageTotals: OrchestratorUsageSnapshot;
  readonly toolExecutions: readonly ToolExecutionSummary[];
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
    queued: false,
    escalation,
    contextSummary,
    toolExecutions: input.toolExecutions.length > 0 ? input.toolExecutions : undefined,
    routingDecision: input.routingDecision,
  };
}

export async function requestRuntimeSessionFallbackResponse(
  provider: ProviderAdapter,
  system: string,
  session: RuntimeSession,
  maxTokens: number | undefined,
): Promise<{
  readonly parts: readonly ContentPart[];
  readonly usage: OrchestratorResponseUsage;
}> {
  const response = await provider.createMessage({
    system,
    messages: [...session.conversationHistory],
    maxTokens,
  });

  return {
    parts: response.parts,
    usage: {
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      cacheReadTokens: response.cacheReadTokens,
      cacheWriteTokens: response.cacheWriteTokens,
    },
  };
}
