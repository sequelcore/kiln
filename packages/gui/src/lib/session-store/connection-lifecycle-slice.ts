import type { StateCreator } from "zustand";
import { clearStoredContinuationTarget } from "./session-store-persistence.js";
import { resolveStoredProviderSelectionRestore } from "./provider-selection-restore.js";
import { MAX_DETACHED_SESSION_IDS } from "./session-store-state.js";
import type { ConnectionLifecycleActions, SessionStore } from "./session-store-state.js";

/**
 * Connection status, the outbound-send wiring handed in by the transport,
 * and whole-session reset (clear / disconnect).
 */

const CLEAR_TIMEOUT_MS = 5_000;

function appendDetachedSessionId(
  ids: readonly string[],
  sessionId: string | null,
): readonly string[] {
  if (!sessionId || ids.includes(sessionId)) {
    return ids;
  }
  return [...ids, sessionId].slice(-MAX_DETACHED_SESSION_IDS);
}

export const createConnectionLifecycleSlice: StateCreator<
  SessionStore,
  [],
  [],
  ConnectionLifecycleActions
> = (set, get) => ({
  setConnectionStatus: (status) => {
    set({ status });
  },

  setSender: (send) => {
    set({ outboundSend: send });
    if (send) {
      const restore = resolveStoredProviderSelectionRestore(get());
      if (restore) {
        get().switchProvider(restore.provider, restore.model ?? undefined);
      }
    }
  },

  onCleared: () => {
    const state = get();
    if (state.clearTimeoutId) {
      clearTimeout(state.clearTimeoutId);
    }
    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }
    if (state.providerAuthTimeoutId) {
      clearTimeout(state.providerAuthTimeoutId);
    }
    clearStoredContinuationTarget();
    set({
      messages: [],
      timelineEntries: [],
      sessionEvents: [],
      currentAssistant: null,
      status: "ready",
      activity: null,
      activityPhase: "idle",
      sessionControlFailure: null,
      selectedSessionId: null,
      liveSessionId: null,
      continuationTargetId: null,
      routedProvider: null,
      routedModel: null,
      routeMode: state.providerExplicitSelection ? "user" : "auto",
      respondingProvider: null,
      respondingModel: null,
      interactiveUseSnapshot: null,
      browserSessionState: null,
      sessionCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
      clearPending: false,
      turnCancelPending: false,
      goalControlPending: null,
      goalControlFailure: null,
      approvalResponseFailure: null,
      approvalResponsesPending: [],
      clearTimeoutId: null,
      providerSwitching: false,
      providerSwitchTarget: null,
      providerSwitchTimeoutId: null,
      providerAuthenticating: false,
      providerAuthTarget: null,
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: null,
    });
  },

  sendClear: () => {
    const state = get();
    if (!state.outboundSend || state.clearPending) {
      return false;
    }

    state.outboundSend({ type: "clear" });
    clearStoredContinuationTarget();
    const timeoutId = setTimeout(() => {
      const latest = get();
      if (!latest.clearPending) return;
      set({
        clearPending: false,
        clearTimeoutId: null,
        status: "ready",
        sessionControlFailure: {
          action: "clear",
          message: "Clear session timed out. Please retry.",
        },
      });
    }, CLEAR_TIMEOUT_MS);

    set({
      selectedSessionId: null,
      liveSessionId: null,
      continuationTargetId: null,
      detachedSessionIds: appendDetachedSessionId(state.detachedSessionIds, state.liveSessionId),
      clearPending: true,
      clearTimeoutId: timeoutId,
      status: "running",
      sessionControlFailure: null,
    });
    return true;
  },

  disconnect: () => {
    const state = get();
    if (state.clearTimeoutId) {
      clearTimeout(state.clearTimeoutId);
    }
    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }
    if (state.providerAuthTimeoutId) {
      clearTimeout(state.providerAuthTimeoutId);
    }
    set({
      status: "idle",
      activity: null,
      activityPhase: "idle",
      interactiveUseSnapshot: null,
      browserSessionState: null,
      routeMode: state.providerExplicitSelection ? "user" : "auto",
      respondingProvider: null,
      respondingModel: null,
      clearPending: false,
      turnCancelPending: false,
      goalControlPending: null,
      sessionControlFailure: null,
      goalControlFailure: null,
      approvalResponseFailure: null,
      approvalResponsesPending: [],
      clearTimeoutId: null,
      providerSwitching: false,
      providerSwitchTarget: null,
      providerSwitchTimeoutId: null,
      providerAuthenticating: false,
      providerAuthTarget: null,
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: null,
    });
  },
});
