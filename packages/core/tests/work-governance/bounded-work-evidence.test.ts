import { describe, expect, it } from "vitest";
import {
  formalVerificationToolMetadata,
  type FormalVerificationToolResultMetadata,
} from "../../src/tools/domain/tool-result-metadata.js";
import {
  createBoundedWorkCandidate,
  createBoundedWorkCandidateEvidence,
  createBoundedWorkFormalVerificationAttestation,
  isBoundedWorkCandidateEvidence,
  parseBoundedWorkCandidateEvidence,
  parseBoundedWorkFormalVerificationAttestation,
  WorkItemStore,
  type CreateBoundedWorkCandidateEvidenceInput,
} from "../../src/work-governance/index.js";
import { boundedWorkDigest } from "../../src/work-governance/bounded-work-content.js";

const digest = (character: string): string => `sha256:${character.repeat(64).slice(0, 64)}`;

const registeredProducer = () => ({
  kind: "registered_tool" as const,
  toolName: "formal_verify" as const,
});

const payload = (): FormalVerificationToolResultMetadata => formalVerificationToolMetadata({
  verifier: { name: "dafny", version: "4.11.0" },
  artifact: { contentDigest: digest("a") },
  checks: [{ symbol: "admitPath", check: "correctness", outcome: "proved" }],
});

const candidate = () => createBoundedWorkCandidate({
  goalRunId: "goal-1",
  workItemId: "work-core",
  contractRevisionDigest: digest("b"),
  accountingLineageId: "lineage-1",
  kind: "git_worktree",
  baseline: { kind: "git_tree", digest: digest("c") },
  candidateContentDigest: digest("d"),
  createdAt: "2026-08-19T12:00:00.000Z",
});

const executionAttempt = (overrides: Record<string, unknown> = {}) => ({
  goalRunId: "goal-1",
  workItemId: "work-core",
  attemptId: "attempt-1",
  ...overrides,
});

const evidenceInput = (
  overrides: Partial<CreateBoundedWorkCandidateEvidenceInput> = {},
): CreateBoundedWorkCandidateEvidenceInput => ({
  candidate: candidate(),
  executionAttempt: executionAttempt(),
  invocation: { toolCallScopeId: "scope-1", toolCallId: "call-1" },
  attestation: { producer: registeredProducer(), payload: payload() },
  recordedAt: "2026-08-19T12:01:00.000Z",
  ...overrides,
});

