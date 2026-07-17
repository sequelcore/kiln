import { describe, expect, it } from "vitest";
import { formatTuiSessionFeedbackPreview } from "../src/session-feedback-projection.js";

describe("TUI session feedback projection", () => {
  it("formats the shared local feedback preview without owning feedback semantics", () => {
    const lines = formatTuiSessionFeedbackPreview({
      surface: "tui",
      feedbackId: "feedback-tui-1",
      sessionId: "session-1",
      createdAt: "2026-05-18T10:00:00.000Z",
      reporter: {
        mode: "maintainer",
        description: "Output included [REDACTED:credential].",
        actualBehavior: "A provider key appeared.",
      },
      evidence: [{
        kind: "tool-failure",
        title: "Tool failure",
        selected: true,
        redactionApplied: true,
        preview: "provider returned [REDACTED:credential]",
      }],
      publication: {
        status: "local-draft",
        allowed: false,
        reason: "requires-explicit-approval",
      },
    });

    expect(lines).toContain("feedback feedback-tui-1 local-draft publication:disabled");
    expect(lines).toContain("report maintainer: Output included [REDACTED:credential].");
    expect(lines).toContain("evidence selected 1/1 redacted 1");
  });

  it("rejects publication-enabled projection payloads through the shared contract", () => {
    expect(() => formatTuiSessionFeedbackPreview({
      surface: "tui",
      feedbackId: "feedback-tui-blocked",
      sessionId: "session-1",
      createdAt: "2026-05-18T10:00:00.000Z",
      reporter: {
        mode: "quick",
        description: "Unsafe.",
        actualBehavior: "Unsafe.",
      },
      evidence: [],
      publication: {
        status: "local-draft",
        allowed: true,
        reason: "local-only-default",
      },
    })).toThrow();
  });
});
