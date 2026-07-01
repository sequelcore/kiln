import { describe, expect, it } from "vitest";
import { createNativeSessionFeedbackProjection } from "../src/shared/native-session-feedback.js";

describe("native session feedback projection", () => {
  it("wraps shared feedback preview state without adding native-owned publication policy", () => {
    const projection = createNativeSessionFeedbackProjection({
      surface: "native",
      feedbackId: "feedback-native-1",
      sessionId: "session-1",
      createdAt: "2026-05-18T10:00:00.000Z",
      reporter: {
        mode: "diagnostic",
        description: "Native preview contains [REDACTED:credential].",
        actualBehavior: "The session failed.",
      },
      evidence: [],
      publication: {
        status: "local-draft",
        allowed: false,
        reason: "local-only-default",
      },
    });

    expect(projection.kind).toBe("session-feedback-preview");
    expect(projection.preview.surface).toBe("native");
    expect(projection.preview.publication.allowed).toBe(false);
  });

  it("rejects feedback previews for other surfaces", () => {
    expect(() => createNativeSessionFeedbackProjection({
      surface: "gui",
      feedbackId: "feedback-native-wrong-surface",
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
    })).toThrow("Native feedback projection requires surface 'native'.");
  });
});
