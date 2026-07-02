import { describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  ManagedAgentCapabilitySnapshotInput,
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
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedRuntimeEnvironmentLeaseManager,
  ManagedFilesystemArtifactDirectoryLeaseManager,
  ManagedFilesystemRuntimeRecoveryStore,
  ManagedGitWorktreeLeaseManager,
  ManagedAgentLeaseAcquireError,
  ManagedAgentRuntimeAdmissionError,
  ManagedAgentRuntimeRecoveryDaemon,
  ManagedAgentWorktreeReviewRequiredError,
  ManagedRuntimeSandboxLeaseManager,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeRecoveryCheckpoint,
  ManagedAgentRuntimeRecoveryStore,
} from "../../src/agents/managed-invocation/index.js";

const execFileAsync = promisify(execFile);

function makeSnapshotInput(
  overrides: Partial<ManagedAgentCapabilitySnapshotInput> = {},
): ManagedAgentCapabilitySnapshotInput {
  return {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: "opencode:managed-test-route",
    routeSource: "explicit-managed-route",
    ...overrides,
  };
}

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
        mode: "credentialless",
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
      tokenClasses: ["input", "output", "cache_read"],
      semanticSourceGranularity: "unknown",
      evidenceBasis: "adapter",
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
        mode: "credentialless",
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

