import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  digestManagedEconomicValue,
  type ManagedEconomicAdoptedSnapshot,
  type ManagedEconomicAdoptedSnapshotExpectation,
  type ManagedAgentAdmissionProfile,
  type ManagedAgentCallerAttachmentIdentity,
  type DeliberationResolution,
  type ManagedAgentResultHandoff,
} from "@kilnai/core";
import type {
  ManagedEconomicCandidateSet,
} from "../agents/managed-invocation/runtime-tool/index.js";
import type {
  ManagedEconomicDispatchCoordinator,
  ManagedEconomicDispatchPreparation,
} from "../agents/managed-invocation/economic-dispatch-coordinator.js";
import type {
  ManagedEconomicCommitmentAcquireResult,
  ManagedEconomicReplayEvidence,
  ManagedEconomicRouteCapacity,
} from "../managed-account-leases/managed-account-lease-authority.js";

export const MANAGED_JOB_STATES = ["queued", "running", "succeeded", "failed", "timed_out", "interrupted", "cancelled"] as const;
export const MANAGED_JOB_SCHEMA_VERSION = 10 as const;
/** Recovery is deliberately pre-fence-only for economic work and never
 * resumes an external native-harness process after a process restart. */
export const MANAGED_JOB_RECOVERY_POLICY = {
  economic: { unfenced: "redispatch", dispatchFenced: "hold" },
  nativeHarness: { unfenced: "interrupt", dispatchFenced: "interrupt" },
} as const;
export type ManagedJobState = typeof MANAGED_JOB_STATES[number];

export class ManagedJobApplicationError extends Error {
  constructor(
    readonly code: ManagedJobDiagnosticCode,
    readonly operatorAction: string,
  ) {
    super(code);
    this.name = "ManagedJobApplicationError";
  }
}

export type ManagedJobDiagnosticCode =
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

export interface ManagedJobSubmission {
  readonly objective: string;
  readonly configuredAgentProfileId: string;
  readonly callerId: string;
  readonly idempotencyKey: string;
  readonly parent?: { readonly invocationId: string; readonly turnId: string };
}

export interface TrustedManagedJobProject {
  readonly id: string;
}

/** Identity injected by a trusted harness composition, never accepted as a result-query argument. */
export interface TrustedManagedJobQueryContext {
  readonly project: TrustedManagedJobProject;
  readonly callerId: string;
}

export interface ManagedJobGovernanceEvidence {
  readonly version: 1;
  readonly authority: "authoritative";
  readonly source: string;
  readonly issuedAt: string;
  readonly validUntil: string;
}

export interface ManagedJobEconomicProfile {
  readonly kind: "economic";
  readonly id: string;
  readonly economicPolicyId: string;
  readonly economicPolicyRevision: string;
  readonly admissionProfileId: ManagedAgentAdmissionProfile;
  readonly constraints?: {
    readonly routeId?: string;
    readonly providerId?: string;
    readonly model?: string;
  };
}

export type ManagedJobExecutionFailureClassification =
  | "harness_version_mismatch"
  | "structured_handoff_rejected"
  | "model_identity_mismatch"
  | "private_artifact_cleanup_failed"
  | "provider_quota_exhausted"
  | "native_session_error"
  | "write_boundary_violation"
  | "result_handoff_missing"
  | "unknown_failure";

/** Provider-neutral terminal evidence. Error messages and provider payloads never cross this boundary. */
export interface ManagedJobFailureEvidence {
  readonly version: 1;
  readonly classification: ManagedJobExecutionFailureClassification;
  readonly diagnosticUri?: string;
}

export class ManagedJobExecutionFailure extends Error {
  readonly evidence: ManagedJobFailureEvidence;

  constructor(classification: ManagedJobExecutionFailureClassification, diagnosticUri?: string, message = classification) {
    super(message);
    this.name = "ManagedJobExecutionFailure";
    this.evidence = { version: 1, classification, ...(isCanonicalKilnDiagnosticUri(diagnosticUri) ? { diagnosticUri } : {}) };
  }
}

export interface ManagedJobExecutionContext {
  /** Trusted identity of the parent harness; never parsed from the job input. */
  readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
}

/**
 * Exact-route admission for a credentialless native harness.  This branch
 * deliberately has no economic policy, account, quota, price, or candidate
 * identity.  The acknowledgement is the durable operator/runtime contract
 * for the exact route that may be executed after the dispatch fence.
 */
export interface ManagedJobNativeHarnessAcknowledgement {
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
}

export interface ManagedJobNativeHarnessProfile {
  readonly kind: "native-harness";
  readonly id: string;
  readonly admissionProfileId: ManagedAgentAdmissionProfile;
  readonly routeId: string;
  readonly routeRevision: string;
  readonly providerId: string;
  readonly model: string;
  readonly adapterCapabilityId: string;
  readonly adapterCapabilityVersion: string;
  readonly acknowledgement: ManagedJobNativeHarnessAcknowledgement;
}

export type ManagedJobProfile = ManagedJobEconomicProfile | ManagedJobNativeHarnessProfile;

export type ManagedJobNativeHarnessRoute = Omit<ManagedJobNativeHarnessProfile, "id">;

export type ManagedJobDispatch =
  | {
      readonly kind: "economic";
      readonly economicAttemptId: string;
      readonly economicPolicyId: string;
      readonly economicPolicyRevision: string;
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
      readonly acknowledgement: ManagedJobNativeHarnessAcknowledgement;
      readonly dispatchFenceId?: string;
    };

/** Immutable, normalized success evidence. Handoff content is untrusted child output. */
export interface ManagedJobResult {
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
}

export interface ManagedJobLifecycleEntry {
  readonly sequence: number;
  readonly state: ManagedJobState;
  readonly observedAt: string;
  readonly diagnostic?: ManagedJobDiagnosticCode;
  readonly failureEvidence?: ManagedJobFailureEvidence;
}

/** Canonical persisted managed-job representation. */
export interface ManagedJobRecord {
  readonly version: typeof MANAGED_JOB_SCHEMA_VERSION;
  readonly id: string;
  readonly adoptedDecisionAt: string;
  readonly state: ManagedJobState;
  readonly objective: string;
  readonly projectId: string;
  readonly callerId: string;
  readonly configuredAgentProfileId: string;
  readonly admissionProfileId: ManagedAgentAdmissionProfile;
  readonly dispatch: ManagedJobDispatch;
  readonly governanceSource: string;
  readonly admissionId: string;
  readonly requestFingerprint: string;
  readonly idempotencyKeyHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly parent?: { readonly invocationId: string; readonly turnId: string };
  readonly diagnostic?: ManagedJobDiagnosticCode;
  readonly failureEvidence?: ManagedJobFailureEvidence;
  readonly result?: ManagedJobResult;
  readonly lifecycle: readonly ManagedJobLifecycleEntry[];
}
export type ManagedJobResultAvailability = "pending" | "available" | "unavailable" | "failed" | "unresolved";
export interface ManagedJobResultQuery {
  readonly jobId: string;
  readonly availability: ManagedJobResultAvailability;
  readonly lifecycleState: ManagedJobState;
  readonly configuredAgentProfileId: string;
  readonly admissionProfileId: string;
  readonly routeId?: string;
  readonly providerId?: string;
  readonly completedAt?: string;
  readonly provenance?: ManagedJobResult["provenance"];
  readonly handoff?: ManagedAgentResultHandoff;
  readonly diagnostic?: ManagedJobDiagnosticCode;
  readonly failureEvidence?: ManagedJobFailureEvidence;
}

export interface ManagedJobReplayQuery {
  readonly jobId: string;
  readonly availability: "available" | "unavailable";
  readonly lifecycleState: ManagedJobState;
  readonly configuredAgentProfileId: string;
  readonly admissionProfileId: string;
  readonly routeId?: string;
  readonly providerId?: string;
  readonly lifecycle: readonly ManagedJobLifecycleEntry[];
  readonly resultAvailability: ManagedJobResultAvailability;
  readonly dispatch:
    | {
        readonly kind: "economic";
        readonly economic: ManagedJobEconomicReplay;
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
        readonly acknowledgement: ManagedJobNativeHarnessAcknowledgement;
        readonly dispatchFenceId?: string;
      };
  readonly diagnostic?: ManagedJobDiagnosticCode;
  readonly failureEvidence?: ManagedJobFailureEvidence;
}

export type ManagedJobEconomicReplay =
  | { readonly availability: "available"; readonly snapshot: ManagedEconomicReplayEvidence }
  | {
      readonly availability: "unavailable";
      readonly reason: "authority-unavailable" | "evidence-not-found" | "evidence-unprojectable";
    };

export interface ManagedJobProjectPort { resolve(): Promise<TrustedManagedJobProject>; }
export interface ManagedJobGovernancePort {
  resolve(project: TrustedManagedJobProject): Promise<ManagedJobGovernanceEvidence>;
  admit(input: { readonly project: TrustedManagedJobProject; readonly objective: string; readonly configuredAgentProfileId: string; readonly admissionProfileId: string; readonly evidence: ManagedJobGovernanceEvidence }): Promise<{ readonly admitted: true; readonly admissionId: string; readonly source: string } | { readonly admitted: false }>;
}
export interface ManagedJobProfilePort { resolve(id: string): Promise<ManagedJobProfile | undefined>; }
export interface ManagedJobRouteResolutionContext {
  readonly invocationId?: string;
  readonly compositionMode?: "candidate-admission" | "execution";
}
export interface ManagedJobRoutePort {
  resolve(profile: ManagedJobProfile, context?: ManagedJobRouteResolutionContext): Promise<ManagedEconomicCandidateSet | ManagedJobNativeHarnessRoute | undefined>;
}
export type ManagedJobCommitmentRecoveryState = "absent" | "committed" | "dispatch-fenced";
export interface ManagedJobCommitmentRecoveryPort {
  query(input: {
    readonly jobId: string;
    readonly economicAttemptId: string;
  }): ManagedJobCommitmentRecoveryState;
}
export interface ManagedJobEconomicReplayPort {
  inspect(input: { readonly jobId: string; readonly economicAttemptId: string }): ManagedEconomicReplayEvidence | undefined;
}
export interface ManagedJobEconomicAdoption {
  readonly snapshot: ManagedEconomicAdoptedSnapshot;
  readonly expectation: ManagedEconomicAdoptedSnapshotExpectation;
  readonly routeCapacity: readonly ManagedEconomicRouteCapacity[];
}
export interface ManagedJobEconomicAdoptionPort {
  adopt(job: ManagedJobRecord): Promise<ManagedJobEconomicAdoption>;
}
export interface ManagedJobEconomicCommitmentPort extends ManagedJobCommitmentRecoveryPort {
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
export type ManagedJobReservation =
  | { readonly kind: "created"; readonly job: ManagedJobRecord }
  | { readonly kind: "existing"; readonly job: ManagedJobRecord }
  | { readonly kind: "conflict" };

/** Result of the atomic native dispatch-fence ownership decision. */
export type ManagedJobNativeHarnessFenceResult =
  | { readonly kind: "acquired"; readonly job: ManagedJobRecord }
  | { readonly kind: "existing"; readonly job: ManagedJobRecord }
  | { readonly kind: "conflict"; readonly job: ManagedJobRecord };

export interface ManagedJobStore {
  reserve(input: { readonly job: ManagedJobRecord }): Promise<ManagedJobReservation>;
  get(id: string): Promise<ManagedJobRecord | undefined>;
  /** Atomically persists the exact-route fence before adapter creation. */
  fenceNativeHarness(id: string, dispatchFenceId: string, updatedAt?: string): Promise<ManagedJobNativeHarnessFenceResult>;
  transition(id: string, state: ManagedJobState, diagnostic?: ManagedJobDiagnosticCode, updatedAt?: string, failureEvidence?: ManagedJobFailureEvidence): Promise<ManagedJobRecord>;
  completeSuccess(id: string, result: ManagedJobResult, updatedAt?: string): Promise<ManagedJobRecord>;
  listNonterminal(): Promise<readonly ManagedJobRecord[]>;
}

export interface ManagedJobApplicationOptions {
  readonly project: ManagedJobProjectPort;
  readonly governance: ManagedJobGovernancePort;
  readonly profiles: ManagedJobProfilePort;
  readonly routes: ManagedJobRoutePort;
  readonly lineage?: { validate(input: { readonly project: TrustedManagedJobProject; readonly callerId: string; readonly parent: NonNullable<ManagedJobSubmission["parent"]> }): Promise<boolean> };
  readonly store: ManagedJobStore;
  readonly commitmentRecovery?: ManagedJobCommitmentRecoveryPort;
  readonly economicAdoption?: ManagedJobEconomicAdoptionPort;
  readonly economicCommitment?: ManagedJobEconomicCommitmentPort;
  readonly economicReplay?: ManagedJobEconomicReplayPort;
  readonly economicDispatch?: ManagedEconomicDispatchCoordinator;
  readonly economicExecution?: ManagedJobEconomicExecutionPort;
  readonly nativeHarnessExecution?: ManagedJobNativeHarnessExecutionPort;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
  readonly economicAttemptIdGenerator?: () => string;
  readonly nativeHarnessDispatchIdGenerator?: () => string;
}

export class ManagedJobApplicationService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly economicAttemptIdGenerator: () => string;
  private readonly nativeHarnessDispatchIdGenerator: () => string;

