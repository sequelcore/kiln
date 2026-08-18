import {
  assessBoundedWorkScope,
  type AssessBoundedWorkScopeInput,
  type BoundedWorkContractRevision,
  type BoundedWorkHarnessCapability,
} from "./bounded-work-contract.js";
import type {
  BoundedWorkScopeViolation,
  BoundedWorkTripwireDiagnostic,
} from "./bounded-work-scope-policy.js";
import { requireBoundedWorkDigest } from "./bounded-work-content.js";
import type { BoundedWorkCandidateEvidence } from "./bounded-work-candidate.js";

export type BoundedWorkMeasuredValue =
  | { readonly kind: "observed"; readonly value: number }
  | { readonly kind: "estimated"; readonly value: number }
  | { readonly kind: "unknown" }
  | { readonly kind: "unavailable" };

export interface BoundedWorkAccountingSnapshot {
  readonly schema: "kiln.bounded-work-accounting/v1";
  readonly accountingLineageId: string;
  readonly contractRevisionDigest: string;
  readonly revision: number;
  readonly executionAttempts: number;
  readonly managedInvocations: number;
  readonly activeManagedInvocations: number;
  readonly reviewRounds: number;
  readonly remediationRounds: number;
  readonly toolCalls: BoundedWorkMeasuredValue;
  readonly activeDurationMs: BoundedWorkMeasuredValue;
}

export type BoundedWorkReservation =
  | { readonly kind: "execution_attempt"; readonly amount: number }
  | { readonly kind: "managed_invocation"; readonly amount: number; readonly childDepth: number }
  | { readonly kind: "review_round"; readonly amount: number; readonly candidateDigest: string }
  | {
      readonly kind: "remediation_round";
      readonly amount: number;
      readonly candidateDigest: string;
      readonly previousCandidateDigest: string;
    }
  | { readonly kind: "tool_call"; readonly amount: number }
  | { readonly kind: "active_duration"; readonly amount: number };

export type BoundedWorkLimitName =
  | "execution_attempts"
  | "managed_invocations"
  | "concurrent_managed_invocations"
  | "child_depth"
  | "review_rounds"
  | "remediation_rounds"
  | "tool_calls"
  | "active_duration_ms";

export interface BoundedWorkContinuation {
  readonly action:
    | "request_budget_revision"
    | "request_scope_revision"
    | "select_capable_harness"
    | "provide_acceptance_evidence";
  readonly contractRevisionDigest: string;
  readonly accountingLineageId: string;
  readonly accountingRevision: number;
  readonly candidateDigest?: string;
}

export type BoundedWorkAdmissionDecision =
  | {
      readonly kind: "admitted";
      readonly contractRevisionDigest: string;
      readonly accountingRevision: number;
      readonly reserved: Partial<Record<
        "executionAttempts" | "managedInvocations" | "activeManagedInvocations" | "reviewRounds" | "remediationRounds" | "toolCalls" | "activeDurationMs",
        number
      >>;
      readonly diagnostics: readonly BoundedWorkTripwireDiagnostic[];
    }
  | {
      readonly kind: "pause_budget_exhausted";
      readonly exhaustedLimits: readonly BoundedWorkLimitName[];
      readonly snapshot: BoundedWorkAccountingSnapshot;
      readonly continuation: BoundedWorkContinuation;
    }
  | {
      readonly kind: "stop_budget_exhausted";
      readonly exhaustedLimits: readonly BoundedWorkLimitName[];
      readonly snapshot: BoundedWorkAccountingSnapshot;
    }
  | {
      readonly kind: "pause_capability_unavailable";
      readonly unavailableMetrics: readonly (
        | Extract<BoundedWorkLimitName, "tool_calls" | "active_duration_ms">
        | "harness_authority"
      )[];
      readonly snapshot: BoundedWorkAccountingSnapshot;
      readonly continuation: BoundedWorkContinuation;
    }
  | {
      readonly kind: "pause_scope_revision_required";
      readonly violations: readonly BoundedWorkScopeViolation[];
      readonly diagnostics: readonly BoundedWorkTripwireDiagnostic[];
      readonly snapshot: BoundedWorkAccountingSnapshot;
      readonly continuation: BoundedWorkContinuation;
    };

