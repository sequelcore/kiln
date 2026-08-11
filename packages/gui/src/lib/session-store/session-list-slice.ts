import type { OperatorSessionSummary } from "@kilnai/gateway-contracts";
import type { StateCreator } from "zustand";
import { clearStoredContinuationTarget } from "./session-store-persistence.js";
import { canonicalSessionEvents } from "./session-event-projection.js";
import { mapSessionDetailToLoadedState } from "./session-detail-replay.js";
import type { SessionListActions, SessionStore } from "./session-store-state.js";

/**
 * Session picker list, selecting/loading a session's persisted detail, and
 * the continuation target used to resume a session on the next submit.
 */

function areSessionSummariesEqual(
  current: readonly OperatorSessionSummary[],
  next: readonly OperatorSessionSummary[],
): boolean {
  if (current === next) {
    return true;
  }
  if (current.length !== next.length) {
    return false;
  }
  for (let index = 0; index < current.length; index += 1) {
    if (JSON.stringify(current[index]) !== JSON.stringify(next[index])) {
      return false;
    }
  }
  return true;
}

export const createSessionListSlice: StateCreator<
  SessionStore,
  [],
  [],
  SessionListActions
> = (set, get) => ({
  setSessionList: (sessions) => {
    const state = get();
    const selected = state.selectedSessionId;
    const selectedStillExists = selected ? sessions.some((session) => session.sessionId === selected) : false;
    const selectedWasRemoved = selected !== null && !selectedStillExists;
    const nextSelectedSessionId = selectedStillExists ? selected : null;
    const nextContinuationTargetId = selectedStillExists
      ? state.continuationTargetId
      : state.continuationTargetId === selected ? null : state.continuationTargetId;
    if (
      state.selectedSessionId === nextSelectedSessionId
      && state.continuationTargetId === nextContinuationTargetId
      && areSessionSummariesEqual(state.sessionList, sessions)
    ) {
      return;
    }
    if (selectedWasRemoved) {
      clearStoredContinuationTarget();
    }
    set({
      sessionList: sessions,
      selectedSessionId: nextSelectedSessionId,
      continuationTargetId: nextContinuationTargetId,
      ...(selectedWasRemoved ? {
        messages: [],
        timelineEntries: [],
        sessionEvents: [],
        currentAssistant: null,
        activity: null,
        activityPhase: "idle" as const,
        interactiveUseSnapshot: null,
        browserSessionState: null,
        errorBanner: null,
        sessionCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        turnCounter: 0,
        currentTurnTrackedInputTokens: 0,
        currentTurnTrackedOutputTokens: 0,
        routedProvider: null,
        routedModel: null,
        respondingProvider: null,
        respondingModel: null,
        contextUsage: undefined,
        authorityStatus: null,
        browserLiveViewportFrame: null,
        browserOperatorInputAck: null,
      } : {}),
    });
  },

  setSelectedSessionId: (sessionId) => {
    clearStoredContinuationTarget();
    set({
      selectedSessionId: sessionId,
      liveSessionId: null,
      continuationTargetId: sessionId,
      messages: [],
      timelineEntries: [],
      sessionEvents: [],
      currentAssistant: null,
      activity: null,
      activityPhase: "idle",
      interactiveUseSnapshot: null,
      browserSessionState: null,
      errorBanner: null,
      sessionCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
      respondingProvider: null,
      respondingModel: null,
    });
  },

  viewSessionDetail: (detail) => {
    const sessionEvents = canonicalSessionEvents(detail.events);
    const loaded = mapSessionDetailToLoadedState({ ...detail, events: sessionEvents });
    clearStoredContinuationTarget();
    set({
      selectedSessionId: detail.id,
      liveSessionId: null,
      continuationTargetId: detail.id,
      messages: loaded.messages,
      timelineEntries: loaded.timelineEntries,
      sessionEvents,
      currentAssistant: null,
      status: "ready",
      activity: null,
      activityPhase: "idle",
      errorBanner: null,
      sessionCostUsd: loaded.sessionCostUsd,
      inputTokens: loaded.inputTokens,
      outputTokens: loaded.outputTokens,
      turnCounter: loaded.turnCounter,
      routedProvider: loaded.routedProvider,
      routedModel: loaded.routedModel,
      authorityStatus: loaded.authorityStatus,
      contextUsage: loaded.contextUsage,
      interactiveUseSnapshot: loaded.interactiveUseSnapshot,
      browserSessionState: loaded.browserSessionState,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
    });
  },

  setContinuation: (sessionId) => {
    clearStoredContinuationTarget();
    set({
      continuationTargetId: sessionId,
    });
  },
});
