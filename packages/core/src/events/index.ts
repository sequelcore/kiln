import type { TraceSpan } from "./trace.js";

/** Streaming granularity levels, from coarsest to finest */
export type StreamLevel = "state" | "phase" | "tool" | "token";

/** Map each event type to its streaming level */
export const EVENT_LEVEL_MAP: Record<EventType, StreamLevel> = {
  phase_changed: "phase",
  approval_requested: "phase",
  approval_received: "phase",
  task_started: "phase",
  task_completed: "phase",
  tool_called: "tool",
  tool_result: "tool",
  thinking: "token",
  verification_result: "tool",
  cost_update: "state",
  memory_saved: "state",
  memory_recalled: "state",
  memory_sync: "state",
  worker_assigned: "phase",
  error: "phase",
  trace_span: "state",
  handoff_requested: "phase",
  handoff_completed: "phase",
  interrupt_requested: "phase",
  interrupt_resumed: "phase",
  // Security (Phase 3)
  injection_scanned: "phase",
  guardian_reviewed: "phase",
  audit_entry: "state",
  tenant_isolation_violation: "phase",
  security_alert: "state",
  // Triggers (Phase 5)
  webhook_received: "phase",
  trigger_fired: "phase",
  trigger_failed: "phase",
  schedule_fired: "phase",
};

/** Level hierarchy: subscribing to "phase" includes "state" + "phase" */
export const LEVEL_HIERARCHY: Record<StreamLevel, readonly StreamLevel[]> = {
  state: ["state"],
  phase: ["state", "phase"],
  tool: ["state", "phase", "tool"],
  token: ["state", "phase", "tool", "token"],
};

/** All event types emitted by the orchestrator */
export type EventType =
  | "phase_changed"
  | "task_started"
  | "task_completed"
  | "tool_called"
  | "tool_result"
  | "thinking"
  | "verification_result"
  | "cost_update"
  | "memory_saved"
  | "memory_recalled"
  | "memory_sync"
  | "approval_requested"
  | "approval_received"
  | "worker_assigned"
  | "error"
  | "trace_span"
  | "handoff_requested"
  | "handoff_completed"
  | "interrupt_requested"
  | "interrupt_resumed"
  // Security (Phase 3)
  | "injection_scanned"
  | "guardian_reviewed"
  | "audit_entry"
  | "tenant_isolation_violation"
  | "security_alert"
  // Triggers (Phase 5)
  | "webhook_received"
  | "trigger_fired"
  | "trigger_failed"
  | "schedule_fired";

/** Base event interface */
export interface KilnEvent {
  readonly type: EventType;
  readonly timestamp: Date;
  readonly sessionId: string;
}

/** Phase transition event */
export interface PhaseChangedEvent extends KilnEvent {
  readonly type: "phase_changed";
  readonly phase: string;
  readonly phaseName: string;
  readonly phaseDescription: string;
}

/** Cost update event */
export interface CostUpdateEvent extends KilnEvent {
  readonly type: "cost_update";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly totalCostUsd: number;
  readonly byRole: Record<string, { model: string; calls: number; costUsd: number }>;
}

/** Tool called event */
export interface ToolCalledEvent extends KilnEvent {
  readonly type: "tool_called";
  readonly toolName: string;
  readonly taskId: string;
  readonly workerIndex: number;
}

/** Task started event */
export interface TaskStartedEvent extends KilnEvent {
  readonly type: "task_started";
  readonly taskId: string;
  readonly statement: string;
  readonly parentId: string | null;
}

/** Task completed event */
export interface TaskCompletedEvent extends KilnEvent {
  readonly type: "task_completed";
  readonly taskId: string;
  readonly status: string;
  readonly action: string;
}

/** Tool result event */
export interface ToolResultEvent extends KilnEvent {
  readonly type: "tool_result";
  readonly toolName: string;
  readonly taskId: string;
  readonly durationMs: number;
  readonly success: boolean;
}

/** Thinking event (agent reasoning) */
export interface ThinkingEvent extends KilnEvent {
  readonly type: "thinking";
  readonly role: string;
  readonly content: string;
}

/** Verification result event */
export interface VerificationResultEvent extends KilnEvent {
  readonly type: "verification_result";
  readonly passed: boolean;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly checks: readonly { name: string; passed: boolean; output: string }[];
}

/** Memory saved event */
export interface MemorySavedEvent extends KilnEvent {
  readonly type: "memory_saved";
  readonly memoryId: string;
  readonly layer: string;
  readonly tags: readonly string[];
}

/** Memory recalled event */
export interface MemoryRecalledEvent extends KilnEvent {
  readonly type: "memory_recalled";
  readonly query: string;
  readonly resultsCount: number;
}

/** Memory sync event (chunks imported from git) */
export interface MemorySyncEvent extends KilnEvent {
  readonly type: "memory_sync";
  readonly imported: number;
  readonly entries: number;
  readonly developers: number;
}

/** Approval requested event */
export interface ApprovalRequestedEvent extends KilnEvent {
  readonly type: "approval_requested";
  readonly taskId: string;
  readonly description: string;
}

/** Approval received event */
export interface ApprovalReceivedEvent extends KilnEvent {
  readonly type: "approval_received";
  readonly taskId: string;
  readonly approved: boolean;
}

