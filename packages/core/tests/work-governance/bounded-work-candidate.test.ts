import { describe, expect, it } from "vitest";
import {
  bindBoundedWorkEvidence,
  createBoundedWorkCandidate,
  type CreateBoundedWorkCandidateInput,
} from "../../src/work-governance/index.js";

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

const candidateInput = (): CreateBoundedWorkCandidateInput => ({
  goalRunId: "goal-1",
  workItemId: "work-core",
  contractRevisionDigest: sha("a"),
  accountingLineageId: "goal-1",
  kind: "git_worktree",
  baseline: { kind: "git_tree", digest: sha("b") },
  candidateContentDigest: sha("c"),
  createdAt: "2026-08-12T18:20:00.000Z",
});

describe("bounded work candidate", () => {
  it("creates a stable content-addressed identity", () => {
    const first = createBoundedWorkCandidate(candidateInput());
    const second = createBoundedWorkCandidate(candidateInput());

    expect(first.candidateDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("keeps corrections in the same contract and accounting lineage", () => {
    const first = createBoundedWorkCandidate(candidateInput());
    const corrected = createBoundedWorkCandidate({
      ...candidateInput(),
      candidateContentDigest: sha("d"),
      previousCandidate: first,
      createdAt: "2026-08-12T18:30:00.000Z",
    });

    expect(corrected.candidateDigest).not.toBe(first.candidateDigest);
    expect(corrected).toMatchObject({
      previousCandidateDigest: first.candidateDigest,
      contractRevisionDigest: first.contractRevisionDigest,
      accountingLineageId: first.accountingLineageId,
    });
  });

  it("binds verification and review evidence only to the exact candidate", () => {
    const candidate = createBoundedWorkCandidate(candidateInput());
    const evidence = bindBoundedWorkEvidence({
      candidate,
      kind: "verification",
      subjectCandidateDigest: candidate.candidateDigest,
      evidenceDigest: sha("e"),
      recordedAt: "2026-08-12T18:25:00.000Z",
    });

    expect(evidence).toMatchObject({
      candidateDigest: candidate.candidateDigest,
      candidateContentDigest: candidate.candidateContentDigest,
      contractRevisionDigest: candidate.contractRevisionDigest,
      kind: "verification",
    });
    expect(() => bindBoundedWorkEvidence({
      candidate,
      kind: "review",
      subjectCandidateDigest: sha("f"),
      evidenceDigest: sha("e"),
      recordedAt: "2026-08-12T18:25:00.000Z",
    })).toThrow("evidence subject does not match candidate");
  });

  it("rejects a correction linked across contract revisions", () => {
    const previous = createBoundedWorkCandidate(candidateInput());
    expect(() => createBoundedWorkCandidate({
      ...candidateInput(),
      contractRevisionDigest: sha("f"),
      previousCandidate: previous,
    })).toThrow("correction must remain on the same contract revision");
  });
});
