import {
  assessBoundedWorkScope,
  normalizeBoundedWorkContractRevision,
  type AssessBoundedWorkScopeInput,
  type BoundedWorkContractRevision,
  type BoundedWorkHarnessCapability,
} from "./bounded-work-contract.js";
import type {
  BoundedWorkScopeViolation,
  BoundedWorkTripwireDiagnostic,
} from "./bounded-work-scope-policy.js";
import { freezeBoundedWorkValue, requireBoundedWorkDigest, boundedWorkDigest } from "./bounded-work-content.js";
import {
  parseBoundedWorkCandidateEvidence,
  type BoundedWorkCandidateEvidence,
} from "./bounded-work-evidence.js";
import {
  parseBoundedWorkAssuranceEvaluation,
  type BoundedWorkAssuranceEvaluation,
} from "./bounded-work-assurance.js";
import type { BoundedWorkAdoptionAuthority } from "./bounded-work-contract.js";

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

export const BOUNDED_WORK_ACCEPTANCE_DECISION_SCHEMA =
  "kiln.bounded-work-acceptance-decision/v1" as const;

export type BoundedWorkAcceptanceDecisionOutcome = "accepted" | "incomplete";

export interface BoundedWorkAcceptanceDecisionIssuer {
  readonly kind: "automatic_policy";
  readonly policyRevisionDigest: string;
}

export interface BoundedWorkAcceptanceDecisionRecord {
  readonly schema: typeof BOUNDED_WORK_ACCEPTANCE_DECISION_SCHEMA;
  readonly candidateDigest: string;
  readonly contractRevisionDigest: string;
  readonly assuranceEvaluationDigest: string;
  readonly outcome: BoundedWorkAcceptanceDecisionOutcome;
  readonly issuer: BoundedWorkAcceptanceDecisionIssuer;
  readonly authority: BoundedWorkAdoptionAuthority;
  readonly decidedAt: string;
  readonly decisionDigest: string;
}

export type BoundedWorkCloseoutDecision =
  | {
      readonly kind: "stop_acceptance_complete";
      readonly candidateDigest: string;
      readonly contractRevisionDigest: string;
      readonly accounting: BoundedWorkAccountingSnapshot;
      readonly acceptanceDecision: BoundedWorkAcceptanceDecisionRecord;
    }
  | {
      readonly kind: "pause_acceptance_incomplete";
      readonly candidateDigest: string;
      readonly missingCriteria: readonly string[];
      readonly accounting: BoundedWorkAccountingSnapshot;
      readonly continuation: BoundedWorkContinuation;
      readonly acceptanceDecision: BoundedWorkAcceptanceDecisionRecord;
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

export interface DecideBoundedWorkCloseoutInput {
  readonly revision: BoundedWorkContractRevision;
  readonly snapshot: BoundedWorkAccountingSnapshot;
  readonly candidateDigest: string;
  readonly candidateEvidence: readonly BoundedWorkCandidateEvidence[];
  readonly assuranceEvaluation: BoundedWorkAssuranceEvaluation;
  readonly decidedAt: string;
}

export function decideBoundedWorkCloseout(
  input: DecideBoundedWorkCloseoutInput,
): BoundedWorkCloseoutDecision {
  const revision = normalizeCloseoutRevision(input.revision);
  assertAccountingBinding(revision, input.snapshot);
  const candidateDigest = requireBoundedWorkDigest(input.candidateDigest, "candidateDigest");
  const assuranceEvaluation = parseBoundedWorkAssuranceEvaluation(input.assuranceEvaluation);
  assertAssuranceEvaluationBinding({ revision, snapshot: input.snapshot, candidateDigest, assuranceEvaluation });
  const parsedEvidence = input.candidateEvidence.map((record) => parseBoundedWorkCandidateEvidence(record));
  assertEvidenceBasis({ revision, snapshot: input.snapshot, candidateDigest, assuranceEvaluation, parsedEvidence });
  assertAssurancePolicyMapping(revision, assuranceEvaluation);
  assertAssuranceEvidenceOutcomes(revision, assuranceEvaluation, parsedEvidence);

  const missingCriteria = revision.contract.intent.acceptanceCriteria
    .filter((criterion) => assuranceEvaluation.criterionEvaluations
      .find((evaluation) => evaluation.criterionId === criterion.id)?.outcome !== "established")
    .map((criterion) => criterion.id);
  const acceptanceDecision = createBoundedWorkAcceptanceDecisionRecord({
    revision,
    candidateDigest,
    assuranceEvaluation,
    outcome: missingCriteria.length === 0 ? "accepted" : "incomplete",
    decidedAt: input.decidedAt,
  });
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
      acceptanceDecision,
    };
  }
  return {
    kind: "stop_acceptance_complete",
    candidateDigest,
    contractRevisionDigest: revision.revisionDigest,
    accounting: input.snapshot,
    acceptanceDecision,
  };
}

