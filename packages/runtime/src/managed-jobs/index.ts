import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  defineManagedAccountLeaseEvidence,
  type ManagedAccountLeaseEvidence,
  type ManagedAgentAuthorityProfile,
  type ManagedAgentCapabilitySnapshotInput,
  type ManagedAgentInvocationRequest,
  type ManagedAgentResultHandoff,
} from "@kilnai/core";
import {
  ManagedAccountLeaseUnavailableError,
  RuntimeManagedAgentInvocationService,
} from "../agents/managed-invocation/index.js";
import type { ManagedAgentRuntimeAdapter } from "../agents/managed-invocation/index.js";

export const MANAGED_JOB_STATES = ["queued", "running", "succeeded", "failed", "timed_out", "interrupted", "cancelled"] as const;
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
  | "job_persistence_unavailable"
  | "job_persistence_corrupt"
  | "unknown_job"
  | "invalid_transition"
  | "provider_rejected"
  | "provider_timeout"
  | "account_lease_unavailable"
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

/** Operator-configured child identity; it requests a specific canonical route. */
export interface ManagedJobProfile {
  readonly id: string;
  readonly routeId: string;
}
export interface ManagedJobRoute {
  readonly id: string;
  readonly accountPolicyId: string;
  readonly admissionProfileId: string;
  readonly supportedAdmissionProfileIds: readonly string[];
  readonly providerId: string;
  readonly timeoutSource: "default" | "explicit-route";
  /** Canonical route evidence, validated before a managed job may be reserved. */
  readonly scope: {
    readonly project: "validated";
    readonly read: "validated";
    readonly tools: "validated";
    readonly network: "validated";
    readonly write: "validated";
  };
  readonly eligibility: {
    readonly authority: "authoritative";
    readonly observedAt: string;
    readonly validUntil: string;
  };
  readonly authority: ManagedAgentAuthorityProfile;
}

interface ManagedJobRecordBase {
  readonly id: string;
  readonly state: ManagedJobState;
  readonly projectId: string;
  readonly configuredAgentProfileId: string;
  readonly admissionProfileId: string;
  readonly routeId: string;
  readonly providerId: string;
  readonly governanceSource: string;
  readonly admissionId: string;
  readonly timeoutSource: ManagedJobRoute["timeoutSource"];
  readonly requestFingerprint: string;
  readonly idempotencyKeyHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly parent?: { readonly invocationId: string; readonly turnId: string };
  readonly diagnostic?: ManagedJobDiagnosticCode;
}

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
}

export interface ManagedJobRecordV3 extends ManagedJobRecordBase {
  readonly version: 3;
  readonly callerId: string;
  readonly result?: ManagedJobResult;
  readonly lifecycle: readonly ManagedJobLifecycleEntry[];
}

export interface ManagedJobRecordV4 extends Omit<ManagedJobRecordV3, "version"> {
  readonly version: 4;
  readonly accountLease?: ManagedAccountLeaseEvidence;
  readonly accountLeaseHistory: readonly ManagedAccountLeaseEvidence[];
}

export type ManagedJobRecord = ManagedJobRecordV3 | ManagedJobRecordV4;
export type ManagedJobResultAvailability = "pending" | "available" | "unavailable" | "failed" | "unresolved";
export interface ManagedJobResultQuery {
  readonly jobId: string;
  readonly availability: ManagedJobResultAvailability;
  readonly lifecycleState: ManagedJobState;
  readonly configuredAgentProfileId: string;
  readonly admissionProfileId: string;
  readonly routeId: string;
  readonly providerId: string;
  readonly completedAt?: string;
  readonly provenance?: ManagedJobResult["provenance"];
  readonly handoff?: ManagedAgentResultHandoff;
  readonly diagnostic?: ManagedJobDiagnosticCode;
  readonly accountLease?: ManagedAccountLeaseEvidence;
}

export interface ManagedJobReplayQuery {
  readonly jobId: string;
  readonly availability: "available" | "unavailable";
  readonly lifecycleState: ManagedJobState;
  readonly configuredAgentProfileId: string;
  readonly admissionProfileId: string;
  readonly routeId: string;
  readonly providerId: string;
  readonly lifecycle: readonly ManagedJobLifecycleEntry[];
  readonly resultAvailability: ManagedJobResultAvailability;
  readonly diagnostic?: ManagedJobDiagnosticCode;
  readonly accountLease?: ManagedAccountLeaseEvidence;
  readonly accountLeaseHistory: readonly ManagedAccountLeaseEvidence[];
}

