import { describe, expect, it } from "vitest";
import {
  bindFormalProofEvidence,
  createBoundedWorkCandidate,
  recordFormalProofVerdict,
  unprovenCriteria,
  type FormalProofObligation,
  type RecordFormalProofVerdictInput,
} from "../../src/work-governance/index.js";

const digest = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;

const CONTENT = digest("a");
const OTHER_CONTENT = digest("b");
const CONTRACT = digest("c");
const BASELINE = digest("d");

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
  subjectContentDigest: CONTENT,
  obligations: [obligation()],
  producedAt: "2026-08-17T12:00:00.000Z",
  ...overrides,
});

const candidate = (contentDigest = CONTENT) =>
  createBoundedWorkCandidate({
    goalRunId: "goal-1",
    workItemId: "work-core",
    contractRevisionDigest: CONTRACT,
    accountingLineageId: "lineage-1",
    kind: "git_worktree",
    baseline: { kind: "git_tree", digest: BASELINE },
    candidateContentDigest: contentDigest,
    createdAt: "2026-08-17T11:00:00.000Z",
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
    const other = recordFormalProofVerdict(verdictInput({ subjectContentDigest: OTHER_CONTENT }));
    expect(a.verdictDigest).toBe(b.verdictDigest);
    expect(a.verdictDigest).not.toBe(other.verdictDigest);
  });
});

describe("bindFormalProofEvidence", () => {
  it("binds a verdict produced against the candidate's content", () => {
    const subject = candidate();
    const verdict = recordFormalProofVerdict(verdictInput());
    const evidence = bindFormalProofEvidence({
      candidate: subject,
      verdict,
      recordedAt: "2026-08-17T12:30:00.000Z",
    });
    expect(evidence.kind).toBe("verification");
    expect(evidence.evidenceDigest).toBe(verdict.verdictDigest);
    expect(evidence.candidateContentDigest).toBe(CONTENT);
    expect(evidence.contractRevisionDigest).toBe(CONTRACT);
  });

  it("rejects a verdict whose subject content is not the candidate's", () => {
    expect(() => bindFormalProofEvidence({
      candidate: candidate(OTHER_CONTENT),
      verdict: recordFormalProofVerdict(verdictInput()),
      recordedAt: "2026-08-17T12:30:00.000Z",
    })).toThrow(/subject does not match candidate content/u);
  });

  it("binds a refuted verdict so a failed proof leaves a record", () => {
    const verdict = recordFormalProofVerdict(verdictInput({
      obligations: [obligation({ outcome: "refuted", detail: "counterexample found" })],
    }));
    expect(bindFormalProofEvidence({
      candidate: candidate(),
      verdict,
      recordedAt: "2026-08-17T12:30:00.000Z",
    }).evidenceDigest).toBe(verdict.verdictDigest);
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
