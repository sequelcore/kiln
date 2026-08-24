import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { AgentTaskApplicationError } from "./errors.js";
import {
  assertPrivateStateFileTarget,
  assertPrivateStateTarget,
  ensurePrivateStateDirectory,
} from "../utils/private-state-filesystem.js";
import {
  canTransition,
  cloneAgentTask,
  isIso,
  isManagedEconomicDispatchFenceId,
  isNativeHarnessDispatchFenceId,
  isNonterminal,
  lifecycleEntry,
} from "./validation-primitives.js";
import { isValidAgentTaskResult } from "./agent-run-validation.js";
import { validateStoredJob } from "./stored-agent-task-validation.js";
import {
  type AgentTaskDiagnosticCode,
  type AgentTaskActionClaim,
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
  async fenceNativeHarness(
    id: string,
    dispatchFenceId: string,
    updatedAt: string | undefined,
    actionClaim: AgentTaskActionClaim,
  ): Promise<AgentTaskNativeHarnessFenceResult> {
    const current = this.jobs.get(id);
    if (!current) throw new AgentTaskApplicationError("unknown_job", "Verify the agent-task identifier.");
    if (current.dispatch.kind !== "native-harness") throw new AgentTaskApplicationError("identity-revision-conflict", "Persisted managed dispatch is not a native-harness route.");
    if (current.dispatch.dispatchFenceId !== undefined) {
      if (current.dispatch.actionClaim === undefined
        || JSON.stringify(current.dispatch.actionClaim) !== JSON.stringify(actionClaim)) {
        return { kind: "conflict", job: cloneAgentTask(current) };
      }
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
      dispatch: { ...current.dispatch, dispatchFenceId, actionClaim },
      run: { ...current.run, state: "running", dispatch: { ...current.dispatch, dispatchFenceId, actionClaim } },
      lifecycle: [...current.lifecycle, lifecycleEntry(current.lifecycle.length + 1, "running", timestamp)],
    };
    this.jobs.set(id, next);
    return { kind: "acquired", job: cloneAgentTask(next) };
  }
  async projectEconomicDispatch(id: string, dispatchFenceId: string, updatedAt: string | undefined, actionClaim: AgentTaskActionClaim): Promise<AgentTaskEconomicFenceResult> {
    const current = this.jobs.get(id);
    if (!current) throw new AgentTaskApplicationError("unknown_job", "Verify the agent-task identifier.");
    if (current.dispatch.kind !== "economic") throw new AgentTaskApplicationError("identity-revision-conflict", "Persisted managed dispatch is not an economic route.");
    if (current.dispatch.dispatchFenceId !== undefined) {
      if (current.dispatch.actionClaim === undefined
        || JSON.stringify(current.dispatch.actionClaim) !== JSON.stringify(actionClaim)) {
        return { kind: "conflict", job: cloneAgentTask(current) };
      }
      return { kind: "existing", job: cloneAgentTask(current) };
    }
    if (current.state !== "queued") return { kind: "conflict", job: cloneAgentTask(current) };
    if (!isManagedEconomicDispatchFenceId(dispatchFenceId)) throw new AgentTaskApplicationError("invalid_request", "Use a valid managed-economic dispatch fence identifier.");
    const timestamp = updatedAt ?? new Date().toISOString();
    if (!isIso(timestamp) || Date.parse(timestamp) < Date.parse(current.updatedAt)) throw new AgentTaskApplicationError("invalid_transition", "Use monotonic agent-task timestamps.");
    const dispatch = { ...current.dispatch, dispatchFenceId, actionClaim };
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
  private readonly privateStateRoot: string | undefined;
  private currentProcessStartIdentityPromise: Promise<string | undefined> | undefined;
  constructor(
    rootPath: string,
    private readonly staleLockMs = 60000,
    privateStateRoot?: string,
  ) {
    this.root = resolve(rootPath);
    this.privateStateRoot = privateStateRoot === undefined ? undefined : resolve(privateStateRoot);
    if (this.privateStateRoot !== undefined) assertPrivateStateTarget(this.privateStateRoot, this.root);
  }
  async reserve(input: { readonly job: AgentTaskRecord }): Promise<AgentTaskReservation> {
    return this.withLock(async (lease) => {
      const memory = await this.loadMemory();
      const result = await memory.reserve(input);
      if (result.kind === "created") await this.saveMemory(memory, lease);
      return result;
    });
  }
  async get(id: string): Promise<AgentTaskRecord | undefined> { return this.withLock(async () => (await this.loadMemory()).get(id)); }
  async attachWriteApproval(id: string, approval: AgentTaskWriteApproval, updatedAt?: string): Promise<AgentTaskRecord> {
    return this.withLock(async (lease) => { const memory = await this.loadMemory(); const job = await memory.attachWriteApproval(id, approval, updatedAt); await this.saveMemory(memory, lease); return job; });
  }
  async recordWriteApproval(id: string, approval: AgentTaskWriteApproval, updatedAt?: string): Promise<AgentTaskRecord> {
    return this.withLock(async (lease) => { const memory = await this.loadMemory(); const job = await memory.recordWriteApproval(id, approval, updatedAt); await this.saveMemory(memory, lease); return job; });
  }
  async fenceNativeHarness(
    id: string,
    dispatchFenceId: string,
    updatedAt: string | undefined,
    actionClaim: AgentTaskActionClaim,
  ): Promise<AgentTaskNativeHarnessFenceResult> {
    return this.withLock(async (lease) => {
      const memory = await this.loadMemory();
      const result = await memory.fenceNativeHarness(id, dispatchFenceId, updatedAt, actionClaim);
      if (result.kind === "acquired") await this.saveMemory(memory, lease);
      return result;
    });
  }
  async projectEconomicDispatch(id: string, dispatchFenceId: string, updatedAt: string | undefined, actionClaim: AgentTaskActionClaim): Promise<AgentTaskEconomicFenceResult> {
    return this.withLock(async (lease) => {
      const memory = await this.loadMemory();
      const result = await memory.projectEconomicDispatch(id, dispatchFenceId, updatedAt, actionClaim);
      if (result.kind === "acquired") await this.saveMemory(memory, lease);
      return result;
    });
  }
  async transition(id: string, state: AgentTaskState, diagnostic?: AgentTaskDiagnosticCode, updatedAt?: string, failureEvidence?: AgentTaskFailureEvidence): Promise<AgentTaskRecord> {
    return this.withLock(async (lease) => { const memory = await this.loadMemory(); const job = await memory.transition(id, state, diagnostic, updatedAt, failureEvidence); await this.saveMemory(memory, lease); return job; });
  }
  async completeSuccess(id: string, result: AgentTaskResult, updatedAt?: string): Promise<AgentTaskRecord> {
    return this.withLock(async (lease) => { const memory = await this.loadMemory(); const job = await memory.completeSuccess(id, result, updatedAt); await this.saveMemory(memory, lease); return job; });
  }
  async listNonterminal(): Promise<readonly AgentTaskRecord[]> { return this.withLock(async () => (await this.loadMemory()).listNonterminal()); }
  /** Inspection-only store projection; a task owns exactly one run in V14. */
  async all(): Promise<readonly AgentTaskRecord[]> { return this.withLock(async () => (await this.loadMemory()).all()); }
  private async loadMemory(): Promise<InMemoryAgentTaskStore> {
    const target = resolve(this.root, "agent-tasks", "agent-tasks.json");
    try {
      await this.ensurePrivateDirectory(dirname(target), false);
      await this.assertPrivateFile(target);
      const parsed = JSON.parse(await readFile(target, "utf8")) as unknown;
      if (!Array.isArray(parsed)) throw new Error("corrupt");
      return new InMemoryAgentTaskStore(rejectLegacyAgentTasks(parsed));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new InMemoryAgentTaskStore();
      }
      if (
        error instanceof SyntaxError
        || error instanceof AgentTaskApplicationError
        || (error instanceof Error && (error.message === "corrupt" || error.message === "legacy_schema"))
      ) {
        throw new AgentTaskApplicationError("job_persistence_corrupt", "Repair the agent-task store before retrying.");
      }
      throw new AgentTaskApplicationError("job_persistence_unavailable", "Restore the agent-task store and retry safely.");
    }
  }
  private async saveMemory(memory: InMemoryAgentTaskStore, lease: FilesystemLockLease): Promise<void> {
    await this.assertLockOwner(lease);
    const directory = resolve(this.root, "agent-tasks");
    await this.ensurePrivateDirectory(directory, true);
    const records = memory.all();
    const target = resolve(directory, "agent-tasks.json");
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await this.assertPrivateFile(target);
      await this.assertPrivateFile(temp);
      await writeFile(temp, `${JSON.stringify(records)}\n`, "utf8");
      // The lease check is part of the persistence transaction. A stale
      // owner may not publish a snapshot after a successor has taken over;
      // the liveness-gated takeover below prevents a live paused owner from
      // being displaced between this check and the atomic rename.
      await this.assertLockOwner(lease);
      await this.ensurePrivateDirectory(directory, false);
      await this.assertPrivateFile(temp);
      await this.assertPrivateFile(target);
      await rename(temp, target);
    } finally {
      await this.assertPrivateFile(temp);
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }
  private async withLock<T>(action: (lease: FilesystemLockLease) => Promise<T>): Promise<T> {
    await this.ensurePrivateDirectory(this.root, true);
    const lease = await this.acquireLock();
    try {
      await this.afterLockAcquired(lease);
      return await action(lease);
    } finally {
      lease.closed = true;
      if (lease.heartbeatTimer !== undefined) clearInterval(lease.heartbeatTimer);
      await lease.heartbeatInFlight?.catch(() => undefined);
      await this.releaseLock(lease);
    }
  }

  private async ensurePrivateDirectory(targetDirectory: string, create: boolean): Promise<boolean> {
    if (this.privateStateRoot === undefined) {
      if (create) await mkdir(targetDirectory, { recursive: true });
      return true;
    }
    return ensurePrivateStateDirectory(this.privateStateRoot, targetDirectory, create);
  }

  private async assertPrivateFile(filePath: string): Promise<void> {
    if (this.privateStateRoot !== undefined) {
      await assertPrivateStateFileTarget(this.privateStateRoot, filePath);
    }
  }

  protected async afterLockAcquired(_lease: FilesystemLockLease): Promise<void> {
    // Subclasses may observe the ownership boundary for deterministic
    // concurrency verification; production stores leave it untouched.
  }

  protected async beforeLockPublish(_staging: string, _lease: FilesystemLockLease): Promise<void> {
    // Subclasses may pause this boundary to verify that staging is never
    // mistaken for an acquired canonical lock.
  }

  protected async readProcessStartIdentity(pid: number): Promise<string | undefined> {
    return probeProcessStartIdentity(pid);
  }

  private currentProcessStartIdentity(): Promise<string | undefined> {
    this.currentProcessStartIdentityPromise ??= this.readProcessStartIdentity(process.pid);
    return this.currentProcessStartIdentityPromise;
  }

  private async acquireLock(): Promise<FilesystemLockLease> {
    const lock = resolve(this.root, ".agent-tasks.lock");
    let livenessKey: string | undefined;
    let livenessObservedAt = 0;
    let liveness: OwnerLiveness | undefined;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await this.ensurePrivateDirectory(this.root, false);
      const token = randomUUID();
      const leaseGeneration = randomUUID();
      const staging = resolve(this.root, `.agent-tasks.lock.staging-${token}-${randomUUID()}`);
      const ownerPath = join(staging, lockOwnerFileName(token));
      let stagingCreated = false;
      try {
        await this.ensurePrivateDirectory(dirname(staging), false);
        await mkdir(staging);
        stagingCreated = true;
        const processStartIdentity = await this.currentProcessStartIdentity();
        if (!processStartIdentity) {
          throw new AgentTaskApplicationError(
            "job_persistence_unavailable",
            "The agent-task store cannot prove the current process incarnation.",
          );
        }
        const lease: FilesystemLockLease = {
          lock,
          ownerPath,
          ownerToken: token,
          leaseGeneration,
          pid: process.pid,
          processStartIdentity,
          heartbeatTimer: undefined,
          heartbeatInFlight: undefined,
          closed: false,
          lost: false,
        };
        await this.assertPrivateFile(ownerPath);
        await writeFile(ownerPath, serializeLockOwner(lease), "utf8");
        await this.assertPrivateFile(ownerPath);
        await this.beforeLockPublish(staging, lease);
        await this.ensurePrivateDirectory(staging, false);
        await this.ensurePrivateDirectory(lock, false);
        await rename(staging, lock);
        lease.ownerPath = join(lock, lockOwnerFileName(token));
        lease.heartbeatTimer = setInterval(
          () => {
            if (lease.closed || lease.heartbeatInFlight !== undefined) return;
            lease.heartbeatInFlight = this.refreshLock(lease).finally(() => {
              lease.heartbeatInFlight = undefined;
            });
          },
          Math.max(1, Math.floor(this.staleLockMs / 3)),
        );
        lease.heartbeatTimer.unref?.();
        return lease;
      } catch (error) {
        if (stagingCreated) {
          await this.ensurePrivateDirectory(staging, false);
          await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        }
        const code = (error as NodeJS.ErrnoException).code;
        // Directory publish collisions vary by platform and filesystem. In
        // every admitted case the staging directory is disposable and the
        // canonical owner must be inspected on the next attempt.
        if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
      }

      const current = await this.readLockOwner(lock);
      // A releaser may crash after deleting its exact owner marker but before
      // removing the now-empty canonical directory. No live owner can exist
      // without a marker, and rmdir remains compare-safe because it succeeds
      // only while the directory is still empty.
      if (!current && await this.removeEmptyLock(lock)) continue;
      if (current && Date.now() - current.heartbeatAt > this.staleLockMs) {
        const currentKey = `${current.ownerToken}:${current.leaseGeneration}:${current.heartbeatAt}`;
        if (currentKey !== livenessKey || Date.now() - livenessObservedAt >= 250) {
          livenessKey = currentKey;
          livenessObservedAt = Date.now();
          liveness = await this.ownerLiveness(current);
        }
        if ((liveness === "dead" || liveness === "different-incarnation")
          && await this.compareAndDeleteLock(lock, current)) continue;
      }
      await new Promise<void>((done) => setTimeout(done, 5));
    }
    throw new AgentTaskApplicationError("job_persistence_unavailable", "Wait for the active agent-task persistence operation to finish.");
  }

  private async refreshLock(lease: FilesystemLockLease): Promise<void> {
    if (lease.closed || lease.lost) return;
    try {
      const current = await this.readLockOwner(lease.lock);
      if (!current || !sameLockOwner(current, lease)) {
        lease.lost = true;
        return;
      }
      const temp = `${lease.lock}.heartbeat-${lease.ownerToken}-${randomUUID()}.tmp`;
      try {
        await this.ensurePrivateDirectory(lease.lock, false);
        await this.assertPrivateFile(temp);
        await writeFile(temp, serializeLockOwner(lease), "utf8");
        await this.assertPrivateFile(temp);
        await this.assertPrivateFile(lease.ownerPath);
        await rename(temp, lease.ownerPath);
      } finally {
        await this.assertPrivateFile(temp);
        await rm(temp, { force: true }).catch(() => undefined);
      }
      const refreshed = await this.readLockOwner(lease.lock);
      if (!refreshed || !sameLockOwner(refreshed, lease)) lease.lost = true;
    } catch {
      lease.lost = true;
    }
  }

  private async assertLockOwner(lease: FilesystemLockLease): Promise<void> {
    if (lease.closed || lease.lost) {
      throw new AgentTaskApplicationError("job_persistence_unavailable", "The agent-task persistence lease is no longer owned.");
    }
    const current = await this.readLockOwner(lease.lock);
    if (!current || !sameLockOwner(current, lease)) {
      lease.lost = true;
      throw new AgentTaskApplicationError("job_persistence_unavailable", "The agent-task persistence lease is no longer owned.");
    }
  }

  private async ownerLiveness(owner: LockOwnerRecord): Promise<OwnerLiveness> {
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "unknown";
    }
    const observedIdentity = owner.pid === process.pid
      ? await this.currentProcessStartIdentity()
      : await this.readProcessStartIdentity(owner.pid);
    if (!owner.processStartIdentity || !observedIdentity) return "unknown";
    return owner.processStartIdentity === observedIdentity ? "alive" : "different-incarnation";
  }

  private async releaseLock(lease: FilesystemLockLease): Promise<void> {
    const current = await this.readLockOwner(lease.lock);
    if (!current || !sameLockOwner(current, lease)) return;
    await this.compareAndDeleteLock(lease.lock, current);
  }

  private async removeEmptyLock(lock: string): Promise<boolean> {
    try {
      await this.ensurePrivateDirectory(lock, false);
      const entries = await readdir(lock);
      if (entries.length !== 0) return false;
      await rmdir(lock);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return true;
      if (code === "ENOTEMPTY" || code === "EEXIST") return false;
      return false;
    }
  }

  /**
   * Delete only the exact observed owner marker, then remove the lock
   * directory only when it is empty. A successor's differently named marker
   * makes the final rmdir fail, so an old owner can never delete its lock.
   * This is deliberately portable across the filesystem rename semantics on
   * Windows and Unix.
   */
  private async compareAndDeleteLock(lock: string, expected: LockOwnerRecord): Promise<boolean> {
    const current = await this.readLockOwner(lock);
    if (!current || !sameLockOwner(current, expected)) return false;
    const ownerPath = join(lock, lockOwnerFileName(expected.ownerToken));
    try {
      await this.ensurePrivateDirectory(lock, false);
      await this.assertPrivateFile(ownerPath);
      await rm(ownerPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      return false;
    }
    try {
      await this.ensurePrivateDirectory(lock, false);
      await rmdir(lock);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT"
        && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY"
        && (error as NodeJS.ErrnoException).code !== "EEXIST") {
        return false;
      }
      return false;
    }
  }

  private async readLockOwner(lock: string): Promise<LockOwnerRecord | undefined> {
    await this.ensurePrivateDirectory(lock, false);
    let entries: string[];
    try {
      entries = await readdir(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const ownerFiles = entries.filter((entry) => entry.startsWith("owner-") && entry.endsWith(".json"));
    if (entries.length !== 1 || ownerFiles.length !== 1) return undefined;
    const ownerFile = ownerFiles[0]!;
    const ownerToken = ownerFile.slice("owner-".length, -".json".length);
    try {
      const ownerPath = join(lock, ownerFile);
      await this.assertPrivateFile(ownerPath);
      const parsed = JSON.parse(await readFile(ownerPath, "utf8")) as unknown;
      if (!isLockOwnerRecord(parsed) || parsed.ownerToken !== ownerToken) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }
}

interface LockOwnerRecord {
  readonly version: 1;
  readonly ownerToken: string;
  readonly leaseGeneration: string;
  readonly pid: number;
  readonly processStartIdentity: string;
  readonly heartbeatAt: number;
}

interface FilesystemLockLease {
  readonly lock: string;
  ownerPath: string;
  readonly ownerToken: string;
  readonly leaseGeneration: string;
  readonly pid: number;
  readonly processStartIdentity: string;
  heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  heartbeatInFlight: Promise<void> | undefined;
  closed: boolean;
  lost: boolean;
}

type OwnerLiveness = "alive" | "dead" | "different-incarnation" | "unknown";

function lockOwnerFileName(ownerToken: string): string {
  return `owner-${ownerToken}.json`;
}

function serializeLockOwner(lease: Pick<FilesystemLockLease, "ownerToken" | "leaseGeneration" | "pid" | "processStartIdentity">): string {
  return `${JSON.stringify({
    version: 1,
    ownerToken: lease.ownerToken,
    leaseGeneration: lease.leaseGeneration,
    pid: lease.pid,
    processStartIdentity: lease.processStartIdentity,
    heartbeatAt: Date.now(),
  } satisfies LockOwnerRecord)}\n`;
}

function isLockOwnerRecord(value: unknown): value is LockOwnerRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Partial<LockOwnerRecord>;
  return record.version === 1
    && typeof record.ownerToken === "string"
    && record.ownerToken.length > 0
    && typeof record.leaseGeneration === "string"
    && record.leaseGeneration.length > 0
    && Number.isSafeInteger(record.pid)
    && (record.pid ?? 0) > 0
    && typeof record.processStartIdentity === "string"
    && record.processStartIdentity.length > 0
    && Number.isSafeInteger(record.heartbeatAt)
    && (record.heartbeatAt ?? 0) >= 0;
}

function sameLockOwner(left: LockOwnerRecord, right: Pick<FilesystemLockLease, "ownerToken" | "leaseGeneration" | "pid" | "processStartIdentity">): boolean {
  return left.ownerToken === right.ownerToken
    && left.leaseGeneration === right.leaseGeneration
    && left.pid === right.pid
    && left.processStartIdentity === right.processStartIdentity;
}

async function probeProcessStartIdentity(pid: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  if (process.platform === "linux") return probeLinuxProcessStartIdentity(pid);
  if (process.platform === "darwin") return probeDarwinProcessStartIdentity(pid);
  if (process.platform === "win32") return probeWindowsProcessStartIdentity(pid);
  return undefined;
}

async function probeLinuxProcessStartIdentity(pid: number): Promise<string | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const closingName = stat.lastIndexOf(")");
    if (closingName < 0) return undefined;
    const fields = stat.slice(closingName + 2).trim().split(/\s+/u);
    const startTicks = fields[19];
    if (!startTicks) return undefined;
    const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8").catch(() => "")).trim();
    return `linux:${bootId || "unknown-boot"}:${startTicks}`;
  } catch {
    return undefined;
  }
}

