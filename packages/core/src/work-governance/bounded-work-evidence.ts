import {
  parseFormalVerificationToolResultMetadata,
  type FormalVerificationToolResultMetadata,
} from "../tools/domain/tool-result-metadata.js";
import type { BoundedWorkCandidateIdentity, BoundedWorkCandidateKind } from "./bounded-work-candidate.js";
import {
  boundedWorkDigest,
  freezeBoundedWorkValue,
  requireBoundedWorkDigest,
} from "./bounded-work-content.js";

export const BOUNDED_WORK_FORMAL_VERIFICATION_ATTESTATION_SCHEMA =
  "kiln.bounded-work-formal-verification-attestation/v1" as const;
export const BOUNDED_WORK_CANDIDATE_EVIDENCE_SCHEMA =
  "kiln.bounded-work-candidate-evidence/v2" as const;

export type BoundedWorkEvidenceKind = "verification";

export interface BoundedWorkRegisteredToolProducer {
  readonly kind: "registered_tool";
  readonly toolName: "formal_verify";
}

export interface BoundedWorkFormalVerificationAttestation {
  readonly schema: typeof BOUNDED_WORK_FORMAL_VERIFICATION_ATTESTATION_SCHEMA;
  readonly producer: BoundedWorkRegisteredToolProducer;
  readonly payload: FormalVerificationToolResultMetadata;
  readonly payloadDigest: string;
  readonly establishes: readonly [];
  readonly attestationDigest: string;
}

export interface CreateBoundedWorkFormalVerificationAttestationInput {
  readonly producer: BoundedWorkRegisteredToolProducer;
  readonly payload: FormalVerificationToolResultMetadata;
}

export interface BoundedWorkCandidateProjection {
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly accountingLineageId: string;
  readonly contractRevisionDigest: string;
  readonly candidateDigest: string;
  readonly candidateContentDigest: string;
}

export interface BoundedWorkEvidenceExecutionAttempt {
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly managedInvocationId?: string;
}

export interface BoundedWorkEvidenceInvocation {
  readonly toolCallScopeId: string;
  readonly toolCallId: string;
}

export interface BoundedWorkCandidateEvidence {
  readonly schema: typeof BOUNDED_WORK_CANDIDATE_EVIDENCE_SCHEMA;
  readonly kind: BoundedWorkEvidenceKind;
  readonly candidate: BoundedWorkCandidateProjection;
  readonly executionAttempt: BoundedWorkEvidenceExecutionAttempt;
  readonly invocation: BoundedWorkEvidenceInvocation;
  readonly attestation: BoundedWorkFormalVerificationAttestation;
  readonly recordedAt: string;
  readonly recordDigest: string;
}

export interface CreateBoundedWorkCandidateEvidenceInput {
  readonly candidate: BoundedWorkCandidateIdentity;
  readonly executionAttempt: BoundedWorkEvidenceExecutionAttempt;
  readonly invocation: BoundedWorkEvidenceInvocation;
  readonly attestation: CreateBoundedWorkFormalVerificationAttestationInput;
  readonly recordedAt: string;
}

export function createBoundedWorkFormalVerificationAttestation(
  input: CreateBoundedWorkFormalVerificationAttestationInput,
): BoundedWorkFormalVerificationAttestation {
  assertRecord(input, "formal verification attestation input");
  assertExactKeys(input, ["producer", "payload"]);
  const producer = normalizeProducer(input.producer);
  const payload = parseFormalVerificationToolResultMetadata(input.payload);
  const payloadDigest = boundedWorkDigest(payload);
  const body = {
    schema: BOUNDED_WORK_FORMAL_VERIFICATION_ATTESTATION_SCHEMA,
    producer,
    payload,
    payloadDigest,
    establishes: [] as const,
  };
  return freezeBoundedWorkValue({
    ...body,
    attestationDigest: boundedWorkDigest(body),
  });
}

export function parseBoundedWorkFormalVerificationAttestation(
  value: unknown,
): BoundedWorkFormalVerificationAttestation {
  assertRecord(value, "formal verification attestation");
  assertExactKeys(value, ["schema", "producer", "payload", "payloadDigest", "establishes", "attestationDigest"]);
  if (value.schema !== BOUNDED_WORK_FORMAL_VERIFICATION_ATTESTATION_SCHEMA) {
    throw new Error("formal verification attestation schema is invalid");
  }

  const producer = normalizeProducer(value.producer);

  const payload = parseFormalVerificationToolResultMetadata(value.payload);
  const payloadDigest = requireDigest(value.payloadDigest, "formal verification payloadDigest");
  const expectedPayloadDigest = boundedWorkDigest(payload);
  if (payloadDigest !== expectedPayloadDigest) {
    throw new Error("formal verification payloadDigest does not match payload");
  }

  if (!Array.isArray(value.establishes) || value.establishes.length !== 0) {
    throw new Error("formal verification attestation establishes must be empty");
  }
  const body = {
    schema: BOUNDED_WORK_FORMAL_VERIFICATION_ATTESTATION_SCHEMA,
    producer,
    payload,
    payloadDigest,
    establishes: [] as const,
  };
  const attestationDigest = requireDigest(
    value.attestationDigest,
    "formal verification attestationDigest",
  );
  if (attestationDigest !== boundedWorkDigest(body)) {
    throw new Error("formal verification attestationDigest does not match attestation");
  }
  return freezeBoundedWorkValue({ ...body, attestationDigest });
}

