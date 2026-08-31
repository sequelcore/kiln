import { randomUUID } from "node:crypto";
import {
  digestManagedEconomicValue,
  type ManagedAgentCallerAttachmentIdentity,
} from "@kilnai/core";
import {
  parseVisionAnalyzeInput,
  parseVisionAnalysis,
  VISION_ANALYZE_CAPABILITY_ID,
  VISION_ANALYZE_CONTRACT,
  type VisionAnalyzeInput,
} from "@kilnai/core/capabilities";
import type { ManagedWriteApprovalBinding, ManagedWriteApprovalReceipt } from "../managed-write-approvals/contracts.js";
import {
  createInternalConsumedWriteApproval,
  type ManagedAgentRuntimeConsumedWriteApproval,
} from "../agents/managed-invocation/internal-consumed-write-approval.js";
import type {
  ManagedEconomicCandidateSet,
} from "../agents/managed-invocation/runtime-tool/index.js";
import type {
  ManagedEconomicDispatchCoordinator,
} from "../agents/managed-invocation/economic-dispatch-coordinator.js";
import {
  AGENT_TASK_SCHEMA_VERSION,
  type AgentTaskCommitmentRecoveryPort,
  type AgentTaskCapabilityRequest,
  type AgentTaskDiagnosticCode,
  type AgentTaskDispatch,
  type AgentTaskEconomicAdoptionPort,
  type AgentTaskEconomicCommitmentPort,
  type AgentTaskEconomicProfile,
  type AgentTaskEconomicReplayPort,
  type AgentTaskExecutionContext,
  type AgentTaskFailureEvidence,
  type AgentTaskGovernanceEvidence,
  type AgentTaskGovernancePort,
  type AgentTaskNativeHarnessFenceResult,
  type AgentTaskNativeHarnessProfile,
  type AgentTaskNativeHarnessRoute,
  type AgentTaskProfile,
  type AgentTaskProfilePort,
  type AgentTaskProjectPort,
  type AgentTaskRecord,
  type AgentTaskReplayQuery,
  type AgentTaskReservation,
  type AgentTaskResult,
  type AgentTaskResultQuery,
  type AgentTaskRoutePort,
  type AgentTaskState,
  type AgentTaskStore,
  type AgentTaskSubmission,
  type AgentTaskWriteApproval,
  type AgentTaskWriteApprovalPort,
  type TrustedAgentTaskProject,
  type TrustedAgentTaskQueryContext,
} from "./contracts.js";
import { AgentTaskApplicationError } from "./errors.js";
import {
  hasOnly,
  isApprovedWriteProfile,
  isCanonicalHash,
  isDiagnostic,
  isIdentifier,
  isRecord,
  isFreshEvidence,
  isNonterminal,
  normalizeAgentTaskConstraints,
  sameAgentTaskConstraints,
} from "./validation-primitives.js";
import {
  isManagedEconomicCandidateSet,
  isValidEconomicAgentTaskProfile,
  isValidNativeHarnessProfile,
  isValidNativeHarnessRoute,
  agentTaskExecutionTerminal,
  normalizeAgentTaskExecutionFailure,
  normalizeAgentTaskResultHandoff,
  normalizeAgentTaskWriteEvidence,
  sameManagedEconomicCandidateSet,
  sameNativeHarnessDispatchRoute,
  sameNativeHarnessRoute,
} from "./agent-run-validation.js";
import { projectAgentTaskReplay, projectAgentTaskResult } from "./result-projection-replay.js";
import type {
  AgentTaskEconomicExecutionPort,
  AgentTaskNativeHarnessExecutionPort,
} from "./agent-task-execution.js";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../session/effective-authority-admission-bundle.js";

export { AgentTaskApplicationError, AgentTaskExecutionFailure } from "./errors.js";
export interface AgentTaskApplicationOptions {
  readonly project: AgentTaskProjectPort;
  readonly governance: AgentTaskGovernancePort;
  readonly profiles: AgentTaskProfilePort;
  readonly routes: AgentTaskRoutePort;
  readonly lineage?: { validate(input: { readonly project: TrustedAgentTaskProject; readonly callerId: string; readonly parent: NonNullable<AgentTaskSubmission["parent"]> }): Promise<boolean> };
  readonly store: AgentTaskStore;
  readonly commitmentRecovery?: AgentTaskCommitmentRecoveryPort;
  readonly economicAdoption?: AgentTaskEconomicAdoptionPort;
  readonly economicCommitment?: AgentTaskEconomicCommitmentPort;
  readonly economicReplay?: AgentTaskEconomicReplayPort;
  readonly writeApprovals?: AgentTaskWriteApprovalPort;
  readonly economicDispatch?: ManagedEconomicDispatchCoordinator;
  readonly economicExecution?: AgentTaskEconomicExecutionPort;
  /** Private diagnostics for failures collapsed into a stable public code. */
  readonly onEconomicDispatchError?: (error: unknown) => void;
  /** Interactive approval used by ask-before-spend economic intents. */
  readonly requestEconomicApproval?: (
    description: string,
  ) => Promise<{ readonly approved: boolean; readonly reason?: string }>;
  readonly nativeHarnessExecution?: AgentTaskNativeHarnessExecutionPort;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
  readonly economicAttemptIdGenerator?: () => string;
  readonly nativeHarnessDispatchIdGenerator?: () => string;
}

