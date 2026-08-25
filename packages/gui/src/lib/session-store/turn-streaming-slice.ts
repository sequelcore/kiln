import type { GuiSessionEvent, OperatorSessionEventKind } from "@kilnai/gateway-contracts";
import {
  ContextUsageProjectionSchema,
  formatOperatorEventValue,
  presentOperatorEventPayload,
  VerifiedEfficiencyEvidenceProjectionSchema,
} from "@kilnai/gateway-contracts";
import type { StateCreator, StoreApi } from "zustand";
import { isObjectRecord, readNumber, readString } from "./unknown-value.js";
import { createMessageId, nowIso } from "./session-store-ids.js";
import { persistPlanMode } from "./session-store-persistence.js";
import { deriveContinuityFromState, shouldApplySessionScopedFrame } from "./session-continuity-gate.js";
import { readAuthorityStatus } from "./authority-status-projection.js";
import {
  requiredScopedToolIdentity,
  toolCallIdFromDetails,
  toolCallScopeIdFromDetails,
} from "./timeline-entry-details.js";
import { browserSessionStateFromSnapshot, interactiveSnapshotFromPersistedToolEvent } from "./interactive-use-projection.js";
import { deriveToolCallLog } from "./derived-timeline-selectors.js";
import {
  appendLiveToolOutput,
  appendSessionEvent,
  eventPayloadText,
  invocationCancelledSummary,
  invocationCompletedSummary,
  invocationFailedSummary,
  invocationRequestedSummary,
  invocationStartedSummary,
  isWorkItemTimelineEventKind,
  isWorkflowLifecycleTimelineEventKind,
  normalizeLoadedChangeType,
  providerIdentity,
  turnOutcomePresentation,
  workflowLifecycleTimelineEntry,
} from "./session-event-projection.js";
import { syncTimelineMessages, timelineTurnId } from "./session-timeline-types.js";
import type { ActivityPhase, Message } from "./session-timeline-types.js";
import type { SessionStore, TurnStreamingActions } from "./session-store-state.js";

function activeExecutionRouteIdentity(state: SessionStore): { readonly providerId: string; readonly providerModelId: string } | null {
  return state.executionRouteCatalog?.routes.find((route) => route.routeId === state.activeRouteId) ?? null;
}

function settledRouteMode(state: SessionStore): "auto" | "user" {
  return state.activeAccountOverrideId ? "user" : "auto";
}

/**
 * The active turn: outbound `sendMessage`/`cancelActiveTurn`/plan-mode
 * control, and every inbound frame that projects onto the running turn —
 * the live session-event reducer, streamed text deltas, coarse activity
 * frames, turn completion, and turn-cancel acknowledgement. `onExecConfirmed`
 * lives here rather than in approval-goal because its body only flips
 * plan-mode and turn state.
 *
 * Canonical event ordering, deduplication, identity, evidence, and
 * presentation semantics are owned by the gateway-contracts projection.
 * The handlers below translate that shared projection into transient GUI
 * layout and interaction state; they are not session or execution authority.
 */

type Api = Pick<StoreApi<SessionStore>, "setState" | "getState">;

interface SessionEventContext {
  readonly set: Api["setState"];
  readonly get: Api["getState"];
  readonly state: SessionStore;
  readonly event: GuiSessionEvent;
  readonly payload: Record<string, unknown>;
}

function handleAssistantDelta(ctx: SessionEventContext): void {
  const { state, event, payload } = ctx;
  const delta = readString(payload.delta) ?? eventPayloadText(payload);
  if (delta) {
    state.onTextDelta({
      type: "text_delta",
      content: delta,
      kilnSessionId: event.kilnSessionId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
    });
  }
}

function handleProviderRouted(ctx: SessionEventContext): void {
  const { set, state, event, payload } = ctx;
  const provider = providerIdentity(payload);
  set({
    timelineEntries: [
      ...state.timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        ...timelineTurnId(event),
        title: "Provider routed",
        summary: [provider.provider, provider.model].filter(Boolean).join(" · ") || readString(payload.reason) || "Provider selected",
        tone: "info",
        details: payload,
      },
    ],
    respondingProvider: provider.provider ?? state.respondingProvider,
    respondingModel: provider.model ?? state.respondingModel,
  });
}

