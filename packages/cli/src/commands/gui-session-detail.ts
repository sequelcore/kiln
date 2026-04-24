import type { GuiSessionDetail, GuiSessionEvent } from "@kilnai/runtime";
import type { TranscriptStore } from "../wrapper/session-store.js";

export async function loadSessionDetail(
  transcriptStore: TranscriptStore,
  sessionId: string,
): Promise<GuiSessionDetail | null> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }
  const [meta, transcript] = await Promise.all([
    transcriptStore.readMeta(normalizedSessionId),
    transcriptStore.readTranscript(normalizedSessionId),
  ]);
  if (!meta) {
    return null;
  }
  return {
    id: normalizedSessionId,
    meta,
    events: transcript.map(mapPersistedTranscriptEventToGuiEvent),
  };
}

function mapPersistedTranscriptEventToGuiEvent(
  event: Awaited<ReturnType<TranscriptStore["readTranscript"]>>[number],
): GuiSessionEvent {
  return {
    eventId: event.eventId,
    kilnSessionId: event.kilnSessionId,
    sequence: event.sequence,
    timestamp: event.timestamp,
    kind: event.kind,
    turnId: event.turnId,
    parentEventId: event.parentEventId,
    source: event.source,
    payload: event.payload,
  };
}
