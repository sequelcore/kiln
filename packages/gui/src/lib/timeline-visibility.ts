import { operatorEventTargetsConversation, presentOperatorSessionEvent } from "@kilnai/gateway-contracts";
import type { OperatorSessionEvent } from "@kilnai/gateway-contracts";
import type { TimelineEntry, TimelineEventEntry } from "./session-store.js";

export function projectConversationTimelineEntries(
  entries: readonly TimelineEntry[],
  sessionEvents: readonly OperatorSessionEvent[],
): readonly TimelineEntry[] {
  const conversationalEventEntryIds = new Set<string>();
  for (const event of sessionEvents) {
    if (operatorEventTargetsConversation(presentOperatorSessionEvent(event))) {
      conversationalEventEntryIds.add(`timeline:${event.eventId}`);
    }
  }

  return entries.filter((entry) => entry.type === "message" || conversationalEventEntryIds.has(entry.id));
}

export function isActivityTimelineEntry(entry: TimelineEntry): entry is TimelineEventEntry {
  return entry.type === "event";
}
