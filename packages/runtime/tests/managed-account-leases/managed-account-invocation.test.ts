import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAccountRef,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
  type ManagedAgentCapabilitySnapshot,
  type ManagedAgentInvocationRecord,
} from "@kilnai/core";
import {
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedAccountLeaseUnavailableError,
  RuntimeManagedAgentInvocationService,
  type ManagedAgentRuntimeAdapter,
} from "../../src/agents/managed-invocation/index.js";
import {
  SqliteManagedAccountLeaseAuthority,
  type ManagedAccountCandidateBinding,
} from "../../src/managed-account-leases/managed-account-lease-authority.js";

const roots: string[] = [];
const authorities: SqliteManagedAccountLeaseAuthority[] = [];

afterEach(async () => {
  for (const authority of authorities.splice(0)) authority.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("managed account invocation lifecycle", () => {
  it("acquires and binds one account before dispatch, then releases it after settlement", async () => {
    const events: string[] = [];
    const authority = await createAuthority();
    const adapter = makeAdapter(async (input) => {
      events.push("dispatch");
      input.registerExecutionSettlement(Promise.resolve());
      return completedRecord(input.request, input.admission.capabilitySnapshot);
    });
    const service = createService(authority, adapter, events);

    const result = await service.invoke(request(), adapter, snapshotInput());

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completion");
    expect(events).toEqual(["candidates", "bind", "dispatch"]);
    expect(result.record.accountLease).toMatchObject({
      accountPolicyId: "managed-opencode",
      accountRef: "configured:account-a",
      lifecycleState: "released",
      selectionReason: "least-pressure",
    });
    expect(authority.list()).toHaveLength(1);
    expect(authority.list()[0]?.lifecycleState).toBe("released");
  });

  it("projects timeout while retaining capacity until the registered execution settles", async () => {
    const authority = await createAuthority();
    let settle!: () => void;
    const settlement = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const adapter = makeAdapter(async (input) => {
      input.registerExecutionSettlement(settlement);
      return timedOutRecord(input.request, input.admission.capabilitySnapshot);
    });
    const service = createService(authority, adapter);

    const result = await service.invoke(request(), adapter, snapshotInput());

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected timeout projection");
    expect(result.record.lifecycleState).toBe("timed_out");
    expect(result.record.accountLease?.lifecycleState).toBe("settlement-pending");
    expect(authority.list()[0]?.lifecycleState).toBe("settlement-pending");

    settle();
    await vi.waitFor(() => {
      expect(authority.list()[0]?.lifecycleState).toBe("released");
    });
    expect(service.status("managed-job-0001")?.record?.accountLease?.lifecycleState).toBe("released");
  });

  it("retains capacity after cancellation until the registered execution settles", async () => {
    const authority = await createAuthority();
    let settle!: () => void;
    const settlement = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const adapter = makeAdapter(async (input) => {
      input.registerExecutionSettlement(settlement);
      return new Promise<ManagedAgentInvocationRecord>(() => undefined);
    });
    const service = createService(authority, adapter);

    const started = await service.start(request(), adapter, snapshotInput());
    expect(started.status).toBe("started");
    const cancelled = await service.cancel("managed-job-0001");

    expect(cancelled.record.accountLease?.lifecycleState).toBe("settlement-pending");
    expect(authority.list()[0]?.lifecycleState).toBe("settlement-pending");

    settle();
    await vi.waitFor(() => {
      expect(authority.list()[0]?.lifecycleState).toBe("released");
    });
  });

  it("releases a failed provider attempt only after its execution settles", async () => {
    const authority = await createAuthority();
    const adapter = makeAdapter(async (input) => {
      input.registerExecutionSettlement(Promise.resolve());
      return failedRecord(input.request, input.admission.capabilitySnapshot);
    });
    const service = createService(authority, adapter);

    const result = await service.invoke(request(), adapter, snapshotInput());

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected failure");
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.accountLease?.lifecycleState).toBe("released");
  });

  it("fails closed with typed rejection evidence when no account has capacity", async () => {
    const authority = await createAuthority();
    const adapter = makeAdapter(async (input) =>
      completedRecord(input.request, input.admission.capabilitySnapshot));
    const service = createService(authority, adapter, [], undefined, []);

    const failure = await service.start(request(), adapter, snapshotInput()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ManagedAccountLeaseUnavailableError);
    expect(failure).toMatchObject({ rejections: [] });
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it("releases a pre-dispatch lease when selected credential binding fails", async () => {
    const authority = await createAuthority();
    const adapter = makeAdapter(async (input) => completedRecord(input.request, input.admission.capabilitySnapshot));
    const service = createService(authority, adapter, [], new Error("Selected credential revision changed."));

    await expect(service.start(request(), adapter, snapshotInput())).rejects.toThrow("Selected credential revision changed.");

    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(authority.list()).toHaveLength(1);
    expect(authority.list()[0]?.lifecycleState).toBe("released");
  });
});

async function createAuthority(): Promise<SqliteManagedAccountLeaseAuthority> {
  const root = await mkdtemp(join(tmpdir(), "kiln-managed-account-invocation-"));
  roots.push(root);
  const authority = new SqliteManagedAccountLeaseAuthority({
    path: join(root, "leases.sqlite"),
    ownerId: "runtime-owner",
    now: () => Date.parse("2026-07-28T20:00:00.000Z"),
  });
  authorities.push(authority);
  return authority;
}

function createService(
  authority: SqliteManagedAccountLeaseAuthority,
  boundAdapter: ManagedAgentRuntimeAdapter,
  events: string[] = [],
  bindingFailure?: Error,
  candidates: readonly ManagedAccountCandidateBinding[] = [{
    candidate: {
      account: createAccountRef("configured:account-a"),
      route: {
        providerId: "opencode",
        providerModelId: "sonic",
        scope: "virtual:managed-opencode",
      },
      health: "healthy",
      leaseCapacity: "available",
      pressure: 0,
      reservedForNewWork: false,
    },
    capacityIdentity: "account-a",
    credentialRevisionId: "a".repeat(64),
    usageEvidence: {
      health: "healthy",
      freshness: "missing",
    },
    capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 },
  }],
): RuntimeManagedAgentInvocationService {
  return new RuntimeManagedAgentInvocationService({
    credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
      allowedRouteIds: ["credential-route:opencode:primary"],
    }),
    accountLeaseAuthority: authority,
    accountCandidatePort: {
      resolve: async () => {
        events.push("candidates");
        return {
          route: {
            providerId: "opencode",
            providerModelId: "sonic",
            scope: "virtual:managed-opencode",
          },
          candidates,
        };
      },
    },
    accountExecutionBindingPort: {
      bind: async () => {
        events.push("bind");
        if (bindingFailure) throw bindingFailure;
        return boundAdapter;
      },
    },
  });
}

