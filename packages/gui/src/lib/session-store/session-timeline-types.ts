import type {
  GuiModelRoutingRationale,
  GuiSessionEvent,
  OperatorEventDetailItem,
  OperatorGovernedWorkExecutionAttempt,
  OperatorGovernedWorkItemProjection,
  OperatorGovernedWorkPauseRequirement,
  ToolResultPresentation,
} from "@kilnai/gateway-contracts";

/**
 * Shared data shapes for the session timeline: messages, timeline entries,
 * tool calls, approvals, changed files, and work items. Pure, no store
 * dependency.
 */

export type SessionStatus = "idle" | "connecting" | "ready" | "running" | "error";

export interface ApprovalRequest {
  readonly id: string;
  readonly description: string;
  readonly sessionId: string;
  readonly requestedAt: string;
}

export type ToolCallStatus = "running" | "success" | "error";

export interface ToolCallEntry {
  readonly callId: string;
  readonly scopeId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly result?: string;
  readonly status: ToolCallStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export type ActivityPhase = "idle" | "thinking" | "tool_running" | "awaiting_approval" | "streaming";

export interface ChangedFileEntry {
  readonly path: string;
  readonly changeType: "created" | "modified" | "deleted";
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
  readonly diffPreview?: string;
  readonly diffTruncated?: boolean;
  readonly recordedAt: string;
}

export type WorkItemEntry = OperatorGovernedWorkItemProjection;
export type WorkItemPauseRequirementEntry = OperatorGovernedWorkPauseRequirement;
export type WorkItemExecutionAttemptEntry = OperatorGovernedWorkExecutionAttempt;

export interface Message {
  readonly id: string;
  readonly role: "user" | "assistant" | "tool" | "error";
  readonly content: string;
  readonly parts?: readonly unknown[];
  readonly sourceMessageId?: string;
  readonly voiceSynthesisStatus?: "idle" | "pending" | "ready" | "error";
  readonly createdAt: string;
  readonly streaming?: boolean;
  readonly routedProvider?: string;
  readonly routedModel?: string;
  readonly routingRationale?: GuiModelRoutingRationale;
  readonly sessionEventMessageId?: string;
}

export interface TimelineMessageEntry {
  readonly id: string;
  readonly type: "message";
  readonly createdAt: string;
  readonly sequence?: number;
  readonly turnId?: string;
  readonly message: Message;
}

export interface TimelineEventEntry {
  readonly id: string;
  readonly type: "event";
  readonly eventKind: GuiSessionEvent["kind"];
  readonly createdAt: string;
  readonly sequence?: number;
  readonly turnId?: string;
  readonly title: string;
  readonly summary?: string;
  readonly tone: "info" | "running" | "success" | "warning" | "error";
  readonly details?: unknown;
  readonly presentationDetails?: readonly OperatorEventDetailItem[];
  readonly toolPresentation?: ToolResultPresentation;
  readonly sessionId?: string;
}

export type TimelineEntry = TimelineMessageEntry | TimelineEventEntry;

export interface ActivityState {
  readonly phase?: string;
  readonly toolName?: string;
  readonly details?: string;
}

/** Inbound frame shapes accepted by the turn-streaming slice's `onTextDelta`/`onActivity` handlers. */
export type StoreTextDeltaFrame = {
  type: "text_delta";
  content: string;
  kilnSessionId: string;
  turnId?: string;
};

export type StoreActivityFrame = {
  type: "activity";
  activity: string;
  kilnSessionId: string;
  toolName?: string;
  output?: string;
  usd?: number;
  input?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  details?: string;
};

export function timelineTurnId(event: GuiSessionEvent): { readonly turnId?: string } {
  return event.turnId ? { turnId: event.turnId } : {};
}

/**
 * Re-embeds each timeline message entry's `message` with the corresponding
 * entry from an updated `messages` array, keeping the two views of the
 * transcript in sync after `messages` is mutated in place. Shared between
 * `turn-streaming-slice` (`onDone`) and `voice-slice`.
 */
export function syncTimelineMessages(
  timelineEntries: readonly TimelineEntry[],
  messages: readonly Message[],
): readonly TimelineEntry[] {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  return timelineEntries.map((entry) => (
    entry.type === "message"
      ? { ...entry, message: messagesById.get(entry.message.id) ?? entry.message }
      : entry
  ));
}