function makeIsolatedWorktreeRequestForPath(
  invocationId: string,
  worktreePath: string,
): ManagedAgentInvocationRequest {
  const request = makeApprovedWriteRequest(invocationId, [
    join(worktreePath, "packages", "core"),
  ]);
  return defineManagedAgentInvocationRequest({
    ...request,
    authority: {
      ...request.authority,
      workingDirectory: {
        path: worktreePath,
        mode: "isolated-worktree",
      },
      writeAuthority: defineManagedAgentWriteAuthority({
        profile: "foundation-apply-approved-writes",
        scope: {
          workspace: {
            mode: "apply-approved",
            allowedPaths: [join(worktreePath, "packages", "core")],
            deniedPaths: [join(worktreePath, ".git")],
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
  });
}

function makeSandboxRequest(invocationId = "invocation-1"): ManagedAgentInvocationRequest {
  const request = makeRequest();
  return defineManagedAgentInvocationRequest({
    ...request,
    invocationId,
    authority: {
      ...request.authority,
      workingDirectory: {
        path: "C:/workspace/kiln",
        mode: "sandbox",
      },
    },
  });
}

function makeSandboxWriteRequest(
  invocationId: string,
  allowedPaths: readonly string[],
): ManagedAgentInvocationRequest {
  const request = makeApprovedWriteRequest(invocationId, allowedPaths);
  return defineManagedAgentInvocationRequest({
    ...request,
    authority: {
      ...request.authority,
      workingDirectory: {
        path: "C:/workspace/kiln",
        mode: "sandbox",
      },
    },
  });
}

function makeCredentiallessRequest(): ManagedAgentInvocationRequest {
  const request = makeRequest();
  return defineManagedAgentInvocationRequest({
    ...request,
    authority: {
      ...request.authority,
      credentialRoute: { mode: "credentialless" },
    },
  });
}

function makeCredentialRouteRequest(routeId = "credential-route:opencode:primary"): ManagedAgentInvocationRequest {
  const request = makeRequest();
  return defineManagedAgentInvocationRequest({
    ...request,
    authority: {
      ...request.authority,
      credentialRoute: {
        mode: "runtime-selected",
        routeId,
      },
    },
  });
}

function makeRecord(
  capabilitySnapshot = buildManagedAgentCapabilitySnapshot(makeRequest(), makeDescriptor(), {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: "opencode-readonly",
    routeSource: "explicit-managed-route",
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
      tokenClasses: [{ name: "input", value: "unknown" }],
      cost: { currency: "unknown", amount: "unknown" },
    },
    resultHandoff: {
      summary: "Inspection completed.",
      resourceUris: ["kiln://artifacts/invocation-1/result"],
      memoryWriteProposalUris: [],
    },
  });
}

function makeReadonlyRecordForRequest(
  request: ManagedAgentInvocationRequest,
  capabilitySnapshot = buildManagedAgentCapabilitySnapshot(request, makeDescriptor(), {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: `${request.providerRoute.providerId}:${request.profile}`,
    routeSource: "explicit-managed-route",
  }),
): ManagedAgentInvocationRecord {
  return defineManagedAgentInvocationRecord({
    ...makeRecord(capabilitySnapshot),
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    profile: request.profile,
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    capabilitySnapshot,
  });
}

function makeRecordForRequest(
  request: ManagedAgentInvocationRequest,
  capabilitySnapshot = buildManagedAgentCapabilitySnapshot(request, makeWriteDescriptor(), {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: `${request.providerRoute.providerId}:${request.profile}`,
    routeSource: "explicit-managed-route",
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

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    windowsHide: true,
  });
  return stdout.toString();
}

async function expectPathEventuallyExists(
  path: string,
  label: string,
  expectedType: "directory" | "file",
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const firstStat = await stat(path);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const secondStat = await stat(path);
      const matchesType = expectedType === "directory"
        ? firstStat.isDirectory() && secondStat.isDirectory()
        : firstStat.isFile() && secondStat.isFile();
      if (!matchesType) {
        throw new Error(`Expected ${label} at ${path} to be a ${expectedType}`);
      }
      return;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Expected ${label} to exist at ${path}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT";
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

function makeRecoveryStore(): ManagedAgentRuntimeRecoveryStore & {
  readonly entries: Map<string, ManagedAgentRuntimeRecoveryCheckpoint>;
  readonly save: ReturnType<typeof vi.fn<ManagedAgentRuntimeRecoveryStore["save"]>>;
  readonly delete: ReturnType<typeof vi.fn<ManagedAgentRuntimeRecoveryStore["delete"]>>;
  readonly listRecoverable: ReturnType<typeof vi.fn<ManagedAgentRuntimeRecoveryStore["listRecoverable"]>>;
} {
  const entries = new Map<string, ManagedAgentRuntimeRecoveryCheckpoint>();
  const store = {
    entries,
    save: vi.fn(async (checkpoint: ManagedAgentRuntimeRecoveryCheckpoint) => {
      entries.set(checkpoint.request.invocationId, JSON.parse(JSON.stringify(checkpoint)) as ManagedAgentRuntimeRecoveryCheckpoint);
    }),
    delete: vi.fn(async (invocationId: string) => {
      entries.delete(invocationId);
    }),
    listRecoverable: vi.fn(async () => Array.from(entries.values()).map((checkpoint) =>
      JSON.parse(JSON.stringify(checkpoint)) as ManagedAgentRuntimeRecoveryCheckpoint
    )),
  };
  return store;
}

describe("RuntimeManagedAgentInvocationService", () => {
  it("admits through core policy before invoking the runtime adapter", async () => {
    const invoke = vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };

    const service = new RuntimeManagedAgentInvocationService();
    const result = await service.invoke(makeRequest(), adapter, makeSnapshotInput());

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
      routeSource: "explicit-managed-route",
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

  it("admits operator prompts into runtime delivery state and claims steer before queued prompts", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => {
        await terminal.promise;
        return makeRecord(admission.capabilitySnapshot);
      }),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput());

    expect(started.status).toBe("started");
    if (started.status !== "started") {
      throw new Error("expected managed invocation to start");
    }

    const steer = service.admitPrompt({
      invocationId: "invocation-1",
      promptAdmissionId: "prompt-steer-1",
      prompt: "Use the latest parent ledger evidence before continuing.",
      deliveryMode: "steer",
      wakeRequested: true,
      requestedBy: "operator",
      requestSource: "gui",
      admittedAt: new Date("2026-06-05T16:00:00.000Z"),
    });
    const queued = service.admitPrompt({
      invocationId: "invocation-1",
      promptAdmissionId: "prompt-queue-1",
      prompt: "Queue this follow-up until the child reaches a safe boundary.",
      deliveryMode: "queue",
      wakeRequested: false,
      requestedBy: "operator",
      requestSource: "gui",
      admittedAt: new Date("2026-06-05T16:00:01.000Z"),
    });

    expect(steer.prompt.deliveryState).toBe("available");
    expect(queued.prompt.deliveryState).toBe("queued");
    expect(service.status("invocation-1")?.promptInbox).toEqual([
      expect.objectContaining({
        promptAdmissionId: "prompt-steer-1",
        deliveryMode: "steer",
        deliveryState: "available",
        inputSummary: "Use the latest parent ledger evidence before continuing.",
      }),
      expect.objectContaining({
        promptAdmissionId: "prompt-queue-1",
        deliveryMode: "queue",
        deliveryState: "queued",
        inputSummary: "Queue this follow-up until the child reaches a safe boundary.",
      }),
    ]);

    const immediate = service.claimPromptDeliveries({
      invocationId: "invocation-1",
      boundary: "immediate",
      claimedAt: new Date("2026-06-05T16:00:02.000Z"),
    });

    expect(immediate.claimed.map((prompt) => prompt.promptAdmissionId)).toEqual(["prompt-steer-1"]);
    expect(service.status("invocation-1")?.promptInbox).toEqual([
      expect.objectContaining({
        promptAdmissionId: "prompt-steer-1",
        deliveryState: "delivered",
        deliveredAt: "2026-06-05T16:00:02.000Z",
      }),
      expect.objectContaining({
        promptAdmissionId: "prompt-queue-1",
        deliveryState: "queued",
      }),
    ]);

    const safeTurn = service.claimPromptDeliveries({
      invocationId: "invocation-1",
      boundary: "safe-turn",
      claimedAt: new Date("2026-06-05T16:00:03.000Z"),
    });

    expect(safeTurn.claimed.map((prompt) => prompt.promptAdmissionId)).toEqual(["prompt-queue-1"]);
    expect(service.status("invocation-1")?.promptInbox?.map((prompt) => prompt.deliveryState))
      .toEqual(["delivered", "delivered"]);

    terminal.resolve(makeRecord(started.decision.capabilitySnapshot));
    await service.join("invocation-1");
  });

  it("exposes runtime prompt delivery claims to active adapters", async () => {
    const adapterEntered = deferred<void>();
    const releaseClaim = deferred<void>();
    let adapterClaimedPromptIds: readonly string[] = [];
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission, promptDelivery }) => {
        adapterEntered.resolve();
        await releaseClaim.promise;
        adapterClaimedPromptIds = promptDelivery.claim({
          boundary: "immediate",
          claimedAt: new Date("2026-06-05T16:10:01.000Z"),
        }).claimed.map((prompt) => prompt.promptAdmissionId);
        return makeRecord(admission.capabilitySnapshot);
      }),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput());

    expect(started.status).toBe("started");
    if (started.status !== "started") {
      throw new Error("expected managed invocation to start");
    }
    await adapterEntered.promise;

    service.admitPrompt({
      invocationId: "invocation-1",
      promptAdmissionId: "prompt-active-adapter-1",
      prompt: "Steer the active adapter through the runtime delivery port.",
      deliveryMode: "steer",
      wakeRequested: true,
      admittedAt: new Date("2026-06-05T16:10:00.000Z"),
    });

    releaseClaim.resolve();
    await service.join("invocation-1");

    expect(adapterClaimedPromptIds).toEqual(["prompt-active-adapter-1"]);
    expect(service.status("invocation-1")?.promptInbox).toEqual([
      expect.objectContaining({
        promptAdmissionId: "prompt-active-adapter-1",
        deliveryState: "delivered",
        deliveredAt: "2026-06-05T16:10:01.000Z",
      }),
    ]);
  });

  it("marks stale prompt admissions with recovery evidence and excludes them from delivery claims", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => {
        await terminal.promise;
        return makeRecord(admission.capabilitySnapshot);
      }),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput());

    expect(started.status).toBe("started");
    if (started.status !== "started") {
      throw new Error("expected managed invocation to start");
    }

    service.admitPrompt({
      invocationId: "invocation-1",
      promptAdmissionId: "prompt-stale-1",
      prompt: "This queued prompt should be recovered if it is never claimed.",
      deliveryMode: "queue",
      wakeRequested: false,
      admittedAt: new Date("2026-06-05T16:00:00.000Z"),
    });

    const recovered = service.recoverStuckPromptAdmissions({
      staleAfterMs: 1_000,
      now: new Date("2026-06-05T16:00:02.000Z"),
      reason: "Prompt remained queued beyond the managed-agent control timeout.",
    });

    expect(recovered.recovered).toEqual([
      expect.objectContaining({
        promptAdmissionId: "prompt-stale-1",
        deliveryState: "stale",
        recovery: {
          reason: "Prompt remained queued beyond the managed-agent control timeout.",
          recoveredAt: "2026-06-05T16:00:02.000Z",
        },
      }),
    ]);
    expect(service.claimPromptDeliveries({
      invocationId: "invocation-1",
      boundary: "safe-turn",
      claimedAt: new Date("2026-06-05T16:00:03.000Z"),
    }).claimed).toEqual([]);

    terminal.resolve(makeRecord(started.decision.capabilitySnapshot));
    await service.join("invocation-1");
  });

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
    const joinedBeforeAcquirePromise = service.join("invocation-1");
    await flushMicrotasks();
    const joinedBeforeAcquire = await Promise.race([
      joinedBeforeAcquirePromise.then((result) => result.record.lifecycleState),
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
    })).rejects.toThrow("credential-route lease manager is required");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(service.status("invocation-1")).toBeUndefined();
  });

  it("acquires credential-route leases after environment bindings and releases them first", async () => {
    const request = makeCredentialRouteRequest();
    const environmentLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        lease: {
          ...lease,
          healthStatus: "healthy" as const,
          cleanupStatus: "pending" as const,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/invocation-1/environment/EMPTY",
          ],
        },
        environment: {},
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/environment-release/EMPTY",
        ],
      })),
    };
    const credentialRouteLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "healthy" as const,
        cleanupStatus: "pending" as const,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/invocation-1/credential-route/credential-route%3Aopencode%3Aprimary",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/invocation-1/credential-route-release/credential-route%3Aopencode%3Aprimary",
        ],
      })),
    };
    const invoke = vi.fn(async ({ request: adapterRequest, admission }) =>
      makeReadonlyRecordForRequest(adapterRequest, admission.capabilitySnapshot));
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke,
    };
    const service = new RuntimeManagedAgentInvocationService({
      environmentLeaseManager,
      credentialRouteLeaseManager,
    });

    const started = await service.start(request, adapter, {
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
    expect(environmentLeaseManager.acquire).toHaveBeenCalledTimes(1);
    expect(credentialRouteLeaseManager.acquire).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(environmentLeaseManager.acquire.mock.invocationCallOrder[0]).toBeLessThan(
      credentialRouteLeaseManager.acquire.mock.invocationCallOrder[0] ?? 0,
    );
    expect(credentialRouteLeaseManager.acquire.mock.invocationCallOrder[0]).toBeLessThan(
      invoke.mock.invocationCallOrder[0] ?? 0,
    );
    expect(credentialRouteLeaseManager.release.mock.invocationCallOrder[0]).toBeLessThan(
      environmentLeaseManager.release.mock.invocationCallOrder[0] ?? 0,
    );
    expect(joined.record.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
      resourceUris: [
        "kiln://artifacts/invocation-1/environment/EMPTY",
        "kiln://artifacts/invocation-1/credential-route/credential-route%3Aopencode%3Aprimary",
      ],
      diagnosticUris: [
        "kiln://artifacts/invocation-1/credential-route-release/credential-route%3Aopencode%3Aprimary",
        "kiln://artifacts/invocation-1/environment-release/EMPTY",
      ],
    });
  });

  it("rejects credential-route lease manager resource URIs outside the invocation namespace", async () => {
    const credentialRouteLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "healthy" as const,
        cleanupStatus: "pending" as const,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/other-invocation/credential-route/credential-route%3Aopencode%3Aprimary",
        ],
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
    const service = new RuntimeManagedAgentInvocationService({ credentialRouteLeaseManager });

    await expect(service.start(makeCredentialRouteRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("outside invocation artifacts");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(credentialRouteLeaseManager.release).not.toHaveBeenCalled();
    expect(service.status("invocation-1")).toBeUndefined();
  });

  it("records failed credential-route release when diagnostic URIs leave the invocation namespace", async () => {
    const credentialRouteLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "healthy" as const,
        cleanupStatus: "pending" as const,
        resourceUris: [
          ...lease.resourceUris,
          "kiln://artifacts/invocation-1/credential-route/credential-route%3Aopencode%3Aprimary",
        ],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
        diagnosticUris: [
          ...lease.diagnosticUris,
          "kiln://artifacts/other-invocation/credential-route-release/credential-route%3Aopencode%3Aprimary",
        ],
      })),
    };
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ credentialRouteLeaseManager });

    const started = await service.start(makeCredentialRouteRequest(), adapter, {
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
    expect(credentialRouteLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(joined.record.resourceLease).toEqual({
      leaseId: "invocation-1:resource-lease",
      createdAt: "2026-05-07T08:00:00.000Z",
      healthStatus: "leaked",
      cleanupStatus: "failed",
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "read-only",
      resourceUris: [
        "kiln://artifacts/invocation-1/credential-route/credential-route%3Aopencode%3Aprimary",
      ],
      diagnosticUris: [
        "kiln://artifacts/invocation-1/credential-route-cleanup-failed",
      ],
    });
    expect(joined.record.resourceLease?.diagnosticUris).not.toContain(
      "kiln://artifacts/other-invocation/credential-route-release/credential-route%3Aopencode%3Aprimary",
    );
  });

  it("records credential-route lease evidence without exposing secret values", async () => {
    const credentialRouteLeaseManager = new ManagedRuntimeCredentialRouteLeaseManager({
      allowedRouteIds: ["credential-route:opencode:primary"],
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission }) => makeReadonlyRecordForRequest(request, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ credentialRouteLeaseManager });

    const started = await service.start(makeCredentialRouteRequest(), adapter, {
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
      "kiln://artifacts/invocation-1/credential-route/credential-route%3Aopencode%3Aprimary",
    ]);
    expect(joined.record.resourceLease?.diagnosticUris).toEqual([
      "kiln://artifacts/invocation-1/credential-route-release/credential-route%3Aopencode%3Aprimary",
    ]);
    expect(JSON.stringify(joined.record.resourceLease)).not.toContain("secret");
  });

  it("preserves credential route ids as opaque strings and encodes lifecycle evidence", async () => {
    const request = makeCredentialRouteRequest("credential route/opencode primary");
    const credentialRouteLeaseManager = new ManagedRuntimeCredentialRouteLeaseManager({
      allowedRouteIds: ["credential route/opencode primary"],
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request: adapterRequest, admission }) =>
        makeReadonlyRecordForRequest(adapterRequest, admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ credentialRouteLeaseManager });

    const started = await service.start(request, adapter, {
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
      "kiln://artifacts/invocation-1/credential-route/credential%20route%2Fopencode%20primary",
    ]);
    expect(joined.record.resourceLease?.diagnosticUris).toEqual([
      "kiln://artifacts/invocation-1/credential-route-release/credential%20route%2Fopencode%20primary",
    ]);
  });

  it("rejects credential routes outside the configured runtime lease allowlist", async () => {
    const credentialRouteLeaseManager = new ManagedRuntimeCredentialRouteLeaseManager({
      allowedRouteIds: ["credential-route:opencode:secondary"],
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ credentialRouteLeaseManager });

    await expect(service.start(makeCredentialRouteRequest(), adapter, {
      capturedAt: "2026-05-07T08:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    })).rejects.toThrow("not admitted by the credential route lease manager");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(service.status("invocation-1")).toBeUndefined();
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

    expect(cancelled.record.resourceLease).toMatchObject({
      healthStatus: "released",
      cleanupStatus: "completed",
    });
    expect(worktreeLeaseManager.release).toHaveBeenCalledTimes(1);

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
      await writeFile(join(rootPath, "malformed.json"), JSON.stringify({ version: 1 }), "utf-8");

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
      const requestTimeoutSource = JSON.parse(JSON.stringify(validCheckpoint)) as RecoveryCheckpointJson;
      requestTimeoutSource.request.authority.timeoutSource = "request";

      await rm(originalPath, { force: true });
      await writeFile(join(rootPath, "missing-route-source.json"), JSON.stringify(missingRouteSource), "utf-8");
      await writeFile(join(rootPath, "request-timeout-source.json"), JSON.stringify(requestTimeoutSource), "utf-8");

      const checkpoints = await recoveryStore.listRecoverable();

      expect(checkpoints).toEqual([]);
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
      expect(metadataReasons).toContain("Unsupported managed invocation timeout source");

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
    expect(joined.record.lifecycleState).toBe("recovered");
    expect(restartedWorktreeLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(recoveryStore.entries.has("write-1")).toBe(false);
    expect(secondRecovery.recovered).toEqual([]);
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
      const setTimeoutImpl = vi.fn((callback: () => void, delay?: number) => {
        callbacks.push(callback);
        delays.push(delay ?? 0);
        return { delay } as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout;
      const clearTimeoutImpl = vi.fn() as unknown as typeof clearTimeout;
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

  it("marks adapter rejection as failed evidence and rejects join", async () => {
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async () => {
        throw new Error("adapter crashed");
      }),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput());

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
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput());

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

  it("honors a pre-aborted parent signal without invoking the adapter", async () => {
    const parentController = new AbortController();
    parentController.abort("Parent runtime turn interrupted before child start.");
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput(), {
      abortSignal: parentController.signal,
    });
    const joined = await service.join("invocation-1");

    expect(started.status).toBe("started");
    expect(started.snapshot.lifecycleState).toBe("cancelled");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(joined.status).toBe("completed");
    expect(joined.record.lifecycleState).toBe("cancelled");
    expect(joined.record.resultHandoff?.summary).toBe("Parent runtime turn interrupted before child start.");
  });

  it("does not invoke the adapter when parent abort fires during lease acquisition", async () => {
    const acquireEntered = deferred<void>();
    const releaseAcquire = deferred<void>();
    const parentController = new AbortController();
    const sandboxLeaseManager = {
      acquire: vi.fn(async ({ lease }) => {
        acquireEntered.resolve();
        await releaseAcquire.promise;
        return {
          ...lease,
          resourceUris: [
            ...lease.resourceUris,
            "kiln://artifacts/invocation-1/sandbox-policy",
          ],
        };
      }),
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
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => makeRecord(admission.capabilitySnapshot)),
    };
    const service = new RuntimeManagedAgentInvocationService({ sandboxLeaseManager });

    const start = service.start(makeSandboxRequest(), adapter, makeSnapshotInput(), {
      abortSignal: parentController.signal,
    });

    await acquireEntered.promise;
    parentController.abort("Parent runtime turn interrupted during lease acquisition.");
    releaseAcquire.resolve();
    const started = await start;
    const joined = await service.join("invocation-1");

    expect(started.status).toBe("started");
    expect(started.snapshot.lifecycleState).toBe("cancelled");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(sandboxLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(joined.record.lifecycleState).toBe("cancelled");
    expect(joined.record.resultHandoff?.summary)
      .toBe("Parent runtime turn interrupted during lease acquisition.");
    expect(joined.record.resourceLease?.cleanupStatus).toBe("completed");
  });

  it("cancels a running invocation from a parent abort signal and suppresses late adapter success", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const parentController = new AbortController();
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
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput(), {
      abortSignal: parentController.signal,
    });

    expect(started.status).toBe("started");
    expect(adapterSignal?.aborted).toBe(false);

    parentController.abort("Parent runtime turn interrupted.");
    await flushMicrotasks();
    const joined = await service.join("invocation-1");

    expect(adapterSignal?.aborted).toBe(true);
    expect(joined.status).toBe("completed");
    expect(joined.record.lifecycleState).toBe("cancelled");
    expect(joined.record.resultHandoff?.summary).toBe("Parent runtime turn interrupted.");

    terminal.resolve(makeRecord());
    await flushMicrotasks();
    const joinedAfterLateSuccess = await service.join("invocation-1");
    expect(joinedAfterLateSuccess.record.lifecycleState).toBe("cancelled");
    expect(joinedAfterLateSuccess.record.resultHandoff?.summary).toBe("Parent runtime turn interrupted.");
    expect(service.status("invocation-1")?.error).toBeUndefined();
  });

  it("resolves cancellation joins without waiting for late adapter output", async () => {
    let adapterSignal: AbortSignal | undefined;
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ abortSignal }) => {
        adapterSignal = abortSignal;
        await new Promise<never>(() => undefined);
      }),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput());

    expect(started.status).toBe("started");
    expect(adapterSignal?.aborted).toBe(false);

    const cancelled = await service.cancel("invocation-1", "Operator cancelled the child run.");
    const joinPromise = service.join("invocation-1");
    await flushMicrotasks();
    const joinedState = await Promise.race([
      joinPromise.then((result) => result.record.lifecycleState),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 0)),
    ]);

    expect(adapterSignal?.aborted).toBe(true);
    expect(cancelled.record.lifecycleState).toBe("cancelled");
    expect(joinedState).toBe("cancelled");
    expect(service.status("invocation-1")?.record?.resultHandoff?.summary)
      .toBe("Operator cancelled the child run.");
  });

  it("enriches a cancelled invocation when the adapter later returns cancellation evidence", async () => {
    const terminal = deferred<ManagedAgentInvocationRecord>();
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async () => terminal.promise),
    };

    const service = new RuntimeManagedAgentInvocationService();
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput());

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
    for (let index = 0; index < 12; index += 1) {
      await flushMicrotasks();
      if (service.status("invocation-1")?.record?.transcript?.uri !== undefined) {
        break;
      }
    }
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
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput());

    expect(started.status).toBe("started");
    await expect(service.start(makeRequest(), adapter, makeSnapshotInput())).rejects.toThrow("already registered");

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
    const result = await service.invoke(makeRequest(), adapter, makeSnapshotInput());

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
    const started = await service.start(makeRequest(), adapter, makeSnapshotInput());

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
