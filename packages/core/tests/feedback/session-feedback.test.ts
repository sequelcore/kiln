import { describe, expect, it } from "vitest";
import {
  createFeedbackBundle,
  createFeedbackIssueDraft,
  redactFeedbackText,
} from "../../src/feedback/index.js";
import {
  createFeedbackRepairWorkItemInput,
  FEEDBACK_REPAIR_APPROVAL_EVIDENCE,
  FEEDBACK_REPAIR_BUNDLE_EVIDENCE,
  FEEDBACK_REPAIR_FILE_IMPACT_EVIDENCE,
  FEEDBACK_REPAIR_RISK_HYPOTHESIS_EVIDENCE,
  FEEDBACK_REPAIR_VERIFICATION_CRITERIA_EVIDENCE,
  WorkItemStore,
} from "../../src/index.js";

describe("session feedback redaction", () => {
  it("redacts common credentials before feedback text can be exported", () => {
    const result = redactFeedbackText(
      "Authorization: Bearer sk-proj-abc123456789 and github_pat_1234567890abcdef",
    );

    expect(result.text).not.toContain("sk-proj-abc123456789");
    expect(result.text).not.toContain("github_pat_1234567890abcdef");
    expect(result.text).toContain("[REDACTED:credential]");
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "credential",
      "credential",
    ]);
  });

  it("redacts basic PII separately from credentials", () => {
    const result = redactFeedbackText("Contact Ricardo at ricardo@example.com or 555-123-4567.");

    expect(result.text).toBe("Contact Ricardo at [REDACTED:email] or [REDACTED:phone].");
    expect(result.findings.map((finding) => finding.kind)).toEqual(["email", "phone"]);
  });
});

describe("session feedback bundle", () => {
  it("creates a local-only feedback bundle with selected evidence and redacted text", () => {
    const bundle = createFeedbackBundle({
      feedbackId: "feedback-2026-05-18-001",
      createdAt: "2026-05-18T10:00:00.000Z",
      sessionId: "session-123",
      reporter: {
        mode: "quick",
        description: "The run failed after using token sk-ant-test123456.",
        expectedBehavior: "The command should finish with a useful error.",
        actualBehavior: "It stopped without explaining the failure.",
      },
      evidenceSelection: {
        includeSessionSummary: true,
        includeTranscriptExcerpts: false,
        includeToolFailures: true,
        includeCommandOutput: true,
        includeEnvironment: true,
        includeGitStatus: false,
        includeLogs: false,
        includeFileChangeSummary: false,
        includeDiagnosticFindings: false,
      },
      evidence: [
        {
          kind: "tool-failure",
          title: "Typecheck failed",
          content: "tsc exited with code 2",
        },
        {
          kind: "transcript-excerpt",
          title: "Unselected transcript",
          content: "private prompt content",
        },
      ],
    });

    expect(bundle.status).toBe("local-draft");
    expect(bundle.publication.allowed).toBe(false);
    expect(bundle.report.description).not.toContain("sk-ant-test123456");
    expect(bundle.evidence.map((item) => item.kind)).toEqual(["tool-failure"]);
    expect(bundle.redaction.findings).toHaveLength(1);
  });

  it("fails closed when the session id is missing", () => {
    expect(() => createFeedbackBundle({
      feedbackId: "feedback-2026-05-18-002",
      createdAt: "2026-05-18T10:00:00.000Z",
      sessionId: " ",
      reporter: {
        mode: "quick",
        description: "Something went wrong.",
        actualBehavior: "The session stopped.",
      },
      evidenceSelection: {
        includeSessionSummary: true,
        includeTranscriptExcerpts: false,
        includeToolFailures: false,
        includeCommandOutput: false,
        includeEnvironment: false,
        includeGitStatus: false,
        includeLogs: false,
        includeFileChangeSummary: false,
        includeDiagnosticFindings: false,
      },
      evidence: [],
    })).toThrow("sessionId is required");
  });

  it("fails closed when the created timestamp is not canonical ISO UTC", () => {
    expect(() => createFeedbackBundle({
      feedbackId: "feedback-2026-05-18-iso",
      createdAt: "05/18/2026",
      sessionId: "session-123",
      reporter: {
        mode: "quick",
        description: "Something went wrong.",
        actualBehavior: "The session stopped.",
      },
      evidenceSelection: {
        includeSessionSummary: true,
        includeTranscriptExcerpts: false,
        includeToolFailures: false,
        includeCommandOutput: false,
        includeEnvironment: false,
        includeGitStatus: false,
        includeLogs: false,
        includeFileChangeSummary: false,
        includeDiagnosticFindings: false,
      },
      evidence: [],
    })).toThrow("createdAt must be a canonical ISO UTC timestamp");
  });

  it("selects file-change summaries and diagnostic findings explicitly", () => {
    const bundle = createFeedbackBundle({
      feedbackId: "feedback-2026-05-18-selectors",
      createdAt: "2026-05-18T10:00:00.000Z",
      sessionId: "session-selectors",
      reporter: {
        mode: "diagnostic",
        description: "The repair needs context.",
        actualBehavior: "The session changed files without a useful summary.",
      },
      evidenceSelection: {
        includeSessionSummary: false,
        includeTranscriptExcerpts: false,
        includeToolFailures: false,
        includeCommandOutput: false,
        includeEnvironment: false,
        includeGitStatus: false,
        includeLogs: false,
        includeFileChangeSummary: true,
        includeDiagnosticFindings: true,
      },
      evidence: [
        {
          kind: "file-change-summary",
          title: "Files",
          content: "Changed packages/core/src/feedback/index.ts",
        },
        {
          kind: "diagnostic-finding",
          title: "Finding",
          content: "The bundle is local only.",
        },
      ],
    });

    expect(bundle.evidence.map((item) => item.kind)).toEqual([
      "file-change-summary",
      "diagnostic-finding",
    ]);
  });
});

