import type {
  ApprovalReceivedEvent,
  ApprovalRequestedEvent,
  CanonicalSessionEvent,
  CostUpdateEvent,
  ErrorEvent,
  ModelRoutedEvent,
  SessionEventSource,
  SessionProviderIdentity,
  SessionToolStatus,
  ToolCalledEvent,
  ToolResultEvent,
} from "@kilnai/core";
import { createSessionEvent } from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import type { RuntimeTurnFileChange } from "./runtime-turn-record.js";

type CapturedRuntimeLedgerEvent =
  | ApprovalReceivedEvent
  | ApprovalRequestedEvent
  | CostUpdateEvent
  | ErrorEvent
  | ModelRoutedEvent
  | ToolCalledEvent
  | ToolResultEvent;

interface RuntimeContinuitySnapshot {
  readonly strategy: string;
  readonly feedbackLabel?: string;
  readonly selectionReason?: string;
  readonly fallbackLabel?: string;
}

export interface AppendCanonicalTurnEventsInput {
  readonly session: RuntimeSession;
  readonly channel: string;
  readonly userMessageContent: string;
  readonly assistantMessageContent?: string;
  readonly queued: boolean;
  readonly turnStartedAt: Date;
  readonly turnCompletedAt: Date;
  readonly continuity: RuntimeContinuitySnapshot;
  readonly runtimeEvents: readonly CapturedRuntimeLedgerEvent[];
  readonly planSubmissions?: readonly {
    readonly planId: string;
    readonly content: string;
  }[];
  readonly fileChanges?: readonly RuntimeTurnFileChange[];
}