function handleToolCallStarted(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  const identity = requiredScopedToolIdentity(payload, event.eventId);
  const toolName = readString(payload.toolName) ?? "tool";
  const input = isObjectRecord(payload.input) ? payload.input : {};
  const presentation = presentOperatorEventPayload(event.kind, payload);
  const current = get();
  set({
    timelineEntries: [
      ...current.timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
        ...timelineTurnId(event),
        title: presentation.title,
        summary: presentation.summary,
        tone: presentation.tone,
        presentationDetails: presentation.details,
        toolPresentation: presentation.toolPresentation,
        details: {
          toolCallId: identity.callId,
          toolCallScopeId: identity.scopeId,
          toolName,
          input,
        },
      },
    ],
    activity: {
      phase: "tool_running",
      toolName,
    },
    activityPhase: "tool_running",
  });
}

function handleToolCallOutputDelta(ctx: SessionEventContext): void {
  const { set, get, payload } = ctx;
  const toolCallId = readString(payload.toolCallId);
  const toolCallScopeId = readString(payload.toolCallScopeId);
  const delta = readString(payload.delta);
  if (!toolCallId || !toolCallScopeId || delta === null) return;
  const current = get();
  set({
    timelineEntries: current.timelineEntries.map((entry) => {
      if (entry.type !== "event" || entry.eventKind !== "tool_call_started"
        || toolCallIdFromDetails(entry.details) !== toolCallId
        || toolCallScopeIdFromDetails(entry.details) !== toolCallScopeId) {
        return entry;
      }
      const details = isObjectRecord(entry.details) ? entry.details : {};
      return {
        ...entry,
        details: {
          ...details,
          liveOutput: appendLiveToolOutput(readString(details.liveOutput) ?? "", delta),
        },
      };
    }),
  });
}

function handleToolCallCompleted(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  const identity = requiredScopedToolIdentity(payload, event.eventId);
  const status = isObjectRecord(payload.status) ? payload.status : null;
  const interactiveUseSnapshot = interactiveSnapshotFromPersistedToolEvent(event.kilnSessionId, event, payload, status);
  const browserSessionState = browserSessionStateFromSnapshot(interactiveUseSnapshot);
  const current = get();
  const priorToolCalls = deriveToolCallLog(current.timelineEntries);
  const priorInput = priorToolCalls.find((entry) =>
    entry.callId === identity.callId && entry.scopeId === identity.scopeId
  )?.input ?? {};
  const presentation = presentOperatorEventPayload(event.kind, payload);
  set({
    timelineEntries: [
      ...current.timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        ...timelineTurnId(event),
        title: presentation.title,
        summary: presentation.summary,
        tone: presentation.tone,
        presentationDetails: presentation.details,
        toolPresentation: presentation.toolPresentation,
        details: {
          toolCallId: identity.callId,
          toolCallScopeId: identity.scopeId,
          toolName: readString(payload.toolName) ?? "tool",
          input: priorInput,
          result: presentation.summary ?? eventPayloadText(payload) ?? undefined,
          status: presentation.tone === "error" ? "failed" : status?.state,
        },
      },
    ],
    activity: null,
    ...(interactiveUseSnapshot ? { interactiveUseSnapshot } : {}),
    ...(interactiveUseSnapshot ? { browserSessionState } : {}),
  });
}

function handleApprovalRequested(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Approval requested",
        summary: readString(payload.action) ?? readString(payload.justification) ?? "Approval required",
        tone: "warning",
        details: payload,
        sessionId: event.kilnSessionId,
      },
    ],
    activity: {
      phase: "awaiting_approval",
      details: readString(payload.action) ?? undefined,
    },
  });
}

function handleApprovalResolved(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  const resolution = isObjectRecord(payload.resolution) ? payload.resolution : null;
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Approval resolved",
        summary: readString(resolution?.decision) ?? undefined,
        tone: resolution?.decision === "approved" ? "success" : "error",
        details: {
          approvalId: readString(payload.approvalId) ?? undefined,
          resolution: resolution ?? undefined,
        },
        sessionId: event.kilnSessionId,
      },
    ],
    activity: null,
  });
}