export function isBoundedWorkFormalVerificationAttestation(
  value: unknown,
): value is BoundedWorkFormalVerificationAttestation {
  try {
    parseBoundedWorkFormalVerificationAttestation(value);
    return true;
  } catch {
    return false;
  }
}

export function createBoundedWorkCandidateEvidence(
  input: CreateBoundedWorkCandidateEvidenceInput,
): BoundedWorkCandidateEvidence {
  assertRecord(input, "bounded work candidate evidence input");
  assertExactKeys(input, ["candidate", "executionAttempt", "invocation", "attestation", "recordedAt"]);
  const candidate = projectCandidate(input.candidate);
  const executionAttempt = normalizeExecutionAttempt(input.executionAttempt, "executionAttempt");
  if (executionAttempt.goalRunId !== candidate.goalRunId) {
    throw new Error("executionAttempt.goalRunId does not match candidate");
  }
  if (executionAttempt.workItemId !== candidate.workItemId) {
    throw new Error("executionAttempt.workItemId does not match candidate");
  }
  const invocation = normalizeInvocation(input.invocation);
  const attestation = createBoundedWorkFormalVerificationAttestation(input.attestation);
  const recordedAt = requireTimestamp(input.recordedAt, "recordedAt");
  const body = {
    schema: BOUNDED_WORK_CANDIDATE_EVIDENCE_SCHEMA,
    kind: "verification" as const,
    candidate,
    executionAttempt,
    invocation,
    attestation,
    recordedAt,
  };
  return freezeBoundedWorkValue({
    ...body,
    recordDigest: boundedWorkDigest(body),
  });
}

export function parseBoundedWorkCandidateEvidence(value: unknown): BoundedWorkCandidateEvidence {
  assertRecord(value, "bounded work candidate evidence");
  assertExactKeys(value, [
    "schema",
    "kind",
    "candidate",
    "executionAttempt",
    "invocation",
    "attestation",
    "recordedAt",
    "recordDigest",
  ]);
  if (value.schema !== BOUNDED_WORK_CANDIDATE_EVIDENCE_SCHEMA) {
    throw new Error("bounded work candidate evidence schema is invalid");
  }
  if (value.kind !== "verification") throw new Error("bounded work candidate evidence kind is invalid");
  const candidate = parseCandidateProjection(value.candidate);
  const executionAttempt = normalizeExecutionAttempt(value.executionAttempt, "executionAttempt");
  if (executionAttempt.goalRunId !== candidate.goalRunId) {
    throw new Error("executionAttempt.goalRunId does not match candidate");
  }
  if (executionAttempt.workItemId !== candidate.workItemId) {
    throw new Error("executionAttempt.workItemId does not match candidate");
  }
  const invocation = normalizeInvocation(value.invocation);
  const attestation = parseBoundedWorkFormalVerificationAttestation(value.attestation);
  const recordedAt = requireTimestamp(value.recordedAt, "recordedAt");
  const body = {
    schema: BOUNDED_WORK_CANDIDATE_EVIDENCE_SCHEMA,
    kind: "verification" as const,
    candidate,
    executionAttempt,
    invocation,
    attestation,
    recordedAt,
  };
  const recordDigest = requireDigest(value.recordDigest, "recordDigest");
  if (recordDigest !== boundedWorkDigest(body)) {
    throw new Error("recordDigest does not match bounded work candidate evidence");
  }
  return freezeBoundedWorkValue({ ...body, recordDigest });
}

export function isBoundedWorkCandidateEvidence(
  value: unknown,
): value is BoundedWorkCandidateEvidence {
  try {
    parseBoundedWorkCandidateEvidence(value);
    return true;
  } catch {
    return false;
  }
}

function projectCandidate(candidate: BoundedWorkCandidateIdentity): BoundedWorkCandidateProjection {
  const normalized = normalizeCandidateIdentity(candidate);
  return {
    goalRunId: normalized.goalRunId,
    workItemId: normalized.workItemId,
    accountingLineageId: normalized.accountingLineageId,
    contractRevisionDigest: normalized.contractRevisionDigest,
    candidateDigest: normalized.candidateDigest,
    candidateContentDigest: normalized.candidateContentDigest,
  };
}

function parseCandidateProjection(value: unknown): BoundedWorkCandidateProjection {
  assertRecord(value, "candidate projection");
  assertExactKeys(value, [
    "goalRunId",
    "workItemId",
    "accountingLineageId",
    "contractRevisionDigest",
    "candidateDigest",
    "candidateContentDigest",
  ]);
  return {
    goalRunId: requireText(value.goalRunId, "candidate.goalRunId"),
    workItemId: requireText(value.workItemId, "candidate.workItemId"),
    accountingLineageId: requireText(value.accountingLineageId, "candidate.accountingLineageId"),
    contractRevisionDigest: requireDigest(
      value.contractRevisionDigest,
      "candidate.contractRevisionDigest",
    ),
    candidateDigest: requireDigest(value.candidateDigest, "candidate.candidateDigest"),
    candidateContentDigest: requireDigest(
      value.candidateContentDigest,
      "candidate.candidateContentDigest",
    ),
  };
}

