import { describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentInvocationRequest,
  ManagedAgentInvocationRecord,
} from "@kilnai/core";
import {
  defineManagedAgentAdapterDescriptor,
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentInvocationRequest,
  defineManagedAgentInvocationRecord,
  defineManagedAgentWriteAuthority,
} from "@kilnai/core";
import {
  ManagedInMemoryDevServerPortLeaseManager,
  ManagedFilesystemArtifactDirectoryLeaseManager,
  ManagedGitWorktreeLeaseManager,
  ManagedAgentLeaseAcquireError,
  ManagedAgentRuntimeAdmissionError,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import type { ManagedAgentRuntimeAdapter } from "../../src/agents/managed-invocation/index.js";

function makeRequest(): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-1",
    agentId: "agent-reviewer",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
    profile: "foundation-readonly-plan",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId: "opencode",
      surface: "cli-harness",
      model: "sonic",
    },
    adapterKind: "harness",
    executionMode: "cli-harness",
    authority: {
      authorityProfileId: "foundation-readonly",
      permissionProfile: "read-only",
      toolAuthority: {
        allowedToolNames: ["read", "rg"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/workspace/kiln",
        mode: "read-only",
      },
      timeoutMs: 120000,
      credentialRoute: {
        mode: "runtime-selected",
        routeId: "credential-route:opencode:primary",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
    },
    input: {
      summary: "Inspect the contract",
    },
  });
}

function makeDescriptor(overrides: Partial<ManagedAgentAdapterDescriptor> = {}): ManagedAgentAdapterDescriptor {
  return defineManagedAgentAdapterDescriptor({
    adapterDescriptorId: "adapter:opencode:harness",
    providerId: "opencode",
    adapterKind: "harness",
    supportedProfiles: ["foundation-readonly-plan"],
    supportedExecutionModes: ["cli-harness"],
    lifecycle: {
      exposesStart: true,
      exposesTerminal: true,
      exposesCleanup: true,
    },
    cancellation: { supported: true },
    timeout: { supported: true, diagnosticArtifactOnTimeout: true },
    transcript: {
      supported: true,
      redactionKnown: true,
      truncationKnown: true,
      persistenceKnown: true,
      retentionKnown: true,
    },
    usage: {
      supported: true,
      preservesProviderTokenClasses: true,
      supportsExplicitUnknowns: true,
    },
    resultHandoff: {
      boundedSummary: true,
      resourcePointers: true,
    },
    credentialRoute: { supported: true },
    memoryContext: { governedAdmission: true },
    unsupportedFieldPolicy: "reject",
    cleanup: { supported: true },
    ...overrides,
  });
}

function makeWriteDescriptor(): ManagedAgentAdapterDescriptor {
  return makeDescriptor({
    supportedProfiles: ["foundation-readonly-plan", "foundation-apply-approved-writes"],
    writeAuthority: {
      proposalSupported: true,
      approvedApplySupported: true,
      memoryProposalSupported: false,
      rollbackEvidence: true,
      cleanupEvidence: true,
      scopeReduction: true,
    },
  });
}

function makeApprovedWriteRequest(
  invocationId: string,
  allowedPaths: readonly string[],
): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId,
    agentId: "agent-implementer",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
    profile: "foundation-apply-approved-writes",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId: "opencode",
      surface: "cli-harness",
      model: "sonic",
    },
    adapterKind: "harness",
    executionMode: "cli-harness",
    authority: {
      authorityProfileId: "foundation-apply-approved-writes",
      permissionProfile: "apply-approved-writes",
      toolAuthority: {
        allowedToolNames: ["read", "rg", "apply-patch"],
        writeAllowed: true,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/workspace/kiln",
        mode: "workspace-write",
      },
      timeoutMs: 120000,
      credentialRoute: {
        mode: "runtime-selected",
        routeId: "credential-route:opencode:primary",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
      writeAuthority: defineManagedAgentWriteAuthority({
        profile: "foundation-apply-approved-writes",
        scope: {
          workspace: {
            mode: "apply-approved",
            allowedPaths,
            deniedPaths: ["C:/workspace/kiln/.git"],
          },
          memory: {
            mode: "none",
            operations: [],
          },
          artifacts: {
            mode: "none",
            resourceUris: [],
            retention: "none",
          },
          tools: {
            allowedToolNames: ["read", "rg", "apply-patch"],
            deniedToolNames: ["git-commit"],
          },
        },
        approval: {
          mode: "required-before-apply",
          evidenceRequired: true,
          evidenceUris: [`kiln://approvals/${invocationId}`],
        },
      }),
    },
    input: {
      summary: "Apply approved bounded changes",
    },
  });
}

