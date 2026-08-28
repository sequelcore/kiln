import { assessCompletionEligibility } from "@kilnai/core/agents";
import { isGentleReviewObservation } from "@kilnai/core/verification";
import {
  isFormalVerificationToolResultMetadata,
  isStaticAnalysisToolResultMetadata,
} from "@kilnai/core/tools";
import type {
  CompletionEligibility,
  CompletionObligation,
  RequiredProducerEvidence,
  RequiredProducerEvidenceStatus,
} from "@kilnai/core/agents";
import type { ToolExecutionSummary } from "./runtime-session-orchestrator.types.js";

/**
 * The small Runtime-owned projection needed to assess producer obligations.
 * Availability is supplied by the caller because Runtime owns the admitted
 * initial/materializable tool surface; this adapter does not discover tools or
 * infer availability from execution attempts.
 */
export interface RuntimeCompletionObligationAssessment {
  readonly obligations: readonly CompletionObligation[];
  readonly evidence: readonly RequiredProducerEvidence[];
  readonly eligibility: CompletionEligibility;
}

/**
 * Derive one evidence value per obligation from the admitted tool surface and
 * this turn's exact tool execution summaries.
 *
 * The producer identity comparison is deliberately exact. In particular, an
 * execution of `bash` (or an operator-facing alias such as `Dafny`) cannot
 * satisfy a canonical producer obligation. Explicit Core-listed equivalent
 * producer IDs remain supported, but arbitrary names never become equivalent.
 */
export function deriveRuntimeRequiredProducerEvidence(
  obligations: readonly CompletionObligation[],
  availableCanonicalToolIds: ReadonlySet<string>,
  toolExecutions: readonly ToolExecutionSummary[],
): readonly RequiredProducerEvidence[] {
  return obligations.map((obligation) => deriveEvidenceForObligation(
    obligation,
    availableCanonicalToolIds,
    toolExecutions,
  ));
}

/** Convenience result for Runtime call sites that need both planes together. */
export function assessRuntimeCompletionObligations(
  obligations: readonly CompletionObligation[],
  availableCanonicalToolIds: ReadonlySet<string>,
  toolExecutions: readonly ToolExecutionSummary[],
): RuntimeCompletionObligationAssessment {
  const evidence = deriveRuntimeRequiredProducerEvidence(
    obligations,
    availableCanonicalToolIds,
    toolExecutions,
  );
  return {
    obligations,
    evidence,
    eligibility: assessCompletionEligibility(obligations, evidence),
  };
}

/** Render only the canonical producer/status pairs for a blocked completion. */
export function formatRuntimeCompletionObligationFailure(
  eligibility: Extract<CompletionEligibility, { readonly status: "ineligible" }>,
): string {
  return eligibility.unmet
    .map(({ canonicalToolId, status }) => `${canonicalToolId}: ${status}`)
    .join("\n");
}

function deriveEvidenceForObligation(
  obligation: CompletionObligation,
  availableCanonicalToolIds: ReadonlySet<string>,
  toolExecutions: readonly ToolExecutionSummary[],
): RequiredProducerEvidence {
  const acceptedProducerIds = [obligation.canonicalToolId, ...obligation.acceptedEquivalentToolIds]
    .filter((producerId) => producerId.toLowerCase() !== "bash");
  const isAvailable = acceptedProducerIds.some((producerId) => availableCanonicalToolIds.has(producerId));
  if (!isAvailable) {
    return evidence(obligation.canonicalToolId, "unavailable");
  }

  const matchingExecutions = toolExecutions.filter((execution) =>
    execution.toolName.toLowerCase() !== "bash" && acceptedProducerIds.includes(execution.toolName),
  );
  if (matchingExecutions.length === 0) {
    return evidence(obligation.canonicalToolId, "not_run");
  }

  const acceptedExecutions = matchingExecutions.filter((execution): execution is ToolExecutionSummary & {
    readonly toolCallScopeId: string;
    readonly toolCallId: string;
  } =>
    execution.success
    && hasValidObservationMetadata(obligation.canonicalToolId, execution.metadata)
    && hasValidToolExecutionIdentity(execution),
  );
  if (acceptedExecutions.length > 0) {
    return {
      canonicalProducerId: acceptedExecutions.at(-1)?.toolName ?? obligation.canonicalToolId,
      status: "accepted",
      evidenceReferences: acceptedExecutions.map((execution) => ({
        toolCallScopeId: execution.toolCallScopeId,
        toolCallId: execution.toolCallId,
      })),
    };
  }

  // A later attempt is the current state when all matching attempts remain
  // non-accepted. This keeps the status deterministic for retries while a
  // valid earlier observation still wins through the accepted branch above.
  const latestExecution = matchingExecutions.at(-1);
  return evidence(
    latestExecution?.toolName ?? obligation.canonicalToolId,
    latestExecution?.success ? "invalid_evidence" : "execution_failed",
  );
}

function hasValidToolExecutionIdentity(
  execution: ToolExecutionSummary,
): execution is ToolExecutionSummary & {
  readonly toolCallScopeId: string;
  readonly toolCallId: string;
} {
  return typeof execution.toolCallScopeId === "string"
    && execution.toolCallScopeId.trim().length > 0
    && typeof execution.toolCallId === "string"
    && execution.toolCallId.trim().length > 0;
}

function hasValidObservationMetadata(
  toolName: string,
  metadata: Record<string, unknown> | undefined,
): boolean {
  if (metadata === undefined) {
    return false;
  }
  switch (toolName) {
    case "formal_verify":
      return isFormalVerificationToolResultMetadata(metadata);
    case "static_analyze":
      return isStaticAnalysisToolResultMetadata(metadata);
    case "gentle_review":
      return isGentleReviewObservation(metadata);
    default:
      // Core obligations currently resolve only to the three canonical
      // observation producers above. Unknown future producers fail closed
      // until their typed Core observation parser is wired here.
      return false;
  }
}

function evidence(
  canonicalProducerId: string,
  status: Exclude<RequiredProducerEvidenceStatus, "accepted">,
): RequiredProducerEvidence {
  return { canonicalProducerId, status };
}
