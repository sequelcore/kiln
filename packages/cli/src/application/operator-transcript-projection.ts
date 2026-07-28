import type {
  CanonicalSessionEvent,
  CanonicalSessionEventKind,
  ExecutionSessionEvent,
  SessionEventSource,
} from "@kilnai/core";
import { buildOperatorToolResultPayload } from "@kilnai/gateway-contracts";
import type { PersistedTranscriptEventDraft } from "../wrapper/session-store.js";

export type OperatorTranscriptEntryEvent =
  | Extract<ExecutionSessionEvent, { readonly type: "text_delta" }>
  | (
      Extract<ExecutionSessionEvent, { readonly type: "tool_result" }>
      & {
        readonly toolCallId: string;
        readonly toolCallScopeId: string;
      }
    )
  | {
      readonly type: "tool_use";
      readonly toolName: string;
      readonly input?: unknown;
      readonly toolCallId: string;
      readonly toolCallScopeId: string;
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
    ...(event.executionScope ? { executionScope: event.executionScope } : {}),
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
  assertOperatorTranscriptToolIdentity(input.event);
  return {
    eventId: input.eventId,
    kilnSessionId: input.kilnSessionId,
    timestamp: input.timestamp,
    kind: operatorTranscriptKindForEntry(input.event),
    source: input.source,
    payload: operatorTranscriptPayload(input.event),
  };
}

export function projectGovernanceTranscriptEventDrafts(
  toolResult: PersistedTranscriptEventDraft,
): readonly PersistedTranscriptEventDraft[] {
  if (toolResult.kind !== "tool_call_completed") return [];
  const metadata = asRecord(toolResult.payload.metadata);
  if (!metadata) return [];
  const drafts: PersistedTranscriptEventDraft[] = [];
  const toolCallId = readString(toolResult.payload.toolCallId) ?? toolResult.eventId;

  if (metadata.kind === "work_item") {
    const workItem = asRecord(metadata.item);
    const operation = readString(metadata.operation);
    const attempt = asRecord(metadata.attempt);
    const kind = operation === "execution_started" && attempt
      ? "work_item_execution_started"
      : operation === "execution_finished" && attempt
        ? "work_item_execution_finished"
        : (operation === "update" || operation === "complete") && workItem
          ? "work_item_updated"
          : undefined;
    if (kind && workItem) {
      drafts.push({
        ...semanticDraft(toolResult, `${toolResult.eventId}:work-item`, kind),
        payload: {
          toolCallId,
          workItem,
          ...(attempt ? { attempt } : {}),
          ...(kind === "work_item_updated" ? { operation } : {}),
          ...workItemOutcomePayload(metadata),
        },
      });
    }
  }

  const goal = asRecord(metadata.goal);
  const goalStatus = readString(goal?.status);
  const goalKind = goalStatus === "completed"
    ? "goal.completed"
    : goalStatus === "failed"
      ? "goal.failed"
      : goalStatus === "cancelled"
        ? "goal.cancelled"
        : metadata.kind === "goal" && metadata.operation === "create"
          ? "goal.created"
          : goalStatus === "active"
            ? "goal.updated"
            : undefined;
  const terminalSummary = readString(goal?.closeoutSummary);
  const terminalReason = readString(goal?.terminalReason);
  if (
    goal
    && goalKind
    && (goalKind !== "goal.completed" || terminalSummary)
    && ((goalKind !== "goal.failed" && goalKind !== "goal.cancelled") || terminalReason)
  ) {
    drafts.push({
      ...semanticDraft(toolResult, `${toolResult.eventId}:goal`, goalKind),
      payload: {
        goal,
        ...(goalKind === "goal.updated" ? { changedFields: ["currentPhase"] } : {}),
        ...(goalKind === "goal.completed" ? { closeoutSummary: terminalSummary } : {}),
        ...(goalKind === "goal.failed" || goalKind === "goal.cancelled" ? { reason: terminalReason } : {}),
      },
    });
  }
  return drafts;
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
        toolCallId: event.toolCallId,
        toolCallScopeId: event.toolCallScopeId,
        toolName: event.toolName,
        ...(event.input !== undefined ? { input: event.input } : {}),
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.mcpSelector !== undefined ? { mcpSelector: event.mcpSelector } : {}),
      };
    case "tool_result": {
      const toolName = event.toolName ?? "unknown";
      return {
        type: event.type,
        toolCallScopeId: event.toolCallScopeId,
        ...buildOperatorToolResultPayload({
          toolCallId: event.toolCallId,
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

function assertOperatorTranscriptToolIdentity(event: OperatorTranscriptEntryEvent): void {
  if (event.type !== "tool_use" && event.type !== "tool_result") {
    return;
  }
  if (typeof event.toolCallId !== "string" || event.toolCallId.trim().length === 0) {
    throw new TypeError("Operator transcript tool events require a non-empty toolCallId.");
  }
  if (typeof event.toolCallScopeId !== "string" || event.toolCallScopeId.trim().length === 0) {
    throw new TypeError("Operator transcript tool events require a non-empty toolCallScopeId.");
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
    "executionScope",
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

function semanticDraft(
  source: PersistedTranscriptEventDraft,
  eventId: string,
  kind: CanonicalSessionEventKind,
): Omit<PersistedTranscriptEventDraft, "payload"> {
  return {
    eventId,
    kilnSessionId: source.kilnSessionId,
    timestamp: source.timestamp,
    kind,
    ...(source.turnId ? { turnId: source.turnId } : {}),
    ...(source.executionScope ? { executionScope: source.executionScope } : {}),
    source: source.source,
  };
}

function workItemOutcomePayload(metadata: Record<string, unknown>): Record<string, unknown> {
  return {
    missingEvidence: readStrings(metadata.missingEvidence),
    missingGoalEvidence: readStrings(metadata.missingGoalEvidence),
    missingVerificationGates: readStrings(metadata.missingVerificationGates),
    failedVerificationGates: readStrings(metadata.failedVerificationGates),
    missingResidualRisk: metadata.missingResidualRisk === true,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const text = readString(entry);
    return text ? [text] : [];
  });
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
