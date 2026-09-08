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
    { id: "core-tests", command: "bun test core", status: "passed", revision: "abc1234" },
    { id: "typecheck", command: "bun typecheck", status: "passed", revision: "abc1234" },
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
  it("renders a reviewer-oriented body with verification and residual risk", () => {
    const artifact = renderPullRequestArtifact({
      evidence: EVIDENCE,
      title: "Govern cross-harness communication intent",
      body: [
        {
          text: "Surfaces previously resolved response behavior independently. Adds one provider-neutral communication decision.",
          evidenceIds: ["work:issue-77", "diff"],
        },
        { text: "Keep reasoning and response detail separate.", evidenceIds: ["work:issue-77"] },
      ],
    });

    expect(artifact.content).toMatch(/^Surfaces previously resolved/);
    expect(artifact.contractVersion).toBe("v2");
    expect(artifact.content).toContain("- `bun test core` — passed");
    expect(artifact.content).toContain(EVIDENCE.residualRisks[0]);
    expect(artifact.content).not.toContain("Candidate revision:");
    expect(artifact.evidence.candidateRevision).toBe("abc1234");
    expect(validatePullRequestArtifact(artifact)).toEqual({ valid: true, errors: [] });
  });

  it("rejects verification from a different candidate revision", () => {
    expect(() =>
      createChangeArtifactEvidence({
        candidateRevision: "abc1234",
        diffHash: `sha256:${"b".repeat(64)}`,
        linkedWork: [],
        verification: [{ id: "tests", command: "bun test", status: "passed", revision: "old-revision" }],
        residualRisks: [],
      }),
    ).toThrow("candidate revision");
  });

  it("rejects forged pull-request claims and mismatched embedded evidence", () => {
    const artifact = renderPullRequestArtifact({
      evidence: EVIDENCE,
      title: "Bind evidence",
      body: [{ text: "Problem and outcome.", evidenceIds: ["diff", "work:issue-77"] }],
    });

    expect(
      validatePullRequestArtifact({
        ...artifact,
        body: [{ text: "Forged.", evidenceIds: ["unknown"] }],
      }).valid,
    ).toBe(false);
    expect(
      validatePullRequestArtifact({ ...artifact, evidence: { ...EVIDENCE, candidateRevision: "other" } }).valid,
    ).toBe(false);
    expect(validatePullRequestArtifact({ ...artifact, content: "All checks passed." }).valid).toBe(false);
  });

  it("keeps a small change short without empty sections or raw evidence hashes", () => {
    const evidence = createChangeArtifactEvidence({
      candidateRevision: "abc1234",
      diffHash: EVIDENCE.diffHash,
      linkedWork: [],
      verification: [],
      residualRisks: [],
    });
    const artifact = renderPullRequestArtifact({
      evidence,
      title: "Fix stale catalog entries",
      body: [{ text: "Removal left stale entries. Refresh the catalog after removal.", evidenceIds: ["diff"] }],
    });
    expect(artifact.content).toBe(
      "Removal left stale entries. Refresh the catalog after removal.\n\nVerification: Not run.",
    );
    expect(validatePullRequestArtifact(artifact).valid).toBe(true);
    expect(() => renderPullRequestArtifact({ evidence, title: "Empty", body: [] })).toThrow("body");
  });

  it("preserves Markdown examples and exposes open findings before the explanation", () => {
    const body = "## Behavior\n\n```diff\n- accept stale token\n+ reject stale token\n```";
    const artifact = renderPullRequestArtifact({
      evidence: EVIDENCE,
      title: "Reject stale tokens",
      body: [{ text: body, evidenceIds: ["diff"] }],
      findings: [
        { text: "Expired sessions still need a migration.", evidenceIds: ["diff"], severity: "high", status: "open" },
        { text: "Fixed misleading error.", evidenceIds: ["diff"], severity: "low", status: "resolved" },
      ],
    });
    expect(artifact.content).toMatch(/^## Findings\n\n- \*\*high:\*\* Expired sessions/);
    expect(artifact.content).toContain(body);
    expect(artifact.content).not.toContain("Fixed misleading error.");
    expect(
      validatePullRequestArtifact({
        ...artifact,
        content: artifact.content.replace("Expired sessions still need a migration.", "Resolved."),
      }).valid,
    ).toBe(false);
  });

  it("reports failed and unrun checks without turning them into successful verification", () => {
    const evidence = createChangeArtifactEvidence({
      ...EVIDENCE,
      verification: [
        { id: "tests", command: "bun run test", status: "failed", revision: EVIDENCE.candidateRevision },
        { id: "smoke", command: "bun run smoke", status: "not-run", revision: EVIDENCE.candidateRevision },
      ],
    });
    const artifact = renderPullRequestArtifact({
      evidence,
      title: "Partial fix",
      body: [{ text: "Fix the first failure.", evidenceIds: ["diff"] }],
    });
    expect(artifact.content).toContain("`bun run test` — failed");
    expect(artifact.content).toContain("`bun run smoke` — not-run");
    expect(artifact.content).not.toContain("passed");
  });
  it("binds red and green checks to distinct declared revisions", () => {
    const evidence = createChangeArtifactEvidence({
      ...EVIDENCE, baselineRevision: "a1",
      verification: [
        { id: "red", command: "bun run test:export", status: "failed", revision: "a1" },
        { id: "green", command: "bun run test:export", status: "passed", revision: EVIDENCE.candidateRevision },
      ],
    });
    const artifact = renderPullRequestArtifact({
      evidence, title: "Remove duplicate export handler",
      body: [{ text: "The regression fails before the fix and passes after it.", evidenceIds: ["verification:red", "verification:green"] }],
    });
    expect(artifact.content).toContain("(baseline `a1`) \u2014 failed");
    expect(artifact.content).toContain("(candidate `abc1234`) \u2014 passed");
    expect(validatePullRequestArtifact(artifact).valid).toBe(true);
    expect(() => createChangeArtifactEvidence({ ...evidence, baselineRevision: evidence.candidateRevision })).toThrow("must differ");
    expect(() => createChangeArtifactEvidence({ ...evidence, baselineRevision: "different" })).toThrow("declared baseline");
  });

  it("never treats baseline-only results as candidate verification", () => {
    const evidence = createChangeArtifactEvidence({
      ...EVIDENCE, baselineRevision: "a1",
      verification: [{ id: "baseline", command: "bun run test", status: "passed", revision: "a1" }],
    });
    const artifact = renderPullRequestArtifact({
      evidence, title: "Pending verification", body: [{ text: "Change the export handler.", evidenceIds: ["diff"] }],
    });
    expect(artifact.content).toContain("(baseline `a1`) \u2014 passed");
    expect(artifact.content).toContain("Candidate `abc1234`: Not run.");
  });

});