function handleFileChanged(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  const change = isObjectRecord(payload.change) ? payload.change : null;
  const changeType = normalizeLoadedChangeType(change?.changeType);
  const path = readString(change?.path);
  if (!changeType || !path) {
    return;
  }
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "File changed",
        summary: `${changeType}: ${path}`,
        tone: "info",
        details: change,
      },
    ],
  });
}

function handleContextUsageObserved(ctx: SessionEventContext): void {
  const { set, payload } = ctx;
  const parsed = ContextUsageProjectionSchema.safeParse(payload.contextUsage);
  if (parsed.success) {
    set({ contextUsage: parsed.data });
  }
}

function handleCostUpdated(ctx: SessionEventContext): void {
  const { set, get, state, event, payload } = ctx;
  const cost = isObjectRecord(payload.cost) ? payload.cost : null;
  const usage = isObjectRecord(payload.usage) ? payload.usage : null;
  const provider = providerIdentity(payload);
  const presentation = presentOperatorEventPayload(event.kind, payload);
  state.onActivity({
    type: "activity",
    activity: "cost_update",
    kilnSessionId: event.kilnSessionId,
    usd: readNumber(cost?.deltaUsd) ?? 0,
    inputTokens: readNumber(usage?.inputTokens) ?? undefined,
    outputTokens: readNumber(usage?.outputTokens) ?? undefined,
  });
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: presentation.title,
        summary: presentation.summary,
        tone: presentation.tone,
        presentationDetails: presentation.details,
        details: {
          provider,
          usage,
          cost,
        },
      },
    ],
  });
}

function handleLifecycleAttributionRecorded(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  const presentation = presentOperatorEventPayload(event.kind, payload);
  const efficiencyEvidence = VerifiedEfficiencyEvidenceProjectionSchema.safeParse(payload.efficiencyEvidence);
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        ...timelineTurnId(event),
        title: presentation.title,
        summary: presentation.summary,
        tone: presentation.tone,
        presentationDetails: presentation.details,
        ...(efficiencyEvidence.success ? { details: efficiencyEvidence.data } : {}),
      },
    ],
  });
}

function handleEffectivePromptObserved(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  const presentation = presentOperatorEventPayload(event.kind, payload);
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        ...timelineTurnId(event),
        title: presentation.title,
        summary: presentation.summary,
        tone: presentation.tone,
        presentationDetails: presentation.details,
        details: payload.effectivePrompt,
      },
    ],
  });
}

function handleWorkItemTimelineEvent(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  const presentation = presentOperatorEventPayload(event.kind, payload);
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
        ...timelineTurnId(event),
        title: presentation.title,
        summary: presentation.summary,
        tone: presentation.tone,
        presentationDetails: presentation.details,
        details: payload,
      },
    ],
  });
}

function handleWorkflowLifecycleEvent(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  set({
    timelineEntries: [
      ...get().timelineEntries,
      workflowLifecycleTimelineEntry({
        id: `timeline:${event.eventId}`,
        kind: event.kind,
        payload,
        timestamp: event.timestamp,
        sequence: event.sequence,
        turnId: event.turnId,
      }),
    ],
  });
}

function handleAgentInvocationRequested(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  const summary = invocationRequestedSummary(payload);
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Agent invocation requested",
        summary,
        tone: "info",
        details: payload,
      },
    ],
    activity: {
      phase: "thinking",
      details: summary,
    },
  });
}

function handleAgentInvocationStarted(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  const summary = invocationStartedSummary(payload);
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Agent invocation started",
        summary,
        tone: "running",
        details: payload,
      },
    ],
    activity: {
      phase: "thinking",
      details: summary,
    },
  });
}

function handleAgentInvocationCompleted(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Agent invocation completed",
        summary: invocationCompletedSummary(payload),
        tone: "success",
        details: payload,
      },
    ],
    activity: null,
  });
}

