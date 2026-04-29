import type { TimelineEntry, TimelineEventEntry } from "./session-store.js";

export function isActionableTranscriptEvent(entry: TimelineEventEntry): boolean {
  return entry.eventKind === "approval_requested";
}

export function isConversationTimelineEntry(entry: TimelineEntry): boolean {
  return entry.type === "message" || isActionableTranscriptEvent(entry);
}

export function isActivityTimelineEntry(entry: TimelineEntry): entry is TimelineEventEntry {
  return entry.type === "event";
}