export class AgentTaskApplicationService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly economicAttemptIdGenerator: () => string;
  private readonly nativeHarnessDispatchIdGenerator: () => string;
  private readonly ownerGeneration: string;
  private readonly activeDispatches = new Map<string, AbortController>();

  constructor(private readonly options: AgentTaskApplicationOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.economicAttemptIdGenerator = options.economicAttemptIdGenerator ?? randomUUID;
    this.nativeHarnessDispatchIdGenerator = options.nativeHarnessDispatchIdGenerator ?? randomUUID;
    this.ownerGeneration = `agent-task-owner:${randomUUID()}`;
  }

  /**
   * Accepts and durably reserves governed V15 work without crossing an
   * economic/native dispatch boundary. Completion is observed through the
   * status, result, and replay queries after the project owner schedules the
   * returned job.
   */
  async accept(input: unknown): Promise<AgentTaskRecord> {
    return await this.prepare(input);
  }

  async attachWriteApproval(context: TrustedAgentTaskQueryContext, id: string, approvalId: string): Promise<AgentTaskRecord> {
    const job = await this.getStatus(context, id);
    if (job.state !== "awaiting_approval" || !isApprovedWriteProfile(job.admissionProfileId)) {
      throw new AgentTaskApplicationError("invalid_transition", "Attach approval only to awaiting approved-write work.");
    }
    if (!this.options.writeApprovals) {
      throw new AgentTaskApplicationError("admission_denied", "Restore the Runtime managed write approval authority.");
    }
    let receipt: ManagedWriteApprovalReceipt | undefined;
    try { receipt = this.options.writeApprovals.inspect(approvalId); } catch { receipt = undefined; }
    if (!receipt || receipt.state !== "issued" || !matchesAttachedApproval(job, receipt.binding)) {
      throw new AgentTaskApplicationError("admission_denied", "Provide one current approval for the exact managed write authority.");
    }
    return await this.options.store.attachWriteApproval(job.id, projectApproval(receipt), this.now());
  }

  private async prepare(input: unknown): Promise<AgentTaskRecord> {
    const request = parseAgentTaskSubmission(input);
    const project = await this.resolveProject();
    if (request.parent && (!this.options.lineage || !await this.validateLineage(project, request))) throw new AgentTaskApplicationError("invalid_request", "Provide trusted parent invocation lineage.");
    const governance = await this.resolveGovernance(project);
    let profile: AgentTaskProfile | undefined;
    try { profile = await this.options.profiles.resolve(request.configuredAgentProfileId); } catch { throw new AgentTaskApplicationError("profile_unavailable", "Choose a configured admitted agent profile."); }
    if (!profile) throw new AgentTaskApplicationError("profile_unavailable", "Choose a configured admitted agent profile.");
    if (!isIdentifier(profile.id) || profile.id !== request.configuredAgentProfileId) throw new AgentTaskApplicationError("profile_unavailable", "Choose a configured admitted agent profile.");
    if (request.capability && !profileSupportsCapability(profile, request.capability.capabilityId)) {
      throw new AgentTaskApplicationError(
        "profile_unavailable",
        "The configured agent profile has not explicitly admitted the requested capability.",
      );
    }
    if (profile.kind === "native-harness") {
      return await this.startNativeHarnessPrecommit(request, project, governance, profile);
    }
    return await this.startEconomicPrecommit(request, project, governance, profile);
  }

  private async startEconomicPrecommit(
    request: ParsedAgentTaskSubmission,
    project: TrustedAgentTaskProject,
    governance: AgentTaskGovernanceEvidence,
    profile: AgentTaskEconomicProfile,
  ): Promise<AgentTaskRecord> {
    if (!isValidEconomicAgentTaskProfile(profile)) {
      throw new AgentTaskApplicationError("profile_unavailable", "Choose a configured admitted economic policy profile.");
    }
    let admission: Awaited<ReturnType<AgentTaskGovernancePort["admit"]>>;
    try {
      admission = await this.options.governance.admit({
        project,
        objective: request.objective,
        configuredAgentProfileId: profile.id,
        admissionProfileId: profile.admissionProfileId,
        evidence: governance,
      });
    } catch {
      throw new AgentTaskApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence.");
    }
    if (!admission.admitted) throw new AgentTaskApplicationError("admission_denied", "Review the authoritative work-governance policy.");
    const admissionBundle = canonicalAdmissionBundle(admission.admitted ? admission.admissionBundle : undefined);
    if (!admissionBundle || !isIdentifier(admission.source)) {
      throw new AgentTaskApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
    }
    const jobId = this.newJobId();
    let candidateSet: ManagedEconomicCandidateSet | undefined;
    try {
      const resolved = await this.options.routes.resolve(profile, {
        invocationId: `agent-task:${jobId}`,
        compositionMode: "candidate-admission",
      });
      if (isManagedEconomicCandidateSet(resolved)) candidateSet = resolved;
    } catch {
      throw new AgentTaskApplicationError("route_unavailable", "Refresh managed economic candidate admission.");
    }
    if (
      !candidateSet
      || candidateSet.economicPolicyId !== profile.economicPolicyId
      || candidateSet.economicPolicyRevision !== profile.economicPolicyRevision
      || candidateSet.admissionProfileId !== profile.admissionProfileId
      || !sameAgentTaskConstraints(candidateSet.constraints, profile.constraints ?? {})
    ) {
      throw new AgentTaskApplicationError("route_unavailable", "Refresh managed economic candidate admission.");
    }
    const awaitingApproval = isApprovedWriteProfile(profile.admissionProfileId);
    if (awaitingApproval && candidateSet.candidates.length !== 1) {
      throw new AgentTaskApplicationError("route_unavailable", "Approved managed writes require one exact admitted route candidate.");
    }
    const now = this.now();
    const constraints = normalizeAgentTaskConstraints(profile.constraints);
    const requestFingerprint = digestManagedEconomicValue({
      objective: request.objective,
      configuredAgentProfileId: request.configuredAgentProfileId,
      economicPolicyId: profile.economicPolicyId,
      economicPolicyRevision: profile.economicPolicyRevision,
      constraints,
      ...(request.capability ? { capability: capabilityFingerprint(request.capability) } : {}),
      parent: request.parent,
    });
    const dispatch: Extract<AgentTaskDispatch, { readonly kind: "economic" }> = {
      kind: "economic",
      economicAttemptId: this.newEconomicAttemptId(),
      economicPolicyId: profile.economicPolicyId,
      economicPolicyRevision: profile.economicPolicyRevision,
      constraints,
      candidateSet,
      admissionBundle,
    };
    const queued: AgentTaskRecord = {
      version: AGENT_TASK_SCHEMA_VERSION,
      id: jobId,
      adoptedDecisionAt: now,
      state: awaitingApproval ? "awaiting_approval" : "queued",
      objective: request.objective,
      projectId: project.id,
      callerId: request.callerId,
      configuredAgentProfileId: profile.id,
      admissionProfileId: profile.admissionProfileId,
      ...(request.capability ? { capability: request.capability } : {}),
      dispatch,
      run: {
        runId: `agent-run:${jobId}`,
        state: awaitingApproval ? "awaiting_approval" : "queued",
        dispatch,
      },
      governanceSource: admission.source,
      admissionId: admissionBundle.admissionId,
      admissionBundle,
      requestFingerprint,
      idempotencyKeyHash: digestManagedEconomicValue({
        projectId: project.id,
        callerId: request.callerId,
        idempotencyKey: request.idempotencyKey,
      }),
      createdAt: now,
      updatedAt: now,
      lifecycle: [{ sequence: 1, state: awaitingApproval ? "awaiting_approval" : "queued", observedAt: now }],
      ...(request.parent ? { parent: request.parent } : {}),
    };
    const reservation = await this.reserve(queued);
    if (reservation.kind === "conflict") throw new AgentTaskApplicationError("idempotency_conflict", "Use a new idempotency identity for different managed work.");
    if (reservation.kind === "existing") {
      if (!isNonterminal(reservation.job.state)) return reservation.job;
      return reservation.job;
    }
    return queued;
  }

  private async startNativeHarnessPrecommit(
    request: ParsedAgentTaskSubmission,
    project: TrustedAgentTaskProject,
    governance: AgentTaskGovernanceEvidence,
    profile: AgentTaskNativeHarnessProfile,
  ): Promise<AgentTaskRecord> {
    if (!isValidNativeHarnessProfile(profile)) {
      throw new AgentTaskApplicationError("profile_unavailable", "Choose a configured exact native-harness route profile.");
    }
    let admission: Awaited<ReturnType<AgentTaskGovernancePort["admit"]>>;
    try {
      admission = await this.options.governance.admit({
        project,
        objective: request.objective,
        configuredAgentProfileId: profile.id,
        admissionProfileId: profile.admissionProfileId,
        evidence: governance,
      });
    } catch {
      throw new AgentTaskApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence.");
    }
    if (!admission.admitted) throw new AgentTaskApplicationError("admission_denied", "Review the authoritative work-governance policy.");
    const admissionBundle = canonicalAdmissionBundle(admission.admitted ? admission.admissionBundle : undefined);
    if (!admissionBundle || !isIdentifier(admission.source)) {
      throw new AgentTaskApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
    }
    let resolved: AgentTaskNativeHarnessRoute | undefined;
    try {
      const candidate = await this.options.routes.resolve(profile);
      if (isValidNativeHarnessRoute(candidate)) resolved = candidate;
    } catch {
      throw new AgentTaskApplicationError("route_unavailable", "Refresh the exact native-harness route admission.");
    }
    if (!resolved || !sameNativeHarnessRoute(profile, resolved)) {
      throw new AgentTaskApplicationError("route_unavailable", "Refresh the exact native-harness route admission.");
    }
    const awaitingApproval = isApprovedWriteProfile(profile.admissionProfileId);
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
      admissionBundle,
      ...(resolved.deliberationResolution ? { deliberationResolution: resolved.deliberationResolution } : {}),
    };
    const requestFingerprint = digestManagedEconomicValue({
      kind: dispatch.kind,
      objective: request.objective,
      configuredAgentProfileId: request.configuredAgentProfileId,
      ...(request.capability ? { capability: capabilityFingerprint(request.capability) } : {}),
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
          ...(dispatch.acknowledgement.deliberationResolution
            ? { deliberationResolution: dispatch.acknowledgement.deliberationResolution }
            : {}),
        },
        ...(dispatch.deliberationResolution ? { deliberationResolution: dispatch.deliberationResolution } : {}),
      },
      parent: request.parent,
    });
    const jobId = this.newJobId();
    const queued: AgentTaskRecord = {
      version: AGENT_TASK_SCHEMA_VERSION,
      id: jobId,
      adoptedDecisionAt: now,
      state: awaitingApproval ? "awaiting_approval" : "queued",
      objective: request.objective,
      projectId: project.id,
      callerId: request.callerId,
      configuredAgentProfileId: profile.id,
      admissionProfileId: profile.admissionProfileId,
      ...(request.capability ? { capability: request.capability } : {}),
      dispatch,
      run: {
        runId: `agent-run:${jobId}`,
        state: awaitingApproval ? "awaiting_approval" : "queued",
        dispatch,
      },
      governanceSource: admission.source,
      admissionId: admissionBundle.admissionId,
      admissionBundle,
      requestFingerprint,
      idempotencyKeyHash: digestManagedEconomicValue({
        projectId: project.id,
        callerId: request.callerId,
        idempotencyKey: request.idempotencyKey,
      }),
      createdAt: now,
      updatedAt: now,
      lifecycle: [{ sequence: 1, state: awaitingApproval ? "awaiting_approval" : "queued", observedAt: now }],
      ...(request.parent ? { parent: request.parent } : {}),
    };
    const reservation = await this.reserve(queued);
    if (reservation.kind === "conflict") throw new AgentTaskApplicationError("idempotency_conflict", "Use a new idempotency identity for different managed work.");
    if (reservation.kind === "existing") {
      if (!isNonterminal(reservation.job.state)) return reservation.job;
      if (reservation.job.dispatch.kind !== "native-harness") return reservation.job;
      return reservation.job;
    }
    return queued;
  }

  /** Runs one already accepted job. The project owner is responsible for
   * coalescing calls and retaining the returned promise until completion. */
  async dispatch(id: string, context?: AgentTaskExecutionContext): Promise<AgentTaskRecord> {
    if (!isIdentifier(id)) throw new AgentTaskApplicationError("invalid_request", "Provide a valid agent-task identifier.");
    let job: AgentTaskRecord;
    try {
      job = await this.options.store.get(id) as AgentTaskRecord;
    } catch (error) {
      throw normalizeStoreError(error);
    }
    if (!job) throw new AgentTaskApplicationError("unknown_job", "Verify the agent-task identifier.");
    if (job.state === "awaiting_approval") return job;
    if (!isNonterminal(job.state)) return job;
    const existingDispatchController = this.activeDispatches.get(job.id);
    const dispatchController = existingDispatchController ?? new AbortController();
    if (!existingDispatchController) this.activeDispatches.set(job.id, dispatchController);
    try {
    if (job.dispatch.kind === "economic") {
      try {
        const recoveryState = (this.options.commitmentRecovery ?? this.options.economicCommitment)?.query({
          jobId: job.id,
          economicAttemptId: job.dispatch.economicAttemptId,
        });
        if (recoveryState === "dispatch-fenced") {
          // The economic ledger is the canonical action-claim authority. If
          // its fence survived while this task projection remained queued,
          // the provider boundary is already closed; do not leave a queued
          // record that every retry can silently return forever.
          return await this.transition(job.id, "interrupted", "result_pending");
        }
      } catch {
        // An unavailable recovery authority cannot prove that the action was
        // unfenced. Persist the conservative unknown projection rather than
        // allowing a later owner to redispatch an ambiguous attempt.
        return await this.transition(job.id, "interrupted", "result_pending");
      }
    }
    if (job.dispatch.kind === "native-harness") {
      // A persisted native fence is proof that the external process may have
      // started. Never resolve a fresh route or invoke the harness again.
      if (job.dispatch.dispatchFenceId !== undefined) return job;
      const resolvedRoute = await this.resolveNativeHarnessDispatchRoute(job);
      // The accepted acknowledgement is the durable identity. Route lookup
      // may refresh observation time, but it cannot replace that identity.
      const route: AgentTaskNativeHarnessRoute = {
        ...resolvedRoute,
        acknowledgement: job.dispatch.acknowledgement,
        ...(job.dispatch.deliberationResolution ? { deliberationResolution: job.dispatch.deliberationResolution } : {}),
      };
      return await this.commitNativeHarnessAttempt(
        job as AgentTaskRecord & { readonly dispatch: Extract<AgentTaskDispatch, { readonly kind: "native-harness" }> },
        route,
        context?.callerIdentity,
        dispatchController.signal,
      );
    }
    return await this.commitEconomicAttempt(job, dispatchController.signal);
    } finally {
      if (!existingDispatchController && this.activeDispatches.get(job.id) === dispatchController) {
        this.activeDispatches.delete(job.id);
      }
    }
  }

  /** Converts an owned worker rejection into one safe terminal job state. */
  async failDispatch(id: string, error: unknown): Promise<AgentTaskRecord | undefined> {
    let job: AgentTaskRecord | undefined;
    try {
      job = await this.options.store.get(id);
    } catch {
      return undefined;
    }
    if (!job || !isNonterminal(job.state)) return job;
    if (await this.hasCanonicalDispatchClaim(job)) {
      // Once the canonical owner reports a post-fence state, the task
      // projection must not remain queued while waiting for a caller that can
      // never safely redispatch this attempt. Settlement/reconciliation stays
      // with that owner; the task records the conservative unknown outcome.
      return await this.transition(job.id, "interrupted", "result_pending");
    }
    if (error instanceof AgentTaskApplicationError && error.code === "job_persistence_unavailable") {
      // Approval consumption is idempotent for this exact job consumer. Keep
      // the unfenced job retryable so a later dispatch can reconcile the
      // consumed receipt into the job store before any external effect.
      return job;
    }
    const diagnostic = isDiagnostic(error) ? error : "invocation_failed";
    const failureEvidence = normalizeAgentTaskExecutionFailure(error);
    try {
      return await this.transition(job.id, "failed", diagnostic, failureEvidence);
    } catch {
      return undefined;
    }
  }

  async getStatus(context: TrustedAgentTaskQueryContext, id: string): Promise<AgentTaskRecord> {
    if (!isIdentifier(id)) throw new AgentTaskApplicationError("invalid_request", "Provide a valid agent-task identifier.");
    try {
      const job = await this.options.store.get(id);
      if (!job) throw new AgentTaskApplicationError("unknown_job", "Verify the agent-task identifier.");
      this.authorizeQuery(context, job);
      return job;
    } catch (error) { throw normalizeStoreError(error); }
  }

  async getResult(context: TrustedAgentTaskQueryContext, id: string): Promise<AgentTaskResultQuery> {
    const job = await this.getStatus(context, id);
    if (job.state === "awaiting_approval" || job.state === "queued" || job.state === "running") return projectAgentTaskResult(job, "pending", "result_pending");
    if (job.state === "interrupted") return projectAgentTaskResult(job, "unresolved", "result_pending");
    if (job.state !== "succeeded") return projectAgentTaskResult(job, "failed", job.diagnostic ?? "invocation_failed");
    if (!job.result) return projectAgentTaskResult(job, "unresolved", "result_persistence_failure");
    return projectAgentTaskResult(job, "available");
  }

  async cancel(context: TrustedAgentTaskQueryContext, id: string): Promise<AgentTaskRecord> {
    const job = await this.getStatus(context, id);
    if (job.state === "awaiting_approval") {
      if (job.writeApproval && this.options.writeApprovals) {
        try { await this.options.writeApprovals.revoke({ approvalId: job.writeApproval.approvalId, projectId: job.projectId }); } catch { /* cancellation still fails closed */ }
      }
      return await this.transition(job.id, "cancelled", "cancelled");
    }
    if (job.state !== "queued" && job.state !== "running") {
      throw new AgentTaskApplicationError("invalid_transition", "Cancel only active managed work.");
    }
    if (await this.hasCanonicalDispatchClaim(job)) {
      this.activeDispatches.get(job.id)?.abort(new AgentTaskApplicationError("cancelled", "Managed work was cancelled by its trusted operator."));
      // A canonical fence means the external effect may have started. The
      // task projection must record that unknown outcome even when economic
      // settlement remains owned by the ledger; cancellation never
      // redispatches a fenced attempt.
      return await this.transition(job.id, "interrupted", "result_pending");
    }
    const active = this.activeDispatches.get(job.id);
    if (active) {
      active.abort(new AgentTaskApplicationError("cancelled", "Managed work was cancelled by its trusted operator."));
      return await this.transition(job.id, "cancelled", "cancelled");
    }
    if (job.state === "queued") return await this.transition(job.id, "cancelled", "cancelled");
    throw new AgentTaskApplicationError(
      "invocation_failed",
      "Historical active records have no live Runtime ownership after recovery.",
    );
  }

  async getReplay(context: TrustedAgentTaskQueryContext, id: string): Promise<AgentTaskReplayQuery> {
    const job = await this.getStatus(context, id);
    return projectAgentTaskReplay(job, this.options.economicReplay);
  }

  async recoverInterrupted(): Promise<readonly AgentTaskRecord[]> {
    try {
      const jobs = await this.options.store.listNonterminal();
      return Promise.all(jobs.map(async (job) => {
        if (job.dispatch.kind === "native-harness") {
          // Neither a queued native job nor a fenced native process has a
          // restart-safe caller/process owner. Mark both interrupted rather
          // than silently redispatching a possibly started external process.
          return this.transition(job.id, "interrupted", "result_pending");
        }
        // The economic ledger owns the canonical action claim. A fence that
        // survived without a task projection is an explicit unknown outcome;
        // persist that state so reopen/retry cannot leave the task queued or
        // cross the provider boundary a second time.
        try {
          const recoveryState = (this.options.commitmentRecovery ?? this.options.economicCommitment)?.query({
            jobId: job.id,
            economicAttemptId: job.dispatch.economicAttemptId,
          });
          return recoveryState === "dispatch-fenced"
            ? await this.transition(job.id, "interrupted", "result_pending")
            : job;
        } catch {
          return await this.transition(job.id, "interrupted", "result_pending");
        }
      }));
    } catch (error) { throw normalizeStoreError(error); }
  }

  private async resolveProject(): Promise<TrustedAgentTaskProject> {
    try {
      const project = await this.options.project.resolve();
      if (!isIdentifier(project.id)) throw new Error("invalid");
      return project;
    } catch { throw new AgentTaskApplicationError("project_identity_unavailable", "Use a trusted project composition boundary."); }
  }

  private async validateLineage(project: TrustedAgentTaskProject, request: AgentTaskSubmission): Promise<boolean> {
    try { return request.parent ? await this.options.lineage!.validate({ project, callerId: request.callerId, parent: request.parent }) : true; } catch { return false; }
  }

  private newJobId(): string {
    const id = this.idGenerator();
    if (!isIdentifier(id) || id.length < 12) throw new AgentTaskApplicationError("invalid_request", "Configure a valid opaque agent-task identifier generator.");
    return id;
  }

  private newEconomicAttemptId(): string {
    const seed = this.economicAttemptIdGenerator();
    if (!isIdentifier(seed) || seed.length < 12) throw new AgentTaskApplicationError("invalid_request", "Configure a valid opaque managed economic attempt identifier generator.");
    return `economic-attempt:${seed}`;
  }

  private newNativeHarnessDispatchId(): string {
    const seed = this.nativeHarnessDispatchIdGenerator();
    if (!isIdentifier(seed) || seed.length < 12) throw new AgentTaskApplicationError("invalid_request", "Configure a valid opaque native-harness dispatch identifier generator.");
    return `native-harness-dispatch:${seed}`;
  }

  private async commitNativeHarnessAttempt(
    job: AgentTaskRecord & { readonly dispatch: Extract<AgentTaskDispatch, { readonly kind: "native-harness" }> },
    route: AgentTaskNativeHarnessRoute,
    callerIdentity?: ManagedAgentCallerAttachmentIdentity,
    abortSignal?: AbortSignal,
  ): Promise<AgentTaskRecord> {
    if (!sameNativeHarnessDispatchRoute(job.dispatch, route)) {
      throw new AgentTaskApplicationError("identity-revision-conflict", "Restore the exact persisted native-harness route acknowledgement.");
    }
    // A persisted fence means another owner already crossed the only dispatch
    // boundary. An idempotent acceptance must return that nonterminal record
    // rather than creating a second process or adapter.
    if (job.dispatch.dispatchFenceId !== undefined) return job;
    if (!this.options.nativeHarnessExecution) {
      return this.transition(job.id, "failed", "route_unavailable");
    }
    if (abortSignal?.aborted) return await this.currentJob(job.id);
    const consumedWriteApproval = await this.consumeWriteApproval(job);
    if (abortSignal?.aborted) return await this.currentJob(job.id);
    let fenceResult: AgentTaskNativeHarnessFenceResult;
    try {
      const dispatchFenceId = job.dispatch.dispatchFenceId ?? this.newNativeHarnessDispatchId();
      const actionClaim = nativeHarnessActionClaim(job, route, this.ownerGeneration);
      fenceResult = await this.options.store.fenceNativeHarness(job.id, dispatchFenceId, this.now(), actionClaim);
    } catch (error) {
      if (error instanceof AgentTaskApplicationError) throw error;
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
    if (abortSignal?.aborted) return await this.transition(fenced.id, "interrupted", "result_pending");
    try {
      const execution = await this.options.nativeHarnessExecution.execute({
        job: fenced as AgentTaskRecord & { readonly dispatch: Extract<AgentTaskDispatch, { readonly kind: "native-harness" }> },
        route,
        dispatchFenceId: fenced.dispatch.dispatchFenceId,
        ...(consumedWriteApproval ? { consumedWriteApproval } : {}),
        ...(callerIdentity ? { callerIdentity } : {}),
        ...(abortSignal ? { abortSignal } : {}),
      });
      if (abortSignal?.aborted) return await this.transition(fenced.id, "interrupted", "result_pending");
      const selected = fenced.dispatch;
      const capabilityOutput = parseCapabilityOutput(fenced, execution.capabilityOutput);
      const result: AgentTaskResult = {
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
        resultHandoff: normalizeAgentTaskResultHandoff(execution.resultHandoff, fenced.objective),
        ...(capabilityOutput === undefined ? {} : { capabilityOutput }),
        dataPolicyProof: execution.dataPolicyProof,
        ...(execution.writeEvidence ? { writeEvidence: normalizeAgentTaskWriteEvidence(execution.writeEvidence, fenced.id) } : {}),
      };
      return await this.options.store.completeSuccess(fenced.id, result, execution.completedAt);
    } catch (error) {
      if (abortSignal?.aborted) return await this.transition(fenced.id, "interrupted", "result_pending");
      if (fenced.dispatch.actionClaim !== undefined) {
        return await this.transition(fenced.id, "interrupted", "result_pending");
      }
      const terminal = agentTaskExecutionTerminal(error);
      return this.transition(fenced.id, terminal.state, terminal.diagnostic, terminal.failureEvidence);
    }
  }

  private async commitEconomicAttempt(job: AgentTaskRecord, abortSignal?: AbortSignal): Promise<AgentTaskRecord> {
    if (!this.options.economicAdoption || !this.options.economicDispatch || !this.options.economicExecution) {
      return this.transition(job.id, "failed", "economic_commitment_unavailable");
    }
    let preparedClaim: Extract<Awaited<ReturnType<ManagedEconomicDispatchCoordinator["prepare"]>>, { readonly status: "prepared" }> | undefined;
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
      let consumedWriteApproval: ManagedAgentRuntimeConsumedWriteApproval | undefined;
      const executionProfile = await this.options.profiles.resolve(job.configuredAgentProfileId);
      if (
        !executionProfile
        || executionProfile.kind !== "economic"
        || !isValidEconomicAgentTaskProfile(executionProfile)
        || (job.capability !== undefined && !profileSupportsCapability(executionProfile, job.capability.capabilityId))
      ) {
        return this.transition(job.id, "failed", "route_unavailable");
      }
      const preparation = await this.options.economicDispatch.prepare({
        jobId: job.id,
        economicAttemptId: dispatch.economicAttemptId,
        intentFingerprint,
        admissionBundle: job.admissionBundle,
        effectIdentity: "agent-task:managed-provider-dispatch",
        adoption: adopted,
        admissionProfile: job.admissionProfileId,
        authorityProfileId: executionProfile.authorityProfileId,
        invocationId: `agent-task:${job.id}`,
        ...(abortSignal ? { abortSignal } : {}),
        ...(executionProfile.workLimits?.maxDurationMs !== undefined
          ? { workLimitDurationMs: executionProfile.workLimits.maxDurationMs }
          : {}),
        ...(executionProfile.economicSpendApproval === "required" || isApprovedWriteProfile(job.admissionProfileId)
          ? {
              validateAndConsumeApprovalBeforeFence: async ({ commitment }: { readonly commitment: import("@kilnai/core").ManagedEconomicCommitment }) => {
                if (executionProfile.economicSpendApproval === "required") {
                  const comparablePaidAmounts = commitment.reservation.amounts.filter((amount) =>
                    amount.scheme.kind !== "unit" && BigInt(amount.atoms) !== 0n);
                  if (comparablePaidAmounts.length > 0) {
                    if (!this.options.requestEconomicApproval) {
                      throw new AgentTaskApplicationError(
                        "admission_denied",
                        "This managed task requires interactive approval before paid usage can be fenced.",
                      );
                    }
                    const approval = await this.options.requestEconomicApproval(
                      `Managed task '${job.configuredAgentProfileId}' requests approval before reserving comparable paid usage on target '${commitment.reservation.selectedIdentity.route.routeId}'.`,
                    );
                    if (!approval.approved) {
                      throw new AgentTaskApplicationError(
                        "admission_denied",
                        `Managed task paid-usage approval denied: ${approval.reason ?? "approval denied"}`,
                      );
                    }
                  }
                }
                if (isApprovedWriteProfile(job.admissionProfileId)) {
                  consumedWriteApproval = await this.consumeWriteApproval(job);
                }
              },
            }
          : {}),
        validateExecutionProfile: async () => {
          await this.validateCurrentEconomicCandidateIdentity(job);
        },
      });
      if (preparation.status === "denied") {
        return this.transition(job.id, "failed", "economic_commitment_unavailable");
      }
      if (preparation.status === "already-dispatched") {
        // The authority may have crossed its economic action fence after the
        // initial recovery read but before this owner acquired the task
        // projection. Close any still-active queued/running view explicitly;
        // never hand the queued record back as if it were retryable.
        const current = await this.currentJob(job.id);
        if (current.state === "queued" || current.state === "running") {
          return await this.transition(job.id, "interrupted", "result_pending");
        }
        return current;
      }
      preparedClaim = preparation;
      if (abortSignal?.aborted) {
        await preparation.recordExecutionSettlementPending("agent-task-cancelled-after-fence");
        return await this.transition(job.id, "interrupted", "result_pending");
      }
      let fenceResult: Awaited<ReturnType<AgentTaskStore["projectEconomicDispatch"]>>;
      try {
        fenceResult = await this.options.store.projectEconomicDispatch(
          job.id,
          preparation.dispatchFenceId,
          this.now(),
          preparation.actionClaim,
        );
      } catch (error) {
        await this.settleEconomicFenceFailure(preparation, "agent-task-economic-fence-persistence-failed");
        throw normalizeStoreError(error);
      }
      if (fenceResult.kind !== "acquired") {
        if (fenceResult.kind === "conflict") {
          await this.settleEconomicFenceFailure(
            preparation,
            "agent-task-economic-fence-conflict",
          );
        }
        return fenceResult.job;
      }
      const running = fenceResult.job;
      if (abortSignal?.aborted) {
        await preparation.recordExecutionSettlementPending("agent-task-cancelled-after-fence");
        return await this.transition(job.id, "interrupted", "result_pending");
      }
      try {
        const execution = await this.options.economicExecution.execute({
          job: running,
          preparation,
          ...(consumedWriteApproval ? { consumedWriteApproval } : {}),
          ...(executionProfile.workLimits ? { workLimits: executionProfile.workLimits } : {}),
        });
        if (abortSignal?.aborted) return await this.currentJob(job.id);
        const selected = preparation.commitment.reservation.selectedIdentity.route;
        const capabilityOutput = parseCapabilityOutput(job, execution.capabilityOutput);
        const result: AgentTaskResult = {
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
          resultHandoff: normalizeAgentTaskResultHandoff(execution.resultHandoff, job.objective),
          ...(capabilityOutput === undefined ? {} : { capabilityOutput }),
          dataPolicyProof: execution.dataPolicyProof,
          ...(execution.writeEvidence ? { writeEvidence: normalizeAgentTaskWriteEvidence(execution.writeEvidence, job.id) } : {}),
        };
        return await this.options.store.completeSuccess(job.id, result, execution.completedAt);
      } catch (error) {
        this.options.onEconomicDispatchError?.(error);
        await preparation.recordExecutionSettlementPending("agent-task-execution-failed");
        return await this.transition(job.id, "interrupted", "result_pending");
      }
    } catch (error) {
      this.options.onEconomicDispatchError?.(error);
      if (preparedClaim !== undefined) {
        await preparedClaim.recordExecutionSettlementPending("agent-task-post-claim-failure").catch(() => undefined);
        return await this.transition(job.id, "interrupted", "result_pending");
      }
      // A coordinator may durably fence the economic action and then fail
      // before returning its prepared claim (for example while recording
      // lifecycle evidence). Re-read the canonical authority before turning
      // that failure into a terminal task error; a fenced action is always an
      // explicit unknown projection, even when task projection never began.
      if (await this.hasCanonicalDispatchClaim(job)) {
        return await this.transition(job.id, "interrupted", "result_pending");
      }
      if (error instanceof AgentTaskApplicationError) throw error;
      return this.transition(job.id, "failed", "economic_commitment_unavailable");
    }
  }

  private async settleEconomicFenceFailure(
    preparation: Extract<Awaited<ReturnType<ManagedEconomicDispatchCoordinator["prepare"]>>, { readonly status: "prepared" }>,
    reason: string,
  ): Promise<void> {
    try {
      await preparation.recordExecutionSettlementPending(reason);
    } catch (settlementError) {
      throw normalizeStoreError(settlementError);
    }
  }

  private async resolveGovernance(project: TrustedAgentTaskProject): Promise<AgentTaskGovernanceEvidence> {
    let evidence: AgentTaskGovernanceEvidence;
    try { evidence = await this.options.governance.resolve(project); } catch { throw new AgentTaskApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence."); }
    if (evidence.version !== 1 || evidence.authority !== "authoritative" || !isIdentifier(evidence.source) || !isFreshEvidence(evidence, this.clock())) {
      throw new AgentTaskApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
    }
    return evidence;
  }

  private async resolveNativeHarnessDispatchRoute(
    job: AgentTaskRecord,
  ): Promise<AgentTaskNativeHarnessRoute> {
    try {
      const profile = await this.options.profiles.resolve(job.configuredAgentProfileId);
      if (
        !profile
        || profile.kind !== "native-harness"
        || !isValidNativeHarnessProfile(profile)
        || (job.capability !== undefined && !profileSupportsCapability(profile, job.capability.capabilityId))
      ) {
        throw new Error("profile");
      }
      const resolved = await this.options.routes.resolve(profile, {
        invocationId: `agent-task:${job.id}`,
        compositionMode: "execution",
      });
      if (!isValidNativeHarnessRoute(resolved) || !sameNativeHarnessRoute(profile, resolved)) {
        throw new Error("route");
      }
      return resolved;
    } catch {
      throw new AgentTaskApplicationError(
        "identity-revision-conflict",
        "Restore the exact persisted native-harness route acknowledgement before dispatch.",
      );
    }
  }

  /** Re-checks the persisted V15 candidate identity before and after fencing. */
  private async validateCurrentEconomicCandidateIdentity(job: AgentTaskRecord): Promise<void> {
    const dispatch = economicDispatchOf(job);
    let profile: AgentTaskProfile | undefined;
    let resolved: ManagedEconomicCandidateSet | AgentTaskNativeHarnessRoute | undefined;
    try {
      profile = await this.options.profiles.resolve(job.configuredAgentProfileId);
      if (
        !profile
        || profile.kind !== "economic"
        || !isValidEconomicAgentTaskProfile(profile)
        || (job.capability !== undefined && !profileSupportsCapability(profile, job.capability.capabilityId))
      ) throw new Error("profile");
      resolved = await this.options.routes.resolve(profile, {
        invocationId: `agent-task:${job.id}`,
        compositionMode: "execution",
      });
    } catch {
      throw new AgentTaskApplicationError(
        "identity-revision-conflict",
        "Restore the exact V15 managed economic candidate identity before execution.",
      );
    }
    if (!isManagedEconomicCandidateSet(resolved) || !sameManagedEconomicCandidateSet(dispatch.candidateSet, resolved)) {
      throw new AgentTaskApplicationError(
        "identity-revision-conflict",
        "Restore the exact V15 managed economic candidate identity before execution.",
      );
    }
  }

  private async consumeWriteApproval(
    job: AgentTaskRecord,
  ): Promise<ManagedAgentRuntimeConsumedWriteApproval | undefined> {
    if (!isApprovedWriteProfile(job.admissionProfileId)) return undefined;
    if (!job.writeApproval || !this.options.writeApprovals) {
      throw new AgentTaskApplicationError("admission_denied", "Provide a current managed write approval before dispatch.");
    }
    let receipt: ManagedWriteApprovalReceipt | undefined;
    try { receipt = this.options.writeApprovals.inspect(job.writeApproval.approvalId); } catch { receipt = undefined; }
    if (!receipt || !matchesAttachedApproval(job, receipt.binding)) {
      throw new AgentTaskApplicationError("admission_denied", "Provide a current approval for the exact managed write authority.");
    }
    const consumerId = `agent-task:${job.id}`;
    let consumed: ManagedWriteApprovalReceipt;
    if (receipt.state === "consumed" && receipt.consumedBy === consumerId && receipt.consumedAt) {
      consumed = receipt;
    } else if (receipt.state === "issued") {
      try {
        consumed = this.options.writeApprovals.consume({
          approvalId: receipt.approvalId,
          binding: receipt.binding,
          consumerId,
        });
      } catch {
        throw new AgentTaskApplicationError("admission_denied", "Provide a current unconsumed managed write approval before dispatch.");
      }
    } else {
      throw new AgentTaskApplicationError("admission_denied", "Provide a current unconsumed managed write approval before dispatch.");
    }
    const projected = projectApproval(consumed);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.options.store.recordWriteApproval(job.id, projected, this.now());
        return createInternalConsumedWriteApproval(consumed);
      } catch {
        // A store failure may be reported after the durable write completed;
        // retry the same idempotent projection before leaving the job queued.
      }
    }
    throw new AgentTaskApplicationError(
      "job_persistence_unavailable",
      "Reconcile the consumed managed write approval before retrying dispatch.",
    );
  }

  private async reserve(job: AgentTaskRecord): Promise<AgentTaskReservation> {
    try { return await this.options.store.reserve({ job }); } catch (error) { throw normalizeStoreError(error); }
  }

  private async transition(id: string, state: AgentTaskState, diagnostic?: AgentTaskDiagnosticCode, failureEvidence?: AgentTaskFailureEvidence): Promise<AgentTaskRecord> {
    try { return await this.options.store.transition(id, state, diagnostic, this.now(), failureEvidence); } catch (error) { throw normalizeStoreError(error); }
  }

  private async currentJob(id: string): Promise<AgentTaskRecord> {
    const current = await this.options.store.get(id);
    if (!current) throw new AgentTaskApplicationError("unknown_job", "Verify the agent-task identifier.");
    return current;
  }

  private async hasCanonicalDispatchClaim(job: AgentTaskRecord): Promise<boolean> {
    if (job.dispatch.kind === "native-harness") return job.dispatch.dispatchFenceId !== undefined;
    const recovery = this.options.commitmentRecovery ?? this.options.economicCommitment;
    if (!recovery) return false;
    try {
      return recovery.query({ jobId: job.id, economicAttemptId: job.dispatch.economicAttemptId }) === "dispatch-fenced";
    } catch {
      // Unknown authority state cannot prove that cancellation is pre-fence.
      return true;
    }
  }

  private authorizeQuery(context: TrustedAgentTaskQueryContext, job: AgentTaskRecord): void {
    if (!isRecord(context) || !isRecord(context.project) || !isIdentifier(context.project.id) || !isIdentifier(context.callerId)) {
      throw new AgentTaskApplicationError("invalid_request", "Use a trusted caller and project query context.");
    }
    if (job.projectId !== context.project.id || job.callerId !== context.callerId) {
      throw new AgentTaskApplicationError("unauthorized_job", "Use the trusted caller and project that own this managed job.");
    }
  }

  private now(): string {
    const date = this.clock();
    if (Number.isNaN(date.getTime())) throw new AgentTaskApplicationError("invalid_request", "Use a valid clock source.");
    return date.toISOString();
  }
}

