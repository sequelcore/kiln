import type { StateCreator } from "zustand";
import { shouldApplySessionScopedFrame } from "./session-continuity-gate.js";
import { browserSessionStateFromSnapshot } from "./interactive-use-projection.js";
import type { InteractiveUseActions, SessionStore } from "./session-store-state.js";

/**
 * Interactive-use (browser/computer tool) evidence: the latest snapshot, the
 * derived browser-session view, and the live viewport frame.
 */

export const createInteractiveUseSlice: StateCreator<
  SessionStore,
  [],
  [],
  InteractiveUseActions
> = (set, get) => ({
  onInteractiveUseUpdated: (frame) => {
    const state = get();
    const kilnSessionId = frame.snapshot.kilnSessionId;
    if (kilnSessionId && !shouldApplySessionScopedFrame(state, kilnSessionId)) {
      return;
    }
    set({
      interactiveUseSnapshot: frame.snapshot,
      browserSessionState: frame.browserSession ?? browserSessionStateFromSnapshot(frame.snapshot),
    });
  },

  onBrowserSessionUpdated: (frame) => {
    const state = get();
    const kilnSessionId = frame.browserSession.kilnSessionId;
    if (kilnSessionId && !shouldApplySessionScopedFrame(state, kilnSessionId)) {
      return;
    }
    const browserSessionState = frame.browserSession.ownership === "released" || frame.browserSession.stream.status === "ended"
      ? null
      : frame.browserSession;
    const currentLiveViewportFrame = state.browserLiveViewportFrame;
    const browserLiveViewportFrame = browserSessionState
      && currentLiveViewportFrame
      && currentLiveViewportFrame.sessionId === browserSessionState.sessionId
      ? currentLiveViewportFrame
      : null;
    set({ browserSessionState, browserLiveViewportFrame });
  },

  onBrowserLiveViewportFrame: (frame) => {
    const state = get();
    if (frame.kilnSessionId && !shouldApplySessionScopedFrame(state, frame.kilnSessionId)) {
      return;
    }
    set({ browserLiveViewportFrame: frame });
  },
});
