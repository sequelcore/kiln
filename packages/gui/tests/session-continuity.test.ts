import { describe, expect, it } from "vitest";
import {
  deriveSessionContinuity,
  shouldApplySessionScopedFrame,
} from "../src/lib/session-continuity.js";

describe("session continuity", () => {
  it("treats a selected historical session as the active continuation target", () => {
    const continuity = deriveSessionContinuity({
      status: "ready",
      selectedSessionId: "historical-session",
      liveSessionId: null,
      continuationTargetId: null,
      messageCount: 3,
      sessionEventCount: 4,
      detachedSessionIds: [],
    });

    expect(continuity.mode).toBe("continue");
    expect(continuity.outboundContinuationSessionId).toBe("historical-session");
    expect(continuity.outboundSessionIntent).toBeUndefined();
    expect(continuity.shouldResetVisibleHistoryOnSubmit).toBe(false);
  });

  it("continues only the explicit continuation target", () => {
    const continuity = deriveSessionContinuity({
      status: "ready",
      selectedSessionId: "historical-session",
      liveSessionId: null,
      continuationTargetId: "resume-session",
      messageCount: 3,
      sessionEventCount: 4,
      detachedSessionIds: [],
    });

    expect(continuity.mode).toBe("continue");
    expect(continuity.outboundContinuationSessionId).toBe("resume-session");
    expect(continuity.outboundSessionIntent).toBeUndefined();
    expect(continuity.shouldResetVisibleHistoryOnSubmit).toBe(false);
  });

  it("marks an empty no-target turn as a fresh boundary", () => {
    const continuity = deriveSessionContinuity({
      status: "ready",
      selectedSessionId: null,
      liveSessionId: null,
      continuationTargetId: null,
      messageCount: 0,
      sessionEventCount: 0,
      detachedSessionIds: [],
    });

    expect(continuity.mode).toBe("fresh");
    expect(continuity.outboundContinuationSessionId).toBeUndefined();
    expect(continuity.outboundSessionIntent).toBe("fresh");
  });

  it("keeps follow-up turns inside the active conversation", () => {
    const continuity = deriveSessionContinuity({
      status: "ready",
      selectedSessionId: null,
      liveSessionId: "live-session",
      continuationTargetId: null,
      messageCount: 2,
      sessionEventCount: 1,
      detachedSessionIds: [],
    });

    expect(continuity.mode).toBe("live");
    expect(continuity.outboundContinuationSessionId).toBeUndefined();
    expect(continuity.outboundSessionIntent).toBeUndefined();
  });

  it("keeps detached sessions from receiving scoped frames", () => {
    const continuity = deriveSessionContinuity({
      status: "ready",
      selectedSessionId: null,
      liveSessionId: null,
      continuationTargetId: "detached-session",
      messageCount: 0,
      sessionEventCount: 0,
      detachedSessionIds: ["detached-session"],
    });

    expect(shouldApplySessionScopedFrame(continuity, "detached-session")).toBe(false);
  });

  it("routes scoped frames by live, selected continuation, explicit continuation, and idle default order", () => {
    expect(shouldApplySessionScopedFrame(deriveSessionContinuity({
      status: "running",
      selectedSessionId: "preview-session",
      liveSessionId: "live-session",
      continuationTargetId: "resume-session",
      messageCount: 1,
      sessionEventCount: 1,
      detachedSessionIds: [],
    }), "live-session")).toBe(true);

    expect(shouldApplySessionScopedFrame(deriveSessionContinuity({
      status: "ready",
      selectedSessionId: "preview-session",
      liveSessionId: null,
      continuationTargetId: "resume-session",
      messageCount: 1,
      sessionEventCount: 1,
      detachedSessionIds: [],
    }), "preview-session")).toBe(true);

    expect(shouldApplySessionScopedFrame(deriveSessionContinuity({
      status: "ready",
      selectedSessionId: null,
      liveSessionId: null,
      continuationTargetId: "resume-session",
      messageCount: 1,
      sessionEventCount: 1,
      detachedSessionIds: [],
    }), "resume-session")).toBe(true);

    expect(shouldApplySessionScopedFrame(deriveSessionContinuity({
      status: "idle",
      selectedSessionId: null,
      liveSessionId: null,
      continuationTargetId: null,
      messageCount: 0,
      sessionEventCount: 0,
      detachedSessionIds: [],
    }), "any-session")).toBe(true);
  });
});
