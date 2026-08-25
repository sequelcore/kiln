import type { OperatorSessionEvent } from "./frames.js";
import {
  operatorEventTargetsSurface,
  presentOperatorSessionEvent,
  type OperatorEventPresentation,
  type OperatorEventSurface,
} from "./operator-event-presentation.js";

export interface OperatorProjectedEvent {
  readonly event: OperatorSessionEvent;
  readonly presentation: OperatorEventPresentation;
}

export interface OperatorPendingApprovalProjection {
  readonly approvalId: string;
  readonly sessionId: string;
  readonly eventId: string;
  readonly sequence: number;
  readonly presentation: OperatorEventPresentation;
}

export interface OperatorToolCallProjection {
  readonly toolCallId: string;
  readonly toolCallScopeId: string;
  readonly status: "running" | "completed";
  readonly eventId: string;
}

export interface OperatorChangedFileProjection {
  readonly path: string;
  readonly changeType: "created" | "modified" | "deleted";
  readonly eventId: string;
}

export interface OperatorSessionProjection {
  readonly events: readonly OperatorSessionEvent[];
  readonly presentedEvents: readonly OperatorProjectedEvent[];
  readonly pendingApprovals: readonly OperatorPendingApprovalProjection[];
  readonly toolCalls: readonly OperatorToolCallProjection[];
  readonly changedFiles: readonly OperatorChangedFileProjection[];
  readonly totalCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly lastRouteId?: string;
  readonly lastContinuityEventId?: string;
  readonly terminalOutcome?: "completed" | "failed" | "cancelled" | "paused";
  readonly goalEventIds: readonly string[];
  readonly workItemEventIds: readonly string[];
}

export function canonicalOperatorSessionEvents(
  events: readonly OperatorSessionEvent[],
): readonly OperatorSessionEvent[] {
  const byId = new Map<string, OperatorSessionEvent>();
  for (const event of events) {
    if (!byId.has(event.eventId)) byId.set(event.eventId, event);
  }
  return [...byId.values()].toSorted((left, right) =>
    left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
}

export function applyOperatorSessionEvent(
  projection: OperatorSessionProjection,
  event: OperatorSessionEvent,
): OperatorSessionProjection {
  return projectOperatorSessionEvents([...projection.events, event]);
}

export function projectOperatorSessionEvents(
  inputEvents: readonly OperatorSessionEvent[],
): OperatorSessionProjection {
  const events = canonicalOperatorSessionEvents(inputEvents);
  const pendingApprovals = new Map<string, OperatorPendingApprovalProjection>();
  const toolCalls = new Map<string, OperatorToolCallProjection>();
  const changedFiles = new Map<string, OperatorChangedFileProjection>();
  let totalCostUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let lastRouteId: string | undefined;
  let lastContinuityEventId: string | undefined;
  let terminalOutcome: OperatorSessionProjection["terminalOutcome"];
  const goalEventIds: string[] = [];
  const workItemEventIds: string[] = [];
  const presentedEvents: OperatorProjectedEvent[] = [];

  for (const event of events) {
    const presentation = presentOperatorSessionEvent(event);
    presentedEvents.push({ event, presentation });
    const payload = event.payload;
    if (event.kind === "approval_requested") {
      const approvalId = readString(payload.approvalId);
      if (approvalId) {
        pendingApprovals.set(approvalId, {
          approvalId,
          sessionId: event.kilnSessionId,
          eventId: event.eventId,
          sequence: event.sequence,
          presentation,
        });
      }
    } else if (event.kind === "approval_resolved") {
      const approvalId = readString(payload.approvalId);
      if (approvalId) pendingApprovals.delete(approvalId);
    } else if (event.kind === "tool_call_started" || event.kind === "tool_call_completed") {
      const toolCallId = readString(payload.toolCallId);
      const toolCallScopeId = readString(payload.toolCallScopeId);
      if (toolCallId && toolCallScopeId) {
        toolCalls.set(`${toolCallScopeId}:${toolCallId}`, {
          toolCallId,
          toolCallScopeId,
          status: event.kind === "tool_call_started" ? "running" : "completed",
          eventId: event.eventId,
        });
      }
    } else if (event.kind === "file_changed") {
      const path = readString(payload.path);
      const changeType = normalizeChangeType(payload.changeType);
      if (path && changeType) changedFiles.set(path, { path, changeType, eventId: event.eventId });
    } else if (event.kind === "cost_updated") {
      const cost = asRecord(payload.cost);
      const usage = asRecord(payload.usage);
      totalCostUsd += nonnegativeNumber(cost?.deltaUsd) ?? 0;
      inputTokens += nonnegativeNumber(usage?.inputTokens) ?? 0;
      outputTokens += nonnegativeNumber(usage?.outputTokens) ?? 0;
    } else if (event.kind === "provider_routed") {
      lastRouteId = readString(payload.routeId) ?? lastRouteId;
    } else if (event.kind === "continuity_decided") {
      lastContinuityEventId = event.eventId;
    } else if (event.kind === "turn_completed") {
      terminalOutcome = turnOutcome(payload.outcome) ?? terminalOutcome;
    }
    if (event.kind.startsWith("goal.") || event.kind === "work_items.materialized") goalEventIds.push(event.eventId);
    if (event.kind.startsWith("work_item_")) workItemEventIds.push(event.eventId);
  }

  return {
    events,
    presentedEvents,
    pendingApprovals: [...pendingApprovals.values()],
    toolCalls: [...toolCalls.values()],
    changedFiles: [...changedFiles.values()],
    totalCostUsd,
    inputTokens,
    outputTokens,
    ...(lastRouteId ? { lastRouteId } : {}),
    ...(lastContinuityEventId ? { lastContinuityEventId } : {}),
    ...(terminalOutcome ? { terminalOutcome } : {}),
    goalEventIds,
    workItemEventIds,
  };
}

export function projectedEventsForSurface(
  projection: OperatorSessionProjection,
  surface: OperatorEventSurface,
): readonly OperatorProjectedEvent[] {
  return projection.presentedEvents.filter((entry) => operatorEventTargetsSurface(entry.presentation, surface));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function nonnegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeChangeType(value: unknown): OperatorChangedFileProjection["changeType"] | undefined {
  if (value === "created" || value === "deleted") return value;
  return value === "modified" || value === "updated" || value === "renamed" ? "modified" : undefined;
}

function turnOutcome(value: unknown): OperatorSessionProjection["terminalOutcome"] {
  return value === "completed" || value === "failed" || value === "cancelled" || value === "paused"
    ? value
    : undefined;
}
