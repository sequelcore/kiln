import { describe, expect, it } from "vitest";
import {
  createChangeArtifactEvidence,
  renderCommitArtifact,
  renderPullRequestArtifact,
  validateCommitArtifact,
  validatePullRequestArtifact,
} from "../../src/index.js";

const EVIDENCE = createChangeArtifactEvidence({
  candidateRevision: "abc1234",
  diffHash: `sha256:${"a".repeat(64)}`,
  linkedWork: [{ id: "issue-77", url: "https://example.test/issues/77" }],
  verification: [
    { id: "core-tests", command: "bun test core", status: "passed", candidateRevision: "abc1234" },
    { id: "typecheck", command: "bun typecheck", status: "passed", candidateRevision: "abc1234" },
  ],
  residualRisks: ["Standalone harness smoke tests remain environment-dependent."],
});

describe("commit artifact contract", () => {
  it("renders an imperative subject and an evidence-bound optional body", () => {
    const artifact = renderCommitArtifact({
      evidence: EVIDENCE,
      subject: { imperativeVerb: "Add", object: "communication governance" },
      claims: [
        { text: "Resolve detail intent against revisioned capabilities.", evidenceIds: ["diff"] },
        { text: "Verify Core behavior and workspace types.", evidenceIds: ["verification:core-tests", "verification:typecheck"] },
      ],
    });

    expect(artifact.content).toBe([
      "Add communication governance",
      "",
      "Resolve detail intent against revisioned capabilities.",
      "Verify Core behavior and workspace types.",
      "",
      "Refs: issue-77",
    ].join("\n"));
    expect(artifact.evidenceIdentity).toBe(EVIDENCE.identity);
    expect(validateCommitArtifact(artifact)).toEqual({ valid: true, errors: [] });
  });

  it("permits a subject-only atomic commit and enforces the configured ceiling", () => {
    const artifact = renderCommitArtifact({
      evidence: EVIDENCE,
      subject: { imperativeVerb: "Fix", object: "status projection" },
      claims: [],
      includeWorkReferences: false,
      subjectCeiling: 72,
    });
    expect(artifact.content).toBe("Fix status projection");
    expect(validateCommitArtifact(artifact)).toEqual({ valid: true, errors: [] });

    expect(() => renderCommitArtifact({
      evidence: EVIDENCE,
      subject: { imperativeVerb: "Add", object: "x".repeat(70) },
      claims: [],
      subjectCeiling: 72,
    })).toThrow("subject ceiling");
  });

  it("rejects claims without exact evidence references", () => {
    expect(() => renderCommitArtifact({
      evidence: EVIDENCE,
      subject: { imperativeVerb: "Add", object: "unsupported claim" },
      claims: [{ text: "Everything is complete.", evidenceIds: ["verification:missing"] }],
    })).toThrow("unknown evidence");
  });

  it("rejects forged evidence bindings during standalone validation", () => {
    const artifact = renderCommitArtifact({
      evidence: EVIDENCE,
      subject: { imperativeVerb: "Add", object: "verified evidence" },
      claims: [{ text: "Bound claim.", evidenceIds: ["diff"] }],
    });

    expect(validateCommitArtifact({
      ...artifact,
      claimEvidence: [{ text: "Forged claim.", evidenceIds: ["verification:unknown"] }],
    }).valid).toBe(false);
    expect(validateCommitArtifact({
      ...artifact,
      evidence: { ...artifact.evidence, diffHash: `sha256:${"f".repeat(64)}` },
    }).valid).toBe(false);
    expect(validateCommitArtifact({ ...artifact, subject: "added vague claim", content: "added vague claim" }).valid)
      .toBe(false);
  });
});

describe("pull request artifact contract", () => {
  it("renders outcome, problem, bounded scope, verification, and residual risk", () => {
    const artifact = renderPullRequestArtifact({
      evidence: EVIDENCE,
      title: "Govern cross-harness communication intent",
      outcome: { text: "Adds one provider-neutral communication decision.", evidenceIds: ["diff"] },
      problem: { text: "Surfaces previously resolved response behavior independently.", evidenceIds: ["work:issue-77"] },
      scope: [{ text: "Core resolution and shared evidence.", evidenceIds: ["diff"] }],
      exclusions: ["No communication default is promoted."],
      decisions: [{ text: "Keep reasoning and response detail separate.", evidenceIds: ["work:issue-77"] }],
    });

    expect(artifact.content).toContain("## Outcome\n\nAdds one provider-neutral communication decision.");
    expect(artifact.content).toContain("- `bun test core` — passed");
    expect(artifact.content).toContain("## Residual risk");
    expect(artifact.content).toContain("Candidate revision: `abc1234`");
    expect(validatePullRequestArtifact(artifact)).toEqual({ valid: true, errors: [] });
  });

  it("rejects verification from a different candidate revision", () => {
    expect(() => createChangeArtifactEvidence({
      candidateRevision: "abc1234",
      diffHash: `sha256:${"b".repeat(64)}`,
      linkedWork: [],
      verification: [{ id: "tests", command: "bun test", status: "passed", candidateRevision: "old-revision" }],
      residualRisks: [],
    })).toThrow("candidate revision");
  });

  it("rejects forged pull-request claims and mismatched embedded evidence", () => {
    const artifact = renderPullRequestArtifact({
      evidence: EVIDENCE,
      title: "Bind evidence",
      outcome: { text: "Outcome.", evidenceIds: ["diff"] },
      problem: { text: "Problem.", evidenceIds: ["work:issue-77"] },
      scope: [],
      exclusions: [],
      decisions: [],
    });

    expect(validatePullRequestArtifact({
      ...artifact,
      claimEvidence: [{ text: "Forged.", evidenceIds: ["unknown"] }],
    }).valid).toBe(false);
    expect(validatePullRequestArtifact({ ...artifact, candidateRevision: "other" }).valid).toBe(false);
  });
});