export function createBoundedWorkAcceptanceDecisionRecord(input: {
  readonly revision: BoundedWorkContractRevision;
  readonly candidateDigest: string;
  readonly assuranceEvaluation: BoundedWorkAssuranceEvaluation;
  readonly outcome: BoundedWorkAcceptanceDecisionOutcome;
  readonly decidedAt: string;
}): BoundedWorkAcceptanceDecisionRecord {
  const revision = normalizeCloseoutRevision(input.revision);
  const candidateDigest = requireBoundedWorkDigest(input.candidateDigest, "candidateDigest");
  const assuranceEvaluation = parseBoundedWorkAssuranceEvaluation(input.assuranceEvaluation);
  assertAssuranceEvaluationBinding({
    revision,
    snapshot: undefined,
    candidateDigest,
    assuranceEvaluation,
  });
  assertAssurancePolicyMapping(revision, assuranceEvaluation);
  assertAcceptanceOutcomeMatchesEvaluation(input.outcome, assuranceEvaluation);
  if (input.outcome !== "accepted" && input.outcome !== "incomplete") {
    throw new Error("acceptance decision outcome is invalid");
  }
  const decidedAt = requireCanonicalTimestamp(input.decidedAt, "decidedAt");
  const body = {
    schema: BOUNDED_WORK_ACCEPTANCE_DECISION_SCHEMA,
    candidateDigest,
    contractRevisionDigest: revision.revisionDigest,
    assuranceEvaluationDigest: assuranceEvaluation.evaluationDigest,
    outcome: input.outcome,
    issuer: {
      kind: "automatic_policy" as const,
      policyRevisionDigest: revision.revisionDigest,
    },
    authority: revision.adoptedBy,
    decidedAt,
  };
  return freezeBoundedWorkValue({
    ...body,
    decisionDigest: boundedWorkDigest(body),
  });
}

export function parseBoundedWorkAcceptanceDecisionRecord(
  value: unknown,
): BoundedWorkAcceptanceDecisionRecord {
  assertRecord(value, "bounded work acceptance decision");
  assertExactKeys(value, [
    "schema",
    "candidateDigest",
    "contractRevisionDigest",
    "assuranceEvaluationDigest",
    "outcome",
    "issuer",
    "authority",
    "decidedAt",
    "decisionDigest",
  ], "bounded work acceptance decision");
  if (value.schema !== BOUNDED_WORK_ACCEPTANCE_DECISION_SCHEMA) {
    throw new Error("bounded work acceptance decision schema is invalid");
  }
  const candidateDigest = requireUnknownDigest(value.candidateDigest, "candidateDigest");
  const contractRevisionDigest = requireUnknownDigest(value.contractRevisionDigest, "contractRevisionDigest");
  const assuranceEvaluationDigest = requireUnknownDigest(
    value.assuranceEvaluationDigest,
    "assuranceEvaluationDigest",
  );
  if (value.outcome !== "accepted" && value.outcome !== "incomplete") {
    throw new Error("acceptance decision outcome is invalid");
  }
  const issuer = parseAcceptanceDecisionIssuer(value.issuer);
  if (issuer.policyRevisionDigest !== contractRevisionDigest) {
    throw new Error("acceptance decision issuer policy revision is stale");
  }
  const authority = parseAcceptanceDecisionAuthority(value.authority);
  const decidedAt = requireCanonicalTimestamp(value.decidedAt, "decidedAt");
  const body = {
    schema: BOUNDED_WORK_ACCEPTANCE_DECISION_SCHEMA,
    candidateDigest,
    contractRevisionDigest,
    assuranceEvaluationDigest,
    outcome: value.outcome,
    issuer,
    authority,
    decidedAt,
  } as const;
  const decisionDigest = requireUnknownDigest(value.decisionDigest, "decisionDigest");
  if (decisionDigest !== boundedWorkDigest(body)) {
    throw new Error("decisionDigest does not match acceptance decision");
  }
  return freezeBoundedWorkValue({ ...body, decisionDigest });
}

