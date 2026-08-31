import { describe, expect, it, vi } from "vitest";
import type { ManagedAgentInvocationRecord, ManagedAgentInvocationRequest } from "@kilnai/core/agents";
import { defineManagedAgentInvocationRecord, defineManagedAgentInvocationRequest } from "@kilnai/core/agents";
import type { ActionEffectEnvelope, AuthorityDescriptor } from "@kilnai/core/engine";
import type { ExecutionSessionEvent } from "@kilnai/core/events";
import { RuntimeManagedAgentInvocationService } from "../../src/agents/managed-invocation/invocation-service.js";
import { ManagedCliHarnessAdapter } from "../../src/agents/managed-invocation/cli-harness-adapter.js";
import { ManagedRemoteHarnessAdapter, type ManagedRemoteHarnessTransport } from "../../src/agents/managed-invocation/remote-harness-adapter.js";
import {
  createManagedExternalInvocationPermit,
  type ManagedExternalInvocationActionClaim,
  type ManagedExternalInvocationActionClaimContext,
  type ManagedExternalInvocationClaimSettlement,
} from "../../src/agents/managed-invocation/external-invocation-action-claim.js";
import { defineEffectiveAuthorityAdmissionBundle, type EffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import type { ManagedAgentRuntimeRecoveryCheckpoint } from "../../src/agents/managed-invocation/recovery-store.js";
import { externalHarnessDisposition } from "../session/runtime-terminal-fixture.js";

const AUTHORITY: AuthorityDescriptor = { level: 1, allowed: true, requiresApproval: false, reason: "read-only" };
const EFFECT: ActionEffectEnvelope = {
  operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "none",
  identityUse: "none", consequences: ["local-state"], idempotency: "idempotent",
};

function request(mode: "cli-harness" | "remote-harness" = "remote-harness"): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: `external-${mode}`,
    agentId: `external:${mode}`,
    parentSessionId: "parent-session",
    parentTurnId: "parent-session:turn:1",
    access: "read-only",
    requestedBy: "assistant",
    requestSource: "test",
    providerRoute: { providerId: mode === "cli-harness" ? "opencode" : "remote", surface: mode, model: "model" },
    adapterKind: "harness",
    executionMode: mode,
    authority: {
      authorityProfileId: "authority:read-only",
      toolAuthority: { allowedToolNames: ["read"], writeAllowed: false, networkAllowed: false },
      workingDirectory: { path: "C:/repo", mode: "read-only" },
      timeoutMs: 5_000,
      credentialRoute: { mode: "credentialless" },
      memoryScope: { scope: { kind: "project", id: "repo" }, access: "read-only" },
    },
    input: { summary: "Run one external child." },
  });
}

function admissionBundle(): EffectiveAuthorityAdmissionBundle {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "parent-session", turnId: "parent-session:turn:1", admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "s1", revisions: { routes: "r1" } },
      turnRevision: { revisionSetId: "t1", revisions: { routes: "r1" } },
    },
    session: {
      skillCatalog: { catalogId: "skills", revision: "s1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "audited", reason: "test" },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute", requestedAuthority: "audited", admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection", reason: "test", completeness: "authoritative",
        toolCount: 1, deniedToolCount: 0, sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" }, operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [{ toolName: "managed_agent.invoke", authority: AUTHORITY, effectEnvelope: EFFECT }], deniedToolNames: [] },
      effectCeiling: EFFECT, budget: { status: "not-configured" }, execution: { status: "not-routed" },
    },
  });
}

class RecordingStore {
  readonly claims: ManagedExternalInvocationActionClaim[] = [];
  readonly settlements: ManagedExternalInvocationClaimSettlement[] = [];
  readonly closeSpy = vi.fn();

  claim(input: ManagedExternalInvocationActionClaim) {
    if (this.claims.some((existing) => existing.claimId === input.claimId)) throw new Error("duplicate claim");
    this.claims.push(input);
    return createManagedExternalInvocationPermit(input.claimId, `permit:${this.claims.length}`);
  }

  settle(
    permit: ReturnType<typeof createManagedExternalInvocationPermit>,
    settlement: ManagedExternalInvocationClaimSettlement,
  ): void {
    void permit;
    this.settlements.push(settlement);
  }

  close(): void {
    this.closeSpy();
  }
}

class RecordingRecoveryStore {
  checkpoint: ManagedAgentRuntimeRecoveryCheckpoint | undefined;
  readonly delete = vi.fn(async () => undefined);

