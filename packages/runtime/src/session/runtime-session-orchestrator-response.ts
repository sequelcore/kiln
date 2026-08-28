import { textPart } from "@kilnai/core";
import type { ContentPart } from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import type { ProviderRequestEvidence } from "@kilnai/core";
import type {
  OrchestratorDeps,
  OrchestrateResult,
  ToolExecutionSummary,
} from "./runtime-session-orchestrator.types.js";
import type { RuntimeTurnTerminalDisposition } from "@kilnai/core/agents";
import { type OrchestratorUsageSnapshot, type OrchestratorResponseUsage } from "./runtime-session-orchestrator-telemetry.js";
import type { EscalationSignal } from "./support/escalation/escalation-detector.js";
import { DefaultContextSummarizer } from "./support/summarization/context-summarizer.js";
import { hasUnrecoverableManagedInvocationFailure } from "./governed-turn-outcome.js";
import type { SessionTurnOutcome } from "@kilnai/core";
import type { CommunicationResolution } from "@kilnai/core";

export interface FinalizeRuntimeSessionResponseInput {
  readonly deps: OrchestratorDeps;
  readonly session: RuntimeSession;
  readonly parts: readonly ContentPart[];
  readonly usage: OrchestratorResponseUsage;
  readonly usageTotals: OrchestratorUsageSnapshot;
  readonly providerRequests?: readonly ProviderRequestEvidence[];
  readonly toolExecutions: readonly ToolExecutionSummary[];
  readonly routingDecision?: {
    readonly provider: string;
    readonly model: string;
    readonly routingTier: string;
    readonly reasoning: string;
  };
  readonly preLlmEscalation?: EscalationSignal;
  readonly disposition: RuntimeTurnTerminalDisposition;
  readonly communicationResolution?: CommunicationResolution;
}
export async function finalizeRuntimeSessionResponse(
  input: FinalizeRuntimeSessionResponseInput,
): Promise<OrchestrateResult> {
  let escalation = input.preLlmEscalation;

  const disposition = input.disposition;
  // Reconcile before the transcript is written, not just the returned value -
  // conversation history, escalation detection, and every downstream surface
  // must see the same qualified parts the caller receives, not the raw claim.
  const parts = qualifyPartsForOutcome(input.parts, disposition.outcome, input.toolExecutions);

  input.session.addAssistantMessage(parts);

  if (!escalation && input.deps.escalationDetector) {
    const postSignal = input.deps.escalationDetector.checkPostLLM(input.session, parts);
    if (postSignal) escalation = postSignal;
  }

  let contextSummary: string | undefined;
  if (escalation) {
    try {
      contextSummary = await new DefaultContextSummarizer().summarize(input.session);
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
    ...disposition,
    escalation,
    contextSummary,
    toolExecutions: input.toolExecutions.length > 0 ? input.toolExecutions : undefined,
    routingDecision: input.routingDecision,
    ...(input.communicationResolution ? { communicationResolution: input.communicationResolution } : {}),
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
 * (an ordinary convergence continuation, not a prose/canonical
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
