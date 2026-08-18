import { describe, expect, it } from "vitest";
import {
  bindFormalProofEvidence,
  createBoundedWorkCandidate,
  recordFormalProofVerdict,
  unprovenCriteria,
  type CandidateSubjectDigests,
  type FormalProofObligation,
  type RecordFormalProofVerdictInput,
} from "../../src/work-governance/index.js";

const digest = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;

const CONTENT = digest("a");
const OTHER_CONTENT = digest("b");
const UNRELATED_CONTENT = digest("e");
const CONTRACT = digest("c");
const BASELINE = digest("d");
const CANDIDATE_TREE_DIGEST = digest("f");
const OTHER_CANDIDATE_TREE_DIGEST = digest("1");
const SUBJECT_PATH = "packages/core/src/deny-list.ts";
const OTHER_SUBJECT_PATH = "packages/core/src/allow-list.ts";

const obligation = (overrides: Partial<FormalProofObligation> = {}): FormalProofObligation => ({
  id: "denied-root-precedence",
  criterionId: "AC-1",
  outcome: "proved",
  ...overrides,
});

const verdictInput = (
  overrides: Partial<RecordFormalProofVerdictInput> = {},
): RecordFormalProofVerdictInput => ({
  verifier: { name: "dafny", version: "4.11.0", translator: { name: "lemmascript", version: "0.6.0" } },
  subjects: [{ path: SUBJECT_PATH, contentDigest: CONTENT }],
  obligations: [obligation()],
  producedAt: "2026-08-17T12:00:00.000Z",
  ...overrides,
});

const candidate = () =>
  createBoundedWorkCandidate({
    goalRunId: "goal-1",
    workItemId: "work-core",
    contractRevisionDigest: CONTRACT,
    accountingLineageId: "lineage-1",
    kind: "git_worktree",
    baseline: { kind: "git_tree", digest: BASELINE },
    candidateContentDigest: CANDIDATE_TREE_DIGEST,
    createdAt: "2026-08-17T11:00:00.000Z",
  });

const subjectDigests = (
  entries: readonly (readonly [string, string])[],
  candidateContentDigest: string = CANDIDATE_TREE_DIGEST,
): CandidateSubjectDigests => ({
  candidateContentDigest,
  digests: new Map(entries),
});