  async save(checkpoint: ManagedAgentRuntimeRecoveryCheckpoint): Promise<void> {
    this.checkpoint = checkpoint;
  }

  async listRecoverable(): Promise<readonly ManagedAgentRuntimeRecoveryCheckpoint[]> {
    return this.checkpoint === undefined ? [] : [this.checkpoint];
  }
}

class ResultPendingSaveFailingRecoveryStore extends RecordingRecoveryStore {
  override async save(checkpoint: ManagedAgentRuntimeRecoveryCheckpoint): Promise<void> {
    if (checkpoint.resultPending !== undefined) {
      throw new Error("result-pending checkpoint unavailable");
    }
    await super.save(checkpoint);
  }
}

function context(bundle: EffectiveAuthorityAdmissionBundle, store: RecordingStore): ManagedExternalInvocationActionClaimContext {
  return { ownerGeneration: "owner-generation", store, readAdmission: async () => bundle };
}

function snapshotInput() {
  return { capturedAt: "2026-08-22T18:00:00.000Z", routeId: "external-route", routeSource: "explicit-managed-route" as const };
}

function remoteRecord(
  childRequest: ManagedAgentInvocationRequest,
  capabilitySnapshot: Parameters<typeof defineManagedAgentInvocationRecord>[0]["capabilitySnapshot"],
): ManagedAgentInvocationRecord {
  return defineManagedAgentInvocationRecord({
    invocationId: childRequest.invocationId, agentId: childRequest.agentId,
    parentSessionId: childRequest.parentSessionId, parentTurnId: childRequest.parentTurnId,
    access: childRequest.access, lifecycleState: "completed", providerRoute: childRequest.providerRoute,
    adapterKind: childRequest.adapterKind, executionMode: childRequest.executionMode,
    authority: childRequest.authority, capabilitySnapshot, childSessionId: "remote-child",
    transcript: { uri: "kiln://managed/invocation/transcript", redacted: "unknown", truncated: false, persisted: true, retention: "external" },
    usage: { source: "adapter", tokenClasses: [{ name: "input", value: "unknown" }, { name: "output", value: "unknown" }], cost: { currency: "unknown", amount: "unknown" } },
    resultHandoff: {
      provenance: { delivery: "remote-harness", configuredModelId: childRequest.providerRoute.model ?? "model", observedModelIds: [] },
      summary: "remote complete", resourceUris: [], memoryWriteProposalUris: [],
    },
  });
}

function eventStream(events: readonly ExecutionSessionEvent[]): AsyncIterable<ExecutionSessionEvent> {
  return (async function* stream() { yield* events; })();
}

