import type {
  GuiSessionEvent,
  OperatorSessionEventKind,
} from "@kilnai/gateway-contracts";
import {
  canonicalOperatorSessionEvents,
  presentOperatorEventPayload,
} from "@kilnai/gateway-contracts";
import { isObjectRecord, readString } from "./unknown-value.js";
import type { ChangedFileEntry, TimelineEventEntry } from "./session-timeline-types.js";

/**
 * Primitives shared across the live event reducer (`onSessionEvent`) and the
 * batch replay (`mapSessionDetailToLoadedState`) for reading payload text,
 * summarizing an event kind, classifying event kinds into timeline groups,
 * and maintaining the canonical (deduped, sequence-sorted) session-event log.
 * Pure, no store dependency.
 */

export const MAX_LIVE_TOOL_OUTPUT_CHARS = 64 * 1024;
export const LIVE_TOOL_OUTPUT_TRUNCATION_MARKER = "… earlier output truncated …\n";

export function appendLiveToolOutput(current: string, delta: string): string {
  const combined = `${current}${delta}`;
  if (combined.length <= MAX_LIVE_TOOL_OUTPUT_CHARS) return combined;
  const retained = combined.slice(-(MAX_LIVE_TOOL_OUTPUT_CHARS - LIVE_TOOL_OUTPUT_TRUNCATION_MARKER.length));
  return `${LIVE_TOOL_OUTPUT_TRUNCATION_MARKER}${retained}`;
}

export function eventPayloadText(payload: Record<string, unknown>): string | null {
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

export function providerIdentity(payload: Record<string, unknown>): { provider: string | null; model: string | null } {
  const provider = isObjectRecord(payload.provider) ? payload.provider : null;
  return {
    provider: readString(provider?.provider),
    model: readString(provider?.model),
  };
}

export function operatorEventSummary(kind: OperatorSessionEventKind, payload: Record<string, unknown>): string {
  const presentation = presentOperatorEventPayload(kind, payload);
  return presentation.summary ?? presentation.compactText ?? presentation.title;
}

export function invocationRequestedSummary(payload: Record<string, unknown>): string {
  return operatorEventSummary("agent_invocation_requested", payload);
}

export function invocationStartedSummary(payload: Record<string, unknown>): string {
  return operatorEventSummary("agent_invocation_started", payload);
}

export function invocationCompletedSummary(payload: Record<string, unknown>): string {
  return operatorEventSummary("agent_invocation_completed", payload);
}

export function invocationFailedSummary(payload: Record<string, unknown>): string {
  return operatorEventSummary("agent_invocation_failed", payload);
}

export function invocationCancelledSummary(payload: Record<string, unknown>): string {
  return operatorEventSummary("agent_invocation_cancelled", payload);
}

export function normalizeLoadedChangeType(value: unknown): ChangedFileEntry["changeType"] | null {
  if (value === "created" || value === "deleted") {
    return value;
  }
  if (value === "updated" || value === "modified" || value === "renamed") {
    return "modified";
  }
  return null;
}

export function isWorkItemTimelineEventKind(kind: OperatorSessionEventKind): boolean {
  return kind === "work_item_updated"
    || kind === "work_item_execution_started"
    || kind === "work_item_execution_finished";
}

export function isWorkflowLifecycleTimelineEventKind(kind: OperatorSessionEventKind): boolean {
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

export function workflowLifecycleTimelineEntry(input: {
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

export function turnOutcomePresentation(outcome: unknown): Pick<TimelineEventEntry, "title" | "tone"> {
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

export function appendSessionEvent(
  events: readonly GuiSessionEvent[],
  event: GuiSessionEvent,
): readonly GuiSessionEvent[] {
  return canonicalOperatorSessionEvents([...events, event]);
}

export function canonicalSessionEvents(events: readonly GuiSessionEvent[]): readonly GuiSessionEvent[] {
  return canonicalOperatorSessionEvents(events);
}
