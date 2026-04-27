import type { ExecutionBillingMode } from "../agents/execution-identity.js";

export type CanonicalSessionEventKind =
  | "turn_started"
  | "user_message"
  | "assistant_message"
  | "assistant_delta"
  | "provider_routed"
  | "tool_call_started"
  | "tool_call_completed"
  | "approval_requested"
  | "approval_resolved"
  | "file_changed"
  | "cost_updated"
  | "agent_invocation_requested"
  | "agent_invocation_started"
  | "agent_invocation_completed"
  | "agent_invocation_failed"
  | "agent_invocation_cancelled"
  | "continuity_decided"
  | "error_recorded"
  | "turn_completed";

export type SessionEventActor = "user" | "assistant" | "system" | "tool" | "runtime";
export type SessionEventSurface = "cli" | "tui" | "gui" | "ide" | "gateway" | "runtime";

export interface SessionEventSource {
  readonly actor: SessionEventActor;
  readonly surface: SessionEventSurface;
  readonly component?: string;
}

export interface SessionEventEnvelope<K extends CanonicalSessionEventKind = CanonicalSessionEventKind> {
  readonly eventId: string;
  readonly kilnSessionId: string;
  readonly sequence: number;
  readonly timestamp: Date;
  readonly kind: K;
  readonly turnId?: string;
  readonly parentEventId?: string;
  readonly source?: SessionEventSource;
}

export interface SessionProviderIdentity {
  readonly provider: string;
  readonly model: string;
  readonly canonicalModel?: string;
  readonly billingMode?: ExecutionBillingMode;
  readonly providerSessionId?: string;
  readonly providerRequestId?: string;
}

export interface SessionTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface SessionCost {
  readonly currency: "USD";
  readonly deltaUsd: number;
  readonly totalUsd?: number;
}

export type SessionFileChangeType = "created" | "updated" | "deleted" | "renamed";

export interface SessionFileChange {
  readonly changeType: SessionFileChangeType;
  readonly path: string;
  readonly previousPath?: string;
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
  readonly diffPreview?: string;
  readonly diffTruncated?: boolean;
  readonly bytesDelta?: number;
  readonly language?: string;
}

export type SessionApprovalDecision = "approved" | "denied" | "expired" | "cancelled";
export type SessionApprovalResolver = "user" | "operator" | "policy" | "system";

export interface SessionApprovalResolution {
  readonly decision: SessionApprovalDecision;
  readonly resolvedBy: SessionApprovalResolver;
  readonly reason?: string;
}

export type SessionToolTerminalState = "succeeded" | "failed" | "cancelled" | "timed_out";

