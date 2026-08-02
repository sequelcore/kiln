import { projectConversationForModel, sha256ContentIdentity, textPart } from "@kilnai/core";
import type { ContentPart, ConversationToolResultProjectionPolicy, EffectivePromptManifest, ProviderAdapter, ToolCall } from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import type { ProviderRequestEvidence } from "@kilnai/core";
import type { OrchestratorDeps, OrchestrateResult, ToolExecutionSummary } from "./runtime-session-orchestrator.types.js";
import { measureProviderRequestRegions, type OrchestratorUsageSnapshot, type OrchestratorResponseUsage, type ProviderRequestCachePartitionInput, type ProviderRequestRegionEvidence } from "./runtime-session-orchestrator-telemetry.js";
import type { EscalationSignal } from "./support/escalation/escalation-detector.js";
import { deriveRuntimeTurnOutcome, hasUnrecoverableManagedInvocationFailure } from "./governed-turn-outcome.js";
import type { SessionTurnOutcome } from "@kilnai/core";

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
  readonly outcome?: SessionTurnOutcome;
}

export async function finalizeRuntimeSessionResponse(
  input: FinalizeRuntimeSessionResponseInput,
): Promise<OrchestrateResult> {
  let escalation = input.preLlmEscalation;

  const outcome = input.outcome ?? deriveRuntimeTurnOutcome({
    toolExecutions: input.toolExecutions,
    stopReason: input.stopReason,
  });
  // Reconcile before the transcript is written, not just the returned value -
  // conversation history, escalation detection, and every downstream surface
  // must see the same qualified parts the caller receives, not the raw claim.
  const parts = qualifyPartsForOutcome(input.parts, outcome, input.toolExecutions);

  input.session.addAssistantMessage(parts);

  if (!escalation && input.deps.escalationDetector) {
    const postSignal = input.deps.escalationDetector.checkPostLLM(input.session, parts);
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
    parts,
    inputTokens: input.usageTotals.inputTokens,
    outputTokens: input.usageTotals.outputTokens,
    cacheReadTokens: input.usageTotals.cacheReadTokens,
    cacheWriteTokens: input.usageTotals.cacheWriteTokens,
    ...(input.providerRequests && input.providerRequests.length > 0
      ? { providerRequests: input.providerRequests }
      : {}),
    queued: false,
    outcome,
    escalation,
    contextSummary,
    ...(input.stopReason !== undefined ? { stopReason: input.stopReason } : {}),
    toolExecutions: input.toolExecutions.length > 0 ? input.toolExecutions : undefined,
    routingDecision: input.routingDecision,
  };
}

/**
 * Roadmap 01 (External Runtime Governance): canonical outcome must not disagree
 * with an unqualified final answer. Scoped specifically to outcome === "failed"
 * with an unrecoverable managed-invocation blocking failure (see
 * hasUnrecoverableManagedInvocationFailure) - a failure with no recovery
 * metadata at all, offering the parent no supervised path forward, so any
 * free-text final answer produced afterward was written with no awareness of
 * it and cannot be trusted to agree with it. Deliberately excludes "paused"
 * (an ordinary tool-round-budget continuation, not a prose/canonical
 * disagreement) and "cancelled". Every other "failed" outcome in this codebase
 * (unresolved governed-work materialization, a managed-invocation recovery
 * still in progress, retry exhaustion, ...) is already reported through text
 * that was written with knowledge of that specific failure, by construction of
 * the call site that produces it - qualifying those would be redundant noise,
 * not a correction. Prepend a canonical-state qualifier rather than discarding
 * the original parts, so operators retain the model's prose for diagnosis
 * while it can no longer be mistaken for a confirmed-successful final answer.
 */
function qualifyPartsForOutcome(
  parts: readonly ContentPart[],
  outcome: SessionTurnOutcome,
  toolExecutions: readonly ToolExecutionSummary[],
): readonly ContentPart[] {
  if (outcome !== "failed" || !hasUnrecoverableManagedInvocationFailure(toolExecutions)) {
    return parts;
  }
  return [
    textPart(
      `Canonical state: ${outcome}. The response below has not been verified as complete `
      + "and must not be treated as confirmation of success.",
    ),
    ...parts,
  ];
}

export async function requestRuntimeSessionFallbackResponse(
  provider: ProviderAdapter,
  effectivePrompt: EffectivePromptManifest,
  session: RuntimeSession,
  maxTokens: number | undefined,
  cachePartition?: ProviderRequestCachePartitionInput,
  conversationPolicy?: ConversationToolResultProjectionPolicy,
): Promise<{
  readonly parts: readonly ContentPart[];
  readonly toolCalls: readonly ToolCall[];
  readonly usage: OrchestratorResponseUsage;
  readonly request: ProviderRequestRegionEvidence;
  readonly stopReason?: string;
}> {
  if (
    typeof effectivePrompt !== "object"
    || effectivePrompt === null
    || effectivePrompt.version !== "v1"
    || typeof effectivePrompt.finalPrompt !== "string"
    || effectivePrompt.finalPromptHash !== sha256ContentIdentity(effectivePrompt.finalPrompt)
    || !Array.isArray(effectivePrompt.components)
  ) {
    throw new Error("A valid effective prompt manifest is required before provider invocation");
  }
  const conversationProjection = projectConversationForModel(session.conversationHistory, conversationPolicy);
  const messages = conversationProjection.messages;
  const response = await provider.createMessage({
    sessionId: session.id,
    system: effectivePrompt.finalPrompt,
    messages,
    maxTokens,
    toolChoice: { type: "none" },
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
      system: effectivePrompt.finalPrompt,
      effectivePrompt,
      messages,
      toolCount: 0,
      cachePartition,
      conversationProjection: conversationProjection.evidence,
      ...(response.stopReason ? { stopReason: response.stopReason } : {}),
    }),
  };
}
