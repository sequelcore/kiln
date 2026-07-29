import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAccountRef,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
  type ManagedAgentInvocationRequest,
  type ManagedAccountAffinityPolicy,
  type ManagedAgentCapabilitySnapshot,
  type ManagedAgentInvocationRecord,
  type ModelGatewayConfig,
  type ProviderAdapter,
} from "@kilnai/core";
import {
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedAccountLeaseUnavailableError,
  RuntimeManagedAgentInvocationService,
  type ManagedAgentRuntimeAdapter,
} from "../../src/agents/managed-invocation/index.js";
import { ManagedDirectProviderRuntimeAdapter } from "../../src/agents/managed-invocation/direct-runtime-adapter.js";
import {
  DirectProviderCredentialPoolService,
  type DirectProviderAuth,
} from "../../src/agents/credential-pool/direct-provider-credential-pool.js";
import { CredentialFileStore } from "../../src/agents/credential-pool/credential-file-store.js";
import { ConfiguredManagedAccountRuntime } from "../../src/managed-account-leases/configured-managed-account-runtime.js";
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
    const boundAccounts: string[] = [];
    const service = createService(
      authority,
      adapter,
      [],
      undefined,
      [candidate("account-a"), candidate("account-b")],
      { continuity: "none" },
      boundAccounts,
    );

    const result = await service.invoke(request(), adapter, snapshotInput());

    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected timeout projection");
    expect(result.record.lifecycleState).toBe("timed_out");
    expect(result.record.accountLease?.lifecycleState).toBe("settlement-pending");
    expect(authority.list()[0]?.lifecycleState).toBe("settlement-pending");
    const other = await service.invoke(
      request({ invocationId: "managed-job-timeout-other" }),
      adapter,
      snapshotInput(),
    );
    expect(other.status).toBe("completed");
    if (other.status !== "completed") throw new Error("expected second timeout projection");
    expect(other.record.accountLease).toMatchObject({
      accountRef: "configured:account-b",
      lifecycleState: "settlement-pending",
    });
    await expect(service.start(
      request({ invocationId: "managed-job-timeout-third" }),
      adapter,
      snapshotInput(),
    )).rejects.toMatchObject({
      rejections: [
        { account: "configured:account-a", reason: "lease-conflict" },
        { account: "configured:account-b", reason: "lease-conflict" },
      ],
    });
    expect(boundAccounts).toEqual(["configured:account-a", "configured:account-b"]);

    settle();
    await vi.waitFor(() => {
      expect(authority.list().every((lease) => lease.lifecycleState === "released")).toBe(true);
    });
    expect(service.status("managed-job-0001")?.record?.accountLease?.lifecycleState).toBe("released");
    expect(service.status("managed-job-timeout-other")?.record?.accountLease?.lifecycleState).toBe("released");
    expect(authority.list().every((lease) => lease.affinityCommitOutcome === undefined)).toBe(true);
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
    const boundAccounts: string[] = [];
    const service = createService(
      authority,
      adapter,
      [],
      undefined,
      [candidate("account-a"), candidate("account-b")],
      { continuity: "none" },
      boundAccounts,
    );

    const started = await service.start(request(), adapter, snapshotInput());
    expect(started.status).toBe("started");
    const cancelled = await service.cancel("managed-job-0001");

    expect(cancelled.record.accountLease?.lifecycleState).toBe("settlement-pending");
    expect(authority.list()[0]?.lifecycleState).toBe("settlement-pending");
    const other = await service.start(
      request({ invocationId: "managed-job-cancel-other" }),
      adapter,
      snapshotInput(),
    );
    expect(other.status).toBe("started");
    await expect(service.start(
      request({ invocationId: "managed-job-cancel-third" }),
      adapter,
      snapshotInput(),
    )).rejects.toMatchObject({
      rejections: [
        { account: "configured:account-a", reason: "lease-conflict" },
        { account: "configured:account-b", reason: "lease-conflict" },
      ],
    });
    const otherCancelled = await service.cancel("managed-job-cancel-other");
    expect(otherCancelled.record.accountLease).toMatchObject({
      accountRef: "configured:account-b",
      lifecycleState: "settlement-pending",
    });
    expect(boundAccounts).toEqual(["configured:account-a", "configured:account-b"]);

    settle();
    await vi.waitFor(() => {
      expect(authority.list().every((lease) => lease.lifecycleState === "released")).toBe(true);
    });
    expect(authority.list().every((lease) => lease.affinityCommitOutcome === undefined)).toBe(true);
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

  it("derives managed affinity from admitted lineage and commits it only after success", async () => {
    const authority = await createAuthority();
    const boundAccounts: string[] = [];
    const adapter = makeAdapter(async (input) => {
      input.registerExecutionSettlement(Promise.resolve());
      return completedRecord(input.request, input.admission.capabilitySnapshot);
    });
    const candidates = [
      candidate("account-a", { maxConcurrency: 2, reservedAffinitySlots: 1 }),
      candidate("account-b"),
    ];
    const service = createService(
      authority,
      adapter,
      [],
      undefined,
      candidates,
      { continuity: "prefer", scope: "session", allowRebind: true },
      boundAccounts,
    );

    const first = await service.invoke(request({ invocationId: "managed-job-affinity-1" }), adapter, snapshotInput());
    const second = await service.invoke(request({ invocationId: "managed-job-affinity-2" }), adapter, snapshotInput());

    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    if (first.status !== "completed" || second.status !== "completed") throw new Error("expected completions");
    expect(first.record.accountLease).toMatchObject({
      accountRef: "configured:account-a",
      selectionReason: "least-pressure",
      affinityCommitOutcome: "won",
    });
    expect(second.record.accountLease).toMatchObject({
      accountRef: "configured:account-a",
      selectionReason: "existing-affinity",
      affinityOutcome: "honored",
      affinityCommitOutcome: "already-matched",
    });
    const requiredService = createService(
      authority,
      adapter,
      [],
      undefined,
      candidates,
      { continuity: "require", scope: "session" },
      boundAccounts,
    );
    const required = await requiredService.invoke(
      request({ invocationId: "managed-job-affinity-required" }),
      adapter,
      snapshotInput(),
    );
    expect(required.status).toBe("completed");
    if (required.status !== "completed") throw new Error("expected required affinity completion");
    expect(required.record.accountLease).toMatchObject({
      accountRef: "configured:account-a",
      selectionReason: "existing-affinity",
      affinityOutcome: "honored",
      affinityCommitOutcome: "already-matched",
    });
    await expect(requiredService.start(
      request({
        invocationId: "managed-job-affinity-required-new-lineage",
        parentSessionId: "different-parent-session",
      }),
      adapter,
      snapshotInput(),
    )).rejects.toMatchObject({ rejections: [] });
    expect(boundAccounts).toEqual([
      "configured:account-a",
      "configured:account-a",
      "configured:account-a",
    ]);
  });

  it("preserves provider success and the winning mapping when concurrent first affinity commits conflict", async () => {
    const authority = await createAuthority();
    const completions = new Map<string, {
      readonly resolve: (record: ManagedAgentInvocationRecord) => void;
      readonly snapshot: ManagedAgentCapabilitySnapshot;
    }>();
    const adapter = makeAdapter((input) => {
      const execution = new Promise<ManagedAgentInvocationRecord>((resolve) => {
        completions.set(input.request.invocationId, {
          resolve,
          snapshot: input.admission.capabilitySnapshot,
        });
      });
      input.registerExecutionSettlement(execution);
      return execution;
    });
    const boundAccounts: string[] = [];
    const service = createService(
      authority,
      adapter,
      [],
      undefined,
      [candidate("account-a"), candidate("account-b")],
      { continuity: "prefer", scope: "session" },
      boundAccounts,
    );
    const firstRequest = request({ invocationId: "managed-job-affinity-conflict-a" });
    const secondRequest = request({ invocationId: "managed-job-affinity-conflict-b" });

    await service.start(firstRequest, adapter, snapshotInput());
    await service.start(secondRequest, adapter, snapshotInput());
    expect(boundAccounts).toEqual(["configured:account-a", "configured:account-b"]);

    const secondCompletion = completions.get(secondRequest.invocationId);
    if (!secondCompletion) throw new Error("second execution did not start");
    secondCompletion.resolve(completedRecord(secondRequest, secondCompletion.snapshot));
    await vi.waitFor(() => {
      expect(service.status(secondRequest.invocationId)?.record).toMatchObject({
        lifecycleState: "completed",
        accountLease: {
          accountRef: "configured:account-b",
          affinityCommitOutcome: "won",
          lifecycleState: "released",
        },
      });
    });

    const firstCompletion = completions.get(firstRequest.invocationId);
    if (!firstCompletion) throw new Error("first execution did not start");
    firstCompletion.resolve(completedRecord(firstRequest, firstCompletion.snapshot));
    await vi.waitFor(() => {
      expect(service.status(firstRequest.invocationId)?.record).toMatchObject({
        lifecycleState: "completed",
        accountLease: {
          accountRef: "configured:account-a",
          affinityCommitOutcome: "conflict",
          lifecycleState: "released",
        },
      });
    });
    const continuedRequest = request({ invocationId: "managed-job-affinity-winner-check" });
    await service.start(continuedRequest, adapter, snapshotInput());
    const continuedCompletion = completions.get(continuedRequest.invocationId);
    if (!continuedCompletion) throw new Error("continued execution did not start");
    continuedCompletion.resolve(completedRecord(continuedRequest, continuedCompletion.snapshot));
    await vi.waitFor(() => {
      expect(service.status(continuedRequest.invocationId)?.record?.accountLease).toMatchObject({
        accountRef: "configured:account-b",
        selectionReason: "existing-affinity",
        affinityOutcome: "honored",
        lifecycleState: "released",
      });
    });
    expect(boundAccounts).toEqual([
      "configured:account-a",
      "configured:account-b",
      "configured:account-b",
    ]);
  });

  it("composes configured two-account projection through binding and never touches a second credential after selection", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-account-composed-"));
    roots.push(root);
    const credentialStore = new CredentialFileStore<DirectProviderAuth>({ rootDir: root });
    await Promise.all([
      credentialStore.writeCredential({
        providerId: "openai",
        id: "credential-a",
        label: "Synthetic A",
        auth: { apiKey: "synthetic-a" },
      }),
      credentialStore.writeCredential({
        providerId: "openai",
        id: "credential-b",
        label: "Synthetic B",
        auth: { apiKey: "synthetic-b" },
      }),
      credentialStore.writeCredential({
        providerId: "openai",
        id: "unconfigured",
        label: "Must remain excluded",
        auth: { apiKey: "synthetic-unconfigured" },
      }),
    ]);
    const configured = new ConfiguredManagedAccountRuntime({
      config: composedAccountConfig(),
      credentialRootDir: root,
      env: {},
      now: () => new Date("2026-07-28T20:00:00.000Z"),
    });
    const projected = await configured.resolve({
      accountPolicyId: "managed-openai",
      providerRoute: { providerId: "openai", surface: "direct", model: "gpt-test" },
    });
    expect(projected.candidates.map((entry) => entry.capacityIdentity)).toEqual([
      "account-b",
      "account-a",
    ]);
    expect(JSON.stringify(projected.candidates)).not.toContain("unconfigured");
    expect(JSON.stringify(projected.candidates)).not.toContain("synthetic-");
    const accountARef = projected.candidates.find((entry) =>
      entry.capacityIdentity === "account-a")?.candidate.account;
    if (!accountARef) throw new Error("configured account A was not projected");

    const authority = new SqliteManagedAccountLeaseAuthority({
      path: join(root, "leases.sqlite"),
      ownerId: "runtime-owner",
      now: () => Date.parse("2026-07-28T20:00:00.000Z"),
    });
    authorities.push(authority);
    const credentialResolutions = vi.spyOn(
      DirectProviderCredentialPoolService.prototype,
      "resolveExecutionCredential",
    );
    const binds: string[] = [];
    const dispatches: string[] = [];
    const service = new RuntimeManagedAgentInvocationService({
      credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
        allowedRouteIds: ["credential-route:openai:primary"],
      }),
      accountLeaseAuthority: authority,
      accountCandidatePort: configured,
      accountExecutionBindingPort: {
        bind: async ({ lease, adapter }) => {
          binds.push(lease.accountRef);
          if (lease.jobId === "managed-job-binding-failure") {
            await credentialStore.writeCredential({
              providerId: "openai",
              id: "credential-a",
              label: "Synthetic A changed",
              auth: { apiKey: "synthetic-a-revision-changed" },
            });
          }
          const bound = await configured.bind({ lease, adapter });
          return {
            descriptor: bound.descriptor,
            invoke: vi.fn(async (input) => {
              dispatches.push(lease.accountRef);
              input.registerExecutionSettlement(Promise.resolve());
              return failedRecord(input.request, input.admission.capabilitySnapshot);
            }),
          };
        },
      },
    });

    const providerFailure = await service.invoke(
      configuredRequest("managed-job-provider-failure"),
      directTemplate(),
      snapshotInput(),
    );
    expect(providerFailure.status).toBe("completed");
    if (providerFailure.status !== "completed") throw new Error("expected provider failure projection");
    expect(providerFailure.record).toMatchObject({
      lifecycleState: "failed",
      accountLease: {
        accountRef: accountARef,
        lifecycleState: "released",
      },
    });
    expect(credentialResolutions.mock.calls.map(([selected]) => selected.credentialId)).toEqual([
      "credential-a",
    ]);
    expect(binds).toEqual([accountARef]);
    expect(dispatches).toEqual([accountARef]);

    await expect(service.start(
      configuredRequest("managed-job-binding-failure"),
      directTemplate(),
      snapshotInput(),
    )).rejects.toThrow("revision changed");
    expect(credentialResolutions.mock.calls.map(([selected]) => selected.credentialId)).toEqual([
      "credential-a",
    ]);
    expect(binds).toHaveLength(2);
    expect(binds[1]).toMatch(/^configured:account-a:/);
    expect(dispatches).toEqual([accountARef]);
    expect(authority.list()).toEqual(expect.arrayContaining([
      { jobId: "managed-job-provider-failure", lifecycleState: "released" },
      { jobId: "managed-job-binding-failure", lifecycleState: "released" },
    ].map((entry) => expect.objectContaining(entry))));
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
  candidates: readonly ManagedAccountCandidateBinding[] = [candidate("account-a")],
  affinityPolicy: ManagedAccountAffinityPolicy = { continuity: "none" },
  boundAccounts?: string[],
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
          affinityPolicy,
          candidates,
        };
      },
    },
    accountExecutionBindingPort: {
      bind: async ({ lease }) => {
        events.push("bind");
        boundAccounts?.push(lease.accountRef);
        if (bindingFailure) throw bindingFailure;
        return boundAdapter;
      },
    },
  });
}

