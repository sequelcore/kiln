import type { ExecutionBillingMode } from "../agents/execution-identity.js";

import type {
  ManagedAgentAdapterKind,
  ManagedAgentAdmissionProfile,
  ManagedAgentCapabilitySnapshot,
  ManagedAgentInvocationContextMode,
  ManagedAgentInvocationHandoffContract,
  ManagedAgentExecutionMode,
  ManagedAgentProviderRoute,
  ManagedAgentRequestedAuthority,
  ManagedAgentWriteAuthority,
  ManagedAgentWriteEvidence,
} from "../agents/managed-invocation/index.js";
import type { GoalRun, WorkItem, WorkItemExecutionAttempt, WorkItemMaterialization } from "../work-governance/index.js";

export type CanonicalSessionEventKind =
  | "turn_started"
  | "user_message"
  | "assistant_message"
  | "assistant_delta"
  | "specification_submitted"
  | "clarification_recorded"
  | "plan_submitted"
  | "plan_analysis_reported"
  | "plan_approved"
  | "goal.created"
  | "goal.updated"
  | "goal.completed"
  | "goal.failed"
  | "goal.cancelled"
  | "work_items.materialized"
  | "provider_routed"
  | "tool_call_started"
  | "tool_call_completed"
  | "approval_requested"
  | "approval_resolved"
  | "config_change_proposed"
  | "config_change_approved"
  | "config_change_applied"
  | "config_change_failed"
  | "file_changed"
  | "cost_updated"
  | "work_item_updated"
  | "work_item_execution_started"
  | "work_item_execution_finished"
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
export type SessionExecutionMode = "execute" | "plan";

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

export interface CanonicalSpecificationSubmittedEvent extends SessionEventEnvelope<"specification_submitted"> {
  readonly specificationId: string;
  readonly status: "draft" | "ready_for_plan";
  readonly summary: string;
  readonly issueCodes: readonly string[];
  readonly blockingIssueCodes: readonly string[];
}

export interface CanonicalClarificationRecordedEvent extends SessionEventEnvelope<"clarification_recorded"> {
  readonly specificationId: string;
  readonly clarificationId: string;
  readonly affectedSection: string;
}

export interface CanonicalPlanWorkItemDraft {
  readonly id: string;
  readonly summary: string;
  readonly workflowProfile: string;
  readonly risk: "low" | "medium" | "high" | "critical";
  readonly expectedEvidence: readonly string[];
  readonly verificationGates: readonly string[];
  readonly dependencies: readonly string[];
}

export interface CanonicalPlanSubmittedEvent extends SessionEventEnvelope<"plan_submitted"> {
  readonly planId: string;
  readonly planHash: string;
  readonly mode: "plan";
  readonly objective: string;
  readonly nonGoals: readonly string[];
  readonly operatorDecisionsRequired: readonly string[];
  readonly assumptions: readonly string[];
  readonly affectedSurfaces: readonly string[];
  readonly riskClassification: "low" | "medium" | "high" | "critical";
  readonly workflowProfile: string;
  readonly workGovernancePosture: "direct" | "orchestrate" | "delegate";
  readonly workGovernanceRationale: string;
  readonly expectedEvidence: readonly string[];
  readonly verificationGates: readonly string[];
  readonly managedAgentDelegationCandidates: readonly string[];
  readonly approvalBoundaries: readonly string[];
  readonly rollbackNotes: string;
  readonly residualRisks: readonly string[];
  readonly sourceSpecificationId: string;
  readonly clarificationRecordIds: readonly string[];
  readonly constitutionSnapshotHash: string;
  readonly constitutionSnapshotIds: readonly string[];
  readonly proposedWorkItemCount: number;
  readonly proposedWorkItems: readonly CanonicalPlanWorkItemDraft[];
  readonly summary: string;
}

export interface CanonicalPlanApprovedEvent extends SessionEventEnvelope<"plan_approved"> {
  readonly planId: string;
  readonly approvalId: string;
  readonly planHash: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly residualRiskAcknowledged: boolean;
  readonly residualRiskAcknowledgement?: string;
  readonly fromMode: "plan";
  readonly toMode: "execute";
}

export interface CanonicalGoalCreatedEvent extends SessionEventEnvelope<"goal.created"> {
  readonly goal: GoalRun;
}

export interface CanonicalGoalUpdatedEvent extends SessionEventEnvelope<"goal.updated"> {
  readonly goal: GoalRun;
  readonly changedFields: readonly string[];
}

export interface CanonicalGoalCompletedEvent extends SessionEventEnvelope<"goal.completed"> {
  readonly goal: GoalRun;
  readonly closeoutSummary: string;
}

