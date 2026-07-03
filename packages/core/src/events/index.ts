import type { ExecutionBillingMode } from "../agents/execution-identity.js";
import type {
  MemoryLayerKind,
  MemoryRelationType,
  MemoryScope,
} from "../memory/domain/index.js";
import type {
  MultimodalCapability,
  MultimodalDelegationEvidence,
  MultimodalDiagnosticSeverity,
  MultimodalRoutingStrategy,
  MultimodalTransportModality,
} from "../engine/domain/multimodal-routing.js";
import type { TraceSpan } from "./trace.js";
import type { ExecutionCostEvidence } from "../cost/index.js";
export type {
  ExecutionSessionCostTrackingMode,
  ExecutionSessionEvent,
  ExecutionSessionRunOptions,
  ExecutionSessionToolResultResourceLink,
  ProviderRequestEvidence,
} from "./execution-session-event.js";

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
  tool_authorized: "tool",
  tool_result: "tool",
  tool_cache_hit: "tool",
  thinking: "token",
  verification_result: "tool",
  cost_update: "state",
  memory_saved: "state",
  memory_recalled: "state",
  memory_sync: "state",
  memory_record_created: "state",
  memory_record_updated: "state",
  memory_record_deleted: "state",
  memory_relation_created: "state",
  memory_relation_deleted: "state",
  memory_revision_created: "state",
  memory_context_admitted: "state",
  memory_context_deferred: "state",
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
  // Safety (Phase 12)
  pii_detected: "phase",
  content_classified: "phase",
  policy_evaluated: "phase",
  grounding_evaluated: "phase",
  // Knowledge (Phase 14)
  knowledge_gap: "state",
  knowledge_source_failed: "state",
  precompact: "state",
  postcompact: "state",
  // Routing (Phase 8)
  agent_routed: "phase",
  // Intelligence (Phase 9)
  model_routed: "phase",
  multimodal_routed: "phase",
  conversation_closed: "state",
  conversation_enriched: "state",
  // Domain apps
  domain_event: "tool",
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
  | "tool_authorized"
  | "tool_result"
  | "tool_cache_hit"
  | "thinking"
  | "verification_result"
  | "cost_update"
  | "memory_saved"
  | "memory_recalled"
  | "memory_sync"
  | "memory_record_created"
  | "memory_record_updated"
  | "memory_record_deleted"
  | "memory_relation_created"
  | "memory_relation_deleted"
  | "memory_revision_created"
  | "memory_context_admitted"
  | "memory_context_deferred"
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
  | "schedule_fired"
  // Safety (Phase 12)
  | "pii_detected"
  | "content_classified"
  | "policy_evaluated"
  | "grounding_evaluated"
  // Knowledge (Phase 14)
  | "knowledge_gap"
  | "knowledge_source_failed"
  | "precompact"
  | "postcompact"
  // Routing (Phase 8)
  | "agent_routed"
  // Intelligence (Phase 9)
  | "model_routed"
  | "multimodal_routed"
  | "conversation_closed"
  | "conversation_enriched"
  // Domain apps
  | "domain_event";

/** Base event interface */
export interface KilnEvent {
  readonly type: EventType;
  readonly timestamp: Date;
  readonly sessionId: string;
  readonly tenantId?: string;
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
  readonly provider?: string;
  readonly model?: string;
  readonly canonicalModel?: string;
  readonly billingMode?: ExecutionBillingMode;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalCostUsd: number;
  readonly costEvidence?: ExecutionCostEvidence;
  readonly byRoleModel: Record<string, {
    model: string;
    provider?: string;
    canonicalModel?: string;
    billingMode?: ExecutionBillingMode;
    calls: number;
    costUsd: number;
    costEvidence?: ExecutionCostEvidence;
  }>;
  readonly agentId?: string;
}

/** Tool called event */
export interface ToolCalledEvent extends KilnEvent {
  readonly type: "tool_called";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly taskId?: string;
  readonly workerIndex?: number;
  readonly toolInput?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly authorizationLevel?: number;
  readonly resolvedEffect?: import("../engine/domain/action-effect.js").ResolvedInvocationEffect;
  readonly authority?: import("../engine/domain/tool-execution.js").AuthorityDescriptor;
}