export interface BoundedWorkSatisfiedCriterion {
  readonly criterion: string;
  readonly candidateDigest: string;
  readonly evidenceDigest: string;
}

export type BoundedWorkCloseoutDecision =
  | {
      readonly kind: "stop_acceptance_complete";
      readonly candidateDigest: string;
      readonly contractRevisionDigest: string;
      readonly accounting: BoundedWorkAccountingSnapshot;
    }
  | {
      readonly kind: "pause_acceptance_incomplete";
      readonly candidateDigest: string;
      readonly missingCriteria: readonly string[];
      readonly accounting: BoundedWorkAccountingSnapshot;
      readonly continuation: BoundedWorkContinuation;
    };

export function decideBoundedWorkAdmission(input: {
  readonly revision: BoundedWorkContractRevision;
  readonly snapshot: BoundedWorkAccountingSnapshot;
  readonly harnessCapability: BoundedWorkHarnessCapability;
  /** Present only when the reservation itself performs a governed effect. */
  readonly scope?: Omit<AssessBoundedWorkScopeInput, "revision">;
  readonly reservation: BoundedWorkReservation;
}): BoundedWorkAdmissionDecision {
  assertAccountingBinding(input.revision, input.snapshot);
  const scope = input.scope
    ? assessBoundedWorkScope({ revision: input.revision, ...input.scope })
    : undefined;
  if (scope?.status === "scope_revision_required") {
    return {
      kind: "pause_scope_revision_required",
      violations: scope.violations,
      diagnostics: scope.diagnostics,
      snapshot: input.snapshot,
      continuation: continuation("request_scope_revision", input.snapshot),
    };
  }
  if (!capabilitySatisfies(input.harnessCapability, input.revision.contract.policy.minimumHarnessCapability)) {
    return {
      kind: "pause_capability_unavailable",
      unavailableMetrics: ["harness_authority"],
      snapshot: input.snapshot,
      continuation: continuation("select_capable_harness", input.snapshot),
    };
  }
  const amount = positiveInteger(input.reservation.amount, "reservation.amount");
  const limits = input.revision.contract.limits;
  const exhausted: BoundedWorkLimitName[] = [];
  const unavailable: Extract<BoundedWorkLimitName, "tool_calls" | "active_duration_ms">[] = [];
  const reserved: Extract<BoundedWorkAdmissionDecision, { kind: "admitted" }>["reserved"] = {};
  if (limits.maxToolCalls !== undefined && authoritativeValue(input.snapshot.toolCalls) === undefined) {
    unavailable.push("tool_calls");
  }
  if (limits.maxActiveDurationMs !== undefined && authoritativeValue(input.snapshot.activeDurationMs) === undefined) {
    unavailable.push("active_duration_ms");
  }

  switch (input.reservation.kind) {
    case "execution_attempt":
      if (input.snapshot.executionAttempts + amount > limits.maxExecutionAttempts) exhausted.push("execution_attempts");
      reserved.executionAttempts = amount;
      break;
    case "managed_invocation":
      if (input.snapshot.managedInvocations + amount > limits.maxManagedInvocations) exhausted.push("managed_invocations");
      if (input.snapshot.activeManagedInvocations + amount > limits.maxConcurrentManagedInvocations) exhausted.push("concurrent_managed_invocations");
      if (nonNegativeInteger(input.reservation.childDepth, "reservation.childDepth") > limits.maxChildDepth) exhausted.push("child_depth");
      reserved.managedInvocations = amount;
      reserved.activeManagedInvocations = amount;
      break;
    case "review_round":
      requireBoundedWorkDigest(input.reservation.candidateDigest, "reservation.candidateDigest");
      if (input.snapshot.reviewRounds + amount > limits.maxReviewRounds) exhausted.push("review_rounds");
      reserved.reviewRounds = amount;
      break;
    case "remediation_round":
      requireBoundedWorkDigest(input.reservation.candidateDigest, "reservation.candidateDigest");
      requireBoundedWorkDigest(input.reservation.previousCandidateDigest, "reservation.previousCandidateDigest");
      if (input.reservation.candidateDigest === input.reservation.previousCandidateDigest) {
        throw new Error("remediation must create a successor candidate");
      }
      if (input.snapshot.remediationRounds + amount > limits.maxRemediationRounds) exhausted.push("remediation_rounds");
      reserved.remediationRounds = amount;
      break;
    case "tool_call": {
      if (limits.maxToolCalls === undefined) {
        reserved.toolCalls = amount;
        break;
      }
      const current = authoritativeValue(input.snapshot.toolCalls);
      if (current !== undefined && current + amount > limits.maxToolCalls) exhausted.push("tool_calls");
      reserved.toolCalls = amount;
      break;
    }
    case "active_duration": {
      if (limits.maxActiveDurationMs === undefined) {
        reserved.activeDurationMs = amount;
        break;
      }
      const current = authoritativeValue(input.snapshot.activeDurationMs);
      if (current !== undefined && current + amount > limits.maxActiveDurationMs) exhausted.push("active_duration_ms");
      reserved.activeDurationMs = amount;
      break;
    }
  }

  if (unavailable.length > 0) {
    return {
      kind: "pause_capability_unavailable",
      unavailableMetrics: [...new Set(unavailable)],
      snapshot: input.snapshot,
      continuation: continuation("select_capable_harness", input.snapshot),
    };
  }
  if (exhausted.length > 0) {
    if (input.revision.contract.policy.budgetExhaustion === "stop") {
      return {
        kind: "stop_budget_exhausted",
        exhaustedLimits: exhausted,
        snapshot: input.snapshot,
      };
    }
    return {
      kind: "pause_budget_exhausted",
      exhaustedLimits: exhausted,
      snapshot: input.snapshot,
      continuation: continuation("request_budget_revision", input.snapshot),
    };
  }
  return {
    kind: "admitted",
    contractRevisionDigest: input.revision.revisionDigest,
    accountingRevision: input.snapshot.revision,
    reserved,
    diagnostics: scope?.diagnostics ?? [],
  };
}

