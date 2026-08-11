import type { StateCreator } from "zustand";
import { createMessageId } from "./session-store-ids.js";
import { syncTimelineMessages } from "./session-timeline-types.js";
import type { SessionStore, VoiceActions } from "./session-store-state.js";

/**
 * Voice-synthesis request/response for assistant messages: requesting
 * synthesis of a message's audio and applying the completed/failed result.
 */

export const createVoiceSlice: StateCreator<
  SessionStore,
  [],
  [],
  VoiceActions
> = (set, get) => ({
  requestVoiceSynthesis: (messageId) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) {
      return false;
    }
    const target = state.messages.find((message) => message.id === messageId);
    if (target?.role !== "assistant" || !target.sourceMessageId || target.voiceSynthesisStatus === "pending") {
      return false;
    }

    const requestId = createMessageId();
    const nextMessages = state.messages.map((message) => (
      message.id === messageId
        ? { ...message, voiceSynthesisStatus: "pending" as const, voiceSynthesisFailure: undefined }
        : message
    ));
    set({
      messages: nextMessages,
      timelineEntries: syncTimelineMessages(state.timelineEntries, nextMessages),
    });
    outboundSend({
      type: "voice_synthesis_request",
      requestId,
      sourceMessageId: target.sourceMessageId,
    });
    return true;
  },

  onVoiceSynthesisCompleted: (frame) => {
    const state = get();
    const nextMessages = state.messages.map((message) => (
      message.sourceMessageId === frame.sourceMessageId
        ? {
            ...message,
            parts: frame.parts,
            voiceSynthesisStatus: "ready" as const,
            voiceSynthesisFailure: undefined,
          }
        : message
    ));
    set({
      messages: nextMessages,
      timelineEntries: syncTimelineMessages(state.timelineEntries, nextMessages),
    });
  },

  onVoiceSynthesisFailed: (frame) => {
    const state = get();
    const nextMessages = state.messages.map((message) => (
      message.sourceMessageId === frame.sourceMessageId
        ? {
            ...message,
            voiceSynthesisStatus: "error" as const,
            voiceSynthesisFailure: frame.message,
          }
        : message
    ));
    set({
      messages: nextMessages,
      timelineEntries: syncTimelineMessages(state.timelineEntries, nextMessages),
    });
  },
});