function normalizeCandidateIdentity(candidate: BoundedWorkCandidateIdentity): BoundedWorkCandidateIdentity {
  assertRecord(candidate, "candidate identity");
  const optionalKeys = Object.prototype.hasOwnProperty.call(candidate, "previousCandidateDigest")
    ? ["previousCandidateDigest"]
    : [];
  assertExactKeys(candidate, [
    "schema",
    "goalRunId",
    "workItemId",
    "contractRevisionDigest",
    "accountingLineageId",
    "kind",
    "baseline",
    "candidateContentDigest",
    "createdAt",
    "candidateDigest",
  ], optionalKeys);
  if (candidate.schema !== "kiln.bounded-work-candidate/v1") {
    throw new Error("candidate schema is invalid");
  }
  const kind = requireCandidateKind(candidate.kind);
  const baseline = candidate.baseline;
  assertRecord(baseline, "candidate baseline");
  assertExactKeys(baseline, ["kind", "digest"]);
  const baselineKind = requireBaselineKind(baseline.kind);
  const normalized = {
    schema: "kiln.bounded-work-candidate/v1" as const,
    goalRunId: requireText(candidate.goalRunId, "candidate.goalRunId"),
    workItemId: requireText(candidate.workItemId, "candidate.workItemId"),
    contractRevisionDigest: requireBoundedWorkDigest(
      candidate.contractRevisionDigest,
      "candidate.contractRevisionDigest",
    ),
    accountingLineageId: requireText(candidate.accountingLineageId, "candidate.accountingLineageId"),
    kind,
    baseline: {
      kind: baselineKind,
      digest: requireBoundedWorkDigest(baseline.digest, "candidate.baseline.digest"),
    },
    candidateContentDigest: requireBoundedWorkDigest(
      candidate.candidateContentDigest,
      "candidate.candidateContentDigest",
    ),
    ...(Object.prototype.hasOwnProperty.call(candidate, "previousCandidateDigest")
      ? { previousCandidateDigest: requireBoundedWorkDigest(candidate.previousCandidateDigest!, "candidate.previousCandidateDigest") }
      : {}),
    createdAt: requireTimestamp(candidate.createdAt, "candidate.createdAt"),
  };
  const candidateDigest = requireBoundedWorkDigest(candidate.candidateDigest, "candidate.candidateDigest");
  if (candidateDigest !== boundedWorkDigest(normalized)) {
    throw new Error("candidateDigest does not match candidate identity");
  }
  return { ...normalized, candidateDigest };
}

function normalizeExecutionAttempt(
  value: unknown,
  field: string,
): BoundedWorkEvidenceExecutionAttempt {
  assertRecord(value, field);
  const hasManagedInvocationId = Object.prototype.hasOwnProperty.call(value, "managedInvocationId");
  assertExactKeys(value, ["goalRunId", "workItemId", "attemptId"], hasManagedInvocationId ? ["managedInvocationId"] : []);
  return {
    goalRunId: requireText(value.goalRunId, `${field}.goalRunId`),
    workItemId: requireText(value.workItemId, `${field}.workItemId`),
    attemptId: requireText(value.attemptId, `${field}.attemptId`),
    ...(hasManagedInvocationId
      ? { managedInvocationId: requireText(value.managedInvocationId, `${field}.managedInvocationId`) }
      : {}),
  };
}

function normalizeInvocation(value: unknown): BoundedWorkEvidenceInvocation {
  assertRecord(value, "invocation");
  assertExactKeys(value, ["toolCallScopeId", "toolCallId"]);
  return {
    toolCallScopeId: requireText(value.toolCallScopeId, "invocation.toolCallScopeId"),
    toolCallId: requireText(value.toolCallId, "invocation.toolCallId"),
  };
}

function normalizeProducer(value: unknown): BoundedWorkRegisteredToolProducer {
  assertRecord(value, "formal verification attestation producer");
  assertExactKeys(value, ["kind", "toolName"]);
  if (value.kind !== "registered_tool" || value.toolName !== "formal_verify") {
    throw new Error("formal verification attestation producer is invalid");
  }
  return { kind: "registered_tool", toolName: "formal_verify" };
}

function requireCandidateKind(value: unknown): BoundedWorkCandidateKind {
  if (value !== "git_worktree" && value !== "artifact" && value !== "external_state") {
    throw new Error("candidate.kind is invalid");
  }
  return value;
}

function requireBaselineKind(value: unknown): "git_tree" | "content_snapshot" | "external_version" {
  if (value !== "git_tree" && value !== "content_snapshot" && value !== "external_version") {
    throw new Error("candidate.baseline.kind is invalid");
  }
  return value;
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
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key)) || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error("bounded work evidence has an invalid shape or extra field");
  }
}
