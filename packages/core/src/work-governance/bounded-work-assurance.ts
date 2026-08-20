import type {
  FormalVerificationToolResultMetadata,
} from "../tools/domain/tool-result-metadata.js";
import {
  parseBoundedWorkCandidateEvidence,
  type BoundedWorkCandidateEvidence,
} from "./bounded-work-evidence.js";
import type { BoundedWorkCandidateIdentity } from "./bounded-work-candidate.js";
import {
  normalizeBoundedWorkContractRevision,
  type BoundedWorkContractRevision,
  type BoundedWorkFormalVerificationObligation,
} from "./bounded-work-contract.js";
import {
  boundedWorkDigest,
  freezeBoundedWorkValue,
  requireBoundedWorkDigest,
} from "./bounded-work-content.js";
import {
  normalizeCandidateSubjectDigests,
  normalizeFormalProofSubjects,
  type CandidateSubjectDigests,
} from "./formal-proof-subjects.js";

export const BOUNDED_WORK_ASSURANCE_EVALUATION_SCHEMA =
  "kiln.bounded-work-assurance-evaluation/v1" as const;

export type BoundedWorkAssuranceEvaluationOutcome = "established" | "unresolved";

export interface BoundedWorkAssuranceCandidateProjection {
  readonly candidateDigest: string;
  readonly candidateContentDigest: string;
  readonly contractRevisionDigest: string;
  readonly accountingLineageId: string;
}

export interface BoundedWorkAssuranceObligationEvaluation {
  readonly obligationId: string;
  readonly outcome: BoundedWorkAssuranceEvaluationOutcome;
  readonly evidenceRecordDigests: readonly string[];
}

export interface BoundedWorkAssuranceCriterionEvaluation {
  readonly criterionId: string;
  readonly outcome: BoundedWorkAssuranceEvaluationOutcome;
  readonly obligationIds: readonly string[];
}

/**
 * A pure, candidate-bound Assurance result. This record reports evaluation
 * facts; it neither accepts a candidate nor decides a terminal closeout.
 */
export interface BoundedWorkAssuranceEvaluation {
  readonly schema: typeof BOUNDED_WORK_ASSURANCE_EVALUATION_SCHEMA;
  readonly candidate: BoundedWorkAssuranceCandidateProjection;
  readonly contractRevisionDigest: string;
  readonly candidateSubjectsDigest: string;
  readonly consideredEvidenceRecordDigests: readonly string[];
  readonly obligationEvaluations: readonly BoundedWorkAssuranceObligationEvaluation[];
  readonly criterionEvaluations: readonly BoundedWorkAssuranceCriterionEvaluation[];
  readonly evaluatedAt: string;
  readonly evaluationDigest: string;
}

export interface EvaluateBoundedWorkAssuranceInput {
  readonly revision: BoundedWorkContractRevision;
  readonly candidate: BoundedWorkCandidateIdentity;
  readonly candidateSubjects: CandidateSubjectDigests;
  readonly candidateEvidence: readonly BoundedWorkCandidateEvidence[];
  readonly evaluatedAt: string;
}