function makeIsolatedWorktreeRequest(invocationId = "write-1"): ManagedAgentInvocationRequest {
  const request = makeApprovedWriteRequest(invocationId, [
    `C:/workspace/kiln/.kiln/worktrees/${invocationId}/packages/core`,
  ]);
  return defineManagedAgentInvocationRequest({
    ...request,
    authority: {
      ...request.authority,
      workingDirectory: {
        path: `C:/workspace/kiln/.kiln/worktrees/${invocationId}`,
        mode: "isolated-worktree",
      },
    },
  });
}

function makeRecord(
  capabilitySnapshot = buildManagedAgentCapabilitySnapshot(makeRequest(), makeDescriptor(), {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: "opencode-readonly",
  }),
): ManagedAgentInvocationRecord {
  const request = makeRequest();
  return defineManagedAgentInvocationRecord({
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    profile: request.profile,
    lifecycleState: "completed",
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    capabilitySnapshot,
    childSessionId: "child-session-1",
    transcript: {
      uri: "kiln://artifacts/invocation-1/transcript",
      redacted: true,
      truncated: false,
      persisted: true,
      retention: "session",
    },
    usage: {
      source: "adapter",
      tokenClasses: [{ name: "input_tokens", value: "unknown" }],
      cost: { currency: "unknown", amount: "unknown" },
    },
    resultHandoff: {
      summary: "Inspection completed.",
      resourceUris: ["kiln://artifacts/invocation-1/result"],
      memoryWriteProposalUris: [],
    },
  });
}

