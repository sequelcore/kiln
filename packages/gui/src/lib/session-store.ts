import { create } from "zustand";
import type {
  GuiInboundFrame,
  GuiInteractiveUseSnapshot,
  GuiModelRoutingRationale,
  GuiOutboundFrame,
  GuiProviderCatalogStatus,
  GuiProviderDiscoveryResult,
  GuiProviderReasoningEffort,
  OperatorTurnRequestedAuthority,
  GuiSessionDetail,
  GuiSessionEvent,
  GuiSessionSummary,
  OperatorEventDetailItem,
  OperatorSessionEventKind,
  ToolResultPresentation,
} from "@kilnai/gateway-contracts";
import {
  formatOperatorEventValue,
  isGuiProviderModeless,
  presentOperatorEventPayload,
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

export interface ChangedFileEntry {
  readonly path: string;
  readonly changeType: "created" | "modified" | "deleted";
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
  readonly diffPreview?: string;
  readonly diffTruncated?: boolean;
  readonly recordedAt: string;
}

export interface WorkItemEntry {
  readonly id: string;
  readonly summary: string;
  readonly status: string;
  readonly workflowProfile: string;
  readonly risk?: string;
  readonly surface?: string;
  readonly assignedAgentProfile?: string;
  readonly authorityProfile?: string;
  readonly expectedEvidence: readonly string[];
  readonly providedEvidence: readonly string[];
  readonly verificationGates: readonly string[];
  readonly pauseRequirements?: readonly WorkItemPauseRequirementEntry[];
  readonly executionAttempts?: readonly WorkItemExecutionAttemptEntry[];
  readonly missingEvidence?: readonly string[];
  readonly missingResidualRisk?: boolean;
  readonly updatedAt: string;
}

export interface WorkItemPauseRequirementEntry {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly status: string;
}

export interface WorkItemExecutionAttemptEntry {
  readonly id: string;
  readonly status: string;
  readonly executionMode: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly managedInvocationId?: string;
}

export type ProviderCatalogStatus = GuiProviderCatalogStatus;

type StoreTextDeltaFrame = {
  type: "text_delta";
  content: string;
  turnId?: string;
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
const PROVIDER_SELECTION_KEY = "kiln.gui.providerSelection";
const CLEAR_TIMEOUT_MS = 5_000;
const PROVIDER_SWITCH_TIMEOUT_MS = 5_000;
const PROVIDER_AUTH_TIMEOUT_MS = 15 * 60 * 1000;
let providerSwitchRequestOrdinal = 0;
let providerAuthRequestOrdinal = 0;

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

function providerRequiresSelectedModelMessage(provider: string): string {
  return `Provider '${provider}' requires a selected model.`;
}

function clearStoredResumeTarget(): void {
  try {
    localStorage.removeItem(RESUME_TARGET_KEY);
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

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => readString(entry) ? [readString(entry)!] : [])
    : [];
}

function workItemFromPayload(payload: Record<string, unknown>): WorkItemEntry | null {
  const item = isObjectRecord(payload.workItem) ? payload.workItem : null;
  if (!item) return null;
  const id = readString(item.id);
  const summary = readString(item.summary);
  const status = readString(item.status);
  const workflowProfile = readString(item.workflowProfile);
  if (!id || !summary || !status || !workflowProfile) {
    return null;
  }
  return {
    id,
    summary,
    status,
    workflowProfile,
    risk: readString(item.risk) ?? undefined,
    surface: readString(item.surface) ?? undefined,
    assignedAgentProfile: readString(item.assignedAgentProfile) ?? undefined,
    authorityProfile: readString(item.authorityProfile) ?? undefined,
    expectedEvidence: readStringArray(item.expectedEvidence),
    providedEvidence: readStringArray(item.providedEvidence),
    verificationGates: readStringArray(item.verificationGates),
    pauseRequirements: readWorkItemPauseRequirements(item.pauseRequirements),
    executionAttempts: readWorkItemExecutionAttempts(item.executionAttempts),
    missingEvidence: readStringArray(payload.missingEvidence),
    missingResidualRisk: payload.missingResidualRisk === true,
    updatedAt: readString(item.updatedAt) ?? nowIso(),
  };
}

function readWorkItemPauseRequirements(value: unknown): readonly WorkItemPauseRequirementEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((entry) => {
    const record = isObjectRecord(entry) ? entry : null;
    const id = readString(record?.id);
    const kind = readString(record?.kind);
    const summary = readString(record?.summary);
    const status = readString(record?.status);
    return id && kind && summary && status
      ? [{ id, kind, summary, status }]
      : [];
  });
}

function readWorkItemExecutionAttempts(value: unknown): readonly WorkItemExecutionAttemptEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((entry) => {
    const record = isObjectRecord(entry) ? entry : null;
    const id = readString(record?.id);
    const status = readString(record?.status);
    const executionMode = readString(record?.executionMode);
    return id && status && executionMode
      ? [{
        id,
        status,
        executionMode,
        startedAt: readString(record?.startedAt) ?? undefined,
        completedAt: readString(record?.completedAt) ?? undefined,
        managedInvocationId: readString(record?.managedInvocationId) ?? undefined,
      }]
      : [];
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

function mergeWorkItemEntry(previous: WorkItemEntry | undefined, next: WorkItemEntry): WorkItemEntry {
  return {
    ...next,
    pauseRequirements: next.pauseRequirements ?? previous?.pauseRequirements,
    executionAttempts: next.executionAttempts ?? previous?.executionAttempts,
  };
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

function mapSessionDetailToLoadedState(detail: GuiSessionDetail): {
  readonly messages: readonly Message[];
  readonly timelineEntries: readonly TimelineEntry[];
  readonly interactiveUseSnapshot: GuiInteractiveUseSnapshot | null;
  readonly sessionCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly turnCounter: number;
  readonly routedProvider: string | null;
  readonly routedModel: string | null;
  readonly authorityStatus: AuthorityStatus | null;
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
      const presentation = presentOperatorEventPayload(event.kind, payload);
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
        ...(event.turnId ? { turnId: event.turnId } : {}),
        title: presentation.title,
        summary: presentation.summary,
        tone: presentation.tone,
        presentationDetails: presentation.details,
        toolPresentation: presentation.toolPresentation,
        details: {
          toolCallId,
          toolName,
          input,
        },
      });
      continue;
    }

    if (event.kind === "tool_call_completed") {
      const toolCallId = readString(payload.toolCallId) ?? event.eventId;
      const toolName = readString(payload.toolName) ?? toolCalls.get(toolCallId)?.toolName ?? "tool";
      const status = isObjectRecord(payload.status) ? payload.status : null;
      const presentation = presentOperatorEventPayload(event.kind, payload);
      interactiveUseSnapshot = interactiveSnapshotFromPersistedToolEvent(detail.id, event, payload, status)
        ?? interactiveUseSnapshot;
      toolCalls.set(toolCallId, {
        callId: toolCallId,
        toolName,
        input: toolCalls.get(toolCallId)?.input ?? {},
        result: presentation.summary ?? eventPayloadText(payload) ?? undefined,
        status: toolEntryStatusFromPresentation(status?.state, presentation.tone),
        startedAt: toolCalls.get(toolCallId)?.startedAt ?? event.timestamp,
        completedAt: event.timestamp,
      });
      timelineEntries.push({
        id: `${detail.id}:timeline:${event.sequence}`,
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
          toolCallId,
          toolName,
          input: toolCalls.get(toolCallId)?.input ?? {},
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

    if (isWorkItemTimelineEventKind(event.kind)) {
      const presentation = presentOperatorEventPayload(event.kind, payload);
      timelineEntries.push({
        id: `${detail.id}:timeline:${event.sequence}`,
        type: "event",
        eventKind: event.kind,
        createdAt: event.timestamp,
        sequence: event.sequence,
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
        id: `${detail.id}:timeline:${event.sequence}`,
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
    interactiveUseSnapshot,
    sessionCostUsd,
    inputTokens,
    outputTokens,
    turnCounter,
    routedProvider: lastRoutedProvider,
    routedModel: lastRoutedModel,
    authorityStatus: lastAuthorityStatus,
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

function ensureLiveAssistantAnchor(
  state: SessionStoreState,
  createdAt: string,
  turnId: string | undefined,
): {
  readonly messages: readonly Message[];
  readonly timelineEntries: readonly TimelineEntry[];
  readonly currentAssistant: string;
} {
  const existingId = state.currentAssistant;
  if (existingId && state.messages.some((message) => message.id === existingId && message.role === "assistant")) {
    return {
      messages: state.messages,
      timelineEntries: state.timelineEntries,
      currentAssistant: existingId,
    };
  }

  const assistantId = createMessageId();
  const assistantMessage: Message = {
    id: assistantId,
    role: "assistant",
    content: "",
    createdAt,
    streaming: true,
  };
  return {
    messages: [...state.messages, assistantMessage],
    timelineEntries: [
      ...state.timelineEntries,
      {
        id: `timeline:${assistantId}`,
        type: "message",
        createdAt,
        ...(turnId ? { turnId } : {}),
        message: assistantMessage,
      },
    ],
    currentAssistant: assistantId,
  };
}

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
      const callId = toolCallIdFromDetails(entry.details) ?? entry.id;
      const input = toolInputFromDetails(entry.details);
      const toolName = toolNameFromDetails(entry.details, entry.title);
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
    const item = workItemFromPayload(payload);
    if (item) {
      items.set(item.id, mergeWorkItemEntry(items.get(item.id), item));
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

export interface AuthorityStatus {
  readonly effective: "fail_closed" | "read_only" | "idempotent" | "audited" | "destructive" | "unknown";
  readonly completeness: "authoritative" | "partial";
}

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
    return { effective, completeness };
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

function providerSupportsSelection(provider: ProviderDescriptor, model: string | null): boolean {
  if (!providerHasSelectableSurface(provider)) {
    return false;
  }
  if (provider.models.length === 0) {
    return isGuiProviderModeless(provider.id) && model === null;
  }
  return model !== null && provider.models.includes(model);
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
  if (!provider || !providerSupportsSelection(provider, stored.model)) {
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
  if (state.liveSessionId) {
    return state.liveSessionId === kilnSessionId;
  }
  if (state.selectedSessionId) {
    return state.selectedSessionId === kilnSessionId;
  }
  if (state.resumeTargetId && state.status !== "running") {
    return state.resumeTargetId === kilnSessionId;
  }
  return true;
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

export interface ProviderAuthDetails {
  readonly verificationUri: string;
  readonly userCode: string;
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
  readonly providerCatalogStatus: ProviderCatalogStatus;
  readonly providerCatalogError: string | null;
  readonly providers: readonly ProviderDescriptor[];
  readonly providerDiscovery: readonly GuiProviderDiscoveryResult[];
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly sessionList: readonly GuiSessionSummary[];
  readonly selectedSessionId: string | null;
  readonly liveSessionId: string | null;
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
  readonly providerSwitchTarget: ProviderSwitchTarget | null;
  readonly providerAuthenticating: boolean;
  readonly providerAuthTarget: ProviderAuthTarget | null;
  readonly providerAuthMessage: string | null;
  readonly providerAuthDetails: ProviderAuthDetails | null;
  readonly providerExplicitSelection: boolean;
  readonly authorityStatus: AuthorityStatus | null;
  readonly interactiveUseSnapshot: GuiInteractiveUseSnapshot | null;
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
  ) => void;
  onSessionEvent: (event: GuiSessionEvent) => void;
  onTextDelta: (frame: StoreTextDeltaFrame) => void;
  onActivity: (frame: StoreActivityFrame) => void;
  onDone: (frame: Extract<GuiInboundFrame, { type: "done" }>) => void;
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
      reasoningEffort?: GuiProviderReasoningEffort;
      requestedAuthority?: OperatorTurnRequestedAuthority;
      appName?: string;
      tenantId?: string;
    },
  ) => boolean;
  sendClear: () => boolean;
  setPlanMode: (enabled: boolean) => void;
  setResume: (sessionId: string | null) => void;
  disconnect: () => void;
  onInteractiveUseUpdated: (frame: Extract<GuiInboundFrame, { type: "interactive_use_updated" }>) => void;
  onActivityPhase: (frame: Extract<GuiInboundFrame, { type: "activity_phase" }>) => void;
  sendApprovalResponse: (approved: boolean, reason: string | undefined, approvalId: string) => boolean;
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
  providerCatalogStatus: "pending",
  providerCatalogError: null,
  providers: [],
  providerDiscovery: [],
  activeProvider: null,
  activeModel: null,
  sessionList: [],
  selectedSessionId: null,
  liveSessionId: null,
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
  providerSwitchTarget: null,
  providerAuthenticating: false,
  providerAuthTarget: null,
  providerAuthMessage: null,
  providerAuthDetails: null,
  providerExplicitSelection: false,
  authorityStatus: null,
  interactiveUseSnapshot: null,
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
    clearStoredResumeTarget();
    set({
      selectedSessionId: sessionId,
      liveSessionId: null,
      resumeTargetId: null,
      messages: [],
      timelineEntries: [],
      currentAssistant: null,
      activity: null,
      activityPhase: "idle",
      interactiveUseSnapshot: null,
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
    const loaded = mapSessionDetailToLoadedState(detail);
    clearStoredResumeTarget();
    set({
      selectedSessionId: detail.id,
      liveSessionId: null,
      resumeTargetId: null,
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
      authorityStatus: loaded.authorityStatus,
      interactiveUseSnapshot: loaded.interactiveUseSnapshot,
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
          && providerSupportsSelection(provider, requestedModel)
      ))
      : undefined;
    const activeProvider = activeProviderDescriptor ? explicitActiveProvider ?? null : null;
    const activeModel = activeProviderDescriptor ? requestedModel : null;
    const persistedPlanMode = readStoredPlanMode();
    const welcomePlanMode = frame.executionMode ? frame.executionMode === "plan" : undefined;
    const resolvedPlanMode = persistedPlanMode ?? welcomePlanMode ?? current.planMode;
    const explicitSelection = Boolean(activeProvider);
    clearStoredResumeTarget();

    set({
      providers,
      providerDiscovery: frame.providerDiscovery ?? current.providerDiscovery,
      providerCatalogStatus: "ready",
      providerCatalogError: null,
      activeProvider,
      activeModel,
      authorityStatus: frame.authorityStatus ?? current.authorityStatus,
      planMode: resolvedPlanMode,
      routeMode: explicitSelection ? "user" : "auto",
      providerExplicitSelection: explicitSelection,
      resumeTargetId: current.resumeTargetId,
      status: "ready",
      errorBanner: null,
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
    }
  },

  onProvidersRefreshed: (nextProviders, nextProviderDiscovery) => {
    const current = get();
    const providers = normalizeProviderDescriptors(nextProviders);
    const activeProvider = current.activeProvider;
    const activeModel = current.activeModel;
    const requestedModel = activeModel ?? null;
    const activeStillAvailable = activeProvider
      ? providers.some((provider) => (
        provider.id === activeProvider
          && providerSupportsSelection(provider, requestedModel)
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
    ) {
      return;
    }

    set({
      providers,
      providerDiscovery: nextProviderDiscovery ?? current.providerDiscovery,
      providerCatalogStatus: "ready",
      providerCatalogError: null,
      activeProvider: nextActiveProvider,
      activeModel: nextActiveModel,
      routeMode: nextRouteMode,
      providerExplicitSelection: nextProviderExplicitSelection,
    });
  },

  onSessionEvent: (event) => {
    const state = get();
    if (!shouldApplySessionScopedFrame(state, event.kilnSessionId)) {
      return;
    }
    if (state.status === "running" && state.liveSessionId !== event.kilnSessionId) {
      set({ liveSessionId: event.kilnSessionId });
    }
    const payload = isObjectRecord(event.payload) ? event.payload : {};

    if (event.kind === "assistant_delta") {
      const delta = readString(payload.delta) ?? eventPayloadText(payload);
      if (delta) {
        state.onTextDelta({ type: "text_delta", content: delta, ...(event.turnId ? { turnId: event.turnId } : {}) });
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
      const toolName = readString(payload.toolName) ?? "tool";
      const input = isObjectRecord(payload.input) ? payload.input : {};
      const presentation = presentOperatorEventPayload(event.kind, payload);
      const anchored = ensureLiveAssistantAnchor(get(), event.timestamp, event.turnId);
      set({
        timelineEntries: [
          ...anchored.timelineEntries,
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
              toolCallId: readString(payload.toolCallId) ?? event.eventId,
              toolName,
              input,
            },
          },
        ],
        messages: anchored.messages,
        currentAssistant: anchored.currentAssistant,
        activity: {
          phase: "tool_running",
          toolName,
        },
        activityPhase: "tool_running",
      });
      return;
    }

    if (event.kind === "tool_call_completed") {
      const status = isObjectRecord(payload.status) ? payload.status : null;
      const interactiveUseSnapshot = interactiveSnapshotFromPersistedToolEvent(event.kilnSessionId, event, payload, status);
      const priorToolCalls = deriveToolCallLog(get().timelineEntries);
      const priorInput = priorToolCalls.find((entry) => entry.callId === (readString(payload.toolCallId) ?? event.eventId))?.input ?? {};
      const presentation = presentOperatorEventPayload(event.kind, payload);
      const anchored = ensureLiveAssistantAnchor(get(), event.timestamp, event.turnId);
      set({
        timelineEntries: [
          ...anchored.timelineEntries,
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
              toolCallId: readString(payload.toolCallId) ?? event.eventId,
              toolName: readString(payload.toolName) ?? "tool",
              input: priorInput,
              result: presentation.summary ?? eventPayloadText(payload) ?? undefined,
              status: presentation.tone === "error" ? "failed" : status?.state,
            },
          },
        ],
        messages: anchored.messages,
        currentAssistant: anchored.currentAssistant,
        activity: null,
        ...(interactiveUseSnapshot ? { interactiveUseSnapshot } : {}),
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
            title: "Turn completed",
            summary: readString(payload.outcome) ?? undefined,
            tone: "success",
            details: payload,
          },
        ],
        currentAssistant: null,
        status: "ready",
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
              content: message.content.trim().length === 0 && frame.content.trim().length > 0
                ? frame.content
                : message.content,
              streaming: false,
              routedProvider: finalizedProvider,
              routedModel: finalizedModel,
              routingRationale: frame.routingRationale,
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
        title: "Turn completed",
        summary: finalizedProvider ? [finalizedProvider, finalizedModel].filter(Boolean).join(" · ") : undefined,
        tone: "success",
        details: {
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
    clearStoredResumeTarget();
    set({
      messages: [],
      timelineEntries: [],
      currentAssistant: null,
      status: "ready",
      activity: null,
      activityPhase: "idle",
      errorBanner: null,
      selectedSessionId: null,
      liveSessionId: null,
      resumeTargetId: null,
      routedProvider: null,
      routedModel: null,
      routeMode: state.providerExplicitSelection ? "user" : "auto",
      respondingProvider: null,
      respondingModel: null,
      interactiveUseSnapshot: null,
      sessionCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      currentTurnTrackedInputTokens: 0,
      currentTurnTrackedOutputTokens: 0,
      clearPending: false,
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
      respondingProvider: null,
      respondingModel: null,
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
      verificationUri: frame.verificationUri,
      hasUserCode: frame.userCode.trim().length > 0,
      message: frame.message,
    });
    set({
      providerAuthMessage: frame.message ?? "Complete provider sign-in, then return to Kiln.",
      providerAuthDetails: {
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
    if (!targetProvider || !providerHasSelectableSurface(targetProvider)) {
      if (!state.providerSwitching) {
        set({
          providerSwitching: false,
          providerSwitchTarget: null,
          providerSwitchTimeoutId: null,
          errorBanner: `${targetProvider?.label ?? provider} is unavailable.`,
        });
      }
      return false;
    }
    const normalizedModel = readString(model) ?? null;
    if (!providerSupportsSelection(targetProvider, normalizedModel)) {
      if (!state.providerSwitching) {
        const message = normalizedModel === null && targetProvider.models.length > 0
          ? providerRequiresSelectedModelMessage(provider)
          : `${targetProvider.label} does not advertise the requested model.`;
        set({
          providerSwitching: false,
          providerSwitchTarget: null,
          providerSwitchTimeoutId: null,
          errorBanner: message,
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
    if (!normalized) {
      return false;
    }

    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: normalized,
      createdAt: nowIso(),
    };
    const isPreviewWithoutExplicitResume = state.selectedSessionId !== null && state.resumeTargetId === null;
    const baseMessages = isPreviewWithoutExplicitResume ? [] : state.messages;
    const baseTimelineEntries = isPreviewWithoutExplicitResume ? [] : state.timelineEntries;
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
      content: normalized,
      executionMode: state.planMode ? "plan" : "execute",
      resumeSessionId: state.resumeTargetId ?? undefined,
      ...(options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options?.requestedAuthority ? { requestedAuthority: options.requestedAuthority } : {}),
      ...(options?.appName ? { appName: options.appName } : {}),
      ...(options?.tenantId ? { tenantId: options.tenantId } : {}),
    });

    return true;
  },

  sendClear: () => {
    const state = get();
    if (!state.outboundSend || state.clearPending) {
      return false;
    }

    state.outboundSend({ type: "clear" });
    clearStoredResumeTarget();
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
      resumeTargetId: null,
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
      state.outboundSend({ type: "execution_mode_transition", toMode: "execute" });
      return;
    }
    persistPlanMode(false);
    set({ planMode: false });
  },

  setResume: (sessionId) => {
    clearStoredResumeTarget();
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
    if (state.providerAuthTimeoutId) {
      clearTimeout(state.providerAuthTimeoutId);
    }
    set({
      status: "idle",
      activity: null,
      activityPhase: "idle",
      interactiveUseSnapshot: null,
      routeMode: state.providerExplicitSelection ? "user" : "auto",
      respondingProvider: null,
      respondingModel: null,
      clearPending: false,
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
    });
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

  sendApprovalResponse: (approved, reason, approvalId) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) return false;
    if (approved) {
      outboundSend({ type: "approve", approvalId });
    } else {
      outboundSend({ type: "reject", reason: reason ?? "rejected by user", approvalId });
    }
    return true;
  },
}));