  constructor(private readonly options: ManagedJobApplicationOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.economicAttemptIdGenerator = options.economicAttemptIdGenerator ?? randomUUID;
    this.nativeHarnessDispatchIdGenerator = options.nativeHarnessDispatchIdGenerator ?? randomUUID;
  }

  /**
   * Accepts and durably reserves governed V10 work without crossing an
   * economic/native dispatch boundary. Completion is observed through the
   * status, result, and replay queries after the project owner schedules the
   * returned job.
   */
  async accept(input: unknown): Promise<ManagedJobRecord> {
    return await this.prepare(input);
  }

  private async prepare(input: unknown): Promise<ManagedJobRecord> {
    const request = parseManagedJobSubmission(input);
    const project = await this.resolveProject();
    if (request.parent && (!this.options.lineage || !await this.validateLineage(project, request))) throw new ManagedJobApplicationError("invalid_request", "Provide trusted parent invocation lineage.");
    const governance = await this.resolveGovernance(project);
    let profile: ManagedJobProfile | undefined;
    try { profile = await this.options.profiles.resolve(request.configuredAgentProfileId); } catch { throw new ManagedJobApplicationError("profile_unavailable", "Choose a configured admitted agent profile."); }
    if (!profile) throw new ManagedJobApplicationError("profile_unavailable", "Choose a configured admitted agent profile.");
    if (!isIdentifier(profile.id) || profile.id !== request.configuredAgentProfileId) throw new ManagedJobApplicationError("profile_unavailable", "Choose a configured admitted agent profile.");
    if (profile.kind === "native-harness") {
      return await this.startNativeHarnessPrecommit(request, project, governance, profile);
    }
    return await this.startEconomicPrecommit(request, project, governance, profile);
  }

  private async startEconomicPrecommit(
    request: ManagedJobSubmission,
    project: TrustedManagedJobProject,
    governance: ManagedJobGovernanceEvidence,
    profile: ManagedJobEconomicProfile,
  ): Promise<ManagedJobRecord> {
    if (!isValidEconomicManagedJobProfile(profile)) {
      throw new ManagedJobApplicationError("profile_unavailable", "Choose a configured admitted economic policy profile.");
    }
    let admission: Awaited<ReturnType<ManagedJobGovernancePort["admit"]>>;
    try {
      admission = await this.options.governance.admit({
        project,
        objective: request.objective,
        configuredAgentProfileId: profile.id,
        admissionProfileId: profile.admissionProfileId,
        evidence: governance,
      });
    } catch {
      throw new ManagedJobApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence.");
    }
    if (!admission.admitted) throw new ManagedJobApplicationError("admission_denied", "Review the authoritative work-governance policy.");
    if (!isIdentifier(admission.admissionId) || !isIdentifier(admission.source)) {
      throw new ManagedJobApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
    }
    const jobId = this.newJobId();
    let candidateSet: ManagedEconomicCandidateSet | undefined;
    try {
      const resolved = await this.options.routes.resolve(profile, {
        invocationId: `managed-job:${jobId}`,
        compositionMode: "candidate-admission",
      });
      if (isManagedEconomicCandidateSet(resolved)) candidateSet = resolved;
    } catch {
      throw new ManagedJobApplicationError("route_unavailable", "Refresh managed economic candidate admission.");
    }
    if (
      !candidateSet
      || candidateSet.economicPolicyId !== profile.economicPolicyId
      || candidateSet.economicPolicyRevision !== profile.economicPolicyRevision
      || candidateSet.admissionProfileId !== profile.admissionProfileId
      || !sameManagedJobConstraints(candidateSet.constraints, profile.constraints ?? {})
    ) {
      throw new ManagedJobApplicationError("route_unavailable", "Refresh managed economic candidate admission.");
    }
    const now = this.now();
    const constraints = normalizeManagedJobConstraints(profile.constraints);
    const requestFingerprint = digestManagedEconomicValue({
      objective: request.objective,
      configuredAgentProfileId: request.configuredAgentProfileId,
      economicPolicyId: profile.economicPolicyId,
      economicPolicyRevision: profile.economicPolicyRevision,
      constraints,
      parent: request.parent,
    });
    const queued: ManagedJobRecord = {
      version: MANAGED_JOB_SCHEMA_VERSION,
      id: jobId,
      adoptedDecisionAt: now,
      state: "queued",
      objective: request.objective,
      projectId: project.id,
      callerId: request.callerId,
      configuredAgentProfileId: profile.id,
      admissionProfileId: profile.admissionProfileId,
      dispatch: {
        kind: "economic",
        economicAttemptId: this.newEconomicAttemptId(),
        economicPolicyId: profile.economicPolicyId,
        economicPolicyRevision: profile.economicPolicyRevision,
        constraints,
        candidateSet,
      },
      governanceSource: admission.source,
      admissionId: admission.admissionId,
      requestFingerprint,
      idempotencyKeyHash: digestManagedEconomicValue({
        projectId: project.id,
        callerId: request.callerId,
        idempotencyKey: request.idempotencyKey,
      }),
      createdAt: now,
      updatedAt: now,
      lifecycle: [{ sequence: 1, state: "queued", observedAt: now }],
      ...(request.parent ? { parent: request.parent } : {}),
    };
    const reservation = await this.reserve(queued);
    if (reservation.kind === "conflict") throw new ManagedJobApplicationError("idempotency_conflict", "Use a new idempotency identity for different managed work.");
    if (reservation.kind === "existing") {
      if (!isNonterminal(reservation.job.state)) return reservation.job;
      return reservation.job;
    }
    return queued;
  }

  private async startNativeHarnessPrecommit(
    request: ManagedJobSubmission,
    project: TrustedManagedJobProject,
    governance: ManagedJobGovernanceEvidence,
    profile: ManagedJobNativeHarnessProfile,
  ): Promise<ManagedJobRecord> {
    if (!isValidNativeHarnessProfile(profile)) {
      throw new ManagedJobApplicationError("profile_unavailable", "Choose a configured exact native-harness route profile.");
    }
    let admission: Awaited<ReturnType<ManagedJobGovernancePort["admit"]>>;
    try {
      admission = await this.options.governance.admit({
        project,
        objective: request.objective,
        configuredAgentProfileId: profile.id,
        admissionProfileId: profile.admissionProfileId,
        evidence: governance,
      });
    } catch {
      throw new ManagedJobApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence.");
    }
    if (!admission.admitted) throw new ManagedJobApplicationError("admission_denied", "Review the authoritative work-governance policy.");
    if (!isIdentifier(admission.admissionId) || !isIdentifier(admission.source)) {
      throw new ManagedJobApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
    }
    let resolved: ManagedJobNativeHarnessRoute | undefined;
    try {
      const candidate = await this.options.routes.resolve(profile);
      if (isValidNativeHarnessRoute(candidate)) resolved = candidate;
    } catch {
      throw new ManagedJobApplicationError("route_unavailable", "Refresh the exact native-harness route admission.");
    }
    if (!resolved || !sameNativeHarnessRoute(profile, resolved)) {
      throw new ManagedJobApplicationError("route_unavailable", "Refresh the exact native-harness route admission.");
    }
    const now = this.now();
    const dispatch = {
      kind: "native-harness" as const,
      routeId: resolved.routeId,
      routeRevision: resolved.routeRevision,
      providerId: resolved.providerId,
      model: resolved.model,
      admissionProfileId: resolved.admissionProfileId,
      adapterCapabilityId: resolved.adapterCapabilityId,
      adapterCapabilityVersion: resolved.adapterCapabilityVersion,
      acknowledgement: resolved.acknowledgement,
    };
    const requestFingerprint = digestManagedEconomicValue({
      kind: dispatch.kind,
      objective: request.objective,
      configuredAgentProfileId: request.configuredAgentProfileId,
      route: {
        routeId: dispatch.routeId,
        routeRevision: dispatch.routeRevision,
        providerId: dispatch.providerId,
        model: dispatch.model,
        admissionProfileId: dispatch.admissionProfileId,
        adapterCapabilityId: dispatch.adapterCapabilityId,
        adapterCapabilityVersion: dispatch.adapterCapabilityVersion,
        acknowledgement: {
          version: dispatch.acknowledgement.version,
          source: dispatch.acknowledgement.source,
          credentialMode: dispatch.acknowledgement.credentialMode,
          routeId: dispatch.acknowledgement.routeId,
          routeRevision: dispatch.acknowledgement.routeRevision,
          providerId: dispatch.acknowledgement.providerId,
          model: dispatch.acknowledgement.model,
          admissionProfileId: dispatch.acknowledgement.admissionProfileId,
          adapterCapabilityId: dispatch.acknowledgement.adapterCapabilityId,
          adapterCapabilityVersion: dispatch.acknowledgement.adapterCapabilityVersion,
        },
      },
      parent: request.parent,
    });
    const queued: ManagedJobRecord = {
      version: MANAGED_JOB_SCHEMA_VERSION,
      id: this.newJobId(),
      adoptedDecisionAt: now,
      state: "queued",
      objective: request.objective,
      projectId: project.id,
      callerId: request.callerId,
      configuredAgentProfileId: profile.id,
      admissionProfileId: profile.admissionProfileId,
      dispatch,
      governanceSource: admission.source,
      admissionId: admission.admissionId,
      requestFingerprint,
      idempotencyKeyHash: digestManagedEconomicValue({
        projectId: project.id,
        callerId: request.callerId,
        idempotencyKey: request.idempotencyKey,
      }),
      createdAt: now,
      updatedAt: now,
      lifecycle: [{ sequence: 1, state: "queued", observedAt: now }],
      ...(request.parent ? { parent: request.parent } : {}),
    };
    const reservation = await this.reserve(queued);
    if (reservation.kind === "conflict") throw new ManagedJobApplicationError("idempotency_conflict", "Use a new idempotency identity for different managed work.");
    if (reservation.kind === "existing") {
      if (!isNonterminal(reservation.job.state)) return reservation.job;
      if (reservation.job.dispatch.kind !== "native-harness") return reservation.job;
      return reservation.job;
    }
    return queued;
  }