type ParsedAgentTaskSubmission = Omit<AgentTaskSubmission, "capability"> & {
  readonly capability?: AgentTaskCapabilityRequest;
};

function parseAgentTaskSubmission(value: unknown): ParsedAgentTaskSubmission {
  if (!isRecord(value) || !hasOnly(value, ["objective", "configuredAgentProfileId", "callerId", "idempotencyKey", "capability", "parent"]) || typeof value.objective !== "string" || typeof value.configuredAgentProfileId !== "string" || typeof value.callerId !== "string" || typeof value.idempotencyKey !== "string") throw new AgentTaskApplicationError("invalid_request", "Provide only the supported managed-work fields.");
  const objective = value.objective.trim(); const configuredAgentProfileId = value.configuredAgentProfileId.trim(); const callerId = value.callerId.trim(); const idempotencyKey = value.idempotencyKey.trim();
  if (objective.length === 0 || objective.length > 12000 || !isIdentifier(configuredAgentProfileId) || !isIdentifier(callerId) || !isIdentifier(idempotencyKey)) throw new AgentTaskApplicationError("invalid_request", "Provide bounded valid managed-work identities and objective.");
  const capability = value.capability === undefined ? undefined : parseAgentTaskCapability(value.capability);
  let parent: AgentTaskSubmission["parent"];
  if (value.parent !== undefined) { if (!isRecord(value.parent) || !hasOnly(value.parent, ["invocationId", "turnId"]) || !isIdentifier(value.parent.invocationId) || !isIdentifier(value.parent.turnId)) throw new AgentTaskApplicationError("invalid_request", "Provide valid parent invocation lineage."); parent = { invocationId: value.parent.invocationId, turnId: value.parent.turnId }; }
  return {
    objective,
    configuredAgentProfileId,
    callerId,
    idempotencyKey,
    ...(capability ? { capability } : {}),
    ...(parent ? { parent } : {}),
  };
}