function handleAgentInvocationFailed(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Agent invocation failed",
        summary: invocationFailedSummary(payload),
        tone: "error",
        details: payload,
      },
    ],
    activity: null,
  });
}

function handleAgentInvocationCancelled(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Agent invocation cancelled",
        summary: invocationCancelledSummary(payload),
        tone: "warning",
        details: payload,
      },
    ],
    activity: null,
  });
}

function handleContinuityDecided(ctx: SessionEventContext): void {
  const { set, get, state, event, payload } = ctx;
  const provider = state.respondingProvider ?? activeExecutionRouteIdentity(state)?.providerId;
  const strategy = readString(payload.decision);
  if (!provider || !strategy) {
    return;
  }
  set({
    timelineEntries: [
      ...get().timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Continuity decided",
        summary: `${strategy}${readString(payload.reason) ? ` · ${readString(payload.reason)}` : ""}`,
        tone: "info",
        details: {
          ...payload,
          provider,
        },
      },
    ],
  });
}

function handleTurnCompleted(ctx: SessionEventContext): void {
  const { set, get, event, payload } = ctx;
  const outcomePresentation = turnOutcomePresentation(payload.outcome);
  const current = get();
  const routingRationale = isObjectRecord(payload.routingRationale) ? payload.routingRationale : null;
  const routedProvider = readString(payload.routedProvider)
    ?? readString(routingRationale?.selectedProvider)
    ?? current.respondingProvider
    ?? current.routedProvider;
  const routedModel = readString(payload.routedModel)
    ?? readString(routingRationale?.selectedModel)
    ?? current.respondingModel
    ?? current.routedModel;
  const authorityStatus = readAuthorityStatus(payload.authorityStatus);
  set({
    timelineEntries: [
      ...current.timelineEntries,
      {
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        ...timelineTurnId(event),
        title: outcomePresentation.title,
        summary: readString(payload.outcome) ?? undefined,
        tone: outcomePresentation.tone,
        details: payload,
      },
    ],
    currentAssistant: null,
    status: "ready",
    turnCancelPending: false,
    activity: null,
    activityPhase: "idle",
    authorityStatus: authorityStatus ?? current.authorityStatus,
    routedProvider,
    routedModel,
    routeMode: settledRouteMode(current),
    respondingProvider: null,
    respondingModel: null,
    currentTurnTrackedInputTokens: 0,
    currentTurnTrackedOutputTokens: 0,
    turnCounter: current.turnCounter + 1,
    clearPending: false,
  });
}

function handleErrorRecorded(ctx: SessionEventContext): void {
  const { state, payload } = ctx;
  const message = readString(payload.message);
  if (message) {
    state.onError({
      type: "error",
      message,
      code: readString(payload.errorCode) ?? undefined,
    });
  }
}

const SESSION_EVENT_HANDLERS: Partial<Record<OperatorSessionEventKind, (ctx: SessionEventContext) => void>> = {
  assistant_delta: handleAssistantDelta,
  provider_routed: handleProviderRouted,
  tool_call_started: handleToolCallStarted,
  tool_call_output_delta: handleToolCallOutputDelta,
  tool_call_completed: handleToolCallCompleted,
  approval_requested: handleApprovalRequested,
  approval_resolved: handleApprovalResolved,
  file_changed: handleFileChanged,
  context_usage_observed: handleContextUsageObserved,
  cost_updated: handleCostUpdated,
  lifecycle_attribution_recorded: handleLifecycleAttributionRecorded,
  effective_prompt_observed: handleEffectivePromptObserved,
  agent_invocation_requested: handleAgentInvocationRequested,
  agent_invocation_started: handleAgentInvocationStarted,
  agent_invocation_completed: handleAgentInvocationCompleted,
  agent_invocation_failed: handleAgentInvocationFailed,
  agent_invocation_cancelled: handleAgentInvocationCancelled,
  continuity_decided: handleContinuityDecided,
  turn_completed: handleTurnCompleted,
  error_recorded: handleErrorRecorded,
};

