import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentTaskApplicationError } from "./errors.js";
import {
  canTransition,
  cloneAgentTask,
  isIso,
  isManagedEconomicDispatchFenceId,
  isNativeHarnessDispatchFenceId,
  isNonterminal,
  lifecycleEntry,
  isManagedAgentAdmissionProfile,
  isDiagnostic,
  isValidLifecycle,
  isApprovedWriteProfile,
  sameAgentTaskConstraints,
} from "./validation-primitives.js";
import {
  isValidAgentTaskDispatch,
  isValidAgentTaskFailureEvidence,
  isValidAgentTaskResult,
  isValidAgentTaskWriteApproval,
} from "./agent-run-validation.js";
import { validateStoredJob } from "./stored-agent-task-validation.js";
import { validateLegacyV12AgentTask } from "./legacy-v12-validation.js";
import {
  AGENT_TASK_SCHEMA_VERSION,
  type AgentTaskDiagnosticCode,
  type AgentTaskEconomicFenceResult,
  type AgentTaskFailureEvidence,
  type AgentTaskNativeHarnessFenceResult,
  type AgentTaskRecord,
  type AgentTaskReservation,
  type AgentTaskResult,
  type AgentTaskState,
  type AgentTaskStore,
  type AgentTaskWriteApproval,
} from "./contracts.js";

export class InMemoryAgentTaskStore implements AgentTaskStore {
  private readonly jobs = new Map<string, AgentTaskRecord>();
  private readonly bindings = new Map<string, { readonly fingerprint: string; readonly jobId: string }>();

  constructor(storedJobs: readonly unknown[] = []) {
    for (const storedJob of storedJobs) {
      const job = validateStoredJob(storedJob);
      if (this.jobs.has(job.id) || this.bindings.has(job.idempotencyKeyHash)) {
        throw new AgentTaskApplicationError("job_persistence_corrupt", "Repair the agent-task store before retrying.");
      }
      this.jobs.set(job.id, cloneAgentTask(job));
      this.bindings.set(job.idempotencyKeyHash, {
        fingerprint: job.requestFingerprint,
        jobId: job.id,
      });
    }
  }

  async reserve(input: { readonly job: AgentTaskRecord }): Promise<AgentTaskReservation> {
    const job = validateStoredJob(input.job);
    const binding = this.bindings.get(job.idempotencyKeyHash);
    if (binding) {
      if (binding.fingerprint !== job.requestFingerprint) return { kind: "conflict" };
      const existing = this.jobs.get(binding.jobId);
      if (!existing) throw new AgentTaskApplicationError("job_persistence_corrupt", "Repair the agent-task store before retrying.");
      return { kind: "existing", job: cloneAgentTask(existing) };
    }
    this.jobs.set(job.id, cloneAgentTask(job));
    this.bindings.set(job.idempotencyKeyHash, { fingerprint: job.requestFingerprint, jobId: job.id });
    return { kind: "created", job: cloneAgentTask(job) };
  }

