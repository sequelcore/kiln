import { operatorEventTargetsSurface, presentOperatorEventPayload } from "@kilnai/gateway-contracts";
import type { TimelineEntry, TimelineEventEntry } from "./session-store.js";

export function isActionableTranscriptEvent(entry: TimelineEventEntry): boolean {
  const payload = typeof entry.details === "object" && entry.details !== null && !Array.isArray(entry.details)
    ? entry.details as Record<string, unknown>
    : {};
  return operatorEventTargetsSurface(
    presentOperatorEventPayload(entry.eventKind, payload),
    "conversation_inline",
  );
}

export function isConversationTimelineEntry(entry: TimelineEntry): boolean {
  return entry.type === "message" || isActionableTranscriptEvent(entry);
}

export function isActivityTimelineEntry(entry: TimelineEntry): entry is TimelineEventEntry {
  return entry.type === "event";
}