  /** Runs one already accepted job. The project owner is responsible for
   * coalescing calls and retaining the returned promise until completion. */
  async dispatch(id: string, context?: ManagedJobExecutionContext): Promise<ManagedJobRecord> {
    if (!isIdentifier(id)) throw new ManagedJobApplicationError("invalid_request", "Provide a valid managed-job identifier.");
    let job: ManagedJobRecord;
    try {
      job = await this.options.store.get(id) as ManagedJobRecord;
    } catch (error) {
      throw normalizeStoreError(error);
    }
    if (!job) throw new ManagedJobApplicationError("unknown_job", "Verify the managed-job identifier.");
    if (!isNonterminal(job.state)) return job;
    if (job.dispatch.kind === "economic") {
      try {
        const recoveryState = (this.options.commitmentRecovery ?? this.options.economicCommitment)?.query({
          jobId: job.id,
          economicAttemptId: job.dispatch.economicAttemptId,
        });
        if (recoveryState === "dispatch-fenced") return job;
      } catch {
        // The commitment coordinator remains the authority for an unknown
        // recovery state; let the normal dispatch path fail closed.
      }
    }
    if (job.dispatch.kind === "native-harness") {
      // A persisted native fence is proof that the external process may have
      // started. Never resolve a fresh route or invoke the harness again.
      if (job.dispatch.dispatchFenceId !== undefined) return job;
      const resolvedRoute = await this.resolveNativeHarnessDispatchRoute(job);
      // The accepted acknowledgement is the durable identity. Route lookup
      // may refresh observation time, but it cannot replace that identity.
      const route: ManagedJobNativeHarnessRoute = {
        ...resolvedRoute,
        acknowledgement: job.dispatch.acknowledgement,
      };
      return await this.commitNativeHarnessAttempt(
        job as ManagedJobRecord & { readonly dispatch: Extract<ManagedJobDispatch, { readonly kind: "native-harness" }> },
        route,
        context?.callerIdentity,
      );
    }
    return await this.commitEconomicAttempt(job);
  }

  /** Converts an owned worker rejection into one safe terminal job state. */
  async failDispatch(id: string, error: unknown): Promise<ManagedJobRecord | undefined> {
    let job: ManagedJobRecord | undefined;
    try {
      job = await this.options.store.get(id);
    } catch {
      return undefined;
    }
    if (!job || !isNonterminal(job.state)) return job;
    const diagnostic = isDiagnostic(error) ? error : "invocation_failed";
    const failureEvidence = normalizeManagedJobExecutionFailure(error);
    try {
      return await this.transition(job.id, "failed", diagnostic, failureEvidence);
    } catch {
      return undefined;
    }
  }

  async getStatus(context: TrustedManagedJobQueryContext, id: string): Promise<ManagedJobRecord> {
    if (!isIdentifier(id)) throw new ManagedJobApplicationError("invalid_request", "Provide a valid managed-job identifier.");
    try {
      const job = await this.options.store.get(id);
      if (!job) throw new ManagedJobApplicationError("unknown_job", "Verify the managed-job identifier.");
      this.authorizeQuery(context, job);
      return job;
    } catch (error) { throw normalizeStoreError(error); }
  }

  async getResult(context: TrustedManagedJobQueryContext, id: string): Promise<ManagedJobResultQuery> {
    const job = await this.getStatus(context, id);
    if (job.state === "queued" || job.state === "running") return resultQuery(job, "pending", "result_pending");
    if (job.state !== "succeeded") return resultQuery(job, "failed", job.diagnostic ?? "invocation_failed");
    if (!job.result) return resultQuery(job, "unresolved", "result_persistence_failure");
    return resultQuery(job, "available");
  }

  async cancel(context: TrustedManagedJobQueryContext, id: string): Promise<ManagedJobRecord> {
    const job = await this.getStatus(context, id);
    if (job.state !== "queued" && job.state !== "running") {
      throw new ManagedJobApplicationError("invalid_transition", "Cancel only active managed work.");
    }
    throw new ManagedJobApplicationError(
      "invocation_failed",
      "Historical active records have no live Runtime ownership after recovery.",
    );
  }

  async getReplay(context: TrustedManagedJobQueryContext, id: string): Promise<ManagedJobReplayQuery> {
    const job = await this.getStatus(context, id);
    return replayQuery(job, "available", job.lifecycle, undefined, this.dispatchReplay(job));
  }

  private economicReplay(job: ManagedJobRecord & { readonly dispatch: Extract<ManagedJobDispatch, { readonly kind: "economic" }> }): ManagedJobEconomicReplay {
    if (!this.options.economicReplay) return { availability: "unavailable", reason: "authority-unavailable" };
    try {
      const snapshot = this.options.economicReplay.inspect({ jobId: job.id, economicAttemptId: job.dispatch.economicAttemptId });
      return snapshot === undefined
        ? { availability: "unavailable", reason: "evidence-not-found" }
        : { availability: "available", snapshot };
    } catch {
      return { availability: "unavailable", reason: "evidence-unprojectable" };
    }
  }

  private dispatchReplay(job: ManagedJobRecord): ManagedJobReplayQuery["dispatch"] {
    if (job.dispatch.kind === "native-harness") {
      return {
        kind: "native-harness",
        routeId: job.dispatch.routeId,
        routeRevision: job.dispatch.routeRevision,
        providerId: job.dispatch.providerId,
        model: job.dispatch.model,
        admissionProfileId: job.dispatch.admissionProfileId,
        adapterCapabilityId: job.dispatch.adapterCapabilityId,
        adapterCapabilityVersion: job.dispatch.adapterCapabilityVersion,
        acknowledgement: job.dispatch.acknowledgement,
        ...(job.dispatch.dispatchFenceId ? { dispatchFenceId: job.dispatch.dispatchFenceId } : {}),
      };
    }
    return {
      kind: "economic",
      economic: this.economicReplay(
        job as ManagedJobRecord & { readonly dispatch: Extract<ManagedJobDispatch, { readonly kind: "economic" }> },
      ),
    };
  }

  async recoverInterrupted(): Promise<readonly ManagedJobRecord[]> {
    try {
      const jobs = await this.options.store.listNonterminal();
      return Promise.all(jobs.map(async (job) => {
        if (job.dispatch.kind === "native-harness") {
          // Neither a queued native job nor a fenced native process has a
          // restart-safe caller/process owner. Mark both interrupted rather
          // than silently redispatching a possibly started external process.
          return this.transition(job.id, "interrupted", "invocation_failed");
        }
        // Economic work without a dispatch fence is safe to hand back to the
        // project dispatcher: SQLite acquisition is idempotent and still owns
        // the only post-commit boundary. A fenced record stays pending for
        // settlement/reconciliation and is never redispatched here.
        return job;
      }));
    } catch (error) { throw normalizeStoreError(error); }
  }

  private async resolveProject(): Promise<TrustedManagedJobProject> {
    try {
      const project = await this.options.project.resolve();
      if (!isIdentifier(project.id)) throw new Error("invalid");
      return project;
    } catch { throw new ManagedJobApplicationError("project_identity_unavailable", "Use a trusted project composition boundary."); }
  }

  private async validateLineage(project: TrustedManagedJobProject, request: ManagedJobSubmission): Promise<boolean> {
    try { return request.parent ? await this.options.lineage!.validate({ project, callerId: request.callerId, parent: request.parent }) : true; } catch { return false; }
  }

  private newJobId(): string {
    const id = this.idGenerator();
    if (!isIdentifier(id) || id.length < 12) throw new ManagedJobApplicationError("invalid_request", "Configure a valid opaque managed-job identifier generator.");
    return id;
  }

  private newEconomicAttemptId(): string {
    const seed = this.economicAttemptIdGenerator();
    if (!isIdentifier(seed) || seed.length < 12) throw new ManagedJobApplicationError("invalid_request", "Configure a valid opaque managed economic attempt identifier generator.");
    return `economic-attempt:${seed}`;
  }

  private newNativeHarnessDispatchId(): string {
    const seed = this.nativeHarnessDispatchIdGenerator();
    if (!isIdentifier(seed) || seed.length < 12) throw new ManagedJobApplicationError("invalid_request", "Configure a valid opaque native-harness dispatch identifier generator.");
    return `native-harness-dispatch:${seed}`;
  }

  private async commitNativeHarnessAttempt(
    job: ManagedJobRecord & { readonly dispatch: Extract<ManagedJobDispatch, { readonly kind: "native-harness" }> },
    route: ManagedJobNativeHarnessRoute,
    callerIdentity?: ManagedAgentCallerAttachmentIdentity,
  ): Promise<ManagedJobRecord> {
    if (!sameNativeHarnessDispatchRoute(job.dispatch, route)) {
      throw new ManagedJobApplicationError("identity-revision-conflict", "Restore the exact persisted native-harness route acknowledgement.");
    }
    // A persisted fence means another owner already crossed the only dispatch
    // boundary. An idempotent acceptance must return that nonterminal record
    // rather than creating a second process or adapter.
    if (job.dispatch.dispatchFenceId !== undefined) return job;
    if (!this.options.nativeHarnessExecution) {
      return this.transition(job.id, "failed", "route_unavailable");
    }
    let fenceResult: ManagedJobNativeHarnessFenceResult;
    try {
      const dispatchFenceId = job.dispatch.dispatchFenceId ?? this.newNativeHarnessDispatchId();
      fenceResult = await this.options.store.fenceNativeHarness(job.id, dispatchFenceId, this.now());
    } catch (error) {
      if (error instanceof ManagedJobApplicationError) throw error;
      return this.transition(job.id, "failed", "route_unavailable");
    }
    // Only the atomic owner may cross the external process boundary. An
    // existing or conflicting fence belongs to another dispatcher, including
    // a caller that happened to generate the same fence identifier.
    if (fenceResult.kind !== "acquired") return fenceResult.job;
    const fenced = fenceResult.job;
    if (fenced.state !== "running" || fenced.dispatch.kind !== "native-harness" || !fenced.dispatch.dispatchFenceId) {
      return fenced;
    }
    try {
      const execution = await this.options.nativeHarnessExecution.execute({
        job: fenced as ManagedJobRecord & { readonly dispatch: Extract<ManagedJobDispatch, { readonly kind: "native-harness" }> },
        route,
        dispatchFenceId: fenced.dispatch.dispatchFenceId,
        ...(callerIdentity ? { callerIdentity } : {}),
      });
      const selected = fenced.dispatch;
      const result: ManagedJobResult = {
        version: 1,
        jobId: fenced.id,
        runtimeInvocationId: execution.runtimeInvocationId,
        configuredAgentProfileId: fenced.configuredAgentProfileId,
        admissionProfileId: fenced.admissionProfileId,
        routeId: selected.routeId,
        providerId: selected.providerId,
        terminalState: "completed",
        completedAt: execution.completedAt,
        provenance: { source: "runtime-managed-invocation", trust: "untrusted-child-output" },
        resultHandoff: normalizeManagedJobResultHandoff(execution.resultHandoff, fenced.objective),
      };
      return await this.options.store.completeSuccess(fenced.id, result, execution.completedAt);
    } catch (error) {
      return this.transition(fenced.id, "failed", "invocation_failed", normalizeManagedJobExecutionFailure(error));
    }
  }

