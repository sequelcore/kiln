import { describe, expect, it } from "vitest";
import {
  SessionFeedbackPreviewProjectionSchema,
} from "../src/session-feedback-projection.js";
import type {
  SessionFeedbackPreviewProjection,
} from "../src/session-feedback-projection.js";

describe("session feedback preview projection", () => {
  it("accepts a local-only redacted feedback preview for operator surfaces", () => {
    const projection = SessionFeedbackPreviewProjectionSchema.parse({
      surface: "gui",
      feedbackId: "feedback-2026-05-18T10-00-00-000Z",
      sessionId: "session-123",
      createdAt: "2026-05-18T10:00:00.000Z",
      reporter: {
        mode: "diagnostic",
        description: "The command printed [REDACTED:credential].",
        expectedBehavior: "The command should redact secrets.",
        actualBehavior: "A provider key appeared in output.",
      },
      evidence: [
        {
          kind: "git-status",
          title: "CLI git status",
          selected: true,
          redactionApplied: false,
          preview: " M packages/cli/src/commands/feedback.ts",
        },
      ],
      localArtifacts: {
        bundlePath: ".kiln/feedback/feedback-2026-05-18T10-00-00-000Z.json",
        issueDraftPath: ".kiln/feedback/feedback-2026-05-18T10-00-00-000Z.md",
      },
      publication: {
        status: "local-draft",
        allowed: false,
        reason: "local-only-default",
      },
      issueDraft: {
        title: "Feedback: feedback-2026-05-18T10-00-00-000Z",
        markdownPreview: "# Feedback: feedback-2026-05-18T10-00-00-000Z",
      },
    }) satisfies SessionFeedbackPreviewProjection;

    expect(projection.publication.allowed).toBe(false);
    expect(projection.evidence[0]?.selected).toBe(true);
    expect(projection.reporter.description).toContain("[REDACTED:credential]");
  });

  it("rejects publication-enabled feedback preview state", () => {
    expect(() => {
      SessionFeedbackPreviewProjectionSchema.parse({
        surface: "gui",
        feedbackId: "feedback-1",
        sessionId: "session-1",
        createdAt: "2026-05-18T10:00:00.000Z",
        reporter: {
          mode: "quick",
          description: "Something failed.",
          actualBehavior: "The command failed.",
        },
        evidence: [],
        publication: {
          status: "ready-to-publish",
          allowed: true,
          reason: "Publish now.",
        },
      });
    }).toThrow();
  });

  it("rejects publication reasons outside the core feedback gate codes", () => {
    expect(() => {
      SessionFeedbackPreviewProjectionSchema.parse({
        surface: "gui",
        feedbackId: "feedback-1",
        sessionId: "session-1",
        createdAt: "2026-05-18T10:00:00.000Z",
        reporter: {
          mode: "quick",
          description: "Something failed.",
          actualBehavior: "The command failed.",
        },
        evidence: [],
        publication: {
          status: "local-draft",
          allowed: false,
          reason: "Publication requires explicit approval.",
        },
      });
    }).toThrow();
  });

  it("rejects non-canonical createdAt timestamps", () => {
    expect(() => {
      SessionFeedbackPreviewProjectionSchema.parse({
        surface: "gui",
        feedbackId: "feedback-1",
        sessionId: "session-1",
        createdAt: "2026-05-18",
        reporter: {
          mode: "quick",
          description: "Something failed.",
          actualBehavior: "The command failed.",
        },
        evidence: [],
        publication: {
          status: "local-draft",
          allowed: false,
          reason: "local-only-default",
        },
      });
    }).toThrow();
  });

  it("accepts runtime-truncated evidence previews", () => {
    const runtimeTruncatedPreview = `${"x".repeat(3_976)}\n[truncated for feedback]`;
    const projection = SessionFeedbackPreviewProjectionSchema.parse({
      surface: "gui",
      feedbackId: "feedback-1",
      sessionId: "session-1",
      createdAt: "2026-05-18T10:00:00.000Z",
      reporter: {
        mode: "diagnostic",
        description: "Something failed.",
        actualBehavior: "The command failed.",
      },
      evidence: [
        {
          kind: "command-output",
          title: "Runtime command output",
          selected: true,
          redactionApplied: false,
          preview: runtimeTruncatedPreview,
        },
      ],
      publication: {
        status: "local-draft",
        allowed: false,
        reason: "local-only-default",
      },
    });

    expect(projection.evidence[0]?.preview?.length).toBe(4_001);
  });
});
