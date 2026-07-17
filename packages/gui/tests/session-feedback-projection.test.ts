import { describe, expect, it } from "vitest";
import { parseGuiSessionFeedbackPreview } from "../src/lib/session-feedback-projection.js";

describe("GUI session feedback projection", () => {
  it("accepts only contract-backed redacted local feedback previews for the GUI surface", () => {
    const preview = parseGuiSessionFeedbackPreview({
      surface: "gui",
      feedbackId: "feedback-gui-1",
      sessionId: "session-1",
      createdAt: "2026-05-18T10:00:00.000Z",
      reporter: {
        mode: "diagnostic",
        description: "Provider key [REDACTED:credential] appeared in output.",
        actualBehavior: "The command failed.",
      },
      evidence: [{
        kind: "command-output",
        title: "Command output",
        selected: true,
        redactionApplied: true,
        preview: "Authorization: Bearer [REDACTED:credential]",
      }],
      publication: {
        status: "local-draft",
        allowed: false,
        reason: "local-only-default",
      },
    });

    expect(preview.feedbackId).toBe("feedback-gui-1");
    expect(preview.publication.allowed).toBe(false);
    expect(preview.evidence[0]?.redactionApplied).toBe(true);
  });

  it("rejects non-GUI or publication-enabled feedback projection state", () => {
    expect(() => parseGuiSessionFeedbackPreview({
      surface: "tui",
      feedbackId: "feedback-gui-wrong-surface",
      sessionId: "session-1",
      createdAt: "2026-05-18T10:00:00.000Z",
      reporter: {
        mode: "quick",
        description: "Wrong surface.",
        actualBehavior: "Wrong surface.",
      },
      evidence: [],
      publication: {
        status: "local-draft",
        allowed: false,
        reason: "local-only-default",
      },
    })).toThrow("GUI feedback projection requires surface 'gui'.");
  });
});