/** Tool authorized event */
export interface ToolAuthorizedEvent extends KilnEvent {
  readonly type: "tool_authorized";
  readonly toolName: string;
  readonly level: number;
  readonly allowed: boolean;
  readonly reason: string;
  readonly resolvedEffect?: import("../engine/domain/action-effect.js").ResolvedInvocationEffect;
  readonly authority?: import("../engine/domain/tool-execution.js").AuthorityDescriptor;
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
  readonly toolCallId: string;
  readonly toolName: string;
  readonly taskId?: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly output?: string;
  readonly resultSummary?: string;
  readonly isError?: boolean;
  readonly retryAttempt?: number;
  readonly metadata?: Record<string, unknown>;
  readonly resourceLinks?: readonly import("./execution-session-event.js").ExecutionSessionToolResultResourceLink[];
  readonly toolUsage?: import("./session-event.js").SessionToolUsageSnapshot;
  readonly resolvedEffect?: import("../engine/domain/action-effect.js").ResolvedInvocationEffect;
  readonly authority?: import("../engine/domain/tool-execution.js").AuthorityDescriptor;
}

/** Tool cache hit event -- cached result used instead of executing tool */
export interface ToolCacheHitEvent extends KilnEvent {
  readonly type: "tool_cache_hit";
  readonly toolName: string;
  readonly cacheTtl: number;
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

export interface MemoryRecordCreatedEvent extends KilnEvent {
  readonly type: "memory_record_created";
  readonly recordId: string;
  readonly scope: MemoryScope;
  readonly layer: MemoryLayerKind;
  readonly topicKey?: string;
}

export interface MemoryRecordUpdatedEvent extends KilnEvent {
  readonly type: "memory_record_updated";
  readonly recordId: string;
  readonly scope: MemoryScope;
  readonly layer: MemoryLayerKind;
  readonly topicKey?: string;
}

export interface MemoryRecordDeletedEvent extends KilnEvent {
  readonly type: "memory_record_deleted";
  readonly recordId: string;
  readonly scope: MemoryScope;
  readonly layer: MemoryLayerKind;
}

export interface MemoryRelationCreatedEvent extends KilnEvent {
  readonly type: "memory_relation_created";
  readonly relationId: string;
  readonly sourceRecordId: string;
  readonly targetRecordId?: string;
  readonly targetUri?: string;
  readonly relationType: MemoryRelationType;
  readonly scope?: MemoryScope;
}

export interface MemoryRelationDeletedEvent extends KilnEvent {
  readonly type: "memory_relation_deleted";
  readonly relationId: string;
  readonly sourceRecordId: string;
  readonly scope?: MemoryScope;
}

export interface MemoryRevisionCreatedEvent extends KilnEvent {
  readonly type: "memory_revision_created";
  readonly revisionId: string;
  readonly recordId: string;
  readonly scope?: MemoryScope;
}

export interface MemoryContextAdmittedEvent extends KilnEvent {
  readonly type: "memory_context_admitted";
  readonly admissionId: string;
  readonly recordId: string;
  readonly scope?: MemoryScope;
}

export interface MemoryContextDeferredEvent extends KilnEvent {
  readonly type: "memory_context_deferred";
  readonly admissionId: string;
  readonly recordId: string;
  readonly scope?: MemoryScope;
}

/** Pre-compact event (memory compaction about to run) */
export interface PrecompactEvent extends KilnEvent {
  readonly type: "precompact";
  readonly scope: string;
  readonly entryCount: number;
  readonly thresholdHit: number;
}

/** Post-compact event (memory compaction completed) */
export interface PostcompactEvent extends KilnEvent {
  readonly type: "postcompact";
  readonly scope: string;
  readonly removedCount: number;
  readonly remainingCount: number;
  readonly durationMs: number;
}

/** Approval requested event */
export interface ApprovalRequestedEvent extends KilnEvent {
  readonly type: "approval_requested";
  readonly approvalId: string;
  readonly taskId: string;
  readonly description: string;
}

/** Approval received event */
export interface ApprovalReceivedEvent extends KilnEvent {
  readonly type: "approval_received";
  readonly approvalId: string;
  readonly taskId: string;
  readonly approved: boolean;
  readonly reason?: string;
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

/** PII detected event (safety) */
export interface PiiDetectedEvent extends KilnEvent {
  readonly type: "pii_detected";
  readonly direction: "input" | "output";
  readonly piiTypes: readonly string[];
  readonly action: string;
  readonly count: number;
  readonly tier: "heuristic" | "deep";
}

/** Content classified event (safety) */
export interface ContentClassifiedEvent extends KilnEvent {
  readonly type: "content_classified";
  readonly direction: "input" | "output";
  readonly categories: Record<string, number>;
  readonly blocked: boolean;
  readonly tier: "heuristic" | "deep";
}

/** Policy evaluated event (safety) */
export interface PolicyEvaluatedEvent extends KilnEvent {
  readonly type: "policy_evaluated";
  readonly railType: string;
  readonly allowed: boolean;
  readonly reason?: string;
  readonly direction: "input" | "output";
}

/** Grounding verification event (safety) */
export interface GroundingEvaluatedEvent extends KilnEvent {
  readonly type: "grounding_evaluated";
  readonly grounded: boolean;
  readonly confidence: number;
  readonly ungroundedClaims: readonly string[];
  readonly durationMs: number;
  readonly model: string;
}

/** Knowledge gap detected event -- query had low or no results */
export interface KnowledgeGapEvent extends KilnEvent {
  readonly type: "knowledge_gap";
  readonly query: string;
  readonly topScore: number;
  readonly threshold: number;
  readonly retrievedCount: number;
}

/** Knowledge source ingestion failed event */
export interface KnowledgeSourceFailedEvent extends KilnEvent {
  readonly type: "knowledge_source_failed";
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceType: string;
  readonly error: string;
  readonly appName: string;
}

/** Agent routed event (multi-agent routing) */
export interface AgentRoutedEvent extends KilnEvent {
  readonly type: "agent_routed";
  readonly agentId: string;
  readonly agentName: string;
  readonly previousAgentId?: string;
  readonly routingTier: "rule" | "embedding" | "fallback";
  readonly matchedPattern?: string;
  readonly confidence?: number;
}

/** Model routing decision event */
export interface ModelRoutedEvent extends KilnEvent {
  readonly type: "model_routed";
  readonly model: string;
  readonly provider: string;
  readonly canonicalModel?: string;
  readonly billingMode?: ExecutionBillingMode;
  readonly previousModel?: string;
  readonly routingTier: "rule" | "complexity" | "cascade" | "default";
  readonly complexityScore?: number;
  readonly reason: string;
  readonly selectionMode?: "auto" | "manual_override";
  readonly reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  readonly rationale?: import("../engine/domain/model-router.js").ModelRoutingRationale;
}

export interface MultimodalRoutedEvent extends KilnEvent {
  readonly type: "multimodal_routed";
  readonly provider: string;
  readonly model: string;
  readonly strategy: MultimodalRoutingStrategy;
  readonly reasonCode: string;
  readonly reason: string;
  readonly requestedCapability: MultimodalCapability;
  readonly requiredModalities: readonly MultimodalTransportModality[];
  readonly artifactUris: readonly string[];
  readonly delegation?: MultimodalDelegationEvidence;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly severity: MultimodalDiagnosticSeverity;
    readonly message: string;
    readonly provider?: string;
    readonly model?: string;
  }[];
}

/** Conversation closed event (session ended normally) */
export interface ConversationClosedInternalEvent extends KilnEvent {
  readonly type: "conversation_closed";
  readonly closedBy: "user" | "operator" | "session_timeout" | "resolved";
  readonly turnCount: number;
  readonly durationMs: number;
  readonly effortScore?: number;
}

/** Conversation enriched event (post-conversation enrichment completed) */
export interface ConversationEnrichedEvent extends KilnEvent {
  readonly type: "conversation_enriched";
  readonly enrichmentId: string;
}

/** Custom domain event for app-specific event types */
export interface DomainEventData extends KilnEvent {
  readonly type: "domain_event";
  readonly name: string;
  readonly payload: Record<string, unknown>;
}

/** Maps each event type to its corresponding event interface */
export interface EventMap {
  phase_changed: PhaseChangedEvent;
  task_started: TaskStartedEvent;
  task_completed: TaskCompletedEvent;
  tool_called: ToolCalledEvent;
  tool_authorized: ToolAuthorizedEvent;
  tool_result: ToolResultEvent;
  tool_cache_hit: ToolCacheHitEvent;
  thinking: ThinkingEvent;
  verification_result: VerificationResultEvent;
  cost_update: CostUpdateEvent;
  memory_saved: MemorySavedEvent;
  memory_recalled: MemoryRecalledEvent;
  memory_sync: MemorySyncEvent;
  memory_record_created: MemoryRecordCreatedEvent;
  memory_record_updated: MemoryRecordUpdatedEvent;
  memory_record_deleted: MemoryRecordDeletedEvent;
  memory_relation_created: MemoryRelationCreatedEvent;
  memory_relation_deleted: MemoryRelationDeletedEvent;
  memory_revision_created: MemoryRevisionCreatedEvent;
  memory_context_admitted: MemoryContextAdmittedEvent;
  memory_context_deferred: MemoryContextDeferredEvent;
  precompact: PrecompactEvent;
  postcompact: PostcompactEvent;
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
  // Safety (Phase 12)
  pii_detected: PiiDetectedEvent;
  content_classified: ContentClassifiedEvent;
  policy_evaluated: PolicyEvaluatedEvent;
  grounding_evaluated: GroundingEvaluatedEvent;
  // Knowledge (Phase 14)
  knowledge_gap: KnowledgeGapEvent;
  knowledge_source_failed: KnowledgeSourceFailedEvent;
  // Routing (Phase 8)
  agent_routed: AgentRoutedEvent;
  // Intelligence (Phase 9)
  model_routed: ModelRoutedEvent;
  multimodal_routed: MultimodalRoutedEvent;
  conversation_closed: ConversationClosedInternalEvent;
  conversation_enriched: ConversationEnrichedEvent;
  // Domain apps
  domain_event: DomainEventData;
}

export { EventBus } from "./event-bus.js";
export type { EventStore } from "./event-store.js";
export { createTraceContext, startSpan, endSpan, addSpanEvent } from "./trace.js";
export type { TraceSpan, SpanEvent, TraceContext } from "./trace.js";
export { createSessionEvent, compareSessionEvents } from "./session-event.js";
export {
  projectCostUpdatedEventToLifecycleLedger,
  reconcileLifecycleAttributionLedger,
  replayLifecycleAttributionEvidence,
  summarizeLifecycleAttributionLedger,
} from "./session-lifecycle-attribution.js";
export type {
  ProjectCostUpdatedEventToLifecycleLedgerOptions,
  ReplayLifecycleAttributionEvidenceInput,
  SessionLifecycleAttributedCost,
  SessionLifecycleAttributionAllocation,
  SessionLifecycleAttributionLedger,
  SessionLifecycleAttributionProviderTotals,
  SessionLifecycleAttributionQuality,
  SessionLifecycleAttributionReconciliationResult,
  SessionLifecycleAttributionRecord,
  SessionLifecycleAttributionSummary,
  SessionLifecycleExecutionContext,
  SessionLifecycleSourceKind,
  SessionLifecycleTokenClass,
  SessionProviderTokenClass,
} from "./session-lifecycle-attribution.js";
export type {
  CanonicalSessionEventKind,
  CanonicalSessionEvent,
  CanonicalSessionEventMap,
  SessionEventEnvelope,
  SessionEventSource,
  SessionEventSurface,
  SessionProviderIdentity,
  SessionTokenUsage,
  SessionCost,
  SessionFileChangeType,
  SessionFileChange,
  SessionApprovalDecision,
  SessionApprovalResolver,
  SessionApprovalResolution,
  SessionToolTerminalState,
  SessionToolStatus,
  SessionToolUsageSnapshot,
  SessionContinuityDecision,
  SessionTurnOutcome,
  CanonicalTurnStartedEvent,
  CanonicalUserMessageEvent,
  CanonicalAssistantMessageEvent,
  CanonicalAssistantDeltaEvent,
  CanonicalSpecificationSubmittedEvent,
  CanonicalClarificationRecordedEvent,
  CanonicalPlanWorkItemDraft,
  CanonicalPlanSubmittedEvent,
  CanonicalPlanAnalysisFindingDraft,
  CanonicalPlanAnalysisReportedEvent,
  CanonicalPlanApprovedEvent,
  CanonicalGoalCreatedEvent,
  CanonicalGoalUpdatedEvent,
  CanonicalGoalCompletedEvent,
  CanonicalGoalFailedEvent,
  CanonicalGoalCancelledEvent,
  CanonicalWorkItemsMaterializedEvent,
  CanonicalProviderRoutedEvent,
  CanonicalMultimodalRoutedEvent,
  CanonicalToolCallStartedEvent,
  CanonicalToolCallCompletedEvent,
  CanonicalApprovalRequestedEvent,
  CanonicalApprovalResolvedEvent,
  CanonicalFileChangedEvent,
  CanonicalCostUpdatedEvent,
  CanonicalLifecycleAttributionRecordedEvent,
  SessionAgentInvocationIdentity,
  SessionAgentInvocationTranscriptPointer,
  SessionAgentInvocationDiagnosticPointer,
  SessionAgentInvocationTokenClassUsage,
  SessionAgentInvocationUsageReport,
  SessionAgentInvocationResultHandoff,
  SessionAgentInvocationEvidence,
  CanonicalAgentInvocationRequestedEvent,
  SessionAgentInvocationPromptDeliveryMode,
  SessionAgentInvocationPromptAdmissionState,
  SessionAgentInvocationPromptDeliveryState,
  CanonicalAgentInvocationPromptAdmittedEvent,
  CanonicalAgentInvocationPromptRecoveredEvent,
  CanonicalAgentInvocationStartedEvent,
  CanonicalAgentInvocationCompletedEvent,
  CanonicalAgentInvocationFailedEvent,
  CanonicalAgentInvocationCancelledEvent,
  CanonicalContinuityDecidedEvent,
  CanonicalErrorRecordedEvent,
  CanonicalTurnCompletedEvent,
  SessionEventInput,
  CreateSessionEventOptions,
} from "./session-event.js";
