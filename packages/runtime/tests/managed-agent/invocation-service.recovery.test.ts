import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineManagedAgentInvocationRequest, evaluateManagedAgentAdmission, type ManagedAgentInvocationRecord } from "@kilnai/core/agents";
import { ManagedFilesystemRuntimeRecoveryStore, ManagedAgentLeaseAcquireError, ManagedAgentRuntimeAdmissionError, ManagedAgentRuntimeRecoveryDaemon, ManagedAgentWorktreeReviewRequiredError, RuntimeManagedAgentInvocationService, validateManagedAgentRuntimeRecoveryCheckpoint } from "../../src/agents/managed-invocation/index.js";
import type { ManagedAgentRuntimeAdapter, ManagedAgentRuntimeInvocationResult, ManagedAgentRuntimeRecoveryCheckpoint } from "../../src/agents/managed-invocation/index.js";
import { requireCompletedInvocation, makeSnapshotInput, makeRequest, makeDescriptor, makeWriteDescriptor, makeIsolatedWorktreeRequest, makeRecord, makeRecordForRequest, deferred, flushMicrotasks, makeRecoveryStore } from "./invocation-service-test-fixture.js";

describe("RuntimeManagedAgentInvocationService recovery", () => {
  it("recovers stale invocations by aborting adapters, releasing leases, and suppressing late success", async () => {
    const request = makeIsolatedWorktreeRequest();
    const terminal = deferred<ManagedAgentInvocationRecord>();
    let adapterSignal: AbortSignal | undefined;
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/write-1/worktree-lease",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/worktree-cleanup",
        ],
      })),
    };
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/write-1/artifact-directory",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/artifact-directory-cleanup",
        ],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ abortSignal }) => {
        adapterSignal = abortSignal;
        await terminal.promise;
        return makeRecordForRequest(request);
      }),
    };
    const service = new RuntimeManagedAgentInvocationService({
      artifactDirectoryLeaseManager,
      worktreeLeaseManager,
    });

    const started = await service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    expect(adapterSignal?.aborted).toBe(false);

    const recovered = await service.recoverStaleInvocations({
      staleAfterMs: 1,
      now: new Date(Date.now() + 10_000),
      reason: "Managed invocation heartbeat expired.",
    });
    const joined = await service.join("write-1");

    expect(recovered.recovered).toHaveLength(1);
    expect(adapterSignal?.aborted).toBe(true);
    expect(artifactDirectoryLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.lifecycleState).toBe("stale");
    expect(joined.record.resultHandoff?.summary).toBe("Managed invocation heartbeat expired.");
    expect(joined.record.resourceLease).toEqual({
      leaseId: "write-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "released",
      cleanupStatus: "completed",
      workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/write-1",
      workingDirectoryMode: "isolated-worktree",
      resourceUris: [
        "kiln://artifacts/write-1/worktree-lease",
        "kiln://artifacts/write-1/artifact-directory",
      ],
      diagnosticUris: [
        "kiln://artifacts/write-1/artifact-directory-cleanup",
        "kiln://artifacts/write-1/worktree-cleanup",
      ],
    });

    terminal.resolve(makeRecordForRequest(request));
    await flushMicrotasks();
    expect(service.status("write-1")?.record?.lifecycleState).toBe("stale");
  });

  it("suppresses late adapter rejection after stale recovery", async () => {
    const request = makeIsolatedWorktreeRequest();
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/write-1/worktree-lease",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/worktree-cleanup",
        ],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async () => {
        await terminal.promise;
        return makeRecordForRequest(request);
      }),
    };
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    await service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    await service.recoverStaleInvocations({
      staleAfterMs: 1,
      now: new Date(Date.now() + 10_000),
      reason: "Managed invocation heartbeat expired.",
    });
    const joined = await service.join("write-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.lifecycleState).toBe("stale");

    terminal.reject(new Error("adapter reported failure after stale recovery"));
    await flushMicrotasks();
    expect(service.status("write-1")?.record?.lifecycleState).toBe("stale");
    expect(service.status("write-1")?.error).toBeUndefined();
  });

  it("waits for stale cleanup evidence before publishing a late adapter result", async () => {
    const request = makeIsolatedWorktreeRequest();
    const adapterTerminal = deferred<ManagedAgentInvocationRecord>();
    const releaseGate = deferred<void>();
    let joined: ManagedAgentRuntimeInvocationResult | undefined;
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/write-1/worktree-lease",
        ],
      })),
      release: vi.fn(async ({ lease }) => {
        await releaseGate.promise;
        return {
          ...lease,
          healthStatus: "released" as const,
          cleanupStatus: "completed" as const,
          diagnosticUris: [
            ...lease.diagnosticUris,
            "kiln://artifacts/write-1/worktree-cleanup",
          ],
        };
      }),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async () => {
        await adapterTerminal.promise;
        return makeRecordForRequest(request);
      }),
    };
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    await service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    const recoveredPromise = service.recoverStaleInvocations({
      staleAfterMs: 1,
      now: new Date(Date.now() + 10_000),
      reason: "Managed invocation heartbeat expired.",
    });
    await flushMicrotasks();
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);

    const joinPromise = service.join("write-1").then((result) => {
      joined = result;
      return result;
    });
    adapterTerminal.resolve(makeRecordForRequest(request));
    await flushMicrotasks();

    expect(joined).toBeUndefined();
    expect(service.status("write-1")?.record).toBeUndefined();
    expect(service.list()[0]?.record).toBeUndefined();

    releaseGate.resolve();
    await recoveredPromise;
    const completed = await joinPromise;

    expect(completed.status).toBe("completed");
    if (completed.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(completed.record.lifecycleState).toBe("stale");
    expect(completed.record.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: ["kiln://artifacts/write-1/worktree-cleanup"],
    });
    expect(service.status("write-1")?.record?.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: ["kiln://artifacts/write-1/worktree-cleanup"],
    });
    expect(service.list()[0]?.record?.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: ["kiln://artifacts/write-1/worktree-cleanup"],
    });
  });

  it("recovers stale invocations during lease acquisition without invoking the adapter", async () => {
    const acquireGate = deferred<void>();
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }) => {
        await acquireGate.promise;
        return {
          ...lease,
          cleanupStatus: "pending" as const,
          resourceUris: ["kiln://artifacts/invocation-1/artifact-directory"],
        };
      }),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: ["kiln://artifacts/invocation-1/artifact-directory-cleanup"],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

    const startedPromise = service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    const recovered = await service.recoverStaleInvocations({
      staleAfterMs: 1,
      now: new Date(Date.now() + 10_000),
      reason: "Managed invocation heartbeat expired before lease acquisition completed.",
    });

    expect(recovered.recovered).toHaveLength(1);
    expect(adapter.invoke).not.toHaveBeenCalled();

    acquireGate.resolve();
    const started = await startedPromise;
    const joined = await service.join("invocation-1");

    expect(started.status).toBe("started");
    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(artifactDirectoryLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(joined.record.lifecycleState).toBe("stale");
    expect(joined.record.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
      resourceUris: ["kiln://artifacts/invocation-1/artifact-directory"],
      diagnosticUris: ["kiln://artifacts/invocation-1/artifact-directory-cleanup"],
    });
  });

  it("keeps stale recovery latched when a later lease acquisition stage rejects", async () => {
    const request = makeIsolatedWorktreeRequest();
    const acquireGate = deferred<void>();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/write-1/worktree-lease",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/worktree-cleanup",
        ],
      })),
    };
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async () => {
        await acquireGate.promise;
        throw new Error("artifact directory root unavailable after worktree acquire");
      }),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({
      artifactDirectoryLeaseManager,
      worktreeLeaseManager,
    });

    const startedPromise = service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    await flushMicrotasks();

    const recovered = await service.recoverStaleInvocations({
      staleAfterMs: 1,
      now: new Date(Date.now() + 10_000),
      reason: "Managed invocation heartbeat expired during lease acquisition.",
    });

    expect(recovered.recovered).toHaveLength(1);
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);

    let joinedBeforeAcquire: ManagedAgentRuntimeInvocationResult | undefined;
    const joinBeforeAcquirePromise = service.join("write-1").then((result) => {
      joinedBeforeAcquire = result;
      return result;
    });
    await flushMicrotasks();
    const resolvedJoinBeforeAcquire = joinedBeforeAcquire !== undefined;

    acquireGate.resolve();
    const started = await startedPromise;
    const joined = await joinBeforeAcquirePromise;

    expect(resolvedJoinBeforeAcquire).toBe(true);
    expect(started.status).toBe("started");
    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(artifactDirectoryLeaseManager.release).not.toHaveBeenCalled();
    expect(joined.record.lifecycleState).toBe("stale");
    expect(joined.record.resourceLease).toEqual({
      leaseId: "write-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "released",
      cleanupStatus: "completed",
      workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/write-1",
      workingDirectoryMode: "isolated-worktree",
      resourceUris: ["kiln://artifacts/write-1/worktree-lease"],
      diagnosticUris: ["kiln://artifacts/write-1/worktree-cleanup"],
    });
  });

  it("releases later acquired lease stages after stale recovery already cleaned earlier stages", async () => {
    const request = makeIsolatedWorktreeRequest();
    const acquireGate = deferred<void>();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/write-1/worktree-lease",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/worktree-cleanup",
        ],
      })),
    };
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }) => {
        await acquireGate.promise;
        return {
          ...lease,
          cleanupStatus: "pending" as const,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/write-1/artifact-directory",
          ],
        };
      }),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/artifact-directory-cleanup",
        ],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({
      artifactDirectoryLeaseManager,
      worktreeLeaseManager,
    });

    const startedPromise = service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    await flushMicrotasks();

    await service.recoverStaleInvocations({
      staleAfterMs: 1,
      now: new Date(Date.now() + 10_000),
      reason: "Managed invocation heartbeat expired during lease acquisition.",
    });

    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(artifactDirectoryLeaseManager.release).not.toHaveBeenCalled();

    acquireGate.resolve();
    const started = await startedPromise;
    const joined = await service.join("write-1");

    expect(started.status).toBe("started");
    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(artifactDirectoryLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(joined.record.lifecycleState).toBe("stale");
    expect(joined.record.resourceLease).toEqual({
      leaseId: "write-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "released",
      cleanupStatus: "completed",
      workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/write-1",
      workingDirectoryMode: "isolated-worktree",
      resourceUris: [
        "kiln://artifacts/write-1/worktree-lease",
        "kiln://artifacts/write-1/artifact-directory",
      ],
      diagnosticUris: [
        "kiln://artifacts/write-1/worktree-cleanup",
        "kiln://artifacts/write-1/artifact-directory-cleanup",
      ],
    });
  });

  it("preserves dirty worktrees as leaked evidence during stale recovery", async () => {
    const request = makeIsolatedWorktreeRequest();
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/write-1/worktree-lease",
        ],
      })),
      release: vi.fn(async () => {
        throw new Error("worktree has uncommitted child changes");
      }),
    };
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/write-1/artifact-directory",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/artifact-directory-cleanup",
        ],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async () => {
        await terminal.promise;
        return makeRecordForRequest(request);
      }),
    };
    const service = new RuntimeManagedAgentInvocationService({
      artifactDirectoryLeaseManager,
      worktreeLeaseManager,
    });

    await service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    await service.recoverStaleInvocations({
      staleAfterMs: 1,
      now: new Date(Date.now() + 10_000),
      reason: "Managed invocation heartbeat expired.",
    });
    const joined = await service.join("write-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.lifecycleState).toBe("stale");
    expect(joined.record.resourceLease).toEqual({
      leaseId: "write-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "leaked",
      cleanupStatus: "failed",
      workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/write-1",
      workingDirectoryMode: "isolated-worktree",
      resourceUris: [
        "kiln://artifacts/write-1/worktree-lease",
        "kiln://artifacts/write-1/artifact-directory",
      ],
      diagnosticUris: [
        "kiln://artifacts/write-1/artifact-directory-cleanup",
        "kiln://artifacts/write-1/worktree-lease-cleanup-failed",
      ],
    });
    expect(joined.record.diagnostics).toContainEqual({
      uri: "kiln://artifacts/write-1/worktree-lease-cleanup-failed",
      kind: "cleanup",
    });
  });

  it("persists runtime lease recovery checkpoints and deletes them after successful cleanup", async () => {
    const request = makeIsolatedWorktreeRequest();
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const recoveryStore = makeRecoveryStore();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/write-1/worktree-lease",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/worktree-cleanup",
        ],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => {
        await terminal.promise;
        return makeRecordForRequest(request, admission.capabilitySnapshot);
      }),
    };
    const service = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager,
    });

    const started = await service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    expect(recoveryStore.entries.get("write-1")).toMatchObject({
      lifecycleState: "running",
      acquiredLeaseStages: ["worktree"],
      releasedLeaseStages: [],
      runtimeLease: {
        cleanupStatus: "pending",
        resourceUris: ["kiln://artifacts/write-1/worktree-lease"],
      },
    });

    terminal.resolve(makeRecordForRequest(request, started.status === "started" ? started.decision.capabilitySnapshot : undefined));
    const joined = await service.join("write-1");

    expect(joined.status).toBe("completed");
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(recoveryStore.delete).toHaveBeenCalledWith("write-1");
    expect(recoveryStore.entries.has("write-1")).toBe(false);
  });

  it("persists admitted lease evidence for side-effected acquire checkpoints", async () => {
    const request = makeIsolatedWorktreeRequest();
    const recoveryStore = makeRecoveryStore();
    const worktreeLeaseManager = {
      acquire: vi.fn(async () => {
        throw new ManagedAgentLeaseAcquireError("git worktree add failed after creating files", true);
      }),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/worktree-cleanup",
        ],
      })),
    };
    const service = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager,
    });

    await expect(service.start(request, {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
    }, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("git worktree add failed");

    expect(recoveryStore.save.mock.calls[0]?.[0]).toMatchObject({
      lifecycleState: "running",
      acquiredLeaseStages: ["worktree"],
      runtimeLease: {
        leaseId: "write-1:resource-lease",
        workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/write-1",
        resourceUris: [],
      },
      runtimeLeaseForRelease: {
        leaseId: "write-1:resource-lease",
      },
    });
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(recoveryStore.delete).toHaveBeenCalledWith("write-1");
  });

  it("stores runtime recovery checkpoints in filesystem manifests", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "kiln-managed-recovery-"));
    try {
      const request = makeIsolatedWorktreeRequest();
      const terminal = deferred<ManagedAgentInvocationRecord>();
      const recoveryStore = new ManagedFilesystemRuntimeRecoveryStore({ rootPath });
      const worktreeLeaseManager = {
        acquire: vi.fn(async ({ lease }) => ({
          ...lease,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/write-1/worktree-lease",
          ],
        })),
        release: vi.fn(async ({ lease }) => ({
          ...lease,
          healthStatus: "released" as const,
          cleanupStatus: "completed" as const,
          diagnosticUris: [
            ...lease.diagnosticUris,
            "kiln://artifacts/write-1/worktree-cleanup",
          ],
        })),
      };
      const service = new RuntimeManagedAgentInvocationService({
        recoveryStore,
        worktreeLeaseManager,
      });
      const started = await service.start(request, {
        descriptor: makeWriteDescriptor(),
        invoke: vi.fn(async ({ request, admission }) => {
          await terminal.promise;
          return makeRecordForRequest(request, admission.capabilitySnapshot);
        }),
      }, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      });

      const checkpoints = await recoveryStore.listRecoverable();

      expect(started.status).toBe("started");
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0]).toMatchObject({
        lifecycleState: "running",
        request: { invocationId: "write-1" },
        acquiredLeaseStages: ["worktree"],
        runtimeLease: {
          cleanupStatus: "pending",
          resourceUris: ["kiln://artifacts/write-1/worktree-lease"],
        },
      });
      const parsedCheckpoint = JSON.parse(JSON.stringify(checkpoints[0])) as ManagedAgentRuntimeRecoveryCheckpoint;
      const forgedCommunicationCheckpoint: ManagedAgentRuntimeRecoveryCheckpoint = {
        ...parsedCheckpoint,
        request: {
          ...parsedCheckpoint.request,
          providerRoute: {
            ...parsedCheckpoint.request.providerRoute,
            communicationIntent: {
              version: "v1",
              intent: { responseDetail: "detailed", requiredContent: [], responseSkills: [], onUnsupported: "deny" },
              authority: { responseDetail: "invocation", responseSkills: [], onUnsupported: "invocation", requiredContent: {} },
              identity: `sha256:${"0".repeat(64)}`,
            },
          },
        },
      };
      expect(() => validateManagedAgentRuntimeRecoveryCheckpoint(forgedCommunicationCheckpoint)).toThrow(
        "Managed invocation communication intent must be a resolved v1 contract",
      );

      terminal.resolve(makeRecordForRequest(
        request,
        started.status === "started" ? started.decision.capabilitySnapshot : undefined,
      ));
      await service.join("write-1");

      expect(await recoveryStore.listRecoverable()).toEqual([]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("quarantines malformed filesystem recovery checkpoints instead of adopting them", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "kiln-managed-recovery-"));
    try {
      const recoveryStore = new ManagedFilesystemRuntimeRecoveryStore({ rootPath });

      await mkdir(rootPath, { recursive: true });
      await mkdir(join(rootPath, "directory.json"));
      await writeFile(join(rootPath, "malformed.json"), JSON.stringify({ version: 2 }), "utf-8");

      const checkpoints = await recoveryStore.listRecoverable();

      expect(checkpoints).toEqual([]);
      const quarantined = await readdir(join(rootPath, "quarantine"));
      const checkpointFile = quarantined.find((fileName) => fileName.endsWith(".malformed.json"));
      const directoryFile = quarantined.find((fileName) => fileName.endsWith(".directory.json"));
      expect(checkpointFile).toBeDefined();
      expect(directoryFile).toBeDefined();
      expect(quarantined).toContain(`${checkpointFile}.metadata.json`);
      expect(quarantined).toContain(`${directoryFile}.metadata.json`);
      const metadata = JSON.parse(
        await readFile(join(rootPath, "quarantine", `${checkpointFile}.metadata.json`), "utf-8"),
      ) as Record<string, unknown>;
      expect(metadata).toMatchObject({
        originalFileName: "malformed.json",
      });
      expect(String(metadata.reason)).toContain("Managed runtime recovery checkpoint lifecycle state");
      const directoryMetadata = JSON.parse(
        await readFile(join(rootPath, "quarantine", `${directoryFile}.metadata.json`), "utf-8"),
      ) as Record<string, unknown>;
      expect(directoryMetadata).toMatchObject({
        originalFileName: "directory.json",
      });
      expect(String(directoryMetadata.reason)).toContain("Managed runtime recovery checkpoint must be a regular file");
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("does not abort recovery when an invalid checkpoint disappears during quarantine", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "kiln-managed-recovery-"));
    try {
      const recoveryStore = new ManagedFilesystemRuntimeRecoveryStore({ rootPath });
      const recoveryStoreInternals = recoveryStore as unknown as {
        readonly quarantineInvalidCheckpoint: (
          rootPath: string,
          fileName: string,
          checkpointPath: string,
          error: unknown,
        ) => Promise<void>;
      };

      await mkdir(rootPath, { recursive: true });

      await expect(recoveryStoreInternals.quarantineInvalidCheckpoint(
        rootPath,
        "raced.json",
        join(rootPath, "raced.json"),
        new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint is invalid"),
      )).resolves.toBeUndefined();
      expect(await readdir(join(rootPath, "quarantine"))).toEqual([]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("quarantines stale recovery checkpoints with legacy provenance instead of adopting them", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "kiln-managed-recovery-"));
    try {
      const request = makeIsolatedWorktreeRequest();
      const terminal = deferred<ManagedAgentInvocationRecord>();
      const recoveryStore = new ManagedFilesystemRuntimeRecoveryStore({ rootPath });
      const worktreeLeaseManager = {
        acquire: vi.fn(async ({ lease }) => lease),
        release: vi.fn(async ({ lease }) => ({
          ...lease,
          healthStatus: "released" as const,
          cleanupStatus: "completed" as const,
        })),
      };
      const service = new RuntimeManagedAgentInvocationService({
        recoveryStore,
        worktreeLeaseManager,
      });
      const started = await service.start(request, {
        descriptor: makeWriteDescriptor(),
        invoke: vi.fn(async ({ request, admission }) => {
          await terminal.promise;
          return makeRecordForRequest(request, admission.capabilitySnapshot);
        }),
      }, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      });
      expect(started.status).toBe("started");

      type RecoveryCheckpointJson = {
        decision: {
          capabilitySnapshot: Record<string, unknown>;
        };
        request: {
          authority: Record<string, unknown>;
        };
      };
      const originalPath = join(rootPath, "write-1.json");
      const validCheckpoint = JSON.parse(await readFile(originalPath, "utf-8")) as RecoveryCheckpointJson;
      const missingRouteSource = JSON.parse(JSON.stringify(validCheckpoint)) as RecoveryCheckpointJson;
      delete missingRouteSource.decision.capabilitySnapshot.routeSource;
      const explicitRouteTimeoutSource = JSON.parse(JSON.stringify(validCheckpoint)) as RecoveryCheckpointJson;
      explicitRouteTimeoutSource.request.authority.timeoutSource = "explicit-route";
      const defaultTimeoutSource = JSON.parse(JSON.stringify(validCheckpoint)) as RecoveryCheckpointJson;
      defaultTimeoutSource.request.authority.timeoutSource = "default";
      const requestTimeoutSource = JSON.parse(JSON.stringify(validCheckpoint)) as RecoveryCheckpointJson;
      requestTimeoutSource.request.authority.timeoutSource = "request";

      await rm(originalPath, { force: true });
      await writeFile(join(rootPath, "missing-route-source.json"), JSON.stringify(missingRouteSource), "utf-8");
      await writeFile(join(rootPath, "explicit-route-timeout-source.json"), JSON.stringify(explicitRouteTimeoutSource), "utf-8");
      await writeFile(join(rootPath, "default-timeout-source.json"), JSON.stringify(defaultTimeoutSource), "utf-8");
      await writeFile(join(rootPath, "request-timeout-source.json"), JSON.stringify(requestTimeoutSource), "utf-8");

      const checkpoints = await recoveryStore.listRecoverable();

      expect(checkpoints.map((checkpoint) => checkpoint.request.authority.timeoutSource)).toEqual([
        "default",
        "explicit-route",
      ]);
      const quarantined = await readdir(join(rootPath, "quarantine"));
      expect(quarantined.some((fileName) => fileName.endsWith(".missing-route-source.json"))).toBe(true);
      expect(quarantined.some((fileName) => fileName.endsWith(".request-timeout-source.json"))).toBe(true);
      const metadataReasons = (await Promise.all(
        quarantined
          .filter((fileName) => fileName.endsWith(".metadata.json"))
          .map(async (fileName) => JSON.parse(
            await readFile(join(rootPath, "quarantine", fileName), "utf-8"),
          ) as Record<string, unknown>),
      )).map((metadata) => String(metadata.reason)).join("\n");
      expect(metadataReasons).toContain("Unsupported managed capability snapshot route source");
      expect(metadataReasons).toContain("timeout source");

      terminal.resolve(makeRecordForRequest(
        request,
        started.status === "started" ? started.decision.capabilitySnapshot : undefined,
      ));
      await service.join("write-1");
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("recovers persisted runtime lease checkpoints after restart and releases acquired stages", async () => {
    const request = makeIsolatedWorktreeRequest();
    const recoveryStore = makeRecoveryStore();
    const firstTerminal = deferred<ManagedAgentInvocationRecord>();
    const firstWorktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/write-1/worktree-lease",
        ],
      })),
      release: vi.fn(async ({ lease }) => lease),
    };
    const firstAdapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => {
        await firstTerminal.promise;
        return makeRecordForRequest(request, admission.capabilitySnapshot);
      }),
    };
    const firstService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: firstWorktreeLeaseManager,
    });
    await firstService.start(request, firstAdapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    const restartedWorktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => lease),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/worktree-cleanup",
        ],
      })),
    };
    const restartedService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: restartedWorktreeLeaseManager,
    });

    const recovered = await restartedService.recoverPersistedInvocations({
      now: new Date("2026-05-07T08:10:00.000Z"),
      reason: "Runtime restarted before managed invocation completed.",
    });
    const joined = await restartedService.join("write-1");
    const secondRecovery = await restartedService.recoverPersistedInvocations({
      now: new Date("2026-05-07T08:11:00.000Z"),
    });

    expect(recovered.recovered).toHaveLength(1);
    expect(recovered.recovered[0]).toMatchObject({
      invocationId: "write-1",
      lifecycleState: "recovered",
      record: {
        lifecycleState: "recovered",
        resourceLease: {
          healthStatus: "released",
          cleanupStatus: "completed",
          resourceUris: ["kiln://artifacts/write-1/worktree-lease"],
          diagnosticUris: ["kiln://artifacts/write-1/worktree-cleanup"],
        },
      },
    });
    expect(joined.status).toBe("completed");
    expect(requireCompletedInvocation(joined).record.lifecycleState).toBe("recovered");
    expect(restartedWorktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(recoveryStore.entries.has("write-1")).toBe(false);
    expect(secondRecovery.recovered).toEqual([]);
  });

  // Roadmap 01 Slice 3.1 - the external-runtime attachment identity is opaque.
  // Persistence, recovery, and re-admission must carry the operator's exact
  // string; a normalising round-trip would silently retarget a recovered
  // child at a different physical instance.
  describe("external runtime attachment recovery and replay (Roadmap 01 Slice 3.1)", () => {
    const WHITESPACE_ATTACHMENT = {
      kind: "external-runtime" as const,
      runtimeId: " mcp-external-runtime ",
      attachmentId: " instance-a",
    };

    async function startAttachedInvocation(
      recoveryStore: ReturnType<typeof makeRecoveryStore>,
      attachment: typeof WHITESPACE_ATTACHMENT,
    ) {
      const request = defineManagedAgentInvocationRequest({
        ...makeIsolatedWorktreeRequest(),
        externalRuntimeAttachment: attachment,
      });
      const terminal = deferred<ManagedAgentInvocationRecord>();
      const service = new RuntimeManagedAgentInvocationService({
        recoveryStore,
        worktreeLeaseManager: {
          acquire: vi.fn(async ({ lease }) => lease),
          release: vi.fn(async ({ lease }) => lease),
        },
      });
      const started = await service.start(request, {
        descriptor: makeWriteDescriptor(),
        invoke: vi.fn(async ({ request: invoked, admission }) => {
          await terminal.promise;
          return makeRecordForRequest(invoked, admission.capabilitySnapshot);
        }),
      }, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
        externalRuntimeAttachment: attachment,
      });
      return { request, service, started };
    }

    it("persists the attachment unnormalised in the recovery checkpoint request and capability snapshot", async () => {
      const recoveryStore = makeRecoveryStore();
      const { started } = await startAttachedInvocation(recoveryStore, WHITESPACE_ATTACHMENT);

      expect(started.status).toBe("started");
      const checkpoint = recoveryStore.entries.get("write-1");
      expect(checkpoint?.request.externalRuntimeAttachment).toEqual(WHITESPACE_ATTACHMENT);
      expect(checkpoint?.decision.status).toBe("admitted");
      if (checkpoint?.decision.status === "admitted") {
        expect(checkpoint.decision.capabilitySnapshot.externalRuntimeAttachment).toEqual(WHITESPACE_ATTACHMENT);
      }
      expect(validateManagedAgentRuntimeRecoveryCheckpoint(
        JSON.parse(JSON.stringify(checkpoint)) as unknown,
      ).request.externalRuntimeAttachment).toEqual(WHITESPACE_ATTACHMENT);
    });

    it("preserves the admitted attachment through restart recovery and its replayed capability snapshot", async () => {
      const recoveryStore = makeRecoveryStore();
      await startAttachedInvocation(recoveryStore, WHITESPACE_ATTACHMENT);

      const restartedService = new RuntimeManagedAgentInvocationService({
        recoveryStore,
        worktreeLeaseManager: {
          acquire: vi.fn(async ({ lease }) => lease),
          release: vi.fn(async ({ lease }) => ({
            ...lease,
            healthStatus: "released" as const,
            cleanupStatus: "completed" as const,
          })),
        },
      });
      const recovered = await restartedService.recoverPersistedInvocations({
        now: new Date("2026-05-07T08:10:00.000Z"),
      });
      const joined = await restartedService.join("write-1");

      expect(recovered.recovered[0]?.record?.capabilitySnapshot.externalRuntimeAttachment).toEqual(WHITESPACE_ATTACHMENT);
      expect(recovered.recovered[0]?.request.externalRuntimeAttachment).toEqual(WHITESPACE_ATTACHMENT);
      expect(joined.status).toBe("completed");
      expect(requireCompletedInvocation(joined).record.capabilitySnapshot.externalRuntimeAttachment).toEqual(WHITESPACE_ATTACHMENT);
    });

    it("rejects re-admission when the admitted snapshot attachment differs from the request's only by peripheral whitespace", async () => {
      const request = defineManagedAgentInvocationRequest({
        ...makeIsolatedWorktreeRequest(),
        externalRuntimeAttachment: { kind: "external-runtime", runtimeId: "mcp-external-runtime", attachmentId: "instance-a" },
      });
      const admission = evaluateManagedAgentAdmission(request, makeWriteDescriptor(), {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
        externalRuntimeAttachment: { kind: "external-runtime", runtimeId: "mcp-external-runtime", attachmentId: "instance-a" },
      });
      expect(admission.status).toBe("admitted");
      if (admission.status !== "admitted") return;

      const adapter: ManagedAgentRuntimeAdapter = {
        descriptor: makeWriteDescriptor(),
        invoke: vi.fn(async ({ request: invoked, admission: admitted }) =>
          makeRecordForRequest(invoked, admitted.capabilitySnapshot)),
      };
      const service = new RuntimeManagedAgentInvocationService({
        worktreeLeaseManager: {
          acquire: vi.fn(async ({ lease }) => lease),
          release: vi.fn(async ({ lease }) => lease),
        },
      });

      await expect(service.invokeAdmitted({
        request,
        adapter,
        admission: {
          ...admission,
          capabilitySnapshot: {
            ...admission.capabilitySnapshot,
            externalRuntimeAttachment: { kind: "external-runtime" as const, runtimeId: "mcp-external-runtime", attachmentId: "instance-a " },
          },
        },
      })).rejects.toThrow(/externalRuntimeAttachment\.mismatch|must match the current core admission decision/);
      expect(adapter.invoke).not.toHaveBeenCalled();
    });
  });

  it("re-evaluates managed child authority freshness during persisted replay", async () => {
    const request = defineManagedAgentInvocationRequest({
      ...makeIsolatedWorktreeRequest(),
      executionIntent: { attendance: "unattended", lifecycle: "resume" },
    });
    const recoveryStore = makeRecoveryStore();
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const leaseManager = {
      acquire: vi.fn(async ({ lease }) => lease),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
      })),
    };
    const firstService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: leaseManager,
      clock: () => new Date("2026-05-07T08:00:30.000Z"),
      authorityObserver: {
        observe: vi.fn().mockResolvedValue({
          approval: "on-request",
          sandbox: "workspace-write",
          source: "runtime-observation",
          proof: "proven",
          observedAt: "2026-05-07T08:00:00.000Z",
          validUntil: "2026-05-07T08:01:00.000Z",
        }),
      },
    });
    await firstService.start(request, {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => {
        await terminal.promise;
        return makeRecordForRequest(request, admission.capabilitySnapshot);
      }),
    }, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    const restartedService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: leaseManager,
    });
    const recovered = await restartedService.recoverPersistedInvocations({
      now: new Date("2026-05-07T08:10:00.000Z"),
    });
    const joined = await restartedService.join(request.invocationId);

    expect(recovered.recovered[0]).toMatchObject({ lifecycleState: "failed" });
    expect(joined).toMatchObject({
      status: "completed",
      record: {
        lifecycleState: "failed",
        resultHandoff: { summary: expect.stringContaining("stale-evidence") },
      },
    });
  });

  it("daemon startup recovers persisted checkpoints through the runtime service and filesystem store", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "kiln-managed-daemon-recovery-"));
    try {
      const request = makeIsolatedWorktreeRequest();
      const recoveryStore = new ManagedFilesystemRuntimeRecoveryStore({ rootPath });
      const terminal = deferred<ManagedAgentInvocationRecord>();
      const firstService = new RuntimeManagedAgentInvocationService({
        recoveryStore,
        worktreeLeaseManager: {
          acquire: vi.fn(async ({ lease }) => ({
            ...lease,
            resourceUris: [
              ...lease.resourceUris,
              "kiln://artifacts/write-1/worktree-lease",
            ],
          })),
          release: vi.fn(async ({ lease }) => lease),
        },
      });

      await firstService.start(request, {
        descriptor: makeWriteDescriptor(),
        invoke: vi.fn(async ({ request, admission }) => {
          await terminal.promise;
          return makeRecordForRequest(request, admission.capabilitySnapshot);
        }),
      }, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      });

      expect(await recoveryStore.listRecoverable()).toHaveLength(1);

      const release = vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/worktree-cleanup",
        ],
      }));
      const restartedService = new RuntimeManagedAgentInvocationService({
        recoveryStore,
        worktreeLeaseManager: {
          acquire: vi.fn(async ({ lease }) => lease),
          release,
        },
      });
      const callbacks: Array<() => void> = [];
      const delays: number[] = [];
      const setTimeoutImpl = vi.fn((callback: (...args: never[]) => void, delay?: number) => {
        callbacks.push(() => {
          callback();
        });
        delays.push(delay ?? 0);
        const handle = setTimeout(() => undefined, 0);
        clearTimeout(handle);
        return handle;
      }) as unknown as typeof setTimeout;
      const clearTimeoutImpl: typeof clearTimeout = () => undefined;
      const daemon = new ManagedAgentRuntimeRecoveryDaemon({
        service: restartedService,
        staleAfterMs: 60000,
        sweepIntervalMs: 2500,
        now: () => new Date("2026-05-07T08:10:00.000Z"),
        setTimeoutImpl,
        clearTimeoutImpl,
      });

      daemon.start();
      callbacks.shift()?.();
      for (let index = 0; index < 20 && release.mock.calls.length === 0; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const joined = await restartedService.join("write-1");

      expect(joined.status).toBe("completed");
      if (joined.status !== "completed") {
        throw new Error("expected daemon recovery to complete");
      }
      expect(joined.record.lifecycleState).toBe("recovered");
      expect(joined.record.resourceLease).toMatchObject({
        healthStatus: "released",
        cleanupStatus: "completed",
        resourceUris: ["kiln://artifacts/write-1/worktree-lease"],
        diagnosticUris: ["kiln://artifacts/write-1/worktree-cleanup"],
      });
      expect(release).toHaveBeenCalledTimes(1);
      expect(await recoveryStore.listRecoverable()).toEqual([]);
      expect(delays).toEqual([0, 2500]);

      daemon.stop();
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("rejects checkpoints missing runtime lease evidence instead of adopting them", async () => {
    const request = makeIsolatedWorktreeRequest();
    const recoveryStore = makeRecoveryStore();
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const firstService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: {
        acquire: vi.fn(async ({ lease }) => lease),
        release: vi.fn(async ({ lease }) => lease),
      },
    });

    await firstService.start(request, {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => {
        await terminal.promise;
        return makeRecordForRequest(request, admission.capabilitySnapshot);
      }),
    }, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    const checkpoint = recoveryStore.entries.get("write-1");
    if (checkpoint === undefined) {
      throw new Error("expected runtime acquire to persist recovery checkpoint");
    }
    const { runtimeLease: _runtimeLease, runtimeLeaseForRelease: _runtimeLeaseForRelease, ...checkpointWithoutRuntimeLease } = checkpoint;
    recoveryStore.entries.set("write-1", checkpointWithoutRuntimeLease as unknown as ManagedAgentRuntimeRecoveryCheckpoint);
    const release = vi.fn(async ({ lease }) => ({
      ...lease,
      healthStatus: "released" as const,
      cleanupStatus: "completed" as const,
      diagnosticUris: [
        ...lease.diagnosticUris,
        "kiln://artifacts/write-1/worktree-cleanup",
      ],
    }));
    const restartedService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: {
        acquire: vi.fn(async ({ lease }) => lease),
        release,
      },
    });

    await expect(restartedService.recoverPersistedInvocations({
      now: new Date("2026-05-07T08:10:00.000Z"),
    })).rejects.toBeInstanceOf(ManagedAgentRuntimeAdmissionError);

    expect(release).not.toHaveBeenCalled();
    expect(recoveryStore.entries.has("write-1")).toBe(true);
  });

  it("rejects terminal recovery checkpoints missing terminal records instead of resurrecting them", async () => {
    const request = makeIsolatedWorktreeRequest();
    const recoveryStore = makeRecoveryStore();
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const firstService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: {
        acquire: vi.fn(async ({ lease }) => lease),
        release: vi.fn(async ({ lease }) => lease),
      },
    });

    await firstService.start(request, {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => {
        await terminal.promise;
        return makeRecordForRequest(request, admission.capabilitySnapshot);
      }),
    }, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    const checkpoint = recoveryStore.entries.get("write-1");
    if (checkpoint === undefined) {
      throw new Error("expected runtime acquire to persist recovery checkpoint");
    }
    const terminalCheckpointWithoutRecord = {
      ...checkpoint,
      lifecycleState: "completed",
      finishedAt: "2026-05-07T08:01:00.000Z",
    };
    recoveryStore.entries.set("write-1", terminalCheckpointWithoutRecord as unknown as ManagedAgentRuntimeRecoveryCheckpoint);
    const release = vi.fn(async ({ lease }) => ({
      ...lease,
      healthStatus: "released" as const,
      cleanupStatus: "completed" as const,
    }));
    const restartedService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: {
        acquire: vi.fn(async ({ lease }) => lease),
        release,
      },
    });

    await expect(restartedService.recoverPersistedInvocations({
      now: new Date("2026-05-07T08:10:00.000Z"),
    })).rejects.toBeInstanceOf(ManagedAgentRuntimeAdmissionError);

    expect(release).not.toHaveBeenCalled();
    expect(recoveryStore.entries.has("write-1")).toBe(true);
  });

  it("rejects terminal recovery checkpoints when record lifecycle does not match checkpoint state", async () => {
    const request = makeIsolatedWorktreeRequest();
    const recoveryStore = makeRecoveryStore();
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const firstService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: {
        acquire: vi.fn(async ({ lease }) => lease),
        release: vi.fn(async ({ lease }) => lease),
      },
    });

    await firstService.start(request, {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => {
        await terminal.promise;
        return makeRecordForRequest(request, admission.capabilitySnapshot);
      }),
    }, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    const checkpoint = recoveryStore.entries.get("write-1");
    if (checkpoint === undefined) {
      throw new Error("expected runtime acquire to persist recovery checkpoint");
    }
    recoveryStore.entries.set("write-1", {
      ...checkpoint,
      lifecycleState: "stale",
      finishedAt: "2026-05-07T08:01:00.000Z",
      record: makeRecordForRequest(request, checkpoint.decision.capabilitySnapshot),
    });
    const release = vi.fn(async ({ lease }) => ({
      ...lease,
      healthStatus: "released" as const,
      cleanupStatus: "completed" as const,
    }));
    const restartedService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: {
        acquire: vi.fn(async ({ lease }) => lease),
        release,
      },
    });

    await expect(restartedService.recoverPersistedInvocations({
      now: new Date("2026-05-07T08:10:00.000Z"),
    })).rejects.toBeInstanceOf(ManagedAgentRuntimeAdmissionError);

    expect(release).not.toHaveBeenCalled();
    expect(recoveryStore.entries.has("write-1")).toBe(true);
  });

  it("preserves persisted recovery checkpoints when restart cleanup fails", async () => {
    const request = makeIsolatedWorktreeRequest();
    const recoveryStore = makeRecoveryStore();
    const firstService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: {
        acquire: vi.fn(async ({ lease }) => ({
          ...lease,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/write-1/worktree-lease",
          ],
        })),
        release: vi.fn(async ({ lease }) => lease),
      },
    });
    const terminal = deferred<ManagedAgentInvocationRecord>();
    await firstService.start(request, {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => {
        await terminal.promise;
        return makeRecordForRequest(request, admission.capabilitySnapshot);
      }),
    }, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    const restartedService = new RuntimeManagedAgentInvocationService({
      recoveryStore,
      worktreeLeaseManager: {
        acquire: vi.fn(async ({ lease }) => lease),
        release: vi.fn(async () => {
          throw new ManagedAgentWorktreeReviewRequiredError("Managed git worktree lease is dirty; preserving worktree for review");
        }),
      },
    });

    const recovered = await restartedService.recoverPersistedInvocations({
      now: new Date("2026-05-07T08:10:00.000Z"),
      reason: "Runtime restarted before managed invocation completed.",
    });

    expect(recovered.recovered).toHaveLength(1);
    expect(recovered.recovered[0]?.record?.resourceLease).toEqual({
      leaseId: "write-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "leaked",
      cleanupStatus: "failed",
      workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/write-1",
      workingDirectoryMode: "isolated-worktree",
      resourceUris: ["kiln://artifacts/write-1/worktree-lease"],
      diagnosticUris: [
        "kiln://artifacts/write-1/worktree-lease-cleanup-failed",
        "kiln://artifacts/write-1/worktree-review-required",
      ],
      worktreeReview: {
        status: "required",
        reason: "dirty-worktree-preserved",
        resourceUris: ["kiln://artifacts/write-1/worktree-review"],
        diagnosticUris: ["kiln://artifacts/write-1/worktree-review-required"],
      },
    });
    expect(recoveryStore.entries.get("write-1")).toMatchObject({
      lifecycleState: "recovered",
      runtimeLease: {
        healthStatus: "leaked",
        cleanupStatus: "failed",
        worktreeReview: {
          status: "required",
        },
      },
      record: {
        lifecycleState: "recovered",
      },
    });
  });

  it("does not recover fresh invocations and fails fast on invalid stale thresholds", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => {
        await terminal.promise;
        return makeRecord(admission.capabilitySnapshot);
      }),
    };
    const service = new RuntimeManagedAgentInvocationService();

    await expect(service.recoverStaleInvocations({ staleAfterMs: 0 })).rejects.toThrow("stale threshold");

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    const recovered = await service.recoverStaleInvocations({
      staleAfterMs: Number.MAX_SAFE_INTEGER,
      now: new Date(Date.now() + 10_000),
    });

    expect(recovered.recovered).toEqual([]);
    expect(service.status("invocation-1")?.lifecycleState).toBe("running");

    terminal.resolve(makeRecord(started.status === "started" ? started.decision.capabilitySnapshot : undefined));
    await service.join("invocation-1");
  });

  it("returns immutable snapshots from the runtime registry boundary", async () => {
    const request = makeRequest();
    let adapterRecord: ManagedAgentInvocationRecord | undefined;
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => {
        adapterRecord = makeRecord(admission.capabilitySnapshot);
        return adapterRecord;
      }),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(request, adapter, makeSnapshotInput());

    expect(started.status).toBe("started");
    if (started.status !== "started") {
      throw new Error("expected managed invocation to start");
    }

    (request as { agentId: string }).agentId = "mutated-request";
    (started.decision as { authorityProfileId: string }).authorityProfileId = "mutated-decision";
    (started.snapshot as { agentId: string }).agentId = "mutated-snapshot";
    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }

    (adapterRecord as { agentId: string }).agentId = "mutated-record";
    (joined.record as { agentId: string }).agentId = "mutated-result";

    const snapshot = service.status("invocation-1");
    expect(snapshot).toMatchObject({
      invocationId: "invocation-1",
      agentId: "agent-reviewer",
      lifecycleState: "completed",
      decision: { authorityProfileId: "foundation-readonly" },
    });
    expect(snapshot?.record?.agentId).toBe("agent-reviewer");
    expect(service.list()[0]).toMatchObject({
      invocationId: "invocation-1",
      lifecycleState: "completed",
      record: { agentId: "agent-reviewer" },
    });

    if (snapshot?.record) {
      (snapshot.record as { agentId: string }).agentId = "mutated-status-record";
    }
    expect(service.status("invocation-1")?.record?.agentId).toBe("agent-reviewer");
  });

});
