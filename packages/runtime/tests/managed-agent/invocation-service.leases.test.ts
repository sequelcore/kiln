import { describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineManagedAgentInvocationRecord, defineManagedAgentInvocationRequest, type ManagedAgentInvocationRecord } from "@kilnai/core/agents";
import { ManagedInMemoryDevServerPortLeaseManager, ManagedRuntimeEnvironmentLeaseManager, ManagedFilesystemArtifactDirectoryLeaseManager, ManagedGitWorktreeLeaseManager, ManagedAgentLeaseAcquireError, ManagedAgentWorktreeReviewRequiredError, ManagedRuntimeSandboxLeaseManager, RuntimeManagedAgentInvocationService, validateManagedAgentRuntimeRecoveryCheckpoint } from "../../src/agents/managed-invocation/index.js";
import type { ManagedAgentRuntimeAdapter, ManagedAgentRuntimeInvocationStartResult } from "../../src/agents/managed-invocation/index.js";
import { requireCompletedInvocation, makeSnapshotInput, makeRequest, makeDescriptor, makeWriteDescriptor, makeApprovedWriteRequest, makeIsolatedWorktreeRequest, makeIsolatedWorktreeRequestForPath, makeSandboxRequest, makeSandboxWriteRequest, makeCredentiallessRequest, makeCredentialRouteRequest, makeRecord, makeReadonlyRecordForRequest, makeRecordForRequest, runtimeGeneratedProvenance, deferred, flushMicrotasks, git, expectPathEventuallyExists, findAvailablePort, withOccupiedPort, makeRecoveryStore } from "./invocation-service-test-fixture.js";