function makeRecordForRequest(
  request: ManagedAgentInvocationRequest,
  capabilitySnapshot = buildManagedAgentCapabilitySnapshot(request, makeWriteDescriptor(), {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: `${request.providerRoute.providerId}:${request.profile}`,
  }),
): ManagedAgentInvocationRecord {
  return defineManagedAgentInvocationRecord({
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    profile: request.profile,
    lifecycleState: "completed",
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    capabilitySnapshot,
    resultHandoff: {
      summary: "Write completed.",
      resourceUris: [`kiln://artifacts/${request.invocationId}/result`],
      memoryWriteProposalUris: [],
    },
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function findAvailablePort(): Promise<number> {
  return withOccupiedPort(async (port) => port, true);
}

async function withOccupiedPort<T>(
  callback: (port: number) => Promise<T>,
  closeBeforeCallback = false,
): Promise<T> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address === "string" || address === null) {
    await closeServer(server);
    throw new Error("expected TCP server to bind to a numeric port");
  }
  if (closeBeforeCallback) {
    await closeServer(server);
    return callback(address.port);
  }
  try {
    return await callback(address.port);
  } finally {
    await closeServer(server);
  }
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe("RuntimeManagedAgentInvocationService", () => {
  it("admits through core policy before invoking the runtime adapter", async () => {
    const invoke = vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };

    const service = new RuntimeManagedAgentInvocationService();
    const result = await service.invoke(makeRequest(), adapter);

    expect(result.status).toBe("completed");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0].admission).toMatchObject({
      status: "admitted",
      adapterDescriptorId: "adapter:opencode:harness",
      authorityProfileId: "foundation-readonly",
    });
  });

  it("starts an admitted invocation without waiting for the adapter terminal record", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const invoke = vi.fn(async ({ admission }) => {
      await terminal.promise;
      return makeRecord(admission.capabilitySnapshot);
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode-readonly",
    });

    expect(started.status).toBe("started");
    if (started.status !== "started") {
      throw new Error("expected managed invocation to start");
    }
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(started.snapshot).toMatchObject({
      invocationId: "invocation-1",
      agentId: "agent-reviewer",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      profile: "foundation-readonly-plan",
      lifecycleState: "running",
    });
    expect(started.decision.capabilitySnapshot.resourceLease).toEqual({
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "healthy",
      cleanupStatus: "not-required",
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "read-only",
      resourceUris: [],
      diagnosticUris: [],
    });
    expect(service.status("invocation-1")).toMatchObject({
      invocationId: "invocation-1",
      lifecycleState: "running",
    });
    expect(service.list()).toHaveLength(1);

    terminal.resolve(makeRecord(started.decision.capabilitySnapshot));
    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") {
      throw new Error("expected managed invocation to complete");
    }
    expect(joined.record.lifecycleState).toBe("completed");
    expect(joined.record.capabilitySnapshot.resourceLease).toEqual(started.decision.capabilitySnapshot.resourceLease);
    expect(service.status("invocation-1")).toMatchObject({
      invocationId: "invocation-1",
      lifecycleState: "completed",
      record: joined.record,
    });
  });

  it("preserves explicit resource lease evidence during runtime admission replay", async () => {
    const invoke = vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot));
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
    const invoke = vi.fn(async () => terminal.promise);
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeWriteDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService();

    const first = await service.start(makeApprovedWriteRequest("write-1", [
      "C:/workspace/kiln/packages/core",
    ]), adapter);

    expect(first.status).toBe("started");
    await expect(service.start(makeApprovedWriteRequest("write-2", [
      "C:/workspace/kiln/packages/core/src/agents",
    ]), adapter)).rejects.toThrow("same-checkout parallel write");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(service.status("write-2")).toBeUndefined();
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
    ]), adapter);
    const second = await service.start(makeApprovedWriteRequest("write-2", [
      "C:/workspace/kiln/packages/cli",
    ]), adapter);

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
    });

    await expect(service.start(request, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
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
    });

    await expect(service.start(secondSharedPathRequest, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
    })).rejects.toThrow("isolated worktree path");
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
    });

    await expect(service.start(secondAliasRequest, adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
    })).rejects.toThrow("isolated worktree path");
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
    })).rejects.toThrow("resource uri is outside invocation artifacts");
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
    const invoke = vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode-readonly",
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
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

    await expect(service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
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
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

    const startedPromise = service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
    });
    const cancelled = await service.cancel("invocation-1", "Operator cancelled before artifact-directory acquisition completed.");

    expect(cancelled.record.resourceLease).toBeUndefined();
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
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ artifactDirectoryLeaseManager });

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode-readonly",
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
    const invoke = vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService({ devServerPortLeaseManager });

    const started = await service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode-readonly",
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
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ devServerPortLeaseManager });

    await expect(service.start(makeRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
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
    });

    expect(started.status).toBe("started");
    await expect(service.start(defineManagedAgentInvocationRequest({
      ...makeRequest(),
      invocationId: "invocation-2",
    }), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
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
      }),
      service.start(defineManagedAgentInvocationRequest({
        ...makeRequest(),
        invocationId: "invocation-2",
      }), adapter, {
        capturedAt: "2026-05-07T08:00:00.000Z",
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
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ devServerPortLeaseManager });

    let thrown: unknown;
    try {
      await service.start(makeRequest(), adapter, {
        capturedAt: "2026-05-07T08:00:00.000Z",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("Managed dev-server port probe failed");
    expect((thrown as Error).message).not.toContain("No managed dev-server ports are available");
    expect(adapter.invoke).not.toHaveBeenCalled();
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
    });
    const cancelled = await service.cancel("write-1", "Operator cancelled before lease acquisition completed.");

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

  it("waits for adapter terminal cancellation before releasing isolated worktree leases", async () => {
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
    });

    expect(started.status).toBe("started");
    const cancelled = await service.cancel("write-1", "Operator cancelled isolated worktree run.");

    expect(cancelled.record.resourceLease).toBeUndefined();
    expect(worktreeLeaseManager.release).not.toHaveBeenCalled();

    terminal.resolve(defineManagedAgentInvocationRecord({
      ...makeRecordForRequest(request, started.status === "started" ? started.decision.capabilitySnapshot : undefined),
      lifecycleState: "cancelled",
      resultHandoff: {
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
    const started = await service.start(request, adapter);

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

  it("marks adapter rejection as failed evidence and rejects join", async () => {
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async () => {
        throw new Error("adapter crashed");
      }),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter);

    expect(started.status).toBe("started");
    await expect(service.join("invocation-1")).rejects.toThrow("adapter crashed");
    expect(service.status("invocation-1")).toMatchObject({
      invocationId: "invocation-1",
      lifecycleState: "failed",
      error: { message: "adapter crashed" },
    });
  });

  it("cancels a running invocation by aborting the adapter and suppressing late adapter failure", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    let adapterSignal: AbortSignal | undefined;
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission, abortSignal }) => {
        adapterSignal = abortSignal;
        await terminal.promise;
        return makeRecord(admission.capabilitySnapshot);
      }),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter);

    expect(started.status).toBe("started");
    expect(adapterSignal).toBeInstanceOf(AbortSignal);
    expect(adapterSignal?.aborted).toBe(false);

    const cancelled = await service.cancel("invocation-1", "Operator cancelled the child run.");

    expect(adapterSignal?.aborted).toBe(true);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.record.lifecycleState).toBe("cancelled");
    expect(service.status("invocation-1")).toMatchObject({
      invocationId: "invocation-1",
      lifecycleState: "cancelled",
      record: {
        lifecycleState: "cancelled",
        resultHandoff: {
          summary: "Operator cancelled the child run.",
        },
      },
    });

    terminal.reject(new Error("adapter abort surfaced late"));
    const joined = await service.join("invocation-1");

    expect(joined.status).toBe("completed");
    expect(joined.record.lifecycleState).toBe("cancelled");
    expect(service.status("invocation-1")?.record?.lifecycleState).toBe("cancelled");
    expect(service.status("invocation-1")?.error).toBeUndefined();
  });

  it("enriches a cancelled invocation when the adapter later returns cancellation evidence", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async () => terminal.promise),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter);

    expect(started.status).toBe("started");
    if (started.status !== "started") {
      throw new Error("expected managed invocation to start");
    }

    await service.cancel("invocation-1", "Operator cancelled the child run.");
    terminal.resolve(defineManagedAgentInvocationRecord({
      ...makeRecord(started.decision.capabilitySnapshot),
      lifecycleState: "cancelled",
      resultHandoff: {
        summary: "Adapter cleanup completed after cancellation.",
        resourceUris: ["kiln://artifacts/invocation-1/transcript", "kiln://artifacts/invocation-1/cancel-cleanup"],
        memoryWriteProposalUris: [],
      },
    }));
    await flushMicrotasks();
    const joined = await service.join("invocation-1");

    expect(service.status("invocation-1")).toMatchObject({
      lifecycleState: "cancelled",
      record: {
        lifecycleState: "cancelled",
        transcript: {
          uri: "kiln://artifacts/invocation-1/transcript",
        },
        resultHandoff: {
          summary: "Operator cancelled the child run.",
          resourceUris: ["kiln://artifacts/invocation-1/transcript", "kiln://artifacts/invocation-1/cancel-cleanup"],
        },
      },
    });
    expect(joined.record).toMatchObject({
      lifecycleState: "cancelled",
      transcript: {
        uri: "kiln://artifacts/invocation-1/transcript",
      },
      resultHandoff: {
        summary: "Operator cancelled the child run.",
        resourceUris: ["kiln://artifacts/invocation-1/transcript", "kiln://artifacts/invocation-1/cancel-cleanup"],
      },
    });
  });

  it("rejects duplicate runtime registration for the same invocation id", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => {
        await terminal.promise;
        return makeRecord(admission.capabilitySnapshot);
      }),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter);

    expect(started.status).toBe("started");
    await expect(service.start(makeRequest(), adapter)).rejects.toThrow("already registered");

    if (started.status === "started") {
      terminal.resolve(makeRecord(started.decision.capabilitySnapshot));
      await service.join(started.snapshot.invocationId);
    }
  });

  it("does not invoke the adapter when admission is denied", async () => {
    const invoke = vi.fn(async () => makeRecord());
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor({
        timeout: { supported: false, diagnosticArtifactOnTimeout: false },
      }),
      invoke,
    };

    const service = new RuntimeManagedAgentInvocationService();
    const result = await service.invoke(makeRequest(), adapter);

    expect(result.status).toBe("denied");
    expect(result.decision).toMatchObject({
      status: "denied",
      missingCapabilities: expect.arrayContaining(["timeout.supported"]),
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not register denied starts as background invocations", async () => {
    const invoke = vi.fn(async () => makeRecord());
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor({
        timeout: { supported: false, diagnosticArtifactOnTimeout: false },
      }),
      invoke,
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter);

    expect(started.status).toBe("denied");
    expect(service.status("invocation-1")).toBeUndefined();
    expect(service.list()).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects direct runtime execution without an admitted decision for the same adapter descriptor", async () => {
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async () => makeRecord()),
    };
    const service = new RuntimeManagedAgentInvocationService();

    await expect(service.invokeAdmitted({
      request: makeRequest(),
      adapter,
      admission: {
        status: "denied",
        invocationId: "invocation-1",
        profile: "foundation-readonly-plan",
        reason: "foundation-readonly-plan denied: timeout.supported",
        missingCapabilities: ["timeout.supported"],
      },
    })).rejects.toBeInstanceOf(ManagedAgentRuntimeAdmissionError);
  });
});
