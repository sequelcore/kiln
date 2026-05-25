import {
  projectManagedOrchestrationAdoptionGate,
  type CanonicalSessionEvent,
} from "@kilnai/core";
import type { GuiInboundFrame } from "@kilnai/gateway-contracts";

export function toOperatorSessionEventFrame(
  event: CanonicalSessionEvent,
  options: {
    readonly eventId: string;
    readonly sequence: number;
    readonly instanceId?: string;
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
      payload: canonicalSessionEventPayload(event, options),
    },
  };
}

function canonicalSessionEventPayload(
  event: CanonicalSessionEvent,
  options: { readonly instanceId?: string },
): Record<string, unknown> {
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
  if (options.instanceId && typeof payload.instanceId !== "string") {
    payload.instanceId = options.instanceId;
  }
  if (typeof payload.sessionId !== "string") {
    payload.sessionId = event.kilnSessionId;
  }
  if (
    isManagedInvocationEvent(event)
    && typeof payload.managedInvocationId !== "string"
    && typeof payload.invocationId === "string"
  ) {
    payload.managedInvocationId = payload.invocationId;
  }
  if (isWorkItemEvent(event)) {
    payload.managedOrchestrationAdoptionGate = projectManagedOrchestrationAdoptionGate(event.workItem);
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

function isWorkItemEvent(
  event: CanonicalSessionEvent,
): event is Extract<CanonicalSessionEvent, {
  readonly kind: "work_item_updated" | "work_item_execution_started" | "work_item_execution_finished";
}> {
  return event.kind === "work_item_updated"
    || event.kind === "work_item_execution_started"
    || event.kind === "work_item_execution_finished";
}