  private async commitEconomicAttempt(job: ManagedJobRecord): Promise<ManagedJobRecord> {
    if (!this.options.economicAdoption || !this.options.economicDispatch || !this.options.economicExecution) {
      return this.transition(job.id, "failed", "economic_commitment_unavailable");
    }
    try {
      const dispatch = economicDispatchOf(job);
      await this.validateCurrentEconomicCandidateIdentity(job);
      // All async config, quota, credential-revision, and capacity work completes
      // before entering the synchronous SQLite authority.
      const adopted = await this.options.economicAdoption.adopt(job);
      const intentFingerprint = digestManagedEconomicValue({
        jobId: job.id,
        economicAttemptId: dispatch.economicAttemptId,
        projectId: job.projectId,
        callerId: job.callerId,
        admissionProfileId: job.admissionProfileId,
        admissionId: job.admissionId,
        governanceSource: job.governanceSource,
        requestFingerprint: job.requestFingerprint,
        economicPolicyId: dispatch.economicPolicyId,
        economicPolicyRevision: dispatch.economicPolicyRevision,
        candidateSetDigest: adopted.expectation.candidateSetDigest,
        constraints: dispatch.constraints,
        snapshotDigest: adopted.snapshot.snapshotDigest,
        rateCardRevisions: adopted.snapshot.routes.map(({ route }) => ({
          routeId: route.routeId,
          rateCardId: route.rateCardId,
          rateCardRevision: route.rateCardRevision,
        })),
        reservations: adopted.snapshot.routes.map(({ admittedIdentity, worstCaseReservation, ceiling, executionEnvelope }) => ({
          routeId: admittedIdentity.routeId,
          worstCaseReservation,
          ceiling,
          executionEnvelope,
        })),
        adoptedDecisionAt: job.adoptedDecisionAt,
      });
      const preparation = await this.options.economicDispatch.prepare({
        jobId: job.id,
        economicAttemptId: dispatch.economicAttemptId,
        intentFingerprint,
        adoption: adopted,
        admissionProfile: job.admissionProfileId,
        validateExecutionProfile: async () => {
          await this.validateCurrentEconomicCandidateIdentity(job);
        },
      });
      if (preparation.status === "denied") {
        return this.transition(job.id, "failed", "economic_commitment_unavailable");
      }
      if (preparation.status === "already-dispatched") return job;
      const running = await this.transition(job.id, "running");
      try {
        const execution = await this.options.economicExecution.execute({ job: running, preparation });
        const selected = preparation.commitment.reservation.selectedIdentity.route;
        const result: ManagedJobResult = {
          version: 1,
          jobId: job.id,
          runtimeInvocationId: execution.runtimeInvocationId,
          configuredAgentProfileId: job.configuredAgentProfileId,
          admissionProfileId: job.admissionProfileId,
          routeId: selected.routeId,
          providerId: selected.providerId,
          terminalState: "completed",
          completedAt: execution.completedAt,
          provenance: { source: "runtime-managed-invocation", trust: "untrusted-child-output" },
          resultHandoff: normalizeManagedJobResultHandoff(execution.resultHandoff, job.objective),
        };
        return await this.options.store.completeSuccess(job.id, result, execution.completedAt);
      } catch (error) {
        preparation.recordExecutionSettlementPending("managed-job-execution-failed");
        return this.transition(job.id, "failed", "invocation_failed", normalizeManagedJobExecutionFailure(error));
      }
    } catch (error) {
      if (error instanceof ManagedJobApplicationError) throw error;
      return this.transition(job.id, "failed", "economic_commitment_unavailable");
    }
  }

  private async resolveGovernance(project: TrustedManagedJobProject): Promise<ManagedJobGovernanceEvidence> {
    let evidence: ManagedJobGovernanceEvidence;
    try { evidence = await this.options.governance.resolve(project); } catch { throw new ManagedJobApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence."); }
    if (evidence.version !== 1 || evidence.authority !== "authoritative" || !isIdentifier(evidence.source) || !isFreshEvidence(evidence, this.clock())) {
      throw new ManagedJobApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
    }
    return evidence;
  }

  private async resolveNativeHarnessDispatchRoute(
    job: ManagedJobRecord,
  ): Promise<ManagedJobNativeHarnessRoute> {
    try {
      const profile = await this.options.profiles.resolve(job.configuredAgentProfileId);
      if (!profile || profile.kind !== "native-harness" || !isValidNativeHarnessProfile(profile)) {
        throw new Error("profile");
      }
      const resolved = await this.options.routes.resolve(profile, {
        invocationId: `managed-job:${job.id}`,
        compositionMode: "execution",
      });
      if (!isValidNativeHarnessRoute(resolved) || !sameNativeHarnessRoute(profile, resolved)) {
        throw new Error("route");
      }
      return resolved;
    } catch {
      throw new ManagedJobApplicationError(
        "identity-revision-conflict",
        "Restore the exact persisted native-harness route acknowledgement before dispatch.",
      );
    }
  }

  /** Re-checks the persisted V10 candidate identity before and after fencing. */
  private async validateCurrentEconomicCandidateIdentity(job: ManagedJobRecord): Promise<void> {
    const dispatch = economicDispatchOf(job);
    let profile: ManagedJobProfile | undefined;
    let resolved: ManagedEconomicCandidateSet | ManagedJobNativeHarnessRoute | undefined;
    try {
      profile = await this.options.profiles.resolve(job.configuredAgentProfileId);
      if (!profile || profile.kind !== "economic") throw new Error("profile");
      resolved = await this.options.routes.resolve(profile, {
        invocationId: `managed-job:${job.id}`,
        compositionMode: "execution",
      });
    } catch {
      throw new ManagedJobApplicationError(
        "identity-revision-conflict",
        "Restore the exact V10 managed economic candidate identity before execution.",
      );
    }
    if (!isManagedEconomicCandidateSet(resolved) || !sameManagedEconomicCandidateSet(dispatch.candidateSet, resolved)) {
      throw new ManagedJobApplicationError(
        "identity-revision-conflict",
        "Restore the exact V10 managed economic candidate identity before execution.",
      );
    }
  }

  private async reserve(job: ManagedJobRecord): Promise<ManagedJobReservation> {
    try { return await this.options.store.reserve({ job }); } catch (error) { throw normalizeStoreError(error); }
  }

  private async transition(id: string, state: ManagedJobState, diagnostic?: ManagedJobDiagnosticCode, failureEvidence?: ManagedJobFailureEvidence): Promise<ManagedJobRecord> {
    try { return await this.options.store.transition(id, state, diagnostic, this.now(), failureEvidence); } catch (error) { throw normalizeStoreError(error); }
  }

  private authorizeQuery(context: TrustedManagedJobQueryContext, job: ManagedJobRecord): void {
    if (!isRecord(context) || !isRecord(context.project) || !isIdentifier(context.project.id) || !isIdentifier(context.callerId)) {
      throw new ManagedJobApplicationError("invalid_request", "Use a trusted caller and project query context.");
    }
    if (job.projectId !== context.project.id || job.callerId !== context.callerId) {
      throw new ManagedJobApplicationError("unauthorized_job", "Use the trusted caller and project that own this managed job.");
    }
  }

  private now(): string {
    const date = this.clock();
    if (Number.isNaN(date.getTime())) throw new ManagedJobApplicationError("invalid_request", "Use a valid clock source.");
    return date.toISOString();
  }
}

export class InMemoryManagedJobStore implements ManagedJobStore {
  private readonly jobs = new Map<string, ManagedJobRecord>();
  private readonly bindings = new Map<string, { readonly fingerprint: string; readonly jobId: string }>();

  constructor(storedJobs: readonly unknown[] = []) {
    for (const storedJob of migrateV9ManagedJobRecords(storedJobs).records) {
      const job = validateStoredJob(storedJob);
      if (this.jobs.has(job.id) || this.bindings.has(job.idempotencyKeyHash)) {
        throw new ManagedJobApplicationError("job_persistence_corrupt", "Repair the managed-job store before retrying.");
      }
      this.jobs.set(job.id, cloneManagedJob(job));
      this.bindings.set(job.idempotencyKeyHash, {
        fingerprint: job.requestFingerprint,
        jobId: job.id,
      });
    }
  }