export interface SessionToolStatus {
  readonly state: SessionToolTerminalState;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export type SessionContinuityDecision = "continue" | "handoff" | "fork" | "close";
export type SessionTurnOutcome = "completed" | "failed" | "cancelled";

export interface CanonicalTurnStartedEvent extends SessionEventEnvelope<"turn_started"> {
  readonly turnOrdinal: number;
  readonly trigger: "user_message" | "continuation" | "replay";
}

export interface CanonicalUserMessageEvent extends SessionEventEnvelope<"user_message"> {
  readonly messageId: string;
  readonly content: string;
}

export interface CanonicalAssistantMessageEvent extends SessionEventEnvelope<"assistant_message"> {
  readonly messageId: string;
  readonly content: string;
  readonly provider?: SessionProviderIdentity;
}

export interface CanonicalAssistantDeltaEvent extends SessionEventEnvelope<"assistant_delta"> {
  readonly messageId: string;
  readonly delta: string;
  readonly deltaIndex: number;
}

export interface CanonicalProviderRoutedEvent extends SessionEventEnvelope<"provider_routed"> {
  readonly provider: SessionProviderIdentity;
  readonly reason: string;
}

export interface CanonicalToolCallStartedEvent extends SessionEventEnvelope<"tool_call_started"> {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
}

export interface CanonicalToolCallCompletedEvent extends SessionEventEnvelope<"tool_call_completed"> {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: SessionToolStatus;
  readonly durationMs: number;
  readonly outputSummary?: string;
}

export interface CanonicalApprovalRequestedEvent extends SessionEventEnvelope<"approval_requested"> {
  readonly approvalId: string;
  readonly action: string;
  readonly justification?: string;
}

export interface CanonicalApprovalResolvedEvent extends SessionEventEnvelope<"approval_resolved"> {
  readonly approvalId: string;
  readonly resolution: SessionApprovalResolution;
}

export interface CanonicalFileChangedEvent extends SessionEventEnvelope<"file_changed"> {
  readonly change: SessionFileChange;
  readonly toolCallId?: string;
}

export interface CanonicalCostUpdatedEvent extends SessionEventEnvelope<"cost_updated"> {
  readonly provider: SessionProviderIdentity;
  readonly usage: SessionTokenUsage;
  readonly cost: SessionCost;
}

export interface SessionAgentInvocationIdentity {
  readonly invocationId: string;
  readonly agentId: string;
  readonly agentName?: string;
  readonly parentSessionId?: string;
  readonly requestedBy?: string;
  readonly requestSource?: string;
}

export interface CanonicalAgentInvocationRequestedEvent extends SessionEventEnvelope<"agent_invocation_requested">, SessionAgentInvocationIdentity {
  readonly inputSummary?: string;
}

export interface CanonicalAgentInvocationStartedEvent extends SessionEventEnvelope<"agent_invocation_started">, SessionAgentInvocationIdentity {
  readonly attempt?: number;
}

export interface CanonicalAgentInvocationCompletedEvent extends SessionEventEnvelope<"agent_invocation_completed">, SessionAgentInvocationIdentity {
  readonly durationMs?: number;
  readonly resultSummary?: string;
  readonly outputMessageId?: string;
}

export interface CanonicalAgentInvocationFailedEvent extends SessionEventEnvelope<"agent_invocation_failed">, SessionAgentInvocationIdentity {
  readonly errorCode?: string;
  readonly errorMessage: string;
  readonly retriable?: boolean;
}

export interface CanonicalAgentInvocationCancelledEvent extends SessionEventEnvelope<"agent_invocation_cancelled">, SessionAgentInvocationIdentity {
  readonly reason?: string;
  readonly cancelledBy?: string;
}

export interface CanonicalContinuityDecidedEvent extends SessionEventEnvelope<"continuity_decided"> {
  readonly decision: SessionContinuityDecision;
  readonly reason: string;
  readonly nextTurnId?: string;
}

export interface CanonicalErrorRecordedEvent extends SessionEventEnvelope<"error_recorded"> {
  readonly errorCode: string;
  readonly message: string;
  readonly retriable: boolean;
  readonly details?: Record<string, unknown>;
}

export interface CanonicalTurnCompletedEvent extends SessionEventEnvelope<"turn_completed"> {
  readonly outcome: SessionTurnOutcome;
  readonly outputMessageId?: string;
  readonly durationMs?: number;
}

export interface CanonicalSessionEventMap {
  turn_started: CanonicalTurnStartedEvent;
  user_message: CanonicalUserMessageEvent;
  assistant_message: CanonicalAssistantMessageEvent;
  assistant_delta: CanonicalAssistantDeltaEvent;
  provider_routed: CanonicalProviderRoutedEvent;
  tool_call_started: CanonicalToolCallStartedEvent;
  tool_call_completed: CanonicalToolCallCompletedEvent;
  approval_requested: CanonicalApprovalRequestedEvent;
  approval_resolved: CanonicalApprovalResolvedEvent;
  file_changed: CanonicalFileChangedEvent;
  cost_updated: CanonicalCostUpdatedEvent;
  agent_invocation_requested: CanonicalAgentInvocationRequestedEvent;
  agent_invocation_started: CanonicalAgentInvocationStartedEvent;
  agent_invocation_completed: CanonicalAgentInvocationCompletedEvent;
  agent_invocation_failed: CanonicalAgentInvocationFailedEvent;
  agent_invocation_cancelled: CanonicalAgentInvocationCancelledEvent;
  continuity_decided: CanonicalContinuityDecidedEvent;
  error_recorded: CanonicalErrorRecordedEvent;
  turn_completed: CanonicalTurnCompletedEvent;
}

export type CanonicalSessionEvent = CanonicalSessionEventMap[CanonicalSessionEventKind];

export type SessionEventInput<K extends CanonicalSessionEventKind> =
  Omit<CanonicalSessionEventMap[K], "eventId" | "timestamp"> & {
    readonly eventId?: string;
    readonly timestamp?: Date;
  };

export interface CreateSessionEventOptions {
  readonly generateEventId?: () => string;
  readonly now?: () => Date;
}

export function createSessionEvent<K extends CanonicalSessionEventKind>(
  input: SessionEventInput<K>,
  options: CreateSessionEventOptions = {},
): CanonicalSessionEventMap[K] {
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new RangeError(`Session event sequence must be an integer >= 1, received: ${input.sequence}`);
  }

  const generateEventId = options.generateEventId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());

  const event = {
    ...input,
    eventId: input.eventId ?? generateEventId(),
    timestamp: input.timestamp ?? now(),
  } as CanonicalSessionEventMap[K];

  return event;
}

export function compareSessionEvents(a: SessionEventEnvelope, b: SessionEventEnvelope): number {
  if (a.sequence !== b.sequence) {
    return a.sequence - b.sequence;
  }

  const timestampDiff = a.timestamp.getTime() - b.timestamp.getTime();
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  return a.eventId.localeCompare(b.eventId);
}