async function probeDarwinProcessStartIdentity(pid: number): Promise<string | undefined> {
  const start = await execFileText("ps", ["-p", String(pid), "-o", "lstart="]);
  return start ? `darwin:${start}` : undefined;
}

async function probeWindowsProcessStartIdentity(pid: number): Promise<string | undefined> {
  const start = await execFileText("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$process = Get-Process -Id ${pid} -ErrorAction Stop; $process.StartTime.ToFileTimeUtc()`,
  ]);
  return start ? `windows:${start}` : undefined;
}

function execFileText(file: string, args: readonly string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(file, [...args], { windowsHide: true, timeout: 1500 }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const output = typeof stdout === "string" ? stdout.trim() : String(stdout).trim();
      resolve(output || undefined);
    });
  });
}

/**
 * Agent-task state is deliberately schema-replaced. Older records are not
 * interpreted as authority and are rejected in place; no compatibility
 * migration may turn an unbound record into a current claim.
 */
function rejectLegacyAgentTasks(records: readonly unknown[]): readonly unknown[] {
  for (const record of records) {
    if (typeof record !== "object" || record === null || Array.isArray(record)) throw new Error("corrupt");
    const value = record as { version?: unknown };
    if (value.version !== 14) throw new Error("legacy_schema");
  }
  return records;
}