  async get(id: string): Promise<AgentTaskRecord | undefined> { const job = this.jobs.get(id); return job ? cloneAgentTask(job) : undefined; }
  async attachWriteApproval(id: string, approval: AgentTaskWriteApproval, updatedAt?: string): Promise<AgentTaskRecord> {
    const current = this.jobs.get(id);
    if (!current) throw new AgentTaskApplicationError("unknown_job", "Verify the agent-task identifier.");
    if (current.state !== "awaiting_approval" || current.writeApproval !== undefined) throw new AgentTaskApplicationError("invalid_transition", "Attach approval only once before dispatch.");
    const timestamp = updatedAt ?? new Date().toISOString();
    const next: AgentTaskRecord = { ...current, state: "queued", writeApproval: approval, updatedAt: timestamp,
      run: { ...current.run, state: "queued", dispatch: current.dispatch },
      lifecycle: [...current.lifecycle, lifecycleEntry(current.lifecycle.length + 1, "queued", timestamp)] };
    this.jobs.set(id, next);
    return cloneAgentTask(next);
  }
  async recordWriteApproval(id: string, approval: AgentTaskWriteApproval, updatedAt?: string): Promise<AgentTaskRecord> {
    const current = this.jobs.get(id);
    if (!current || !isNonterminal(current.state) || current.writeApproval?.approvalId !== approval.approvalId) throw new AgentTaskApplicationError("invalid_transition", "Persist approval only for its active managed job.");
    const next = { ...current, writeApproval: approval, updatedAt: updatedAt ?? current.updatedAt };
    this.jobs.set(id, next);
    return cloneAgentTask(next);
  }
  async fenceNativeHarness(id: string, dispatchFenceId: string, updatedAt?: string): Promise<AgentTaskNativeHarnessFenceResult> {
    const current = this.jobs.get(id);
    if (!current) throw new AgentTaskApplicationError("unknown_job", "Verify the agent-task identifier.");
    if (current.dispatch.kind !== "native-harness") throw new AgentTaskApplicationError("identity-revision-conflict", "Persisted managed dispatch is not a native-harness route.");
    if (current.dispatch.dispatchFenceId !== undefined) {
      return { kind: "existing", job: cloneAgentTask(current) };
    }
    if (current.state !== "queued") return { kind: "conflict", job: cloneAgentTask(current) };
    if (!isNativeHarnessDispatchFenceId(dispatchFenceId)) throw new AgentTaskApplicationError("invalid_request", "Use a valid native-harness dispatch fence identifier.");
    const timestamp = updatedAt ?? new Date().toISOString();
    if (!isIso(timestamp) || Date.parse(timestamp) < Date.parse(current.updatedAt)) throw new AgentTaskApplicationError("invalid_transition", "Use monotonic agent-task timestamps.");
    const next: AgentTaskRecord = {
      ...current,
      state: "running",
      updatedAt: timestamp,
      dispatch: { ...current.dispatch, dispatchFenceId },
      run: { ...current.run, state: "running", dispatch: { ...current.dispatch, dispatchFenceId } },
      lifecycle: [...current.lifecycle, lifecycleEntry(current.lifecycle.length + 1, "running", timestamp)],
    };
    this.jobs.set(id, next);
    return { kind: "acquired", job: cloneAgentTask(next) };
  }
  async fenceEconomic(id: string, dispatchFenceId: string, updatedAt?: string): Promise<AgentTaskEconomicFenceResult> {
    const current = this.jobs.get(id);
    if (!current) throw new AgentTaskApplicationError("unknown_job", "Verify the agent-task identifier.");
    if (current.dispatch.kind !== "economic") throw new AgentTaskApplicationError("identity-revision-conflict", "Persisted managed dispatch is not an economic route.");
    if (current.dispatch.dispatchFenceId !== undefined) {
      return { kind: "existing", job: cloneAgentTask(current) };
    }
    if (current.state !== "queued") return { kind: "conflict", job: cloneAgentTask(current) };
    if (!isManagedEconomicDispatchFenceId(dispatchFenceId)) throw new AgentTaskApplicationError("invalid_request", "Use a valid managed-economic dispatch fence identifier.");
    const timestamp = updatedAt ?? new Date().toISOString();
    if (!isIso(timestamp) || Date.parse(timestamp) < Date.parse(current.updatedAt)) throw new AgentTaskApplicationError("invalid_transition", "Use monotonic agent-task timestamps.");
    const dispatch = { ...current.dispatch, dispatchFenceId };
    const next: AgentTaskRecord = {
      ...current,
      state: "running",
      updatedAt: timestamp,
      dispatch,
      run: { ...current.run, state: "running", dispatch },
      lifecycle: [...current.lifecycle, lifecycleEntry(current.lifecycle.length + 1, "running", timestamp)],
    };
    this.jobs.set(id, next);
    return { kind: "acquired", job: cloneAgentTask(next) };
  }
  async transition(id: string, state: AgentTaskState, diagnostic?: AgentTaskDiagnosticCode, updatedAt?: string, failureEvidence?: AgentTaskFailureEvidence): Promise<AgentTaskRecord> {
    const current = this.jobs.get(id);
    if (!current) throw new AgentTaskApplicationError("unknown_job", "Verify the agent-task identifier.");
    if (current.state === state && current.diagnostic === diagnostic && JSON.stringify(current.failureEvidence) === JSON.stringify(failureEvidence)) return cloneAgentTask(current);
    if (!canTransition(current.state, state)) throw new AgentTaskApplicationError("invalid_transition", "Keep terminal agent-task states immutable.");
    const timestamp = updatedAt ?? new Date().toISOString();
    if (!isIso(timestamp) || Date.parse(timestamp) < Date.parse(current.updatedAt)) throw new AgentTaskApplicationError("invalid_transition", "Use monotonic agent-task timestamps.");
    const next: AgentTaskRecord = {
      ...current,
      state,
      updatedAt: timestamp,
      run: {
        ...current.run,
        state,
        dispatch: current.dispatch,
        ...(failureEvidence ? { failureEvidence } : {}),
      },
      lifecycle: [...current.lifecycle, lifecycleEntry(current.lifecycle.length + 1, state, timestamp, diagnostic, failureEvidence)],
      ...(diagnostic ? { diagnostic } : {}),
      ...(failureEvidence ? { failureEvidence } : {}),
    };
    this.jobs.set(id, next);
    return cloneAgentTask(next);
  }
  async completeSuccess(id: string, result: AgentTaskResult, updatedAt?: string): Promise<AgentTaskRecord> {
    const current = this.jobs.get(id);
    if (!current) throw new AgentTaskApplicationError("unknown_job", "Verify the agent-task identifier.");
    if (current.state !== "running" || current.result !== undefined) throw new AgentTaskApplicationError("invalid_transition", "Keep terminal agent-task results immutable.");
    const timestamp = updatedAt ?? new Date().toISOString();
    if (!isIso(timestamp) || Date.parse(timestamp) < Date.parse(current.updatedAt) || !isValidAgentTaskResult(result, current, timestamp)) {
      throw new AgentTaskApplicationError("result_corrupt", "Persist only validated canonical Runtime result evidence.");
    }
    const next: AgentTaskRecord = {
      ...current,
      state: "succeeded",
      result,
      updatedAt: timestamp,
      run: { ...current.run, state: "succeeded", dispatch: current.dispatch, result, ...(result.dataPolicyProof ? { dataPolicyProof: result.dataPolicyProof } : {}) },
      lifecycle: [...current.lifecycle, lifecycleEntry(current.lifecycle.length + 1, "succeeded", timestamp)],
    };
    this.jobs.set(id, next);
    return cloneAgentTask(next);
  }
  async listNonterminal(): Promise<readonly AgentTaskRecord[]> { return [...this.jobs.values()].filter((job) => job.state === "awaiting_approval" || job.state === "queued" || job.state === "running").map(cloneAgentTask); }
  all(): readonly AgentTaskRecord[] { return [...this.jobs.values()].map(cloneAgentTask); }
}