export function appendCanonicalTurnEvents(input: AppendCanonicalTurnEventsInput): readonly CanonicalSessionEvent[] {
  const { session } = input;
  const turnOrdinal = Math.max(session.userTurnCount, 1);
  const turnId = `${session.id}:turn:${turnOrdinal}`;
  const userMessageContent = input.userMessageContent.trim();
  const assistantMessageContent = input.assistantMessageContent?.trim();
  const events: CanonicalSessionEvent[] = [];
  const runtimeSource = makeSource("runtime", "runtime", "message-pipeline");
  const userSource = makeSource("user", mapChannelToSurface(input.channel), "message-pipeline");
  const assistantSource = makeSource("assistant", "runtime", "message-pipeline");

  let sequence = session.nextSessionEventSequence();
  const nextSequence = () => sequence++;
  const pendingApprovalIds: string[] = [];
  const pendingToolCallIds = new Map<string, string[]>();
  let approvalOrdinal = 0;
  let toolOrdinal = 0;
  let previousTotalCostUsd = 0;

  events.push(createSessionEvent<"turn_started">({
    kilnSessionId: session.id,
    sequence: nextSequence(),
    kind: "turn_started",
    turnId,
    turnOrdinal,
    trigger: "user_message",
    source: runtimeSource,
    timestamp: input.turnStartedAt,
  }));

  events.push(createSessionEvent<"user_message">({
    kilnSessionId: session.id,
    sequence: nextSequence(),
    kind: "user_message",
    turnId,
    messageId: `${turnId}:user`,
    content: userMessageContent,
    source: userSource,
    timestamp: input.turnStartedAt,
  }));

  events.push(createSessionEvent<"continuity_decided">({
    kilnSessionId: session.id,
    sequence: nextSequence(),
    kind: "continuity_decided",
    turnId,
    decision: "continue",
    reason: formatContinuityReason(input.continuity),
    source: runtimeSource,
    timestamp: input.turnStartedAt,
  }));

  for (const runtimeEvent of input.runtimeEvents) {
    switch (runtimeEvent.type) {
      case "model_routed": {
        events.push(createSessionEvent<"provider_routed">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "provider_routed",
          turnId,
          provider: toSessionProviderIdentity(runtimeEvent),
          reason: runtimeEvent.reason,
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "tool_called": {
        const toolCallId = `${turnId}:tool:${++toolOrdinal}`;
        const pending = pendingToolCallIds.get(runtimeEvent.toolName) ?? [];
        pending.push(toolCallId);
        pendingToolCallIds.set(runtimeEvent.toolName, pending);
        events.push(createSessionEvent<"tool_call_started">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "tool_call_started",
          turnId,
          toolCallId,
          toolName: runtimeEvent.toolName,
          input: runtimeEvent.toolInput,
          ...(runtimeEvent.metadata ? { metadata: runtimeEvent.metadata } : {}),
          source: makeSource("tool", "runtime", "orchestrator"),
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "tool_result": {
        const pending = pendingToolCallIds.get(runtimeEvent.toolName);
        const toolCallId = pending?.shift() ?? `${turnId}:tool:${++toolOrdinal}`;
        if (pending && pending.length === 0) {
          pendingToolCallIds.delete(runtimeEvent.toolName);
        }
        events.push(createSessionEvent<"tool_call_completed">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "tool_call_completed",
          turnId,
          toolCallId,
          toolName: runtimeEvent.toolName,
          status: toSessionToolStatus(runtimeEvent),
          durationMs: runtimeEvent.durationMs,
          output: runtimeEvent.output,
          outputSummary: runtimeEvent.resultSummary,
          source: makeSource("tool", "runtime", "orchestrator"),
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "approval_requested": {
        const approvalId = `${turnId}:approval:${++approvalOrdinal}`;
        pendingApprovalIds.push(approvalId);
        events.push(createSessionEvent<"approval_requested">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "approval_requested",
          turnId,
          approvalId,
          action: runtimeEvent.description,
          justification: runtimeEvent.description,
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "approval_received": {
        const approvalId = pendingApprovalIds.shift() ?? `${turnId}:approval:${++approvalOrdinal}`;
        events.push(createSessionEvent<"approval_resolved">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "approval_resolved",
          turnId,
          approvalId,
          resolution: {
            decision: runtimeEvent.approved ? "approved" : "denied",
            resolvedBy: "operator",
            reason: runtimeEvent.reason,
          },
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "cost_update": {
        const totalCostUsd = runtimeEvent.totalCostUsd;
        const deltaUsd = Math.max(0, totalCostUsd - previousTotalCostUsd);
        previousTotalCostUsd = totalCostUsd;
        events.push(createSessionEvent<"cost_updated">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "cost_updated",
          turnId,
          provider: toSessionProviderIdentity(runtimeEvent),
          usage: {
            inputTokens: runtimeEvent.inputTokens,
            outputTokens: runtimeEvent.outputTokens,
            cacheReadTokens: runtimeEvent.cacheReadTokens,
            cacheWriteTokens: 0,
          },
          cost: {
            currency: "USD",
            deltaUsd,
            totalUsd: totalCostUsd,
          },
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "error": {
        events.push(createSessionEvent<"error_recorded">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "error_recorded",
          turnId,
          errorCode: runtimeEvent.code,
          message: runtimeEvent.message,
          retriable: false,
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
    }
  }

  for (const submission of input.planSubmissions ?? []) {
    events.push(createSessionEvent<"plan_submitted">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "plan_submitted",
      turnId,
      planId: submission.planId,
      mode: "plan",
      content: submission.content,
      source: runtimeSource,
      timestamp: input.turnCompletedAt,
    }));
  }

  for (const fileChange of input.fileChanges ?? []) {
    events.push(createSessionEvent<"file_changed">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "file_changed",
      turnId,
      change: {
        changeType: mapFileChangeType(fileChange.changeType),
        path: fileChange.path,
        linesAdded: fileChange.linesAdded,
        linesRemoved: fileChange.linesRemoved,
        diffPreview: fileChange.diffPreview,
        diffTruncated: fileChange.diffTruncated,
      },
      source: makeSource("tool", "runtime", "message-pipeline"),
      timestamp: input.turnCompletedAt,
    }));
  }

  if (assistantMessageContent && assistantMessageContent.length > 0) {
    events.push(createSessionEvent<"assistant_message">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "assistant_message",
      turnId,
      messageId: `${turnId}:assistant`,
      content: assistantMessageContent,
      source: assistantSource,
      timestamp: input.turnCompletedAt,
    }));
  }

  events.push(createSessionEvent<"turn_completed">({
    kilnSessionId: session.id,
    sequence: nextSequence(),
    kind: "turn_completed",
    turnId,
    outcome: input.queued ? "cancelled" : "completed",
    outputMessageId: assistantMessageContent ? `${turnId}:assistant` : undefined,
    durationMs: Math.max(0, input.turnCompletedAt.getTime() - input.turnStartedAt.getTime()),
    source: runtimeSource,
    timestamp: input.turnCompletedAt,
  }));

  session.appendSessionEvents(events);
  return events;
}

function mapChannelToSurface(channel: string): SessionEventSource["surface"] {
  switch (channel) {
    case "gui":
      return "gui";
    case "tui":
      return "tui";
    default:
      return "gateway";
  }
}

function makeSource(
  actor: SessionEventSource["actor"],
  surface: SessionEventSource["surface"],
  component: string,
): SessionEventSource {
  return { actor, surface, component };
}

function formatContinuityReason(continuity: RuntimeContinuitySnapshot): string {
  const parts = [`strategy=${continuity.strategy}`];
  if (continuity.feedbackLabel) {
    parts.push(`feedback=${continuity.feedbackLabel}`);
  }
  if (continuity.selectionReason) {
    parts.push(`selection=${continuity.selectionReason}`);
  }
  if (continuity.fallbackLabel) {
    parts.push(`fallback=${continuity.fallbackLabel}`);
  }
  return parts.join("; ");
}

function toSessionProviderIdentity(event: {
  readonly provider?: string;
  readonly model?: string;
  readonly canonicalModel?: string;
  readonly billingMode?: SessionProviderIdentity["billingMode"];
}): SessionProviderIdentity {
  return {
    provider: event.provider ?? "unknown",
    model: event.model ?? event.canonicalModel ?? "unknown",
    canonicalModel: event.canonicalModel,
    billingMode: event.billingMode,
  };
}

function toSessionToolStatus(event: ToolResultEvent): SessionToolStatus {
  if (event.success) {
    return { state: "succeeded" };
  }
  return {
    state: "failed",
    errorCode: event.isError ? "tool_error" : undefined,
    errorMessage: event.resultSummary,
  };
}

function mapFileChangeType(changeType: string | undefined): "created" | "updated" | "deleted" | "renamed" {
  switch (changeType) {
    case "created":
      return "created";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    default:
      return "updated";
  }
}
