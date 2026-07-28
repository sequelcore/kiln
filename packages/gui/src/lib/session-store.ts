import { create } from "zustand";
import type {
  GuiBrowserLiveViewportFrame,
  GuiBrowserOperatorInput,
  GuiBrowserOperatorInputAckFrame,
  GuiBrowserSessionCapture,
  GuiBrowserSessionState,
  GuiAuthorityStatus,
  GuiInboundFrame,
  GuiInteractiveUseSnapshot,
  GuiModelRoutingRationale,
  GuiOutboundFrame,
  GuiProviderCatalogStatus,
  GuiProviderDiscoveryResult,
  GuiProviderModelDiscoveryProjection,
  GuiProviderReasoningEffort,
  OperatorTurnRequestedAuthority,
  OperatorGoalMaterializationRequirement,
  GuiSessionDetail,
  GuiSessionEvent,
  GuiSessionSummary,
  OperatorEventDetailItem,
  OperatorSessionEventKind,
  ToolResultPresentation,
  ContextUsageProjection,
  OperatorGovernedWorkExecutionAttempt,
  OperatorGovernedWorkItemProjection,
  OperatorGovernedWorkPauseRequirement,
} from "@kilnai/gateway-contracts";
import {
  formatOperatorEventValue,
  isGuiProviderModeless,
  presentOperatorEventPayload,
  ContextUsageProjectionSchema,
  VerifiedEfficiencyEvidenceProjectionSchema,
  projectOperatorGovernedWorkItemSnapshot,
} from "@kilnai/gateway-contracts";
import {
  deriveSessionContinuity,
  shouldApplySessionScopedFrame as shouldApplyContinuityFrame,
} from "./session-continuity.js";

const BROWSER_STREAM_UNAVAILABLE_REASON = "No live browser stream transport is configured.";
const MAX_LIVE_TOOL_OUTPUT_CHARS = 64 * 1024;
const LIVE_TOOL_OUTPUT_TRUNCATION_MARKER = "… earlier output truncated …\n";

export interface ApprovalRequest {
  readonly id: string;
  readonly description: string;
  readonly sessionId: string;
  readonly requestedAt: string;
}

export type ToolCallStatus = "running" | "success" | "error";

