import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../src/lib/session-store.js";
import { isActivityTimelineEntry, isConversationTimelineEntry } from "../src/lib/timeline-visibility.js";

const createdAt = "2026-04-29T00:00:00.000Z";
type TimelineEventKind = Extract<TimelineEntry, { type: "event" }>["eventKind"];

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

function eventEntry(eventKind: TimelineEventKind): TimelineEntry {
  return {
    id: `event:${eventKind}`,
    type: "event",
    eventKind,
    createdAt,
    title: eventKind.replace(/_/g, " "),
    tone: "info",
  };
}

describe("timeline visibility", () => {
  it("keeps conversational messages, tool calls, agent calls, and approvals in the transcript", () => {
    expect(isConversationTimelineEntry(messageEntry("user", "hi"))).toBe(true);
    expect(isConversationTimelineEntry(messageEntry("assistant", "hello"))).toBe(true);
    expect(isConversationTimelineEntry(eventEntry("tool_call_started"))).toBe(true);
    expect(isConversationTimelineEntry(eventEntry("tool_call_completed"))).toBe(true);
    expect(isConversationTimelineEntry(eventEntry("agent_invocation_started"))).toBe(true);
    expect(isConversationTimelineEntry(eventEntry("approval_requested"))).toBe(true);
    expect(isConversationTimelineEntry(eventEntry("approval_resolved"))).toBe(true);
  });

  it("keeps routing, cost, and turn metadata out of the transcript", () => {
    expect(isConversationTimelineEntry(eventEntry("provider_routed"))).toBe(false);
    expect(isConversationTimelineEntry(eventEntry("cost_updated"))).toBe(false);
    expect(isConversationTimelineEntry(eventEntry("turn_completed"))).toBe(false);
  });

  it("routes every runtime event to the activity log", () => {
    expect(isActivityTimelineEntry(eventEntry("provider_routed"))).toBe(true);
    expect(isActivityTimelineEntry(eventEntry("cost_updated"))).toBe(true);
    expect(isActivityTimelineEntry(eventEntry("turn_completed"))).toBe(true);
    expect(isActivityTimelineEntry(messageEntry("user", "hi"))).toBe(false);
  });
});