export interface ManagedJobProjectPort { resolve(): Promise<TrustedManagedJobProject>; }
export interface ManagedJobGovernancePort {
  resolve(project: TrustedManagedJobProject): Promise<ManagedJobGovernanceEvidence>;
  admit(input: { readonly project: TrustedManagedJobProject; readonly objective: string; readonly configuredAgentProfileId: string; readonly admissionProfileId: string; readonly evidence: ManagedJobGovernanceEvidence }): Promise<{ readonly admitted: true; readonly admissionId: string; readonly source: string } | { readonly admitted: false }>;
}
export interface ManagedJobProfilePort { resolve(id: string): Promise<ManagedJobProfile | undefined>; }
export interface ManagedJobRoutePort { resolve(profile: ManagedJobProfile): Promise<ManagedJobRoute | undefined>; }
export interface ManagedJobRuntimeInvocationPort {
  invoke(input: { readonly jobId: string; readonly project: TrustedManagedJobProject; readonly objective: string; readonly profile: ManagedJobProfile; readonly route: ManagedJobRoute; readonly parent?: ManagedJobSubmission["parent"]; readonly accountLeaseObserver: (evidence: ManagedAccountLeaseEvidence) => Promise<void> }): Promise<
    | { readonly state: "succeeded"; readonly result?: ManagedJobRuntimeResult }
    | { readonly state: "failed" | "timed_out" }
  >;
  cancel?(input: { readonly jobId: string; readonly reason: string }): Promise<void>;
}
/** Safe Runtime completion evidence; it deliberately excludes record transcripts, prompts, diagnostics, and provider payloads. */
export interface ManagedJobRuntimeResult {
  readonly runtimeInvocationId: string;
  readonly configuredAgentProfileId: string;
  readonly admissionProfileId: string;
  readonly routeId: string;
  readonly providerId: string;
  readonly terminalState: "completed";
  readonly resultHandoff: ManagedAgentResultHandoff;
}
export interface ManagedJobRuntimeInvocationResolver {
  resolve(input: Parameters<ManagedJobRuntimeInvocationPort["invoke"]>[0]): Promise<{
    readonly request: ManagedAgentInvocationRequest;
    readonly adapter: ManagedAgentRuntimeAdapter;
    readonly capabilitySnapshot: ManagedAgentCapabilitySnapshotInput;
  }>;
}

/** Connects the application boundary to Runtime's existing managed-agent owner. */
export function createRuntimeManagedJobInvocationPort(input: {
  readonly service: RuntimeManagedAgentInvocationService;
  readonly resolver: ManagedJobRuntimeInvocationResolver;
}): ManagedJobRuntimeInvocationPort {
  return {
    async invoke(invocation) {
      const resolved = await input.resolver.resolve(invocation);
      if (resolved.request.invocationId !== invocation.jobId) throw new ManagedJobApplicationError("invocation_failed", "Bind the Runtime invocation identity to the canonical managed-job identifier.");
      const result = await input.service.invoke(
        resolved.request,
        resolved.adapter,
        resolved.capabilitySnapshot,
        {
          accountLeaseObserver: invocation.accountLeaseObserver,
        },
      ).catch((error: unknown) => {
        if (error instanceof ManagedAccountLeaseUnavailableError) {
          throw new ManagedJobApplicationError(
            "account_lease_unavailable",
            "Wait for managed account settlement or repair account eligibility evidence.",
          );
        }
        throw error;
      });
      if (result.status === "denied") throw new ManagedJobApplicationError("provider_rejected", "Review the Runtime managed-agent admission diagnostic.");
      const record = result.record;
      return {
        state: result.record.lifecycleState === "completed" ? "succeeded"
          : result.record.lifecycleState === "timed_out" ? "timed_out"
            : "failed",
        ...(record.lifecycleState === "completed" && record.resultHandoff !== undefined
          ? {
              result: {
                runtimeInvocationId: record.invocationId,
                configuredAgentProfileId: invocation.profile.id,
                admissionProfileId: record.profile,
                routeId: record.capabilitySnapshot.routeId,
                providerId: record.providerRoute.providerId,
                terminalState: "completed" as const,
                resultHandoff: record.resultHandoff,
              },
            }
          : {}),
      };
    },
    async cancel(cancellation) {
      await input.service.cancel(cancellation.jobId, cancellation.reason);
    },
  };
}

export type ManagedJobReservation =
  | { readonly kind: "created"; readonly job: ManagedJobRecord }
  | { readonly kind: "existing"; readonly job: ManagedJobRecord }
  | { readonly kind: "conflict" };

export interface ManagedJobStore {
  reserve(input: { readonly job: ManagedJobRecord }): Promise<ManagedJobReservation>;
  get(id: string): Promise<ManagedJobRecord | undefined>;
  transition(id: string, state: ManagedJobState, diagnostic?: ManagedJobDiagnosticCode, updatedAt?: string): Promise<ManagedJobRecord>;
  completeSuccess(id: string, result: ManagedJobResult, updatedAt?: string): Promise<ManagedJobRecord>;
  recordAccountLease(id: string, evidence: ManagedAccountLeaseEvidence, updatedAt?: string): Promise<ManagedJobRecord>;
  listNonterminal(): Promise<readonly ManagedJobRecord[]>;
}