describe("RuntimeManagedAgentInvocationService leases", () => {
  it("preserves explicit resource lease evidence during runtime admission replay", async () => {
    const invoke = vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService();
    const explicitLease = {
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "healthy" as const,
      cleanupStatus: "not-required" as const,
      workingDirectoryPath: "C:/workspace/kiln/.kiln/leases/invocation-1",
      workingDirectoryMode: "read-only" as const,
      resourceUris: [
        "kiln://resources/context.md",
        "kiln://artifacts/invocation-1/lease",
      ],
      diagnosticUris: [],
    };

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode-readonly",
      routeSource: "explicit-managed-route",
      resourcePlane: {
        available: true,
        resourceUris: explicitLease.resourceUris,
      },
      resourceLease: explicitLease,
    });

    expect(started.status).toBe("started");
    if (started.status !== "started") {
      throw new Error("expected managed invocation to start");
    }

    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(joined.record.capabilitySnapshot.resourceLease).toEqual(explicitLease);
    expect(service.status("invocation-1")?.decision.capabilitySnapshot.resourceLease).toEqual(explicitLease);
  });

  it("rejects overlapping same-checkout parallel approved-write invocations before adapter execution", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const invoke = vi.fn(async ({ request, admission }) => {
      await terminal.promise;
      return makeRecordForRequest(request, admission.capabilitySnapshot);
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService();
    const firstRequest = makeApprovedWriteRequest("write-1", [
      "C:/workspace/kiln/packages/core",
    ]);

    const first = await service.start(firstRequest, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(first.status).toBe("started");
    const denied = await service.start(makeApprovedWriteRequest("write-2", [
      "C:/workspace/kiln/packages/core/src/agents",
    ]), adapter, {
      capturedAt: "2026-05-07T08:00:01.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(denied.status).toBe("denied");
    expect(denied.decision).toMatchObject({
      status: "denied",
      missingCapabilities: ["resourceLease.worktreeConflict"],
      resourceLease: {
        leaseId: "write-2:resource-lease",
        createdAt: "2026-05-07T08:00:01.000Z",
        healthStatus: "stale",
        cleanupStatus: "not-required",
        workingDirectoryPath: "C:/workspace/kiln",
        workingDirectoryMode: "workspace-write",
        worktreeConflict: {
          status: "blocked",
          reason: "same-checkout-write-conflict",
          conflictingInvocationId: "write-1",
          requestedInvocationId: "write-2",
          retryAfterInvocationIds: ["write-1"],
          policyId: "managed-agent.worktree.single-active-writer",
        },
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(service.status("write-2")).toBeUndefined();

    if (first.status === "started") {
      terminal.resolve(makeRecordForRequest(firstRequest, first.decision.capabilitySnapshot));
      await service.join("write-1");
    }
  });

  it("allows same-checkout parallel approved-write invocations when workspace scopes are explicit and disjoint", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const invoke = vi.fn(async () => terminal.promise);
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService();

    const first = await service.start(makeApprovedWriteRequest("write-1", [
      "C:/workspace/kiln/packages/core",
    ]), adapter, makeSnapshotInput());
    const second = await service.start(makeApprovedWriteRequest("write-2", [
      "C:/workspace/kiln/packages/cli",
    ]), adapter, makeSnapshotInput());

    expect(first.status).toBe("started");
    expect(second.status).toBe("started");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(service.list().map((snapshot) => snapshot.invocationId)).toEqual(["write-1", "write-2"]);
  });

  it("fails closed when an isolated worktree invocation has no runtime worktree lease manager", async () => {
    const invoke = vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService();

    await expect(service.start(makeIsolatedWorktreeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("isolated worktree lease manager");
    expect(invoke).not.toHaveBeenCalled();
    expect(service.status("write-1")).toBeUndefined();
  });

  it("rejects concurrent duplicate isolated worktree starts before acquiring a lease", async () => {
    const acquireGate = deferred<void>();
    const request = makeIsolatedWorktreeRequest();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => {
        await acquireGate.promise;
        return lease;
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
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    const firstStart = service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    await expect(service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("already registered");
    expect(worktreeLeaseManager.acquire).toHaveBeenCalledTimes(1);

    acquireGate.resolve();
    const started = await firstStart;

    expect(started.status).toBe("started");
    await service.join("write-1");
  });

  it("rejects concurrent isolated worktree starts for the same worktree path before acquiring twice", async () => {
    const acquireGate = deferred<void>();
    const firstRequest = makeIsolatedWorktreeRequest("write-1");
    const secondRequest = makeIsolatedWorktreeRequest("write-2");
    const sharedPath = firstRequest.authority.workingDirectory.path;
    const secondSharedPathRequest = defineManagedAgentInvocationRequest({
      ...secondRequest,
      authority: {
        ...secondRequest.authority,
        workingDirectory: {
          path: sharedPath,
          mode: "isolated-worktree",
        },
      },
    });
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => {
        await acquireGate.promise;
        return lease;
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
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    const firstStart = service.start(firstRequest, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    const denied = await service.start(secondSharedPathRequest, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(denied.status).toBe("denied");
    expect(denied.decision).toMatchObject({
      status: "denied",
      missingCapabilities: ["resourceLease.worktreeConflict"],
      resourceLease: {
        workingDirectoryPath: sharedPath,
        workingDirectoryMode: "isolated-worktree",
        worktreeConflict: {
          status: "blocked",
          reason: "isolated-worktree-path-conflict",
          conflictingInvocationId: "write-1",
          requestedInvocationId: "write-2",
          retryAfterInvocationIds: ["write-1"],
        },
      },
    });
    expect(worktreeLeaseManager.acquire).toHaveBeenCalledTimes(1);
    expect(adapter.invoke).not.toHaveBeenCalled();

    acquireGate.resolve();
    const started = await firstStart;

    expect(started.status).toBe("started");
    await service.join("write-1");
  });

  it("rejects isolated worktree path aliases before acquiring twice", async () => {
    const acquireGate = deferred<void>();
    const firstRequest = makeIsolatedWorktreeRequest("write-1");
    const secondRequest = makeIsolatedWorktreeRequest("write-2");
    const aliasPath = "C:/workspace/kiln/.kiln/worktrees/alias/../write-1";
    const secondAliasRequest = defineManagedAgentInvocationRequest({
      ...secondRequest,
      authority: {
        ...secondRequest.authority,
        workingDirectory: {
          path: aliasPath,
          mode: "isolated-worktree",
        },
      },
    });
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => {
        await acquireGate.promise;
        return lease;
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
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    const firstStart = service.start(firstRequest, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    const denied = await service.start(secondAliasRequest, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(denied.status).toBe("denied");
    expect(denied.decision).toMatchObject({
      status: "denied",
      resourceLease: {
        worktreeConflict: {
          status: "blocked",
          reason: "isolated-worktree-path-conflict",
          conflictingInvocationId: "write-1",
          requestedInvocationId: "write-2",
          workingDirectoryPath: aliasPath,
        },
      },
    });
    expect(worktreeLeaseManager.acquire).toHaveBeenCalledTimes(1);

    acquireGate.resolve();
    const started = await firstStart;

    expect(started.status).toBe("started");
    await service.join("write-1");
  });

  it("rejects git worktree lease paths outside the configured worktree root", async () => {
    const request = makeIsolatedWorktreeRequest();
    const escapedRequest = defineManagedAgentInvocationRequest({
      ...request,
      authority: {
        ...request.authority,
        workingDirectory: {
          path: "C:/outside/kiln/worktrees/write-1",
          mode: "isolated-worktree",
        },
      },
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({
      worktreeLeaseManager: new ManagedGitWorktreeLeaseManager({
        repositoryPath: "C:/workspace/kiln",
        worktreeRootPath: "C:/workspace/kiln/.kiln/worktrees",
      }),
    });

    await expect(service.start(escapedRequest, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("outside configured worktree root");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(service.status("write-1")).toBeUndefined();
  });

  it("rejects git worktree lease paths that escape the configured root through dot segments", async () => {
    const request = makeIsolatedWorktreeRequest();
    const escapedRequest = defineManagedAgentInvocationRequest({
      ...request,
      authority: {
        ...request.authority,
        workingDirectory: {
          path: "C:/workspace/kiln/.kiln/worktrees/../outside/write-1",
          mode: "isolated-worktree",
        },
      },
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({
      worktreeLeaseManager: new ManagedGitWorktreeLeaseManager({
        repositoryPath: "C:/workspace/kiln",
        worktreeRootPath: "C:/workspace/kiln/.kiln/worktrees",
      }),
    });

    await expect(service.start(escapedRequest, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("outside configured worktree root");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(service.status("write-1")).toBeUndefined();
  });

  it("rejects pre-existing git worktree lease paths instead of adopting them", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kiln-worktree-root-"));
    try {
      const existingPath = join(tempRoot, "write-1");
      const request = makeIsolatedWorktreeRequest();
      const existingRequest = defineManagedAgentInvocationRequest({
        ...request,
        authority: {
          ...request.authority,
          workingDirectory: {
            path: existingPath,
            mode: "isolated-worktree",
          },
        },
      });
      const adapter: ManagedAgentRuntimeAdapter = {
        descriptor: makeWriteDescriptor(),
        invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
      };
      const service = new RuntimeManagedAgentInvocationService({
        worktreeLeaseManager: new ManagedGitWorktreeLeaseManager({
          repositoryPath: "C:/workspace/kiln",
          worktreeRootPath: tempRoot,
        }),
      });

      await mkdir(existingPath);
      await expect(service.start(existingRequest, adapter, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      })).rejects.toThrow("refusing to adopt unmanaged checkout");
      expect(adapter.invoke).not.toHaveBeenCalled();
      expect(service.status("write-1")).toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects worktree lease manager output that changes the admitted lease path", async () => {
    const request = makeIsolatedWorktreeRequest();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/other-write",
      })),
      release: vi.fn(async ({ lease }) => lease),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    await expect(service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("working directory path does not match admission");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(service.status("write-1")).toBeUndefined();
  });

  it("rejects worktree lease manager artifact URIs that escape the invocation by dot segments", async () => {
    const request = makeIsolatedWorktreeRequest();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: ["kiln://artifacts/write-1/../other-invocation/worktree-lease"],
      })),
      release: vi.fn(async ({ lease }) => lease),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    await expect(service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("resource uri is outside invocation artifacts");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(service.status("write-1")).toBeUndefined();
  });

  it("rejects worktree lease manager output that injects runtime-owned worktree review evidence", async () => {
    const request = makeIsolatedWorktreeRequest();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        worktreeReview: {
          status: "required" as const,
          reason: "dirty-worktree-preserved" as const,
          resourceUris: ["kiln://artifacts/write-1/worktree-review"],
          diagnosticUris: ["kiln://artifacts/write-1/worktree-review-required"],
        },
      })),
      release: vi.fn(async ({ lease }) => lease),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    await expect(service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("worktree review evidence is runtime-owned");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(service.status("write-1")).toBeUndefined();
  });

  it("acquires and releases isolated worktree leases as terminal runtime evidence", async () => {
    const request = makeIsolatedWorktreeRequest();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: ["kiln://artifacts/write-1/worktree-lease"],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: ["kiln://artifacts/write-1/worktree-cleanup"],
      })),
    };
    const invoke = vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    const started = await service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    if (started.status !== "started") {
      throw new Error("expected managed invocation to start");
    }
    expect(worktreeLeaseManager.acquire.mock.invocationCallOrder[0])
      .toBeLessThan(invoke.mock.invocationCallOrder[0]!);
    expect(started.decision.capabilitySnapshot.resourceLease).toMatchObject({
      healthStatus: "healthy",
      cleanupStatus: "pending",
      workingDirectoryMode: "isolated-worktree",
    });

    const joined = await service.join("write-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(joined.record.capabilitySnapshot.resourceLease.cleanupStatus).toBe("pending");
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
    expect(service.status("write-1")?.record?.resourceLease).toEqual(joined.record.resourceLease);
  });

  it("fails closed when a sandbox invocation has no runtime sandbox lease manager", async () => {
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService();

    await expect(service.start(makeSandboxRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("sandbox lease manager is required");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(service.status("invocation-1")).toBeUndefined();
  });

  it("acquires sandbox leases before artifact directories and releases them after later stages", async () => {
    const sandboxLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/invocation-1/sandbox-policy",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/sandbox-policy-release",
        ],
      })),
    };
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/invocation-1/artifact-directory",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/artifact-directory-cleanup",
        ],
      })),
    };
    const invoke = vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService({
      sandboxLeaseManager,
      artifactDirectoryLeaseManager,
    });

    const started = await service.start(makeSandboxRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    expect(started.status).toBe("started");
    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(sandboxLeaseManager.acquire.mock.invocationCallOrder[0]).toBeLessThan(
      artifactDirectoryLeaseManager.acquire.mock.invocationCallOrder[0] ?? 0,
    );
    expect(artifactDirectoryLeaseManager.acquire.mock.invocationCallOrder[0]).toBeLessThan(
      invoke.mock.invocationCallOrder[0] ?? 0,
    );
    expect(artifactDirectoryLeaseManager.release.mock.invocationCallOrder[0]).toBeLessThan(
      sandboxLeaseManager.release.mock.invocationCallOrder[0] ?? 0,
    );
    expect(joined.record.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
      workingDirectoryMode: "sandbox",
      resourceUris: [
        "kiln://artifacts/invocation-1/sandbox-policy",
        "kiln://artifacts/invocation-1/artifact-directory",
      ],
      diagnosticUris: [
        "kiln://artifacts/invocation-1/artifact-directory-cleanup",
        "kiln://artifacts/invocation-1/sandbox-policy-release",
      ],
    });
  });

  it("rejects sandbox lease manager resource URIs outside the invocation namespace", async () => {
    const sandboxLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: ["kiln://artifacts/other-invocation/sandbox-policy"],
      })),
      release: vi.fn(async ({ lease }) => lease),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ sandboxLeaseManager });

    await expect(service.start(makeSandboxRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("outside invocation artifacts");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(sandboxLeaseManager.release).not.toHaveBeenCalled();
    expect(service.status("invocation-1")).toBeUndefined();
  });

  it("records failed sandbox release when diagnostic URIs leave the invocation namespace", async () => {
    const sandboxLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: ["kiln://artifacts/invocation-1/sandbox-policy"],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: ["kiln://artifacts/other-invocation/sandbox-policy-release"],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ sandboxLeaseManager });

    const started = await service.start(makeSandboxRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    expect(started.status).toBe("started");
    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.resourceLease).toEqual({
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "leaked",
      cleanupStatus: "failed",
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "sandbox",
      resourceUris: ["kiln://artifacts/invocation-1/sandbox-policy"],
      diagnosticUris: ["kiln://artifacts/invocation-1/sandbox-policy-cleanup-failed"],
    });
  });

  it("records concrete sandbox policy lease evidence without exposing policy details in URIs", async () => {
    const sandboxLeaseManager = new ManagedRuntimeSandboxLeaseManager();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ sandboxLeaseManager });

    const started = await service.start(makeSandboxRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    expect(started.status).toBe("started");
    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.resourceLease?.resourceUris).toEqual([
      "kiln://artifacts/invocation-1/sandbox-policy",
    ]);
    expect(joined.record.resourceLease?.diagnosticUris).toEqual([
      "kiln://artifacts/invocation-1/sandbox-policy-release",
    ]);
    expect(JSON.stringify(joined.record.resourceLease)).not.toContain("allowedPaths");
  });

  it("treats sandbox write invocations as same-checkout write conflicts", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const sandboxLeaseManager = new ManagedRuntimeSandboxLeaseManager();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => {
        await terminal.promise;
        return makeRecordForRequest(request, admission.capabilitySnapshot);
      }),
    };
    const service = new RuntimeManagedAgentInvocationService({ sandboxLeaseManager });

    const first = await service.start(makeSandboxWriteRequest("write-1", ["C:/workspace/kiln/packages/core"]), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    expect(first.status).toBe("started");

    const denied = await service.start(makeSandboxWriteRequest("write-2", ["C:/workspace/kiln/packages/core"]), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(denied.status).toBe("denied");
    expect(denied.decision).toMatchObject({
      status: "denied",
      missingCapabilities: ["resourceLease.worktreeConflict"],
      resourceLease: {
        workingDirectoryMode: "sandbox",
        worktreeConflict: {
          status: "blocked",
          reason: "same-checkout-write-conflict",
          conflictingInvocationId: "write-1",
          requestedInvocationId: "write-2",
        },
      },
    });

    terminal.resolve(makeRecordForRequest(
      makeSandboxWriteRequest("write-1", ["C:/workspace/kiln/packages/core"]),
      first.status === "started" ? first.decision.capabilitySnapshot : undefined,
    ));
    const joined = await service.join("write-1");
    expect(joined.status).toBe("completed");
  });

  it("acquires and releases artifact-directory leases around adapter execution", async () => {
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/invocation-1/artifact-directory",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/artifact-directory-cleanup",
        ],
      })),
    };
    const invoke = vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode-readonly",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    if (started.status !== "started") {
      throw new Error("expected managed invocation to start");
    }
    expect(artifactDirectoryLeaseManager.acquire.mock.invocationCallOrder[0])
      .toBeLessThan(invoke.mock.invocationCallOrder[0]!);

    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(artifactDirectoryLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(joined.record.capabilitySnapshot.resourceLease.cleanupStatus).toBe("not-required");
    expect(joined.record.resourceLease).toEqual({
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "released",
      cleanupStatus: "completed",
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "read-only",
      resourceUris: ["kiln://artifacts/invocation-1/artifact-directory"],
      diagnosticUris: ["kiln://artifacts/invocation-1/artifact-directory-cleanup"],
    });
  });

  it("rejects artifact-directory lease manager resource URIs outside the invocation namespace", async () => {
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: ["kiln://artifacts/other-invocation/artifact-directory"],
      })),
      release: vi.fn(async ({ lease }) => lease),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

    await expect(service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("outside invocation artifacts");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(service.status("invocation-1")).toBeUndefined();
  });

  it("cancels during artifact-directory acquire without invoking the adapter", async () => {
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
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

    const startedPromise = service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    const cancelled = await service.cancel("invocation-1", "Operator cancelled before artifact-directory acquisition completed.");
    if (cancelled.status !== "cancelled") throw new Error("expected pre-start cancellation");
    const joinedBeforeAcquirePromise = service.join("invocation-1");
    await flushMicrotasks();
    const joinedBeforeAcquire = await Promise.race([
      joinedBeforeAcquirePromise.then((result) => requireCompletedInvocation(result).record.lifecycleState),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 0)),
    ]);

    expect(cancelled.record.resourceLease).toBeUndefined();
    expect(joinedBeforeAcquire).toBe("pending");
    expect(adapter.invoke).not.toHaveBeenCalled();

    acquireGate.resolve();
    const started = await startedPromise;
    const joined = await joinedBeforeAcquirePromise;

    expect(started.status).toBe("started");
    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(artifactDirectoryLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(joined.record.lifecycleState).toBe("cancelled");
    expect(joined.record.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
      resourceUris: ["kiln://artifacts/invocation-1/artifact-directory"],
      diagnosticUris: ["kiln://artifacts/invocation-1/artifact-directory-cleanup"],
    });
  });

  it("records failed artifact-directory release as leaked terminal lease evidence", async () => {
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: ["kiln://artifacts/invocation-1/artifact-directory"],
      })),
      release: vi.fn(async () => {
        throw new Error("artifact directory is locked");
      }),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode-readonly",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.resourceLease).toEqual({
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "leaked",
      cleanupStatus: "failed",
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "read-only",
      resourceUris: ["kiln://artifacts/invocation-1/artifact-directory"],
      diagnosticUris: ["kiln://artifacts/invocation-1/artifact-directory-cleanup-failed"],
    });
    expect(joined.record.diagnostics).toContainEqual({
      uri: "kiln://artifacts/invocation-1/artifact-directory-cleanup-failed",
      kind: "cleanup",
    });
  });

  it("acquires and releases dev-server port leases around adapter execution", async () => {
    const devServerPortLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/invocation-1/dev-server-port/49152",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/dev-server-port-release/49152",
        ],
      })),
    };
    const invoke = vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService({ devServerPortLeaseManager });

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode-readonly",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    if (started.status !== "started") {
      throw new Error("expected managed invocation to start");
    }
    expect(devServerPortLeaseManager.acquire.mock.invocationCallOrder[0])
      .toBeLessThan(invoke.mock.invocationCallOrder[0]!);

    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(devServerPortLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(joined.record.resourceLease).toEqual({
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "released",
      cleanupStatus: "completed",
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "read-only",
      resourceUris: ["kiln://artifacts/invocation-1/dev-server-port/49152"],
      diagnosticUris: ["kiln://artifacts/invocation-1/dev-server-port-release/49152"],
    });
  });

  it("rejects dev-server port lease manager resource URIs outside the invocation namespace", async () => {
    const devServerPortLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: ["kiln://artifacts/other-invocation/dev-server-port/49152"],
      })),
      release: vi.fn(async ({ lease }) => lease),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ devServerPortLeaseManager });

    await expect(service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("outside invocation artifacts");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(service.status("invocation-1")).toBeUndefined();
  });

  it("allocates and releases in-memory dev-server ports from the configured pool", async () => {
    const port = await findAvailablePort();
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const devServerPortLeaseManager = new ManagedInMemoryDevServerPortLeaseManager({
      ports: [port],
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => {
        await terminal.promise;
        return makeRecord(admission.capabilitySnapshot);
      }),
    };
    const service = new RuntimeManagedAgentInvocationService({ devServerPortLeaseManager });

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    await expect(service.start(defineManagedAgentInvocationRequest({
      ...makeRequest(),
      invocationId: "invocation-2",
    }), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("No managed dev-server ports are available");

    terminal.resolve(makeRecord(started.status === "started" ? started.decision.capabilitySnapshot : undefined));
    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
      resourceUris: [`kiln://artifacts/invocation-1/dev-server-port/${port}`],
      diagnosticUris: [`kiln://artifacts/invocation-1/dev-server-port-release/${port}`],
    });
  });

  it("does not reuse an in-flight dev-server port reservation across concurrent starts", async () => {
    const port = await findAvailablePort();
    const terminals = new Map<string, ReturnType<typeof deferred<ManagedAgentInvocationRecord>>>();
    const devServerPortLeaseManager = new ManagedInMemoryDevServerPortLeaseManager({
      ports: [port],
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => {
        const terminal = terminals.get(request.invocationId);
        if (!terminal) {
          throw new Error(`missing terminal for ${request.invocationId}`);
        }
        await terminal.promise;
        return makeRecord(admission.capabilitySnapshot);
      }),
    };
    const service = new RuntimeManagedAgentInvocationService({ devServerPortLeaseManager });
    terminals.set("invocation-1", deferred<ManagedAgentInvocationRecord>());
    terminals.set("invocation-2", deferred<ManagedAgentInvocationRecord>());

    const results = await Promise.allSettled([
      service.start(makeRequest(), adapter, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      }),
      service.start(defineManagedAgentInvocationRequest({
        ...makeRequest(),
        invocationId: "invocation-2",
      }), adapter, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      }),
    ]);

    const started = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(started).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(((rejected[0] as PromiseRejectedResult).reason as Error).message)
      .toContain("No managed dev-server ports are available");
    expect(adapter.invoke).toHaveBeenCalledTimes(1);

    const startedResult = (started[0] as PromiseFulfilledResult<ManagedAgentRuntimeInvocationStartResult>).value;
    if (startedResult.status !== "started") {
      throw new Error("expected one managed invocation to start");
    }
    terminals.get(startedResult.snapshot.invocationId)?.resolve(makeRecord(startedResult.decision.capabilitySnapshot));
    const joined = await service.join(startedResult.snapshot.invocationId);

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.resourceLease?.resourceUris).toEqual([
      `kiln://artifacts/${startedResult.snapshot.invocationId}/dev-server-port/${port}`,
    ]);
  });

  it("fails closed when configured dev-server ports are already bound", async () => {
    const occupiedPort = await withOccupiedPort(async (port) => {
      const devServerPortLeaseManager = new ManagedInMemoryDevServerPortLeaseManager({
        ports: [port],
      });
      const adapter: ManagedAgentRuntimeAdapter = {
        descriptor: makeDescriptor(),
        invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
      };
      const service = new RuntimeManagedAgentInvocationService({ devServerPortLeaseManager });

      await expect(service.start(makeRequest(), adapter, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      })).rejects.toThrow("No managed dev-server ports are available");
      expect(adapter.invoke).not.toHaveBeenCalled();
      return port;
    });

    expect(occupiedPort).toBeGreaterThan(0);
  });

  it("surfaces dev-server port probe setup failures instead of reporting capacity exhaustion", async () => {
    const devServerPortLeaseManager = new ManagedInMemoryDevServerPortLeaseManager({
      ports: [49152],
      host: "not-a-kiln-localhost.invalid",
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ devServerPortLeaseManager });

    let thrown: unknown;
    try {
      await service.start(makeRequest(), adapter, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("Managed dev-server port probe failed");
    expect((thrown as Error).message).not.toContain("No managed dev-server ports are available");
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("acquires environment bindings after dev-server port leases and passes them to the adapter", async () => {
    const devServerPortLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/invocation-1/dev-server-port/49152",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/dev-server-port-release/49152",
        ],
      })),
    };
    const environmentLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        lease: {
          ...lease,
          cleanupStatus: "pending" as const,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/invocation-1/environment/KILN_DEV_SERVER_PORT",
          ],
        },
        environment: {
          KILN_DEV_SERVER_PORT: "49152",
        },
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/environment-release/KILN_DEV_SERVER_PORT",
        ],
      })),
    };
    const invoke = vi.fn(async ({ admission, environment }) => {
      expect(environment).toEqual({ KILN_DEV_SERVER_PORT: "49152" });
      return makeRecord(admission.capabilitySnapshot);
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService({
      devServerPortLeaseManager,
      environmentLeaseManager,
    });

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    expect(devServerPortLeaseManager.acquire.mock.invocationCallOrder[0])
      .toBeLessThan(environmentLeaseManager.acquire.mock.invocationCallOrder[0]!);
    expect(environmentLeaseManager.acquire.mock.invocationCallOrder[0])
      .toBeLessThan(invoke.mock.invocationCallOrder[0]!);

    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(environmentLeaseManager.release.mock.invocationCallOrder[0])
      .toBeLessThan(devServerPortLeaseManager.release.mock.invocationCallOrder[0]!);
    expect(joined.record.resourceLease).toEqual({
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "released",
      cleanupStatus: "completed",
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "read-only",
      resourceUris: [
        "kiln://artifacts/invocation-1/dev-server-port/49152",
        "kiln://artifacts/invocation-1/environment/KILN_DEV_SERVER_PORT",
      ],
      diagnosticUris: [
        "kiln://artifacts/invocation-1/environment-release/KILN_DEV_SERVER_PORT",
        "kiln://artifacts/invocation-1/dev-server-port-release/49152",
      ],
    });
  });

  it("rejects environment lease manager resource URIs outside the invocation namespace", async () => {
    const environmentLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        lease: {
          ...lease,
          resourceUris: ["kiln://artifacts/other-invocation/environment/KILN_DEV_SERVER_PORT"],
        },
        environment: {
          KILN_DEV_SERVER_PORT: "49152",
        },
      })),
      release: vi.fn(async ({ lease }) => lease),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ environmentLeaseManager });

    await expect(service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("outside invocation artifacts");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(environmentLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(service.status("invocation-1")).toMatchObject({
      lifecycleState: "failed",
      record: {
        lifecycleState: "failed",
        resourceLease: {
          healthStatus: "healthy",
          cleanupStatus: "not-required",
          resourceUris: [],
        },
      },
    });
  });

  it("binds dev-server port lease evidence into environment without leaking values into URIs", async () => {
    const devServerPortLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/invocation-1/dev-server-port/49152",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/dev-server-port-release/49152",
        ],
      })),
    };
    const environmentLeaseManager = new ManagedRuntimeEnvironmentLeaseManager({
      bindings: [{
        name: "KILN_DEV_SERVER_PORT",
        valueFrom: "dev-server-port",
      }],
    });
    const invoke = vi.fn(async ({ admission, environment }) => {
      expect(environment).toEqual({ KILN_DEV_SERVER_PORT: "49152" });
      return makeRecord(admission.capabilitySnapshot);
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService({
      devServerPortLeaseManager,
      environmentLeaseManager,
    });

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    expect(started.status).toBe("started");
    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.resourceLease?.resourceUris).not.toContain(
      "kiln://artifacts/invocation-1/environment/49152",
    );
    expect(joined.record.resourceLease).toMatchObject({
      resourceUris: [
        "kiln://artifacts/invocation-1/dev-server-port/49152",
        "kiln://artifacts/invocation-1/environment/KILN_DEV_SERVER_PORT",
      ],
      diagnosticUris: [
        "kiln://artifacts/invocation-1/environment-release/KILN_DEV_SERVER_PORT",
        "kiln://artifacts/invocation-1/dev-server-port-release/49152",
      ],
    });
  });

  it("rejects custom environment lease resource URIs that contain binding values", async () => {
    const environmentLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        lease: {
          ...lease,
          cleanupStatus: "pending" as const,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/invocation-1/environment/49152",
          ],
        },
        environment: {
          KILN_DEV_SERVER_PORT: "49152",
        },
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/environment-release/KILN_DEV_SERVER_PORT",
        ],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ environmentLeaseManager });

    await expect(service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("must not contain environment binding values");

    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(environmentLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(environmentLeaseManager.release.mock.calls[0]?.[0].lease.resourceUris).toContain(
      "kiln://artifacts/invocation-1/environment/49152",
    );
    expect(service.status("invocation-1")?.record?.resourceLease?.resourceUris).not.toContain(
      "kiln://artifacts/invocation-1/environment/49152",
    );
    expect(service.status("invocation-1")?.record?.resourceLease?.diagnosticUris).toEqual([
      "kiln://artifacts/invocation-1/environment-release/KILN_DEV_SERVER_PORT",
    ]);
  });

  it("rejects custom environment release diagnostic URIs that contain binding values", async () => {
    const environmentLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        lease: {
          ...lease,
          cleanupStatus: "pending" as const,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/invocation-1/environment/KILN_DEV_SERVER_PORT",
          ],
        },
        environment: {
          KILN_DEV_SERVER_PORT: "49152",
        },
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/environment-release/49152",
        ],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ environmentLeaseManager });

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    expect(started.status).toBe("started");
    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.resourceLease?.healthStatus).toBe("leaked");
    expect(joined.record.resourceLease?.cleanupStatus).toBe("failed");
    expect(joined.record.resourceLease?.diagnosticUris).toEqual([
      "kiln://artifacts/invocation-1/environment-cleanup-failed",
    ]);
    expect(joined.record.resourceLease?.diagnosticUris).not.toContain(
      "kiln://artifacts/invocation-1/environment-release/49152",
    );
  });

  it("removes rejected environment value URIs from cleanup diagnostics", async () => {
    const environmentLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        lease: {
          ...lease,
          cleanupStatus: "pending" as const,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/invocation-1/environment/49152",
          ],
        },
        environment: {
          KILN_DEV_SERVER_PORT: "49152",
        },
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "failed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/environment/49152",
          "kiln://artifacts/invocation-1/environment-release/KILN_DEV_SERVER_PORT",
        ],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ environmentLeaseManager });

    await expect(service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("must not contain environment binding values");

    const terminalRecord = service.status("invocation-1")?.record;
    expect(terminalRecord?.resourceLease?.resourceUris).not.toContain(
      "kiln://artifacts/invocation-1/environment/49152",
    );
    expect(terminalRecord?.resourceLease?.diagnosticUris).not.toContain(
      "kiln://artifacts/invocation-1/environment/49152",
    );
    expect(terminalRecord?.diagnostics?.map((diagnostic) => diagnostic.uri)).not.toContain(
      "kiln://artifacts/invocation-1/environment/49152",
    );
  });

  it("releases environment leases when acquired environment output fails validation", async () => {
    const environmentLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        lease: {
          ...lease,
          cleanupStatus: "pending" as const,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/invocation-1/environment/KILN_DEV_SERVER_PORT",
          ],
        },
        environment: JSON.parse("{\"KILN_DEV_SERVER_PORT\":49152}") as Record<string, string>,
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/environment-release/KILN_DEV_SERVER_PORT",
        ],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ environmentLeaseManager });

    await expect(service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("value must be a string");

    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(environmentLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(service.status("invocation-1")).toMatchObject({
      lifecycleState: "failed",
      record: {
        lifecycleState: "failed",
        resourceLease: {
          healthStatus: "released",
          cleanupStatus: "completed",
          resourceUris: ["kiln://artifacts/invocation-1/environment/KILN_DEV_SERVER_PORT"],
          diagnosticUris: ["kiln://artifacts/invocation-1/environment-release/KILN_DEV_SERVER_PORT"],
        },
      },
    });
  });

  it("rejects prototype-sensitive managed environment binding names", async () => {
    expect(() => new ManagedRuntimeEnvironmentLeaseManager({
      bindings: [{ name: "__proto__", value: "49152" }],
    })).toThrow("reserved environment binding name");

    const environmentLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        lease: {
          ...lease,
          cleanupStatus: "pending" as const,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/invocation-1/environment/__proto__",
          ],
        },
        environment: JSON.parse("{\"__proto__\":\"49152\"}") as Record<string, string>,
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ environmentLeaseManager });

    await expect(service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("reserved environment binding name");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(environmentLeaseManager.release).toHaveBeenCalledTimes(1);
  });

  it("binds the latest dev-server port lease when prior port evidence already exists", async () => {
    const devServerPortLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/invocation-1/dev-server-port/49152",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/dev-server-port-release/49152",
        ],
      })),
    };
    const environmentLeaseManager = new ManagedRuntimeEnvironmentLeaseManager({
      bindings: [{
        name: "KILN_DEV_SERVER_PORT",
        valueFrom: "dev-server-port",
      }],
    });
    const invoke = vi.fn(async ({ admission, environment }) => {
      expect(environment).toEqual({ KILN_DEV_SERVER_PORT: "49152" });
      return makeRecord(admission.capabilitySnapshot);
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService({
      devServerPortLeaseManager,
      environmentLeaseManager,
    });
    const explicitLease = {
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "healthy" as const,
      cleanupStatus: "not-required" as const,
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "read-only" as const,
      resourceUris: ["kiln://artifacts/invocation-1/dev-server-port/40000"],
      diagnosticUris: [],
    };

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
      resourceLease: explicitLease,
      resourcePlane: {
        available: true,
        resourceUris: explicitLease.resourceUris,
      },
    });
    expect(started.status).toBe("started");

    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(joined.record.resourceLease?.resourceUris).toEqual([
      "kiln://artifacts/invocation-1/dev-server-port/40000",
      "kiln://artifacts/invocation-1/dev-server-port/49152",
      "kiln://artifacts/invocation-1/environment/KILN_DEV_SERVER_PORT",
    ]);
  });

  it("fails closed when runtime-selected credential routes have no credential-route lease manager", async () => {
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService();

    await expect(service.start(makeCredentialRouteRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("durable economic commitment");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(service.status("invocation-1")).toBeUndefined();
  });

  it("checkpoints an economically owned account route without duplicating account lease authority", async () => {
    const request = makeCredentialRouteRequest();
    const recoveryStore = makeRecoveryStore();
    const credentialRouteLeaseManager = {
      acquire: vi.fn(async ({ lease }) => lease),
      release: vi.fn(async ({ lease }) => lease),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ recoveryStore, credentialRouteLeaseManager });
    const started = await service.start(request, adapter, {
      capturedAt: "2026-08-02T00:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    }, {
      economicDispatch: {
        commitment: {
          commitmentId: "commitment-economic-account",
          reservation: {
            reservationId: "reservation:test",
            jobId: "managed-economic-job:test",
            economicAttemptId: "economic-attempt:test",
            policy: { policyId: "test-policy" },
            selectedIdentity: {
              route: {
                routeId: "opencode:managed-test-route",
                providerId: request.providerRoute.providerId,
                modelId: request.providerRoute.model,
                accountPolicyId: "managed-opencode",
              },
              account: { kind: "account-bound" },
            },
            envelope: { kind: "bounded" },
            amounts: [],
            authorityRevision: "revision:test",
          },
        } as never,
        dispatchFenceId: "managed-economic-dispatch:test",
        recordExecutionSettlementPending: vi.fn(),
        createExecutionSettlement: vi.fn(() => ({} as never)),
        registerEconomicSettlement: vi.fn(),
      },
    });

    expect(started.status).toBe("started");
    await expect(service.join(request.invocationId)).resolves.toMatchObject({
      status: "completed",
      record: { lifecycleState: "completed" },
    });
    expect(recoveryStore.save).toHaveBeenCalledWith(expect.objectContaining({
      economicDispatch: expect.objectContaining({
        commitmentId: "commitment-economic-account",
        jobId: "managed-economic-job:test",
        economicAttemptId: "economic-attempt:test",
        dispatchFenceId: "managed-economic-dispatch:test",
        reservation: expect.objectContaining({
          reservationId: "reservation:test",
        }),
      }),
    }));
    const checkpoint = recoveryStore.save.mock.calls
      .map(([saved]) => saved)
      .find((saved) => saved.adapterStarted && saved.economicDispatch !== undefined);
    expect(checkpoint).toBeDefined();
    if (!checkpoint) throw new Error("expected an economically owned recovery checkpoint");

    expect(validateManagedAgentRuntimeRecoveryCheckpoint(checkpoint).economicDispatch).toEqual(
      checkpoint.economicDispatch,
    );
    expect(checkpoint.economicDispatch?.reservation).toMatchObject({
      reservationId: "reservation:test",
      jobId: "managed-economic-job:test",
      economicAttemptId: "economic-attempt:test",
    });
    // A checkpoint persisted before the reservation field existed must still validate: the
    // field is optional precisely so an in-flight recovery record from before this change
    // survives a restart instead of being quarantined as corrupt.
    const { reservation: _legacyReservation, ...economicDispatchWithoutReservation } = checkpoint.economicDispatch!;
    expect(validateManagedAgentRuntimeRecoveryCheckpoint({
      ...checkpoint,
      economicDispatch: economicDispatchWithoutReservation,
    }).economicDispatch?.reservation).toBeUndefined();
    expect(() => validateManagedAgentRuntimeRecoveryCheckpoint({
      ...checkpoint,
      economicDispatch: {
        ...checkpoint.economicDispatch,
        reservation: { ...checkpoint.economicDispatch?.reservation, jobId: "managed-economic-job:mismatched" },
      },
    })).toThrow("reservation identity does not match its dispatch reference");
    expect(() => validateManagedAgentRuntimeRecoveryCheckpoint({
      ...checkpoint,
      economicDispatch: { ...checkpoint.economicDispatch, dispatchFenceId: " managed-economic-dispatch:test" },
    })).toThrow("dispatch fence id is invalid");
    const { economicDispatch: _economicDispatch, ...withoutEconomicAuthority } = checkpoint;
    expect(() => validateManagedAgentRuntimeRecoveryCheckpoint(withoutEconomicAuthority)).toThrow(
      "requires one account lease authority reference",
    );
    expect(() => validateManagedAgentRuntimeRecoveryCheckpoint({
      ...checkpoint,
      accountLease: {
        leaseId: "account-lease-duplicate",
        accountPolicyId: "managed-opencode",
        accountRef: "configured:test:opaque",
        route: {
          providerId: request.providerRoute.providerId,
          providerModelId: request.providerRoute.model,
          scope: "virtual:managed-opencode",
        },
        jobId: "managed-economic-job:test",
        runtimeInvocationId: request.invocationId,
        credentialRevisionId: "a".repeat(64),
        selectionReason: "least-pressure",
        candidateRejections: [],
        usageEvidence: {
          health: "healthy",
          freshness: "fresh",
          availability: "available",
          observedAt: "2026-08-02T00:00:00.000Z",
          validUntil: "2026-08-02T00:05:00.000Z",
          source: "provider-endpoint",
          confidence: "authoritative",
        },
        acquiredAt: "2026-08-02T00:00:00.000Z",
        lifecycleState: "held",
        resourceUris: ["kiln://managed-accounts/leases/account-lease-duplicate"],
        diagnosticUris: [],
      },
    })).toThrow("cannot duplicate account lease authority");
  });

  it("does not acquire credential-route leases for credentialless invocations", async () => {
    const credentialRouteLeaseManager = {
      acquire: vi.fn(async ({ lease }) => lease),
      release: vi.fn(async ({ lease }) => lease),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => defineManagedAgentInvocationRecord({
        ...makeRecord(admission.capabilitySnapshot),
        authority: request.authority,
        capabilitySnapshot: admission.capabilitySnapshot,
      })),
    };
    const service = new RuntimeManagedAgentInvocationService({ credentialRouteLeaseManager });

    const started = await service.start(makeCredentiallessRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    expect(started.status).toBe("started");
    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    expect(credentialRouteLeaseManager.acquire).not.toHaveBeenCalled();
    expect(credentialRouteLeaseManager.release).not.toHaveBeenCalled();
  });

  it("creates and releases filesystem artifact-directory lease directories", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kiln-artifact-lease-"));
    const artifactRootPath = join(tempRoot, "managed-artifacts");
    const artifactDirectoryPath = join(artifactRootPath, "invocation-1");
    try {
      const terminal = deferred<ManagedAgentInvocationRecord>();
      const artifactDirectoryLeaseManager = new ManagedFilesystemArtifactDirectoryLeaseManager({
        artifactRootPath,
      });
      const adapter: ManagedAgentRuntimeAdapter = {
        descriptor: makeDescriptor(),
        invoke: vi.fn(async ({ admission }) => {
          await terminal.promise;
          return makeRecord(admission.capabilitySnapshot);
        }),
      };
      const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

      const started = await service.start(makeRequest(), adapter, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      });

      expect(started.status).toBe("started");
      await access(artifactDirectoryPath);

      terminal.resolve(makeRecord(started.status === "started" ? started.decision.capabilitySnapshot : undefined));
      const joined = await service.join("invocation-1");

      expect(joined.status).toBe("completed");
      if (joined.status !== "completed") {
        throw new Error("expected managed invocation to complete");
      }
      await expect(access(artifactDirectoryPath)).rejects.toThrow();
      expect(joined.record.resourceLease).toMatchObject({
        healthStatus: "released",
        cleanupStatus: "completed",
        resourceUris: ["kiln://artifacts/invocation-1/artifact-directory"],
        diagnosticUris: ["kiln://artifacts/invocation-1/artifact-directory-cleanup"],
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves non-empty filesystem artifact-directory leases as leaked evidence", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kiln-artifact-lease-"));
    const artifactRootPath = join(tempRoot, "managed-artifacts");
    const artifactDirectoryPath = join(artifactRootPath, "invocation-1");
    try {
      const terminal = deferred<ManagedAgentInvocationRecord>();
      const artifactDirectoryLeaseManager = new ManagedFilesystemArtifactDirectoryLeaseManager({
        artifactRootPath,
      });
      const adapter: ManagedAgentRuntimeAdapter = {
        descriptor: makeDescriptor(),
        invoke: vi.fn(async ({ admission }) => {
          await writeFile(join(artifactDirectoryPath, "child-output.txt"), "child artifact");
          await terminal.promise;
          return makeRecord(admission.capabilitySnapshot);
        }),
      };
      const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

      const started = await service.start(makeRequest(), adapter, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      });

      expect(started.status).toBe("started");
      terminal.resolve(makeRecord(started.status === "started" ? started.decision.capabilitySnapshot : undefined));
      const joined = await service.join("invocation-1");

      expect(joined.status).toBe("completed");
      if (joined.status !== "completed") {
        throw new Error("expected managed invocation to complete");
      }
      await access(artifactDirectoryPath);
      await access(join(artifactDirectoryPath, "child-output.txt"));
      expect(joined.record.resourceLease).toEqual({
        leaseId: "invocation-1:resource-lease",
        createdAt: "2026-05-07T08:00:00.000Z",
        healthStatus: "leaked",
        cleanupStatus: "failed",
        workingDirectoryPath: "C:/workspace/kiln",
        workingDirectoryMode: "read-only",
        resourceUris: ["kiln://artifacts/invocation-1/artifact-directory"],
        diagnosticUris: ["kiln://artifacts/invocation-1/artifact-directory-preserved"],
      });
      expect(joined.record.diagnostics).toContainEqual({
        uri: "kiln://artifacts/invocation-1/artifact-directory-preserved",
        kind: "cleanup",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses to adopt pre-existing filesystem artifact-directory lease paths", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kiln-artifact-lease-"));
    const artifactRootPath = join(tempRoot, "managed-artifacts");
    await mkdir(join(artifactRootPath, "invocation-1"), { recursive: true });
    try {
      const artifactDirectoryLeaseManager = new ManagedFilesystemArtifactDirectoryLeaseManager({
        artifactRootPath,
      });
      const adapter: ManagedAgentRuntimeAdapter = {
        descriptor: makeDescriptor(),
        invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
      };
      const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

      await expect(service.start(makeRequest(), adapter, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      })).rejects.toThrow("refusing to adopt unmanaged artifact directory");
      expect(adapter.invoke).not.toHaveBeenCalled();
      expect(service.status("invocation-1")).toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("composes artifact-directory and isolated worktree terminal lease evidence", async () => {
    const request = makeIsolatedWorktreeRequest();
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
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
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
    const joined = await service.join("write-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(artifactDirectoryLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
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
  });

  it("attempts isolated worktree cleanup when artifact-directory release fails first", async () => {
    const request = makeIsolatedWorktreeRequest();
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
      release: vi.fn(async () => {
        throw new Error("artifact directory is locked");
      }),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
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
    const joined = await service.join("write-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(artifactDirectoryLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
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
        "kiln://artifacts/write-1/artifact-directory-cleanup-failed",
        "kiln://artifacts/write-1/worktree-cleanup",
      ],
    });
  });

  it("keeps non-empty artifact-directory preservation sticky after worktree cleanup succeeds", async () => {
    const request = makeIsolatedWorktreeRequest();
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
        healthStatus: "leaked" as const,
        cleanupStatus: "failed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/write-1/artifact-directory-preserved",
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

    const started = await service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    const joined = await service.join("write-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
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
        "kiln://artifacts/write-1/artifact-directory-preserved",
        "kiln://artifacts/write-1/worktree-cleanup",
      ],
    });
  });

  it("cancels during isolated worktree acquire without invoking the adapter", async () => {
    const request = makeIsolatedWorktreeRequest();
    const acquireGate = deferred<void>();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => {
        await acquireGate.promise;
        return lease;
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
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    const startedPromise = service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });
    const cancelled = await service.cancel("write-1", "Operator cancelled before lease acquisition completed.");
    if (cancelled.status !== "cancelled") throw new Error("expected pre-start cancellation");

    expect(cancelled.record.resourceLease).toBeUndefined();
    expect(adapter.invoke).not.toHaveBeenCalled();

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
    expect(joined.record.lifecycleState).toBe("cancelled");
    expect(joined.record.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
    });
  });

  it("releases isolated worktree leases during runtime cancellation before adapter terminal output", async () => {
    const request = makeIsolatedWorktreeRequest();
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => lease),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async () => terminal.promise),
    };
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    const started = await service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    const cancelled = await service.cancel("write-1", "Operator cancelled isolated worktree run.");
    if (cancelled.status !== "cancelled") throw new Error("expected isolated worktree cancellation");

    expect(cancelled.record.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
    });
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);

    terminal.resolve(defineManagedAgentInvocationRecord({
      ...makeRecordForRequest(request, started.status === "started" ? started.decision.capabilitySnapshot : undefined),
      lifecycleState: "cancelled",
      resultHandoff: {
        provenance: runtimeGeneratedProvenance(makeRequest().providerRoute.model),
        summary: "Adapter observed cancellation.",
        resourceUris: ["kiln://artifacts/write-1/cancel-cleanup"],
        memoryWriteProposalUris: [],
      },
    }));
    const joined = await service.join("write-1");

    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.lifecycleState).toBe("cancelled");
    expect(joined.record.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
    });
  });

  it("records compensating cleanup when isolated worktree acquire fails after side effects", async () => {
    const request = makeIsolatedWorktreeRequest();
    const worktreeLeaseManager = {
      acquire: vi.fn(async () => {
        throw new ManagedAgentLeaseAcquireError("git worktree add failed after creating files", true);
      }),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: ["kiln://artifacts/write-1/worktree-cleanup"],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    await expect(service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("git worktree add failed after creating files");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(service.status("write-1")).toMatchObject({
      lifecycleState: "failed",
      record: {
        lifecycleState: "failed",
        resourceLease: {
          healthStatus: "released",
          cleanupStatus: "completed",
        },
      },
    });
  });

  it("records failed isolated worktree release as leaked terminal lease evidence", async () => {
    const request = makeIsolatedWorktreeRequest();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: ["kiln://artifacts/write-1/worktree-lease"],
      })),
      release: vi.fn(async () => {
        throw new Error("worktree has uncommitted child changes");
      }),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    const started = await service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    const joined = await service.join("write-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.resourceLease).toEqual({
      leaseId: "write-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "leaked",
      cleanupStatus: "failed",
      workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/write-1",
      workingDirectoryMode: "isolated-worktree",
      resourceUris: ["kiln://artifacts/write-1/worktree-lease"],
      diagnosticUris: ["kiln://artifacts/write-1/worktree-lease-cleanup-failed"],
    });
    expect(joined.record.diagnostics).toContainEqual({
      uri: "kiln://artifacts/write-1/worktree-lease-cleanup-failed",
      kind: "cleanup",
    });
  });

  it("marks dirty isolated worktree preservation as requiring adoption review", async () => {
    const request = makeIsolatedWorktreeRequest();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: ["kiln://artifacts/write-1/worktree-lease"],
      })),
      release: vi.fn(async () => {
        throw new ManagedAgentWorktreeReviewRequiredError("Managed git worktree lease is dirty; preserving worktree for review");
      }),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    const started = await service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    const joined = await service.join("write-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.resourceLease?.worktreeReview).toEqual({
      status: "required",
      reason: "dirty-worktree-preserved",
      resourceUris: ["kiln://artifacts/write-1/worktree-review"],
      diagnosticUris: ["kiln://artifacts/write-1/worktree-review-required"],
    });
    expect(joined.record.resourceLease?.diagnosticUris).toEqual([
      "kiln://artifacts/write-1/worktree-lease-cleanup-failed",
      "kiln://artifacts/write-1/worktree-review-required",
    ]);
    expect(joined.record.diagnostics).toContainEqual({
      uri: "kiln://artifacts/write-1/worktree-review-required",
      kind: "cleanup",
    });
  });

  it("preserves a dirty real git worktree for review when cleanup detects local changes", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "kiln-real-worktree-"));
    try {
      const repositoryPath = join(tempRoot, "repo");
      const worktreeRootPath = join(tempRoot, "worktrees");
      const invocationId = "write-real-dirty";
      const worktreePath = join(worktreeRootPath, invocationId);
      await mkdir(join(repositoryPath, "packages", "core"), { recursive: true });
      await mkdir(worktreeRootPath, { recursive: true });
      await git(repositoryPath, ["init"]);
      await git(repositoryPath, ["config", "user.email", "kiln-test@example.test"]);
      await git(repositoryPath, ["config", "user.name", "Kiln Test"]);
      await writeFile(join(repositoryPath, "packages", "core", "proof.txt"), "clean\n", "utf-8");
      await git(repositoryPath, ["add", "packages/core/proof.txt"]);
      await git(repositoryPath, ["commit", "-m", "initial"]);

      const request = makeIsolatedWorktreeRequestForPath(invocationId, worktreePath);
      const adapter: ManagedAgentRuntimeAdapter = {
        descriptor: makeWriteDescriptor(),
        invoke: vi.fn(async ({ request, admission }) => {
          await writeFile(
            join(request.authority.workingDirectory.path, "packages", "core", "proof.txt"),
            "dirty\n",
            "utf-8",
          );
          return makeRecordForRequest(request, admission.capabilitySnapshot);
        }),
      };
      const service = new RuntimeManagedAgentInvocationService({
        worktreeLeaseManager: new ManagedGitWorktreeLeaseManager({
          repositoryPath,
          worktreeRootPath,
        }),
      });

      const started = await service.start(request, adapter, {
        capturedAt: "2026-05-07T08:00:00.000Z",
        routeId: "opencode:managed-test-route",
        routeSource: "explicit-managed-route",
      });

      expect(started.status).toBe("started");
      await expectPathEventuallyExists(worktreePath, "managed git worktree", "directory");
      const joined = await service.join(invocationId);

      expect(joined.status).toBe("completed");
      if (joined.status !== "completed") {
        throw new Error("expected managed invocation to complete");
      }
      expect(joined.record.lifecycleState).toBe("completed");
      expect(joined.record.resourceLease).toMatchObject({
        leaseId: `${invocationId}:resource-lease`,
        healthStatus: "leaked",
        cleanupStatus: "failed",
        workingDirectoryPath: worktreePath,
        workingDirectoryMode: "isolated-worktree",
        resourceUris: [`kiln://artifacts/${invocationId}/worktree-lease`],
        worktreeReview: {
          status: "required",
          reason: "dirty-worktree-preserved",
          resourceUris: [`kiln://artifacts/${invocationId}/worktree-review`],
          diagnosticUris: [`kiln://artifacts/${invocationId}/worktree-review-required`],
        },
      });
      expect(joined.record.resourceLease?.diagnosticUris).toEqual(expect.arrayContaining([
        `kiln://artifacts/${invocationId}/worktree-lease-cleanup-failed`,
        `kiln://artifacts/${invocationId}/worktree-review-required`,
      ]));
      expect(joined.record.diagnostics).toEqual(expect.arrayContaining([
        {
          uri: `kiln://artifacts/${invocationId}/worktree-lease-cleanup-failed`,
          kind: "cleanup",
        },
        {
          uri: `kiln://artifacts/${invocationId}/worktree-review-required`,
          kind: "cleanup",
        },
      ]));
      await expectPathEventuallyExists(
        worktreePath,
        "dirty managed git worktree preserved for review",
        "directory",
      );
      await expectPathEventuallyExists(
        join(worktreePath, "packages", "core", "proof.txt"),
        "dirty managed git worktree proof file preserved for review",
        "file",
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("releases isolated worktree leases when the adapter fails after acquire", async () => {
    const request = makeIsolatedWorktreeRequest();
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: ["kiln://artifacts/write-1/worktree-lease"],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: ["kiln://artifacts/write-1/worktree-cleanup"],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke: vi.fn(async () => {
        throw new Error("adapter crashed after acquire");
      }),
    };
    const service = new RuntimeManagedAgentInvocationService({ worktreeLeaseManager });

    const started = await service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    });

    expect(started.status).toBe("started");
    await expect(service.join("write-1")).rejects.toThrow("adapter crashed after acquire");
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(service.status("write-1")).toMatchObject({
      lifecycleState: "failed",
      record: {
        lifecycleState: "failed",
        resourceLease: {
          healthStatus: "released",
          cleanupStatus: "completed",
        },
      },
      error: { message: "adapter crashed after acquire" },
    });
  });

});