describe("bounded work formal verification attestation", () => {
  it("creates a closed registered-tool attestation with empty establishes", () => {
    const value = createBoundedWorkFormalVerificationAttestation({
      producer: registeredProducer(),
      payload: payload(),
    });

    expect(value).toMatchObject({
      producer: { kind: "registered_tool", toolName: "formal_verify" },
      establishes: [],
      payload: payload(),
    });
    expect(value.schema).toMatch(/^kiln\.bounded-work-formal-verification-attestation\/v\d+$/u);
    expect(value.payloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(value.attestationDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(value.payloadDigest).toBe(boundedWorkDigest(value.payload));
    expect(value.attestationDigest).toBe(boundedWorkDigest({
      schema: value.schema,
      producer: value.producer,
      payload: value.payload,
      payloadDigest: value.payloadDigest,
      establishes: value.establishes,
    }));
    expect(Object.isFrozen(value)).toBe(true);
    expect(parseBoundedWorkFormalVerificationAttestation(value)).toEqual(value);
  });

  it("rejects attestation payload, digest, producer, establishes, and extra-field tampering", () => {
    const value = createBoundedWorkFormalVerificationAttestation({
      producer: registeredProducer(),
      payload: payload(),
    });
    const malformed = [
      { ...value, payloadDigest: digest("e") },
      { ...value, attestationDigest: digest("e") },
      { ...value, producer: { kind: "caller", toolName: "formal_verify" } },
      { ...value, establishes: ["test evidence"] },
      { ...value, unexpected: true },
    ];

    for (const candidateValue of malformed) {
      expect(() => parseBoundedWorkFormalVerificationAttestation(candidateValue)).toThrow();
    }
  });

  it("requires the registered producer identity as closed constructor facts", () => {
    expect(createBoundedWorkFormalVerificationAttestation({
      producer: registeredProducer(),
      payload: payload(),
    }).producer).toEqual(registeredProducer());

    expect(() => createBoundedWorkFormalVerificationAttestation({
      producer: { kind: "registered_tool", toolName: "other_tool" } as never,
      payload: payload(),
    })).toThrow(/producer/u);

    expect(() => createBoundedWorkFormalVerificationAttestation({
      producer: { ...registeredProducer(), unexpected: true } as never,
      payload: payload(),
    })).toThrow();
  });
});

describe("bounded work candidate evidence v2", () => {
  it("creates a digest-stable verification record with exact candidate and attempt projections", () => {
    const value = createBoundedWorkCandidateEvidence(evidenceInput({
      executionAttempt: executionAttempt({ managedInvocationId: "managed-1" }),
    }));

    expect(value).toMatchObject({
      schema: "kiln.bounded-work-candidate-evidence/v2",
      kind: "verification",
      candidate: {
        goalRunId: "goal-1",
        workItemId: "work-core",
        accountingLineageId: "lineage-1",
      },
      executionAttempt: {
        goalRunId: "goal-1",
        workItemId: "work-core",
        attemptId: "attempt-1",
        managedInvocationId: "managed-1",
      },
      invocation: { toolCallScopeId: "scope-1", toolCallId: "call-1" },
    });
    expect(Object.keys(value)).toEqual([
      "schema",
      "kind",
      "candidate",
      "executionAttempt",
      "invocation",
      "attestation",
      "recordedAt",
      "recordDigest",
    ]);
    expect(value.recordDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(value.recordDigest).toBe(boundedWorkDigest({
      schema: value.schema,
      kind: value.kind,
      candidate: value.candidate,
      executionAttempt: value.executionAttempt,
      invocation: value.invocation,
      attestation: value.attestation,
      recordedAt: value.recordedAt,
    }));
    expect(parseBoundedWorkCandidateEvidence(value)).toEqual(value);
    expect(isBoundedWorkCandidateEvidence(value)).toBe(true);
  });

  it("keeps the optional managed invocation field exact", () => {
    const withoutManagedInvocation = createBoundedWorkCandidateEvidence(evidenceInput());
    const withManagedInvocation = createBoundedWorkCandidateEvidence(evidenceInput({
      executionAttempt: executionAttempt({ managedInvocationId: "managed-1" }),
    }));

    expect(Object.prototype.hasOwnProperty.call(withoutManagedInvocation.executionAttempt, "managedInvocationId"))
      .toBe(false);
    expect(Object.prototype.hasOwnProperty.call(withManagedInvocation.executionAttempt, "managedInvocationId"))
      .toBe(true);
    expect(withoutManagedInvocation.recordDigest).not.toBe(withManagedInvocation.recordDigest);
  });

  it("rejects v1, acceptance, extra-field, and record/attestation tampering", () => {
    const value = createBoundedWorkCandidateEvidence(evidenceInput());
    const malformed = [
      { ...value, schema: "kiln.bounded-work-candidate-evidence/v1" },
      { ...value, kind: "acceptance" },
      { ...value, recordDigest: digest("e") },
      { ...value, extra: true },
      { ...value, candidate: { ...value.candidate, candidateContentDigest: digest("e") } },
      { ...value, attestation: { ...value.attestation, attestationDigest: digest("e") } },
      { ...value, attestation: { ...value.attestation, establishes: ["test evidence"] } },
    ];

    for (const candidateValue of malformed) {
      expect(() => parseBoundedWorkCandidateEvidence(candidateValue)).toThrow();
      expect(isBoundedWorkCandidateEvidence(candidateValue)).toBe(false);
    }
  });

  it("rejects an execution attempt from another governed work item", () => {
    expect(() => createBoundedWorkCandidateEvidence(evidenceInput({
      executionAttempt: executionAttempt({ workItemId: "other-work" }),
    }))).toThrow(/workItemId/u);
  });

  it("rejects extra constructor fields instead of silently projecting them", () => {
    expect(() => createBoundedWorkCandidateEvidence(evidenceInput({
      executionAttempt: executionAttempt({ unexpected: true }) as unknown as CreateBoundedWorkCandidateEvidenceInput["executionAttempt"],
    }))).toThrow();
  });

  it("requires WorkItem binding to preserve the exact attempt and managed invocation presence", () => {
    const store = new WorkItemStore({ now: () => "2026-08-19T12:00:00.000Z" });
    const item = store.upsert({
      id: "work-core",
      summary: "Verify the bounded evidence binding.",
      workflowProfile: "verification-heavy",
      triggers: [],
      expectedEvidence: [],
      verificationGates: [],
    });
    const started = store.startExecutionAttempt({
      id: item.id,
      goalRunId: "goal-1",
      boundedWorkContractRevisionDigest: digest("b"),
      executionMode: "direct",
    });
    if (!started) throw new Error("expected attempt");
    const boundCandidate = createBoundedWorkCandidate({
      goalRunId: started.attempt.goalRunId,
      workItemId: started.attempt.workItemId,
      contractRevisionDigest: started.attempt.boundedWorkContractRevisionDigest,
      accountingLineageId: started.attempt.goalRunId,
      kind: "git_worktree",
      baseline: { kind: "git_tree", digest: digest("c") },
      candidateContentDigest: digest("d"),
      createdAt: started.attempt.startedAt,
    });
    const record = createBoundedWorkCandidateEvidence({
      candidate: boundCandidate,
      executionAttempt: {
        goalRunId: started.attempt.goalRunId,
        workItemId: started.attempt.workItemId,
        attemptId: started.attempt.id,
        managedInvocationId: "managed-1",
      },
      invocation: { toolCallScopeId: "scope-1", toolCallId: "call-1" },
      attestation: { producer: registeredProducer(), payload: payload() },
      recordedAt: "2026-08-19T12:01:00.000Z",
    });

    expect(() => store.finishExecutionAttempt({
      id: item.id,
      attemptId: started.attempt.id,
      candidate: boundCandidate,
      candidateEvidence: [record],
    })).toThrow(/exact candidate and attempt/u);
  });
});
