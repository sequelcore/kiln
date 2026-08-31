import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { vi } from "vitest";
import {
  buildManagedAgentCapabilitySnapshot,
  createExecutionAccountPolicyId,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
  defineManagedAgentWriteAuthority,
  type ManagedAgentAdapterDescriptor,
  type ManagedAgentCapabilitySnapshotInput,
  type ManagedAgentInvocationRecord,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core/agents";
import type {
  ManagedAgentRuntimeInvocationResult,
  ManagedAgentRuntimeInvocationStartResult,
  ManagedAgentRuntimeRecoveryCheckpoint,
  ManagedAgentRuntimeRecoveryStore,
} from "../../src/agents/managed-invocation/index.js";

const execFileAsync = promisify(execFile);

export function requireCompletedInvocation(result: ManagedAgentRuntimeInvocationResult) {
  if (result.status !== "completed") {
    throw new Error(`Expected completed managed invocation, received ${result.status}.`);
  }
  return result;
}

export function requireStartedInvocation(result: ManagedAgentRuntimeInvocationStartResult) {
  if (result.status !== "started") {
    throw new Error(`Expected started managed invocation, received ${result.status}.`);
  }
  return result;
}

export function makeSnapshotInput(
  overrides: Partial<ManagedAgentCapabilitySnapshotInput> = {},
): ManagedAgentCapabilitySnapshotInput {
  return {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: "opencode:managed-test-route",
    routeSource: "explicit-managed-route",
    ...overrides,
  };
}

export function makeRequest(): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-1",
    agentId: "agent-reviewer",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
    access: "read-only",
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
      authorityProfileId: "read-only",
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

export function makeDescriptor(overrides: Partial<ManagedAgentAdapterDescriptor> = {}): ManagedAgentAdapterDescriptor {
  return defineManagedAgentAdapterDescriptor({
    adapterDescriptorId: "adapter:opencode:harness",
    providerId: "opencode",
    adapterKind: "harness",
    supportedAccess: ["read-only"],
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

export function makeWriteDescriptor(): ManagedAgentAdapterDescriptor {
  return makeDescriptor({
    supportedAccess: ["read-only", "approved-write"],
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

export function makeApprovedWriteRequest(
  invocationId: string,
  allowedPaths: readonly string[],
): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId,
    agentId: "agent-implementer",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
    access: "approved-write",
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
      authorityProfileId: "approved-write",
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
        scope: {
          workspace: {
            mode: "apply-approved",
            allowedPaths,
            deniedPaths: ["C:/workspace/kiln/.git"],
          },
          memory: {
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

export function makeIsolatedWorktreeRequest(invocationId = "write-1"): ManagedAgentInvocationRequest {
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

export function makeIsolatedWorktreeRequestForPath(
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
        scope: {
          workspace: {
            mode: "apply-approved",
            allowedPaths: [join(worktreePath, "packages", "core")],
            deniedPaths: [join(worktreePath, ".git")],
          },
          memory: {
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

export function makeSandboxRequest(invocationId = "invocation-1"): ManagedAgentInvocationRequest {
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

export function makeSandboxWriteRequest(
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

export function makeCredentiallessRequest(): ManagedAgentInvocationRequest {
  const request = makeRequest();
  return defineManagedAgentInvocationRequest({
    ...request,
    authority: {
      ...request.authority,
      credentialRoute: { mode: "credentialless" },
    },
  });
}

export function makeCredentialRouteRequest(routeId = "credential-route:opencode:primary"): ManagedAgentInvocationRequest {
  const request = makeRequest();
  return defineManagedAgentInvocationRequest({
    ...request,
    authority: {
      ...request.authority,
      credentialRoute: {
        mode: "account-leased",
        routeId,
        accountPolicyId: createExecutionAccountPolicyId("managed-opencode"),
      },
    },
  });
}

export function makeRecord(
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
    access: request.access,
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
      provenance: runtimeGeneratedProvenance(request.providerRoute.model),
      summary: "Inspection completed.",
      resourceUris: ["kiln://artifacts/invocation-1/result"],
      memoryWriteProposalUris: [],
    },
  });
}

export function makeReadonlyRecordForRequest(
  request: ManagedAgentInvocationRequest,
  capabilitySnapshot = buildManagedAgentCapabilitySnapshot(request, makeDescriptor(), {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: `${request.providerRoute.providerId}:${request.access}`,
    routeSource: "explicit-managed-route",
  }),
): ManagedAgentInvocationRecord {
  return defineManagedAgentInvocationRecord({
    ...makeRecord(capabilitySnapshot),
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    access: request.access,
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    capabilitySnapshot,
  });
}

export function makeRecordForRequest(
  request: ManagedAgentInvocationRequest,
  capabilitySnapshot = buildManagedAgentCapabilitySnapshot(request, makeWriteDescriptor(), {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: `${request.providerRoute.providerId}:${request.access}`,
    routeSource: "explicit-managed-route",
  }),
): ManagedAgentInvocationRecord {
  return defineManagedAgentInvocationRecord({
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    access: request.access,
    lifecycleState: "completed",
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    capabilitySnapshot,
    resultHandoff: {
      provenance: runtimeGeneratedProvenance(request.providerRoute.model),
      summary: "Write completed.",
      resourceUris: [`kiln://artifacts/${request.invocationId}/result`],
      memoryWriteProposalUris: [],
    },
  });
}

export function runtimeGeneratedProvenance(model: string | undefined) {
  return {
    delivery: "runtime-generated" as const,
    configuredModelId: model ?? "provider-default",
    observedModelIds: [],
  };
}

export function deferred<T>(): {
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

export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    windowsHide: true,
  });
  return stdout.toString();
}

export async function expectPathEventuallyExists(
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

export function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT";
}

export async function findAvailablePort(): Promise<number> {
  return withOccupiedPort(async (port) => port, true);
}

export async function withOccupiedPort<T>(
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

export async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
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

export function makeRecoveryStore(): ManagedAgentRuntimeRecoveryStore & {
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