describe("external managed harness action claims", () => {
  it("closes the workload-owned claim store explicitly", () => {
    const store = new RecordingStore();
    const service = new RuntimeManagedAgentInvocationService({
      externalActionClaim: context(admissionBundle(), store),
    });

    service.close();

    expect(store.closeSpy).toHaveBeenCalledOnce();
  });

  it("fails closed before constructing a CLI session when the external claim context is absent", async () => {
    const bundle = admissionBundle();
    const factory = vi.fn(() => ({
      run: vi.fn(() => eventStream([])),
      dispose: vi.fn(async () => undefined),
    }));
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode", model: "model", factory,
    });
    const service = new RuntimeManagedAgentInvocationService();

    await expect(service.invoke(request("cli-harness"), adapter, snapshotInput(), {
      childAuthorityAdmission: { bundle },
    })).rejects.toThrow(/external action claim context/i);

    expect(factory).not.toHaveBeenCalled();
  });

  it("fails closed before invoking a remote transport when the child authority admission is absent", async () => {
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async () => { throw new Error("must not invoke"); }),
      cancel: vi.fn(),
    };
    const adapter = new ManagedRemoteHarnessAdapter({ providerId: "remote", model: "model", transport });
    const store = new RecordingStore();
    const service = new RuntimeManagedAgentInvocationService({
      externalActionClaim: context(admissionBundle(), store),
    });

    await expect(service.invoke(request("remote-harness"), adapter, snapshotInput()))
      .rejects.toThrow(/complete child authority admission/i);

    expect(transport.invoke).not.toHaveBeenCalled();
    expect(store.claims).toHaveLength(0);
  });

  it("claims a CLI session.run exactly once and settles success", async () => {
    const childRequest = request("cli-harness");
    const bundle = admissionBundle();
    const store = new RecordingStore();
    const run = vi.fn(() => eventStream([{
      type: "completed", totalUsd: 0, durationMs: 1, disposition: externalHarnessDisposition("opencode", "completed"), isPreflightCrash: false,
    }]));
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode", model: "model", factory: () => ({ run, dispose: vi.fn(async () => undefined) }),
    });
    const service = new RuntimeManagedAgentInvocationService({ externalActionClaim: context(bundle, store) });

    const result = await service.invoke(childRequest, adapter, snapshotInput(), { childAuthorityAdmission: { bundle } });

    expect(result.status).toBe("completed");
    expect(run).toHaveBeenCalledOnce();
    expect(store.claims.map((claim) => claim.effectKind)).toEqual(["cli-run"]);
    expect(store.settlements).toEqual([{ kind: "success" }]);
  });

  it("disposes a claimed CLI session when its run iterator rejects", async () => {
    const childRequest = request("cli-harness");
    const bundle = admissionBundle();
    const store = new RecordingStore();
    const dispose = vi.fn(async () => undefined);
    const run = vi.fn(() => (async function* () {
      throw new Error("CLI session iterator failed");
    })());
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "model",
      factory: () => ({ run, dispose }),
    });
    const service = new RuntimeManagedAgentInvocationService({ externalActionClaim: context(bundle, store) });

    await expect(service.invoke(childRequest, adapter, snapshotInput(), { childAuthorityAdmission: { bundle } }))
      .rejects.toThrow(/claimed; its provider outcome is not safely replayable/iu);

    expect(run).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(store.settlements).toEqual([{ kind: "unknown", reason: "cli-session-run-failed" }]);
  });

  it("does not attempt a contradictory CLI settlement after success settlement fails", async () => {
    const childRequest = request("cli-harness");
    const bundle = admissionBundle();
    const store = new RecordingStore();
    const settle = vi.spyOn(store, "settle").mockImplementation(() => {
      throw new Error("CLI success settlement outcome is unknown");
    });
    const run = vi.fn(() => eventStream([{
      type: "completed", totalUsd: 0, durationMs: 1, disposition: externalHarnessDisposition("opencode", "completed"), isPreflightCrash: false,
    }]));
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "model",
      factory: () => ({ run, dispose: vi.fn(async () => undefined) }),
    });
    const service = new RuntimeManagedAgentInvocationService({ externalActionClaim: context(bundle, store) });

    await expect(service.invoke(childRequest, adapter, snapshotInput(), { childAuthorityAdmission: { bundle } }))
      .rejects.toThrow(/claimed; its provider outcome is not safely replayable/iu);

    expect(run).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith(expect.anything(), { kind: "success" });
  });

  it("records unknown and does not retry when remote invoke fails after claim", async () => {
    const childRequest = request("remote-harness");
    const bundle = admissionBundle();
    const store = new RecordingStore();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async () => { throw new Error("remote transport failed"); }),
      cancel: vi.fn(),
    };
    const adapter = new ManagedRemoteHarnessAdapter({ providerId: "remote", model: "model", transport });
    const service = new RuntimeManagedAgentInvocationService({ externalActionClaim: context(bundle, store) });

    await expect(service.invoke(childRequest, adapter, snapshotInput(), { childAuthorityAdmission: { bundle } }))
      .rejects.toThrow(/claimed; its provider outcome is not safely replayable/iu);
    expect(service.status(childRequest.invocationId)?.record?.lifecycleState).toBe("failed");
    expect(transport.invoke).toHaveBeenCalledOnce();
    expect(store.settlements).toEqual([{ kind: "unknown", reason: "remote-invocation-failed-after-claim" }]);
  });

  it("does not attempt a contradictory remote settlement after success settlement fails", async () => {
    const childRequest = request("remote-harness");
    const bundle = admissionBundle();
    const store = new RecordingStore();
    const settle = vi.spyOn(store, "settle").mockImplementation(() => {
      throw new Error("remote success settlement outcome is unknown");
    });
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async (input) => remoteRecord(input.request, input.admission.capabilitySnapshot)),
      cancel: vi.fn(),
    };
    const adapter = new ManagedRemoteHarnessAdapter({ providerId: "remote", model: "model", transport });
    const service = new RuntimeManagedAgentInvocationService({ externalActionClaim: context(bundle, store) });

    await expect(service.invoke(childRequest, adapter, snapshotInput(), { childAuthorityAdmission: { bundle } }))
      .rejects.toThrow(/claimed; its provider outcome is not safely replayable/iu);

    expect(transport.invoke).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith(expect.anything(), { kind: "success" });
  });

  it("keeps an acknowledged post-start remote cancel pending until late terminal completion releases the lease", async () => {
    const childRequest = request("remote-harness");
    const bundle = admissionBundle();
    const store = new RecordingStore();
    let resolveInvoke!: (value: unknown) => void;
    const invokePromise = new Promise<unknown>((resolve) => { resolveInvoke = resolve; });
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async () => invokePromise),
      cancel: vi.fn(async () => undefined),
    };
    const adapter = new ManagedRemoteHarnessAdapter({ providerId: "remote", model: "model", transport });
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }: { readonly lease: NonNullable<ManagedAgentInvocationRecord["resourceLease"]> }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: [...lease.resourceUris, `kiln://artifacts/${childRequest.invocationId}/remote-result`],
      })),
      release: vi.fn(async ({ lease }: { readonly lease: NonNullable<ManagedAgentInvocationRecord["resourceLease"]> }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
      })),
    };
    const service = new RuntimeManagedAgentInvocationService({
      externalActionClaim: context(bundle, store),
      artifactDirectoryLeaseManager,
    });
    const started = await service.start(childRequest, adapter, snapshotInput(), { childAuthorityAdmission: { bundle } });
    expect(started.status).toBe("started");
    await vi.waitFor(() => expect(transport.invoke).toHaveBeenCalledOnce());
    await expect(service.cancel(childRequest.invocationId, "operator stopped")).resolves.toMatchObject({
      status: "result_pending",
      outcome: "unknown",
      cancellation: { requestOutcome: "acknowledged" },
    });
    expect(service.status(childRequest.invocationId)).toMatchObject({
      lifecycleState: "running",
      resultPending: { outcome: "unknown", cancellation: { requestOutcome: "acknowledged" } },
    });
    expect(artifactDirectoryLeaseManager.release).not.toHaveBeenCalled();
    resolveInvoke(remoteRecord(childRequest, (started.status === "started" ? started.decision.capabilitySnapshot : undefined)!));
    const joined = await service.join(childRequest.invocationId);
    await vi.waitFor(() => expect(store.settlements).toHaveLength(2));

    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") throw new Error("expected terminal result");
    expect(joined.record.lifecycleState).toBe("completed");
    expect(service.status(childRequest.invocationId)?.resultPending).toBeUndefined();
    expect(artifactDirectoryLeaseManager.release).toHaveBeenCalledOnce();
    expect(store.claims.map((claim) => claim.effectKind)).toEqual(["remote-invoke", "remote-cancel"]);
    expect(store.settlements).toEqual([
      { kind: "success" },
      { kind: "success" },
    ]);
  });

  it("single-flights concurrent post-start remote cancellation before admission readback", async () => {
    const childRequest = request("remote-harness");
    const bundle = admissionBundle();
    const claims = new RecordingStore();
    let releaseCancelAdmission!: () => void;
    const cancelAdmissionGate = new Promise<void>((resolve) => { releaseCancelAdmission = resolve; });
    let admissionReads = 0;
    const externalActionClaim: ManagedExternalInvocationActionClaimContext = {
      ownerGeneration: "owner-generation",
      store: claims,
      readAdmission: async () => {
        admissionReads += 1;
        if (admissionReads > 1) await cancelAdmissionGate;
        return bundle;
      },
    };
    let resolveInvoke!: (value: unknown) => void;
    const invokePromise = new Promise<unknown>((resolve) => { resolveInvoke = resolve; });
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async () => invokePromise),
      cancel: vi.fn(async () => undefined),
    };
    const adapter = new ManagedRemoteHarnessAdapter({ providerId: "remote", model: "model", transport });
    const service = new RuntimeManagedAgentInvocationService({ externalActionClaim });
    const started = await service.start(childRequest, adapter, snapshotInput(), {
      childAuthorityAdmission: { bundle },
    });
    if (started.status !== "started") throw new Error("Expected remote invocation to start.");
    await vi.waitFor(() => expect(transport.invoke).toHaveBeenCalledOnce());
    const cancellationInput = {
      request: childRequest,
      admission: started.decision,
      abortSignal: new AbortController().signal,
      childAuthorityAdmission: { bundle },
      externalActionClaim,
    } as const;

    const first = adapter.cancel({ ...cancellationInput, reason: "timeout cancellation" });
    const second = adapter.cancel({ ...cancellationInput, reason: "operator cancellation" });
    releaseCancelAdmission();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "requested" },
      { status: "requested" },
    ]);
    expect(transport.cancel).toHaveBeenCalledOnce();
    expect(claims.claims.map((claim) => claim.effectKind)).toEqual(["remote-invoke", "remote-cancel"]);
    resolveInvoke(remoteRecord(childRequest, started.decision.capabilitySnapshot));
    await service.join(childRequest.invocationId);
  });

  it("restores post-cancel result-pending evidence without redispatch or lease release", async () => {
    const childRequest = request("remote-harness");
    const bundle = admissionBundle();
    const claims = new RecordingStore();
    const recoveryStore = new RecordingRecoveryStore();
    let resolveInvoke!: (value: unknown) => void;
    const invokePromise = new Promise<unknown>((resolve) => { resolveInvoke = resolve; });
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async () => invokePromise),
      cancel: vi.fn(async () => undefined),
    };
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }: { readonly lease: NonNullable<ManagedAgentInvocationRecord["resourceLease"]> }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: [...lease.resourceUris, `kiln://artifacts/${childRequest.invocationId}/remote-result`],
      })),
      release: vi.fn(async ({ lease }: { readonly lease: NonNullable<ManagedAgentInvocationRecord["resourceLease"]> }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
      })),
    };
    const adapter = new ManagedRemoteHarnessAdapter({ providerId: "remote", model: "model", transport });
    const service = new RuntimeManagedAgentInvocationService({
      externalActionClaim: context(bundle, claims),
      artifactDirectoryLeaseManager,
      recoveryStore,
    });

    const started = await service.start(childRequest, adapter, snapshotInput(), { childAuthorityAdmission: { bundle } });
    if (started.status !== "started") throw new Error("expected remote invocation to start");
    await vi.waitFor(() => expect(transport.invoke).toHaveBeenCalledOnce());
    await service.cancel(childRequest.invocationId, "operator stopped");

    expect(recoveryStore.checkpoint).toMatchObject({
      lifecycleState: "running",
      adapterStarted: true,
      resultPending: { outcome: "unknown", cancellation: { requestOutcome: "acknowledged" } },
    });
    expect(artifactDirectoryLeaseManager.release).not.toHaveBeenCalled();

    const recoveredService = new RuntimeManagedAgentInvocationService({
      artifactDirectoryLeaseManager,
      recoveryStore,
    });
    const recovered = await recoveredService.recoverPersistedInvocations({
      now: new Date("2026-08-23T18:00:00.000Z"),
    });
    expect(recovered.recovered).toHaveLength(1);
    expect(recovered.recovered[0]).toMatchObject({
      lifecycleState: "running",
      resultPending: { outcome: "unknown", cancellation: { requestOutcome: "acknowledged" } },
    });
    await expect(recoveredService.recoverStaleInvocations({
      staleAfterMs: 1,
      now: new Date("2026-08-24T18:00:00.000Z"),
    })).resolves.toEqual({ recovered: [] });
    expect(transport.invoke).toHaveBeenCalledOnce();
    expect(artifactDirectoryLeaseManager.release).not.toHaveBeenCalled();

    resolveInvoke(remoteRecord(childRequest, started.decision.capabilitySnapshot));
    await service.join(childRequest.invocationId);
  });

  it("retains remote leases on restart when the result-pending checkpoint save fails after dispatch", async () => {
    const childRequest = request("remote-harness");
    const bundle = admissionBundle();
    const claims = new RecordingStore();
    const recoveryStore = new ResultPendingSaveFailingRecoveryStore();
    const invokePromise = new Promise<unknown>(() => undefined);
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async () => invokePromise),
      cancel: vi.fn(async () => undefined),
    };
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }: { readonly lease: NonNullable<ManagedAgentInvocationRecord["resourceLease"]> }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: [...lease.resourceUris, `kiln://artifacts/${childRequest.invocationId}/remote-result`],
      })),
      release: vi.fn(async ({ lease }: { readonly lease: NonNullable<ManagedAgentInvocationRecord["resourceLease"]> }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
      })),
    };
    const service = new RuntimeManagedAgentInvocationService({
      externalActionClaim: context(bundle, claims),
      artifactDirectoryLeaseManager,
      recoveryStore,
    });

    await service.start(childRequest, new ManagedRemoteHarnessAdapter({ providerId: "remote", model: "model", transport }), snapshotInput(), {
      childAuthorityAdmission: { bundle },
    });
    await vi.waitFor(() => expect(transport.invoke).toHaveBeenCalledOnce());
    await expect(service.cancel(childRequest.invocationId, "operator stopped"))
      .rejects.toThrow("result-pending checkpoint unavailable");

    expect(recoveryStore.checkpoint).toMatchObject({
      lifecycleState: "running",
      adapterStarted: true,
      externalActionClaim: { effectKind: "remote-invoke", invocationId: childRequest.invocationId },
    });
    expect(recoveryStore.checkpoint?.resultPending).toBeUndefined();

    const recoveredService = new RuntimeManagedAgentInvocationService({
      artifactDirectoryLeaseManager,
      recoveryStore,
    });
    const recovered = await recoveredService.recoverPersistedInvocations({
      now: new Date("2026-08-23T18:00:00.000Z"),
    });

    expect(recovered.recovered).toHaveLength(1);
    expect(recovered.recovered[0]).toMatchObject({
      lifecycleState: "running",
      resultPending: { outcome: "unknown", basis: "external-action-claim" },
    });
    expect(artifactDirectoryLeaseManager.release).not.toHaveBeenCalled();
    expect(transport.invoke).toHaveBeenCalledOnce();
  });

  it("does not acknowledge cancellation when cancel races remote invoke claim admission", async () => {
    const childRequest = request("remote-harness");
    const bundle = admissionBundle();
    const claims = new RecordingStore();
    let releaseAdmission!: () => void;
    const admissionGate = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    let signalAdmissionRead!: () => void;
    const admissionRead = new Promise<void>((resolve) => { signalAdmissionRead = resolve; });
    const externalActionClaim: ManagedExternalInvocationActionClaimContext = {
      ownerGeneration: "owner-generation",
      store: claims,
      readAdmission: async () => {
        signalAdmissionRead();
        await admissionGate;
        return bundle;
      },
    };
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async () => {
        throw new Error("remote invoke must not start after pre-dispatch cancellation");
      }),
      cancel: vi.fn(async () => undefined),
    };
    const service = new RuntimeManagedAgentInvocationService({ externalActionClaim });

    await service.start(childRequest, new ManagedRemoteHarnessAdapter({ providerId: "remote", model: "model", transport }), snapshotInput(), {
      childAuthorityAdmission: { bundle },
    });
    await admissionRead;
    const cancellation = service.cancel(childRequest.invocationId, "operator stopped before remote start");
    releaseAdmission();

    await expect(cancellation).resolves.toMatchObject({ status: "cancelled" });
    expect(transport.invoke).not.toHaveBeenCalled();
    expect(transport.cancel).not.toHaveBeenCalled();
    expect(claims.claims.map((claim) => claim.effectKind)).toEqual(["remote-invoke"]);
    expect(claims.settlements).toEqual([{ kind: "interrupted", reason: "remote-invocation-cancelled-before-transport-start" }]);
  });

  it("bounds owner shutdown for never-settling result-pending remote work", async () => {
    const childRequest = request("remote-harness");
    const bundle = admissionBundle();
    const claims = new RecordingStore();
    const recoveryStore = new RecordingRecoveryStore();
    const owner = {};
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async () => new Promise<unknown>(() => undefined)),
      cancel: vi.fn(async () => undefined),
    };
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }: { readonly lease: NonNullable<ManagedAgentInvocationRecord["resourceLease"]> }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
      })),
      release: vi.fn(async ({ lease }: { readonly lease: NonNullable<ManagedAgentInvocationRecord["resourceLease"]> }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
      })),
    };
    const service = new RuntimeManagedAgentInvocationService({
      externalActionClaim: context(bundle, claims),
      artifactDirectoryLeaseManager,
      recoveryStore,
    });
    await service.start(childRequest, new ManagedRemoteHarnessAdapter({ providerId: "remote", model: "model", transport }), snapshotInput(), {
      childAuthorityAdmission: { bundle },
      owner,
    });
    await vi.waitFor(() => expect(transport.invoke).toHaveBeenCalledOnce());

    vi.useFakeTimers();
    try {
      let disposed = false;
      const disposal = service.shutdownOwner(owner).then(() => { disposed = true; });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(disposed).toBe(true);
      await disposal;
    } finally {
      vi.useRealTimers();
    }

    expect(recoveryStore.checkpoint).toMatchObject({
      lifecycleState: "running",
      resultPending: { outcome: "unknown", cancellation: { requestOutcome: "acknowledged" } },
    });
    expect(artifactDirectoryLeaseManager.release).not.toHaveBeenCalled();
  });
});