export function normalizeBoundedWorkAccountingSnapshot(
  input: BoundedWorkAccountingSnapshot,
): BoundedWorkAccountingSnapshot {
  if (input.schema !== "kiln.bounded-work-accounting/v1") throw new Error("accounting schema is invalid");
  return {
    schema: "kiln.bounded-work-accounting/v1",
    accountingLineageId: requireText(input.accountingLineageId, "accounting.accountingLineageId"),
    contractRevisionDigest: requireBoundedWorkDigest(input.contractRevisionDigest, "accounting.contractRevisionDigest"),
    revision: nonNegativeInteger(input.revision, "accounting.revision"),
    executionAttempts: nonNegativeInteger(input.executionAttempts, "accounting.executionAttempts"),
    managedInvocations: nonNegativeInteger(input.managedInvocations, "accounting.managedInvocations"),
    activeManagedInvocations: nonNegativeInteger(input.activeManagedInvocations, "accounting.activeManagedInvocations"),
    reviewRounds: nonNegativeInteger(input.reviewRounds, "accounting.reviewRounds"),
    remediationRounds: nonNegativeInteger(input.remediationRounds, "accounting.remediationRounds"),
    toolCalls: normalizeMeasured(input.toolCalls, "accounting.toolCalls"),
    activeDurationMs: normalizeMeasured(input.activeDurationMs, "accounting.activeDurationMs"),
  };
}

function capabilitySatisfies(
  actual: BoundedWorkHarnessCapability,
  minimum: BoundedWorkHarnessCapability,
): boolean {
  const rank: Record<BoundedWorkHarnessCapability, number> = {
    advisory_only: 0,
    partially_enforced: 1,
    authoritative: 2,
  };
  return rank[actual] >= rank[minimum];
}