export interface ToolCallEntry {
  readonly callId: string;
  readonly scopeId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly result?: string;
  readonly status: ToolCallStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export type ActivityPhase = "idle" | "thinking" | "tool_running" | "awaiting_approval" | "streaming";

export interface ChangedFileEntry {
  readonly path: string;
  readonly changeType: "created" | "modified" | "deleted";
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
  readonly diffPreview?: string;
  readonly diffTruncated?: boolean;
  readonly recordedAt: string;
}

export type WorkItemEntry = OperatorGovernedWorkItemProjection;
export type WorkItemPauseRequirementEntry = OperatorGovernedWorkPauseRequirement;
export type WorkItemExecutionAttemptEntry = OperatorGovernedWorkExecutionAttempt;

export type ProviderCatalogStatus = GuiProviderCatalogStatus;

type StoreTextDeltaFrame = {
  type: "text_delta";
  content: string;
  kilnSessionId: string;
  turnId?: string;
};

const MAX_DETACHED_SESSION_IDS = 20;

type StoreActivityFrame = {
  type: "activity";
  activity: string;
  kilnSessionId: string;
  toolName?: string;
  output?: string;
  usd?: number;
  input?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  details?: string;
};

const PLAN_MODE_KEY = "kiln.gui.planMode";
const CONTINUATION_TARGET_KEY = "kiln.gui.continuationTarget";
const PROVIDER_SELECTION_KEY = "kiln.gui.providerSelection:v1";
const CLEAR_TIMEOUT_MS = 5_000;
const PROVIDER_SWITCH_TIMEOUT_MS = 5_000;
const PROVIDER_AUTH_TIMEOUT_MS = 15 * 60 * 1000;
let providerSwitchRequestOrdinal = 0;
let providerAuthRequestOrdinal = 0;
let browserInputRequestOrdinal = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function providerAuthDebug(message: string, context?: Record<string, unknown>): void {
  const env = (import.meta as { readonly env?: Record<string, string | undefined> }).env;
  const enabled = /^(1|true|yes)$/i.test(
    env?.VITE_KILN_PROVIDER_AUTH_DEBUG?.trim()
    ?? env?.KILN_PROVIDER_AUTH_DEBUG?.trim()
    ?? "",
  );
  if (!enabled) {
    return;
  }
  console.warn(`[gui-session-store:provider-auth][debug] ${message}`, context ?? {});
}

function createMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readStoredPlanMode(): boolean | null {
  try {
    const value = localStorage.getItem(PLAN_MODE_KEY);
    if (value === null) return null;
    return value === "true";
  } catch {
    return null;
  }
}

function persistPlanMode(value: boolean): void {
  try {
    localStorage.setItem(PLAN_MODE_KEY, value ? "true" : "false");
  } catch {
    // fail-open
  }
}

function readStoredProviderSelection(): { readonly provider: string; readonly model: string | null } | null {
  try {
    const raw = localStorage.getItem(PROVIDER_SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectRecord(parsed)) return null;
    const provider = readString(parsed.provider);
    if (!provider) return null;
    return {
      provider,
      model: readString(parsed.model),
    };
  } catch {
    return null;
  }
}

function writeStoredProviderSelection(provider: string, model: string | null): void {
  try {
    localStorage.setItem(PROVIDER_SELECTION_KEY, JSON.stringify({
      provider,
      ...(model ? { model } : {}),
    }));
  } catch {
    // fail-open
  }
}

function nextProviderSwitchRequestId(): string {
  providerSwitchRequestOrdinal += 1;
  return `provider-switch:${Date.now()}:${providerSwitchRequestOrdinal}`;
}

function nextProviderAuthRequestId(): string {
  providerAuthRequestOrdinal += 1;
  return `provider-auth:${Date.now()}:${providerAuthRequestOrdinal}`;
}

function nextBrowserInputRequestId(): string {
  browserInputRequestOrdinal += 1;
  return `browser-input:${Date.now()}:${browserInputRequestOrdinal}`;
}

function providerRequiresSelectedModelMessage(provider: string): string {
  return `Provider '${provider}' requires a selected model.`;
}

function clearStoredContinuationTarget(): void {
  try {
    localStorage.removeItem(CONTINUATION_TARGET_KEY);
  } catch {
    // fail-open
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : null;
  }
  return null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function appendLiveToolOutput(current: string, delta: string): string {
  const combined = `${current}${delta}`;
  if (combined.length <= MAX_LIVE_TOOL_OUTPUT_CHARS) return combined;
  const retained = combined.slice(-(MAX_LIVE_TOOL_OUTPUT_CHARS - LIVE_TOOL_OUTPUT_TRUNCATION_MARKER.length));
  return `${LIVE_TOOL_OUTPUT_TRUNCATION_MARKER}${retained}`;
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

function syncTimelineMessages(
  timelineEntries: readonly TimelineEntry[],
  messages: readonly Message[],
): readonly TimelineEntry[] {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  return timelineEntries.map((entry) => (
    entry.type === "message"
      ? { ...entry, message: messagesById.get(entry.message.id) ?? entry.message }
      : entry
  ));
}

function eventPayloadText(payload: Record<string, unknown>): string | null {
  const value = payload.content
    ?? payload.output
    ?? payload.outputSummary
    ?? payload.details
    ?? payload.delta
    ?? payload.toolName;
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : null;
  }
  return null;
}

function providerIdentity(payload: Record<string, unknown>): { provider: string | null; model: string | null } {
  const provider = isObjectRecord(payload.provider) ? payload.provider : null;
  return {
    provider: readString(provider?.provider),
    model: readString(provider?.model),
  };
}

function operatorEventSummary(kind: OperatorSessionEventKind, payload: Record<string, unknown>): string {
  const presentation = presentOperatorEventPayload(kind, payload);
  return presentation.summary ?? presentation.compactText ?? presentation.title;
}

function invocationRequestedSummary(payload: Record<string, unknown>): string {
  return operatorEventSummary("agent_invocation_requested", payload);
}

function invocationStartedSummary(payload: Record<string, unknown>): string {
  return operatorEventSummary("agent_invocation_started", payload);
}

function invocationCompletedSummary(payload: Record<string, unknown>): string {
  return operatorEventSummary("agent_invocation_completed", payload);
}

function invocationFailedSummary(payload: Record<string, unknown>): string {
  return operatorEventSummary("agent_invocation_failed", payload);
}

function invocationCancelledSummary(payload: Record<string, unknown>): string {
  return operatorEventSummary("agent_invocation_cancelled", payload);
}

function normalizeLoadedChangeType(value: unknown): ChangedFileEntry["changeType"] | null {
  if (value === "created" || value === "deleted") {
    return value;
  }
  if (value === "updated" || value === "modified" || value === "renamed") {
    return "modified";
  }
  return null;
}

function toolEntryStatus(value: unknown): ToolCallStatus {
  if (value === "succeeded" || value === "success") {
    return "success";
  }
  if (value === "failed" || value === "cancelled" || value === "timed_out" || value === "error") {
    return "error";
  }
  return "running";
}

function toolEntryStatusFromPresentation(value: unknown, tone: TimelineEventEntry["tone"]): ToolCallStatus {
  if (tone === "error") {
    return "error";
  }
  if (tone === "success") {
    return "success";
  }
  return toolEntryStatus(value);
}

function turnOutcomePresentation(outcome: unknown): Pick<TimelineEventEntry, "title" | "tone"> {
  switch (readString(outcome)) {
    case "completed":
      return { title: "Turn completed", tone: "success" };
    case "failed":
      return { title: "Turn failed", tone: "error" };
    case "paused":
      return { title: "Turn paused", tone: "warning" };
    case "cancelled":
      return { title: "Turn cancelled", tone: "info" };
    default:
      return { title: "Invalid turn outcome", tone: "error" };
  }
}

function approvalIdFromDetails(details: unknown): string | null {
  const record = isObjectRecord(details) ? details : null;
  if (!record) return null;
  return readString(record.approvalId);
}

function toolCallIdFromDetails(details: unknown): string | null {
  const record = isObjectRecord(details) ? details : null;
  if (!record) return null;
  return readString(record.toolCallId);
}

function workItemFromPayload(
  payload: Record<string, unknown>,
  previous?: WorkItemEntry,
  sessionId?: string,
  turnId?: string,
): WorkItemEntry | null {
  return projectOperatorGovernedWorkItemSnapshot({
    workItem: payload.workItem,
    evidence: payload,
    ...(previous ? { previous } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(turnId ? { turnId } : {}),
    observedAt: nowIso(),
  });
}

function isWorkItemTimelineEventKind(kind: OperatorSessionEventKind): boolean {
  return kind === "work_item_updated"
    || kind === "work_item_execution_started"
    || kind === "work_item_execution_finished";
}

function isWorkflowLifecycleTimelineEventKind(kind: OperatorSessionEventKind): boolean {
  return kind === "plan_submitted"
    || kind === "plan_analysis_reported"
    || kind === "plan_approved"
    || kind === "goal.created"
    || kind === "goal.updated"
    || kind === "goal.completed"
    || kind === "goal.failed"
    || kind === "goal.cancelled"
    || kind === "work_items.materialized";
}

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

function formatUsd(value: number): string {
  return USD_FORMATTER.format(value);
}

function areSessionSummariesEqual(
  current: readonly GuiSessionSummary[],
  next: readonly GuiSessionSummary[],
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

function toolCallScopeIdFromDetails(details: unknown): string | null {
  const record = isObjectRecord(details) ? details : null;
  if (!record) return null;
  return readString(record.toolCallScopeId);
}

function requiredScopedToolIdentity(
  payload: Record<string, unknown>,
  eventId: string,
): { readonly callId: string; readonly scopeId: string; readonly key: string } {
  const callId = readString(payload.toolCallId);
  const scopeId = readString(payload.toolCallScopeId);
  if (!callId || !scopeId) {
    throw new TypeError(`Tool event "${eventId}" requires scoped tool identity.`);
  }
  return { callId, scopeId, key: `${scopeId}\0${callId}` };
}

function appendSessionEvent(
  events: readonly GuiSessionEvent[],
  event: GuiSessionEvent,
): readonly GuiSessionEvent[] {
  if (events.some((candidate) => candidate.eventId === event.eventId)) {
    return events;
  }
  return [...events, event].toSorted((a, b) => {
    const sequenceCompare = a.sequence - b.sequence;
    return sequenceCompare === 0 ? a.eventId.localeCompare(b.eventId) : sequenceCompare;
  });
}

function canonicalSessionEvents(events: readonly GuiSessionEvent[]): readonly GuiSessionEvent[] {
  return events.reduce<readonly GuiSessionEvent[]>(
    (canonical, event) => appendSessionEvent(canonical, event),
    [],
  );
}

function mapSessionDetailToLoadedState(detail: GuiSessionDetail): {
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
  let lastRoutedProvider = detail.meta.lastProvider ?? null;
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
        title: "Cost updated",
        summary: `${formatUsd(deltaUsd)} · ${inputDelta}↑ ${outputDelta}↓`,
        tone: "info",
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
        routedProvider: detail.meta?.lastProvider,
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

export type SessionStatus = "idle" | "connecting" | "ready" | "running" | "error";

export interface Message {
  readonly id: string;
  readonly role: "user" | "assistant" | "tool" | "error";
  readonly content: string;
  readonly parts?: readonly unknown[];
  readonly sourceMessageId?: string;
  readonly voiceSynthesisStatus?: "idle" | "pending" | "ready" | "error";
  readonly createdAt: string;
  readonly streaming?: boolean;
  readonly routedProvider?: string;
  readonly routedModel?: string;
  readonly routingRationale?: GuiModelRoutingRationale;
  readonly sessionEventMessageId?: string;
}

export interface TimelineMessageEntry {
  readonly id: string;
  readonly type: "message";
  readonly createdAt: string;
  readonly sequence?: number;
  readonly turnId?: string;
  readonly message: Message;
}

export interface TimelineEventEntry {
  readonly id: string;
  readonly type: "event";
  readonly eventKind: GuiSessionEvent["kind"];
  readonly createdAt: string;
  readonly sequence?: number;
  readonly turnId?: string;
  readonly title: string;
  readonly summary?: string;
  readonly tone: "info" | "running" | "success" | "warning" | "error";
  readonly details?: unknown;
  readonly presentationDetails?: readonly OperatorEventDetailItem[];
  readonly toolPresentation?: ToolResultPresentation;
  readonly sessionId?: string;
}

export type TimelineEntry = TimelineMessageEntry | TimelineEventEntry;

function timelineTurnId(event: GuiSessionEvent): { readonly turnId?: string } {
  return event.turnId ? { turnId: event.turnId } : {};
}

function workflowLifecycleTimelineEntry(input: {
  readonly id: string;
  readonly kind: OperatorSessionEventKind;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
  readonly sequence?: number;
  readonly turnId?: string;
}): TimelineEventEntry {
  const presentation = presentOperatorEventPayload(input.kind, input.payload);
  return {
    id: input.id,
    type: "event",
    eventKind: input.kind,
    createdAt: input.timestamp,
    ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    title: presentation.title,
    summary: presentation.summary,
    tone: presentation.tone,
    presentationDetails: presentation.details,
    details: input.payload,
  };
}

function toolNameFromDetails(details: unknown, fallbackTitle: string, fallbackToolName?: string): string {
  const detailRecord = isObjectRecord(details) ? details : null;
  const explicitToolName = readString(detailRecord?.toolName);
  if (explicitToolName) return explicitToolName;
  const titleMatch = /^(?:Tool started:|Tool completed:|Using|Completed)\s+(.+)$/u.exec(fallbackTitle);
  return titleMatch?.[1]?.trim() || fallbackToolName || "tool";
}

function toolInputFromDetails(details: unknown): Record<string, unknown> {
  const detailRecord = isObjectRecord(details) ? details : null;
  if (!detailRecord) return {};
  if (isObjectRecord(detailRecord.input)) return detailRecord.input;
  return Object.fromEntries(
    Object.entries(detailRecord).filter(([key]) => (
      key !== "toolCallId"
      && key !== "toolCallScopeId"
      && key !== "toolName"
      && key !== "status"
      && key !== "result"
    )),
  );
}

export function deriveToolCallLog(entries: readonly TimelineEntry[]): readonly ToolCallEntry[] {
  const toolCalls = new Map<string, ToolCallEntry>();
  for (const entry of entries) {
    if (entry.type !== "event") continue;
    if (entry.eventKind === "tool_call_started") {
      const details = isObjectRecord(entry.details) ? entry.details : {};
      const identity = requiredScopedToolIdentity(details, entry.id);
      const input = toolInputFromDetails(entry.details);
      const toolName = toolNameFromDetails(entry.details, entry.title);
      toolCalls.set(identity.key, {
        callId: identity.callId,
        scopeId: identity.scopeId,
        toolName,
        input,
        status: "running",
        startedAt: entry.createdAt,
      });
      continue;
    }
    if (entry.eventKind === "tool_call_completed") {
      const details = isObjectRecord(entry.details) ? entry.details : null;
      const identity = requiredScopedToolIdentity(details ?? {}, entry.id);
      const previous = toolCalls.get(identity.key);
      toolCalls.set(identity.key, {
        callId: identity.callId,
        scopeId: identity.scopeId,
        toolName: toolNameFromDetails(details, entry.title, previous?.toolName),
        input: isObjectRecord(details?.input) ? details.input : previous?.input ?? {},
        result: readString(details?.result) ?? entry.summary ?? undefined,
        status: toolEntryStatusFromPresentation(details?.status, entry.tone) === "running" ? "error" : toolEntryStatusFromPresentation(details?.status, entry.tone),
        startedAt: previous?.startedAt ?? entry.createdAt,
        completedAt: entry.createdAt,
      });
    }
  }
  return [...toolCalls.values()];
}

export function derivePendingApprovals(entries: readonly TimelineEntry[]): readonly ApprovalRequest[] {
  const pending = new Map<string, ApprovalRequest>();
  for (const entry of entries) {
    if (entry.type !== "event") continue;
    if (entry.eventKind === "approval_requested") {
      const approvalId = approvalIdFromDetails(entry.details) ?? entry.id;
      pending.set(approvalId, {
        id: approvalId,
        description: entry.summary ?? entry.title,
        sessionId: entry.sessionId ?? "",
        requestedAt: entry.createdAt,
      });
      continue;
    }
    if (entry.eventKind === "approval_resolved") {
      const approvalId = approvalIdFromDetails(entry.details);
      if (approvalId) {
        pending.delete(approvalId);
        continue;
      }
      if (entry.sessionId) {
        for (const [key, value] of pending.entries()) {
          if (value.sessionId === entry.sessionId) {
            pending.delete(key);
          }
        }
      }
    }
  }
  return [...pending.values()];
}

export function deriveChangedFiles(entries: readonly TimelineEntry[]): readonly ChangedFileEntry[] {
  const changedFiles: ChangedFileEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "event" || entry.eventKind !== "file_changed") {
      continue;
    }
    const details = isObjectRecord(entry.details) ? entry.details : null;
    const path = readString(details?.path);
    const changeType = normalizeLoadedChangeType(details?.changeType);
    if (!path || !changeType) {
      continue;
    }
    changedFiles.push({
      path,
      changeType,
      linesAdded: readNumber(details?.linesAdded) ?? undefined,
      linesRemoved: readNumber(details?.linesRemoved) ?? undefined,
      diffPreview: readString(details?.diffPreview) ?? undefined,
      diffTruncated: typeof details?.diffTruncated === "boolean" ? details.diffTruncated : undefined,
      recordedAt: entry.createdAt,
    });
  }
  return changedFiles;
}

export function deriveWorkItems(entries: readonly TimelineEntry[]): readonly WorkItemEntry[] {
  const items = new Map<string, WorkItemEntry>();
  for (const entry of entries) {
    if (entry.type !== "event" || !isWorkItemTimelineEventKind(entry.eventKind)) {
      continue;
    }
    const payload = isObjectRecord(entry.details) ? entry.details : null;
    if (!payload) {
      continue;
    }
    const workItemId = readString(isObjectRecord(payload.workItem) ? payload.workItem.id : undefined);
    const itemKey = workItemId ? `${entry.sessionId ?? ""}\u001f${workItemId}` : undefined;
    const item = workItemFromPayload(
      payload,
      itemKey ? items.get(itemKey) : undefined,
      entry.sessionId,
      entry.turnId,
    );
    if (item) {
      items.set(`${item.sessionId ?? ""}\u001f${item.id}`, item);
    }
  }
  return [...items.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export interface ActivityState {
  readonly phase?: string;
  readonly toolName?: string;
  readonly details?: string;
}

export interface ProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly group: "subscription" | "harness" | "direct-api";
  readonly free: boolean;
  readonly available: boolean;
  readonly models: readonly string[];
  readonly status?: string;
  readonly reason?: string;
  readonly authState?: string;
  readonly lastCheckedAt?: string;
}

export type AuthorityStatus = GuiAuthorityStatus;

function readAuthorityStatus(value: unknown): AuthorityStatus | null {
  const record = isObjectRecord(value) ? value : null;
  if (!record) {
    return null;
  }
  const effective = record.effective;
  const completeness = record.completeness;
  if (
    (
      effective === "fail_closed"
      || effective === "read_only"
      || effective === "idempotent"
      || effective === "audited"
      || effective === "destructive"
      || effective === "unknown"
    )
    && (completeness === "authoritative" || completeness === "partial")
  ) {
    const admittedAuthority = record.admittedAuthority;
    const requestedAuthority = record.requestedAuthority;
    const executionMode = record.executionMode;
    const sandboxProjection = record.sandboxProjection;
    const reason = readString(record.reason);
    const toolCount = readNumber(record.toolCount);
    const deniedToolCount = readNumber(record.deniedToolCount);
    return {
      effective,
      ...(admittedAuthority === "fail_closed"
        || admittedAuthority === "read_only"
        || admittedAuthority === "idempotent"
        || admittedAuthority === "audited"
        || admittedAuthority === "destructive"
        || admittedAuthority === "unknown"
        ? { admittedAuthority }
        : {}),
      ...(requestedAuthority === "planning"
        || requestedAuthority === "auto"
        || requestedAuthority === "read_only"
        || requestedAuthority === "audited"
        || requestedAuthority === "destructive"
        ? { requestedAuthority }
        : {}),
      ...(executionMode === "execute" || executionMode === "plan" ? { executionMode } : {}),
      ...(sandboxProjection === "none"
        || sandboxProjection === "read_only"
        || sandboxProjection === "workspace_write"
        || sandboxProjection === "unknown"
        ? { sandboxProjection }
        : {}),
      ...(reason ? { reason } : {}),
      ...(typeof toolCount === "number" ? { toolCount } : {}),
      ...(typeof deniedToolCount === "number" ? { deniedToolCount } : {}),
      completeness,
    };
  }
  return null;
}

function normalizeProviderDescriptors(
  providers: readonly Partial<ProviderDescriptor>[],
): ProviderDescriptor[] {
  const providersById = new Map<string, ProviderDescriptor>();
  for (const provider of providers) {
    if (!provider || typeof provider !== "object") continue;
    const candidate = provider as Partial<ProviderDescriptor>;
    if (
      typeof candidate.id !== "string"
      || typeof candidate.label !== "string"
      || (candidate.group !== "subscription" && candidate.group !== "harness" && candidate.group !== "direct-api")
      || typeof candidate.free !== "boolean"
      || typeof candidate.available !== "boolean"
      || !Array.isArray(candidate.models)
    ) {
      continue;
    }
    const models = candidate.models.flatMap((model) => {
      if (typeof model !== "string") {
        return [];
      }
      const normalized = model.trim();
      return normalized.length > 0 ? [normalized] : [];
    });
    providersById.set(candidate.id, {
      id: candidate.id,
      label: candidate.label,
      group: candidate.group,
      free: candidate.free,
      available: candidate.available && (models.length > 0 || isGuiProviderModeless(candidate.id)),
      models,
      ...(typeof candidate.status === "string" ? { status: candidate.status } : {}),
      ...(typeof candidate.reason === "string" ? { reason: candidate.reason } : {}),
      ...(typeof candidate.authState === "string" ? { authState: candidate.authState } : {}),
      ...(typeof candidate.lastCheckedAt === "string" ? { lastCheckedAt: candidate.lastCheckedAt } : {}),
    });
  }
  return Array.from(providersById.values());
}

function providerSelectionEligibility(
  provider: ProviderDescriptor,
  model: string | null,
  discovery: GuiProviderModelDiscoveryProjection | null | undefined,
): { readonly eligible: boolean; readonly reasonCodes: readonly string[] } {
  if (!provider.available) {
    return { eligible: false, reasonCodes: [] };
  }
  if (isGuiProviderModeless(provider.id) && provider.models.length === 0) {
    return { eligible: model === null, reasonCodes: [] };
  }
  if (!discovery) {
    return {
      eligible: false,
      reasonCodes: ["canonical provider model discovery is unavailable"],
    };
  }
  const entry = model === null
    ? undefined
    : discovery.entries.find((candidate) => (
        candidate.providerRoute.providerId === provider.id
        && candidate.providerRoute.providerModelId === model
      ));
  return entry?.eligibility ?? {
    eligible: false,
    reasonCodes: ["not present in canonical provider model discovery"],
  };
}

function providerSupportsSelection(
  provider: ProviderDescriptor,
  model: string | null,
  discovery: GuiProviderModelDiscoveryProjection | null | undefined,
): boolean {
  return providerSelectionEligibility(provider, model, discovery).eligible;
}

function providerSelectionFailureMessage(
  provider: ProviderDescriptor,
  model: string | null,
  discovery: GuiProviderModelDiscoveryProjection | null | undefined,
): string {
  if (!providerHasSelectableSurface(provider)) {
    return `${provider.label} is unavailable.`;
  }
  const reasonCodes = providerSelectionEligibility(provider, model, discovery).reasonCodes;
  if (reasonCodes.length > 0) {
    const selection = model === null ? provider.label : `${provider.label} model ${model}`;
    return `${selection} is not eligible: ${reasonCodes.join(", ")}.`;
  }
  if (model === null && provider.models.length > 0) {
    return providerRequiresSelectedModelMessage(provider.id);
  }
  return `${provider.label} does not advertise the requested model.`;
}

function providerHasSelectableSurface(provider: ProviderDescriptor): boolean {
  return provider.available && (provider.models.length > 0 || isGuiProviderModeless(provider.id));
}

function resolveStoredProviderSelectionRestore(
  state: SessionStoreState,
  options: { readonly allowActiveOverride?: boolean } = {},
): { readonly provider: string; readonly model: string | null } | null {
  if (
    state.providerSwitching
    || state.providerCatalogStatus !== "ready"
    || !state.outboundSend
  ) {
    return null;
  }
  const stored = readStoredProviderSelection();
  if (!stored) {
    return null;
  }
  const provider = state.providers.find((candidate) => candidate.id === stored.provider);
  if (!provider || !providerSupportsSelection(provider, stored.model, state.providerModelDiscovery)) {
    return null;
  }
  if (!options.allowActiveOverride && (state.activeProvider || state.providerExplicitSelection)) {
    return null;
  }
  if (options.allowActiveOverride && state.activeProvider === stored.provider && state.activeModel === stored.model) {
    return null;
  }
  return stored;
}

function shouldApplySessionScopedFrame(
  state: SessionStoreState,
  kilnSessionId: string,
): boolean {
  return shouldApplyContinuityFrame(deriveContinuityFromState(state), kilnSessionId);
}

function deriveContinuityFromState(state: SessionStoreState) {
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

function appendDetachedSessionId(
  ids: readonly string[],
  sessionId: string | null,
): readonly string[] {
  if (!sessionId || ids.includes(sessionId)) {
    return ids;
  }
  return [...ids, sessionId].slice(-MAX_DETACHED_SESSION_IDS);
}

function interactiveSnapshotFromPersistedToolEvent(
  sessionId: string,
  event: GuiSessionEvent,
  payload: Record<string, unknown>,
  status: Record<string, unknown> | null,
): GuiInteractiveUseSnapshot | null {
  const metadata = isObjectRecord(payload.metadata) ? payload.metadata : null;
  if (!metadata || metadata.kind !== "interactive") {
    return null;
  }
  const target = readInteractiveTarget(metadata.target);
  if (!target) {
    return null;
  }
  const observation = isObjectRecord(metadata.observation) ? metadata.observation : {};
  return {
    target,
    status: readInteractiveStatus(status?.state),
    updatedAt: event.timestamp,
    kilnSessionId: sessionId,
    ...stringField("toolCallId", readString(payload.toolCallId)),
    ...stringField("toolCallScopeId", readString(payload.toolCallScopeId)),
    ...stringField("toolName", readString(payload.toolName)),
    ...stringField("provider", readString(metadata.provider)),
    ...stringField("sessionId", readString(metadata.sessionId)),
    ...stringField("operation", readString(metadata.operation)),
    ...stringField("url", readString(observation.url)),
    ...stringField("title", readString(observation.title)),
    ...stringField("visibleText", readString(observation.visibleText)),
    ...stringField("windowTitle", readString(observation.windowTitle)),
    ...stringField("application", readString(observation.application)),
    ...stringField("closeMethod", readString(observation.closeMethod)),
    ...stringField("screenshotUri", readString(observation.screenshotUri)),
    ...stringField("screenshotDataUrl", readString(observation.screenshotDataUrl)),
    ...stringField("error", readString(payload.output)),
  };
}

function browserSessionStateFromSnapshot(
  snapshot: GuiInteractiveUseSnapshot | null,
): GuiBrowserSessionState | null {
  if (!snapshot || snapshot.target !== "browser") {
    return null;
  }
  return {
    target: "browser",
    status: snapshot.status,
    updatedAt: snapshot.updatedAt,
    ...(snapshot.kilnSessionId ? { kilnSessionId: snapshot.kilnSessionId } : {}),
    ...(snapshot.toolCallId ? { toolCallId: snapshot.toolCallId } : {}),
    ...(snapshot.toolCallScopeId ? { toolCallScopeId: snapshot.toolCallScopeId } : {}),
    ...(snapshot.toolName ? { toolName: snapshot.toolName } : {}),
    ...(snapshot.provider ? { provider: snapshot.provider } : {}),
    ...(snapshot.sessionId ? { sessionId: snapshot.sessionId } : {}),
    ...(snapshot.operation ? { operation: snapshot.operation } : {}),
    ...(snapshot.url ? { url: snapshot.url } : {}),
    ...(snapshot.title ? { title: snapshot.title } : {}),
    ...(snapshot.visibleText ? { visibleText: snapshot.visibleText } : {}),
    ownership: snapshot.operation === "session_stop" ? "released" : "agent",
    viewMode: "snapshot",
    stream: {
      status: "unavailable",
      reason: BROWSER_STREAM_UNAVAILABLE_REASON,
    },
    ...browserCaptureField(snapshot.screenshotUri),
    ...(snapshot.actionSummary ? { actionSummary: snapshot.actionSummary } : {}),
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}

function browserCaptureField(
  screenshotUri: string | undefined,
): { readonly latestCapture: GuiBrowserSessionCapture } | Record<string, never> {
  return screenshotUri ? { latestCapture: { uri: screenshotUri, relation: "snapshot" } } : {};
}

function readInteractiveTarget(value: unknown): GuiInteractiveUseSnapshot["target"] | null {
  return value === "browser" || value === "computer" ? value : null;
}

function readInteractiveStatus(value: unknown): GuiInteractiveUseSnapshot["status"] {
  return value === "failed" ? "failed" : value === "running" ? "running" : "succeeded";
}

function stringField<TName extends string>(name: TName, value: string | null): Record<TName, string> | Record<string, never> {
  return value ? { [name]: value } as Record<TName, string> : {};
}

function areProviderDescriptorsEqual(
  current: readonly ProviderDescriptor[],
  next: readonly ProviderDescriptor[],
): boolean {
  if (current.length !== next.length) {
    return false;
  }
  for (let index = 0; index < current.length; index += 1) {
    const left = current[index];
    const right = next[index];
    if (!left || !right) {
      return false;
    }
    if (
      left.id !== right.id
      || left.label !== right.label
      || left.group !== right.group
      || left.free !== right.free
      || left.available !== right.available
      || left.status !== right.status
      || left.reason !== right.reason
      || left.authState !== right.authState
      || left.lastCheckedAt !== right.lastCheckedAt
      || left.models.length !== right.models.length
    ) {
      return false;
    }
    for (let modelIndex = 0; modelIndex < left.models.length; modelIndex += 1) {
      if (left.models[modelIndex] !== right.models[modelIndex]) {
        return false;
      }
    }
  }
  return true;
}

interface ProviderSwitchTarget {
  readonly provider: string;
  readonly model: string | null;
  readonly requestId: string;
}

interface ProviderAuthTarget {
  readonly provider: string;
  readonly requestId: string;
}

export type ProviderAuthDetails =
  | {
      readonly method: "browser_oauth";
      readonly authorizationUri: string;
    }
  | {
      readonly method: "device_code";
      readonly verificationUri: string;
      readonly userCode: string;
    };

export type RouteMode = "user" | "auto" | "responding";

interface SessionStoreState {
  readonly status: SessionStatus;
  readonly messages: readonly Message[];
  readonly timelineEntries: readonly TimelineEntry[];
  readonly sessionEvents: readonly GuiSessionEvent[];
  readonly currentAssistant: string | null;
  readonly planMode: boolean;
  readonly activity: ActivityState | null;
  readonly errorBanner: string | null;
  readonly providerCatalogStatus: ProviderCatalogStatus;
  readonly providerCatalogError: string | null;
  readonly providers: readonly ProviderDescriptor[];
  readonly providerDiscovery: readonly GuiProviderDiscoveryResult[];
  readonly providerModelDiscovery: GuiProviderModelDiscoveryProjection | null;
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly sessionList: readonly GuiSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly liveSessionId: string | null;
  readonly continuationTargetId: string | null;
  readonly detachedSessionIds: readonly string[];
  readonly routedProvider: string | null;
  readonly routedModel: string | null;
  readonly routeMode: RouteMode;
  readonly respondingProvider: string | null;
  readonly respondingModel: string | null;
  readonly turnCounter: number;
  readonly sessionCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly currentTurnTrackedInputTokens: number;
  readonly currentTurnTrackedOutputTokens: number;
  readonly clearPending: boolean;
  readonly turnCancelPending: boolean;
  readonly goalControlPending: {
    readonly requestId: string;
    readonly goalRunId: string;
    readonly action: "pause" | "resume" | "update_objective" | "cancel";
  } | null;
  readonly providerSwitching: boolean;
  readonly providerSwitchTarget: ProviderSwitchTarget | null;
  readonly providerAuthenticating: boolean;
  readonly providerAuthTarget: ProviderAuthTarget | null;
  readonly providerAuthMessage: string | null;
  readonly providerAuthDetails: ProviderAuthDetails | null;
  readonly providerExplicitSelection: boolean;
  readonly authorityStatus: AuthorityStatus | null;
  readonly contextUsage: ContextUsageProjection | null;
  readonly interactiveUseSnapshot: GuiInteractiveUseSnapshot | null;
  readonly browserSessionState: GuiBrowserSessionState | null;
  readonly browserLiveViewportFrame: GuiBrowserLiveViewportFrame | null;
  readonly browserOperatorInputAck: GuiBrowserOperatorInputAckFrame | null;
  readonly outboundSend: ((frame: GuiOutboundFrame) => void) | null;
  readonly clearTimeoutId: ReturnType<typeof setTimeout> | null;
  readonly providerSwitchTimeoutId: ReturnType<typeof setTimeout> | null;
  readonly providerAuthTimeoutId: ReturnType<typeof setTimeout> | null;
  readonly activityPhase: ActivityPhase;
}

interface SessionStoreActions {
  setConnectionStatus: (status: SessionStatus) => void;
  setSender: (send: ((frame: GuiOutboundFrame) => void) | null) => void;
  setSessionList: (sessions: readonly GuiSessionSummary[]) => void;
  setSelectedSessionId: (sessionId: string | null) => void;
  viewSessionDetail: (detail: GuiSessionDetail) => void;
  setErrorBanner: (message: string | null) => void;
  clearErrorBanner: () => void;
  markProviderCatalogRefreshing: () => void;
  markProviderCatalogError: (message: string) => void;
  onWelcome: (frame: Extract<GuiInboundFrame, { type: "welcome" }>) => void;
  onProvidersRefreshed: (
    providers: readonly ProviderDescriptor[],
    providerDiscovery?: readonly GuiProviderDiscoveryResult[],
    providerModelDiscovery?: GuiProviderModelDiscoveryProjection,
  ) => void;
  onSessionEvent: (event: GuiSessionEvent) => void;
  onTextDelta: (frame: StoreTextDeltaFrame) => void;
  onActivity: (frame: StoreActivityFrame) => void;
  onDone: (frame: Extract<GuiInboundFrame, { type: "done" }>) => void;
  onTurnCancelResult: (frame: Extract<GuiInboundFrame, { type: "turn_cancel_result" }>) => void;
  onGoalControlResult: (frame: Extract<GuiInboundFrame, { type: "goal_control_result" }>) => void;
  onVoiceSynthesisCompleted: (frame: Extract<GuiInboundFrame, { type: "voice_synthesis_completed" }>) => void;
  onVoiceSynthesisFailed: (frame: Extract<GuiInboundFrame, { type: "voice_synthesis_failed" }>) => void;
  onError: (frame: Extract<GuiInboundFrame, { type: "error" }>) => void;
  onCleared: () => void;
  onProviderChanged: (frame: Extract<GuiInboundFrame, { type: "provider_changed" }>) => void;
  onProviderAuthStarted: (frame: Extract<GuiInboundFrame, { type: "provider_auth_started" }>) => void;
  onProviderAuthCompleted: (frame: Extract<GuiInboundFrame, { type: "provider_auth_completed" }>) => void;
  onProviderAuthFailed: (frame: Extract<GuiInboundFrame, { type: "provider_auth_failed" }>) => void;
  onExecConfirmed: () => void;
  switchProvider: (provider: string, model?: string) => boolean;
  authenticateProvider: (provider: string, options?: { apiKey?: string; tier?: "go" | "zen" }) => boolean;
  sendMessage: (
    text: string,
    options?: {
      parts?: readonly unknown[];
      displayContent?: string;
      reasoningEffort?: GuiProviderReasoningEffort;
      requestedAuthority?: OperatorTurnRequestedAuthority;
      governedWorkRequirement?: OperatorGoalMaterializationRequirement;
      gatewayTargetId?: string;
      appName?: string;
      tenantId?: string;
    },
  ) => boolean;
  requestVoiceSynthesis: (messageId: string) => boolean;
  sendClear: () => boolean;
  cancelActiveTurn: () => boolean;
  controlGoal: (input: {
    readonly goalRunId: string;
    readonly action: "pause" | "resume" | "update_objective" | "cancel";
    readonly objective?: string;
    readonly reason?: string;
  }) => boolean;
  setPlanMode: (enabled: boolean, options?: { readonly gatewayTargetId?: string }) => void;
  setContinuation: (sessionId: string | null) => void;
  disconnect: () => void;
  onInteractiveUseUpdated: (frame: Extract<GuiInboundFrame, { type: "interactive_use_updated" }>) => void;
  onBrowserSessionUpdated: (frame: Extract<GuiInboundFrame, { type: "browser_session_updated" }>) => void;
  onBrowserLiveViewportFrame: (frame: Extract<GuiInboundFrame, { type: "browser_live_viewport_frame" }>) => void;
  onBrowserOperatorInputAck: (frame: Extract<GuiInboundFrame, { type: "browser_operator_input_ack" }>) => void;
  sendBrowserOperatorInput: (
    request: {
      readonly sessionId: string;
      readonly gatewayTargetId?: string;
      readonly input: GuiBrowserOperatorInput;
    },
  ) => boolean;
  requestBrowserSessionControl: (
    action: "takeover" | "release",
    options?: { readonly gatewayTargetId?: string; readonly sessionId?: string; readonly reason?: string },
  ) => boolean;
  onActivityPhase: (frame: Extract<GuiInboundFrame, { type: "activity_phase" }>) => void;
  sendApprovalResponse: (
    approved: boolean,
    reason: string | undefined,
    approvalId: string,
    options?: { readonly gatewayTargetId?: string },
  ) => boolean;
}

export type SessionStore = SessionStoreState & SessionStoreActions;

const initialPlanMode = readStoredPlanMode() ?? false;

export const useSessionStore = create<SessionStore>((set, get) => ({
  status: "idle",
  messages: [],
  timelineEntries: [],
  sessionEvents: [],
  currentAssistant: null,
  planMode: initialPlanMode,
  activity: null,
  errorBanner: null,
  providerCatalogStatus: "pending",
  providerCatalogError: null,
  providers: [],
  providerDiscovery: [],
  providerModelDiscovery: null,
  activeProvider: null,
  activeModel: null,
  sessionList: [],
  selectedSessionId: null,
  liveSessionId: null,
  continuationTargetId: null,
  detachedSessionIds: [],
  routedProvider: null,
  routedModel: null,
  routeMode: "auto",
  respondingProvider: null,
  respondingModel: null,
  turnCounter: 0,
  sessionCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  currentTurnTrackedInputTokens: 0,
  currentTurnTrackedOutputTokens: 0,
  clearPending: false,
  turnCancelPending: false,
  goalControlPending: null,
  providerSwitching: false,
  providerSwitchTarget: null,
  providerAuthenticating: false,
  providerAuthTarget: null,
  providerAuthMessage: null,
  providerAuthDetails: null,
  providerExplicitSelection: false,
  authorityStatus: null,
  contextUsage: null,
  interactiveUseSnapshot: null,
  browserSessionState: null,
  browserLiveViewportFrame: null,
  browserOperatorInputAck: null,
  outboundSend: null,
  clearTimeoutId: null,
  providerSwitchTimeoutId: null,
  providerAuthTimeoutId: null,
  activityPhase: "idle",

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

  setSessionList: (sessions) => {
    const state = get();
    const selected = state.selectedSessionId;
    const selectedStillExists = selected ? sessions.some((session) => session.id === selected) : false;
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
    set({
      sessionList: sessions,
      selectedSessionId: nextSelectedSessionId,
      continuationTargetId: nextContinuationTargetId,
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

  setErrorBanner: (message) => {
    set({ errorBanner: message });
  },

  clearErrorBanner: () => {
    set({ errorBanner: null });
  },

  markProviderCatalogRefreshing: () => {
    set({
      providerCatalogStatus: "refreshing",
      providerCatalogError: null,
    });
  },

  markProviderCatalogError: (message) => {
    set({
      providerCatalogStatus: "error",
      providerCatalogError: message,
    });
  },

  onWelcome: (frame) => {
    const current = get();
    if (current.providerSwitchTimeoutId) {
      clearTimeout(current.providerSwitchTimeoutId);
    }
    if (current.providerAuthTimeoutId) {
      clearTimeout(current.providerAuthTimeoutId);
    }
    const providers = normalizeProviderDescriptors(frame.providers ?? []);
    const explicitActiveProvider = readString(frame.activeProvider);
    const explicitActiveModel = readString(frame.activeModel);
    const requestedModel = explicitActiveModel ?? null;
    const activeProviderDescriptor = explicitActiveProvider
      ? providers.find((provider) => (
        provider.id === explicitActiveProvider
          && providerSupportsSelection(provider, requestedModel, frame.providerModelDiscovery)
      ))
      : undefined;
    const activeProvider = activeProviderDescriptor ? explicitActiveProvider ?? null : null;
    const activeModel = activeProviderDescriptor ? requestedModel : null;
    const persistedPlanMode = readStoredPlanMode();
    const welcomePlanMode = frame.executionMode ? frame.executionMode === "plan" : undefined;
    const resolvedPlanMode = persistedPlanMode ?? welcomePlanMode ?? current.planMode;
    const explicitSelection = Boolean(activeProvider);
    clearStoredContinuationTarget();

    set({
      providers,
      providerDiscovery: frame.providerDiscovery ?? current.providerDiscovery,
      providerModelDiscovery: frame.providerModelDiscovery,
      providerCatalogStatus: "ready",
      providerCatalogError: null,
      activeProvider,
      activeModel,
      authorityStatus: frame.authorityStatus ?? current.authorityStatus,
      planMode: resolvedPlanMode,
      routeMode: explicitSelection ? "user" : "auto",
      providerExplicitSelection: explicitSelection,
      continuationTargetId: current.continuationTargetId,
      status: "ready",
      errorBanner: explicitActiveProvider && !activeProviderDescriptor
        ? (() => {
            const provider = providers.find((candidate) => candidate.id === explicitActiveProvider);
            return provider
              ? providerSelectionFailureMessage(provider, requestedModel, frame.providerModelDiscovery)
              : `${explicitActiveProvider} is unavailable.`;
          })()
        : null,
      providerSwitching: false,
      providerSwitchTarget: null,
      providerSwitchTimeoutId: null,
      providerAuthenticating: false,
      providerAuthTarget: null,
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: null,
    });
    persistPlanMode(resolvedPlanMode);
    const restore = resolveStoredProviderSelectionRestore(get(), { allowActiveOverride: true });
    if (restore) {
      get().switchProvider(restore.provider, restore.model ?? undefined);
    } else if (activeProvider) {
      writeStoredProviderSelection(activeProvider, activeModel);
    } else {
      const stored = readStoredProviderSelection();
      const storedProvider = stored
        ? providers.find((provider) => provider.id === stored.provider)
        : undefined;
      if (stored && storedProvider && !providerSupportsSelection(
        storedProvider,
        stored.model,
        frame.providerModelDiscovery,
      )) {
        set({
          errorBanner: providerSelectionFailureMessage(
            storedProvider,
            stored.model,
            frame.providerModelDiscovery,
          ),
        });
      }
    }
  },

  onProvidersRefreshed: (nextProviders, nextProviderDiscovery, nextProviderModelDiscovery) => {
    const current = get();
    const providers = normalizeProviderDescriptors(nextProviders);
    const activeProvider = current.activeProvider;
    const activeModel = current.activeModel;
    const requestedModel = activeModel ?? null;
    const activeStillAvailable = activeProvider
      ? providers.some((provider) => (
        provider.id === activeProvider
          && providerSupportsSelection(
            provider,
            requestedModel,
            nextProviderModelDiscovery ?? current.providerModelDiscovery,
          )
      ))
      : false;
    const nextActiveProvider = activeStillAvailable ? activeProvider : null;
    const nextActiveModel = activeStillAvailable ? activeModel : null;
    const nextProviderExplicitSelection = activeStillAvailable && current.providerExplicitSelection;
    const nextRouteMode = nextProviderExplicitSelection ? "user" : "auto";

    if (
      areProviderDescriptorsEqual(current.providers, providers)
      && current.activeProvider === nextActiveProvider
      && current.activeModel === nextActiveModel
      && current.providerExplicitSelection === nextProviderExplicitSelection
      && current.routeMode === nextRouteMode
      && (nextProviderModelDiscovery === undefined
        || current.providerModelDiscovery === nextProviderModelDiscovery)
    ) {
      return;
    }

    set({
      providers,
      providerDiscovery: nextProviderDiscovery ?? current.providerDiscovery,
      providerModelDiscovery: nextProviderModelDiscovery ?? current.providerModelDiscovery,
      providerCatalogStatus: "ready",
      providerCatalogError: null,
      activeProvider: nextActiveProvider,
      activeModel: nextActiveModel,
      routeMode: nextRouteMode,
      providerExplicitSelection: nextProviderExplicitSelection,
      errorBanner: activeProvider && !activeStillAvailable
        ? (() => {
            const provider = providers.find((candidate) => candidate.id === activeProvider);
            return provider
              ? providerSelectionFailureMessage(
                  provider,
                  requestedModel,
                  nextProviderModelDiscovery ?? current.providerModelDiscovery,
                )
              : `${activeProvider} is unavailable.`;
          })()
        : current.errorBanner,
    });

    const restore = resolveStoredProviderSelectionRestore(get());
    if (restore) {
      get().switchProvider(restore.provider, restore.model ?? undefined);
    }
  },

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

    if (event.kind === "assistant_delta") {
      const delta = readString(payload.delta) ?? eventPayloadText(payload);
      if (delta) {
        state.onTextDelta({
          type: "text_delta",
          content: delta,
          kilnSessionId: event.kilnSessionId,
          ...(event.turnId ? { turnId: event.turnId } : {}),
        });
      }
      return;
    }

    if (event.kind === "provider_routed") {
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
      return;
    }

    if (event.kind === "tool_call_started") {
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
      return;
    }

    if (event.kind === "tool_call_output_delta") {
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
      return;
    }

    if (event.kind === "tool_call_completed") {
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
      return;
    }

    if (event.kind === "approval_requested") {
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
      return;
    }

    if (event.kind === "approval_resolved") {
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
      return;
    }

    if (event.kind === "file_changed") {
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
      return;
    }

    if (event.kind === "context_usage_observed") {
      const parsed = ContextUsageProjectionSchema.safeParse(payload.contextUsage);
      if (parsed.success) {
        set({ contextUsage: parsed.data });
      }
      return;
    }

    if (event.kind === "cost_updated") {
      const cost = isObjectRecord(payload.cost) ? payload.cost : null;
      const usage = isObjectRecord(payload.usage) ? payload.usage : null;
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
            title: "Cost updated",
            summary: `${formatUsd(readNumber(cost?.deltaUsd) ?? 0)} · ${readNumber(usage?.inputTokens) ?? 0}↑ ${readNumber(usage?.outputTokens) ?? 0}↓`,
            tone: "info",
            details: {
              provider: providerIdentity(payload),
              usage,
              cost,
            },
          },
        ],
      });
      return;
    }

    if (event.kind === "lifecycle_attribution_recorded") {
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
      return;
    }

    if (isWorkItemTimelineEventKind(event.kind)) {
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
      return;
    }

    if (isWorkflowLifecycleTimelineEventKind(event.kind)) {
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
      return;
    }

    if (event.kind === "agent_invocation_requested") {
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
      return;
    }

    if (event.kind === "agent_invocation_started") {
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
      return;
    }

    if (event.kind === "agent_invocation_completed") {
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
      return;
    }

    if (event.kind === "agent_invocation_failed") {
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
      return;
    }

    if (event.kind === "agent_invocation_cancelled") {
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
      return;
    }

    if (event.kind === "continuity_decided") {
      const provider = state.respondingProvider ?? state.activeProvider;
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
      return;
    }

    if (event.kind === "turn_completed") {
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
        routeMode: current.providerExplicitSelection ? "user" : "auto",
        respondingProvider: null,
        respondingModel: null,
        currentTurnTrackedInputTokens: 0,
        currentTurnTrackedOutputTokens: 0,
        turnCounter: current.turnCounter + 1,
        clearPending: false,
      });
      return;
    }

    if (event.kind === "error_recorded") {
      const message = readString(payload.message);
      if (message) {
        state.onError({
          type: "error",
          message,
          code: readString(payload.errorCode) ?? undefined,
        });
      }
      return;
    }
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
      set({ status: "running", activityPhase: "streaming", errorBanner: null });
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
      set({ messages: messageList, timelineEntries, status: "running", activityPhase: "streaming", errorBanner: null });
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
      errorBanner: null,
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

    const nextRespondingProvider = current.respondingProvider ?? current.activeProvider;
    const nextRespondingModel = current.respondingModel ?? current.activeModel;

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
    const finalizedProvider = frame.routedProvider ?? state.respondingProvider ?? state.activeProvider ?? undefined;
    const finalizedModel = frame.routedModel ?? state.respondingModel ?? state.activeModel ?? undefined;
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
      routeMode: state.providerExplicitSelection ? "user" : "auto",
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
      set({ turnCancelPending: true, errorBanner: null });
      return;
    }
    set({
      turnCancelPending: false,
      ...(frame.status === "failed"
        ? { errorBanner: frame.reason ?? "The active turn could not be cancelled." }
        : state.status === "running"
          ? { status: "ready" as const, activity: null, activityPhase: "idle" as const }
          : {}),
    });
  },

  onVoiceSynthesisCompleted: (frame) => {
    const state = get();
    const nextMessages = state.messages.map((message) => (
      message.sourceMessageId === frame.sourceMessageId
        ? {
            ...message,
            parts: frame.parts,
            voiceSynthesisStatus: "ready" as const,
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
          }
        : message
    ));
    set({
      messages: nextMessages,
      timelineEntries: syncTimelineMessages(state.timelineEntries, nextMessages),
      errorBanner: frame.message,
    });
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
      errorBanner: null,
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

  onProviderChanged: (frame) => {
    const state = get();
    const nextModel = readString(frame.model) ?? null;
    if (
      !state.providerSwitching
      || !state.providerSwitchTarget
    ) {
      return;
    }
    if (
      state.providerSwitchTarget.provider !== frame.provider
      || state.providerSwitchTarget.model !== nextModel
      || state.providerSwitchTarget.requestId !== frame.requestId
    ) {
      if (state.providerSwitchTimeoutId) {
        clearTimeout(state.providerSwitchTimeoutId);
      }
      set({
        providerSwitching: false,
        providerSwitchTarget: null,
        providerSwitchTimeoutId: null,
        errorBanner: "Provider switch acknowledgement did not match the pending request.",
      });
      return;
    }
    // The pending switch target was validated before sending. Dashboard provider
    // discovery can refresh while the runtime acknowledgement is in flight.
    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }
    set({
      activeProvider: frame.provider,
      activeModel: nextModel,
      routeMode: "user",
      providerExplicitSelection: true,
      providerSwitching: false,
      providerSwitchTarget: null,
      providerSwitchTimeoutId: null,
      respondingProvider: state.status === "running" ? state.respondingProvider : null,
      respondingModel: state.status === "running" ? state.respondingModel : null,
    });
    writeStoredProviderSelection(frame.provider, nextModel);
  },

  onProviderAuthStarted: (frame) => {
    const state = get();
    if (
      !state.providerAuthenticating
      || !state.providerAuthTarget
      || state.providerAuthTarget.provider !== frame.provider
      || state.providerAuthTarget.requestId !== frame.requestId
    ) {
      providerAuthDebug("ignored started frame without matching pending request", {
        provider: frame.provider,
        requestId: frame.requestId,
        pendingProvider: state.providerAuthTarget?.provider,
        pendingRequestId: state.providerAuthTarget?.requestId,
        providerAuthenticating: state.providerAuthenticating,
      });
      return;
    }
    providerAuthDebug("started frame accepted", {
      provider: frame.provider,
      requestId: frame.requestId,
      method: frame.method,
      ...(frame.method === "browser_oauth"
        ? { authorizationUri: frame.authorizationUri }
        : {
            verificationUri: frame.verificationUri,
            hasUserCode: frame.userCode.trim().length > 0,
          }),
      message: frame.message,
    });
    set({
      providerAuthMessage: frame.message ?? "Complete provider sign-in, then return to Kiln.",
      providerAuthDetails: frame.method === "browser_oauth"
        ? { method: "browser_oauth", authorizationUri: frame.authorizationUri }
        : {
            method: "device_code",
            verificationUri: frame.verificationUri,
            userCode: frame.userCode,
          },
      errorBanner: null,
    });
  },

  onProviderAuthCompleted: (frame) => {
    const state = get();
    if (
      !state.providerAuthenticating
      || !state.providerAuthTarget
      || state.providerAuthTarget.provider !== frame.provider
      || state.providerAuthTarget.requestId !== frame.requestId
    ) {
      providerAuthDebug("ignored completed frame without matching pending request", {
        provider: frame.provider,
        requestId: frame.requestId,
        pendingProvider: state.providerAuthTarget?.provider,
        pendingRequestId: state.providerAuthTarget?.requestId,
        providerAuthenticating: state.providerAuthenticating,
      });
      return;
    }
    providerAuthDebug("completed frame accepted", {
      provider: frame.provider,
      requestId: frame.requestId,
      providerCount: frame.providers?.length,
      modelCount: frame.models?.[frame.provider]?.length,
      discovery: frame.providerDiscovery?.find((entry) => entry.provider === frame.provider),
    });
    if (state.providerAuthTimeoutId) {
      clearTimeout(state.providerAuthTimeoutId);
    }
    set({
      providers: normalizeProviderDescriptors(frame.providers ?? state.providers),
      providerDiscovery: frame.providerDiscovery ?? state.providerDiscovery,
      providerModelDiscovery: frame.providerModelDiscovery,
      providerCatalogStatus: "ready",
      providerCatalogError: null,
      providerAuthenticating: false,
      providerAuthTarget: null,
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: null,
      errorBanner: null,
    });
  },

  onProviderAuthFailed: (frame) => {
    const state = get();
    if (
      !state.providerAuthenticating
      || !state.providerAuthTarget
      || state.providerAuthTarget.provider !== frame.provider
      || state.providerAuthTarget.requestId !== frame.requestId
    ) {
      providerAuthDebug("ignored failed frame without matching pending request", {
        provider: frame.provider,
        requestId: frame.requestId,
        pendingProvider: state.providerAuthTarget?.provider,
        pendingRequestId: state.providerAuthTarget?.requestId,
        providerAuthenticating: state.providerAuthenticating,
        message: frame.message,
      });
      return;
    }
    providerAuthDebug("failed frame accepted", {
      provider: frame.provider,
      requestId: frame.requestId,
      message: frame.message,
    });
    if (state.providerAuthTimeoutId) {
      clearTimeout(state.providerAuthTimeoutId);
    }
    set({
      providerAuthenticating: false,
      providerAuthTarget: null,
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: null,
      errorBanner: frame.message,
    });
  },

  onExecConfirmed: () => {
    persistPlanMode(false);
    set({ planMode: false, status: "ready", errorBanner: null });
  },

  switchProvider: (provider, model) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) {
      return false;
    }
    if (state.providerCatalogStatus !== "ready") {
      set({
        errorBanner: state.providerCatalogStatus === "error"
          ? state.providerCatalogError ?? "Provider catalog is unavailable. Refresh providers and retry."
          : "Provider catalog is still loading. Please retry once startup completes.",
      });
      return false;
    }

    const targetProvider = state.providers.find((candidate) => candidate.id === provider);
    if (!targetProvider) {
      if (!state.providerSwitching) {
        set({
          providerSwitching: false,
          providerSwitchTarget: null,
          providerSwitchTimeoutId: null,
          errorBanner: `${provider} is unavailable.`,
        });
      }
      return false;
    }
    const normalizedModel = readString(model) ?? null;
    if (!providerSupportsSelection(targetProvider, normalizedModel, state.providerModelDiscovery)) {
      if (!state.providerSwitching) {
        set({
          providerSwitching: false,
          providerSwitchTarget: null,
          providerSwitchTimeoutId: null,
          errorBanner: providerSelectionFailureMessage(
            targetProvider,
            normalizedModel,
            state.providerModelDiscovery,
          ),
        });
      }
      return false;
    }

    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }

    const requestId = nextProviderSwitchRequestId();
    const timeoutId = setTimeout(() => {
      const latest = get();
      if (!latest.providerSwitching) return;
      set({
        providerSwitching: false,
        providerSwitchTarget: null,
        providerSwitchTimeoutId: null,
        errorBanner: "Provider switch timed out. Please retry.",
      });
    }, PROVIDER_SWITCH_TIMEOUT_MS);

    set({
      providerSwitching: true,
      providerSwitchTarget: { provider, model: normalizedModel, requestId },
      providerSwitchTimeoutId: timeoutId,
      errorBanner: null,
    });

    try {
      outboundSend({
        type: "provider",
        provider,
        ...(normalizedModel ? { model: normalizedModel } : {}),
        requestId,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      set({
        providerSwitching: false,
        providerSwitchTarget: null,
        providerSwitchTimeoutId: null,
        errorBanner: error instanceof Error ? error.message : "Provider switch failed.",
      });
      return false;
    }

    return true;
  },

  authenticateProvider: (provider, options = {}) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) {
      return false;
    }
    if (state.providerAuthTimeoutId) {
      clearTimeout(state.providerAuthTimeoutId);
    }
    const requestId = nextProviderAuthRequestId();
    const timeoutId = setTimeout(() => {
      const latest = get();
      if (!latest.providerAuthenticating) return;
      providerAuthDebug("timed out waiting for provider auth completion", {
        provider,
        requestId,
      });
      set({
        providerAuthenticating: false,
        providerAuthTarget: null,
        providerAuthMessage: null,
        providerAuthDetails: null,
        providerAuthTimeoutId: null,
        errorBanner: "Provider authentication timed out. Please retry.",
      });
    }, PROVIDER_AUTH_TIMEOUT_MS);

    set({
      providerAuthenticating: true,
      providerAuthTarget: { provider, requestId },
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: timeoutId,
      errorBanner: null,
    });

    try {
      providerAuthDebug("sending provider_auth frame", {
        provider,
        requestId,
        hasApiKey: Boolean(options.apiKey),
        tier: options.tier,
      });
      outboundSend({
        type: "provider_auth",
        provider,
        requestId,
        ...(provider === "codex-oauth" ? { flow: "browser" as const } : {}),
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(options.tier ? { tier: options.tier } : {}),
      });
    } catch (error) {
      clearTimeout(timeoutId);
      providerAuthDebug("failed to send provider_auth frame", {
        provider,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      set({
        providerAuthenticating: false,
        providerAuthTarget: null,
        providerAuthMessage: null,
        providerAuthDetails: null,
        providerAuthTimeoutId: null,
        errorBanner: error instanceof Error ? error.message : "Provider authentication failed.",
      });
      return false;
    }
    return true;
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
      respondingProvider: state.activeProvider,
      respondingModel: state.activeModel,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
      contextUsage: null,
      errorBanner: null,
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
      ...(options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options?.requestedAuthority ? { requestedAuthority: options.requestedAuthority } : {}),
      ...(options?.governedWorkRequirement ? { governedWorkRequirement: options.governedWorkRequirement } : {}),
      ...(options?.gatewayTargetId ? { gatewayTargetId: options.gatewayTargetId } : {}),
      ...(options?.appName ? { appName: options.appName } : {}),
      ...(options?.tenantId ? { tenantId: options.tenantId } : {}),
    });

    return true;
  },

