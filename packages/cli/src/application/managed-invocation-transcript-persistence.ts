import type { CanonicalSessionEvent, CanonicalSessionEventKind } from "@kilnai/core";
import type { PersistedTranscriptEventDraft } from "../wrapper/session-store.js";

export function toManagedInvocationPersistedTranscriptEventDraft(
  event: CanonicalSessionEvent,
): PersistedTranscriptEventDraft | undefined {
  if (!isManagedInvocationEvent(event)) {
    return undefined;
  }
  return {
    eventId: event.eventId,
    kilnSessionId: event.kilnSessionId,
    timestamp: event.timestamp.toISOString(),
    kind: event.kind as CanonicalSessionEventKind,
    turnId: event.turnId,
    parentEventId: event.parentEventId,
    source: event.source,
    payload: canonicalSessionEventPayload(event),
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
  if (typeof payload.sessionId !== "string") {
    payload.sessionId = event.kilnSessionId;
  }
  if (typeof payload.managedInvocationId !== "string" && typeof payload.invocationId === "string") {
    payload.managedInvocationId = payload.invocationId;
  }
  return payload;
}

function isManagedInvocationEvent(
  event: CanonicalSessionEvent,
): event is Extract<CanonicalSessionEvent, {
  readonly kind: "agent_invocation_requested" | "agent_invocation_started" | "agent_invocation_completed" | "agent_invocation_failed" | "agent_invocation_cancelled";
}> {
  return event.kind === "agent_invocation_requested"
    || event.kind === "agent_invocation_started"
    || event.kind === "agent_invocation_completed"
    || event.kind === "agent_invocation_failed"
    || event.kind === "agent_invocation_cancelled";
}