function request(overrides: { readonly invocationId?: string; readonly parentSessionId?: string; readonly parentTurnId?: string } = {}) {
  return defineManagedAgentInvocationRequest({
    invocationId: overrides.invocationId ?? "managed-job-0001",
    agentId: "reviewer",
    parentSessionId: overrides.parentSessionId ?? "parent-session",
    parentTurnId: overrides.parentTurnId ?? "parent-turn",
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

function configuredRequest(invocationId: string): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId,
    agentId: "reviewer",
    parentSessionId: "parent-session",
    parentTurnId: "parent-turn",
    profile: "foundation-readonly-plan",
    requestedBy: "operator",
    requestSource: "managed-job",
    providerRoute: { providerId: "openai", model: "gpt-test", surface: "direct-provider" },
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
        routeId: "credential-route:openai:primary",
        accountPolicyId: "managed-openai",
      },
      memoryScope: { scope: { kind: "project", id: "kiln" }, access: "read-only" },
    },
    input: { summary: "Inspect the project." },
  });
}

function composedAccountConfig(): ModelGatewayConfig {
  return {
    port: 4819,
    accounts: [
      {
        id: "account-a",
        providerId: "openai",
        credentialId: "credential-a",
        maxConcurrency: 1,
        reservedAffinitySlots: 0,
      },
      {
        id: "account-b",
        providerId: "openai",
        credentialId: "credential-b",
        maxConcurrency: 1,
        reservedAffinitySlots: 0,
      },
    ],
    replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
    surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
    principals: [],
    virtualModels: [{
      id: "managed-openai",
      providerId: "openai",
      providerModelId: "gpt-test",
      accountIds: ["account-b", "account-a"],
      capabilities: ["text"],
      affinity: { continuity: "prefer", scope: "session", allowRebind: true },
    }],
  };
}