  requestVoiceSynthesis: (messageId) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) {
      return false;
    }
    const target = state.messages.find((message) => message.id === messageId);
    if (!target || target.role !== "assistant" || !target.sourceMessageId || target.voiceSynthesisStatus === "pending") {
      return false;
    }

    const requestId = createMessageId();
    const nextMessages = state.messages.map((message) => (
      message.id === messageId
        ? { ...message, voiceSynthesisStatus: "pending" as const }
        : message
    ));
    set({
      messages: nextMessages,
      timelineEntries: syncTimelineMessages(state.timelineEntries, nextMessages),
      errorBanner: null,
    });
    outboundSend({
      type: "voice_synthesis_request",
      requestId,
      sourceMessageId: target.sourceMessageId,
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
    set({ turnCancelPending: true, errorBanner: null });
    return true;
  },

  controlGoal: (input) => {
    const state = get();
    if (!state.outboundSend || state.goalControlPending) {
      return false;
    }
    const requestId = createMessageId();
    state.outboundSend({
      type: "goal_control",
      requestId,
      goalRunId: input.goalRunId,
      action: input.action,
      ...(input.objective ? { objective: input.objective } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    });
    set({
      goalControlPending: {
        requestId,
        goalRunId: input.goalRunId,
        action: input.action,
      },
      errorBanner: null,
    });
    return true;
  },

  onGoalControlResult: (frame) => {
    const pending = get().goalControlPending;
    if (!pending || pending.requestId !== frame.requestId) return;
    set({
      goalControlPending: null,
      ...(frame.status === "failed" ? { errorBanner: frame.reason ?? "Goal control failed." } : {}),
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
        errorBanner: "Clear session timed out. Please retry.",
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
      errorBanner: null,
    });
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

  setContinuation: (sessionId) => {
    clearStoredContinuationTarget();
    set({
      continuationTargetId: sessionId,
    });
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

  onBrowserOperatorInputAck: (frame) => {
    set({ browserOperatorInputAck: frame });
  },

  sendBrowserOperatorInput: (request) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) {
      return false;
    }
    outboundSend({
      type: "browser_operator_input",
      requestId: nextBrowserInputRequestId(),
      ...(request.gatewayTargetId ? { gatewayTargetId: request.gatewayTargetId } : {}),
      sessionId: request.sessionId,
      input: request.input,
    });
    return true;
  },

  requestBrowserSessionControl: (action, options = {}) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) {
      return false;
    }
    outboundSend({
      type: "browser_session_control",
      action,
      ...(options.gatewayTargetId ? { gatewayTargetId: options.gatewayTargetId } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    });
    return true;
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

  sendApprovalResponse: (approved, reason, approvalId, options = {}) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) return false;
    if (approved) {
      outboundSend({
        type: "approve",
        approvalId,
        ...(options.gatewayTargetId ? { gatewayTargetId: options.gatewayTargetId } : {}),
      });
    } else {
      outboundSend({
        type: "reject",
        reason: reason ?? "rejected by user",
        approvalId,
        ...(options.gatewayTargetId ? { gatewayTargetId: options.gatewayTargetId } : {}),
      });
    }
    return true;
  },
}));