  async reserve(input: { readonly job: ManagedJobRecord }): Promise<ManagedJobReservation> {
    const job = validateStoredJob(input.job);
    const binding = this.bindings.get(job.idempotencyKeyHash);
    if (binding) {
      if (binding.fingerprint !== job.requestFingerprint) return { kind: "conflict" };
      const existing = this.jobs.get(binding.jobId);
      if (!existing) throw new ManagedJobApplicationError("job_persistence_corrupt", "Repair the managed-job store before retrying.");
      return { kind: "existing", job: cloneManagedJob(existing) };
    }
    this.jobs.set(job.id, cloneManagedJob(job));
    this.bindings.set(job.idempotencyKeyHash, { fingerprint: job.requestFingerprint, jobId: job.id });
    return { kind: "created", job: cloneManagedJob(job) };
  }
  async get(id: string): Promise<ManagedJobRecord | undefined> { const job = this.jobs.get(id); return job ? cloneManagedJob(job) : undefined; }
  async fenceNativeHarness(id: string, dispatchFenceId: string, updatedAt?: string): Promise<ManagedJobNativeHarnessFenceResult> {
    const current = this.jobs.get(id);
    if (!current) throw new ManagedJobApplicationError("unknown_job", "Verify the managed-job identifier.");
    if (current.dispatch.kind !== "native-harness") throw new ManagedJobApplicationError("identity-revision-conflict", "Persisted managed dispatch is not a native-harness route.");
    if (current.dispatch.dispatchFenceId !== undefined) {
      return { kind: "existing", job: cloneManagedJob(current) };
    }
    if (current.state !== "queued") return { kind: "conflict", job: cloneManagedJob(current) };
    if (!isNativeHarnessDispatchFenceId(dispatchFenceId)) throw new ManagedJobApplicationError("invalid_request", "Use a valid native-harness dispatch fence identifier.");
    const timestamp = updatedAt ?? new Date().toISOString();
    if (!isIso(timestamp) || Date.parse(timestamp) < Date.parse(current.updatedAt)) throw new ManagedJobApplicationError("invalid_transition", "Use monotonic managed-job timestamps.");
    const next: ManagedJobRecord = {
      ...current,
      state: "running",
      updatedAt: timestamp,
      dispatch: { ...current.dispatch, dispatchFenceId },
      lifecycle: [...current.lifecycle, lifecycleEntry(current.lifecycle.length + 1, "running", timestamp)],
    };
    this.jobs.set(id, next);
    return { kind: "acquired", job: cloneManagedJob(next) };
  }
  async transition(id: string, state: ManagedJobState, diagnostic?: ManagedJobDiagnosticCode, updatedAt?: string, failureEvidence?: ManagedJobFailureEvidence): Promise<ManagedJobRecord> {
    const current = this.jobs.get(id);
    if (!current) throw new ManagedJobApplicationError("unknown_job", "Verify the managed-job identifier.");
    if (current.state === state && current.diagnostic === diagnostic && JSON.stringify(current.failureEvidence) === JSON.stringify(failureEvidence)) return cloneManagedJob(current);
    if (!canTransition(current.state, state)) throw new ManagedJobApplicationError("invalid_transition", "Keep terminal managed-job states immutable.");
    const timestamp = updatedAt ?? new Date().toISOString();
    if (!isIso(timestamp) || Date.parse(timestamp) < Date.parse(current.updatedAt)) throw new ManagedJobApplicationError("invalid_transition", "Use monotonic managed-job timestamps.");
    const next: ManagedJobRecord = {
      ...current,
      state,
      updatedAt: timestamp,
      lifecycle: [...current.lifecycle, lifecycleEntry(current.lifecycle.length + 1, state, timestamp, diagnostic, failureEvidence)],
      ...(diagnostic ? { diagnostic } : {}),
      ...(failureEvidence ? { failureEvidence } : {}),
    };
    this.jobs.set(id, next);
    return cloneManagedJob(next);
  }
  async completeSuccess(id: string, result: ManagedJobResult, updatedAt?: string): Promise<ManagedJobRecord> {
    const current = this.jobs.get(id);
    if (!current) throw new ManagedJobApplicationError("unknown_job", "Verify the managed-job identifier.");
    if (current.state !== "running" || current.result !== undefined) throw new ManagedJobApplicationError("invalid_transition", "Keep terminal managed-job results immutable.");
    const timestamp = updatedAt ?? new Date().toISOString();
    if (!isIso(timestamp) || Date.parse(timestamp) < Date.parse(current.updatedAt) || !isValidManagedJobResult(result, current, timestamp)) {
      throw new ManagedJobApplicationError("result_corrupt", "Persist only validated canonical Runtime result evidence.");
    }
    const next: ManagedJobRecord = {
      ...current,
      state: "succeeded",
      result,
      updatedAt: timestamp,
      lifecycle: [...current.lifecycle, lifecycleEntry(current.lifecycle.length + 1, "succeeded", timestamp)],
    };
    this.jobs.set(id, next);
    return cloneManagedJob(next);
  }
  async listNonterminal(): Promise<readonly ManagedJobRecord[]> { return [...this.jobs.values()].filter((job) => job.state === "queued" || job.state === "running").map(cloneManagedJob); }
  all(): readonly ManagedJobRecord[] { return [...this.jobs.values()].map(cloneManagedJob); }
}

export class FilesystemManagedJobStore implements ManagedJobStore {
  private readonly root: string;
  constructor(rootPath: string, private readonly staleLockMs = 60000) { this.root = resolve(rootPath); }
  async reserve(input: { readonly job: ManagedJobRecord }): Promise<ManagedJobReservation> {
    return this.withLock(async () => {
      const memory = await this.loadMemory();
      const result = await memory.reserve(input);
      if (result.kind === "created") await this.saveMemory(memory);
      return result;
    });
  }
  async get(id: string): Promise<ManagedJobRecord | undefined> { return this.withLock(async () => (await this.loadMemory()).get(id)); }
  async fenceNativeHarness(id: string, dispatchFenceId: string, updatedAt?: string): Promise<ManagedJobNativeHarnessFenceResult> {
    return this.withLock(async () => {
      const memory = await this.loadMemory();
      const result = await memory.fenceNativeHarness(id, dispatchFenceId, updatedAt);
      if (result.kind === "acquired") await this.saveMemory(memory);
      return result;
    });
  }
  async transition(id: string, state: ManagedJobState, diagnostic?: ManagedJobDiagnosticCode, updatedAt?: string, failureEvidence?: ManagedJobFailureEvidence): Promise<ManagedJobRecord> {
    return this.withLock(async () => { const memory = await this.loadMemory(); const job = await memory.transition(id, state, diagnostic, updatedAt, failureEvidence); await this.saveMemory(memory); return job; });
  }
  async completeSuccess(id: string, result: ManagedJobResult, updatedAt?: string): Promise<ManagedJobRecord> {
    return this.withLock(async () => { const memory = await this.loadMemory(); const job = await memory.completeSuccess(id, result, updatedAt); await this.saveMemory(memory); return job; });
  }
  async listNonterminal(): Promise<readonly ManagedJobRecord[]> { return this.withLock(async () => (await this.loadMemory()).listNonterminal()); }
  private async loadMemory(): Promise<InMemoryManagedJobStore> {
    try {
      const parsed = JSON.parse(await readFile(resolve(this.root, "managed-jobs.json"), "utf8")) as unknown;
      if (!Array.isArray(parsed)) throw new Error("corrupt");
      const migrated = migrateV9ManagedJobRecords(parsed);
      const memory = new InMemoryManagedJobStore(migrated.records);
      if (migrated.didMigrate) await this.saveMemory(memory);
      return memory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new InMemoryManagedJobStore();
      }
      if (
        error instanceof SyntaxError
        || error instanceof ManagedJobApplicationError
        || (error instanceof Error && error.message === "corrupt")
      ) {
        throw new ManagedJobApplicationError("job_persistence_corrupt", "Repair the managed-job store before retrying.");
      }
      throw new ManagedJobApplicationError("job_persistence_unavailable", "Restore the managed-job store and retry safely.");
    }
  }
  private async saveMemory(memory: InMemoryManagedJobStore): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const records = memory.all();
    const target = resolve(this.root, "managed-jobs.json");
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(records)}\n`, "utf8");
    await rename(temp, target);
  }
  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true });
    const lock = resolve(this.root, ".managed-jobs.lock");
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        await mkdir(lock);
        try { return await action(); } finally { await rm(lock, { recursive: true, force: true }); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const lockStat = await stat(lock);
          if (Date.now() - lockStat.mtimeMs > this.staleLockMs) await rm(lock, { recursive: true, force: true });
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code !== "ENOENT") throw lockError;
        }
        await new Promise<void>((done) => setTimeout(done, 5));
      }
    }
    throw new ManagedJobApplicationError("job_persistence_unavailable", "Wait for the active managed-job persistence operation to finish.");
  }
}
function parseManagedJobSubmission(value: unknown): ManagedJobSubmission {
  if (!isRecord(value) || !hasOnly(value, ["objective", "configuredAgentProfileId", "callerId", "idempotencyKey", "parent"]) || typeof value.objective !== "string" || typeof value.configuredAgentProfileId !== "string" || typeof value.callerId !== "string" || typeof value.idempotencyKey !== "string") throw new ManagedJobApplicationError("invalid_request", "Provide only the supported managed-work fields.");
  const objective = value.objective.trim(); const configuredAgentProfileId = value.configuredAgentProfileId.trim(); const callerId = value.callerId.trim(); const idempotencyKey = value.idempotencyKey.trim();
  if (objective.length === 0 || objective.length > 12000 || !isIdentifier(configuredAgentProfileId) || !isIdentifier(callerId) || !isIdentifier(idempotencyKey)) throw new ManagedJobApplicationError("invalid_request", "Provide bounded valid managed-work identities and objective.");
  let parent: ManagedJobSubmission["parent"];
  if (value.parent !== undefined) { if (!isRecord(value.parent) || !hasOnly(value.parent, ["invocationId", "turnId"]) || !isIdentifier(value.parent.invocationId) || !isIdentifier(value.parent.turnId)) throw new ManagedJobApplicationError("invalid_request", "Provide valid parent invocation lineage."); parent = { invocationId: value.parent.invocationId, turnId: value.parent.turnId }; }
  return { objective, configuredAgentProfileId, callerId, idempotencyKey, ...(parent ? { parent } : {}) };
}
function migrateV9ManagedJobRecords(records: readonly unknown[]): { readonly records: readonly unknown[]; readonly didMigrate: boolean } {
  let didMigrate = false;
  const migrated = records.map((record) => {
    if (!isRecord(record) || record.version !== 9) return record;
    didMigrate = true;
    // V9 had no terminal failure evidence; preserving its fields is the complete migration.
    return { ...record, version: MANAGED_JOB_SCHEMA_VERSION };
  });
  return { records: migrated, didMigrate };
}
function validateStoredJob(value: unknown): ManagedJobRecord {
  if (isRecord(value) && value.version !== MANAGED_JOB_SCHEMA_VERSION) {
    throw new ManagedJobApplicationError(
      "job_persistence_corrupt",
      "Reset the managed-job store; only canonical V10 records are supported.",
    );
  }
  const allowed = [
    "version", "id", "adoptedDecisionAt", "state", "objective", "projectId", "callerId",
    "configuredAgentProfileId", "admissionProfileId", "dispatch", "governanceSource", "admissionId",
    "requestFingerprint", "idempotencyKeyHash", "createdAt", "updatedAt", "parent", "diagnostic", "failureEvidence",
    "result", "lifecycle",
  ];
  if (
    !isRecord(value)
    || value.version !== MANAGED_JOB_SCHEMA_VERSION
    || !hasOnly(value, allowed)
    || !isIdentifier(value.id)
    || !isIso(value.adoptedDecisionAt)
    || !MANAGED_JOB_STATES.includes(value.state as ManagedJobState)
    || typeof value.objective !== "string"
    || value.objective.trim().length === 0
    || value.objective.length > 12000
    || !isIdentifier(value.projectId)
    || !isIdentifier(value.callerId)
    || !isIdentifier(value.configuredAgentProfileId)
    || !isManagedAgentAdmissionProfile(value.admissionProfileId)
    || !isValidManagedJobDispatch(value.dispatch)
    || !isIdentifier(value.governanceSource)
    || !isIdentifier(value.admissionId)
    || !isCanonicalHash(value.requestFingerprint)
    || !isCanonicalHash(value.idempotencyKeyHash)
    || !isIso(value.createdAt)
    || !isIso(value.updatedAt)
    || Date.parse(value.adoptedDecisionAt) !== Date.parse(value.createdAt)
    || Date.parse(value.createdAt) > Date.parse(value.updatedAt)
    || (value.diagnostic !== undefined && !isDiagnostic(value.diagnostic))
    || (value.failureEvidence !== undefined && !isValidManagedJobFailureEvidence(value.failureEvidence))
    || (
      value.parent !== undefined
      && (
        !isRecord(value.parent)
        || !hasOnly(value.parent, ["invocationId", "turnId"])
        || !isIdentifier(value.parent.invocationId)
        || !isIdentifier(value.parent.turnId)
      )
    )
    || !isValidLifecycle(value.lifecycle, value.state as ManagedJobState, value.createdAt, value.updatedAt)
  ) {
    throw new ManagedJobApplicationError("job_persistence_corrupt", "Repair the managed-job store before retrying.");
  }
  const job = value as unknown as ManagedJobRecord;
  if (
    job.dispatch.kind === "economic"
      ? (
        job.dispatch.candidateSet.economicPolicyId !== job.dispatch.economicPolicyId
        || job.dispatch.candidateSet.economicPolicyRevision !== job.dispatch.economicPolicyRevision
        || job.dispatch.candidateSet.admissionProfileId !== job.admissionProfileId
        || !sameManagedJobConstraints(job.dispatch.candidateSet.constraints, job.dispatch.constraints)
      )
      : (
        job.dispatch.admissionProfileId !== job.admissionProfileId
        || (job.dispatch.dispatchFenceId !== undefined && !isNativeHarnessDispatchFenceId(job.dispatch.dispatchFenceId))
        || (job.state === "queued" && job.dispatch.dispatchFenceId !== undefined)
        || (job.state === "running" && job.dispatch.dispatchFenceId === undefined)
      )
    || (job.state === "succeeded" && !job.result)
    || (job.state !== "succeeded" && job.result !== undefined)
    || (job.state !== "failed" && job.failureEvidence !== undefined)
    || (job.failureEvidence === undefined && job.lifecycle.some((entry) => entry.failureEvidence !== undefined))
    || (job.failureEvidence !== undefined && JSON.stringify(job.lifecycle.at(-1)?.failureEvidence) !== JSON.stringify(job.failureEvidence))
    || (job.result !== undefined && !isValidManagedJobResult(job.result, job, job.updatedAt))
  ) {
    throw new ManagedJobApplicationError("job_persistence_corrupt", "Repair the managed-job store before retrying.");
  }
  return job;
}
function normalizeStoreError(error: unknown): ManagedJobApplicationError { return error instanceof ManagedJobApplicationError ? error : new ManagedJobApplicationError("job_persistence_unavailable", "Restore the managed-job store and retry safely."); }
function normalizeManagedJobExecutionFailure(error: unknown): ManagedJobFailureEvidence {
  if (error instanceof ManagedJobExecutionFailure && isValidManagedJobFailureEvidence(error.evidence)) return error.evidence;
  return { version: 1, classification: "unknown_failure" };
}
function isValidManagedJobFailureEvidence(value: unknown): value is ManagedJobFailureEvidence {
  return isRecord(value)
    && hasOnly(value, ["version", "classification", "diagnosticUri"])
    && value.version === 1
    && isManagedJobExecutionFailureClassification(value.classification)
    && (value.diagnosticUri === undefined || isCanonicalKilnDiagnosticUri(value.diagnosticUri));
}
function isManagedJobExecutionFailureClassification(value: unknown): value is ManagedJobExecutionFailureClassification {
  return typeof value === "string" && ["harness_version_mismatch", "structured_handoff_rejected", "model_identity_mismatch", "private_artifact_cleanup_failed", "provider_quota_exhausted", "native_session_error", "write_boundary_violation", "result_handoff_missing", "unknown_failure"].includes(value);
}
function isCanonicalKilnDiagnosticUri(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const uri = new URL(value);
    if (
      uri.protocol !== "kiln:"
      || uri.port !== ""
      || uri.username !== ""
      || uri.password !== ""
      || uri.search !== ""
      || uri.hash !== ""
    ) return false;
    const segments = uri.pathname.split("/").filter(Boolean);
    if (uri.hostname === "diagnostics") {
      return segments.length > 0
        && segments.every((segment) => /^[a-z0-9][a-z0-9-]*$/u.test(segment));
    }
    return uri.hostname === "managed-agents"
      && segments.length >= 4
      && segments[0] === "invocations"
      && segments[2] === "resources"
      && segments.every((segment) => /^[A-Za-z0-9][A-Za-z0-9:._%-]*$/u.test(segment));
  } catch { return false; }
}
function canTransition(from: ManagedJobState, to: ManagedJobState): boolean { if (from === to) return false; if (from === "queued") return to === "running" || to === "failed" || to === "interrupted" || to === "cancelled"; return from === "running" && (to === "succeeded" || to === "failed" || to === "timed_out" || to === "interrupted" || to === "cancelled"); }
function lifecycleEntry(sequence: number, state: ManagedJobState, observedAt: string, diagnostic?: ManagedJobDiagnosticCode, failureEvidence?: ManagedJobFailureEvidence): ManagedJobLifecycleEntry {
  return { sequence, state, observedAt, ...(diagnostic ? { diagnostic } : {}), ...(failureEvidence ? { failureEvidence } : {}) };
}
function isValidLifecycle(value: unknown, state: ManagedJobState, createdAt: string, updatedAt: string): value is readonly ManagedJobLifecycleEntry[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  let previousTime = Number.NEGATIVE_INFINITY;
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry) || !hasOnly(entry, ["sequence", "state", "observedAt", "diagnostic", "failureEvidence"]) || entry.sequence !== index + 1 || !MANAGED_JOB_STATES.includes(entry.state as ManagedJobState) || !isIso(entry.observedAt) || (entry.diagnostic !== undefined && !isDiagnostic(entry.diagnostic)) || (entry.failureEvidence !== undefined && (!isValidManagedJobFailureEvidence(entry.failureEvidence) || entry.state !== "failed"))) return false;
    const observedAt = Date.parse(entry.observedAt);
    if (observedAt < previousTime) return false;
    previousTime = observedAt;
  }
  const first = value[0] as unknown as ManagedJobLifecycleEntry;
  const last = value[value.length - 1] as unknown as ManagedJobLifecycleEntry;
  return first.state === "queued"
    && Date.parse(first.observedAt) === Date.parse(createdAt)
    && last.state === state
    && Date.parse(last.observedAt) <= Date.parse(updatedAt);
}
function isFreshEvidence(value: ManagedJobGovernanceEvidence, now: Date): boolean { return isIso(value.issuedAt) && isIso(value.validUntil) && Date.parse(value.issuedAt) <= now.getTime() && now.getTime() <= Date.parse(value.validUntil); }
function isValidManagedJobResult(value: unknown, job: ManagedJobRecord, updatedAt: string): value is ManagedJobResult {
  if (!isRecord(value) || !hasOnly(value, ["version", "jobId", "runtimeInvocationId", "configuredAgentProfileId", "admissionProfileId", "routeId", "providerId", "terminalState", "completedAt", "provenance", "resultHandoff"]) || value.version !== 1 || value.jobId !== job.id || !isIdentifier(value.runtimeInvocationId) || value.configuredAgentProfileId !== job.configuredAgentProfileId || value.admissionProfileId !== job.admissionProfileId || value.terminalState !== "completed" || !isIso(value.completedAt) || Date.parse(value.completedAt) !== Date.parse(updatedAt) || !isRecord(value.provenance) || !hasOnly(value.provenance, ["source", "trust"]) || value.provenance.source !== "runtime-managed-invocation" || value.provenance.trust !== "untrusted-child-output" || !isSafeResultHandoff(value.resultHandoff)) return false;
  if (job.dispatch.kind === "native-harness") {
    return job.dispatch.routeId === value.routeId && job.dispatch.providerId === value.providerId;
  }
  return job.dispatch.candidateSet.candidates.some(
    (candidate) => candidate.routeId === value.routeId && candidate.providerId === value.providerId,
  );
}
function isSafeResultHandoff(value: unknown): value is ManagedAgentResultHandoff {
  return isRecord(value)
    && hasOnly(value, ["provenance", "summary", "resourceUris", "memoryWriteProposalUris"])
    && isSafeResultHandoffProvenance(value.provenance)
    && typeof value.summary === "string"
    && value.summary.trim().length > 0
    && value.summary.length <= MANAGED_JOB_INLINE_RESULT_LIMIT
    && Array.isArray(value.resourceUris)
    && Array.isArray(value.memoryWriteProposalUris)
    && value.resourceUris.length === 0
    && value.memoryWriteProposalUris.length === 0
    && redactManagedJobResultText(value.summary) === value.summary;
}
export interface ManagedJobEconomicExecutionPort {
  execute(input: {
    readonly job: ManagedJobRecord;
    readonly preparation: Extract<ManagedEconomicDispatchPreparation, { readonly status: "prepared" }>;
  }): Promise<{
    readonly runtimeInvocationId: string;
    readonly completedAt: string;
    readonly resultHandoff: ManagedAgentResultHandoff;
  }>;
}

export interface ManagedJobNativeHarnessExecutionPort {
  execute(input: {
    readonly job: ManagedJobRecord & { readonly dispatch: Extract<ManagedJobDispatch, { readonly kind: "native-harness" }> };
    readonly route: ManagedJobNativeHarnessRoute;
    readonly dispatchFenceId: string;
    readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
  }): Promise<{
    readonly runtimeInvocationId: string;
    readonly completedAt: string;
    readonly resultHandoff: ManagedAgentResultHandoff;
  }>;
}
function isSafeResultHandoffProvenance(value: unknown): boolean {
  if (!isRecord(value) || !hasOnly(value, ["delivery", "configuredModelId", "primaryObservedModelId", "observedModelIds", "harness"])) {
    return false;
  }
  if (
    value.delivery !== "native-structured-output"
    && value.delivery !== "assistant-text"
    && value.delivery !== "submission-tool"
    && value.delivery !== "remote-harness"
    && value.delivery !== "runtime-generated"
  ) {
    return false;
  }
  if (
    typeof value.configuredModelId !== "string"
    || value.configuredModelId.trim().length === 0
    || (value.primaryObservedModelId !== undefined
      && (typeof value.primaryObservedModelId !== "string"
        || value.primaryObservedModelId.trim().length === 0))
    || !Array.isArray(value.observedModelIds)
    || !value.observedModelIds.every((modelId) => typeof modelId === "string" && modelId.trim().length > 0)
    || (value.primaryObservedModelId !== undefined
      && !value.observedModelIds.includes(value.primaryObservedModelId))
  ) {
    return false;
  }
  if (value.harness === undefined) return true;
  return isRecord(value.harness)
    && hasOnly(value.harness, ["id", "executable", "version"])
    && typeof value.harness.id === "string"
    && value.harness.id.trim().length > 0
    && typeof value.harness.executable === "string"
    && value.harness.executable.trim().length > 0
    && !/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(value.harness.executable)
    && typeof value.harness.version === "string"
    && value.harness.version.trim().length > 0;
}
const MANAGED_JOB_INLINE_RESULT_LIMIT = 2000;
const MANAGED_JOB_TRUNCATION_NOTICE = "[TRUNCATED: safe inline result limit reached]";

function normalizeManagedJobResultHandoff(value: ManagedAgentResultHandoff, objective?: string): ManagedAgentResultHandoff {
  let summary = redactManagedJobResultText(value.summary, objective).trim();
  if (summary.length === 0) {
    summary = "[REDACTED: no safe canonical result content remained]";
  }
  if (summary.length > MANAGED_JOB_INLINE_RESULT_LIMIT) {
    const prefixLength = MANAGED_JOB_INLINE_RESULT_LIMIT - MANAGED_JOB_TRUNCATION_NOTICE.length - 1;
    summary = `${summary.slice(0, Math.max(0, prefixLength)).trimEnd()} ${MANAGED_JOB_TRUNCATION_NOTICE}`;
  }
  // Runtime's general handoff resource list can include transcript, replay,
  // diagnostic, write, and provider evidence. This slice has no separately
  // admitted safe result artifact, so omission plus explicit truncation is the
  // truthful representation rather than republishing one of those references.
  return {
    provenance: value.provenance,
    summary,
    resourceUris: [],
    memoryWriteProposalUris: [],
  };
}

function redactManagedJobResultText(value: string, objective?: string): string {
  const trimmed = value.trim();
  if (looksLikeRawProviderPayload(trimmed)) {
    return "[REDACTED:unsafe raw provider payload]";
  }
  return value
    .replaceAll(objective ?? "", objective ? "[REDACTED:request]" : "")
    .replace(/(?:^|\n)\s*(?:system|developer|user)\s+prompt\s*:[^\n]*/giu, "\n[REDACTED:prompt]")
    .replace(/(?:^|\n)\s*(?:hidden\s+reasoning|reasoning)\s*:[^\n]*/giu, "\n[REDACTED:reasoning]")
    .replace(/(?:^|\n)\s*(?:system|developer|user|assistant)\s*:[^\n]*/giu, "\n[REDACTED:transcript]")
    .replace(/(?:^|\n)\s*(?:[A-Za-z_][A-Za-z0-9_]*Error|Error)\s*:[^\n]*/gu, "\n[REDACTED:error]")
    .replace(/(?:^|\n)\s*at\s+[^\n]*/gu, "\n[REDACTED:stack]")
    .replace(/\b(?!(?:REDACTED|TRUNCATED)\b)[A-Z][A-Z0-9_]{2,}\s*(?:=|:)\s*[^\s,;]+/gu, "[REDACTED:environment]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*(?:=|:)\s*[^\s,;]+/giu, "[REDACTED:environment]")
    .replace(/[A-Za-z]:\\[^\s"']+/gu, "[REDACTED:path]")
    .replace(/(?:\/home|\/Users|\/tmp|\/var)\/[^\s"']+/gu, "[REDACTED:path]")
    .replace(/\b(?:sk-(?:proj-|ant-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED:credential]")
    .replace(/\bAuthorization:\s*Bearer\s+[^\s]+/giu, "Authorization: [REDACTED:credential]");
}

function looksLikeRawProviderPayload(value: string): boolean {
  // A structured JSON result may be a provider response, a serialized prompt,
  // or a transcript. This boundary accepts only bounded narrative handoff text;
  // retain no JSON object/array inline rather than attempting to classify nested
  // provider fields or credentials.
  return /(?:\{\s*"[^"\n]{1,200}"\s*:|\[\s*\{)/u.test(value);
}
function resultQuery(job: ManagedJobRecord, availability: ManagedJobResultAvailability, diagnostic?: ManagedJobDiagnosticCode): ManagedJobResultQuery {
  const result = job.result;
  const executionIdentity = result && { routeId: result.routeId, providerId: result.providerId };
  return {
    jobId: job.id,
    availability,
    lifecycleState: job.state,
    configuredAgentProfileId: job.configuredAgentProfileId,
    admissionProfileId: job.admissionProfileId,
    ...(executionIdentity ?? {}),
    ...(result ? { completedAt: result.completedAt, provenance: { ...result.provenance }, handoff: normalizeManagedJobResultHandoff(result.resultHandoff) } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    ...(job.failureEvidence ? { failureEvidence: job.failureEvidence } : {}),
  };
}
function replayQuery(
  job: ManagedJobRecord,
  availability: ManagedJobReplayQuery["availability"],
  lifecycle: readonly ManagedJobLifecycleEntry[],
  diagnostic: ManagedJobDiagnosticCode | undefined,
  dispatch: ManagedJobReplayQuery["dispatch"],
): ManagedJobReplayQuery {
  const resultAvailability: ManagedJobResultAvailability = job.state === "queued" || job.state === "running"
    ? "pending"
    : job.state === "succeeded"
      ? job.result ? "available" : "unavailable"
      : "failed";
  return {
    jobId: job.id,
    availability,
    lifecycleState: job.state,
    configuredAgentProfileId: job.configuredAgentProfileId,
    admissionProfileId: job.admissionProfileId,
    ...(job.result && { routeId: job.result.routeId, providerId: job.result.providerId }),
    lifecycle,
    resultAvailability,
    dispatch,
    ...(diagnostic ? { diagnostic } : {}),
    ...(job.failureEvidence ? { failureEvidence: job.failureEvidence } : {}),
  };
}
function cloneManagedJob(value: ManagedJobRecord): ManagedJobRecord { return structuredClone(value); }
function isValidEconomicManagedJobProfile(profile: ManagedJobEconomicProfile): boolean {
  return profile.kind === "economic"
    && isIdentifier(profile.economicPolicyId)
    && isIdentifier(profile.economicPolicyRevision)
    && isManagedAgentAdmissionProfile(profile.admissionProfileId)
    && isValidManagedJobConstraints(profile.constraints ?? {});
}
function isValidNativeHarnessAcknowledgement(value: unknown): value is ManagedJobNativeHarnessAcknowledgement {
  return isRecord(value)
    && hasOnly(value, [
      "version", "source", "credentialMode", "acknowledgedAt", "routeId", "routeRevision", "providerId", "model",
      "admissionProfileId", "adapterCapabilityId", "adapterCapabilityVersion",
    ])
    && value.version === 1
    && value.source === "managed-route-admission"
    && value.credentialMode === "credentialless"
    && isIso(value.acknowledgedAt)
    && isIdentifier(value.routeId)
    && isIdentifier(value.routeRevision)
    && isIdentifier(value.providerId)
    && isBoundedOpaqueIdentity(value.model)
    && isManagedAgentAdmissionProfile(value.admissionProfileId)
    && isIdentifier(value.adapterCapabilityId)
    && isIdentifier(value.adapterCapabilityVersion);
}
function isValidNativeHarnessProfile(profile: ManagedJobNativeHarnessProfile): boolean {
  return profile.kind === "native-harness"
    && isIdentifier(profile.id)
    && isManagedAgentAdmissionProfile(profile.admissionProfileId)
    && isIdentifier(profile.routeId)
    && isIdentifier(profile.routeRevision)
    && isIdentifier(profile.providerId)
    && isBoundedOpaqueIdentity(profile.model)
    && isIdentifier(profile.adapterCapabilityId)
    && isIdentifier(profile.adapterCapabilityVersion)
    && isValidNativeHarnessAcknowledgement(profile.acknowledgement)
    && profile.acknowledgement.routeId === profile.routeId
    && profile.acknowledgement.routeRevision === profile.routeRevision
    && profile.acknowledgement.providerId === profile.providerId
    && profile.acknowledgement.model === profile.model
    && profile.acknowledgement.admissionProfileId === profile.admissionProfileId
    && profile.acknowledgement.adapterCapabilityId === profile.adapterCapabilityId
    && profile.acknowledgement.adapterCapabilityVersion === profile.adapterCapabilityVersion;
}
function isValidNativeHarnessRoute(value: unknown): value is ManagedJobNativeHarnessRoute {
  return isRecord(value)
    && value.kind === "native-harness"
    && hasOnly(value, [
      "kind", "admissionProfileId", "routeId", "routeRevision", "providerId", "model",
      "adapterCapabilityId", "adapterCapabilityVersion", "acknowledgement",
    ])
    && isManagedAgentAdmissionProfile(value.admissionProfileId)
    && isIdentifier(value.routeId)
    && isIdentifier(value.routeRevision)
    && isIdentifier(value.providerId)
    && isBoundedOpaqueIdentity(value.model)
    && isIdentifier(value.adapterCapabilityId)
    && isIdentifier(value.adapterCapabilityVersion)
    && isValidNativeHarnessAcknowledgement(value.acknowledgement)
    && value.acknowledgement.routeId === value.routeId
    && value.acknowledgement.routeRevision === value.routeRevision
    && value.acknowledgement.providerId === value.providerId
    && value.acknowledgement.model === value.model
    && value.acknowledgement.admissionProfileId === value.admissionProfileId
    && value.acknowledgement.adapterCapabilityId === value.adapterCapabilityId
    && value.acknowledgement.adapterCapabilityVersion === value.adapterCapabilityVersion;
}
function sameNativeHarnessRoute(left: ManagedJobNativeHarnessProfile, right: ManagedJobNativeHarnessRoute): boolean {
  return left.admissionProfileId === right.admissionProfileId
    && left.routeId === right.routeId
    && left.routeRevision === right.routeRevision
    && left.providerId === right.providerId
    && left.model === right.model
    && left.adapterCapabilityId === right.adapterCapabilityId
    && left.adapterCapabilityVersion === right.adapterCapabilityVersion
    && sameNativeHarnessAcknowledgement(left.acknowledgement, right.acknowledgement);
}
function sameNativeHarnessAcknowledgement(
  left: ManagedJobNativeHarnessAcknowledgement,
  right: ManagedJobNativeHarnessAcknowledgement,
): boolean {
  return left.version === right.version
    && left.source === right.source
    && left.credentialMode === right.credentialMode
    && left.acknowledgedAt === right.acknowledgedAt
    && left.routeId === right.routeId
    && left.routeRevision === right.routeRevision
    && left.providerId === right.providerId
    && left.model === right.model
    && left.admissionProfileId === right.admissionProfileId
    && left.adapterCapabilityId === right.adapterCapabilityId
    && left.adapterCapabilityVersion === right.adapterCapabilityVersion;
}
function sameNativeHarnessDispatchRoute(
  dispatch: Extract<ManagedJobDispatch, { readonly kind: "native-harness" }>,
  route: ManagedJobNativeHarnessRoute,
): boolean {
  return dispatch.routeId === route.routeId
    && dispatch.routeRevision === route.routeRevision
    && dispatch.providerId === route.providerId
    && dispatch.model === route.model
    && dispatch.admissionProfileId === route.admissionProfileId
    && dispatch.adapterCapabilityId === route.adapterCapabilityId
    && dispatch.adapterCapabilityVersion === route.adapterCapabilityVersion
    && sameNativeHarnessAcknowledgement(dispatch.acknowledgement, route.acknowledgement);
}
function isValidNativeHarnessDispatch(value: unknown): value is Extract<ManagedJobDispatch, { readonly kind: "native-harness" }> {
  return isRecord(value)
    && value.kind === "native-harness"
    && isIdentifier(value.routeId)
    && isIdentifier(value.routeRevision)
    && isIdentifier(value.providerId)
    && isBoundedOpaqueIdentity(value.model)
    && isManagedAgentAdmissionProfile(value.admissionProfileId)
    && isIdentifier(value.adapterCapabilityId)
    && isIdentifier(value.adapterCapabilityVersion)
    && isValidNativeHarnessAcknowledgement(value.acknowledgement)
    && (value.dispatchFenceId === undefined || isNativeHarnessDispatchFenceId(value.dispatchFenceId))
    && value.acknowledgement.routeId === value.routeId
    && value.acknowledgement.routeRevision === value.routeRevision
    && value.acknowledgement.providerId === value.providerId
    && value.acknowledgement.model === value.model
    && value.acknowledgement.admissionProfileId === value.admissionProfileId
    && value.acknowledgement.adapterCapabilityId === value.adapterCapabilityId
    && value.acknowledgement.adapterCapabilityVersion === value.adapterCapabilityVersion;
}
function isValidManagedJobDispatch(value: unknown): value is ManagedJobDispatch {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "native-harness") {
    return hasOnly(value, [
      "kind", "routeId", "routeRevision", "providerId", "model", "admissionProfileId",
      "adapterCapabilityId", "adapterCapabilityVersion", "acknowledgement", "dispatchFenceId",
    ]) && isValidNativeHarnessDispatch(value);
  }
  if (value.kind !== "economic") return false;
  return hasOnly(value, [
    "kind", "economicAttemptId", "economicPolicyId", "economicPolicyRevision", "constraints", "candidateSet",
  ])
    && isEconomicAttemptId(value.economicAttemptId)
    && isIdentifier(value.economicPolicyId)
    && isIdentifier(value.economicPolicyRevision)
    && isValidManagedJobConstraints(value.constraints)
    && isManagedEconomicCandidateSet(value.candidateSet as ManagedEconomicCandidateSet);
}
function economicDispatchOf(
  job: ManagedJobRecord,
): Extract<ManagedJobDispatch, { readonly kind: "economic" }> {
  if (job.dispatch.kind !== "economic") {
    throw new ManagedJobApplicationError("identity-revision-conflict", "Persisted managed dispatch is not economic.");
  }
  return job.dispatch;
}
function normalizeManagedJobConstraints(
  constraints: ManagedJobEconomicProfile["constraints"] | undefined,
): NonNullable<ManagedJobEconomicProfile["constraints"]> {
  return {
    ...(constraints?.routeId ? { routeId: constraints.routeId } : {}),
    ...(constraints?.providerId ? { providerId: constraints.providerId } : {}),
    ...(constraints?.model ? { model: constraints.model } : {}),
  };
}
function sameManagedJobConstraints(
  left: ManagedEconomicCandidateSet["constraints"],
  right: ManagedJobEconomicProfile["constraints"],
): boolean {
  return JSON.stringify(normalizeManagedJobConstraints(left))
    === JSON.stringify(normalizeManagedJobConstraints(right));
}
function sameManagedEconomicCandidateSet(
  left: ManagedEconomicCandidateSet,
  right: ManagedEconomicCandidateSet,
): boolean {
  if (
    left.economicPolicyId !== right.economicPolicyId
    || left.economicPolicyRevision !== right.economicPolicyRevision
    || left.admissionProfileId !== right.admissionProfileId
    || !sameManagedJobConstraints(left.constraints, right.constraints)
  ) return false;
  const canonicalCandidates = (value: ManagedEconomicCandidateSet): string => digestManagedEconomicValue(
    [...value.candidates].sort((a, b) => digestManagedEconomicValue(a).localeCompare(digestManagedEconomicValue(b))),
  );
  return canonicalCandidates(left) === canonicalCandidates(right);
}
function isManagedEconomicCandidateSet(
  value: unknown,
): value is ManagedEconomicCandidateSet {
  if (
    !isRecord(value)
    || !isIdentifier(value.economicPolicyId)
    || !isIdentifier(value.economicPolicyRevision)
    || !isManagedAgentAdmissionProfile(value.admissionProfileId)
    || !isValidManagedJobConstraints(value.constraints)
    || !Array.isArray(value.candidates)
    || !Array.isArray(value.rejections)
  ) {
    return false;
  }
  const candidateRouteIds = new Set<string>();
  for (const candidate of value.candidates) {
    if (
      !isRecord(candidate)
      || !hasOnly(candidate, [
       "routeId", "routeSource", "providerId", "model", "accountPolicyId",
         "surface", "adapterCapabilityId", "adapterCapabilityVersion", "profileAuthorityDigest",
         "deliberationResolution",
      ])
      || !isIdentifier(candidate.routeId)
      || !isManagedAgentRouteSource(candidate.routeSource)
      || !isIdentifier(candidate.providerId)
      || (candidate.model !== undefined && !isBoundedOpaqueIdentity(candidate.model))
      || (
        candidate.accountPolicyId !== undefined
        && !isIdentifier(candidate.accountPolicyId)
      )
      || (candidate.surface !== undefined && !isIdentifier(candidate.surface))
       || !isIdentifier(candidate.adapterCapabilityId)
       || !isIdentifier(candidate.adapterCapabilityVersion)
       || !isCanonicalHash(candidate.profileAuthorityDigest)
       || (candidate.deliberationResolution !== undefined
         && !isValidManagedCandidateDeliberationResolution(candidate.deliberationResolution))
      || candidateRouteIds.has(candidate.routeId)
    ) {
      return false;
    }
    candidateRouteIds.add(candidate.routeId);
  }
  const rejectedRouteIds = new Set<string>();
  for (const rejection of value.rejections) {
    if (
      !isRecord(rejection)
      || !hasOnly(rejection, ["stage", "routeId", "reason"])
      || rejection.stage !== "managed-candidate-admission"
      || !isIdentifier(rejection.routeId)
      || ![
        "not-in-policy",
        "caller-constraint-excluded",
        "non-economic-admission-failed",
         "economic-capability-unverified",
         "deliberation-denied",
      ].includes(String(rejection.reason))
      || candidateRouteIds.has(rejection.routeId)
      || rejectedRouteIds.has(rejection.routeId)
    ) {
      return false;
    }
    rejectedRouteIds.add(rejection.routeId);
  }
  return true;
}
function isValidManagedCandidateDeliberationResolution(value: unknown): value is DeliberationResolution {
  if (!isRecord(value) || !hasOnly(value, ["status", "requested", "source", "capabilityEvidence", "selectedLevel", "reason"])) return false;
  if (
    (value.source !== "operator"
      && value.source !== "work-item"
      && value.source !== "agent-profile"
      && value.source !== "route"
      && value.source !== "task"
      && value.source !== "project"
      && value.source !== "provider-default")
    || (value.requested !== undefined && !isValidManagedCandidateDeliberationIntent(value.requested))
    || (value.capabilityEvidence !== undefined && !isValidManagedCandidateDeliberationEvidence(value.capabilityEvidence))
  ) return false;
  if (value.status === "exact" || value.status === "defaulted") {
    return isBoundedOpaqueIdentity(value.selectedLevel) && value.reason === undefined;
  }
  if (value.status === "clamped") {
    return isBoundedOpaqueIdentity(value.selectedLevel) && isDeliberationResolutionReason(value.reason);
  }
  if (value.status === "omitted") {
    return isDeliberationResolutionReason(value.reason) && value.selectedLevel === undefined;
  }
  return false;
}
function isValidManagedCandidateDeliberationIntent(value: unknown): boolean {
  if (!isRecord(value) || !hasOnly(value, ["mode", "preferredLevel", "target", "bounds", "onUnsupported"])) return false;
  if (value.onUnsupported !== "deny" && value.onUnsupported !== "omit" && value.onUnsupported !== "allow-clamp") return false;
  if (value.bounds !== undefined && (
    !isRecord(value.bounds)
    || !hasOnly(value.bounds, ["min", "max"])
    || (value.bounds.min !== undefined && !isBoundedOpaqueIdentity(value.bounds.min))
    || (value.bounds.max !== undefined && !isBoundedOpaqueIdentity(value.bounds.max))
  )) return false;
  if (value.mode === "provider-default") {
    return value.preferredLevel === undefined && value.target === undefined;
  }
  if (value.mode === "fixed") {
    return isBoundedOpaqueIdentity(value.preferredLevel) && value.target === undefined;
  }
  return value.mode === "adaptive"
    && (value.target === "latency-first" || value.target === "balanced" || value.target === "quality-first")
    && value.preferredLevel === undefined;
}
function isValidManagedCandidateDeliberationEvidence(value: unknown): boolean {
  return isRecord(value)
    && hasOnly(value, ["sourceIdentity", "sourceRevision", "observedAt"])
    && isBoundedOpaqueIdentity(value.sourceIdentity)
    && isBoundedOpaqueIdentity(value.sourceRevision)
    && isIso(value.observedAt);
}
function isDeliberationResolutionReason(value: unknown): boolean {
  return value === "not-requested"
    || value === "capability-unknown"
    || value === "capability-invalid"
    || value === "provider-default-unavailable"
    || value === "adaptive-unsupported"
    || value === "preferred-level-unsupported"
    || value === "preferred-level-outside-bounds"
    || value === "bound-unsupported"
    || value === "invalid-bounds"
    || value === "no-level-within-bounds";
}
function isIdentifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value); }
function isBoundedOpaqueIdentity(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 300
    && value.trim() === value
    && !/[\u0000-\u001F\u007F]/u.test(value);
}
function isManagedAgentAdmissionProfile(value: unknown): value is ManagedAgentAdmissionProfile {
  return value === "foundation-readonly-plan"
    || value === "foundation-propose-writes"
    || value === "foundation-apply-approved-writes"
    || value === "foundation-memory-write-proposals";
}
function isManagedAgentRouteSource(value: unknown): boolean {
  return value === "ordered-routing"
    || value === "explicit-managed-route"
    || value === "managed-default-route"
    || value === "enabled-engine-fallback";
}
function isEconomicAttemptId(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("economic-attempt:")
    && isIdentifier(value.slice("economic-attempt:".length));
}
function isNativeHarnessDispatchFenceId(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("native-harness-dispatch:")
    && isIdentifier(value.slice("native-harness-dispatch:".length));
}
function isNonterminal(state: ManagedJobState): boolean {
  return state === "queued" || state === "running";
}
function isValidManagedJobConstraints(value: unknown): boolean {
  return isRecord(value)
    && hasOnly(value, ["routeId", "providerId", "model"])
    && (value.routeId === undefined || isIdentifier(value.routeId))
    && (value.providerId === undefined || isIdentifier(value.providerId))
    && (value.model === undefined || isBoundedOpaqueIdentity(value.model));
}
function isCanonicalHash(value: unknown): value is string { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value); }
function isDiagnostic(value: unknown): value is ManagedJobDiagnosticCode { return typeof value === "string" && ["invalid_request", "project_identity_unavailable", "governance_unavailable", "governance_not_authoritative", "admission_denied", "profile_unavailable", "route_unavailable", "idempotency_conflict", "identity-revision-conflict", "job_persistence_unavailable", "job_persistence_corrupt", "unknown_job", "invalid_transition", "provider_rejected", "provider_timeout", "account_lease_unavailable", "economic_commitment_unavailable", "invocation_failed", "unauthorized_job", "result_pending", "result_unavailable", "result_persistence_failure", "result_corrupt", "cancelled", "replay_unavailable"].includes(value); }
function isIso(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
