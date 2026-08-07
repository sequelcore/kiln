import type { StateCreator } from "zustand";
import { createMessageId, nowIso } from "./session-store-ids.js";
import type { ErrorHandlingActions, SessionStore } from "./session-store-state.js";
import type { Message } from "./session-timeline-types.js";

/**
 * The error banner shown above the composer, and appending a terminal error
 * frame to the transcript (which also unwinds every in-flight pending
 * request: turn, clear, provider switch, provider auth).
 */

export const createErrorHandlingSlice: StateCreator<
  SessionStore,
  [],
  [],
  ErrorHandlingActions
> = (set, get) => ({
  setErrorBanner: (message) => {
    set({ errorBanner: message });
  },

  clearErrorBanner: () => {
    set({ errorBanner: null });
  },

  onError: (frame) => {
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
    const errorMessage: Message = {
      id: createMessageId(),
      role: "error",
      content: frame.message,
      createdAt: nowIso(),
    };
    set({
      messages: [...state.messages, errorMessage],
      timelineEntries: [
        ...state.timelineEntries,
        {
          id: `timeline:${errorMessage.id}`,
          type: "message",
          createdAt: errorMessage.createdAt,
          message: errorMessage,
        },
      ],
      status: "ready",
      activity: null,
      errorBanner: frame.message,
      currentAssistant: null,
      routeMode: state.providerExplicitSelection ? "user" : "auto",
      respondingProvider: null,
      respondingModel: null,
      clearPending: false,
      turnCancelPending: false,
      goalControlPending: null,
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