function dispatchSessionEvent(ctx: SessionEventContext): void {
  if (isWorkItemTimelineEventKind(ctx.event.kind)) {
    handleWorkItemTimelineEvent(ctx);
    return;
  }
  if (isWorkflowLifecycleTimelineEventKind(ctx.event.kind)) {
    handleWorkflowLifecycleEvent(ctx);
    return;
  }
  SESSION_EVENT_HANDLERS[ctx.event.kind]?.(ctx);
}

function hasAudioPart(parts: readonly unknown[] | undefined): boolean {
  return Array.isArray(parts)
    && parts.some((part) => isObjectRecord(part) && part.type === "audio");
}

function displayAdmittedInputContent(content: string): string {
  return content.replace(/^\[Voice note transcription\]:\s*/u, "").trim();
}

function replaceLatestVoicePlaceholder(
  messages: readonly Message[],
  admittedContent: string | undefined,
): readonly Message[] {
  const displayContent = admittedContent ? displayAdmittedInputContent(admittedContent) : "";
  if (!displayContent) {
    return messages;
  }
  const index = messages.findLastIndex((message) => (
    message.role === "user"
    && hasAudioPart(message.parts)
    && /^Voice input(?:\s+\d+(?:\.\d+)?s)?$/u.test(message.content.trim())
  ));
  if (index < 0) {
    return messages;
  }
  return messages.map((message, messageIndex) => (
    messageIndex === index
      ? { ...message, content: displayContent }
      : message
  ));
}

export const createTurnStreamingSlice: StateCreator<
  SessionStore,
  [],
  [],
  TurnStreamingActions