export class FilesystemAgentTaskStore implements AgentTaskStore {
  private readonly root: string;
  constructor(rootPath: string, private readonly staleLockMs = 60000) { this.root = resolve(rootPath); }
  async reserve(input: { readonly job: AgentTaskRecord }): Promise<AgentTaskReservation> {
    return this.withLock(async () => {
      const memory = await this.loadMemory();
      const result = await memory.reserve(input);
      if (result.kind === "created") await this.saveMemory(memory);
      return result;
    });
  }
  async get(id: string): Promise<AgentTaskRecord | undefined> { return this.withLock(async () => (await this.loadMemory()).get(id)); }
  async attachWriteApproval(id: string, approval: AgentTaskWriteApproval, updatedAt?: string): Promise<AgentTaskRecord> {
    return this.withLock(async () => { const memory = await this.loadMemory(); const job = await memory.attachWriteApproval(id, approval, updatedAt); await this.saveMemory(memory); return job; });
  }
  async recordWriteApproval(id: string, approval: AgentTaskWriteApproval, updatedAt?: string): Promise<AgentTaskRecord> {
    return this.withLock(async () => { const memory = await this.loadMemory(); const job = await memory.recordWriteApproval(id, approval, updatedAt); await this.saveMemory(memory); return job; });
  }
  async fenceNativeHarness(id: string, dispatchFenceId: string, updatedAt?: string): Promise<AgentTaskNativeHarnessFenceResult> {
    return this.withLock(async () => {
      const memory = await this.loadMemory();
      const result = await memory.fenceNativeHarness(id, dispatchFenceId, updatedAt);
      if (result.kind === "acquired") await this.saveMemory(memory);
      return result;
    });
  }
  async fenceEconomic(id: string, dispatchFenceId: string, updatedAt?: string): Promise<AgentTaskEconomicFenceResult> {
    return this.withLock(async () => {
      const memory = await this.loadMemory();
      const result = await memory.fenceEconomic(id, dispatchFenceId, updatedAt);
      if (result.kind === "acquired") await this.saveMemory(memory);
      return result;
    });
  }
  async transition(id: string, state: AgentTaskState, diagnostic?: AgentTaskDiagnosticCode, updatedAt?: string, failureEvidence?: AgentTaskFailureEvidence): Promise<AgentTaskRecord> {
    return this.withLock(async () => { const memory = await this.loadMemory(); const job = await memory.transition(id, state, diagnostic, updatedAt, failureEvidence); await this.saveMemory(memory); return job; });
  }
  async completeSuccess(id: string, result: AgentTaskResult, updatedAt?: string): Promise<AgentTaskRecord> {
    return this.withLock(async () => { const memory = await this.loadMemory(); const job = await memory.completeSuccess(id, result, updatedAt); await this.saveMemory(memory); return job; });
  }
  async listNonterminal(): Promise<readonly AgentTaskRecord[]> { return this.withLock(async () => (await this.loadMemory()).listNonterminal()); }
  /** Inspection-only store projection; a task owns exactly one run in V13. */
  async all(): Promise<readonly AgentTaskRecord[]> { return this.withLock(async () => (await this.loadMemory()).all()); }
  private async loadMemory(): Promise<InMemoryAgentTaskStore> {
    try {
      const parsed = JSON.parse(await readFile(resolve(this.root, "agent-tasks", "agent-tasks.json"), "utf8")) as unknown;
      if (!Array.isArray(parsed)) throw new Error("corrupt");
      const memory = new InMemoryAgentTaskStore(parsed);
      await this.retireLegacyV12Source();
      return memory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return await this.migrateV12();
      }
      if (
        error instanceof SyntaxError
        || error instanceof AgentTaskApplicationError
        || (error instanceof Error && error.message === "corrupt")
      ) {
        throw new AgentTaskApplicationError("job_persistence_corrupt", "Repair the agent-task store before retrying.");
      }
      throw new AgentTaskApplicationError("job_persistence_unavailable", "Restore the agent-task store and retry safely.");
    }
  }
  private async saveMemory(memory: InMemoryAgentTaskStore): Promise<void> {
    await mkdir(resolve(this.root, "agent-tasks"), { recursive: true });
    const records = memory.all();
    const target = resolve(this.root, "agent-tasks", "agent-tasks.json");
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(records)}\n`, "utf8");
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }
  private async migrateV12(): Promise<InMemoryAgentTaskStore> {
    const legacy = resolve(this.root, "managed-jobs", "managed-jobs.json");
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(legacy, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new InMemoryAgentTaskStore(); throw new AgentTaskApplicationError("job_persistence_corrupt", "Repair the legacy agent-task store before retrying."); }
    if (!Array.isArray(parsed)) throw new AgentTaskApplicationError("job_persistence_corrupt", "Repair the legacy agent-task store before retrying.");
    const tasks = parsed.map((legacyRecord) => migrateV12AgentTask(legacyRecord));
    const memory = new InMemoryAgentTaskStore(tasks);
    await this.assertLegacyBackupCompatible();
    await this.saveMemory(memory);
    // Never retire the sole source before the atomically-published V13 is readable and fully validated.
    await this.loadMemory();
    return memory;
  }
  private async assertLegacyBackupCompatible(): Promise<void> {
    const legacy = resolve(this.root, "managed-jobs", "managed-jobs.json");
    const backup = resolve(this.root, "managed-jobs", "managed-jobs.v12.json");
    try {
      const [sourceContents, backupContents] = await Promise.all([
        readFile(legacy, "utf8"),
        readFile(backup, "utf8"),
      ]);
      if (sourceContents !== backupContents) {
        throw new AgentTaskApplicationError("job_persistence_corrupt", "Resolve the conflicting legacy V12 backup before retrying.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private async retireLegacyV12Source(): Promise<void> {
    const legacy = resolve(this.root, "managed-jobs", "managed-jobs.json");
    const backup = resolve(this.root, "managed-jobs", "managed-jobs.v12.json");
    let sourceContents: string;
    try {
      sourceContents = await readFile(legacy, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    try {
      const backupContents = await readFile(backup, "utf8");
      if (backupContents !== sourceContents) {
        throw new AgentTaskApplicationError("job_persistence_corrupt", "Resolve the conflicting legacy V12 backup before retrying.");
      }
      await rm(legacy);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await rename(legacy, backup);
        return;
      }
      throw error;
    }
  }
  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true });
    const lock = resolve(this.root, ".agent-tasks.lock");
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
    throw new AgentTaskApplicationError("job_persistence_unavailable", "Wait for the active agent-task persistence operation to finish.");
  }
}
function migrateV12AgentTask(value: unknown): AgentTaskRecord {
  let legacy;
  try {
    legacy = validateLegacyV12AgentTask(value, {
      admissionProfile: isManagedAgentAdmissionProfile,
      dispatch: isValidAgentTaskDispatch,
      lifecycle: isValidLifecycle,
      diagnostic: isDiagnostic,
      failureEvidence: isValidAgentTaskFailureEvidence,
      writeApproval: isValidAgentTaskWriteApproval,
      result: isValidAgentTaskResult,
      approvedWriteProfile: isApprovedWriteProfile,
      sameEconomicConstraints: sameAgentTaskConstraints,
      economicDispatchFenceId: isManagedEconomicDispatchFenceId,
      nativeDispatchFenceId: isNativeHarnessDispatchFenceId,
    });
  } catch {
    throw new AgentTaskApplicationError("job_persistence_corrupt", "Repair the legacy agent-task store before retrying.");
  }
  return validateStoredJob({ ...legacy, version: AGENT_TASK_SCHEMA_VERSION, run: {
    runId: `agent-run:${legacy.id}`,
    state: legacy.state,
    dispatch: legacy.dispatch,
    ...(legacy.result ? { result: legacy.result } : {}),
    ...(legacy.failureEvidence ? { failureEvidence: legacy.failureEvidence } : {}),
    ...(legacy.result?.dataPolicyProof ? { dataPolicyProof: legacy.result.dataPolicyProof } : {}),
  } });
}
