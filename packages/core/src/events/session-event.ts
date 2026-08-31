import type { ExecutionBillingMode } from "../agents/execution-identity.js";
import type { ExecutionSessionToolResultResourceLink } from "./execution-session-event.js";
import type { ContextUsageProjection } from "./context-usage-projection.js";
import type { EffectivePromptObservation } from "../context/effective-prompt-observation.js";
import type { VerifiedEfficiencyEvidenceProjection } from "../efficiency/verified-efficiency-evidence.js";
import type {
  ManagedEconomicCoreRejectionReason,
  ManagedEconomicAmount,
  ManagedEconomicEvidenceIdentity,
  ManagedEconomicSettlement,
} from "../cost/managed-route-economics.js";
import type { ExecutionAccountCapacityRejectionReason } from "../agents/execution-routing/index.js";

import type {
  ManagedAgentAdapterKind,
  ManagedAgentAccess,
  ManagedAgentCapabilitySnapshot,
  ManagedAgentCoordinationUsageReport,
  ManagedAgentInvocationContextMode,
  ManagedAgentInvocationHandoffContract,
  ManagedAgentExecutionMode,
  ManagedAgentLifecycleEvidence,
  ManagedAgentLifecycleState,
  ManagedAgentProviderRoute,
  ManagedAgentResultHandoff,
  ManagedAgentRequestedAuthority,
  ManagedAgentRouteSource,
  ManagedAgentWriteAuthority,
  ManagedAgentWriteEvidence,
  WorkRecommendedSkillDiagnostic,
} from "../agents/managed-invocation/index.js";
import type { WorkClassification } from "../agents/work-classification.js";
import type { MultimodalDelegationEvidence } from "../engine/domain/multimodal-routing.js";
import type {
  SessionLifecycleAttributionLedger,
  SessionLifecycleAttributionSummary,
} from "./session-lifecycle-attribution.js";
import type { ExecutionCostEvidence } from "../cost/index.js";
import type { GoalRun, WorkItem, WorkItemExecutionAttempt, WorkItemMaterialization } from "../work-governance/index.js";
import type { SessionExecutionScope } from "./session-execution-scope.js";
import type { OperatorAdoptionDecisionAuthority } from "./operator-adoption-decision.js";
import type { TurnTerminalDisposition } from "../agents/turn-terminal-disposition.js";

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
  | "operator_adoption_decision"
  | "goal.created"
  | "goal.updated"
  | "goal.completed"
  | "goal.failed"
  | "goal.cancelled"
  | "work_items.materialized"
  | "provider_routed"
  | "multimodal_routed"
  | "tool_call_started"
  | "tool_call_output_delta"
  | "tool_call_completed"
  | "approval_requested"
  | "approval_resolved"
  | "config_change_proposed"
  | "config_change_approved"
  | "config_change_applied"
  | "config_change_failed"
  | "file_changed"
  | "cost_updated"
  | "context_usage_observed"
  | "effective_prompt_observed"
  | "lifecycle_attribution_recorded"
  | "work_item_updated"
  | "work_item_execution_started"
  | "work_item_execution_finished"
  | "agent_invocation_requested"
  | "agent_invocation_prompt_admitted"
  | "agent_invocation_prompt_recovered"
  | "agent_invocation_started"
  | "agent_invocation_completed"
  | "agent_invocation_failed"
  | "agent_invocation_cancelled"
  | "managed_economic_lifecycle"
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
  readonly executionScope?: SessionExecutionScope;
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
  readonly evidence?: ExecutionCostEvidence;
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

export interface SessionToolUsageSnapshot {
  readonly scope: "turn";
  readonly toolName: string;
  readonly calls: number;
}

export type SessionContinuityDecision = "continue" | "handoff" | "fork" | "close";
export type SessionTurnOutcome = "completed" | "failed" | "cancelled" | "paused";
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

export interface CanonicalOperatorAdoptionDecisionEvent
  extends SessionEventEnvelope<"operator_adoption_decision">,
    OperatorAdoptionDecisionAuthority {
  readonly turnOrdinal: number;
  readonly correlationId?: string;
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
  /** Canonical execution route when the turn crossed execution-catalog admission. */
  readonly routeId?: string;
  readonly provider: SessionProviderIdentity;
  readonly reason: string;
}