export interface ManagedJobApplicationOptions {
  readonly project: ManagedJobProjectPort;
  readonly governance: ManagedJobGovernancePort;
  readonly profiles: ManagedJobProfilePort;
  readonly routes: ManagedJobRoutePort;
  readonly runtime: ManagedJobRuntimeInvocationPort;
  readonly lineage?: { validate(input: { readonly project: TrustedManagedJobProject; readonly callerId: string; readonly parent: NonNullable<ManagedJobSubmission["parent"]> }): Promise<boolean> };
  readonly store: ManagedJobStore;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
}

export class ManagedJobApplicationService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly activeExecutions = new Map<string, Promise<ManagedJobRecord>>();

  constructor(private readonly options: ManagedJobApplicationOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  async submit(input: unknown): Promise<ManagedJobRecord> {
    const started = await this.start(input);
    const active = this.activeExecutions.get(started.id);
    if (active) return active;
    return await this.options.store.get(started.id) ?? started;
  }

  async start(input: unknown): Promise<ManagedJobRecord> {
    const request = parseManagedJobSubmission(input);
    const project = await this.resolveProject();
    if (request.parent && (!this.options.lineage || !await this.validateLineage(project, request))) throw new ManagedJobApplicationError("invalid_request", "Provide trusted parent invocation lineage.");
    const governance = await this.resolveGovernance(project);
    let profile: ManagedJobProfile | undefined;
    try { profile = await this.options.profiles.resolve(request.configuredAgentProfileId); } catch { throw new ManagedJobApplicationError("profile_unavailable", "Choose a configured admitted agent profile."); }
    if (!profile) throw new ManagedJobApplicationError("profile_unavailable", "Choose a configured admitted agent profile.");
    if (!isIdentifier(profile.id) || profile.id !== request.configuredAgentProfileId || !isIdentifier(profile.routeId)) throw new ManagedJobApplicationError("profile_unavailable", "Choose a configured admitted agent profile.");
    let route: ManagedJobRoute | undefined;
    try { route = await this.options.routes.resolve(profile); } catch { throw new ManagedJobApplicationError("route_unavailable", "Configure an admitted managed-agent route."); }
    if (!route || !isAdmittedRoute(route, profile, this.clock())) throw new ManagedJobApplicationError("route_unavailable", "Configure an admitted managed-agent route.");
    let admission: Awaited<ReturnType<ManagedJobGovernancePort["admit"]>>;
    try { admission = await this.options.governance.admit({ project, objective: request.objective, configuredAgentProfileId: profile.id, admissionProfileId: route.admissionProfileId, evidence: governance }); }
    catch { throw new ManagedJobApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence."); }
    if (!admission.admitted) throw new ManagedJobApplicationError("admission_denied", "Review the authoritative work-governance policy.");
    if (!isIdentifier(admission.admissionId) || !isIdentifier(admission.source)) throw new ManagedJobApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");

    const now = this.now();
    const requestFingerprint = fingerprint({ objective: request.objective, configuredAgentProfileId: request.configuredAgentProfileId, parent: request.parent });
    const job: ManagedJobRecordV4 = {
      version: 4,
      id: this.newJobId(),
      state: "queued",
      projectId: project.id,
      callerId: request.callerId,
      configuredAgentProfileId: profile.id,
      admissionProfileId: route.admissionProfileId,
      routeId: route.id,
      providerId: route.providerId,
      governanceSource: admission.source,
      admissionId: admission.admissionId,
      timeoutSource: route.timeoutSource,
      requestFingerprint,
      idempotencyKeyHash: fingerprint({ projectId: project.id, callerId: request.callerId, idempotencyKey: request.idempotencyKey }),
      createdAt: now,
      updatedAt: now,
      lifecycle: [{ sequence: 1, state: "queued", observedAt: now }],
      accountLeaseHistory: [],
      ...(request.parent ? { parent: request.parent } : {}),
    };
    const reservation = await this.reserve(job);
    if (reservation.kind === "conflict") throw new ManagedJobApplicationError("idempotency_conflict", "Use a new idempotency identity for different managed work.");
    if (reservation.kind === "existing") return reservation.job;

    const running = await this.transition(job.id, "running");
    const execution = this.execute(running, project, request, profile, route);
    this.activeExecutions.set(running.id, execution);
    void execution.finally(() => {
      if (this.activeExecutions.get(running.id) === execution) this.activeExecutions.delete(running.id);
    }).catch(() => undefined);
    return running;
  }

  private async execute(
    running: ManagedJobRecord,
    project: TrustedManagedJobProject,
    request: ManagedJobSubmission,
    profile: ManagedJobProfile,
    route: ManagedJobRoute,
  ): Promise<ManagedJobRecord> {
    try {
      const result = await this.options.runtime.invoke({
        jobId: running.id,
        project,
        objective: request.objective,
        profile,
        route,
        accountLeaseObserver: async (evidence) => {
          await this.options.store.recordAccountLease(running.id, evidence, this.now());
        },
        ...(request.parent ? { parent: request.parent } : {}),
      });
      const current = await this.options.store.get(running.id);
      if (current?.state === "cancelled") return current;
      if (current?.version !== 4 || current.accountLease === undefined) {
        return this.transition(running.id, "failed", "account_lease_unavailable");
      }
      if (result.state === "succeeded") {
        if (!result.result) return this.transition(running.id, "failed", "result_persistence_failure");
        return await this.completeSuccess(running, result.result, request.objective);
      }
      return this.transition(running.id, result.state, result.state === "timed_out" ? "provider_timeout" : "provider_rejected");
    } catch (error) {
      const current = await this.options.store.get(running.id).catch(() => undefined);
      if (current?.state === "cancelled") return current;
      const diagnostic = error instanceof ManagedJobApplicationError ? error.code : "invocation_failed";
      return this.transition(running.id, diagnostic === "provider_timeout" ? "timed_out" : "failed", diagnostic);
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
    const reason = "Operator cancelled managed work.";
    try {
      if (!this.options.runtime.cancel) throw new Error("cancellation unavailable");
      await this.options.runtime.cancel({ jobId: id, reason });
    } catch {
      throw new ManagedJobApplicationError("invocation_failed", "Retry cancellation while the managed Runtime invocation is active.");
    }
    return this.transition(id, "cancelled", "cancelled");
  }

  async getReplay(context: TrustedManagedJobQueryContext, id: string): Promise<ManagedJobReplayQuery> {
    const job = await this.getStatus(context, id);
    if (job.version !== 3 && job.version !== 4) {
      return replayQuery(job, "unavailable", [], "replay_unavailable");
    }
    return replayQuery(job, "available", job.lifecycle);
  }

  async recoverInterrupted(): Promise<readonly ManagedJobRecord[]> {
    try {
      const jobs = await this.options.store.listNonterminal();
      return Promise.all(jobs.map((job) => this.transition(job.id, "interrupted", "invocation_failed")));
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

  private async resolveGovernance(project: TrustedManagedJobProject): Promise<ManagedJobGovernanceEvidence> {
    let evidence: ManagedJobGovernanceEvidence;
    try { evidence = await this.options.governance.resolve(project); } catch { throw new ManagedJobApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence."); }
    if (evidence.version !== 1 || evidence.authority !== "authoritative" || !isIdentifier(evidence.source) || !isFreshEvidence(evidence, this.clock())) {
      throw new ManagedJobApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
    }
    return evidence;
  }

  private async reserve(job: ManagedJobRecord): Promise<ManagedJobReservation> {
    try { return await this.options.store.reserve({ job }); } catch (error) { throw normalizeStoreError(error); }
  }

  private async transition(id: string, state: ManagedJobState, diagnostic?: ManagedJobDiagnosticCode): Promise<ManagedJobRecord> {
    try { return await this.options.store.transition(id, state, diagnostic, this.now()); } catch (error) { throw normalizeStoreError(error); }
  }

  private async completeSuccess(job: ManagedJobRecord, runtimeResult: ManagedJobRuntimeResult, objective: string): Promise<ManagedJobRecord> {
    const completedAt = this.now();
    const result = createManagedJobResult(job, runtimeResult, completedAt, objective);
    try { return await this.options.store.completeSuccess(job.id, result, completedAt); } catch (error) { throw normalizeStoreError(error); }
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
  async reserve(input: { readonly job: ManagedJobRecord }): Promise<ManagedJobReservation> {
    const binding = this.bindings.get(input.job.idempotencyKeyHash);
    if (binding) {
      if (binding.fingerprint !== input.job.requestFingerprint) return { kind: "conflict" };
      const job = this.jobs.get(binding.jobId);
      if (!job) throw new ManagedJobApplicationError("job_persistence_corrupt", "Repair the managed-job store before retrying.");
      return { kind: "existing", job: cloneManagedJob(job) };
    }
    this.jobs.set(input.job.id, cloneManagedJob(input.job));
    this.bindings.set(input.job.idempotencyKeyHash, { fingerprint: input.job.requestFingerprint, jobId: input.job.id });
    return { kind: "created", job: cloneManagedJob(input.job) };
  }
  async get(id: string): Promise<ManagedJobRecord | undefined> { const job = this.jobs.get(id); return job ? cloneManagedJob(job) : undefined; }
  async transition(id: string, state: ManagedJobState, diagnostic?: ManagedJobDiagnosticCode, updatedAt?: string): Promise<ManagedJobRecord> {
    const current = this.jobs.get(id);
    if (!current) throw new ManagedJobApplicationError("unknown_job", "Verify the managed-job identifier.");
    if (!canTransition(current.state, state)) throw new ManagedJobApplicationError("invalid_transition", "Keep terminal managed-job states immutable.");
    const timestamp = updatedAt ?? new Date().toISOString();
    if (!isIso(timestamp) || Date.parse(timestamp) < Date.parse(current.updatedAt)) throw new ManagedJobApplicationError("invalid_transition", "Use monotonic managed-job timestamps.");
    const next: ManagedJobRecord = {
      ...current,
      state,
      updatedAt: timestamp,
      lifecycle: [...current.lifecycle, lifecycleEntry(current.lifecycle.length + 1, state, timestamp, diagnostic)],
      ...(diagnostic ? { diagnostic } : {}),
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
    const next: ManagedJobRecordV3 | ManagedJobRecordV4 = {
      ...current,
      state: "succeeded",
      result,
      updatedAt: timestamp,
      lifecycle: [...current.lifecycle, lifecycleEntry(current.lifecycle.length + 1, "succeeded", timestamp)],
    };
    this.jobs.set(id, next);
    return cloneManagedJob(next);
  }
  async recordAccountLease(id: string, evidence: ManagedAccountLeaseEvidence, updatedAt?: string): Promise<ManagedJobRecord> {
    const current = this.jobs.get(id);
    if (!current) throw new ManagedJobApplicationError("unknown_job", "Verify the managed-job identifier.");
    if (current.version !== 4) throw new ManagedJobApplicationError("invalid_transition", "Account lease evidence requires a canonical V4 managed job.");
    const canonical = defineManagedAccountLeaseEvidence(evidence);
    if (canonical.jobId !== current.id || canonical.runtimeInvocationId !== current.id) {
      throw new ManagedJobApplicationError("invalid_transition", "Bind account lease evidence to the canonical managed-job identity.");
    }
    if (current.accountLease && !sameManagedAccountLeaseIdentity(current.accountLease, canonical)) {
      throw new ManagedJobApplicationError("invalid_transition", "Keep one immutable account selection per managed job.");
    }
    if (current.accountLease && JSON.stringify(current.accountLease) === JSON.stringify(canonical)) {
      return cloneManagedJob(current);
    }
    if (current.accountLease && !isValidManagedAccountLeaseTransition(current.accountLease, canonical)) {
      throw new ManagedJobApplicationError("invalid_transition", "Keep managed account lease evidence monotonic and terminal states immutable.");
    }
    const timestamp = updatedAt ?? new Date().toISOString();
    if (!isIso(timestamp) || Date.parse(timestamp) < Date.parse(current.updatedAt)) {
      throw new ManagedJobApplicationError("invalid_transition", "Use monotonic managed-job timestamps.");
    }
    const next: ManagedJobRecordV4 = {
      ...current,
      accountLease: canonical,
      accountLeaseHistory: [...current.accountLeaseHistory, canonical],
      updatedAt: timestamp,
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
  async get(id: string): Promise<ManagedJobRecord | undefined> { return (await this.loadMemory()).get(id); }
  async transition(id: string, state: ManagedJobState, diagnostic?: ManagedJobDiagnosticCode, updatedAt?: string): Promise<ManagedJobRecord> {
    return this.withLock(async () => { const memory = await this.loadMemory(); const job = await memory.transition(id, state, diagnostic, updatedAt); await this.saveMemory(memory); return job; });
  }
  async completeSuccess(id: string, result: ManagedJobResult, updatedAt?: string): Promise<ManagedJobRecord> {
    return this.withLock(async () => { const memory = await this.loadMemory(); const job = await memory.completeSuccess(id, result, updatedAt); await this.saveMemory(memory); return job; });
  }
  async recordAccountLease(id: string, evidence: ManagedAccountLeaseEvidence, updatedAt?: string): Promise<ManagedJobRecord> {
    return this.withLock(async () => { const memory = await this.loadMemory(); const job = await memory.recordAccountLease(id, evidence, updatedAt); await this.saveMemory(memory); return job; });
  }
  async listNonterminal(): Promise<readonly ManagedJobRecord[]> { return (await this.loadMemory()).listNonterminal(); }
  private async loadMemory(): Promise<InMemoryManagedJobStore> {
    const memory = new InMemoryManagedJobStore();
    try {
      const parsed = JSON.parse(await readFile(resolve(this.root, "managed-jobs.json"), "utf8")) as unknown;
      if (!Array.isArray(parsed)) throw new Error("corrupt");
      for (const job of parsed) {
        const validated = validateStoredJob(job);
        const reservation = await memory.reserve({ job: validated });
        if (reservation.kind !== "created") throw new Error("corrupt");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof SyntaxError || error instanceof ManagedJobApplicationError) throw new ManagedJobApplicationError("job_persistence_corrupt", "Repair the managed-job store before retrying.");
        throw new ManagedJobApplicationError("job_persistence_unavailable", "Restore the managed-job store and retry safely.");
      }
    }
    return memory;
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
function validateStoredJob(value: unknown): ManagedJobRecord {
  const base = ["version", "id", "state", "projectId", "configuredAgentProfileId", "admissionProfileId", "routeId", "providerId", "governanceSource", "admissionId", "timeoutSource", "requestFingerprint", "idempotencyKeyHash", "createdAt", "updatedAt", "parent", "diagnostic"];
  const allowed = value && isRecord(value) && value.version === 4
    ? [...base, "callerId", "result", "lifecycle", "accountLease", "accountLeaseHistory"]
    : [...base, "callerId", "result", "lifecycle"];
  if (!isRecord(value) || !hasOnly(value, allowed) || (value.version !== 3 && value.version !== 4) || !isIdentifier(value.id) || !MANAGED_JOB_STATES.includes(value.state as ManagedJobState) || !isIdentifier(value.projectId) || !isIdentifier(value.configuredAgentProfileId) || !isIdentifier(value.admissionProfileId) || !isIdentifier(value.routeId) || !isIdentifier(value.providerId) || !isIdentifier(value.governanceSource) || !isIdentifier(value.admissionId) || (value.timeoutSource !== "default" && value.timeoutSource !== "explicit-route") || !isHash(value.requestFingerprint) || !isHash(value.idempotencyKeyHash) || !isIso(value.createdAt) || !isIso(value.updatedAt) || Date.parse(value.createdAt) > Date.parse(value.updatedAt) || (value.parent !== undefined && (!isRecord(value.parent) || !hasOnly(value.parent, ["invocationId", "turnId"]) || !isIdentifier(value.parent.invocationId) || !isIdentifier(value.parent.turnId))) || (value.diagnostic !== undefined && !isDiagnostic(value.diagnostic))) throw new ManagedJobApplicationError("job_persistence_corrupt", "Repair the managed-job store before retrying.");
  if (!isIdentifier(value.callerId) || (value.result !== undefined && !isValidManagedJobResult(value.result, value as unknown as ManagedJobRecord, value.updatedAt)) || (value.state === "succeeded" && value.result === undefined) || (value.state !== "succeeded" && value.result !== undefined)) {
    throw new ManagedJobApplicationError("job_persistence_corrupt", "Repair the managed-job store before retrying.");
  }
  if (!isValidLifecycle(value.lifecycle, value.state as ManagedJobState, value.createdAt, value.updatedAt)) {
    throw new ManagedJobApplicationError("job_persistence_corrupt", "Repair the managed-job store before retrying.");
  }
  if (value.version === 4 && !isValidManagedAccountLeaseHistory(value.accountLease, value.accountLeaseHistory, value.id)) {
    throw new ManagedJobApplicationError("job_persistence_corrupt", "Repair the managed-job store before retrying.");
  }
  return value as unknown as ManagedJobRecord;
}
function normalizeStoreError(error: unknown): ManagedJobApplicationError { return error instanceof ManagedJobApplicationError ? error : new ManagedJobApplicationError("job_persistence_unavailable", "Restore the managed-job store and retry safely."); }
function canTransition(from: ManagedJobState, to: ManagedJobState): boolean { if (from === to) return false; if (from === "queued") return to === "running" || to === "interrupted" || to === "cancelled"; return from === "running" && (to === "succeeded" || to === "failed" || to === "timed_out" || to === "interrupted" || to === "cancelled"); }
function lifecycleEntry(sequence: number, state: ManagedJobState, observedAt: string, diagnostic?: ManagedJobDiagnosticCode): ManagedJobLifecycleEntry {
  return { sequence, state, observedAt, ...(diagnostic ? { diagnostic } : {}) };
}
function isValidLifecycle(value: unknown, state: ManagedJobState, createdAt: string, updatedAt: string): value is readonly ManagedJobLifecycleEntry[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  let previousTime = Number.NEGATIVE_INFINITY;
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry) || !hasOnly(entry, ["sequence", "state", "observedAt", "diagnostic"]) || entry.sequence !== index + 1 || !MANAGED_JOB_STATES.includes(entry.state as ManagedJobState) || !isIso(entry.observedAt) || (entry.diagnostic !== undefined && !isDiagnostic(entry.diagnostic))) return false;
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
function isValidManagedAccountLeaseHistory(
  current: unknown,
  history: unknown,
  jobId: string,
): boolean {
  if (!Array.isArray(history)) return false;
  if (history.length === 0) return current === undefined;
  try {
    const canonical = history.map((entry) => defineManagedAccountLeaseEvidence(entry as ManagedAccountLeaseEvidence));
    if (canonical.some((entry) => entry.jobId !== jobId || entry.runtimeInvocationId !== jobId)) return false;
    if (canonical.some((entry) => !sameManagedAccountLeaseIdentity(canonical[0]!, entry))) return false;
    for (let index = 1; index < canonical.length; index += 1) {
      if (!isValidManagedAccountLeaseTransition(canonical[index - 1]!, canonical[index]!)) return false;
    }
    if (current === undefined) return false;
    const canonicalCurrent = defineManagedAccountLeaseEvidence(current as ManagedAccountLeaseEvidence);
    return JSON.stringify(canonicalCurrent) === JSON.stringify(canonical[canonical.length - 1]);
  } catch {
    return false;
  }
}
function isValidManagedAccountLeaseTransition(
  previous: ManagedAccountLeaseEvidence,
  next: ManagedAccountLeaseEvidence,
): boolean {
  if (
    JSON.stringify(previous) === JSON.stringify(next)
    || previous.acquiredAt !== next.acquiredAt
    || previous.selectionReason !== next.selectionReason
    || previous.affinityOutcome !== next.affinityOutcome
    || JSON.stringify(previous.candidateRejections) !== JSON.stringify(next.candidateRejections)
    || JSON.stringify(previous.usageEvidence) !== JSON.stringify(next.usageEvidence)
    || JSON.stringify(previous.resourceUris) !== JSON.stringify(next.resourceUris)
    || previous.diagnosticUris.some((uri) => !next.diagnosticUris.includes(uri))
    || (
      previous.lifecycleState === next.lifecycleState
      && next.diagnosticUris.length <= previous.diagnosticUris.length
    )
  ) {
    return false;
  }
  const allowed: Readonly<Record<ManagedAccountLeaseEvidence["lifecycleState"], readonly ManagedAccountLeaseEvidence["lifecycleState"][]>> = {
    held: ["settlement-pending", "released", "release-failed", "leaked"],
    "settlement-pending": ["settlement-pending", "released", "release-failed", "leaked"],
    released: [],
    "release-failed": [],
    leaked: [],
  };
  return allowed[previous.lifecycleState].includes(next.lifecycleState);
}
function sameManagedAccountLeaseIdentity(
  left: ManagedAccountLeaseEvidence,
  right: ManagedAccountLeaseEvidence,
): boolean {
  return left.leaseId === right.leaseId
    && left.accountPolicyId === right.accountPolicyId
    && left.accountRef === right.accountRef
    && left.jobId === right.jobId
    && left.runtimeInvocationId === right.runtimeInvocationId
    && left.credentialRevisionId === right.credentialRevisionId
    && left.route.providerId === right.route.providerId
    && left.route.providerModelId === right.route.providerModelId
    && left.route.scope === right.route.scope;
}
function isFreshEvidence(value: ManagedJobGovernanceEvidence, now: Date): boolean { return isIso(value.issuedAt) && isIso(value.validUntil) && Date.parse(value.issuedAt) <= now.getTime() && now.getTime() <= Date.parse(value.validUntil); }
function isAdmittedRoute(route: ManagedJobRoute, profile: ManagedJobProfile, now: Date): boolean {
  return isIdentifier(route.id)
    && isIdentifier(route.accountPolicyId)
    && route.id === profile.routeId
    && isIdentifier(route.admissionProfileId)
    && route.supportedAdmissionProfileIds.every(isIdentifier)
    && route.supportedAdmissionProfileIds.includes(route.admissionProfileId)
    && isIdentifier(route.providerId)
    && route.scope.project === "validated"
    && route.scope.read === "validated"
    && route.scope.tools === "validated"
    && route.scope.network === "validated"
    && route.scope.write === "validated"
    && route.eligibility.authority === "authoritative"
    && isFreshRouteEligibility(route.eligibility, now)
    && isBoundedRouteAuthority(route.authority);
}
function isFreshRouteEligibility(value: ManagedJobRoute["eligibility"], now: Date): boolean { return isIso(value.observedAt) && isIso(value.validUntil) && Date.parse(value.observedAt) <= now.getTime() && now.getTime() <= Date.parse(value.validUntil); }
function isBoundedRouteAuthority(value: ManagedAgentAuthorityProfile): boolean {
  return isIdentifier(value.authorityProfileId)
    && isIdentifier(value.permissionProfile)
    && value.toolAuthority.allowedToolNames.length > 0
    && value.toolAuthority.allowedToolNames.every(isIdentifier)
    && value.toolAuthority.writeAllowed === false
    && typeof value.toolAuthority.networkAllowed === "boolean"
    && value.workingDirectory.mode === "read-only"
    && Number.isInteger(value.timeoutMs)
    && value.timeoutMs > 0
    && (value.memoryScope.access === "none" || value.memoryScope.access === "read-only")
    && value.writeAuthority === undefined;
}
function createManagedJobResult(job: ManagedJobRecord, runtime: ManagedJobRuntimeResult, completedAt: string, objective: string): ManagedJobResult {
  const result: ManagedJobResult = {
    version: 1,
    jobId: job.id,
    runtimeInvocationId: runtime.runtimeInvocationId,
    configuredAgentProfileId: runtime.configuredAgentProfileId,
    admissionProfileId: runtime.admissionProfileId,
    routeId: runtime.routeId,
    providerId: runtime.providerId,
    terminalState: runtime.terminalState,
    completedAt,
    provenance: { source: "runtime-managed-invocation", trust: "untrusted-child-output" },
    resultHandoff: normalizeManagedJobResultHandoff(runtime.resultHandoff, objective),
  };
  if (!isValidManagedJobResult(result, job, completedAt)) {
    throw new ManagedJobApplicationError("result_corrupt", "Persist only validated canonical Runtime result evidence.");
  }
  return result;
}
function isValidManagedJobResult(value: unknown, job: ManagedJobRecord, updatedAt: string): value is ManagedJobResult {
  if (!isRecord(value) || !hasOnly(value, ["version", "jobId", "runtimeInvocationId", "configuredAgentProfileId", "admissionProfileId", "routeId", "providerId", "terminalState", "completedAt", "provenance", "resultHandoff"]) || value.version !== 1 || value.jobId !== job.id || value.runtimeInvocationId !== job.id || value.configuredAgentProfileId !== job.configuredAgentProfileId || value.admissionProfileId !== job.admissionProfileId || value.routeId !== job.routeId || value.providerId !== job.providerId || value.terminalState !== "completed" || !isIso(value.completedAt) || Date.parse(value.completedAt) !== Date.parse(updatedAt) || !isRecord(value.provenance) || !hasOnly(value.provenance, ["source", "trust"]) || value.provenance.source !== "runtime-managed-invocation" || value.provenance.trust !== "untrusted-child-output" || !isSafeResultHandoff(value.resultHandoff)) return false;
  return true;
}
function isSafeResultHandoff(value: unknown): value is ManagedAgentResultHandoff {
  return isRecord(value)
    && hasOnly(value, ["summary", "resourceUris", "memoryWriteProposalUris"])
    && typeof value.summary === "string"
    && value.summary.trim().length > 0
    && value.summary.length <= MANAGED_JOB_INLINE_RESULT_LIMIT
    && Array.isArray(value.resourceUris)
    && Array.isArray(value.memoryWriteProposalUris)
    && value.resourceUris.length === 0
    && value.memoryWriteProposalUris.length === 0
    && redactManagedJobResultText(value.summary) === value.summary;
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
  return { summary, resourceUris: [], memoryWriteProposalUris: [] };
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
  return {
    jobId: job.id,
    availability,
    lifecycleState: job.state,
    configuredAgentProfileId: job.configuredAgentProfileId,
    admissionProfileId: job.admissionProfileId,
    routeId: job.routeId,
    providerId: job.providerId,
    ...(result ? { completedAt: result.completedAt, provenance: { ...result.provenance }, handoff: normalizeManagedJobResultHandoff(result.resultHandoff) } : {}),
    ...(job.version === 4 && job.accountLease ? { accountLease: defineManagedAccountLeaseEvidence(job.accountLease) } : {}),
    ...(diagnostic ? { diagnostic } : {}),
  };
}
function replayQuery(job: ManagedJobRecord, availability: ManagedJobReplayQuery["availability"], lifecycle: readonly ManagedJobLifecycleEntry[], diagnostic?: ManagedJobDiagnosticCode): ManagedJobReplayQuery {
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
    routeId: job.routeId,
    providerId: job.providerId,
    lifecycle,
    accountLeaseHistory: job.version === 4
      ? job.accountLeaseHistory.map(defineManagedAccountLeaseEvidence)
      : [],
    ...(job.version === 4 && job.accountLease ? { accountLease: defineManagedAccountLeaseEvidence(job.accountLease) } : {}),
    resultAvailability,
    ...(diagnostic ? { diagnostic } : {}),
  };
}
function cloneManagedJob(value: ManagedJobRecord): ManagedJobRecord { return structuredClone(value); }
function isIdentifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value); }
function isHash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function isDiagnostic(value: unknown): value is ManagedJobDiagnosticCode { return typeof value === "string" && ["invalid_request", "project_identity_unavailable", "governance_unavailable", "governance_not_authoritative", "admission_denied", "profile_unavailable", "route_unavailable", "idempotency_conflict", "job_persistence_unavailable", "job_persistence_corrupt", "unknown_job", "invalid_transition", "provider_rejected", "provider_timeout", "account_lease_unavailable", "invocation_failed", "unauthorized_job", "result_pending", "result_unavailable", "result_persistence_failure", "result_corrupt", "cancelled", "replay_unavailable"].includes(value); }
function isIso(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function fingerprint(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
