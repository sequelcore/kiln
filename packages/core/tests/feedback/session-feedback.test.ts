import { describe, expect, it } from "vitest";
import {
  createFeedbackBundle,
  createFeedbackIssueDraft,
  redactFeedbackText,
} from "../../src/feedback/index.js";

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