export function decideBoundedWorkCloseout(input: {
  readonly revision: BoundedWorkContractRevision;
  readonly snapshot: BoundedWorkAccountingSnapshot;
  readonly candidateDigest: string;
  readonly satisfiedCriteria: readonly BoundedWorkSatisfiedCriterion[];
  /**
   * Evidence already bound to this candidate. A satisfied criterion may only
   * name a digest that appears here, so a claim cannot cite evidence that was
   * never recorded against the candidate being accepted.
   */
  readonly candidateEvidence: readonly BoundedWorkCandidateEvidence[];
}): BoundedWorkCloseoutDecision {
  assertAccountingBinding(input.revision, input.snapshot);
  const candidateDigest = requireBoundedWorkDigest(input.candidateDigest, "candidateDigest");
  const boundEvidence = new Set(
    input.candidateEvidence
      .filter((record) => record.candidateDigest === candidateDigest)
      .map((record) => record.evidenceDigest),
  );
  for (const evidence of input.satisfiedCriteria) {
    if (requireBoundedWorkDigest(evidence.candidateDigest, "criterion.candidateDigest") !== candidateDigest) {
      throw new Error("acceptance evidence is stale for the current candidate");
    }
    // Canonical syntax is necessary but not sufficient: a well-formed digest
    // that names nothing would otherwise satisfy a criterion, and the party
    // supplying it is the party whose work is being accepted.
    if (!boundEvidence.has(requireBoundedWorkDigest(evidence.evidenceDigest, "criterion.evidenceDigest"))) {
      throw new Error("acceptance evidence is not bound to the current candidate");
    }
  }
  const satisfied = new Set(input.satisfiedCriteria.map((evidence) => evidence.criterion.trim()));
  const missingCriteria = input.revision.contract.intent.acceptanceCriteria.filter(
    (criterion) => !satisfied.has(criterion),
  );
  if (missingCriteria.length > 0) {
    return {
      kind: "pause_acceptance_incomplete",
      candidateDigest,
      missingCriteria,
      accounting: input.snapshot,
      continuation: {
        ...continuation("provide_acceptance_evidence", input.snapshot),
        candidateDigest,
      },
    };
  }
  return {
    kind: "stop_acceptance_complete",
    candidateDigest,
    contractRevisionDigest: input.revision.revisionDigest,
    accounting: input.snapshot,
  };
}

function assertAccountingBinding(
  revision: BoundedWorkContractRevision,
  snapshot: BoundedWorkAccountingSnapshot,
): void {
  normalizeBoundedWorkAccountingSnapshot(snapshot);
  if (snapshot.contractRevisionDigest !== revision.revisionDigest) throw new Error("accounting revision is stale");
  if (snapshot.accountingLineageId !== revision.accountingLineageId) throw new Error("accounting lineage does not match contract");
  nonNegativeInteger(snapshot.revision, "accounting.revision");
}

function normalizeMeasured(value: BoundedWorkMeasuredValue, field: string): BoundedWorkMeasuredValue {
  if (value.kind === "observed" || value.kind === "estimated") {
    return { kind: value.kind, value: nonNegativeInteger(value.value, `${field}.value`) };
  }
  if (value.kind === "unknown" || value.kind === "unavailable") return { kind: value.kind };
  throw new Error(`${field}.kind is invalid`);
}

function requireText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} is required`);
  return value.trim();
}

function continuation(
  action: BoundedWorkContinuation["action"],
  snapshot: BoundedWorkAccountingSnapshot,
): BoundedWorkContinuation {
  return {
    action,
    contractRevisionDigest: snapshot.contractRevisionDigest,
    accountingLineageId: snapshot.accountingLineageId,
    accountingRevision: snapshot.revision,
  };
}

function authoritativeValue(value: BoundedWorkMeasuredValue): number | undefined {
  return value.kind === "observed" ? nonNegativeInteger(value.value, "measured value") : undefined;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}
