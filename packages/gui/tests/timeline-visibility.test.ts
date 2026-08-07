import { describe, expect, it } from "vitest";
import type { OperatorSessionEvent, OperatorSessionEventKind } from "@kilnai/gateway-contracts";
import type { TimelineEntry } from "../src/lib/session-store/index.js";
import { isActivityTimelineEntry, projectConversationTimelineEntries } from "../src/lib/timeline-visibility.js";

const createdAt = "2026-04-29T00:00:00.000Z";

function messageEntry(role: "user" | "assistant", content: string): TimelineEntry {
  return {
    id: `message:${role}`,
    type: "message",
    createdAt,
    message: {
      id: `message:${role}`,
      role,
      content,
      createdAt,
    },
  };
}

function eventEntry(event: OperatorSessionEvent, details?: unknown): TimelineEntry {
  return {
    id: `timeline:${event.eventId}`,
    type: "event",
    eventKind: event.kind,
    createdAt,
    title: event.kind.replace(/_/g, " "),
    tone: "info",
    details,
  };
}

function sessionEvent(kind: OperatorSessionEventKind, sequence: number, payload: Record<string, unknown> = {}): OperatorSessionEvent {
  return {
    eventId: `event-${sequence}`,
    kilnSessionId: "session-1",
    sequence,
    timestamp: createdAt,
    kind,
    turnId: "turn-1",
    source: { actor: "runtime", surface: "gui" },
    payload,
  };
}

describe("timeline visibility", () => {
  it("keeps conversational messages, tool calls, terminal agent results, and approvals in the transcript", () => {
    const events = [
      sessionEvent("tool_call_started", 1, { toolCallId: "tool-1", toolName: "web_search", input: {} }),
      sessionEvent("tool_call_completed", 2, { toolCallId: "tool-1", toolName: "web_search", status: "success", result: "done" }),
      sessionEvent("agent_invocation_completed", 3),
      sessionEvent("agent_invocation_failed", 4),
      sessionEvent("approval_requested", 5),
      sessionEvent("approval_resolved", 6),
    ];
    const entries = [
      messageEntry("user", "hi"),
      messageEntry("assistant", "hello"),
      ...events.map((event) => eventEntry(event)),
    ];

    expect(projectConversationTimelineEntries(entries, events)).toEqual(entries);
  });

  it("keeps routing, lifecycle, cost, and turn metadata out of the transcript", () => {
    const events = [
      sessionEvent("provider_routed", 1),
      sessionEvent("agent_invocation_started", 2),
      sessionEvent("plan_submitted", 3),
      sessionEvent("plan_approved", 4),
      sessionEvent("work_items.materialized", 5),
      sessionEvent("cost_updated", 6),
      sessionEvent("turn_completed", 7),
    ];

    expect(projectConversationTimelineEntries(events.map((event) => eventEntry(event)), events)).toEqual([]);
  });

  it("uses canonical session-event presentation instead of re-projecting reduced timeline details", () => {
    const event = sessionEvent("tool_call_completed", 1, {
      toolCallScopeId: "response-1",
      toolCallId: "tool-1",
      toolName: "web_search",
      status: "success",
      result: "done",
    });
    const canonicalEntry = eventEntry(event, {});
    const orphanEntry = { ...canonicalEntry, id: "timeline:missing-event" };

    expect(projectConversationTimelineEntries([canonicalEntry, orphanEntry], [event])).toEqual([canonicalEntry]);
  });

  it("routes every runtime event to the activity log", () => {
    expect(isActivityTimelineEntry(eventEntry(sessionEvent("provider_routed", 1)))).toBe(true);
    expect(isActivityTimelineEntry(eventEntry(sessionEvent("cost_updated", 2)))).toBe(true);
    expect(isActivityTimelineEntry(eventEntry(sessionEvent("turn_completed", 3)))).toBe(true);
    expect(isActivityTimelineEntry(messageEntry("user", "hi"))).toBe(false);
  });
});