describe("session feedback issue draft", () => {
  it("renders a maintainer issue draft from the redacted local bundle", () => {
    const bundle = createFeedbackBundle({
      feedbackId: "feedback-2026-05-18-003",
      createdAt: "2026-05-18T10:00:00.000Z",
      sessionId: "session-issue",
      reporter: {
        mode: "diagnostic",
        description: "The CLI crashed after reading ANTHROPIC_API_KEY=sk-ant-secret123.",
        expectedBehavior: "The CLI should report a recoverable provider error.",
        actualBehavior: "The process exited without a useful message.",
      },
      evidenceSelection: {
        includeSessionSummary: true,
        includeTranscriptExcerpts: false,
        includeToolFailures: true,
        includeCommandOutput: false,
        includeEnvironment: true,
        includeGitStatus: true,
        includeLogs: false,
        includeFileChangeSummary: false,
        includeDiagnosticFindings: false,
      },
      evidence: [
        {
          kind: "environment",
          title: "Runtime",
          content: "Windows, Bun 1.3",
        },
      ],
    });

    const issue = createFeedbackIssueDraft(bundle);

    expect(issue.markdown).toContain("# Feedback: feedback-2026-05-18-003");
    expect(issue.markdown).toContain("## Expected");
    expect(issue.markdown).toContain("## Actual");
    expect(issue.markdown).toContain("Windows, Bun 1.3");
    expect(issue.markdown).not.toContain("sk-ant-secret123");
    expect(issue.publication.allowed).toBe(false);
  });

  it("uses a longer markdown fence when evidence contains backticks", () => {
    const bundle = createFeedbackBundle({
      feedbackId: "feedback-2026-05-18-fence",
      createdAt: "2026-05-18T10:00:00.000Z",
      sessionId: "session-fence",
      reporter: {
        mode: "diagnostic",
        description: "Command output rendered incorrectly.",
        actualBehavior: "The issue draft broke markdown.",
      },
      evidenceSelection: {
        includeSessionSummary: false,
        includeTranscriptExcerpts: false,
        includeToolFailures: false,
        includeCommandOutput: true,
        includeEnvironment: false,
        includeGitStatus: false,
        includeLogs: false,
        includeFileChangeSummary: false,
        includeDiagnosticFindings: false,
      },
      evidence: [
        {
          kind: "command-output",
          title: "Markdown output",
          content: "before\n```text\ninside\n```\nafter",
        },
      ],
    });

    const issue = createFeedbackIssueDraft(bundle);

    expect(issue.markdown).toContain("````text");
    expect(issue.markdown).toContain("before\n```text\ninside\n```\nafter");
    expect(issue.markdown).toContain("\n````\n");
  });
});

