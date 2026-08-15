import { randomUUID } from "node:crypto";
import {
  digestManagedEconomicValue,
  type ManagedAgentCallerAttachmentIdentity,
} from "@kilnai/core";
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
  type AgentTaskDiagnosticCode,
  type AgentTaskDispatch,
  type AgentTaskEconomicFenceResult,
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
  private readonly activeDispatches = new Map<string, AbortController>();

  constructor(private readonly options: AgentTaskApplicationOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.economicAttemptIdGenerator = options.economicAttemptIdGenerator ?? randomUUID;
    this.nativeHarnessDispatchIdGenerator = options.nativeHarnessDispatchIdGenerator ?? randomUUID;
  }

  /**
   * Accepts and durably reserves governed V12 work without crossing an
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
    if (profile.kind === "native-harness") {
      return await this.startNativeHarnessPrecommit(request, project, governance, profile);
    }
    return await this.startEconomicPrecommit(request, project, governance, profile);
  }

  private async startEconomicPrecommit(
    request: AgentTaskSubmission,
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
    if (!isIdentifier(admission.admissionId) || !isIdentifier(admission.source)) {
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
      parent: request.parent,
    });
    const dispatch: Extract<AgentTaskDispatch, { readonly kind: "economic" }> = {
      kind: "economic",
      economicAttemptId: this.newEconomicAttemptId(),
      economicPolicyId: profile.economicPolicyId,
      economicPolicyRevision: profile.economicPolicyRevision,
      constraints,
      candidateSet,
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
      dispatch,
      run: {
        runId: `agent-run:${jobId}`,
        state: awaitingApproval ? "awaiting_approval" : "queued",
        dispatch,
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
    request: AgentTaskSubmission,
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
    if (!isIdentifier(admission.admissionId) || !isIdentifier(admission.source)) {
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
      ...(resolved.deliberationResolution ? { deliberationResolution: resolved.deliberationResolution } : {}),
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
      dispatch,
      run: {
        runId: `agent-run:${jobId}`,
        state: awaitingApproval ? "awaiting_approval" : "queued",
        dispatch,
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
      fenceResult = await this.options.store.fenceNativeHarness(job.id, dispatchFenceId, this.now());
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
    if (abortSignal?.aborted) return await this.currentJob(fenced.id);
    try {
      const execution = await this.options.nativeHarnessExecution.execute({
        job: fenced as AgentTaskRecord & { readonly dispatch: Extract<AgentTaskDispatch, { readonly kind: "native-harness" }> },
        route,
        dispatchFenceId: fenced.dispatch.dispatchFenceId,
        ...(consumedWriteApproval ? { consumedWriteApproval } : {}),
        ...(callerIdentity ? { callerIdentity } : {}),
        ...(abortSignal ? { abortSignal } : {}),
      });
      if (abortSignal?.aborted) return await this.currentJob(fenced.id);
      const selected = fenced.dispatch;
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
        dataPolicyProof: execution.dataPolicyProof,
        ...(execution.writeEvidence ? { writeEvidence: normalizeAgentTaskWriteEvidence(execution.writeEvidence, fenced.id) } : {}),
      };
      return await this.options.store.completeSuccess(fenced.id, result, execution.completedAt);
    } catch (error) {
      if (abortSignal?.aborted) return await this.currentJob(fenced.id);
      const terminal = agentTaskExecutionTerminal(error);
      return this.transition(fenced.id, terminal.state, terminal.diagnostic, terminal.failureEvidence);
    }
  }

  private async commitEconomicAttempt(job: AgentTaskRecord, abortSignal?: AbortSignal): Promise<AgentTaskRecord> {
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
      let consumedWriteApproval: ManagedAgentRuntimeConsumedWriteApproval | undefined;
      const executionProfile = await this.options.profiles.resolve(job.configuredAgentProfileId);
      if (!executionProfile || executionProfile.kind !== "economic") {
        return this.transition(job.id, "failed", "route_unavailable");
      }
      const preparation = await this.options.economicDispatch.prepare({
        jobId: job.id,
        economicAttemptId: dispatch.economicAttemptId,
        intentFingerprint,
        adoption: adopted,
        admissionProfile: job.admissionProfileId,
        authorityProfileId: executionProfile.authorityProfileId,
        invocationId: `agent-task:${job.id}`,
        ...(abortSignal ? { abortSignal } : {}),
        ...(isApprovedWriteProfile(job.admissionProfileId) ? {
          validateAndConsumeApprovalBeforeFence: async () => {
            consumedWriteApproval = await this.consumeWriteApproval(job);
          },
        } : {}),
        validateExecutionProfile: async () => {
          await this.validateCurrentEconomicCandidateIdentity(job);
        },
      });
      if (preparation.status === "denied") {
        return this.transition(job.id, "failed", "economic_commitment_unavailable");
      }
      if (preparation.status === "already-dispatched") return job;
      if (abortSignal?.aborted) {
        await preparation.recordExecutionSettlementPending("agent-task-cancelled-after-fence");
        return await this.currentJob(job.id);
      }
      let fenceResult: AgentTaskEconomicFenceResult;
      try {
        fenceResult = await this.options.store.fenceEconomic(job.id, preparation.dispatchFenceId, this.now());
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
        return await this.currentJob(job.id);
      }
      try {
        const execution = await this.options.economicExecution.execute({
          job: running,
          preparation,
          ...(consumedWriteApproval ? { consumedWriteApproval } : {}),
        });
        if (abortSignal?.aborted) return await this.currentJob(job.id);
        const selected = preparation.commitment.reservation.selectedIdentity.route;
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
          dataPolicyProof: execution.dataPolicyProof,
          ...(execution.writeEvidence ? { writeEvidence: normalizeAgentTaskWriteEvidence(execution.writeEvidence, job.id) } : {}),
        };
        return await this.options.store.completeSuccess(job.id, result, execution.completedAt);
      } catch (error) {
        await preparation.recordExecutionSettlementPending("agent-task-execution-failed");
        if (abortSignal?.aborted) return await this.currentJob(job.id);
        const terminal = agentTaskExecutionTerminal(error);
        return this.transition(job.id, terminal.state, terminal.diagnostic, terminal.failureEvidence);
      }
    } catch (error) {
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
      if (!profile || profile.kind !== "native-harness" || !isValidNativeHarnessProfile(profile)) {
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

  /** Re-checks the persisted V12 candidate identity before and after fencing. */
  private async validateCurrentEconomicCandidateIdentity(job: AgentTaskRecord): Promise<void> {
    const dispatch = economicDispatchOf(job);
    let profile: AgentTaskProfile | undefined;
    let resolved: ManagedEconomicCandidateSet | AgentTaskNativeHarnessRoute | undefined;
    try {
      profile = await this.options.profiles.resolve(job.configuredAgentProfileId);
      if (!profile || profile.kind !== "economic") throw new Error("profile");
      resolved = await this.options.routes.resolve(profile, {
        invocationId: `agent-task:${job.id}`,
        compositionMode: "execution",
      });
    } catch {
      throw new AgentTaskApplicationError(
        "identity-revision-conflict",
        "Restore the exact V12 managed economic candidate identity before execution.",
      );
    }
    if (!isManagedEconomicCandidateSet(resolved) || !sameManagedEconomicCandidateSet(dispatch.candidateSet, resolved)) {
      throw new AgentTaskApplicationError(
        "identity-revision-conflict",
        "Restore the exact V12 managed economic candidate identity before execution.",
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

function parseAgentTaskSubmission(value: unknown): AgentTaskSubmission {
  if (!isRecord(value) || !hasOnly(value, ["objective", "configuredAgentProfileId", "callerId", "idempotencyKey", "parent"]) || typeof value.objective !== "string" || typeof value.configuredAgentProfileId !== "string" || typeof value.callerId !== "string" || typeof value.idempotencyKey !== "string") throw new AgentTaskApplicationError("invalid_request", "Provide only the supported managed-work fields.");
  const objective = value.objective.trim(); const configuredAgentProfileId = value.configuredAgentProfileId.trim(); const callerId = value.callerId.trim(); const idempotencyKey = value.idempotencyKey.trim();
  if (objective.length === 0 || objective.length > 12000 || !isIdentifier(configuredAgentProfileId) || !isIdentifier(callerId) || !isIdentifier(idempotencyKey)) throw new AgentTaskApplicationError("invalid_request", "Provide bounded valid managed-work identities and objective.");
  let parent: AgentTaskSubmission["parent"];
  if (value.parent !== undefined) { if (!isRecord(value.parent) || !hasOnly(value.parent, ["invocationId", "turnId"]) || !isIdentifier(value.parent.invocationId) || !isIdentifier(value.parent.turnId)) throw new AgentTaskApplicationError("invalid_request", "Provide valid parent invocation lineage."); parent = { invocationId: value.parent.invocationId, turnId: value.parent.turnId }; }
  return { objective, configuredAgentProfileId, callerId, idempotencyKey, ...(parent ? { parent } : {}) };
}
function normalizeStoreError(error: unknown): AgentTaskApplicationError { return error instanceof AgentTaskApplicationError ? error : new AgentTaskApplicationError("job_persistence_unavailable", "Restore the agent-task store and retry safely."); }
function economicDispatchOf(job: AgentTaskRecord): Extract<AgentTaskDispatch, { readonly kind: "economic" }> {
  if (job.dispatch.kind !== "economic") {
    throw new AgentTaskApplicationError("identity-revision-conflict", "Persisted managed dispatch is not economic.");
  }
  return job.dispatch;
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