function request() {
  return defineManagedAgentInvocationRequest({
    invocationId: "managed-job-0001",
    agentId: "reviewer",
    parentSessionId: "parent-session",
    parentTurnId: "parent-turn",
    profile: "foundation-readonly-plan",
    requestedBy: "operator",
    requestSource: "managed-job",
    providerRoute: { providerId: "opencode", model: "sonic", surface: "direct-provider" },
    adapterKind: "direct",
    executionMode: "direct-provider",
    authority: {
      authorityProfileId: "foundation-readonly",
      permissionProfile: "read-only",
      toolAuthority: { allowedToolNames: ["read"], writeAllowed: false, networkAllowed: false },
      workingDirectory: { path: "C:/workspace/kiln", mode: "read-only" },
      timeoutMs: 1000,
      credentialRoute: {
        mode: "account-leased",
        routeId: "credential-route:opencode:primary",
        accountPolicyId: "managed-opencode",
      },
      memoryScope: { scope: { kind: "project", id: "kiln" }, access: "read-only" },
    },
    input: { summary: "Inspect the project." },
  });
}

function makeAdapter(
  invoke: ManagedAgentRuntimeAdapter["invoke"],
): ManagedAgentRuntimeAdapter {
  return {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:opencode:managed",
      providerId: "opencode",
      adapterKind: "direct",
      supportedProfiles: ["foundation-readonly-plan"],
      supportedExecutionModes: ["direct-provider"],
      lifecycle: { exposesStart: true, exposesTerminal: true, exposesCleanup: true },
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
        tokenClasses: ["input", "output"],
        semanticSourceGranularity: "unknown",
        evidenceBasis: "adapter",
      },
      resultHandoff: { boundedSummary: true, resourcePointers: true },
      credentialRoute: { supported: true },
      memoryContext: { governedAdmission: true },
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    }),
    invoke: vi.fn(invoke),
  };
}

function snapshotInput() {
  return {
    capturedAt: "2026-07-28T20:00:00.000Z",
    routeId: "opencode-managed",
    routeSource: "explicit-managed-route" as const,
  };
}

function completedRecord(
  managedRequest: ReturnType<typeof request>,
  capabilitySnapshot: ManagedAgentCapabilitySnapshot,
): ManagedAgentInvocationRecord {
  return record(managedRequest, capabilitySnapshot, "completed");
}

function timedOutRecord(
  managedRequest: ReturnType<typeof request>,
  capabilitySnapshot: ManagedAgentCapabilitySnapshot,
): ManagedAgentInvocationRecord {
  return record(managedRequest, capabilitySnapshot, "timed_out");
}

function failedRecord(
  managedRequest: ReturnType<typeof request>,
  capabilitySnapshot: ManagedAgentCapabilitySnapshot,
): ManagedAgentInvocationRecord {
  return record(managedRequest, capabilitySnapshot, "failed");
}

function record(
  managedRequest: ReturnType<typeof request>,
  capabilitySnapshot: ManagedAgentCapabilitySnapshot,
  lifecycleState: "completed" | "timed_out" | "failed",
): ManagedAgentInvocationRecord {
  return defineManagedAgentInvocationRecord({
    invocationId: managedRequest.invocationId,
    agentId: managedRequest.agentId,
    parentSessionId: managedRequest.parentSessionId,
    parentTurnId: managedRequest.parentTurnId,
    profile: managedRequest.profile,
    lifecycleState,
    providerRoute: managedRequest.providerRoute,
    adapterKind: managedRequest.adapterKind,
    executionMode: managedRequest.executionMode,
    authority: managedRequest.authority,
    capabilitySnapshot,
    ...(lifecycleState === "completed"
      ? {
          resultHandoff: {
            summary: "Inspection completed.",
            resourceUris: [],
            memoryWriteProposalUris: [],
          },
        }
      : {
          diagnostics: [{
            kind: lifecycleState === "timed_out" ? "timeout" as const : "failure" as const,
            uri: `kiln://managed/managed-job-0001/${lifecycleState}`,
          }],
        }),
  });
}
