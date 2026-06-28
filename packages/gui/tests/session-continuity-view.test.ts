import { describe, expect, it } from "vitest";
import { deriveSessionContinuity } from "../src/lib/session-continuity.js";
import {
  buildComposerContinuityHint,
  buildSessionRowBadges,
} from "../src/lib/session-continuity-view.js";

describe("session continuity view", () => {
  it("describes selected historical sessions as active continuations", () => {
    const hint = buildComposerContinuityHint(deriveSessionContinuity({
      status: "ready",
      selectedSessionId: "session-preview",
      liveSessionId: null,
      continuationTargetId: null,
      messageCount: 4,
      sessionEventCount: 2,
      detachedSessionIds: [],
    }));

    expect(hint).toMatchObject({
      label: "Continue chat",
      description: "Next message continues selected session",
      tone: "accent",
      prominence: "routine",
    });
  });

  it("describes explicit continuation targets", () => {
    const hint = buildComposerContinuityHint(deriveSessionContinuity({
      status: "ready",
      selectedSessionId: "session-preview",
      liveSessionId: null,
      continuationTargetId: "session-resume",
      messageCount: 4,
      sessionEventCount: 2,
      detachedSessionIds: [],
    }));

    expect(hint).toMatchObject({
      label: "Continue chat",
      description: "Next message continues selected session",
      tone: "accent",
      prominence: "routine",
    });
  });

  it("describes fresh, live, running, and detached composer states", () => {
    expect(buildComposerContinuityHint(deriveSessionContinuity({
      status: "ready",
      selectedSessionId: null,
      liveSessionId: null,
      continuationTargetId: null,
      messageCount: 0,
      sessionEventCount: 0,
      detachedSessionIds: [],
    }))).toMatchObject({ label: "New session", prominence: "routine" });

    expect(buildComposerContinuityHint(deriveSessionContinuity({
      status: "ready",
      selectedSessionId: null,
      liveSessionId: "session-live",
      continuationTargetId: null,
      messageCount: 2,
      sessionEventCount: 1,
      detachedSessionIds: [],
    }))).toMatchObject({ label: "Live", prominence: "routine" });

    expect(buildComposerContinuityHint(deriveSessionContinuity({
      status: "running",
      selectedSessionId: null,
      liveSessionId: "session-live",
      continuationTargetId: null,
      messageCount: 2,
      sessionEventCount: 1,
      detachedSessionIds: [],
    }))).toMatchObject({ label: "Running", prominence: "exceptional" });

    expect(buildComposerContinuityHint(deriveSessionContinuity({
      status: "running",
      selectedSessionId: null,
      liveSessionId: "session-live",
      continuationTargetId: null,
      messageCount: 2,
      sessionEventCount: 1,
      detachedSessionIds: ["session-live"],
    }))).toMatchObject({ label: "Detached", prominence: "exceptional" });
  });

  it("projects row badges without overloading active state", () => {
    const continuity = deriveSessionContinuity({
      status: "running",
      selectedSessionId: "session-preview",
      liveSessionId: "session-live",
      continuationTargetId: "session-resume",
      messageCount: 2,
      sessionEventCount: 1,
      detachedSessionIds: ["session-detached"],
    });

    expect(buildSessionRowBadges({ sessionId: "session-preview", continuity })).toEqual([
      { label: "Continue", tone: "accent" },
    ]);
    expect(buildSessionRowBadges({ sessionId: "session-resume", continuity })).toEqual([
      { label: "Continue", tone: "accent" },
    ]);
    expect(buildSessionRowBadges({ sessionId: "session-live", continuity })).toEqual([
      { label: "Running", tone: "info" },
    ]);
    expect(buildSessionRowBadges({ sessionId: "session-detached", continuity })).toEqual([
      { label: "Detached", tone: "warning" },
    ]);
  });

  it("keeps failed and cancelled row outcomes explicit", () => {
    const continuity = deriveSessionContinuity({
      status: "ready",
      selectedSessionId: null,
      liveSessionId: null,
      continuationTargetId: null,
      messageCount: 0,
      sessionEventCount: 0,
      detachedSessionIds: [],
    });

    expect(buildSessionRowBadges({
      sessionId: "session-failed",
      continuity,
      outcome: "failed",
    })).toEqual([{ label: "Failed", tone: "danger" }]);
    expect(buildSessionRowBadges({
      sessionId: "session-cancelled",
      continuity,
      outcome: "cancelled",
    })).toEqual([{ label: "Cancelled", tone: "muted" }]);
  });
});