function normalizeCloseoutRevision(
  revision: BoundedWorkContractRevision,
): BoundedWorkContractRevision {
  return normalizeBoundedWorkContractRevision(revision);
}

function assertAssuranceEvaluationBinding(input: {
  readonly revision: BoundedWorkContractRevision;
  readonly snapshot?: BoundedWorkAccountingSnapshot;
  readonly candidateDigest: string;
  readonly assuranceEvaluation: BoundedWorkAssuranceEvaluation;
}): void {
  const evaluation = input.assuranceEvaluation;
  if (evaluation.candidate.candidateDigest !== input.candidateDigest) {
    throw new Error("Assurance evaluation candidateDigest is stale");
  }
  if (evaluation.contractRevisionDigest !== input.revision.revisionDigest) {
    throw new Error("Assurance evaluation contractRevisionDigest is stale");
  }
  if (evaluation.candidate.contractRevisionDigest !== input.revision.revisionDigest) {
    throw new Error("Assurance evaluation candidate revision is stale");
  }
  if (evaluation.candidate.accountingLineageId !== input.revision.accountingLineageId) {
    throw new Error("Assurance evaluation accounting lineage is stale");
  }
  if (input.snapshot !== undefined && evaluation.candidate.accountingLineageId !== input.snapshot.accountingLineageId) {
    throw new Error("Assurance evaluation accounting lineage does not match accounting");
  }
}

function assertEvidenceBasis(input: {
  readonly revision: BoundedWorkContractRevision;
  readonly snapshot: BoundedWorkAccountingSnapshot;
  readonly candidateDigest: string;
  readonly assuranceEvaluation: BoundedWorkAssuranceEvaluation;
  readonly parsedEvidence: readonly BoundedWorkCandidateEvidence[];
}): void {
  const evidenceByDigest = new Map<string, BoundedWorkCandidateEvidence>();
  for (const evidence of input.parsedEvidence) {
    if (evidence.candidate.candidateDigest !== input.candidateDigest
      || evidence.candidate.candidateContentDigest !== input.assuranceEvaluation.candidate.candidateContentDigest
      || evidence.candidate.contractRevisionDigest !== input.revision.revisionDigest
      || evidence.candidate.accountingLineageId !== input.snapshot.accountingLineageId) {
      continue;
    }
    const previous = evidenceByDigest.get(evidence.recordDigest);
    if (previous !== undefined && previous !== evidence) {
      throw new Error("candidate evidence contains duplicate recordDigest values");
    }
    evidenceByDigest.set(evidence.recordDigest, evidence);
  }
  for (const evidenceDigest of input.assuranceEvaluation.consideredEvidenceRecordDigests) {
    if (!evidenceByDigest.has(evidenceDigest)) {
      throw new Error(`Assurance evaluation evidence ${evidenceDigest} is not bound to candidate evidence`);
    }
  }
  for (const obligation of input.assuranceEvaluation.obligationEvaluations) {
    for (const evidenceDigest of obligation.evidenceRecordDigests) {
      if (!evidenceByDigest.has(evidenceDigest)) {
        throw new Error(`Assurance obligation evidence ${evidenceDigest} is not bound to candidate evidence`);
      }
    }
  }
}

function assertAssurancePolicyMapping(
  revision: BoundedWorkContractRevision,
  evaluation: BoundedWorkAssuranceEvaluation,
): void {
  const policy = revision.contract.assurance.formalVerification;
  const expectedObligationIds = policy.obligations.map(({ id }) => id);
  const actualObligationIds = evaluation.obligationEvaluations.map(({ obligationId }) => obligationId);
  assertExactStringSet(actualObligationIds, expectedObligationIds, "obligation IDs");

  const expectedCriteria = revision.contract.intent.acceptanceCriteria.map(({ id }) => id);
  const actualCriteria = evaluation.criterionEvaluations.map(({ criterionId }) => criterionId);
  assertExactStringSet(actualCriteria, expectedCriteria, "criterion IDs");

  const expectedMappings = new Map(
    policy.mappings.map((mapping) => [mapping.criterionId, mapping.obligationIds]),
  );
  for (const evaluationCriterion of evaluation.criterionEvaluations) {
    const expectedObligations = expectedMappings.get(evaluationCriterion.criterionId);
    if (expectedObligations === undefined
      || !sameStringList(evaluationCriterion.obligationIds, expectedObligations)) {
      throw new Error(`Assurance evaluation mapping for ${evaluationCriterion.criterionId} does not match policy`);
    }
  }
}

