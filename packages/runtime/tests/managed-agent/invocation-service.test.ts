import { describe, expect, it, vi } from "vitest";
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
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "read-only",
      resourceUris: [],
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
      workingDirectoryPath: "C:/workspace/kiln/.kiln/leases/invocation-1",
      workingDirectoryMode: "read-only" as const,
      resourceUris: [
        "kiln://resources/context.md",
        "kiln://artifacts/invocation-1/lease",
      ],
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
