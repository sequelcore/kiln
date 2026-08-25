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
import { canonicalRuntimeEventIdentity } from "../../session/runtime-session-event-ledger.js";
import type {
  ToolExecutionSummary
} from "../../session/runtime-session-orchestrator.js";
export type RuntimePipelineLedgerEvent =
  | import("@kilnai/core").ApprovalRequestedEvent
  | import("@kilnai/core").ApprovalReceivedEvent
  | import("@kilnai/core").CostUpdateEvent
  | ErrorEvent
  | import("@kilnai/core").ModelRoutedEvent
  | import("@kilnai/core").MultimodalRoutedEvent
  | import("@kilnai/core").ToolCalledEvent
  | import("@kilnai/core").ToolOutputEvent
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
  return projected.length > 0 ? projected : undefined;
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
    case "tool_output":
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
  const key = canonicalRuntimeEventIdentity(event);
  if (keys.has(key)) {
    return false;
  }
  keys.add(key);
  events.push(event);
  return true;
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