/** Worker assigned event */
export interface WorkerAssignedEvent extends KilnEvent {
  readonly type: "worker_assigned";
  readonly workerIndex: number;
  readonly taskId: string;
}

/** Error event */
export interface ErrorEvent extends KilnEvent {
  readonly type: "error";
  readonly message: string;
  readonly code: string;
  readonly taskId: string | null;
}

/** Trace span event */
export interface TraceSpanEvent extends KilnEvent {
  readonly type: "trace_span";
  readonly span: TraceSpan;
}

/** Handoff requested event (swarm/supervisor delegation) */
export interface HandoffRequestedEvent extends KilnEvent {
  readonly type: "handoff_requested";
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly reason: string;
  readonly context?: Record<string, unknown>;
}

/** Handoff completed event */
export interface HandoffCompletedEvent extends KilnEvent {
  readonly type: "handoff_completed";
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly accepted: boolean;
}

/** Interrupt requested event (execution paused for external input) */
export interface InterruptRequestedEvent extends KilnEvent {
  readonly type: "interrupt_requested";
  readonly checkpointId: string;
  readonly reason: string;
  readonly resumeSchema?: Record<string, unknown>;
}

/** Interrupt resumed event (external input provided) */
export interface InterruptResumedEvent extends KilnEvent {
  readonly type: "interrupt_resumed";
  readonly checkpointId: string;
  readonly resumeValue: unknown;
}

/** Injection scanned event (security) */
export interface InjectionScannedEvent extends KilnEvent {
  readonly type: "injection_scanned";
  readonly safe: boolean;
  readonly threats: number;
  readonly tier: "heuristic" | "deep";
  readonly inputPreview: string;
}

/** Guardian reviewed event (security) */
export interface GuardianReviewedEvent extends KilnEvent {
  readonly type: "guardian_reviewed";
  readonly approved: boolean;
  readonly capabilityName: string;
  readonly agentName: string;
  readonly riskLevel: string;
  readonly reason: string;
}

/** Audit entry event (security) */
export interface AuditEntryEvent extends KilnEvent {
  readonly type: "audit_entry";
  readonly action: string;
  readonly actor: string;
  readonly outcome: string;
  readonly resource: string;
}

/** Tenant isolation violation event (security) */
export interface TenantIsolationViolationEvent extends KilnEvent {
  readonly type: "tenant_isolation_violation";
  readonly tenantId: string;
  readonly attemptedResource: string;
  readonly blockedBy: string;
}

/** Security alert event */
export interface SecurityAlertEvent extends KilnEvent {
  readonly type: "security_alert";
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly category: string;
  readonly message: string;
}

/** Webhook received event (trigger) */
export interface WebhookReceivedEvent extends KilnEvent {
  readonly type: "webhook_received";
  readonly path: string;
  readonly appName: string;
  readonly triggerName: string;
  readonly method: string;
}

/** Trigger fired event */
export interface TriggerFiredEvent extends KilnEvent {
  readonly type: "trigger_fired";
  readonly triggerName: string;
  readonly triggerType: string;
  readonly team: string;
  readonly task: string;
}

/** Trigger failed event */
export interface TriggerFailedEvent extends KilnEvent {
  readonly type: "trigger_failed";
  readonly triggerName: string;
  readonly triggerType: string;
  readonly error: string;
}

/** Schedule fired event */
export interface ScheduleFiredEvent extends KilnEvent {
  readonly type: "schedule_fired";
  readonly triggerName: string;
  readonly cron: string;
  readonly team: string;
}

/** Maps each event type to its corresponding event interface */
export interface EventMap {
  phase_changed: PhaseChangedEvent;
  task_started: TaskStartedEvent;
  task_completed: TaskCompletedEvent;
  tool_called: ToolCalledEvent;
  tool_result: ToolResultEvent;
  thinking: ThinkingEvent;
  verification_result: VerificationResultEvent;
  cost_update: CostUpdateEvent;
  memory_saved: MemorySavedEvent;
  memory_recalled: MemoryRecalledEvent;
  memory_sync: MemorySyncEvent;
  approval_requested: ApprovalRequestedEvent;
  approval_received: ApprovalReceivedEvent;
  worker_assigned: WorkerAssignedEvent;
  error: ErrorEvent;
  trace_span: TraceSpanEvent;
  handoff_requested: HandoffRequestedEvent;
  handoff_completed: HandoffCompletedEvent;
  interrupt_requested: InterruptRequestedEvent;
  interrupt_resumed: InterruptResumedEvent;
  // Security (Phase 3)
  injection_scanned: InjectionScannedEvent;
  guardian_reviewed: GuardianReviewedEvent;
  audit_entry: AuditEntryEvent;
  tenant_isolation_violation: TenantIsolationViolationEvent;
  security_alert: SecurityAlertEvent;
  // Triggers (Phase 5)
  webhook_received: WebhookReceivedEvent;
  trigger_fired: TriggerFiredEvent;
  trigger_failed: TriggerFailedEvent;
  schedule_fired: ScheduleFiredEvent;
}

export { EventBus } from "./event-bus.js";
export { createTraceContext, startSpan, endSpan, addSpanEvent } from "./trace.js";
export type { TraceSpan, SpanEvent, TraceContext } from "./trace.js";