> = (set, get) => ({
  onSessionEvent: (event) => {
    const state = get();
    if (!shouldApplySessionScopedFrame(state, event.kilnSessionId)) {
      return;
    }
    if (state.status === "running" && state.liveSessionId !== event.kilnSessionId) {
      set({ liveSessionId: event.kilnSessionId });
    }
    if (state.sessionEvents.some((candidate) => candidate.eventId === event.eventId)) {
      return;
    }
    const payload = isObjectRecord(event.payload) ? event.payload : {};
    set({ sessionEvents: appendSessionEvent(state.sessionEvents, event) });

    dispatchSessionEvent({ set, get, state, event, payload });
  },

  onTextDelta: (frame) => {
    const state = get();
    if (state.clearPending) {
      return;
    }
    if (!shouldApplySessionScopedFrame(state, frame.kilnSessionId)) {
      return;
    }
    const messageList = [...state.messages];
    const timelineEntries = [...state.timelineEntries];
    const existingId = state.currentAssistant;
    const targetIndex = existingId
      ? messageList.findIndex((message) => message.id === existingId)
      : -1;

    if (targetIndex < 0 && frame.content.trim().length === 0) {
      set({ status: "running", activityPhase: "streaming" });
      return;
    }

    if (targetIndex >= 0) {
      const current = messageList[targetIndex];
      if (!current) {
        return;
      }
      messageList[targetIndex] = {
        ...current,
        content: current.content + frame.content,
        streaming: true,
      };
      const timelineIndex = timelineEntries.findIndex((entry) => entry.type === "message" && entry.message.id === current.id);
      if (timelineIndex >= 0) {
        const currentTimelineEntry = timelineEntries[timelineIndex];
        if (currentTimelineEntry?.type !== "message") {
          return;
        }
        timelineEntries[timelineIndex] = {
          ...currentTimelineEntry,
          message: messageList[targetIndex]!,
        };
      }
      set({ messages: messageList, timelineEntries, status: "running", activityPhase: "streaming" });
      return;
    }

    const assistantId = createMessageId();
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: frame.content,
      createdAt: nowIso(),
      streaming: true,
    };
    set({
      messages: [...messageList, assistantMessage],
      timelineEntries: [
        ...timelineEntries,
        {
          id: `timeline:${assistantId}`,
          type: "message",
          createdAt: assistantMessage.createdAt,
          ...(frame.turnId ? { turnId: frame.turnId } : {}),
          message: assistantMessage,
        },
      ],
      currentAssistant: assistantId,
      status: "running",
      activityPhase: "streaming",
    });
  },

  onActivity: (frame) => {
    const current = get();
    if (!shouldApplySessionScopedFrame(current, frame.kilnSessionId)) {
      return;
    }
    if (frame.activity === "cost_update" && typeof frame.usd === "number") {
      set({
        sessionCostUsd: current.sessionCostUsd + frame.usd,
        inputTokens: current.inputTokens + (frame.inputTokens ?? 0),
        outputTokens: current.outputTokens + (frame.outputTokens ?? 0),
        currentTurnTrackedInputTokens: current.currentTurnTrackedInputTokens + (frame.inputTokens ?? 0),
        currentTurnTrackedOutputTokens: current.currentTurnTrackedOutputTokens + (frame.outputTokens ?? 0),
      });
      return;
    }

    const activeRoute = activeExecutionRouteIdentity(current);
    const nextRespondingProvider = current.respondingProvider ?? activeRoute?.providerId ?? null;
    const nextRespondingModel = current.respondingModel ?? activeRoute?.providerModelId ?? null;

    const baseActivity = frame.activity.trim();
    const phase = baseActivity.length > 0 ? baseActivity : undefined;

    const derivedPhase: ActivityPhase = (() => {
      if (frame.activity === "tool_use") return "tool_running";
      if (frame.activity === "reasoning") return "thinking";
      if (frame.activity === "tool_result") return "idle";
      return current.activityPhase === "idle" ? "thinking" : current.activityPhase;
    })();

    set({
      activity: {
        phase,
        toolName: frame.toolName,
        details: frame.details ?? frame.output,
      },
      activityPhase: derivedPhase,
      routeMode: "responding",
      respondingProvider: nextRespondingProvider,
      respondingModel: nextRespondingModel,
    });

    if (frame.activity !== "tool_use") {
      return;
    }

    const details = (() => {
      if (!frame.input || typeof frame.input !== "object") return "";
      const entries = Object.entries(frame.input as Record<string, unknown>).slice(0, 3);
      if (entries.length === 0) return "";
      const formatted = entries
        .map(([key, value]) => `${key}=${formatOperatorEventValue(value) ?? ""}`)
        .join(", ");
      return ` (${formatted})`;
    })();

    const toolMessage: Message = {
      id: createMessageId(),
      role: "tool",
      content: `${frame.toolName ?? "tool"}${details}`,
      createdAt: nowIso(),
    };
    set((previous) => ({
      messages: [...previous.messages, toolMessage],
    }));
  },

  onDone: (frame) => {
    const state = get();
    if (state.clearPending) {
      return;
    }
    if (!shouldApplySessionScopedFrame(state, frame.kilnSessionId)) {
      return;
    }
    const activeRoute = activeExecutionRouteIdentity(state);
    const finalizedProvider = frame.routedProvider ?? state.respondingProvider ?? activeRoute?.providerId ?? undefined;
    const finalizedModel = frame.routedModel ?? state.respondingModel ?? activeRoute?.providerModelId ?? undefined;
    const responseParts = frame.parts && frame.parts.length > 0 ? frame.parts : undefined;
    const voiceSynthesisStatus = responseParts && hasAudioPart(responseParts) ? "ready" as const : "idle" as const;
    const outcomePresentation = turnOutcomePresentation(frame.outcome);

    let nextInputTokens = state.inputTokens;
    let nextOutputTokens = state.outputTokens;
    if (frame.inputTokens > state.currentTurnTrackedInputTokens) {
      const delta = frame.inputTokens - state.currentTurnTrackedInputTokens;
      nextInputTokens += delta;
    }
    if (frame.outputTokens > state.currentTurnTrackedOutputTokens) {
      const delta = frame.outputTokens - state.currentTurnTrackedOutputTokens;
      nextOutputTokens += delta;
    }

    let nextMessages = replaceLatestVoicePlaceholder(state.messages, frame.admittedInput?.content);
    let nextTimelineEntries = syncTimelineMessages(state.timelineEntries, nextMessages);
    if (state.currentAssistant) {
      nextMessages = nextMessages.map((message) => (
        message.id === state.currentAssistant
          ? {
              ...message,
              content: message.content.trim().length === 0 && frame.content.trim().length > 0
                ? frame.content
                : message.content,
              streaming: false,
              routedProvider: finalizedProvider,
              routedModel: finalizedModel,
              routingRationale: frame.routingRationale,
              ...(responseParts ? { parts: responseParts } : {}),
              ...(frame.sourceMessageId ? { sourceMessageId: frame.sourceMessageId, voiceSynthesisStatus } : {}),
            }
          : message
      ));
      nextTimelineEntries = nextTimelineEntries.map((entry) => (
        entry.type === "message" && entry.message.id === state.currentAssistant
          ? {
              ...entry,
              message: nextMessages.find((message) => message.id === state.currentAssistant) ?? entry.message,
            }
          : entry
      ));
    } else if (frame.content.trim().length > 0 || responseParts) {
      const assistantMessage: Message = {
        id: createMessageId(),
        role: "assistant",
        content: frame.content,
        ...(responseParts ? { parts: responseParts } : {}),
        ...(frame.sourceMessageId ? { sourceMessageId: frame.sourceMessageId, voiceSynthesisStatus } : {}),
        createdAt: nowIso(),
        streaming: false,
        routedProvider: finalizedProvider,
        routedModel: finalizedModel,
        routingRationale: frame.routingRationale,
      };
      nextMessages = [
        ...nextMessages,
        assistantMessage,
      ];
      nextTimelineEntries = [
        ...nextTimelineEntries,
        {
          id: `timeline:${assistantMessage.id}`,
          type: "message",
          createdAt: assistantMessage.createdAt,
          message: assistantMessage,
        },
      ];
    }
    nextTimelineEntries = [
      ...nextTimelineEntries,
      {
        id: `timeline:turn-complete:${state.turnCounter + 1}:${Date.now()}`,
        type: "event",
        eventKind: "turn_completed",
        createdAt: nowIso(),
        title: outcomePresentation.title,
        summary: finalizedProvider ? [finalizedProvider, finalizedModel].filter(Boolean).join(" · ") : undefined,
        tone: outcomePresentation.tone,
        details: {
          outcome: frame.outcome,
          routedProvider: finalizedProvider,
          routedModel: finalizedModel,
          routingRationale: frame.routingRationale,
          runtimeContinuity: frame.runtimeContinuity,
          authorityStatus: frame.authorityStatus,
          inputTokens: frame.inputTokens,
          outputTokens: frame.outputTokens,
        },
      },
    ];

    const clearTimeoutId = state.clearTimeoutId;
    if (clearTimeoutId) {
      clearTimeout(clearTimeoutId);
    }

    set({
      messages: nextMessages,
      timelineEntries: nextTimelineEntries,
      currentAssistant: null,
      status: "ready",
      activity: null,
      activityPhase: "idle",
      sessionCostUsd: state.sessionCostUsd,
      inputTokens: nextInputTokens,
      outputTokens: nextOutputTokens,
      authorityStatus: frame.authorityStatus ?? state.authorityStatus,
      routedProvider: finalizedProvider ?? state.routedProvider,
      routedModel: finalizedModel ?? state.routedModel,
      routeMode: settledRouteMode(state),
      respondingProvider: null,
      respondingModel: null,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
      turnCounter: state.turnCounter + 1,
      clearTimeoutId: null,
      clearPending: false,
      turnCancelPending: false,
    });
  },

  onTurnCancelResult: (frame) => {
    const state = get();
    if (frame.status === "accepted") {
      set({ turnCancelPending: true, sessionControlFailure: null });
      return;
    }
    set({
      turnCancelPending: false,
      ...(frame.status === "failed"
        ? {
            sessionControlFailure: {
              action: "cancel_turn" as const,
              message: frame.reason ?? "The active turn could not be cancelled.",
            },
          }
        : state.status === "running"
          ? { status: "ready" as const, activity: null, activityPhase: "idle" as const }
          : {}),
    });
  },

  onExecConfirmed: () => {
    persistPlanMode(false);
    set({ planMode: false, status: "ready" });
  },

  sendMessage: (text, options) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (state.status !== "ready" || !outboundSend) {
      return false;
    }
    const normalized = text.trim();
    const outboundParts = options?.parts && options.parts.length > 0 ? options.parts : undefined;
    const displayContent = options?.displayContent?.trim() || normalized;
    if (!normalized && !outboundParts) {
      return false;
    }

    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: displayContent,
      ...(outboundParts ? { parts: outboundParts } : {}),
      createdAt: nowIso(),
    };
    const continuity = deriveContinuityFromState(state);
    const baseMessages = continuity.shouldResetVisibleHistoryOnSubmit ? [] : state.messages;
    const baseTimelineEntries = continuity.shouldResetVisibleHistoryOnSubmit ? [] : state.timelineEntries;
    const baseSessionEvents = continuity.shouldResetVisibleHistoryOnSubmit ? [] : state.sessionEvents;
    set({
      messages: [...baseMessages, userMessage],
      timelineEntries: [
        ...baseTimelineEntries,
        {
          id: `timeline:${userMessage.id}`,
          type: "message",
          createdAt: userMessage.createdAt,
          message: userMessage,
        },
      ],
      status: "running",
      selectedSessionId: null,
      liveSessionId: null,
      sessionEvents: baseSessionEvents,
      activity: { phase: "thinking" },
      activityPhase: "thinking",
      routeMode: "responding",
      respondingProvider: activeExecutionRouteIdentity(state)?.providerId ?? null,
      respondingModel: activeExecutionRouteIdentity(state)?.providerModelId ?? null,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
      contextUsage: null,
      sessionControlFailure: null,
      currentAssistant: null,
      turnCancelPending: false,
    });

    outboundSend({
      type: "message",
      content: normalized,
      ...(outboundParts ? { parts: outboundParts } : {}),
      executionMode: state.planMode ? "plan" : "execute",
      continuationSessionId: continuity.outboundContinuationSessionId,
      ...(continuity.outboundSessionIntent ? { sessionIntent: continuity.outboundSessionIntent } : {}),
      ...(options?.deliberationIntent ? { deliberationIntent: options.deliberationIntent } : {}),
      ...(options?.communicationIntent ? { communicationIntent: options.communicationIntent } : {}),
      ...(options?.requestedAuthority ? { requestedAuthority: options.requestedAuthority } : {}),
      ...(options?.governedWorkRequirement ? { governedWorkRequirement: options.governedWorkRequirement } : {}),
      ...(options?.gatewayTargetId ? { gatewayTargetId: options.gatewayTargetId } : {}),
      ...(options?.appName ? { appName: options.appName } : {}),
      ...(options?.tenantId ? { tenantId: options.tenantId } : {}),
    });

    return true;
  },

  cancelActiveTurn: () => {
    const state = get();
    if (!state.outboundSend || state.status !== "running" || state.turnCancelPending) {
      return false;
    }
    state.outboundSend({
      type: "turn_cancel",
      requestId: createMessageId(),
      reason: "Operator cancelled the active GUI turn.",
    });
    set({ turnCancelPending: true, sessionControlFailure: null });
    return true;
  },

  setPlanMode: (enabled, options = {}) => {
    const state = get();
    if (enabled) {
      persistPlanMode(true);
      set({ planMode: true });
      return;
    }
    if (state.planMode && state.outboundSend) {
      state.outboundSend({
        type: "execution_mode_transition",
        toMode: "execute",
        ...(options.gatewayTargetId ? { gatewayTargetId: options.gatewayTargetId } : {}),
      });
      return;
    }
    persistPlanMode(false);
    set({ planMode: false });
  },

  onActivityPhase: (frame) => {
    const state = get();
    if (!shouldApplySessionScopedFrame(state, frame.kilnSessionId)) {
      return;
    }
    set({
      liveSessionId: state.status === "running" ? frame.kilnSessionId : state.liveSessionId,
      activityPhase: frame.phase,
      activity: frame.phase === "idle"
        ? null
        : {
            phase: frame.phase,
            toolName: frame.toolName,
            details: frame.details,
          },
    });
  },
});