export function evaluateBoundedWorkAssurance(
  input: EvaluateBoundedWorkAssuranceInput,
): BoundedWorkAssuranceEvaluation {
  const revision = normalizeBoundedWorkContractRevision(input.revision);
  const candidate = normalizeCandidateProjectionInput(input.candidate);
  if (candidate.contractRevisionDigest !== revision.revisionDigest) {
    throw new Error("candidate contractRevisionDigest does not match revision");
  }
  if (candidate.accountingLineageId !== revision.accountingLineageId) {
    throw new Error("candidate accountingLineageId does not match revision");
  }

  const candidateSubjects = normalizeCandidateSubjectDigests(input.candidateSubjects);
  if (candidateSubjects.candidateContentDigest !== candidate.candidateContentDigest) {
    throw new Error("candidateSubjects.candidateContentDigest does not match candidate");
  }

  const parsedEvidence = input.candidateEvidence.map((evidence) =>
    parseBoundedWorkCandidateEvidence(evidence),
  );
  const linkedEvidence = uniqueEvidenceByDigest(parsedEvidence.filter((evidence) =>
    evidenceBelongsToCandidate(evidence, candidate, revision),
  ));
  const consideredEvidenceRecordDigests = sortedUnique(
    linkedEvidence.map(({ recordDigest }) => recordDigest),
  );

  const formalVerification = revision.contract.assurance.formalVerification;
  const obligationEvaluations = [...formalVerification.obligations]
    .sort((left, right) => compareCanonicalText(left.id, right.id))
    .map((obligation) => {
    const evidenceRecordDigests = sortedUnique(
      linkedEvidence
        .filter((evidence) => evidenceProvesObligation(evidence, obligation, candidateSubjects))
        .map(({ recordDigest }) => recordDigest),
    );
    return {
      obligationId: obligation.id,
      outcome: evidenceRecordDigests.length > 0 ? "established" as const : "unresolved" as const,
      evidenceRecordDigests,
    };
  });
  const obligationOutcomes = new Map(
    obligationEvaluations.map((evaluation) => [evaluation.obligationId, evaluation.outcome]),
  );
  const criterionEvaluations = [...formalVerification.mappings]
    .sort((left, right) => compareCanonicalText(left.criterionId, right.criterionId))
    .map((mapping) => ({
      criterionId: mapping.criterionId,
      obligationIds: [...mapping.obligationIds],
      outcome: mapping.obligationIds.every((obligationId) =>
        obligationOutcomes.get(obligationId) === "established"
      )
        ? "established" as const
        : "unresolved" as const,
    }));

  const body = {
    schema: BOUNDED_WORK_ASSURANCE_EVALUATION_SCHEMA,
    candidate,
    contractRevisionDigest: revision.revisionDigest,
    candidateSubjectsDigest: digestCandidateSubjects(candidateSubjects),
    consideredEvidenceRecordDigests,
    obligationEvaluations,
    criterionEvaluations,
    evaluatedAt: requireTimestamp(input.evaluatedAt, "evaluatedAt"),
  };
  return parseBoundedWorkAssuranceEvaluation({
    ...body,
    evaluationDigest: boundedWorkDigest(body),
  });
}

/** Parse and verify one immutable Assurance evaluation record. */
export function parseBoundedWorkAssuranceEvaluation(
  value: unknown,
): BoundedWorkAssuranceEvaluation {
  assertRecord(value, "bounded work Assurance evaluation");
  assertExactKeys(value, [
    "schema",
    "candidate",
    "contractRevisionDigest",
    "candidateSubjectsDigest",
    "consideredEvidenceRecordDigests",
    "obligationEvaluations",
    "criterionEvaluations",
    "evaluatedAt",
    "evaluationDigest",
  ]);
  if (value.schema !== BOUNDED_WORK_ASSURANCE_EVALUATION_SCHEMA) {
    throw new Error("bounded work Assurance evaluation schema is invalid");
  }

  const candidate = parseCandidateProjection(value.candidate);
  const contractRevisionDigest = requireDigest(value.contractRevisionDigest, "contractRevisionDigest");
  if (contractRevisionDigest !== candidate.contractRevisionDigest) {
    throw new Error("evaluation contractRevisionDigest does not match candidate");
  }
  const candidateSubjectsDigest = requireDigest(value.candidateSubjectsDigest, "candidateSubjectsDigest");
  const consideredEvidenceRecordDigests = parseDigestList(
    value.consideredEvidenceRecordDigests,
    "consideredEvidenceRecordDigests",
  );
  const obligationEvaluations = parseObligationEvaluations(value.obligationEvaluations);
  const criterionEvaluations = parseCriterionEvaluations(
    value.criterionEvaluations,
    obligationEvaluations,
    consideredEvidenceRecordDigests,
  );
  const evaluatedAt = requireTimestamp(value.evaluatedAt, "evaluatedAt");
  const body = {
    schema: BOUNDED_WORK_ASSURANCE_EVALUATION_SCHEMA,
    candidate,
    contractRevisionDigest,
    candidateSubjectsDigest,
    consideredEvidenceRecordDigests,
    obligationEvaluations,
    criterionEvaluations,
    evaluatedAt,
  };
  const evaluationDigest = requireDigest(value.evaluationDigest, "evaluationDigest");
  if (evaluationDigest !== boundedWorkDigest(body)) {
    throw new Error("evaluationDigest does not match Assurance evaluation");
  }
  return freezeBoundedWorkValue({ ...body, evaluationDigest });
}

