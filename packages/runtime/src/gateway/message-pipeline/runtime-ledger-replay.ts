// Extracted from the gateway message pipeline; behavior is intentionally unchanged.
import type {
  ErrorEvent,
  EventBus,
  ToolResultEvent,
  KilnEvent
} from "@kilnai/core";
import {
  KilnError
} from "@kilnai/core";
import type {
  ToolExecutionSummary
} from "../../session/runtime-session-orchestrator.js";
import type { RuntimeTurnToolCompletion } from "../../session/runtime-turn-record.js";
export type RuntimePipelineLedgerEvent =
  | import("@kilnai/core").ApprovalRequestedEvent
  | import("@kilnai/core").ApprovalReceivedEvent
  | import("@kilnai/core").CostUpdateEvent
  | ErrorEvent
  | import("@kilnai/core").ModelRoutedEvent
  | import("@kilnai/core").MultimodalRoutedEvent
  | import("@kilnai/core").ToolCalledEvent
  | ToolResultEvent;

export function replayCapturedRuntimeLedgerEvents(
  eventBus: EventBus | undefined,
  sessionId: string,
  since: Date,
  seed: readonly RuntimePipelineLedgerEvent[],
): {
  readonly events: RuntimePipelineLedgerEvent[];
  readonly keys: Set<string>;
} {
  const events: RuntimePipelineLedgerEvent[] = [];
  const keys = new Set<string>();
  for (const event of seed) {
    appendRuntimeLedgerEvent(events, keys, event, sessionId);
  }
  if (eventBus) {
    for (const event of eventBus.history()) {
      if (isRuntimeLedgerEvent(event) && event.timestamp >= since) {
        appendRuntimeLedgerEvent(events, keys, event, sessionId);
      }
    }
  }
  return { events, keys };
}

export function resolveTurnToolExecutions(
  resultToolExecutions: readonly ToolExecutionSummary[] | undefined,
  runtimeEvents: readonly RuntimePipelineLedgerEvent[],
  surfaceToolCompletions: readonly RuntimeTurnToolCompletion[] | undefined,
): readonly ToolExecutionSummary[] | undefined {
  if (resultToolExecutions && resultToolExecutions.length > 0) {
    return resultToolExecutions;
  }
  const projected = runtimeEvents
    .filter((event): event is ToolResultEvent => event.type === "tool_result")
    .map((event): ToolExecutionSummary => ({
      toolName: event.toolName,
      durationMs: event.durationMs,
      success: event.success,
      ...(event.output !== undefined ? { output: event.output } : {}),
      resultSummary: event.resultSummary ?? "",
      ...(event.metadata ? { metadata: event.metadata } : {}),
      ...(event.resolvedEffect ? { resolvedEffect: event.resolvedEffect } : {}),
      ...(event.authority ? { authority: event.authority } : {}),
    }));
  if (projected.length > 0) {
    return projected;
  }
  const surfaceProjected = surfaceToolCompletions?.map((completion): ToolExecutionSummary => ({
    toolName: completion.toolName,
    durationMs: 0,
    success: completion.success,
    ...(completion.output !== undefined ? { output: completion.output } : {}),
    resultSummary: completion.resultSummary ?? "",
    ...(completion.metadata ? { metadata: completion.metadata } : {}),
  }));
  return surfaceProjected && surfaceProjected.length > 0 ? surfaceProjected : undefined;
}

function isRuntimeLedgerEvent(event: KilnEvent): event is
  RuntimePipelineLedgerEvent {
  switch (event.type) {
    case "approval_requested":
    case "approval_received":
    case "cost_update":
    case "error":
    case "model_routed":
    case "multimodal_routed":
    case "tool_called":
    case "tool_result":
      return true;
    default:
      return false;
  }
}

export function appendRuntimeLedgerEvent(
  events: RuntimePipelineLedgerEvent[],
  keys: Set<string>,
  event: RuntimePipelineLedgerEvent,
  sessionId: string,
): boolean {
  if (event.sessionId !== sessionId) {
    return false;
  }
  const key = runtimeLedgerEventKey(event);
  if (keys.has(key)) {
    return false;
  }
  keys.add(key);
  events.push(event);
  return true;
}



function runtimeLedgerEventKey(event: RuntimePipelineLedgerEvent): string {
  const base = `${event.type}|${event.sessionId}|${event.timestamp.toISOString()}`;
  switch (event.type) {
    case "approval_requested":
      return `${base}|${event.approvalId}`;
    case "approval_received":
      return `${base}|${event.approvalId}|${event.approved}`;
    case "cost_update":
      return `${base}|${event.provider ?? ""}|${event.model ?? ""}|${event.inputTokens}|${event.outputTokens}`;
    case "error":
      return `${base}|${event.code}|${event.message}`;
    case "model_routed":
      return `${base}|${event.provider}|${event.model}|${event.routingTier}`;
    case "multimodal_routed":
      return `${base}|${event.provider}|${event.model}|${event.strategy}|${event.reasonCode}|${event.requestedCapability}`;
    case "tool_called":
      return `${base}|${event.toolCallId}|${event.toolName}|${event.taskId ?? ""}`;
    case "tool_result":
      return `${base}|${event.toolCallId}|${event.toolName}|${event.success}|${event.resultSummary}`;
  }
}


export function runtimeFailureEvent(error: unknown, sessionId: string, timestamp: Date): ErrorEvent {
  return {
    type: "error",
    code: error instanceof KilnError ? error.code : "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
    taskId: null,
    timestamp,
    sessionId,
  };
}

export function isCancellationErrorEvent(event: ErrorEvent): boolean {
  return event.code === "ABORTED"
    || event.code === "ABORT_ERR"
    || /\babort(?:ed|ing)?\b/i.test(event.message);
}