describe("recordFormalProofVerdict", () => {
  it("derives a proved verdict when every obligation is proved", () => {
    const verdict = recordFormalProofVerdict(verdictInput());
    expect(verdict.outcome).toBe("proved");
    expect(verdict.verdictDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("records the toolchain that produced it", () => {
    expect(recordFormalProofVerdict(verdictInput()).verifier).toEqual({
      name: "dafny",
      version: "4.11.0",
      translator: { name: "lemmascript", version: "0.6.0" },
    });
  });

  it("is refuted when any obligation is refuted, even alongside proved ones", () => {
    expect(recordFormalProofVerdict(verdictInput({
      obligations: [
        obligation(),
        obligation({ id: "other", criterionId: "AC-2", outcome: "refuted", detail: "counterexample: deniedRoots=['a'], path='a'" }),
      ],
    })).outcome).toBe("refuted");
  });

  it("is unresolved when an obligation is unresolved and none are refuted", () => {
    expect(recordFormalProofVerdict(verdictInput({
      obligations: [obligation(), obligation({ id: "slow", criterionId: "AC-2", outcome: "unresolved", detail: "verifier timeout" })],
    })).outcome).toBe("unresolved");
  });

  it("rejects an empty obligation set rather than treating it as proved", () => {
    expect(() => recordFormalProofVerdict(verdictInput({ obligations: [] })))
      .toThrow(/at least one obligation/u);
  });

  it("requires detail on any obligation that is not proved", () => {
    expect(() => recordFormalProofVerdict(verdictInput({
      obligations: [obligation({ outcome: "refuted" })],
    }))).toThrow(/must record detail/u);
  });

  it("rejects duplicate obligation ids", () => {
    expect(() => recordFormalProofVerdict(verdictInput({
      obligations: [obligation(), obligation({ criterionId: "AC-2" })],
    }))).toThrow(/duplicate obligation id/u);
  });

  it("digests identically for equal verdicts and differently across subjects", () => {
    const a = recordFormalProofVerdict(verdictInput());
    const b = recordFormalProofVerdict(verdictInput());
    const other = recordFormalProofVerdict(verdictInput({
      subjects: [{ path: SUBJECT_PATH, contentDigest: OTHER_CONTENT }],
    }));
    expect(a.verdictDigest).toBe(b.verdictDigest);
    expect(a.verdictDigest).not.toBe(other.verdictDigest);
  });

  it("rejects an empty subject set rather than covering nothing", () => {
    expect(() => recordFormalProofVerdict(verdictInput({ subjects: [] })))
      .toThrow(/at least one subject/u);
  });

  it("rejects duplicate subject paths", () => {
    expect(() => recordFormalProofVerdict(verdictInput({
      subjects: [
        { path: SUBJECT_PATH, contentDigest: CONTENT },
        { path: SUBJECT_PATH, contentDigest: OTHER_CONTENT },
      ],
    }))).toThrow(/duplicate subject path/u);
  });

  it("rejects a subject path that escapes the candidate with a parent segment", () => {
    expect(() => recordFormalProofVerdict(verdictInput({
      subjects: [{ path: "../outside.ts", contentDigest: CONTENT }],
    }))).toThrow(/subject path/u);
  });

  it("rejects an absolute subject path", () => {
    expect(() => recordFormalProofVerdict(verdictInput({
      subjects: [{ path: "/etc/passwd", contentDigest: CONTENT }],
    }))).toThrow(/subject path/u);
  });

  it("rejects a subject path carrying a drive letter", () => {
    expect(() => recordFormalProofVerdict(verdictInput({
      subjects: [{ path: "C:/Windows/system.ts", contentDigest: CONTENT }],
    }))).toThrow(/subject path/u);
  });

  it("rejects a subject path with backslash separators", () => {
    expect(() => recordFormalProofVerdict(verdictInput({
      subjects: [{ path: "packages\\core\\src\\deny-list.ts", contentDigest: CONTENT }],
    }))).toThrow(/subject path/u);
  });

  it("produces the same verdictDigest regardless of subject declaration order", () => {
    const a = recordFormalProofVerdict(verdictInput({
      subjects: [
        { path: SUBJECT_PATH, contentDigest: CONTENT },
        { path: OTHER_SUBJECT_PATH, contentDigest: OTHER_CONTENT },
      ],
    }));
    const b = recordFormalProofVerdict(verdictInput({
      subjects: [
        { path: OTHER_SUBJECT_PATH, contentDigest: OTHER_CONTENT },
        { path: SUBJECT_PATH, contentDigest: CONTENT },
      ],
    }));
    expect(a.verdictDigest).toBe(b.verdictDigest);
  });
});

describe("bindFormalProofEvidence", () => {
  it("binds a verdict whose covered subject matches the candidate's content", () => {
    const subject = candidate();
    const verdict = recordFormalProofVerdict(verdictInput());
    const evidence = bindFormalProofEvidence({
      candidate: subject,
      candidateSubjects: subjectDigests([[SUBJECT_PATH, CONTENT]]),
      verdict,
      recordedAt: "2026-08-17T12:30:00.000Z",
    });
    expect(evidence.kind).toBe("verification");
    expect(evidence.evidenceDigest).toBe(verdict.verdictDigest);
    expect(evidence.contractRevisionDigest).toBe(CONTRACT);
  });

  it("rejects binding when a covered subject's content changed in the candidate", () => {
    expect(() => bindFormalProofEvidence({
      candidate: candidate(),
      candidateSubjects: subjectDigests([[SUBJECT_PATH, OTHER_CONTENT]]),
      verdict: recordFormalProofVerdict(verdictInput()),
      recordedAt: "2026-08-17T12:30:00.000Z",
    })).toThrow(/deny-list\.ts.*content changed/u);
  });

  it("rejects binding when a covered subject is absent from the candidate", () => {
    expect(() => bindFormalProofEvidence({
      candidate: candidate(),
      candidateSubjects: subjectDigests([[OTHER_SUBJECT_PATH, OTHER_CONTENT]]),
      verdict: recordFormalProofVerdict(verdictInput()),
      recordedAt: "2026-08-17T12:30:00.000Z",
    })).toThrow(/deny-list\.ts.*absent/u);
  });

  it("binds a multi-subject verdict when every covered subject matches, ignoring uncovered candidate paths", () => {
    const verdict = recordFormalProofVerdict(verdictInput({
      subjects: [
        { path: SUBJECT_PATH, contentDigest: CONTENT },
        { path: OTHER_SUBJECT_PATH, contentDigest: OTHER_CONTENT },
      ],
    }));
    const evidence = bindFormalProofEvidence({
      candidate: candidate(),
      candidateSubjects: subjectDigests([
        [SUBJECT_PATH, CONTENT],
        [OTHER_SUBJECT_PATH, OTHER_CONTENT],
        ["packages/core/src/unrelated.ts", UNRELATED_CONTENT],
      ]),
      verdict,
      recordedAt: "2026-08-17T12:30:00.000Z",
    });
    expect(evidence.evidenceDigest).toBe(verdict.verdictDigest);
  });

  it("binds a refuted verdict so a failed proof leaves a record", () => {
    const verdict = recordFormalProofVerdict(verdictInput({
      obligations: [obligation({ outcome: "refuted", detail: "counterexample found" })],
    }));
    expect(bindFormalProofEvidence({
      candidate: candidate(),
      candidateSubjects: subjectDigests([[SUBJECT_PATH, CONTENT]]),
      verdict,
      recordedAt: "2026-08-17T12:30:00.000Z",
    }).evidenceDigest).toBe(verdict.verdictDigest);
  });

  it("rejects binding when candidateSubjects was resolved from a different candidate, even though every path and digest matches", () => {
    expect(() => bindFormalProofEvidence({
      candidate: candidate(),
      candidateSubjects: subjectDigests([[SUBJECT_PATH, CONTENT]], OTHER_CANDIDATE_TREE_DIGEST),
      verdict: recordFormalProofVerdict(verdictInput()),
      recordedAt: "2026-08-17T12:30:00.000Z",
    })).toThrow(/different candidate/u);
  });

  it("rejects a malformed candidateContentDigest on candidateSubjects", () => {
    expect(() => bindFormalProofEvidence({
      candidate: candidate(),
      candidateSubjects: subjectDigests([[SUBJECT_PATH, CONTENT]], "not-a-digest"),
      verdict: recordFormalProofVerdict(verdictInput()),
      recordedAt: "2026-08-17T12:30:00.000Z",
    })).toThrow(/candidateSubjects\.candidateContentDigest/u);
  });
});

describe("unprovenCriteria", () => {
  it("reports criteria with no proved obligation", () => {
    const verdict = recordFormalProofVerdict(verdictInput({
      obligations: [
        obligation(),
        obligation({ id: "second", criterionId: "AC-2", outcome: "unresolved", detail: "timeout" }),
      ],
    }));
    expect(unprovenCriteria(verdict, ["AC-1", "AC-2", "AC-3"])).toEqual(["AC-2", "AC-3"]);
  });

  it("reports nothing when every criterion has a proved obligation", () => {
    expect(unprovenCriteria(recordFormalProofVerdict(verdictInput()), ["AC-1"])).toEqual([]);
  });
});