function directTemplate(): ManagedDirectProviderRuntimeAdapter {
  const provider: ProviderAdapter = {
    name: "unbound",
    createMessage: async () => {
      throw new Error("unbound");
    },
    streamMessage: async function* () {
      throw new Error("unbound");
    },
  };
  return new ManagedDirectProviderRuntimeAdapter({
    providerId: "openai",
    model: "gpt-test",
    provider,
    tools: [],
    builtinTools: new Map(),
  });
}

function candidate(
  accountId: string,
  capacity: { readonly maxConcurrency: number; readonly reservedAffinitySlots: number } = {
    maxConcurrency: 1,
    reservedAffinitySlots: 0,
  },
): ManagedAccountCandidateBinding {
  return {
    candidate: {
      account: createAccountRef(`configured:${accountId}`),
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
    capacityIdentity: accountId,
    credentialRevisionId: accountId === "account-a" ? "a".repeat(64) : "b".repeat(64),
    usageEvidence: {
      health: "healthy",
      freshness: "missing",
    },
    capacity,
  };
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
  managedRequest: ManagedAgentInvocationRequest,
  capabilitySnapshot: ManagedAgentCapabilitySnapshot,
): ManagedAgentInvocationRecord {
  return record(managedRequest, capabilitySnapshot, "completed");
}

function timedOutRecord(
  managedRequest: ManagedAgentInvocationRequest,
  capabilitySnapshot: ManagedAgentCapabilitySnapshot,
): ManagedAgentInvocationRecord {
  return record(managedRequest, capabilitySnapshot, "timed_out");
}

function failedRecord(
  managedRequest: ManagedAgentInvocationRequest,
  capabilitySnapshot: ManagedAgentCapabilitySnapshot,
): ManagedAgentInvocationRecord {
  return record(managedRequest, capabilitySnapshot, "failed");
}

function record(
  managedRequest: ManagedAgentInvocationRequest,
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