export interface CanonicalGoalFailedEvent extends SessionEventEnvelope<"goal.failed"> {
  readonly goal: GoalRun;
  readonly reason: string;
}

export interface CanonicalGoalCancelledEvent extends SessionEventEnvelope<"goal.cancelled"> {
  readonly goal: GoalRun;
  readonly reason: string;
  readonly cancelledBy?: string;
}

export interface CanonicalWorkItemsMaterializedEvent extends SessionEventEnvelope<"work_items.materialized"> {
  readonly materialization: WorkItemMaterialization;
}

export interface CanonicalPlanAnalysisReportedEvent extends SessionEventEnvelope<"plan_analysis_reported"> {
  readonly reportId: string;
  readonly planId: string;
  readonly specificationId: string;
  readonly status: "blocked" | "ready";
  readonly highestSeverity: "critical" | "high" | "medium" | "low" | "none";
  readonly findingIds: readonly string[];
  readonly blockingFindingIds: readonly string[];
  readonly findingCount: number;
  readonly findings: readonly CanonicalPlanAnalysisFindingDraft[];
  readonly summary: string;
}

export interface CanonicalPlanAnalysisFindingDraft {
  readonly id: string;
  readonly fingerprint: string;
  readonly category:
    | "duplication"
    | "ambiguity"
    | "underspecification"
    | "constitution_conflict"
    | "coverage_gap"
    | "task_order_inconsistency"
    | "terminology_drift"
    | "evidence_mismatch";
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly title: string;
  readonly detail: string;
  readonly references: readonly string[];
  readonly status: "open" | "superseded" | "closed" | "blocked";
}

export interface CanonicalProviderRoutedEvent extends SessionEventEnvelope<"provider_routed"> {
  readonly provider: SessionProviderIdentity;
  readonly reason: string;
}