function assertAssuranceEvidenceOutcomes(
  revision: BoundedWorkContractRevision,
  evaluation: BoundedWorkAssuranceEvaluation,
  parsedEvidence: readonly BoundedWorkCandidateEvidence[],
): void {
  const evidenceByDigest = new Map(parsedEvidence.map((evidence) => [evidence.recordDigest, evidence]));
  const obligationsById = new Map(
    revision.contract.assurance.formalVerification.obligations.map((obligation) => [obligation.id, obligation]),
  );
  for (const obligationEvaluation of evaluation.obligationEvaluations) {
    if (obligationEvaluation.outcome !== "established") continue;
    const obligation = obligationsById.get(obligationEvaluation.obligationId);
    if (obligation === undefined) {
      throw new Error(`Assurance evaluation references unknown obligation ${obligationEvaluation.obligationId}`);
    }
    const hasProvedCheck = obligationEvaluation.evidenceRecordDigests.some((evidenceDigest) =>
      evidenceByDigest.get(evidenceDigest)?.attestation.payload.checks.some((check) =>
        check.symbol === obligation.symbol
        && check.check === "correctness"
        && check.outcome === "proved",
      ) === true,
    );
    if (!hasProvedCheck) {
      throw new Error(`Assurance evaluation established outcome for ${obligation.id} is not supported by candidate evidence`);
    }
  }
}

function assertAcceptanceOutcomeMatchesEvaluation(
  outcome: BoundedWorkAcceptanceDecisionOutcome,
  evaluation: BoundedWorkAssuranceEvaluation,
): void {
  const expected = evaluation.criterionEvaluations.every((criterion) => criterion.outcome === "established")
    ? "accepted"
    : "incomplete";
  if (outcome !== expected) {
    throw new Error(`acceptance decision outcome ${outcome} does not match Assurance evaluation`);
  }
}

function assertExactStringSet(actual: readonly string[], expected: readonly string[], field: string): void {
  if (actual.length !== expected.length || actual.some((value) => !expected.includes(value))) {
    throw new Error(`Assurance evaluation ${field} do not match policy`);
  }
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function parseAcceptanceDecisionIssuer(value: unknown): BoundedWorkAcceptanceDecisionIssuer {
  assertRecord(value, "acceptance decision issuer");
  assertExactKeys(value, ["kind", "policyRevisionDigest"], "acceptance decision issuer");
  if (value.kind !== "automatic_policy") {
    throw new Error("acceptance decision issuer kind is invalid");
  }
  return {
    kind: "automatic_policy",
    policyRevisionDigest: requireUnknownDigest(value.policyRevisionDigest, "issuer.policyRevisionDigest"),
  };
}

function parseAcceptanceDecisionAuthority(value: unknown): BoundedWorkAdoptionAuthority {
  assertRecord(value, "acceptance decision authority");
  if (value.kind === "operator") {
    assertExactKeys(value, ["kind", "actorId", "decisionId"], "acceptance decision authority");
    return {
      kind: "operator",
      actorId: requireText(value.actorId, "authority.actorId"),
      decisionId: requireText(value.decisionId, "authority.decisionId"),
    };
  }
  if (value.kind === "approved_plan") {
    assertExactKeys(value, ["kind", "planId", "planDigest"], "acceptance decision authority");
    return {
      kind: "approved_plan",
      planId: requireText(value.planId, "authority.planId"),
      planDigest: requireUnknownDigest(value.planDigest, "authority.planDigest"),
    };
  }
  throw new Error("acceptance decision authority kind is invalid");
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

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} is required`);
  return value.trim();
}

function requireCanonicalTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a canonical ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO timestamp`);
  }
  return value;
}

function requireUnknownDigest(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be canonical sha256 evidence`);
  return requireBoundedWorkDigest(value, field);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
}

function assertExactKeys(value: object, keys: readonly string[], field: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error(`${field} has an invalid shape or extra field`);
  }
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
