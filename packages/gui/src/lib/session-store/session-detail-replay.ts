import type {
  GuiBrowserSessionState,
  GuiInteractiveUseSnapshot,
  GuiSessionDetail,
  ContextUsageProjection,
} from "@kilnai/gateway-contracts";
import {
  ContextUsageProjectionSchema,
  presentOperatorEventPayload,
  VerifiedEfficiencyEvidenceProjectionSchema,
} from "@kilnai/gateway-contracts";
import { isObjectRecord, readNumber, readString } from "./unknown-value.js";
import { nowIso } from "./session-store-ids.js";
import { browserSessionStateFromSnapshot, interactiveSnapshotFromPersistedToolEvent } from "./interactive-use-projection.js";
import { readAuthorityStatus } from "./authority-status-projection.js";
import {
  requiredScopedToolIdentity,
  toolCallIdFromDetails,
  toolCallScopeIdFromDetails,
  toolEntryStatusFromPresentation,
} from "./timeline-entry-details.js";
import {
  appendLiveToolOutput,
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
import type { AuthorityStatus } from "./authority-status-projection.js";
import type { Message, TimelineEntry, TimelineEventEntry, ToolCallEntry } from "./session-timeline-types.js";

/**
 * One-shot batch replay of a loaded `GuiSessionDetail`'s persisted event log
 * into the store's live-shaped state (messages, timeline entries, counters).
 * Distinct concern from the reusable per-event-kind primitives in
 * `session-event-projection`: this module owns the full ordered event-log
 * walk and its running accumulators, and its per-kind branches structurally
 * duplicate the live reducer in `turn-streaming-slice`'s `onSessionEvent` by
 * design — see the split report for why that duplication is left in place.
 * Pure, no store dependency.
 */

export function mapSessionDetailToLoadedState(detail: GuiSessionDetail): {
  readonly messages: readonly Message[];
  readonly timelineEntries: readonly TimelineEntry[];
  readonly interactiveUseSnapshot: GuiInteractiveUseSnapshot | null;
  readonly browserSessionState: GuiBrowserSessionState | null;
  readonly sessionCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly turnCounter: number;
  readonly routedProvider: string | null;
  readonly routedModel: string | null;
  readonly authorityStatus: AuthorityStatus | null;
  readonly contextUsage: ContextUsageProjection | null;
} {
  const messages: Message[] = [];
  const timelineEntries: TimelineEntry[] = [];
  const toolCalls = new Map<string, ToolCallEntry>();
  let sessionCostUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let turnCounter = 0;
  let lastRoutedProvider: string | null = null;
  let lastRoutedModel: string | null = null;
  let lastAuthorityStatus: AuthorityStatus | null = null;
  let interactiveUseSnapshot: GuiInteractiveUseSnapshot | null = null;
  let browserSessionState: GuiBrowserSessionState | null = null;
  let contextUsage: ContextUsageProjection | null = null;

  for (const event of detail.events) {
    const payload = isObjectRecord(event.payload) ? event.payload : {};

    if (event.kind === "user_message") {
      const content = eventPayloadText(payload);
      if (!content) continue;
      messages.push({
        id: `${detail.id}:${event.sequence}`,
        role: "user",
        content,
        createdAt: event.timestamp,
        streaming: false,
      });
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "message",
        createdAt: event.timestamp,
        sequence: event.sequence,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        message: messages[messages.length - 1]!,
      });
      continue;
    }

    if (event.kind === "assistant_delta") {
      const delta = eventPayloadText(payload);
      if (!delta) continue;
      const messageId = readString(payload.messageId) ?? event.eventId;
      const previous = messages[messages.length - 1];
      if (previous?.role === "assistant" && previous.sessionEventMessageId === messageId) {
        messages[messages.length - 1] = {
          ...previous,
          content: previous.content + delta,
        };
        const previousTimeline = timelineEntries[timelineEntries.length - 1];
        if (previousTimeline?.type === "message" && previousTimeline.message.id === previous.id) {
          timelineEntries[timelineEntries.length - 1] = {
            ...previousTimeline,
            message: messages[messages.length - 1]!,
          };
        }
        continue;
      }
      messages.push({
        id: `${detail.id}:${event.sequence}`,
        role: "assistant",
        content: delta,
        createdAt: event.timestamp,
        streaming: false,
        routedProvider: lastRoutedProvider ?? undefined,
        routedModel: lastRoutedModel ?? undefined,
        sessionEventMessageId: messageId,
      });
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "message",
        createdAt: event.timestamp,
        sequence: event.sequence,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        message: messages[messages.length - 1]!,
      });
      continue;
    }

    if (event.kind === "assistant_message") {
      const content = eventPayloadText(payload);
      if (!content) continue;
      const messageId = readString(payload.messageId) ?? event.eventId;
      const provider = providerIdentity(payload);
      lastRoutedProvider = provider.provider ?? lastRoutedProvider;
      lastRoutedModel = provider.model ?? lastRoutedModel;
      const previous = messages[messages.length - 1];
      if (previous?.role === "assistant" && previous.sessionEventMessageId === messageId) {
        messages[messages.length - 1] = {
          ...previous,
          content,
          routedProvider: lastRoutedProvider ?? undefined,
          routedModel: lastRoutedModel ?? undefined,
        };
        const previousTimeline = timelineEntries[timelineEntries.length - 1];
        if (previousTimeline?.type === "message" && previousTimeline.message.id === previous.id) {
          timelineEntries[timelineEntries.length - 1] = {
            ...previousTimeline,
            message: messages[messages.length - 1]!,
          };
        }
        continue;
      }
      messages.push({
        id: `${detail.id}:${event.sequence}`,
        role: "assistant",
        content,
        createdAt: event.timestamp,
        streaming: false,
        routedProvider: lastRoutedProvider ?? undefined,
        routedModel: lastRoutedModel ?? undefined,
        sessionEventMessageId: messageId,
      });
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "message",
        createdAt: event.timestamp,
        sequence: event.sequence,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        message: messages[messages.length - 1]!,
      });
      continue;
    }

    if (event.kind === "error_recorded") {
      const content = eventPayloadText(payload);
      if (!content) continue;
      messages.push({
        id: `${detail.id}:${event.sequence}`,
        role: "error",
        content,
        createdAt: event.timestamp,
        streaming: false,
      });
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "message",
        createdAt: event.timestamp,
        sequence: event.sequence,
        message: messages[messages.length - 1]!,
      });
      continue;
    }

    if (event.kind === "provider_routed") {
      const provider = providerIdentity(payload);
      lastRoutedProvider = provider.provider ?? lastRoutedProvider;
      lastRoutedModel = provider.model ?? lastRoutedModel;
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Provider routed",
        summary: [lastRoutedProvider, lastRoutedModel].filter(Boolean).join(" · ") || readString(payload.reason) || "Provider selected",
        tone: "info",
        details: payload,
      });
      continue;
    }

    if (event.kind === "tool_call_started") {
      const identity = requiredScopedToolIdentity(payload, event.eventId);
      const toolName = readString(payload.toolName) ?? "tool";
      const input = isObjectRecord(payload.input) ? payload.input : {};
      const presentation = presentOperatorEventPayload(event.kind, payload);
      toolCalls.set(identity.key, {
        callId: identity.callId,
        scopeId: identity.scopeId,
        toolName,
        input,
        status: "running",
        startedAt: event.timestamp,
      });
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
        ...(event.turnId ? { turnId: event.turnId } : {}),
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
      });
      continue;
    }

    if (event.kind === "tool_call_output_delta") {
      const toolCallId = readString(payload.toolCallId);
      const toolCallScopeId = readString(payload.toolCallScopeId);
      const delta = readString(payload.delta);
      if (!toolCallId || !toolCallScopeId || delta === null) continue;
      const entryIndex = timelineEntries.findIndex((entry) => entry.type === "event"
        && entry.eventKind === "tool_call_started"
        && toolCallIdFromDetails(entry.details) === toolCallId
        && toolCallScopeIdFromDetails(entry.details) === toolCallScopeId);
      if (entryIndex < 0) continue;
      const entry = timelineEntries[entryIndex]! as TimelineEventEntry;
      const details = isObjectRecord(entry.details) ? entry.details : {};
      timelineEntries[entryIndex] = {
        ...entry,
        details: {
          ...details,
          liveOutput: appendLiveToolOutput(readString(details.liveOutput) ?? "", delta),
        },
      };
      continue;
    }

    if (event.kind === "tool_call_completed") {
      const identity = requiredScopedToolIdentity(payload, event.eventId);
      const toolName = readString(payload.toolName) ?? toolCalls.get(identity.key)?.toolName ?? "tool";
      const status = isObjectRecord(payload.status) ? payload.status : null;
      const presentation = presentOperatorEventPayload(event.kind, payload);
      const projectedInteractiveUseSnapshot = interactiveSnapshotFromPersistedToolEvent(detail.id, event, payload, status);
      interactiveUseSnapshot = projectedInteractiveUseSnapshot ?? interactiveUseSnapshot;
      browserSessionState = projectedInteractiveUseSnapshot
        ? browserSessionStateFromSnapshot(projectedInteractiveUseSnapshot)
        : browserSessionState;
      toolCalls.set(identity.key, {
        callId: identity.callId,
        scopeId: identity.scopeId,
        toolName,
        input: toolCalls.get(identity.key)?.input ?? {},
        result: presentation.summary ?? eventPayloadText(payload) ?? undefined,
        status: toolEntryStatusFromPresentation(status?.state, presentation.tone),
        startedAt: toolCalls.get(identity.key)?.startedAt ?? event.timestamp,
        completedAt: event.timestamp,
      });
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        title: presentation.title,
        summary: presentation.summary,
        tone: presentation.tone,
        presentationDetails: presentation.details,
        toolPresentation: presentation.toolPresentation,
        details: {
          toolCallId: identity.callId,
          toolCallScopeId: identity.scopeId,
          toolName,
          input: toolCalls.get(identity.key)?.input ?? {},
          result: presentation.summary ?? eventPayloadText(payload) ?? undefined,
          status: presentation.tone === "error" ? "failed" : status?.state,
        },
      });
      continue;
    }

    if (event.kind === "file_changed") {
      const change = isObjectRecord(payload.change) ? payload.change : null;
      const path = readString(change?.path);
      const changeType = normalizeLoadedChangeType(change?.changeType);
      if (!path || !changeType) continue;
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "File changed",
        summary: `${changeType}: ${path}`,
        tone: "info",
        details: change,
      });
      continue;
    }

    if (event.kind === "cost_updated") {
      const provider = providerIdentity(payload);
      const usage = isObjectRecord(payload.usage) ? payload.usage : null;
      const cost = isObjectRecord(payload.cost) ? payload.cost : null;
      const presentation = presentOperatorEventPayload(event.kind, payload);
      const deltaUsd = readNumber(cost?.deltaUsd) ?? 0;
      const inputDelta = readNumber(usage?.inputTokens) ?? 0;
      const outputDelta = readNumber(usage?.outputTokens) ?? 0;
      sessionCostUsd += deltaUsd;
      inputTokens += inputDelta;
      outputTokens += outputDelta;
      timelineEntries.push({
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
      });
      continue;
    }

    if (event.kind === "context_usage_observed") {
      const parsed = ContextUsageProjectionSchema.safeParse(payload.contextUsage);
      if (parsed.success) {
        contextUsage = parsed.data;
      }
      continue;
    }

    if (event.kind === "lifecycle_attribution_recorded") {
      const presentation = presentOperatorEventPayload(event.kind, payload);
      const efficiencyEvidence = VerifiedEfficiencyEvidenceProjectionSchema.safeParse(payload.efficiencyEvidence);
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        title: presentation.title,
        summary: presentation.summary,
        tone: presentation.tone,
        presentationDetails: presentation.details,
        ...(efficiencyEvidence.success ? { details: efficiencyEvidence.data } : {}),
      });
      continue;
    }

    if (isWorkItemTimelineEventKind(event.kind)) {
      const presentation = presentOperatorEventPayload(event.kind, payload);
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        title: presentation.title,
        summary: presentation.summary,
        tone: presentation.tone,
        presentationDetails: presentation.details,
        details: payload,
      });
      continue;
    }

    if (isWorkflowLifecycleTimelineEventKind(event.kind)) {
      timelineEntries.push(workflowLifecycleTimelineEntry({
        id: `timeline:${event.eventId}`,
        kind: event.kind,
        payload,
        timestamp: event.timestamp,
        sequence: event.sequence,
        turnId: event.turnId,
      }));
      continue;
    }

    if (event.kind === "agent_invocation_requested") {
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Agent invocation requested",
        summary: invocationRequestedSummary(payload),
        tone: "info",
        details: payload,
      });
      continue;
    }

    if (event.kind === "agent_invocation_started") {
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Agent invocation started",
        summary: invocationStartedSummary(payload),
        tone: "running",
        details: payload,
      });
      continue;
    }

    if (event.kind === "agent_invocation_completed") {
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Agent invocation completed",
        summary: invocationCompletedSummary(payload),
        tone: "success",
        details: payload,
      });
      continue;
    }

    if (event.kind === "agent_invocation_failed") {
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Agent invocation failed",
        summary: invocationFailedSummary(payload),
        tone: "error",
        details: payload,
      });
      continue;
    }

    if (event.kind === "agent_invocation_cancelled") {
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Agent invocation cancelled",
        summary: invocationCancelledSummary(payload),
        tone: "warning",
        details: payload,
      });
      continue;
    }

    if (event.kind === "continuity_decided") {
      if (!lastRoutedProvider) continue;
      const strategy = readString(payload.decision);
      if (!strategy) continue;
      timelineEntries.push({
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
          provider: lastRoutedProvider,
        },
      });
      continue;
    }

    if (event.kind === "turn_completed") {
      const outcomePresentation = turnOutcomePresentation(payload.outcome);
      const routingRationale = isObjectRecord(payload.routingRationale) ? payload.routingRationale : null;
      lastRoutedProvider = readString(payload.routedProvider)
        ?? readString(routingRationale?.selectedProvider)
        ?? lastRoutedProvider;
      lastRoutedModel = readString(payload.routedModel)
        ?? readString(routingRationale?.selectedModel)
        ?? lastRoutedModel;
      lastAuthorityStatus = readAuthorityStatus(payload.authorityStatus) ?? lastAuthorityStatus;
      turnCounter += 1;
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: outcomePresentation.title,
        summary: readString(payload.outcome) ?? undefined,
        tone: outcomePresentation.tone,
        details: payload,
      });
      continue;
    }

    if (event.kind === "approval_requested") {
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Approval requested",
        summary: readString(payload.action) ?? readString(payload.justification) ?? "Approval required",
        tone: "warning",
        details: payload,
        sessionId: detail.id,
      });
      continue;
    }

    if (event.kind === "approval_resolved") {
      const resolution = isObjectRecord(payload.resolution) ? payload.resolution : null;
      const decision = readString(resolution?.decision) ?? "resolved";
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Approval resolved",
        summary: decision,
        tone: decision === "approved" ? "success" : "error",
        details: resolution ?? payload,
        sessionId: detail.id,
      });
      continue;
    }

    if (event.kind === "turn_started") {
      timelineEntries.push({
        id: `timeline:${event.eventId}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Turn started",
        tone: "info",
      });
    }
  }

  if (messages.length === 0) {
    const fallback = detail.meta?.summary ?? detail.meta?.task ?? "";
    if (fallback.trim().length > 0) {
      messages.push({
        id: `${detail.id}:summary`,
        role: "assistant",
        content: fallback,
        createdAt: detail.meta?.completedAt ?? detail.meta?.startedAt ?? nowIso(),
        streaming: false,
      });
      timelineEntries.push({
        id: `${detail.id}:timeline:summary`,
        type: "message",
        createdAt: detail.meta?.completedAt ?? detail.meta?.startedAt ?? nowIso(),
        message: messages[messages.length - 1]!,
      });
    }
  }

  return {
    messages,
    timelineEntries,
    interactiveUseSnapshot,
    browserSessionState,
    sessionCostUsd,
    inputTokens,
    outputTokens,
    turnCounter,
    routedProvider: lastRoutedProvider,
    routedModel: lastRoutedModel,
    authorityStatus: lastAuthorityStatus,
    contextUsage,
  };
}