export interface CanonicalToolCallStartedEvent extends SessionEventEnvelope<"tool_call_started"> {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface CanonicalToolCallCompletedEvent extends SessionEventEnvelope<"tool_call_completed"> {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: SessionToolStatus;
  readonly durationMs: number;
  readonly output?: string;
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

export interface CanonicalConfigChangeProposedEvent extends SessionEventEnvelope<"config_change_proposed"> {
  readonly proposalId: string;
  readonly operation: string;
  readonly status: "valid" | "invalid";
  readonly affectedCanonicalPaths: readonly string[];
  readonly authorityImpact: string;
}

export interface CanonicalConfigChangeApprovedEvent extends SessionEventEnvelope<"config_change_approved"> {
  readonly proposalId: string;
  readonly approvalId: string;
  readonly approvedBy: string;
  readonly surface: string;
}

export interface CanonicalConfigChangeAppliedEvent extends SessionEventEnvelope<"config_change_applied"> {
  readonly proposalId: string;
  readonly approvalId: string;
  readonly appliedWrites: readonly string[];
  readonly projectionEffects: readonly string[];
}

export interface CanonicalConfigChangeFailedEvent extends SessionEventEnvelope<"config_change_failed"> {
  readonly proposalId?: string;
  readonly approvalId?: string;
  readonly errorMessage: string;
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

export interface CanonicalWorkItemUpdatedEvent extends SessionEventEnvelope<"work_item_updated"> {
  readonly workItem: WorkItem;
  readonly operation: "update" | "complete";
  readonly missingEvidence?: readonly string[];
  readonly missingResidualRisk?: boolean;
  readonly toolCallId?: string;
}

export interface CanonicalWorkItemExecutionStartedEvent extends SessionEventEnvelope<"work_item_execution_started"> {
  readonly workItem: WorkItem;
  readonly attempt: WorkItemExecutionAttempt;
  readonly toolCallId?: string;
}

export interface CanonicalWorkItemExecutionFinishedEvent extends SessionEventEnvelope<"work_item_execution_finished"> {
  readonly workItem: WorkItem;
  readonly attempt: WorkItemExecutionAttempt;
  readonly missingEvidence: readonly string[];
  readonly missingResidualRisk: boolean;
  readonly toolCallId?: string;
}

export interface SessionAgentInvocationIdentity {
  readonly invocationId: string;
  readonly agentId: string;
  readonly agentName?: string;
  readonly parentSessionId?: string;
  readonly requestedBy?: string;
  readonly requestSource?: string;
  readonly requestedAuthority?: ManagedAgentRequestedAuthority;
  readonly profile?: ManagedAgentAdmissionProfile;
  readonly providerRoute?: ManagedAgentProviderRoute;
  readonly adapterKind?: ManagedAgentAdapterKind;
  readonly executionMode?: ManagedAgentExecutionMode;
  readonly authorityProfileId?: string;
  readonly capabilitySnapshot?: ManagedAgentCapabilitySnapshot;
  readonly invocationContext?: SessionAgentInvocationContext;
  readonly handoffContract?: ManagedAgentInvocationHandoffContract;
}

export interface SessionAgentInvocationContext {
  readonly mode: ManagedAgentInvocationContextMode;
  readonly agentProfile?: string;
  readonly skills?: readonly string[];
  readonly instructionProfiles?: readonly string[];
  readonly admittedAgentProfile?: string;
  readonly admittedSkills?: readonly string[];
  readonly admittedInstructionProfiles?: readonly string[];
  readonly deniedSkills?: readonly string[];
}

export interface SessionAgentInvocationTranscriptPointer {
  readonly uri: string;
  readonly redacted: boolean | "unknown";
  readonly truncated: boolean | "unknown";
  readonly persisted: boolean | "unknown";
  readonly retention: "session" | "durable" | "external" | "unknown";
}

export interface SessionAgentInvocationDiagnosticPointer {
  readonly uri: string;
  readonly kind: "timeout" | "failure" | "adapter" | "cleanup";
}

export interface SessionAgentInvocationTokenClassUsage {
  readonly name: string;
  readonly value: number | "unknown";
}

export interface SessionAgentInvocationUsageReport {
  readonly source: "adapter" | "provider" | "runtime" | "unknown";
  readonly tokenClasses: readonly SessionAgentInvocationTokenClassUsage[];
  readonly cost: {
    readonly currency: string | "unknown";
    readonly amount: number | "unknown";
  };
}

export interface SessionAgentInvocationResultHandoff {
  readonly summary: string;
  readonly resourceUris: readonly string[];
  readonly memoryWriteProposalUris: readonly string[];
}

export interface SessionAgentInvocationEvidence {
  readonly childSessionId?: string;
  readonly childTurnId?: string;
  readonly transcript?: SessionAgentInvocationTranscriptPointer;
  readonly diagnostics?: readonly SessionAgentInvocationDiagnosticPointer[];
  readonly usage?: SessionAgentInvocationUsageReport;
  readonly resultHandoff?: SessionAgentInvocationResultHandoff;
  readonly writeAuthority?: ManagedAgentWriteAuthority;
  readonly writeEvidence?: readonly ManagedAgentWriteEvidence[];
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
  readonly managedInvocationEvidence?: SessionAgentInvocationEvidence;
}

export interface CanonicalAgentInvocationFailedEvent extends SessionEventEnvelope<"agent_invocation_failed">, SessionAgentInvocationIdentity {
  readonly errorCode?: string;
  readonly errorMessage: string;
  readonly retriable?: boolean;
  readonly managedInvocationEvidence?: SessionAgentInvocationEvidence;
}

export interface CanonicalAgentInvocationCancelledEvent extends SessionEventEnvelope<"agent_invocation_cancelled">, SessionAgentInvocationIdentity {
  readonly reason?: string;
  readonly cancelledBy?: string;
  readonly managedInvocationEvidence?: SessionAgentInvocationEvidence;
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
  specification_submitted: CanonicalSpecificationSubmittedEvent;
  clarification_recorded: CanonicalClarificationRecordedEvent;
  plan_submitted: CanonicalPlanSubmittedEvent;
  plan_analysis_reported: CanonicalPlanAnalysisReportedEvent;
  plan_approved: CanonicalPlanApprovedEvent;
  "goal.created": CanonicalGoalCreatedEvent;
  "goal.updated": CanonicalGoalUpdatedEvent;
  "goal.completed": CanonicalGoalCompletedEvent;
  "goal.failed": CanonicalGoalFailedEvent;
  "goal.cancelled": CanonicalGoalCancelledEvent;
  "work_items.materialized": CanonicalWorkItemsMaterializedEvent;
  provider_routed: CanonicalProviderRoutedEvent;
  tool_call_started: CanonicalToolCallStartedEvent;
  tool_call_completed: CanonicalToolCallCompletedEvent;
  approval_requested: CanonicalApprovalRequestedEvent;
  approval_resolved: CanonicalApprovalResolvedEvent;
  config_change_proposed: CanonicalConfigChangeProposedEvent;
  config_change_approved: CanonicalConfigChangeApprovedEvent;
  config_change_applied: CanonicalConfigChangeAppliedEvent;
  config_change_failed: CanonicalConfigChangeFailedEvent;
  file_changed: CanonicalFileChangedEvent;
  cost_updated: CanonicalCostUpdatedEvent;
  work_item_updated: CanonicalWorkItemUpdatedEvent;
  work_item_execution_started: CanonicalWorkItemExecutionStartedEvent;
  work_item_execution_finished: CanonicalWorkItemExecutionFinishedEvent;
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