export interface CanonicalMultimodalRoutedEvent extends SessionEventEnvelope<"multimodal_routed"> {
  readonly provider: SessionProviderIdentity;
  readonly strategy: "native" | "delegated" | "transform" | "unsupported";
  readonly reasonCode: string;
  readonly reason: string;
  readonly requestedCapability: "vision" | "document" | "audio" | "screenshot-review" | "transcription" | "speech-synthesis";
  readonly requiredModalities: readonly string[];
  readonly artifactUris: readonly string[];
  readonly delegation?: MultimodalDelegationEvidence;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly severity: "info" | "warning" | "error";
    readonly message: string;
    readonly provider?: string;
    readonly model?: string;
  }[];
}

export interface CanonicalToolCallStartedEvent extends SessionEventEnvelope<"tool_call_started"> {
  readonly toolCallId: string;
  readonly toolCallScopeId: string;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface CanonicalToolCallOutputDeltaEvent extends SessionEventEnvelope<"tool_call_output_delta"> {
  readonly toolCallId: string;
  readonly toolCallScopeId: string;
  readonly toolName: string;
  readonly stream: "stdout" | "stderr";
  readonly delta: string;
  readonly chunkIndex: number;
}

export interface CanonicalToolCallCompletedEvent extends SessionEventEnvelope<"tool_call_completed"> {
  readonly toolCallId: string;
  readonly toolCallScopeId: string;
  readonly toolName: string;
  readonly status: SessionToolStatus;
  readonly durationMs: number;
  readonly output?: string;
  readonly outputSummary?: string;
  readonly metadata?: Record<string, unknown>;
  /** Sanitized terminal evidence for a selected portable capability invocation. */
  readonly capabilitySettlement?: Readonly<Record<string, unknown>>;
  readonly resourceLinks?: readonly ExecutionSessionToolResultResourceLink[];
  readonly toolUsage?: SessionToolUsageSnapshot;
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
  /**
   * Terminal outcome of the mutation. A committed change whose reconciliation
   * failed is still applied, but operators must be able to see that it did not
   * fully converge, so the distinction travels with the event.
   */
  readonly outcome: "committed" | "committed-reconciliation-failed";
  readonly reconciliationErrors: readonly string[];
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

export interface CanonicalContextUsageObservedEvent extends SessionEventEnvelope<"context_usage_observed"> {
  readonly contextUsage: ContextUsageProjection;
}

export interface CanonicalEffectivePromptObservedEvent extends SessionEventEnvelope<"effective_prompt_observed"> {
  readonly effectivePrompt: EffectivePromptObservation;
}

export interface CanonicalLifecycleAttributionRecordedEvent extends SessionEventEnvelope<"lifecycle_attribution_recorded"> {
  readonly ledger: SessionLifecycleAttributionLedger;
  readonly summary: SessionLifecycleAttributionSummary;
  readonly efficiencyEvidence: VerifiedEfficiencyEvidenceProjection;
}

export interface CanonicalWorkItemUpdatedEvent extends SessionEventEnvelope<"work_item_updated"> {
  readonly workItem: WorkItem;
  readonly operation: "update" | "complete";
  readonly missingEvidence?: readonly string[];
  readonly missingGoalEvidence?: readonly string[];
  readonly missingVerificationGates?: readonly string[];
  readonly failedVerificationGates?: readonly string[];
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
  readonly missingGoalEvidence: readonly string[];
  readonly missingVerificationGates: readonly string[];
  readonly failedVerificationGates: readonly string[];
  readonly missingResidualRisk: boolean;
  readonly toolCallId?: string;
}

export interface SessionAgentInvocationIdentity {
  readonly invocationId: string;
  readonly agentId: string;
  readonly agentName?: string;
  readonly parentSessionId?: string;
  readonly parentTurnId?: string;
  readonly routeId?: string;
  readonly routeSource?: ManagedAgentRouteSource;
  readonly requestedBy?: string;
  readonly requestSource?: string;
  readonly requestedAuthority?: ManagedAgentRequestedAuthority;
  readonly access?: ManagedAgentAccess;
  readonly providerRoute?: ManagedAgentProviderRoute;
  readonly adapterKind?: ManagedAgentAdapterKind;
  readonly executionMode?: ManagedAgentExecutionMode;
  readonly lifecycleState?: ManagedAgentLifecycleState;
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
  readonly workClassification?: WorkClassification;
  readonly resolvedWorkClassification?: WorkClassification;
  readonly workRecommendedSkills?: readonly string[];
  readonly workRecommendedSkillDiagnostics?: readonly WorkRecommendedSkillDiagnostic[];
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

export type SessionAgentInvocationResultHandoff = ManagedAgentResultHandoff;

export interface SessionAgentInvocationEvidence {
  readonly lifecycle?: ManagedAgentLifecycleEvidence;
  readonly childSessionId?: string;
  readonly childTurnId?: string;
  readonly transcript?: SessionAgentInvocationTranscriptPointer;
  readonly diagnostics?: readonly SessionAgentInvocationDiagnosticPointer[];
  readonly usage?: SessionAgentInvocationUsageReport;
  readonly coordinationUsage?: ManagedAgentCoordinationUsageReport;
  readonly resultHandoff?: SessionAgentInvocationResultHandoff;
  readonly writeAuthority?: ManagedAgentWriteAuthority;
  readonly writeEvidence?: readonly ManagedAgentWriteEvidence[];
}

export interface CanonicalAgentInvocationRequestedEvent extends SessionEventEnvelope<"agent_invocation_requested">, SessionAgentInvocationIdentity {
  readonly inputSummary?: string;
}

export type SessionAgentInvocationPromptDeliveryMode = "steer" | "queue";
export type SessionAgentInvocationPromptAdmissionState = "admitted";
export type SessionAgentInvocationPromptDeliveryState = "available" | "queued" | "delivered" | "stale";

export interface CanonicalAgentInvocationPromptAdmittedEvent extends SessionEventEnvelope<"agent_invocation_prompt_admitted">, SessionAgentInvocationIdentity {
  readonly promptAdmissionId: string;
  readonly deliveryMode: SessionAgentInvocationPromptDeliveryMode;
  readonly deliveryState?: SessionAgentInvocationPromptDeliveryState;
  readonly admissionState: SessionAgentInvocationPromptAdmissionState;
  readonly inputSummary: string;
  readonly promptHash: string;
  readonly wakeRequested: boolean;
}

export interface CanonicalAgentInvocationPromptRecoveredEvent extends SessionEventEnvelope<"agent_invocation_prompt_recovered">, SessionAgentInvocationIdentity {
  readonly promptAdmissionId: string;
  readonly deliveryMode: SessionAgentInvocationPromptDeliveryMode;
  readonly previousDeliveryState: SessionAgentInvocationPromptDeliveryState;
  readonly deliveryState: "stale";
  readonly recoveryReason: string;
  readonly recoveredAt: string;
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

export type SessionManagedEconomicLifecycleTransition =
  | "denied" | "held" | "dispatch-fenced" | "settlement-pending"
  | "release-failed" | "leaked" | "released";

export type SessionManagedEconomicAccountSelectionRejectionReason = ExecutionAccountCapacityRejectionReason;

export type SessionManagedEconomicLocalCapacityRejectionReason =
  | "route-capacity-exhausted"
  | "comparison-domain-incompatible";

export type SessionManagedEconomicCommitmentConflictReason =
  | "idempotency-conflict"
  | "identity-revision-conflict";

/** Sanitized denial evidence; account and credential internals never cross this boundary. */
export type SessionManagedEconomicRejection =
  | {
      readonly stage: "economic-selection";
      readonly routeId: string;
      readonly reason: ManagedEconomicCoreRejectionReason;
    }
  | {
      readonly stage: "account-selection";
      readonly routeId: string;
      readonly reason: SessionManagedEconomicAccountSelectionRejectionReason;
      readonly count: number;
    }
  | {
      readonly stage: "local-capacity";
      readonly routeId: string;
      readonly reason: SessionManagedEconomicLocalCapacityRejectionReason;
    }
  | {
      readonly stage: "commitment-conflict";
      readonly reason: SessionManagedEconomicCommitmentConflictReason;
    };

export interface SessionManagedEconomicRouteIdentity {
  readonly routeId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly adapterCapabilityId: string;
  readonly adapterCapabilityVersion: string;
  /** Price class projected from committed route evidence, when known before settlement. */
  readonly priceClass?: "subscription" | "included" | "free" | "metered" | "estimated" | "unknown";
}

export interface SessionManagedEconomicAccountIdentity {
  readonly kind: "account-bound" | "accountless";
  readonly capacityIdentity?: string;
  readonly creditPosture?: "disabled" | "committed";
  readonly overagePosture?: "disabled" | "committed";
}

/** Secret-free explanation fields projected from Runtime-owned economic evidence. */
export type SessionManagedEconomicBillingClass =
  | "subscription" | "included" | "free" | "metered" | "estimated" | "unknown";

export type SessionManagedEconomicSelectionReason =
  | "only-admitted-target"
  | "configured-target-order"
  | "lower-comparable-reservation"
  | "stable-identity-order"
  | "runtime-authority-selection";

export type SessionManagedEconomicTerminalCause =
  | "work-limit-exhaustion"
  | "provider-exhaustion"
  | "spend-denial"
  | "technical-failure"
  | "completed"
  | "cancelled"
  | "unknown";

export interface SessionManagedEconomicTargetExplanation {
  readonly targetId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly reason: SessionManagedEconomicSelectionReason;
}

export interface SessionManagedEconomicProviderAllowanceBucket {
  readonly dimension: string;
  readonly remaining: ManagedEconomicAmount | null;
  readonly resetsAt: string | null;
}

export interface SessionManagedEconomicProviderAllowance {
  readonly status: "available" | "exhausted" | "unlimited" | "unknown";
  readonly evidenceFreshness: "fresh" | "stale" | "missing" | "unknown";
  readonly buckets?: readonly SessionManagedEconomicProviderAllowanceBucket[];
}

export interface SessionManagedEconomicWorkLimitProgress {
  readonly dimension: "turns" | "duration-ms" | "concurrency";
  readonly consumed: number;
  readonly limit: number;
  readonly status: "within-limit" | "exhausted" | "unknown";
}

export interface SessionManagedEconomicChildConsumption {
  readonly childId: string;
  readonly units?: readonly ManagedEconomicAmount[];
  /** Present only when the Runtime has comparable settlement evidence. */
  readonly settledAmount?: ManagedEconomicAmount;
  readonly comparability: "comparable" | "not-comparable" | "unknown";
}

export interface CanonicalManagedEconomicLifecycleEvent
  extends SessionEventEnvelope<"managed_economic_lifecycle"> {
  readonly evidenceVersion: 1;
  readonly jobId: string;
  readonly economicAttemptId: string;
  /**
   * The managed-agent invocation this economic attempt belongs to, when known. `jobId` is
   * computed independently of `invocationId` in Runtime (see runtime-tool.ts), so this is a
   * best-effort cross-reference, not a durable key relationship - it is absent on events emitted
   * before this field existed and must not be treated as a required join.
   */
  readonly invocationId?: string;
  readonly transition: SessionManagedEconomicLifecycleTransition;
  readonly policyId: string;
  readonly policyRevision: string;
  readonly policyDigest: string;
  readonly commitmentId?: string;
  readonly reservationId?: string;
  readonly dispatchFenceId?: string;
  readonly selectedRoute?: SessionManagedEconomicRouteIdentity;
  readonly selectedAccount?: SessionManagedEconomicAccountIdentity;
  readonly selectedTarget?: SessionManagedEconomicTargetExplanation;
  readonly billingClass?: SessionManagedEconomicBillingClass;
  readonly providerAllowance?: SessionManagedEconomicProviderAllowance;
  readonly workLimitProgress?: SessionManagedEconomicWorkLimitProgress;
  readonly reservedAmount?: ManagedEconomicAmount;
  readonly settledAmount?: ManagedEconomicAmount;
  readonly perChildConsumption?: readonly SessionManagedEconomicChildConsumption[];
  readonly evidenceFreshness?: "fresh" | "stale" | "missing" | "unknown";
  readonly terminalCause?: SessionManagedEconomicTerminalCause;
  readonly settlementKind?: ManagedEconomicSettlement["kind"];
  readonly settlementAuthority?: ManagedEconomicEvidenceIdentity["authority"];
  readonly reason?: string;
  readonly rejections?: readonly SessionManagedEconomicRejection[];
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

/**
 * Terminal turn evidence is flattened into the event so the discriminated
 * disposition remains the one canonical outcome/reason authority.
 */
export type CanonicalTurnCompletedEvent = SessionEventEnvelope<"turn_completed">
  & TurnTerminalDisposition
  & {
    readonly outputMessageId?: string;
    readonly durationMs?: number;
  };

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
  operator_adoption_decision: CanonicalOperatorAdoptionDecisionEvent;
  "goal.created": CanonicalGoalCreatedEvent;
  "goal.updated": CanonicalGoalUpdatedEvent;
  "goal.completed": CanonicalGoalCompletedEvent;
  "goal.failed": CanonicalGoalFailedEvent;
  "goal.cancelled": CanonicalGoalCancelledEvent;
  "work_items.materialized": CanonicalWorkItemsMaterializedEvent;
  provider_routed: CanonicalProviderRoutedEvent;
  multimodal_routed: CanonicalMultimodalRoutedEvent;
  tool_call_started: CanonicalToolCallStartedEvent;
  tool_call_output_delta: CanonicalToolCallOutputDeltaEvent;
  tool_call_completed: CanonicalToolCallCompletedEvent;
  approval_requested: CanonicalApprovalRequestedEvent;
  approval_resolved: CanonicalApprovalResolvedEvent;
  config_change_proposed: CanonicalConfigChangeProposedEvent;
  config_change_approved: CanonicalConfigChangeApprovedEvent;
  config_change_applied: CanonicalConfigChangeAppliedEvent;
  config_change_failed: CanonicalConfigChangeFailedEvent;
  file_changed: CanonicalFileChangedEvent;
  cost_updated: CanonicalCostUpdatedEvent;
  context_usage_observed: CanonicalContextUsageObservedEvent;
  effective_prompt_observed: CanonicalEffectivePromptObservedEvent;
  lifecycle_attribution_recorded: CanonicalLifecycleAttributionRecordedEvent;
  work_item_updated: CanonicalWorkItemUpdatedEvent;
  work_item_execution_started: CanonicalWorkItemExecutionStartedEvent;
  work_item_execution_finished: CanonicalWorkItemExecutionFinishedEvent;
  agent_invocation_requested: CanonicalAgentInvocationRequestedEvent;
  agent_invocation_prompt_admitted: CanonicalAgentInvocationPromptAdmittedEvent;
  agent_invocation_prompt_recovered: CanonicalAgentInvocationPromptRecoveredEvent;
  agent_invocation_started: CanonicalAgentInvocationStartedEvent;
  agent_invocation_completed: CanonicalAgentInvocationCompletedEvent;
  agent_invocation_failed: CanonicalAgentInvocationFailedEvent;
  agent_invocation_cancelled: CanonicalAgentInvocationCancelledEvent;
  managed_economic_lifecycle: CanonicalManagedEconomicLifecycleEvent;
  continuity_decided: CanonicalContinuityDecidedEvent;
  error_recorded: CanonicalErrorRecordedEvent;
  turn_completed: CanonicalTurnCompletedEvent;
}

export type CanonicalSessionEvent = CanonicalSessionEventMap[CanonicalSessionEventKind];

type SessionEventInputForEvent<Event> = Event extends SessionEventEnvelope
  ? Omit<Event, "eventId" | "timestamp"> & {
    readonly eventId?: string;
    readonly timestamp?: Date;
  }
  : never;

export type SessionEventInput<K extends CanonicalSessionEventKind> = SessionEventInputForEvent<CanonicalSessionEventMap[K]>;

export interface CreateSessionEventOptions {
  readonly generateEventId?: () => string;
  readonly now?: () => Date;
}

export function createSessionEvent<K extends CanonicalSessionEventKind>(
  input: SessionEventInput<K>,
  options?: CreateSessionEventOptions,
): CanonicalSessionEventMap[K];
export function createSessionEvent<K extends CanonicalSessionEventKind>(
  input: SessionEventInput<K>,
  options: CreateSessionEventOptions = {},
): CanonicalSessionEvent {
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new RangeError(`Session event sequence must be an integer >= 1, received: ${input.sequence}`);
  }

  const generateEventId = options.generateEventId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());

  const event = {
    ...input,
    eventId: input.eventId ?? generateEventId(),
    timestamp: input.timestamp ?? now(),
  };

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