export function isBoundedWorkAssuranceEvaluation(
  value: unknown,
): value is BoundedWorkAssuranceEvaluation {
  try {
    parseBoundedWorkAssuranceEvaluation(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeCandidateProjectionInput(
  candidate: BoundedWorkCandidateIdentity,
): BoundedWorkAssuranceCandidateProjection {
  if (candidate.schema !== "kiln.bounded-work-candidate/v1") {
    throw new Error("candidate schema is invalid");
  }
  const hasPreviousCandidateDigest = Object.prototype.hasOwnProperty.call(candidate, "previousCandidateDigest");
  const identity = {
    schema: candidate.schema,
    goalRunId: requireText(candidate.goalRunId, "candidate.goalRunId"),
    workItemId: requireText(candidate.workItemId, "candidate.workItemId"),
    contractRevisionDigest: requireDigest(candidate.contractRevisionDigest, "candidate.contractRevisionDigest"),
    accountingLineageId: requireText(candidate.accountingLineageId, "candidate.accountingLineageId"),
    kind: candidate.kind,
    baseline: candidate.baseline,
    candidateContentDigest: requireDigest(candidate.candidateContentDigest, "candidate.candidateContentDigest"),
    ...(hasPreviousCandidateDigest
      ? { previousCandidateDigest: requireDigest(candidate.previousCandidateDigest, "candidate.previousCandidateDigest") }
      : {}),
    createdAt: requireTimestamp(candidate.createdAt, "candidate.createdAt"),
  };
  const candidateDigest = requireDigest(candidate.candidateDigest, "candidate.candidateDigest");
  if (candidateDigest !== boundedWorkDigest(identity)) {
    throw new Error("candidateDigest does not match candidate identity");
  }
  return {
    candidateDigest,
    candidateContentDigest: identity.candidateContentDigest,
    contractRevisionDigest: identity.contractRevisionDigest,
    accountingLineageId: identity.accountingLineageId,
  };
}

function evidenceBelongsToCandidate(
  evidence: BoundedWorkCandidateEvidence,
  candidate: BoundedWorkAssuranceCandidateProjection,
  revision: BoundedWorkContractRevision,
): boolean {
  return evidence.candidate.candidateDigest === candidate.candidateDigest
    && evidence.candidate.candidateContentDigest === candidate.candidateContentDigest
    && evidence.candidate.contractRevisionDigest === revision.revisionDigest
    && evidence.candidate.accountingLineageId === revision.accountingLineageId;
}

function evidenceProvesObligation(
  evidence: BoundedWorkCandidateEvidence,
  obligation: BoundedWorkFormalVerificationObligation,
  candidateSubjects: CandidateSubjectDigests,
): boolean {
  const attestation = evidence.attestation;
  if (attestation.producer.kind !== "registered_tool" || attestation.producer.toolName !== "formal_verify") {
    return false;
  }
  const payload = attestation.payload;
  if (!hasBoundCandidateSubjects(payload, candidateSubjects)) return false;
  if (!obligation.subjectPaths.every((path) => payload.subjects.some((subject) => subject.path === path))) {
    return false;
  }
  return payload.checks.some((check) =>
    check.symbol === obligation.symbol
    && check.check === "correctness"
    && check.outcome === "proved"
  );
}

function hasBoundCandidateSubjects(
  payload: FormalVerificationToolResultMetadata,
  candidateSubjects: CandidateSubjectDigests,
): boolean {
  const subjects = normalizeFormalProofSubjects(payload.subjects);
  return subjects.every((subject) => candidateSubjects.digests.get(subject.path) === subject.contentDigest);
}

function digestCandidateSubjects(candidateSubjects: CandidateSubjectDigests): string {
  const ordered = [...candidateSubjects.digests.entries()]
    .sort(([left], [right]) => compareCanonicalText(left, right))
    .map(([path, contentDigest]) => ({ path, contentDigest }));
  return boundedWorkDigest({
    candidateContentDigest: candidateSubjects.candidateContentDigest,
    subjects: ordered,
  });
}

function uniqueEvidenceByDigest(
  evidence: readonly BoundedWorkCandidateEvidence[],
): readonly BoundedWorkCandidateEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((entry) => {
    if (seen.has(entry.recordDigest)) return false;
    seen.add(entry.recordDigest);
    return true;
  });
}

function parseCandidateProjection(value: unknown): BoundedWorkAssuranceCandidateProjection {
  assertRecord(value, "evaluation.candidate");
  assertExactKeys(value, [
    "candidateDigest",
    "candidateContentDigest",
    "contractRevisionDigest",
    "accountingLineageId",
  ]);
  return {
    candidateDigest: requireDigest(value.candidateDigest, "evaluation.candidate.candidateDigest"),
    candidateContentDigest: requireDigest(
      value.candidateContentDigest,
      "evaluation.candidate.candidateContentDigest",
    ),
    contractRevisionDigest: requireDigest(
      value.contractRevisionDigest,
      "evaluation.candidate.contractRevisionDigest",
    ),
    accountingLineageId: requireText(value.accountingLineageId, "evaluation.candidate.accountingLineageId"),
  };
}

function parseObligationEvaluations(
  value: unknown,
): readonly BoundedWorkAssuranceObligationEvaluation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("obligationEvaluations must be a non-empty array");
  }
  const evaluations = value.map((entry, index) => {
    assertRecord(entry, `obligationEvaluations[${index}]`);
    assertExactKeys(entry, ["obligationId", "outcome", "evidenceRecordDigests"]);
    const obligationId = requireText(entry.obligationId, `obligationEvaluations[${index}].obligationId`);
    const outcome = parseOutcome(entry.outcome, `obligationEvaluations[${index}].outcome`);
    const evidenceRecordDigests = parseDigestList(
      entry.evidenceRecordDigests,
      `obligationEvaluations[${index}].evidenceRecordDigests`,
    );
    if (outcome === "established" && evidenceRecordDigests.length === 0) {
      throw new Error(`obligationEvaluations[${index}] established outcome requires evidence`);
    }
    if (outcome === "unresolved" && evidenceRecordDigests.length > 0) {
      throw new Error(`obligationEvaluations[${index}] unresolved outcome cannot carry evidence`);
    }
    return { obligationId, outcome, evidenceRecordDigests };
  });
  requireCanonicalOrderAndUniqueness(evaluations.map(({ obligationId }) => obligationId), "obligationEvaluations");
  return evaluations;
}