describe("session feedback repair work item", () => {
  it("converts an explicitly approved feedback bundle into a governed repair work item", () => {
    const bundle = createFeedbackBundle({
      feedbackId: "feedback-2026-05-18-repair",
      createdAt: "2026-05-18T12:00:00.000Z",
      sessionId: "session-123",
      reporter: {
        mode: "maintainer",
        description: "Managed child cancellation did not update the GUI.",
        actualBehavior: "The GUI stayed active after cancellation.",
      },
      evidenceSelection: {
        includeSessionSummary: false,
        includeTranscriptExcerpts: false,
        includeToolFailures: false,
        includeCommandOutput: false,
        includeEnvironment: false,
        includeGitStatus: false,
        includeLogs: false,
        includeFileChangeSummary: false,
        includeDiagnosticFindings: true,
      },
      evidence: [{
        kind: "diagnostic-finding",
        title: "Cancellation event",
        content: "agent_invocation_cancelled missing from projection",
      }],
    });

    const workItemInput = createFeedbackRepairWorkItemInput({
      bundle,
      approval: {
        approved: true,
        approvedBy: "ricardo",
        approvedAt: "2026-05-18T12:05:00.000Z",
        resourceUris: ["kiln://feedback/feedback-2026-05-18-repair/approval"],
      },
      riskHypothesis: "Repair may touch shared managed-agent projection paths.",
      fileImpact: [
        "packages/runtime/src/gateway/operator-session-event-frame.ts",
        "packages/gateway-contracts/src/operator-cockpit-projection.ts",
      ],
      verificationCriteria: [
        "bun run --cwd packages/gateway-contracts test -- tests/operator-cockpit-projection.test.ts",
        "bun run typecheck",
      ],
      routeId: "codex-managed-coder",
      assignedAgentProfile: "coder",
      authorityProfile: "audited",
    });
    const store = new WorkItemStore({ now: () => "2026-05-18T12:06:00.000Z" });
    const item = store.upsert(workItemInput);

    expect(item).toMatchObject({
      id: "feedback:feedback-2026-05-18-repair:repair",
      status: "pending",
      workflowProfile: "feedback-repair",
      risk: "medium",
      surface: "session-feedback",
      assignedAgentProfile: "coder",
      routeId: "codex-managed-coder",
      authorityProfile: "audited",
      sourceFeedbackId: "feedback-2026-05-18-repair",
      feedbackRepair: {
        feedbackId: "feedback-2026-05-18-repair",
        sessionId: "session-123",
        bundleResourceUri: "kiln://feedback/feedback-2026-05-18-repair/bundle",
        approvedBy: "ricardo",
        approvedAt: "2026-05-18T12:05:00.000Z",
        approvalResourceUris: ["kiln://feedback/feedback-2026-05-18-repair/approval"],
        riskHypothesis: "Repair may touch shared managed-agent projection paths.",
        fileImpact: [
          "packages/runtime/src/gateway/operator-session-event-frame.ts",
          "packages/gateway-contracts/src/operator-cockpit-projection.ts",
        ],
        verificationCriteria: [
          "bun run --cwd packages/gateway-contracts test -- tests/operator-cockpit-projection.test.ts",
          "bun run typecheck",
        ],
      },
    });
    expect(item.expectedEvidence).toEqual([
      FEEDBACK_REPAIR_BUNDLE_EVIDENCE,
      FEEDBACK_REPAIR_APPROVAL_EVIDENCE,
      FEEDBACK_REPAIR_RISK_HYPOTHESIS_EVIDENCE,
      FEEDBACK_REPAIR_FILE_IMPACT_EVIDENCE,
      FEEDBACK_REPAIR_VERIFICATION_CRITERIA_EVIDENCE,
      "tests",
      "typecheck",
      "managed-agent-review",
      "residual-risk",
    ]);
    expect(item.providedEvidence).toEqual([
      FEEDBACK_REPAIR_BUNDLE_EVIDENCE,
      FEEDBACK_REPAIR_APPROVAL_EVIDENCE,
      FEEDBACK_REPAIR_RISK_HYPOTHESIS_EVIDENCE,
      FEEDBACK_REPAIR_FILE_IMPACT_EVIDENCE,
      FEEDBACK_REPAIR_VERIFICATION_CRITERIA_EVIDENCE,
    ]);
    expect(item.verificationGates).toEqual([
      "bun run --cwd packages/gateway-contracts test -- tests/operator-cockpit-projection.test.ts",
      "bun run typecheck",
      "managed-agent review",
    ]);
  });

  it("redacts repair metadata before it is attached to work governance", () => {
    const bundle = createFeedbackBundle({
      feedbackId: "feedback-2026-05-18-redacted-repair",
      createdAt: "2026-05-18T12:00:00.000Z",
      sessionId: "session-123",
      reporter: {
        mode: "maintainer",
        description: "The command leaked a secret.",
        actualBehavior: "Output included a token.",
      },
      evidenceSelection: {
        includeSessionSummary: false,
        includeTranscriptExcerpts: false,
        includeToolFailures: false,
        includeCommandOutput: false,
        includeEnvironment: false,
        includeGitStatus: false,
        includeLogs: false,
        includeFileChangeSummary: false,
        includeDiagnosticFindings: false,
      },
      evidence: [],
    });

    const workItemInput = createFeedbackRepairWorkItemInput({
      bundle,
      approval: {
        approved: true,
        approvedBy: "ricardo@example.com",
        approvedAt: "2026-05-18T12:05:00.000Z",
        resourceUris: ["kiln://feedback/feedback-2026-05-18-redacted-repair/approval"],
      },
      riskHypothesis: "Do not leak sk-ant-secret123 in repair notes.",
      fileImpact: ["packages/core/src/feedback/index.ts"],
      verificationCriteria: ["Assert token sk-ant-secret123 is absent"],
    });

    expect(JSON.stringify(workItemInput)).not.toContain("sk-ant-secret123");
    expect(JSON.stringify(workItemInput)).not.toContain("ricardo@example.com");
    expect(workItemInput.feedbackRepair?.riskHypothesis).toContain("[REDACTED:credential]");
    expect(workItemInput.feedbackRepair?.approvedBy).toContain("[REDACTED:email]");
    expect(workItemInput.feedbackRepair?.verificationCriteria[0]).toContain("[REDACTED:credential]");
  });

  it("fails closed without explicit approval and repair criteria", () => {
    const bundle = createFeedbackBundle({
      feedbackId: "feedback-2026-05-18-blocked-repair",
      createdAt: "2026-05-18T12:00:00.000Z",
      sessionId: "session-123",
      reporter: {
        mode: "maintainer",
        description: "The repair should be governed.",
        actualBehavior: "No work item exists.",
      },
      evidenceSelection: {
        includeSessionSummary: false,
        includeTranscriptExcerpts: false,
        includeToolFailures: false,
        includeCommandOutput: false,
        includeEnvironment: false,
        includeGitStatus: false,
        includeLogs: false,
        includeFileChangeSummary: false,
        includeDiagnosticFindings: false,
      },
      evidence: [],
    });

    expect(() => createFeedbackRepairWorkItemInput({
      bundle,
      approval: {
        approved: false,
        approvedBy: "ricardo",
        approvedAt: "2026-05-18T12:05:00.000Z",
        resourceUris: ["kiln://feedback/feedback-2026-05-18-blocked-repair/approval"],
      },
      riskHypothesis: "Missing approval should block.",
      fileImpact: ["packages/core/src/feedback/index.ts"],
      verificationCriteria: ["bun run --cwd packages/core test -- tests/feedback/session-feedback.test.ts"],
    } as never)).toThrow("Feedback repair work item requires explicit approval.");

    expect(() => createFeedbackRepairWorkItemInput({
      bundle,
      approval: {
        approved: true,
        approvedBy: "ricardo",
        approvedAt: "2026-05-18T12:05:00.000Z",
        resourceUris: ["kiln://feedback/feedback-2026-05-18-blocked-repair/approval"],
      },
      riskHypothesis: "Missing impact should block.",
      fileImpact: [],
      verificationCriteria: ["bun run --cwd packages/core test -- tests/feedback/session-feedback.test.ts"],
    })).toThrow("Feedback repair work item requires file impact.");

    expect(() => createFeedbackRepairWorkItemInput({
      bundle,
      approval: {
        approved: true,
        approvedBy: "ricardo",
        approvedAt: "2026-05-18T12:05:00.000Z",
        resourceUris: ["kiln://feedback/feedback-2026-05-18-blocked-repair/approval"],
      },
      riskHypothesis: "Missing verification should block.",
      fileImpact: ["packages/core/src/feedback/index.ts"],
      verificationCriteria: [],
    })).toThrow("Feedback repair work item requires verification criteria.");
  });

  it("fails closed for unsafe approval evidence and non-canonical approval timestamps", () => {
    const bundle = feedbackRepairBundle("feedback-2026-05-18-unsafe-approval");

    expect(() => createFeedbackRepairWorkItemInput({
      bundle,
      approval: {
        approved: true,
        approvedBy: "ricardo",
        approvedAt: "2026-05-18T12:05:00Z",
        resourceUris: ["kiln://feedback/feedback-2026-05-18-unsafe-approval/approval"],
      },
      riskHypothesis: "Approval timestamp must be canonical.",
      fileImpact: ["packages/core/src/feedback/index.ts"],
      verificationCriteria: ["bun run --cwd packages/core test -- tests/feedback/session-feedback.test.ts"],
    })).toThrow("Feedback repair work item approval timestamp is required.");

    expect(() => createFeedbackRepairWorkItemInput({
      bundle,
      approval: {
        approved: true,
        approvedBy: "ricardo",
        approvedAt: "2026-05-18T12:05:00.000Z",
        resourceUris: ["file:///C:/Users/Ricardo/secrets/approval.txt"],
      },
      riskHypothesis: "Approval evidence must stay inside local feedback resources.",
      fileImpact: ["packages/core/src/feedback/index.ts"],
      verificationCriteria: ["bun run --cwd packages/core test -- tests/feedback/session-feedback.test.ts"],
    })).toThrow("Feedback repair work item approval evidence must be the local feedback resource URI.");
  });

  it("uses lossless repair ids and rejects mismatched repair provenance", () => {
    const slashBundle = feedbackRepairBundle("feedback/a/b");
    const dashBundle = feedbackRepairBundle("feedback/a-b");
    const slashItemInput = createFeedbackRepairWorkItemInput({
      bundle: slashBundle,
      approval: feedbackRepairApproval("feedback/a/b"),
      riskHypothesis: "Slash ids must not collide with dash ids.",
      fileImpact: ["packages/core/src/work-governance/feedback-repair.ts"],
      verificationCriteria: ["bun run --cwd packages/core test -- tests/feedback/session-feedback.test.ts"],
    });
    const dashItemInput = createFeedbackRepairWorkItemInput({
      bundle: dashBundle,
      approval: feedbackRepairApproval("feedback/a-b"),
      riskHypothesis: "Dash ids must remain distinct.",
      fileImpact: ["packages/core/src/work-governance/feedback-repair.ts"],
      verificationCriteria: ["bun run --cwd packages/core test -- tests/feedback/session-feedback.test.ts"],
    });

    expect(slashItemInput.id).toBe("feedback:feedback%2Fa%2Fb:repair");
    expect(dashItemInput.id).toBe("feedback:feedback%2Fa-b:repair");
    expect(slashItemInput.id).not.toBe(dashItemInput.id);

    const store = new WorkItemStore({ now: () => "2026-05-18T12:06:00.000Z" });
    expect(() => store.upsert({
      ...slashItemInput,
      sourceFeedbackId: undefined,
    })).toThrow("Feedback repair work item source feedback id is required.");
    expect(() => store.upsert({
      ...slashItemInput,
      sourceFeedbackId: "different-feedback-id",
    })).toThrow("Feedback repair work item source feedback id must match repair metadata.");
  });

  it("redacts repair metadata again during store normalization", () => {
    const bundle = feedbackRepairBundle("feedback-2026-05-18-replay-redaction");
    const workItemInput = createFeedbackRepairWorkItemInput({
      bundle,
      approval: feedbackRepairApproval("feedback-2026-05-18-replay-redaction"),
      riskHypothesis: "Initial repair metadata is clean.",
      fileImpact: ["packages/core/src/work-governance/work-item.ts"],
      verificationCriteria: ["managed-agent review"],
    });
    const tampered = {
      ...workItemInput,
      feedbackRepair: {
        ...workItemInput.feedbackRepair,
        approvedBy: "Ricardo +1 (555) 123-4567",
        riskHypothesis: "Call +1 555 123 4567 and use sk-ant-secret123",
        verificationCriteria: ["Verify +1 555 123 4567 is absent"],
      },
    };
    const store = new WorkItemStore({ now: () => "2026-05-18T12:06:00.000Z" });
    const item = store.upsert(tampered);

    expect(JSON.stringify(item.feedbackRepair)).not.toContain("+1");
    expect(JSON.stringify(item.feedbackRepair)).not.toContain("555");
    expect(JSON.stringify(item.feedbackRepair)).not.toContain("sk-ant-secret123");
    expect(item.feedbackRepair?.approvedBy).toContain("[REDACTED:phone]");
    expect(item.feedbackRepair?.riskHypothesis).toContain("[REDACTED:credential]");
    expect(item.feedbackRepair?.riskHypothesis).toContain("[REDACTED:phone]");
  });

  it("preserves repair metadata through completion and replay normalization", () => {
    const bundle = feedbackRepairBundle("feedback-2026-05-18-replay-repair");
    const workItemInput = createFeedbackRepairWorkItemInput({
      bundle,
      approval: feedbackRepairApproval("feedback-2026-05-18-replay-repair"),
      riskHypothesis: "Replay should keep repair provenance stable.",
      fileImpact: ["packages/core/src/work-governance/work-item.ts"],
      verificationCriteria: ["bun run typecheck", "managed-agent review"],
    });
    const store = new WorkItemStore({ now: () => "2026-05-18T12:06:00.000Z" });
    const item = store.upsert(workItemInput);
    const blocked = store.complete({
      id: item.id,
      providedEvidence: ["tests", "typecheck", "managed-agent-review", "residual-risk"],
      verificationGateResults: [{
        gate: "managed-agent review",
        status: "passed",
        completedAt: "2026-05-18T12:07:00.000Z",
      }],
    });
    expect(blocked?.item.status).toBe("blocked");
    expect(blocked?.missingVerificationGates).toEqual(["bun run typecheck"]);

    const completed = store.complete({
      id: item.id,
      providedEvidence: ["tests", "typecheck", "managed-agent-review", "residual-risk"],
      residualRisk: "No remaining repair-specific risk after tests, typecheck, and review passed.",
      verificationGateResults: [{
        gate: "bun run typecheck",
        status: "passed",
        completedAt: "2026-05-18T12:08:00.000Z",
      }, {
        gate: "managed-agent review",
        status: "passed",
        completedAt: "2026-05-18T12:08:00.000Z",
      }],
    });
    const replayStore = new WorkItemStore({ now: () => "2026-05-18T12:08:00.000Z" });
    const replayed = replayStore.upsert(completed?.item ?? item);

    expect(completed?.item.status).toBe("completed");
    expect(replayed.sourceFeedbackId).toBe("feedback-2026-05-18-replay-repair");
    expect(replayed.feedbackRepair).toEqual(completed?.item.feedbackRepair);
  });
});

function feedbackRepairBundle(feedbackId: string) {
  return createFeedbackBundle({
    feedbackId,
    createdAt: "2026-05-18T12:00:00.000Z",
    sessionId: "session-123",
    reporter: {
      mode: "maintainer",
      description: "The repair should be governed.",
      actualBehavior: "No governed repair work item exists.",
    },
    evidenceSelection: {
      includeSessionSummary: false,
      includeTranscriptExcerpts: false,
      includeToolFailures: false,
      includeCommandOutput: false,
      includeEnvironment: false,
      includeGitStatus: false,
      includeLogs: false,
      includeFileChangeSummary: false,
      includeDiagnosticFindings: false,
    },
    evidence: [],
  });
}

function feedbackRepairApproval(feedbackId: string) {
  return {
    approved: true,
    approvedBy: "ricardo",
    approvedAt: "2026-05-18T12:05:00.000Z",
    resourceUris: [`kiln://feedback/${encodeURIComponent(feedbackId)}/approval`],
  } as const;
}
