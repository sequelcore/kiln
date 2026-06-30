import type {
  CanonicalSessionEvent,
  CanonicalSessionEventKind,
  ExecutionSessionEvent,
  SessionEventSource,
} from "@kilnai/core";
import { buildOperatorToolResultPayload } from "@kilnai/gateway-contracts";
import type { PersistedTranscriptEventDraft } from "../wrapper/session-store.js";

export type OperatorTranscriptEntryEvent =
  | Extract<ExecutionSessionEvent, { readonly type: "text_delta" | "tool_result" }>
  | {
      readonly type: "tool_use";
      readonly toolName: string;
      readonly input?: unknown;
      readonly toolCallId?: string;
      readonly source?: "native" | "mcp";
      readonly mcpSelector?: string;
    };

export function managedInvocationPersistedTranscriptEventDrafts(
  events: readonly CanonicalSessionEvent[],
): readonly PersistedTranscriptEventDraft[] {
  return events.flatMap((event) => {
    const draft = toManagedInvocationPersistedTranscriptEventDraft(event);
    return draft ? [draft] : [];
  });
}

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

export function projectOperatorTranscriptEntryToDraft(input: {
  readonly eventId: string;
  readonly kilnSessionId: string;
  readonly timestamp: string;
  readonly event: OperatorTranscriptEntryEvent;
  readonly source: SessionEventSource;
}): PersistedTranscriptEventDraft {
  return {
    eventId: input.eventId,
    kilnSessionId: input.kilnSessionId,
    timestamp: input.timestamp,
    kind: operatorTranscriptKindForEntry(input.event),
    source: input.source,
    payload: operatorTranscriptPayload(input.event, input.eventId),
  };
}

export function operatorTranscriptSourceForEntry(
  event: OperatorTranscriptEntryEvent,
  surface: SessionEventSource["surface"],
  component: string,
): SessionEventSource {
  return operatorTranscriptSourceForType(event.type, surface, component);
}

export function operatorTranscriptKindForType(type: string): CanonicalSessionEventKind {
  switch (type) {
    case "user":
      return "user_message";
    case "text_delta":
      return "assistant_delta";
    case "tool_use":
      return "tool_call_started";
    case "tool_result":
      return "tool_call_completed";
    case "cost_update":
      return "cost_updated";
    case "error":
      return "error_recorded";
    default:
      return "assistant_message";
  }
}

export function operatorTranscriptSourceForType(
  type: string,
  surface: SessionEventSource["surface"],
  component: string,
): SessionEventSource {
  switch (type) {
    case "user":
      return { actor: "user", surface, component };
    case "text_delta":
      return { actor: "assistant", surface, component };
    case "tool_use":
    case "tool_result":
      return { actor: "tool", surface, component };
    case "cost_update":
    case "error":
      return { actor: "runtime", surface, component };
    default:
      return { actor: "system", surface, component };
  }
}

function operatorTranscriptKindForEntry(event: OperatorTranscriptEntryEvent): CanonicalSessionEventKind {
  return operatorTranscriptKindForType(event.type);
}

function operatorTranscriptPayload(
  event: OperatorTranscriptEntryEvent,
  fallbackToolCallId: string,
): Record<string, unknown> {
  switch (event.type) {
    case "text_delta":
      return {
        type: event.type,
        content: event.content,
      };
    case "tool_use":
      return {
        type: event.type,
        toolName: event.toolName,
        ...(event.input !== undefined ? { input: event.input } : {}),
      };
    case "tool_result": {
      const toolName = event.toolName ?? "unknown";
      return {
        type: event.type,
        ...buildOperatorToolResultPayload({
          toolCallId: event.toolCallId ?? fallbackToolCallId,
          toolName,
          output: event.output ?? "",
          ...(event.outputSummary !== undefined ? { outputSummary: event.outputSummary } : {}),
          ...(event.isError !== undefined ? { isError: event.isError } : {}),
          ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
          ...(event.resourceLinks !== undefined ? { resourceLinks: event.resourceLinks } : {}),
          ...(event.toolUsage !== undefined ? { toolUsage: event.toolUsage } : {}),
        }),
      };
    }
  }
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
