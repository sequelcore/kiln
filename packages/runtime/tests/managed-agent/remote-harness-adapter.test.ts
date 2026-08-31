import { describe, expect, it, vi } from "vitest";
import type { ActionEffectEnvelope, AuthorityDescriptor } from "@kilnai/core/engine";
import {
  defineManagedAgentCapabilitySnapshot,
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
  evaluateManagedAgentAdmission,
  type ManagedAgentCapabilitySnapshot,
  type ManagedAgentCapabilitySnapshotInput,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core/agents";
import {
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import {
  ManagedRemoteHarnessAdapter,
} from "../../src/agents/managed-invocation/remote-harness-adapter.js";
import type {
  ManagedRemoteHarnessTransport,
} from "../../src/agents/managed-invocation/remote-harness-adapter.js";
import {
  createManagedExternalInvocationPermit,
  type ManagedExternalInvocationActionClaim,
  type ManagedExternalInvocationActionClaimContext,
  type ManagedExternalInvocationClaimSettlement,
} from "../../src/agents/managed-invocation/external-invocation-action-claim.js";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";

const READ_AUTHORITY: AuthorityDescriptor = {
  level: 1,
  allowed: true,
  requiresApproval: false,
  reason: "remote test",
};
const READ_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
};

function externalAdmissionBundle(): EffectiveAuthorityAdmissionBundle {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "parent-session",
    turnId: "parent-session:turn:1",
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "session-r1", revisions: { routes: "r1" } },
      turnRevision: { revisionSetId: "turn-r1", revisions: { routes: "r1" } },
    },
    session: {
      skillCatalog: { catalogId: "remote-test", revision: "s1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "audited", reason: "remote test" },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute",
        requestedAuthority: "audited",
        admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection",
        reason: "remote test",
        completeness: "authoritative",
        toolCount: 1,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [{ toolName: "managed_agent.invoke", authority: READ_AUTHORITY, effectEnvelope: READ_EFFECT }],
        deniedToolNames: [],
      },
      effectCeiling: READ_EFFECT,
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
}

class RemoteClaimRecorder {
  readonly claims: ManagedExternalInvocationActionClaim[] = [];
  readonly settlements: ManagedExternalInvocationClaimSettlement[] = [];

  claim(input: ManagedExternalInvocationActionClaim) {
    this.claims.push(input);
    return createManagedExternalInvocationPermit(input.claimId, `remote-test-permit:${this.claims.length}`);
  }

  settle(
    permit: ReturnType<typeof createManagedExternalInvocationPermit>,
    settlement: ManagedExternalInvocationClaimSettlement,
  ): void {
    void permit;
    this.settlements.push(settlement);
  }

  close(): void {}
}

function externalContext(
  admitted: EffectiveAuthorityAdmissionBundle,
  recorder: RemoteClaimRecorder,
): ManagedExternalInvocationActionClaimContext {
  return {
    ownerGeneration: "remote-test-owner",
    store: recorder,
    readAdmission: async () => admitted,
  };
}

function request(
  overrides: Partial<Parameters<typeof defineManagedAgentInvocationRequest>[0]> = {},
): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "inv-remote-1",
    agentId: "codex-cloud:read-only",
    parentSessionId: "parent-session",
    parentTurnId: "parent-session:turn:1",
    access: "read-only",
    requestedBy: "assistant",
    requestSource: "test",
    providerRoute: {
      providerId: "codex-cloud",
      surface: "remote-harness",
      model: "gpt-5.5",
    },
    adapterKind: "harness",
    executionMode: "remote-harness",
    authority: {
      authorityProfileId: "authority:codex-cloud-remote:read-only",
      toolAuthority: {
        allowedToolNames: ["read", "grep"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/repo",
        mode: "read-only",
      },
      timeoutMs: 5000,
      credentialRoute: {
        mode: "credentialless",
      },
      memoryScope: {
        scope: { kind: "project", id: "repo" },
        access: "read-only",
      },
    },
    input: {
      summary: "Inspect remote-managed docs.",
      prompt: "Read the admitted docs and summarize risks.",
    },
    ...overrides,
  });
}

