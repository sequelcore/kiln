import { create } from "zustand";
import type {
  GuiInboundFrame,
  GuiOutboundFrame,
  GuiSessionDetail,
  GuiSessionEvent,
  GuiSessionSummary,
} from "@kilnai/gateway-contracts";

export interface ApprovalRequest {
  readonly id: string;
  readonly description: string;
  readonly sessionId: string;
  readonly requestedAt: string;
}

export type ToolCallStatus = "running" | "success" | "error";

export interface ToolCallEntry {
  readonly callId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly result?: string;
  readonly status: ToolCallStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export type ActivityPhase = "idle" | "thinking" | "tool_running" | "awaiting_approval" | "streaming";

export interface RuntimeContinuityInfo {
  readonly strategy: string;
  readonly feedbackLabel?: string;
  readonly pressure?: string;
  readonly supportArtifactCount?: number;
  readonly supportArtifactSources?: readonly string[];
  readonly fallbackLabel?: string;
  readonly usedCachedSupport?: boolean;
  readonly selectionReason?: string;
}

export interface ChangedFileEntry {
  readonly path: string;
  readonly changeType: "created" | "modified" | "deleted";
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
  readonly diffPreview?: string;
  readonly diffTruncated?: boolean;
  readonly recordedAt: string;
}

type StoreTextDeltaFrame = {
  type: "text_delta";
  content: string;
};

type StoreActivityFrame = {
  type: "activity";
  activity: string;
  toolName?: string;
  output?: string;
  usd?: number;
  input?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  details?: string;
};

const PLAN_MODE_KEY = "kiln.gui.planMode";
const RESUME_TARGET_KEY = "kiln.gui.resumeTarget";
const CLEAR_TIMEOUT_MS = 5_000;
const PROVIDER_SWITCH_TIMEOUT_MS = 5_000;

function nowIso(): string {
  return new Date().toISOString();
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

function readResumeTarget(): string | null {
  try {
    return localStorage.getItem(RESUME_TARGET_KEY);
  } catch {
    return null;
  }
}

function writeResumeTarget(sessionId: string | null): void {
  try {
    if (!sessionId) {
      localStorage.removeItem(RESUME_TARGET_KEY);
      return;
    }
    localStorage.setItem(RESUME_TARGET_KEY, sessionId);
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

function eventPayloadText(payload: Record<string, unknown>): string | null {
  const value = payload.content
    ?? payload.text
    ?? payload.message
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

function invocationLabel(payload: Record<string, unknown>): string {
  return readString(payload.agentName) ?? readString(payload.agentId) ?? "agent";
}

function invocationRequestedSummary(payload: Record<string, unknown>): string {
  const label = invocationLabel(payload);
  const invocationId = readString(payload.invocationId);
  const requestedBy = readString(payload.requestedBy);
  const requestSource = readString(payload.requestSource);
  const by = [requestedBy, requestSource].filter((value): value is string => Boolean(value)).join(" · ");
  return [label, invocationId ? `#${invocationId}` : null, by ? `by ${by}` : null]
    .filter((value): value is string => Boolean(value))
    .join(" · ") || "Invocation requested";
}

function invocationStartedSummary(payload: Record<string, unknown>): string {
  const base = invocationRequestedSummary(payload);
  const attempt = readNumber(payload.attempt);
  return attempt !== null ? `${base} · attempt ${attempt}` : base;
}

function invocationCompletedSummary(payload: Record<string, unknown>): string {
  const resultSummary = readString(payload.resultSummary);
  if (resultSummary) {
    return resultSummary;
  }
  const durationMs = readNumber(payload.durationMs);
  return durationMs !== null
    ? `${invocationLabel(payload)} · ${durationMs}ms`
    : invocationLabel(payload);
}

function invocationFailedSummary(payload: Record<string, unknown>): string {
  return readString(payload.errorMessage)
    ?? readString(payload.errorCode)
    ?? `${invocationLabel(payload)} failed`;
}

function invocationCancelledSummary(payload: Record<string, unknown>): string {
  return readString(payload.reason)
    ?? readString(payload.cancelledBy)
    ?? `${invocationLabel(payload)} cancelled`;
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

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
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

function providerFromTimelineDetails(details: unknown): string | null {
  const record = isObjectRecord(details) ? details : null;
  if (!record) {
    return null;
  }
  const routedProvider = readString(record.routedProvider);
  if (routedProvider) {
    return routedProvider;
  }
  const provider = record.provider;
  if (isObjectRecord(provider)) {
    return readString(provider.provider);
  }
  return readString(record.provider);
}

function mapSessionDetailToLoadedState(detail: GuiSessionDetail): {
  readonly messages: readonly Message[];
  readonly timelineEntries: readonly TimelineEntry[];
  readonly sessionCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly turnCounter: number;
  readonly routedProvider: string | null;
  readonly routedModel: string | null;
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
        id: `${detail.id}:timeline:${event.sequence}`,
        type: "message",
        createdAt: event.timestamp,
        sequence: event.sequence,
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
        id: `${detail.id}:timeline:${event.sequence}`,
        type: "message",
        createdAt: event.timestamp,
        sequence: event.sequence,
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
        id: `${detail.id}:timeline:${event.sequence}`,
        type: "message",
        createdAt: event.timestamp,
        sequence: event.sequence,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
      const toolCallId = readString(payload.toolCallId) ?? event.eventId;
      const toolName = readString(payload.toolName) ?? "tool";
      const input = isObjectRecord(payload.input) ? payload.input : {};
      toolCalls.set(toolCallId, {
        callId: toolCallId,
        toolName,
        input,
        status: "running",
        startedAt: event.timestamp,
      });
      timelineEntries.push({
        id: `${detail.id}:timeline:${event.sequence}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: `Tool started: ${toolName}`,
        summary: "Execution in progress",
        tone: "running",
        details: {
          toolCallId,
          ...input,
        },
      });
      continue;
    }

    if (event.kind === "tool_call_completed") {
      const toolCallId = readString(payload.toolCallId) ?? event.eventId;
      const toolName = readString(payload.toolName) ?? toolCalls.get(toolCallId)?.toolName ?? "tool";
      const status = isObjectRecord(payload.status) ? payload.status : null;
      toolCalls.set(toolCallId, {
        callId: toolCallId,
        toolName,
        input: toolCalls.get(toolCallId)?.input ?? {},
        result: eventPayloadText(payload) ?? undefined,
        status: toolEntryStatus(status?.state),
        startedAt: toolCalls.get(toolCallId)?.startedAt ?? event.timestamp,
        completedAt: event.timestamp,
      });
      timelineEntries.push({
        id: `${detail.id}:timeline:${event.sequence}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: `Tool completed: ${toolName}`,
        summary: eventPayloadText(payload) ?? undefined,
        tone: toolEntryStatus(status?.state) === "success" ? "success" : "error",
        details: {
          toolCallId,
          input: toolCalls.get(toolCallId)?.input ?? {},
          result: eventPayloadText(payload) ?? undefined,
          status: status?.state,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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

    if (event.kind === "agent_invocation_requested") {
      timelineEntries.push({
        id: `${detail.id}:timeline:${event.sequence}`,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
      turnCounter += 1;
      timelineEntries.push({
        id: `${detail.id}:timeline:${event.sequence}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
        title: "Turn completed",
        summary: readString(payload.outcome) ?? undefined,
        tone: "success",
        details: payload,
      });
      continue;
    }

    if (event.kind === "approval_requested") {
      timelineEntries.push({
        id: `${detail.id}:timeline:${event.sequence}`,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
    sessionCostUsd,
    inputTokens,
    outputTokens,
    turnCounter,
    routedProvider: lastRoutedProvider,
    routedModel: lastRoutedModel,
  };
}

export type SessionStatus = "idle" | "connecting" | "ready" | "running" | "error";

export interface Message {
  readonly id: string;
  readonly role: "user" | "assistant" | "tool" | "error";
  readonly content: string;
  readonly createdAt: string;
  readonly streaming?: boolean;
  readonly routedProvider?: string;
  readonly routedModel?: string;
  readonly sessionEventMessageId?: string;
}

export interface TimelineMessageEntry {
  readonly id: string;
  readonly type: "message";
  readonly createdAt: string;
  readonly sequence?: number;
  readonly message: Message;
}

export interface TimelineEventEntry {
  readonly id: string;
  readonly type: "event";
  readonly eventKind: GuiSessionEvent["kind"];
  readonly createdAt: string;
  readonly sequence?: number;
  readonly title: string;
  readonly summary?: string;
  readonly tone: "info" | "running" | "success" | "warning" | "error";
  readonly details?: unknown;
  readonly sessionId?: string;
}

export type TimelineEntry = TimelineMessageEntry | TimelineEventEntry;

export function deriveToolCallLog(entries: readonly TimelineEntry[]): readonly ToolCallEntry[] {
  const toolCalls = new Map<string, ToolCallEntry>();
  for (const entry of entries) {
    if (entry.type !== "event") continue;
    if (entry.eventKind === "tool_call_started") {
      const callId = toolCallIdFromDetails(entry.details) ?? entry.id;
      const input = isObjectRecord(entry.details) ? entry.details : {};
      const toolName = entry.title.replace(/^Tool started:\s*/, "") || "tool";
      toolCalls.set(callId, {
        callId,
        toolName,
        input,
        status: "running",
        startedAt: entry.createdAt,
      });
      continue;
    }
    if (entry.eventKind === "tool_call_completed") {
      const details = isObjectRecord(entry.details) ? entry.details : null;
      const callId = toolCallIdFromDetails(details) ?? entry.id;
      const previous = toolCalls.get(callId);
      toolCalls.set(callId, {
        callId,
        toolName: entry.title.replace(/^Tool completed:\s*/, "") || previous?.toolName || "tool",
        input: isObjectRecord(details?.input) ? details.input : previous?.input ?? {},
        result: readString(details?.result) ?? entry.summary ?? undefined,
        status: toolEntryStatus(details?.status) === "running" ? "error" : toolEntryStatus(details?.status),
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

export function deriveRuntimeContinuityByProvider(entries: readonly TimelineEntry[]): Readonly<Record<string, RuntimeContinuityInfo>> {
  const runtimeContinuityByProvider: Record<string, RuntimeContinuityInfo> = {};
  for (const entry of entries) {
    if (entry.type !== "event") {
      continue;
    }
    if (entry.eventKind === "continuity_decided") {
      const details = isObjectRecord(entry.details) ? entry.details : null;
      const provider = providerFromTimelineDetails(details);
      const strategy = readString(details?.decision);
      if (!provider || !strategy) {
        continue;
      }
      runtimeContinuityByProvider[provider] = {
        strategy,
        selectionReason: readString(details?.reason) ?? undefined,
      };
      continue;
    }
    if (entry.eventKind === "turn_completed") {
      const details = isObjectRecord(entry.details) ? entry.details : null;
      const provider = providerFromTimelineDetails(details);
      const runtimeContinuity = isObjectRecord(details?.runtimeContinuity) ? details.runtimeContinuity : null;
      const strategy = readString(runtimeContinuity?.strategy);
      if (!provider || !strategy) {
        continue;
      }
      runtimeContinuityByProvider[provider] = {
        strategy,
        feedbackLabel: readString(runtimeContinuity?.feedbackLabel) ?? undefined,
        pressure: readString(runtimeContinuity?.pressure) ?? undefined,
        supportArtifactCount: readNumber(runtimeContinuity?.supportArtifactCount) ?? undefined,
        supportArtifactSources: Array.isArray(runtimeContinuity?.supportArtifactSources)
          ? runtimeContinuity.supportArtifactSources.filter((value): value is string => typeof value === "string")
          : undefined,
        fallbackLabel: readString(runtimeContinuity?.fallbackLabel) ?? undefined,
        usedCachedSupport: typeof runtimeContinuity?.usedCachedSupport === "boolean" ? runtimeContinuity.usedCachedSupport : undefined,
        selectionReason: readString(runtimeContinuity?.selectionReason) ?? undefined,
      };
    }
  }
  return runtimeContinuityByProvider;
}

export function deriveRuntimeContinuity(entries: readonly TimelineEntry[], provider: string | null): RuntimeContinuityInfo | null {
  if (!provider) {
    return null;
  }
  return deriveRuntimeContinuityByProvider(entries)[provider] ?? null;
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
}

export interface AuthorityStatus {
  readonly effective: "fail_closed" | "read_only" | "idempotent" | "audited" | "destructive" | "unknown";
  readonly completeness: "authoritative" | "partial";
}

export type RouteMode = "user" | "auto" | "responding";

interface SessionStoreState {
  readonly status: SessionStatus;
  readonly messages: readonly Message[];
  readonly timelineEntries: readonly TimelineEntry[];
  readonly currentAssistant: string | null;
  readonly planMode: boolean;
  readonly activity: ActivityState | null;
  readonly errorBanner: string | null;
  readonly providers: readonly ProviderDescriptor[];
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly sessionList: readonly GuiSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly resumeTargetId: string | null;
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
  readonly providerSwitching: boolean;
  readonly providerExplicitSelection: boolean;
  readonly authorityStatus: AuthorityStatus | null;
  readonly outboundSend: ((frame: GuiOutboundFrame) => void) | null;
  readonly clearTimeoutId: ReturnType<typeof setTimeout> | null;
  readonly providerSwitchTimeoutId: ReturnType<typeof setTimeout> | null;
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
  onWelcome: (frame: Extract<GuiInboundFrame, { type: "welcome" }>) => void;
  onSessionEvent: (event: GuiSessionEvent) => void;
  onTextDelta: (frame: StoreTextDeltaFrame) => void;
  onActivity: (frame: StoreActivityFrame) => void;
  onDone: (frame: Extract<GuiInboundFrame, { type: "done" }>) => void;
  onError: (frame: Extract<GuiInboundFrame, { type: "error" }>) => void;
  onCleared: () => void;
  onProviderChanged: (frame: Extract<GuiInboundFrame, { type: "provider_changed" }>) => void;
  onExecConfirmed: () => void;
  switchProvider: (provider: string, model?: string) => boolean;
  sendMessage: (text: string) => boolean;
  sendClear: () => boolean;
  setPlanMode: (enabled: boolean) => void;
  setResume: (sessionId: string | null) => void;
  disconnect: () => void;
  onActivityPhase: (frame: Extract<GuiInboundFrame, { type: "activity_phase" }>) => void;
  sendApprovalResponse: (approved: boolean, reason?: string, sessionId?: string) => boolean;
}

export type SessionStore = SessionStoreState & SessionStoreActions;

const initialPlanMode = readStoredPlanMode() ?? false;

export const useSessionStore = create<SessionStore>((set, get) => ({
  status: "idle",
  messages: [],
  timelineEntries: [],
  currentAssistant: null,
  planMode: initialPlanMode,
  activity: null,
  errorBanner: null,
  providers: [],
  activeProvider: null,
  activeModel: null,
  sessionList: [],
  selectedSessionId: null,
  resumeTargetId: null,
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
  providerSwitching: false,
  providerExplicitSelection: false,
  authorityStatus: null,
  outboundSend: null,
  clearTimeoutId: null,
  providerSwitchTimeoutId: null,
  activityPhase: "idle",

  setConnectionStatus: (status) => {
    set({ status });
  },

  setSender: (send) => {
    set({ outboundSend: send });
  },

  setSessionList: (sessions) => {
    const state = get();
    const selected = state.selectedSessionId;
    const selectedStillExists = selected ? sessions.some((session) => session.id === selected) : false;
    const nextSelectedSessionId = selectedStillExists ? selected : null;
    if (
      state.selectedSessionId === nextSelectedSessionId
      && areSessionSummariesEqual(state.sessionList, sessions)
    ) {
      return;
    }
    set({
      sessionList: sessions,
      selectedSessionId: nextSelectedSessionId,
    });
  },

  setSelectedSessionId: (sessionId) => {
    set({ selectedSessionId: sessionId });
  },

  viewSessionDetail: (detail) => {
    const loaded = mapSessionDetailToLoadedState(detail);
    writeResumeTarget(detail.id);
    set({
      selectedSessionId: detail.id,
      resumeTargetId: detail.id,
      messages: loaded.messages,
      timelineEntries: loaded.timelineEntries,
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

  onWelcome: (frame) => {
    const providersFromWelcome: ProviderDescriptor[] = [];
    for (const provider of frame.providers ?? []) {
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
      providersFromWelcome.push({
        id: candidate.id,
        label: candidate.label,
        group: candidate.group,
        free: candidate.free,
        available: candidate.available,
        models: candidate.models.filter((model): model is string => typeof model === "string"),
      });
    }
    const providersFromModels = Object.keys(frame.models ?? {});
    const providers = providersFromWelcome.length > 0
      ? providersFromWelcome
      : providersFromModels.map((providerId) => ({
          id: providerId,
          label: providerId,
          group: "direct-api" as const,
          free: false,
          available: true,
          models: frame.models?.[providerId] ?? [],
        }));
    const providerById = new Map(providers.map((provider) => [provider.id, provider] as const));
    const activeProvider =
      frame.activeProvider
      ?? providers[0]?.id
      ?? providersFromModels[0]
      ?? get().activeProvider
      ?? null;
    const activeModel =
      frame.activeModel
      ?? (activeProvider ? (providerById.get(activeProvider)?.models[0] ?? frame.models?.[activeProvider]?.[0] ?? null) : null)
      ?? get().activeModel
      ?? null;
    const persistedPlanMode = readStoredPlanMode();
    const resolvedPlanMode = persistedPlanMode ?? frame.planMode ?? get().planMode;
    const persistedResume = readResumeTarget();
    const explicitSelection = Boolean(frame.activeProvider) || get().providerExplicitSelection;

    set({
      providers,
      activeProvider,
      activeModel,
      authorityStatus: frame.authorityStatus ?? get().authorityStatus,
      planMode: resolvedPlanMode,
      routeMode: explicitSelection ? "user" : "auto",
      providerExplicitSelection: explicitSelection,
      resumeTargetId: persistedResume,
      status: "ready",
      errorBanner: null,
    });
    persistPlanMode(resolvedPlanMode);
  },

  onSessionEvent: (event) => {
    const state = get();
    const payload = isObjectRecord(event.payload) ? event.payload : {};

    if (event.kind === "assistant_delta") {
      const delta = readString(payload.delta) ?? eventPayloadText(payload);
      if (delta) {
        state.onTextDelta({ type: "text_delta", content: delta });
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
      const toolName = readString(payload.toolName) ?? "tool";
      const input = isObjectRecord(payload.input) ? payload.input : {};
      set({
        timelineEntries: [
          ...get().timelineEntries,
          {
            id: `timeline:${event.eventId}`,
            type: "event",
            eventKind: event.kind,
            createdAt: event.timestamp,
            sequence: event.sequence,
            title: `Tool started: ${toolName}`,
            summary: "Execution in progress",
            tone: "running",
            details: {
              toolCallId: readString(payload.toolCallId) ?? event.eventId,
              ...input,
            },
          },
        ],
        activity: {
          phase: "tool_running",
          toolName,
        },
      });
      return;
    }

    if (event.kind === "tool_call_completed") {
      const status = isObjectRecord(payload.status) ? payload.status : null;
      const completedStatus = status?.state === "succeeded" || status?.state === "success" ? "success" : "error";
      const priorToolCalls = deriveToolCallLog(get().timelineEntries);
      const priorInput = priorToolCalls.find((entry) => entry.callId === (readString(payload.toolCallId) ?? event.eventId))?.input ?? {};
      set({
        timelineEntries: [
          ...get().timelineEntries,
          {
            id: `timeline:${event.eventId}`,
            type: "event",
            eventKind: event.kind,
            createdAt: event.timestamp,
            sequence: event.sequence,
            title: `Tool completed: ${readString(payload.toolName) ?? "tool"}`,
            summary: eventPayloadText(payload) ?? undefined,
            tone: completedStatus === "success" ? "success" : "error",
            details: {
              toolCallId: readString(payload.toolCallId) ?? event.eventId,
              input: priorInput,
              result: eventPayloadText(payload) ?? undefined,
              status: status?.state,
            },
          },
        ],
        activity: null,
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

    if (event.kind === "cost_updated") {
      const cost = isObjectRecord(payload.cost) ? payload.cost : null;
      const usage = isObjectRecord(payload.usage) ? payload.usage : null;
      state.onActivity({
        type: "activity",
        activity: "cost_update",
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
    const messageList = [...state.messages];
    const timelineEntries = [...state.timelineEntries];
    const existingId = state.currentAssistant;
    const targetIndex = existingId
      ? messageList.findIndex((message) => message.id === existingId)
      : -1;

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
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
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
    const finalizedProvider = frame.routedProvider ?? state.respondingProvider ?? state.activeProvider ?? undefined;
    const finalizedModel = frame.routedModel ?? state.respondingModel ?? state.activeModel ?? undefined;

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

    let nextMessages = [...state.messages];
    let nextTimelineEntries = [...state.timelineEntries];
    if (state.currentAssistant) {
      nextMessages = nextMessages.map((message) => (
        message.id === state.currentAssistant
          ? {
              ...message,
              streaming: false,
              routedProvider: finalizedProvider,
              routedModel: finalizedModel,
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
    } else if (frame.content.trim().length > 0) {
      const assistantMessage: Message = {
        id: createMessageId(),
        role: "assistant",
        content: frame.content,
        createdAt: nowIso(),
        streaming: false,
        routedProvider: finalizedProvider,
        routedModel: finalizedModel,
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
        title: "Turn completed",
        summary: finalizedProvider ? [finalizedProvider, finalizedModel].filter(Boolean).join(" · ") : undefined,
        tone: "success",
        details: {
          routedProvider: finalizedProvider,
          routedModel: finalizedModel,
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
    });
  },

  onError: (frame) => {
    const state = get();
    if (state.clearTimeoutId) {
      clearTimeout(state.clearTimeoutId);
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
      clearTimeoutId: null,
    });
  },

  onCleared: () => {
    const state = get();
    if (state.clearTimeoutId) {
      clearTimeout(state.clearTimeoutId);
    }
    writeResumeTarget(null);
    set({
      messages: [],
      timelineEntries: [],
      currentAssistant: null,
      status: "ready",
      activity: null,
      activityPhase: "idle",
      errorBanner: null,
      selectedSessionId: null,
      resumeTargetId: null,
      routedProvider: null,
      routedModel: null,
      routeMode: state.providerExplicitSelection ? "user" : "auto",
      respondingProvider: null,
      respondingModel: null,
      sessionCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
      clearPending: false,
      clearTimeoutId: null,
    });
  },

  onProviderChanged: (frame) => {
    const state = get();
    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }
    set({
      activeProvider: frame.provider,
      activeModel: frame.model ?? null,
      routeMode: "user",
      providerExplicitSelection: true,
      providerSwitching: false,
      providerSwitchTimeoutId: null,
      respondingProvider: null,
      respondingModel: null,
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

    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }

    outboundSend({
      type: "provider",
      provider,
      model: model ?? undefined,
    });

    const timeoutId = setTimeout(() => {
      const latest = get();
      if (!latest.providerSwitching) return;
      set({
        providerSwitching: false,
        providerSwitchTimeoutId: null,
        errorBanner: "Provider switch timed out. Please retry.",
      });
    }, PROVIDER_SWITCH_TIMEOUT_MS);

    set({
      providerSwitching: true,
      providerSwitchTimeoutId: timeoutId,
      errorBanner: null,
    });

    return true;
  },

  sendMessage: (text) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (state.status !== "ready" || !outboundSend) {
      return false;
    }
    const normalized = text.trim();
    if (!normalized) {
      return false;
    }

    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: normalized,
      createdAt: nowIso(),
    };
    set({
      messages: [...state.messages, userMessage],
      timelineEntries: [
        ...state.timelineEntries,
        {
          id: `timeline:${userMessage.id}`,
          type: "message",
          createdAt: userMessage.createdAt,
          message: userMessage,
        },
      ],
      status: "running",
      activity: { phase: "thinking" },
      activityPhase: "thinking",
      routeMode: "responding",
      respondingProvider: state.activeProvider,
      respondingModel: state.activeModel,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
      errorBanner: null,
      currentAssistant: null,
    });

    outboundSend({
      type: "message",
      text: normalized,
      planMode: state.planMode,
      resumeSessionId: state.resumeTargetId ?? undefined,
    });

    return true;
  },

  sendClear: () => {
    const state = get();
    if (!state.outboundSend || state.clearPending) {
      return false;
    }

    state.outboundSend({ type: "clear" });
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
      clearPending: true,
      clearTimeoutId: timeoutId,
      status: "running",
      errorBanner: null,
    });
    return true;
  },

  setPlanMode: (enabled) => {
    const state = get();
    if (enabled) {
      persistPlanMode(true);
      set({ planMode: true });
      return;
    }
    if (state.planMode && state.outboundSend) {
      state.outboundSend({ type: "exec" });
      return;
    }
    persistPlanMode(false);
    set({ planMode: false });
  },

  setResume: (sessionId) => {
    writeResumeTarget(sessionId);
    set({
      resumeTargetId: sessionId,
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
    set({
      status: "idle",
      activity: null,
      activityPhase: "idle",
      routeMode: state.providerExplicitSelection ? "user" : "auto",
      respondingProvider: null,
      respondingModel: null,
      clearPending: false,
      clearTimeoutId: null,
      providerSwitching: false,
      providerSwitchTimeoutId: null,
    });
  },

  onActivityPhase: (frame) => {
    set({ activityPhase: frame.phase });
  },

  sendApprovalResponse: (approved, reason, sessionId) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) return false;
    if (approved) {
      outboundSend({ type: "approve", sessionId });
    } else {
      outboundSend({ type: "reject", reason: reason ?? "rejected by user", sessionId });
    }
    return true;
  },
}));