function parseAgentTaskCapability(value: unknown): AgentTaskCapabilityRequest {
  if (
    !isRecord(value)
    || !hasOnly(value, ["capabilityId", "contract", "input", "inputDigest"])
    || value.capabilityId !== VISION_ANALYZE_CAPABILITY_ID
    || value.contract !== VISION_ANALYZE_CONTRACT
    || (value.inputDigest !== undefined && !isCanonicalHash(value.inputDigest))
  ) {
    throw new AgentTaskApplicationError("invalid_request", "Provide the exact supported capability identity and input.");
  }
  let input: VisionAnalyzeInput;
  try {
    input = parseVisionAnalyzeInput(value.input);
  } catch {
    throw new AgentTaskApplicationError("invalid_request", "Provide a valid bounded vision.analyze input.");
  }
  const inputDigest = digestManagedEconomicValue(input);
  if (value.inputDigest !== undefined && value.inputDigest !== inputDigest) {
    throw new AgentTaskApplicationError("invalid_request", "The capability input digest does not match the validated input.");
  }
  return {
    capabilityId: VISION_ANALYZE_CAPABILITY_ID,
    contract: VISION_ANALYZE_CONTRACT,
    input,
    inputDigest,
  };
}

function capabilityFingerprint(capability: AgentTaskCapabilityRequest): Readonly<Record<string, string>> {
  return {
    capabilityId: capability.capabilityId,
    contract: capability.contract,
    inputDigest: capability.inputDigest,
  };
}