function admitted(
  childRequest: ManagedAgentInvocationRequest,
  adapter: ManagedRemoteHarnessAdapter,
) {
  const decision = evaluateManagedAgentAdmission(childRequest, adapter.descriptor, snapshotInput());
  if (decision.status !== "admitted") {
    throw new Error(decision.reason);
  }
  return decision;
}

function snapshotInput(): ManagedAgentCapabilitySnapshotInput {
  return {
    capturedAt: "2026-05-07T08:00:00.000Z",
    routeId: "codex-cloud-remote-readonly",
    routeSource: "explicit-managed-route",
  };
}

function completedRecord(
  childRequest: ManagedAgentInvocationRequest,
  capabilitySnapshot: ManagedAgentCapabilitySnapshot,
) {
  return defineManagedAgentInvocationRecord({
    invocationId: childRequest.invocationId,
    agentId: childRequest.agentId,
    parentSessionId: childRequest.parentSessionId,
    parentTurnId: childRequest.parentTurnId,
    access: childRequest.access,
    lifecycleState: "completed",
    providerRoute: childRequest.providerRoute,
    adapterKind: childRequest.adapterKind,
    executionMode: childRequest.executionMode,
    authority: childRequest.authority,
    capabilitySnapshot,
    childSessionId: "remote-child-session",
    transcript: {
      uri: "kiln://managed-invocations/inv-remote-1/transcript",
      redacted: "unknown",
      truncated: false,
      persisted: true,
      retention: "external",
    },
    usage: {
      source: "adapter",
      tokenClasses: [
        { name: "input", value: "unknown" },
        { name: "output", value: "unknown" },
      ],
      cost: {
        currency: "unknown",
        amount: "unknown",
      },
    },
    resultHandoff: {
      provenance: {
        delivery: "remote-harness",
        configuredModelId: childRequest.providerRoute.model ?? "provider-default",
        observedModelIds: [],
      },
      summary: "Remote child completed.",
      resourceUris: ["kiln://managed-invocations/inv-remote-1/transcript"],
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

describe("ManagedRemoteHarnessAdapter", () => {
  it("requires HTTPS endpoints for default remote transport", () => {
    expect(() => new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      invokeUrl: "http://remote.example.test/managed-agent/invoke",
      cancelUrl: "https://remote.example.test/managed-agent/cancel",
    })).toThrow("Managed remote harness invokeUrl is required");
  });

  it("invokes remote harness transport through the shared managed invocation contract", async () => {
    const childRequest = request();
    const admittedBundle = externalAdmissionBundle();
    const recorder = new RemoteClaimRecorder();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async ({ request: sentRequest, admission }) =>
        completedRecord(sentRequest, admission.capabilitySnapshot)
      ),
      cancel: vi.fn(),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
      limitations: [
        "Remote harness reports aggregate token classes only.",
      ],
    });
    const decision = admitted(childRequest, adapter);
    const registerAdapterCompletion = vi.fn();

    const record = await adapter.invoke({
      request: childRequest,
      admission: decision,
      abortSignal: new AbortController().signal,
      promptDelivery: { claim: () => ({ claimed: [] }) },
      externalActionClaim: externalContext(admittedBundle, recorder),
      childAuthorityAdmission: { bundle: admittedBundle },
      registerAdapterCompletion,
    });

    expect(adapter.descriptor).toMatchObject({
      adapterKind: "harness",
      providerId: "codex-cloud",
      supportedExecutionModes: ["remote-harness"],
      limitations: ["Remote harness reports aggregate token classes only."],
    });
    expect(transport.invoke).toHaveBeenCalledWith(expect.objectContaining({
      request: childRequest,
      admission: decision,
    }));
    expect(registerAdapterCompletion).toHaveBeenCalledOnce();
    expect(JSON.stringify((transport.invoke as ReturnType<typeof vi.fn>).mock.calls[0])).not.toContain("KILN_REMOTE_HARNESS_TOKEN");
    expect(record).toMatchObject({
      invocationId: "inv-remote-1",
      lifecycleState: "completed",
      adapterKind: "harness",
      executionMode: "remote-harness",
      providerRoute: {
        providerId: "codex-cloud",
        surface: "remote-harness",
        model: "gpt-5.5",
      },
      resultHandoff: {
        summary: "Remote child completed.",
      },
    });
  });

  it("does not send a remote cancellation when the parent aborts before transport start", async () => {
    const childRequest = request();
    const admittedBundle = externalAdmissionBundle();
    const recorder = new RemoteClaimRecorder();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async ({ request: sentRequest, admission }) =>
        completedRecord(sentRequest, admission.capabilitySnapshot)
      ),
      cancel: vi.fn(async () => undefined),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
    });
    const decision = admitted(childRequest, adapter);
    const controller = new AbortController();
    controller.abort("Operator stopped remote child.");

    const record = await adapter.invoke({
      request: childRequest,
      admission: decision,
      abortSignal: controller.signal,
      promptDelivery: { claim: () => ({ claimed: [] }) },
      externalActionClaim: externalContext(admittedBundle, recorder),
      childAuthorityAdmission: { bundle: admittedBundle },
      registerAdapterCompletion: () => undefined,
    });

    expect(transport.invoke).not.toHaveBeenCalled();
    expect(transport.cancel).not.toHaveBeenCalled();
    expect(record.lifecycleState).toBe("cancelled");
    expect(record.resultHandoff?.summary).toBe("Operator stopped remote child.");
  });

  it("still returns cancelled evidence when pre-start abort has no remote effect to notify", async () => {
    const childRequest = request();
    const admittedBundle = externalAdmissionBundle();
    const recorder = new RemoteClaimRecorder();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async ({ request: sentRequest, admission }) =>
        completedRecord(sentRequest, admission.capabilitySnapshot)
      ),
      cancel: vi.fn(async () => {
        throw new Error("remote cancel endpoint unavailable");
      }),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
    });
    const decision = admitted(childRequest, adapter);
    const controller = new AbortController();
    controller.abort("Operator stopped remote child.");

    const record = await adapter.invoke({
      request: childRequest,
      admission: decision,
      abortSignal: controller.signal,
      promptDelivery: { claim: () => ({ claimed: [] }) },
      externalActionClaim: externalContext(admittedBundle, recorder),
      childAuthorityAdmission: { bundle: admittedBundle },
      registerAdapterCompletion: () => undefined,
    });

    expect(transport.invoke).not.toHaveBeenCalled();
    expect(transport.cancel).not.toHaveBeenCalled();
    expect(record.lifecycleState).toBe("cancelled");
    expect(record.resultHandoff?.summary).toBe("Operator stopped remote child.");
  });

  it("keeps runtime admission fail-closed when a remote harness broadens admitted evidence", async () => {
    const childRequest = request();
    const admittedBundle = externalAdmissionBundle();
    const recorder = new RemoteClaimRecorder();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async ({ request: sentRequest, admission }) =>
        completedRecord(sentRequest, defineManagedAgentCapabilitySnapshot({
          ...admission.capabilitySnapshot,
          snapshotId: "broadened-remote-snapshot",
        }))
      ),
      cancel: vi.fn(),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
    });
    const decision = admitted(childRequest, adapter);

    await expect(new RuntimeManagedAgentInvocationService({
      externalActionClaim: externalContext(admittedBundle, recorder),
    }).invokeAdmitted({
      request: childRequest,
      adapter,
      admission: decision,
      childAuthorityAdmission: { bundle: admittedBundle },
    })).rejects.toThrow("Managed agent adapter returned capability snapshot outside the admitted request");
  });

  it("keeps runtime admission fail-closed when a remote harness spoofs top-level route identity", async () => {
    const childRequest = request();
    const admittedBundle = externalAdmissionBundle();
    const recorder = new RemoteClaimRecorder();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async ({ request: sentRequest, admission }) => ({
        ...completedRecord(sentRequest, admission.capabilitySnapshot),
        providerRoute: {
          providerId: "spoofed-provider",
          surface: "remote-harness",
          model: "gpt-5.5",
        },
      })),
      cancel: vi.fn(),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
    });
    const decision = admitted(childRequest, adapter);

    await expect(new RuntimeManagedAgentInvocationService({
      externalActionClaim: externalContext(admittedBundle, recorder),
    }).invokeAdmitted({
      request: childRequest,
      adapter,
      admission: decision,
      childAuthorityAdmission: { bundle: admittedBundle },
    })).rejects.toThrow(/claimed; its provider outcome is not safely replayable/iu);
  });

  it("keeps a failed remote cancellation request pending until late completion releases the lease", async () => {
    const childRequest = request();
    const admittedBundle = externalAdmissionBundle();
    const recorder = new RemoteClaimRecorder();
    const terminal = deferred<unknown>();
    const transport: ManagedRemoteHarnessTransport = {
      invoke: vi.fn(async () => terminal.promise),
      cancel: vi.fn(async () => {
        throw new Error("remote cancel endpoint unavailable");
      }),
    };
    const adapter = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      transport,
    });
    const artifactDirectoryLeaseManager = {
      acquire: vi.fn(async ({ lease }: { readonly lease: ManagedAgentCapabilitySnapshot["resourceLease"] }) => ({
        ...lease,
        cleanupStatus: "pending" as const,
        resourceUris: [...lease.resourceUris, `kiln://artifacts/${childRequest.invocationId}/remote-result`],
      })),
      release: vi.fn(async ({ lease }: { readonly lease: ManagedAgentCapabilitySnapshot["resourceLease"] }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
      })),
    };
    const service = new RuntimeManagedAgentInvocationService({
      externalActionClaim: externalContext(admittedBundle, recorder),
      artifactDirectoryLeaseManager,
    });

    const started = await service.start(childRequest, adapter, snapshotInput(), {
      childAuthorityAdmission: { bundle: admittedBundle },
    });
    expect(started.status).toBe("started");
    await vi.waitFor(() => expect(transport.invoke).toHaveBeenCalledTimes(1));

    await expect(service.cancel(childRequest.invocationId, "Operator stopped remote child."))
      .resolves.toMatchObject({
        status: "result_pending",
        outcome: "unknown",
        cancellation: {
          requestOutcome: "unknown",
          failureMessage: expect.stringMatching(/claimed; its provider outcome is not safely replayable/iu),
        },
      });

    const snapshot = service.status(childRequest.invocationId);
    expect(snapshot?.lifecycleState).toBe("running");
    expect(snapshot?.record).toBeUndefined();
    expect(snapshot?.resultPending).toMatchObject({
      outcome: "unknown",
      cancellation: { requestOutcome: "unknown" },
    });
    expect(artifactDirectoryLeaseManager.release).not.toHaveBeenCalled();

    if (started.status !== "started") throw new Error("expected remote invocation to start");
    terminal.resolve(completedRecord(childRequest, started.decision.capabilitySnapshot));
    const joined = await service.join(childRequest.invocationId);
    expect(joined.status).toBe("completed");
    if (joined.status !== "completed") throw new Error("expected a completed late remote result");
    expect(joined.record.lifecycleState).toBe("completed");
    expect(service.status(childRequest.invocationId)?.resultPending).toBeUndefined();
    expect(artifactDirectoryLeaseManager.release).toHaveBeenCalledOnce();
    expect(recorder.settlements).toEqual([
      { kind: "unknown", reason: "remote-cancel-failed-after-claim" },
      { kind: "success" },
    ]);
  });
});
