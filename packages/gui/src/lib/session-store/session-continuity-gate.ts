import {
  deriveSessionContinuity,
  shouldApplySessionScopedFrame as shouldApplyContinuityFrame,
} from "../session-continuity.js";
import type { SessionStoreState } from "./session-store-state.js";

/**
 * Decides whether a live inbound frame (event, delta, activity, browser
 * snapshot) belongs to the session currently displayed, given continuity
 * state (live/selected/continuation session ids and detachment). Shared
 * across every slice that reacts to inbound frames; no single slice owns it.
 * Pure, no store dependency.
 */

export function deriveContinuityFromState(state: SessionStoreState) {
  return deriveSessionContinuity({
    status: state.status,
    selectedSessionId: state.selectedSessionId,
    liveSessionId: state.liveSessionId,
    continuationTargetId: state.continuationTargetId,
    messageCount: state.messages.length,
    sessionEventCount: state.sessionEvents.length,
    detachedSessionIds: state.detachedSessionIds,
  });
}

export function shouldApplySessionScopedFrame(
  state: SessionStoreState,
  kilnSessionId: string,
): boolean {
  return shouldApplyContinuityFrame(deriveContinuityFromState(state), kilnSessionId);
}