function profileSupportsCapability(profile: AgentTaskProfile, capabilityId: string): boolean {
  return Array.isArray(profile.supportedCapabilityIds)
    && profile.supportedCapabilityIds.includes(capabilityId);
}

function parseCapabilityOutput(
  job: AgentTaskRecord,
  value: unknown,
): AgentTaskResult["capabilityOutput"] {
  if (job.capability === undefined) return undefined;
  if (value === undefined) {
    throw new AgentTaskApplicationError("result_corrupt", "The admitted capability did not return typed output.");
  }
  try {
    const parsed = parseVisionAnalysis(value);
    const requestedUris = new Set(job.capability.input.resourceUris);
    if (parsed.evidenceUris.some((uri) => !requestedUris.has(uri))) {
      throw new AgentTaskApplicationError("result_corrupt", "The capability output cites evidence outside its admitted resources.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof AgentTaskApplicationError) throw error;
    throw new AgentTaskApplicationError("result_corrupt", "Persist only validated vision.analyze output.");
  }
}
function normalizeStoreError(error: unknown): AgentTaskApplicationError { return error instanceof AgentTaskApplicationError ? error : new AgentTaskApplicationError("job_persistence_unavailable", "Restore the agent-task store and retry safely."); }
function economicDispatchOf(job: AgentTaskRecord): Extract<AgentTaskDispatch, { readonly kind: "economic" }> {
  if (job.dispatch.kind !== "economic") {
    throw new AgentTaskApplicationError("identity-revision-conflict", "Persisted managed dispatch is not economic.");
  }
  return job.dispatch;
}

function nativeHarnessActionClaim(
  job: AgentTaskRecord,
  route: AgentTaskNativeHarnessRoute,
  ownerGeneration: string,
): import("./contracts.js").AgentTaskActionClaim {
  return {
    version: 1,
    attemptId: job.run.runId,
    intentFingerprint: digestManagedEconomicValue({
      kind: "agent-task-native-harness-launch",
      jobId: job.id,
    runId: job.run.runId,
    requestFingerprint: job.requestFingerprint,
    admissionId: job.admissionId,
    route,
    }),
    admissionId: job.admissionId,
    admissionBundle: job.admissionBundle,
    ownerGeneration,
    effectIdentity: `agent-task:${route.adapterCapabilityId}:external-launch`,
  };
}

function canonicalAdmissionBundle(value: unknown): EffectiveAuthorityAdmissionBundle | undefined {
  if (!isRecord(value)) return undefined;
  try {
    const normalized = defineEffectiveAuthorityAdmissionBundle(value as unknown as EffectiveAuthorityAdmissionBundle);
    return normalized.admissionId === value.admissionId ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function projectApproval(receipt: ManagedWriteApprovalReceipt): AgentTaskWriteApproval {
  return {
    approvalId: receipt.approvalId,
    state: receipt.state,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    approverId: receipt.approverId,
    ...(receipt.consumedAt ? { consumedAt: receipt.consumedAt } : {}),
    ...(receipt.consumedBy ? { consumedBy: receipt.consumedBy } : {}),
  };
}

function matchesAttachedApproval(job: AgentTaskRecord, binding: ManagedWriteApprovalBinding): boolean {
  if (
    binding.jobId !== job.id
    || binding.projectId !== job.projectId
    || binding.callerId !== job.callerId
    || binding.workItemFingerprint !== job.requestFingerprint
    || binding.configuredAgentProfileId !== job.configuredAgentProfileId
    || binding.admissionProfileId !== job.admissionProfileId
  ) return false;
  if (job.dispatch.kind === "native-harness") {
    return binding.routeId === job.dispatch.routeId
      && binding.providerId === job.dispatch.providerId
      && binding.model === job.dispatch.model
      && binding.adapterCapabilityId === job.dispatch.adapterCapabilityId
      && binding.adapterCapabilityVersion === job.dispatch.adapterCapabilityVersion;
  }
  const candidate = job.dispatch.candidateSet.candidates[0];
  return job.dispatch.candidateSet.candidates.length === 1
    && candidate !== undefined
    && binding.routeId === candidate.routeId
    && binding.providerId === candidate.providerId
    && binding.model === candidate.model
    && binding.adapterCapabilityId === candidate.adapterCapabilityId
    && binding.adapterCapabilityVersion === candidate.adapterCapabilityVersion;
}
