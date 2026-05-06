import type { CanonicalSessionEvent } from "@kilnai/core";
import type { GuiInboundFrame } from "@kilnai/gateway-contracts";

export function toOperatorSessionEventFrame(
  event: CanonicalSessionEvent,
  options: {
    readonly eventId: string;
    readonly sequence: number;
  },
): Extract<GuiInboundFrame, { type: "session_event" }> {
  return {
    type: "session_event",
    event: {
      eventId: options.eventId,
      kilnSessionId: event.kilnSessionId,
      sequence: options.sequence,
      timestamp: event.timestamp.toISOString(),
      kind: event.kind,
      turnId: event.turnId,
      parentEventId: event.parentEventId,
      source: event.source,
      payload: canonicalSessionEventPayload(event),
    },
  };
}

function canonicalSessionEventPayload(event: CanonicalSessionEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const envelopeKeys = new Set([
    "eventId",
    "kilnSessionId",
    "sequence",
    "timestamp",
    "kind",
    "turnId",
    "parentEventId",
    "source",
  ]);
  for (const [key, value] of Object.entries(event)) {
    if (!envelopeKeys.has(key)) {
      payload[key] = value;
    }
  }
  return payload;
}