function parseCriterionEvaluations(
  value: unknown,
  obligations: readonly BoundedWorkAssuranceObligationEvaluation[],
  consideredEvidenceRecordDigests: readonly string[],
): readonly BoundedWorkAssuranceCriterionEvaluation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("criterionEvaluations must be a non-empty array");
  }
  const obligationById = new Map(obligations.map((obligation) => [obligation.obligationId, obligation]));
  const considered = new Set(consideredEvidenceRecordDigests);
  const referencedObligations = new Set<string>();
  const evaluations = value.map((entry, index) => {
    assertRecord(entry, `criterionEvaluations[${index}]`);
    assertExactKeys(entry, ["criterionId", "outcome", "obligationIds"]);
    const criterionId = requireText(entry.criterionId, `criterionEvaluations[${index}].criterionId`);
    const outcome = parseOutcome(entry.outcome, `criterionEvaluations[${index}].outcome`);
    const obligationIds = parseTextList(entry.obligationIds, `criterionEvaluations[${index}].obligationIds`);
    for (const obligationId of obligationIds) {
      const obligation = obligationById.get(obligationId);
      if (!obligation) throw new Error(`criterion evaluation references unknown obligation ${obligationId}`);
      referencedObligations.add(obligationId);
      for (const evidenceDigest of obligation.evidenceRecordDigests) {
        if (!considered.has(evidenceDigest)) {
          throw new Error("obligation evidence must be included in considered evidence");
        }
      }
    }
    const expectedOutcome = obligationIds.every((obligationId) =>
      obligationById.get(obligationId)?.outcome === "established"
    )
      ? "established"
      : "unresolved";
    if (outcome !== expectedOutcome) {
      throw new Error(`criterionEvaluations[${index}] outcome does not match allOf obligations`);
    }
    return { criterionId, outcome, obligationIds };
  });
  requireCanonicalOrderAndUniqueness(evaluations.map(({ criterionId }) => criterionId), "criterionEvaluations");
  if (referencedObligations.size !== obligations.length) {
    throw new Error("criterionEvaluations must reference every obligation");
  }
  return evaluations;
}

function parseDigestList(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const digests = value.map((entry, index) => requireDigest(entry, `${field}[${index}]`));
  requireCanonicalOrderAndUniqueness(digests, field);
  return digests;
}

function parseTextList(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be non-empty`);
  const values = value.map((entry, index) => requireText(entry, `${field}[${index}]`));
  requireCanonicalOrderAndUniqueness(values, field);
  return values;
}

function parseOutcome(value: unknown, field: string): BoundedWorkAssuranceEvaluationOutcome {
  if (value !== "established" && value !== "unresolved") throw new Error(`${field} is invalid`);
  return value;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

function requireCanonicalOrderAndUniqueness(values: readonly string[], field: string): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || compareCanonicalText(previous, current) >= 0) {
      throw new Error(`${field} must be sorted and contain no duplicates`);
    }
  }
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a canonical ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO timestamp`);
  }
  return value;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`${field} must be a non-empty canonical string`);
  }
  return value;
}

function requireDigest(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be canonical sha256 evidence`);
  return requireBoundedWorkDigest(value, field);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
}

function assertExactKeys(
  value: object,
  required: readonly string[],
): void {
  const keys = Object.keys(value);
  if (keys.length !== required.length || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error("bounded work Assurance evaluation has an invalid shape or extra field");
  }
}
