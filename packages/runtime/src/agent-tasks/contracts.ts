import type {
  DeliberationResolution,
  ManagedAgentAdmissionProfile,
  ManagedAgentCallerAttachmentIdentity,
  ManagedAgentResultHandoff,
  ManagedAgentWriteEvidence,
  ManagedEconomicAdoptedSnapshot,
  ManagedEconomicAdoptedSnapshotExpectation,
} from "@kilnai/core";
import type { ManagedWriteApprovalBinding, ManagedWriteApprovalReceipt } from "../managed-write-approvals/contracts.js";
import type { ManagedEconomicCandidateSet } from "../agents/managed-invocation/runtime-tool/index.js";
import type { ManagedEconomicCommitmentAcquireResult, ManagedEconomicReplayEvidence, ManagedEconomicRouteCapacity } from "../managed-account-leases/managed-account-lease-authority.js";
import type { SanitizedExecutionTargetDataPolicyDecision } from "../execution-routing/execution-target-data-policy-authority.js";
import type { EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";


export const AGENT_TASK_STATES = ["awaiting_approval", "queued", "running", "succeeded", "failed", "timed_out", "interrupted", "cancelled"] as const;
export const AGENT_TASK_SCHEMA_VERSION = 14 as const;
/** Recovery redispatches only unfenced economic work. A durable economic
 * action fence becomes an explicit unknown projection, and native-harness
 * work is never resumed after a process restart. */
export const AGENT_TASK_RECOVERY_POLICY = {
  economic: { unfenced: "redispatch", dispatchFenced: "interrupt" },
  nativeHarness: { unfenced: "interrupt", dispatchFenced: "interrupt" },
} as const;
export type AgentTaskState = typeof AGENT_TASK_STATES[number];

export type AgentTaskDiagnosticCode =
  | "invalid_request"
  | "project_identity_unavailable"
  | "governance_unavailable"
  | "governance_not_authoritative"
  | "admission_denied"
  | "profile_unavailable"
  | "route_unavailable"
  | "idempotency_conflict"
  | "identity-revision-conflict"
  | "job_persistence_unavailable"
  | "job_persistence_corrupt"
  | "unknown_job"
  | "invalid_transition"
  | "provider_rejected"
  | "provider_timeout"
  | "account_lease_unavailable"
  | "economic_commitment_unavailable"
  | "invocation_failed"
  | "unauthorized_job"
  | "result_pending"
  | "result_unavailable"
  | "result_persistence_failure"
  | "result_corrupt"
  | "cancelled"
  | "replay_unavailable";

export interface AgentTaskSubmission {
  readonly objective: string;
  readonly configuredAgentProfileId: string;
  readonly callerId: string;
  readonly idempotencyKey: string;
  readonly parent?: { readonly invocationId: string; readonly turnId: string };
}

export interface TrustedAgentTaskProject {
  readonly id: string;
}

/** Identity injected by a trusted harness composition, never accepted as a result-query argument. */
export interface TrustedAgentTaskQueryContext {
  readonly project: TrustedAgentTaskProject;
  readonly callerId: string;
}

export interface AgentTaskGovernanceEvidence {
  readonly version: 1;
  readonly authority: "authoritative";
  readonly source: string;
  readonly issuedAt: string;
  readonly validUntil: string;
}

export interface AgentTaskEconomicProfile {
  readonly kind: "economic";
  readonly id: string;
  readonly authorityProfileId: string;
  readonly economicPolicyId: string;
  readonly economicPolicyRevision: string;
  readonly admissionProfileId: ManagedAgentAdmissionProfile;
  readonly economicSpendApproval?: "required";
  readonly workLimits?: {
    readonly maxTurns?: number;
    readonly maxDurationMs?: number;
    readonly maxConcurrency?: number;
  };
  readonly constraints?: {
    readonly routeId?: string;
    readonly providerId?: string;
    readonly model?: string;
  };
}

export type AgentTaskExecutionFailureClassification =
  | "harness_version_mismatch"
  | "structured_handoff_rejected"
  | "model_identity_mismatch"
  | "private_artifact_cleanup_failed"
  | "provider_quota_exhausted"
  | "native_session_error"
  | "write_boundary_violation"
  | "result_handoff_missing"
  | "provider_timeout"
  | "unknown_failure";

/** Provider-neutral terminal evidence. Error messages and provider payloads never cross this boundary. */
export interface AgentTaskFailureEvidence {
  readonly version: 1;
  readonly classification: AgentTaskExecutionFailureClassification;
  readonly diagnosticUri?: string;
  readonly transportPhase?: "headers" | "first_byte" | "chunk_idle" | "transport";
}

export interface AgentTaskExecutionContext {
  /** Trusted identity of the parent harness; never parsed from the job input. */
  readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
}

/**
 * Exact-route admission for a credentialless native harness.  This branch
 * deliberately has no economic policy, account, quota, price, or candidate
 * identity.  The acknowledgement is the durable operator/runtime contract
 * for the exact route that may be executed after the dispatch fence.
 */
export interface AgentTaskNativeHarnessAcknowledgement {
  readonly version: 1;
  readonly source: "managed-route-admission";
  /** Native-harness dispatches are strictly credentialless; Runtime never resolves an account. */
  readonly credentialMode: "credentialless";
  readonly acknowledgedAt: string;
  readonly routeId: string;
  readonly routeRevision: string;
  readonly providerId: string;
  readonly model: string;
  readonly admissionProfileId: ManagedAgentAdmissionProfile;
  readonly adapterCapabilityId: string;
  readonly adapterCapabilityVersion: string;
  /** Exact native override admitted from versioned route capability evidence. */
  readonly deliberationResolution?: AgentTaskNativeDeliberationResolution;
}

/** Durable execution subset of Core's exact/clamped deliberation resolution. */
export type AgentTaskNativeDeliberationResolution =
  | {
      readonly status: "exact";
      readonly selectedLevel: string;
      readonly source: DeliberationResolution["source"];
      readonly capabilityEvidence: NonNullable<DeliberationResolution["capabilityEvidence"]>;
    }
  | {
      readonly status: "clamped";
      readonly selectedLevel: string;
      readonly source: DeliberationResolution["source"];
      readonly reason: "preferred-level-outside-bounds";
      readonly capabilityEvidence: NonNullable<DeliberationResolution["capabilityEvidence"]>;
    };

export interface AgentTaskNativeHarnessProfile {
  readonly kind: "native-harness";
  readonly id: string;
  readonly authorityProfileId: string;
  readonly admissionProfileId: ManagedAgentAdmissionProfile;
  readonly routeId: string;
  readonly routeRevision: string;
  readonly providerId: string;
  readonly model: string;
  readonly adapterCapabilityId: string;
  readonly adapterCapabilityVersion: string;
  readonly acknowledgement: AgentTaskNativeHarnessAcknowledgement;
  readonly deliberationResolution?: AgentTaskNativeDeliberationResolution;
}

export type AgentTaskProfile = AgentTaskEconomicProfile | AgentTaskNativeHarnessProfile;

export type AgentTaskNativeHarnessRoute = Omit<AgentTaskNativeHarnessProfile, "id" | "authorityProfileId">;

/**
 * The one durable outer-effect claim for a native or remote Agent Task.
 * Hidden harness work is outside this boundary; the claim stops at the
 * Runtime-owned SDK invocation, process launch, or remote-task send.
 */
export interface AgentTaskActionClaim {
  readonly version: 1;
  readonly attemptId: string;
  readonly intentFingerprint: string;
  readonly admissionId: string;
  /** Full immutable receipt whose digest is admissionId. */
  readonly admissionBundle: EffectiveAuthorityAdmissionBundle;
  readonly ownerGeneration: string;
  readonly effectIdentity: string;
}

export type AgentTaskDispatch =
  | {
      readonly kind: "economic";
      readonly economicAttemptId: string;
      readonly economicPolicyId: string;
      readonly economicPolicyRevision: string;
      /** Persisted only once the shared economic dispatch fence is owned. */
      readonly dispatchFenceId?: string;
      /** Persisted full admission receipt; the action claim binds its digest. */
      readonly admissionBundle: EffectiveAuthorityAdmissionBundle;
      readonly actionClaim?: AgentTaskActionClaim;
      readonly constraints: {
        readonly routeId?: string;
        readonly providerId?: string;
        readonly model?: string;
      };
      readonly candidateSet: ManagedEconomicCandidateSet;
    }
  | {
      readonly kind: "native-harness";
      readonly routeId: string;
      readonly routeRevision: string;
      readonly providerId: string;
      readonly model: string;
      readonly admissionProfileId: ManagedAgentAdmissionProfile;
      readonly adapterCapabilityId: string;
      readonly adapterCapabilityVersion: string;
      readonly acknowledgement: AgentTaskNativeHarnessAcknowledgement;
      readonly deliberationResolution?: AgentTaskNativeDeliberationResolution;
      readonly dispatchFenceId?: string;
      readonly actionClaim?: AgentTaskActionClaim;
    };

/** Immutable, normalized success evidence. Handoff content is untrusted child output. */
export interface AgentTaskResult {
  readonly version: 1;
  readonly jobId: string;
  readonly runtimeInvocationId: string;
  readonly configuredAgentProfileId: string;
  readonly admissionProfileId: string;
  readonly routeId: string;
  readonly providerId: string;
  readonly terminalState: "completed";
  readonly completedAt: string;
  readonly provenance: {
    readonly source: "runtime-managed-invocation";
    readonly trust: "untrusted-child-output";
  };
  readonly resultHandoff: ManagedAgentResultHandoff;
  /** Every successful Agent Task, native or economic, carries one exact proof. */
  readonly dataPolicyProof: AgentTaskDataPolicyProof;
  readonly writeEvidence?: readonly ManagedAgentWriteEvidence[];
}

export interface AgentTaskDataPolicyProof {
  readonly version: 1;
  readonly jobId: string;
  readonly dispatchFenceId: string;
  readonly routeId: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly decision: SanitizedExecutionTargetDataPolicyDecision["decision"];
  readonly evidence: NonNullable<SanitizedExecutionTargetDataPolicyDecision["evidence"]>;
}

/** Safe projection of a Runtime-owned receipt. It contains identities and digests only. */
export interface AgentTaskWriteApproval {
  readonly approvalId: string;
  readonly state: "issued" | "revoked" | "consumed";
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly approverId: string;
  readonly consumedAt?: string;
  readonly consumedBy?: string;
}

export interface AgentTaskLifecycleEntry {
  readonly sequence: number;
  readonly state: AgentTaskState;
  readonly observedAt: string;
  readonly diagnostic?: AgentTaskDiagnosticCode;
  readonly failureEvidence?: AgentTaskFailureEvidence;
}

/** The one committed execution attempt. Retry/recovery never creates a second run in V14. */
export interface AgentRun {
  readonly runId: string;
  readonly state: AgentTaskState;
  readonly dispatch: AgentTaskDispatch;
  readonly result?: AgentTaskResult;
  readonly failureEvidence?: AgentTaskFailureEvidence;
  readonly dataPolicyProof?: AgentTaskDataPolicyProof;
}

/** Canonical persisted agent-task representation. */
export interface AgentTaskRecord {
  readonly version: typeof AGENT_TASK_SCHEMA_VERSION;
  readonly id: string;
  readonly adoptedDecisionAt: string;
  readonly state: AgentTaskState;
  readonly objective: string;
  readonly projectId: string;
  readonly callerId: string;
  readonly configuredAgentProfileId: string;
  readonly admissionProfileId: ManagedAgentAdmissionProfile;
  readonly dispatch: AgentTaskDispatch;
  readonly governanceSource: string;
  readonly admissionId: string;
  /** Canonical full authority receipt persisted with the accepted task. */
  readonly admissionBundle: EffectiveAuthorityAdmissionBundle;
  readonly requestFingerprint: string;
  readonly idempotencyKeyHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly parent?: { readonly invocationId: string; readonly turnId: string };
  readonly diagnostic?: AgentTaskDiagnosticCode;
  readonly failureEvidence?: AgentTaskFailureEvidence;
  readonly result?: AgentTaskResult;
  readonly writeApproval?: AgentTaskWriteApproval;
  readonly lifecycle: readonly AgentTaskLifecycleEntry[];
  readonly run: AgentRun;
}
export type AgentTaskResultAvailability = "pending" | "available" | "unavailable" | "failed" | "unresolved";
export interface AgentTaskResultQuery {
  readonly jobId: string;
  readonly availability: AgentTaskResultAvailability;
  readonly lifecycleState: AgentTaskState;
  readonly configuredAgentProfileId: string;
  readonly admissionProfileId: string;
  readonly routeId?: string;
  readonly providerId?: string;
  readonly completedAt?: string;
  readonly provenance?: AgentTaskResult["provenance"];
  readonly handoff?: ManagedAgentResultHandoff;
  readonly writeEvidence?: readonly ManagedAgentWriteEvidence[];
  readonly writeApproval?: AgentTaskWriteApproval;
  readonly diagnostic?: AgentTaskDiagnosticCode;
  readonly failureEvidence?: AgentTaskFailureEvidence;
  readonly dataPolicyProof?: AgentTaskDataPolicyProof;
}

export interface AgentTaskReplayQuery {
  readonly jobId: string;
  readonly availability: "available" | "unavailable";
  readonly lifecycleState: AgentTaskState;
  readonly configuredAgentProfileId: string;
  readonly admissionProfileId: string;
  readonly routeId?: string;
  readonly providerId?: string;
  readonly lifecycle: readonly AgentTaskLifecycleEntry[];
  readonly resultAvailability: AgentTaskResultAvailability;
  readonly writeEvidence?: readonly ManagedAgentWriteEvidence[];
  readonly dataPolicyProof?: AgentTaskDataPolicyProof;
  readonly writeApproval?: AgentTaskWriteApproval;
  readonly dispatch:
    | {
        readonly kind: "economic";
        readonly economic: AgentTaskEconomicReplay;
      }
    | {
        readonly kind: "native-harness";
        readonly routeId: string;
        readonly routeRevision: string;
        readonly providerId: string;
        readonly model: string;
        readonly admissionProfileId: ManagedAgentAdmissionProfile;
        readonly adapterCapabilityId: string;
        readonly adapterCapabilityVersion: string;
        readonly acknowledgement: AgentTaskNativeHarnessAcknowledgement;
        readonly deliberationResolution?: AgentTaskNativeDeliberationResolution;
        readonly dispatchFenceId?: string;
      };
  readonly diagnostic?: AgentTaskDiagnosticCode;
  readonly failureEvidence?: AgentTaskFailureEvidence;
}

export type AgentTaskEconomicReplay =
  | { readonly availability: "available"; readonly snapshot: ManagedEconomicReplayEvidence }
  | {
      readonly availability: "unavailable";
      readonly reason: "authority-unavailable" | "evidence-not-found" | "evidence-unprojectable";
    };

export interface AgentTaskProjectPort { resolve(): Promise<TrustedAgentTaskProject>; }
export interface AgentTaskGovernancePort {
  resolve(project: TrustedAgentTaskProject): Promise<AgentTaskGovernanceEvidence>;
  admit(input: { readonly project: TrustedAgentTaskProject; readonly objective: string; readonly configuredAgentProfileId: string; readonly admissionProfileId: string; readonly evidence: AgentTaskGovernanceEvidence }): Promise<{ readonly admitted: true; readonly admissionBundle: EffectiveAuthorityAdmissionBundle; readonly source: string } | { readonly admitted: false }>;
}
export interface AgentTaskProfilePort { resolve(id: string): Promise<AgentTaskProfile | undefined>; }
export interface AgentTaskRouteResolutionContext {
  readonly invocationId?: string;
  readonly compositionMode?: "candidate-admission" | "execution";
}
export interface AgentTaskRoutePort {
  resolve(profile: AgentTaskProfile, context?: AgentTaskRouteResolutionContext): Promise<ManagedEconomicCandidateSet | AgentTaskNativeHarnessRoute | undefined>;
}
export type AgentTaskCommitmentRecoveryState = "absent" | "committed" | "dispatch-fenced";
export interface AgentTaskCommitmentRecoveryPort {
  query(input: {
    readonly jobId: string;
    readonly economicAttemptId: string;
  }): AgentTaskCommitmentRecoveryState;
}
export interface AgentTaskEconomicReplayPort {
  inspect(input: { readonly jobId: string; readonly economicAttemptId: string }): ManagedEconomicReplayEvidence | undefined;
}
export interface AgentTaskWriteApprovalPort {
  inspect(approvalId: string): ManagedWriteApprovalReceipt | undefined;
  consume(input: { readonly approvalId: string; readonly binding: ManagedWriteApprovalBinding; readonly consumerId: string }): ManagedWriteApprovalReceipt;
  revoke(input: { readonly approvalId: string; readonly projectId: string }): ManagedWriteApprovalReceipt;
}
export interface AgentTaskEconomicAdoption {
  readonly snapshot: ManagedEconomicAdoptedSnapshot;
  readonly expectation: ManagedEconomicAdoptedSnapshotExpectation;
  readonly routeCapacity: readonly ManagedEconomicRouteCapacity[];
}
export interface AgentTaskEconomicAdoptionPort {
  adopt(job: AgentTaskRecord): Promise<AgentTaskEconomicAdoption>;
}
export interface AgentTaskEconomicCommitmentPort extends AgentTaskCommitmentRecoveryPort {
  acquire(input: {
    readonly jobId: string;
    readonly economicAttemptId: string;
    readonly intentFingerprint: string;
    readonly snapshot: ManagedEconomicAdoptedSnapshot;
    readonly expectation: ManagedEconomicAdoptedSnapshotExpectation;
    readonly routeCapacity: readonly ManagedEconomicRouteCapacity[];
  }): ManagedEconomicCommitmentAcquireResult;
  releasePreFence(jobId: string, economicAttemptId: string): void;
  recordReleaseFailure(input: {
    readonly jobId: string;
    readonly economicAttemptId: string;
    readonly reason: string;
    readonly evidenceUri: string;
  }): void;
}
export type AgentTaskReservation =
  | { readonly kind: "created"; readonly job: AgentTaskRecord }
  | { readonly kind: "existing"; readonly job: AgentTaskRecord }
  | { readonly kind: "conflict" };

/** Result of the atomic native dispatch-fence ownership decision. */
export type AgentTaskNativeHarnessFenceResult =
  | { readonly kind: "acquired"; readonly job: AgentTaskRecord }
  | { readonly kind: "existing"; readonly job: AgentTaskRecord }
  | { readonly kind: "conflict"; readonly job: AgentTaskRecord };

/** Result of the atomic managed-economic dispatch-fence ownership decision. */
export type AgentTaskEconomicFenceResult =
  | { readonly kind: "acquired"; readonly job: AgentTaskRecord }
  | { readonly kind: "existing"; readonly job: AgentTaskRecord }
  | { readonly kind: "conflict"; readonly job: AgentTaskRecord };

export interface AgentTaskStore {
  reserve(input: { readonly job: AgentTaskRecord }): Promise<AgentTaskReservation>;
  get(id: string): Promise<AgentTaskRecord | undefined>;
  /** Atomically attaches a still-issued approval to an awaiting write job and makes it dispatchable. */
  attachWriteApproval(id: string, approval: AgentTaskWriteApproval, updatedAt?: string): Promise<AgentTaskRecord>;
  recordWriteApproval(id: string, approval: AgentTaskWriteApproval, updatedAt?: string): Promise<AgentTaskRecord>;
  /** Atomically persists the native/remote outer-effect claim before launch. */
  fenceNativeHarness(
    id: string,
    dispatchFenceId: string,
    updatedAt: string | undefined,
    actionClaim: AgentTaskActionClaim,
  ): Promise<AgentTaskNativeHarnessFenceResult>;
  /** Projects the canonical SQLite economic claim into the task lifecycle. */
  projectEconomicDispatch(id: string, dispatchFenceId: string, updatedAt: string | undefined, actionClaim: AgentTaskActionClaim): Promise<AgentTaskEconomicFenceResult>;
  transition(id: string, state: AgentTaskState, diagnostic?: AgentTaskDiagnosticCode, updatedAt?: string, failureEvidence?: AgentTaskFailureEvidence): Promise<AgentTaskRecord>;
  completeSuccess(id: string, result: AgentTaskResult, updatedAt?: string): Promise<AgentTaskRecord>;
  listNonterminal(): Promise<readonly AgentTaskRecord[]>;
}
