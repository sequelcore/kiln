import { describe, expect, it, vi } from "vitest";
import { defineManagedAgentInvocationRecord, defineManagedAgentInvocationRequest, type ManagedAgentInvocationRecord } from "@kilnai/core/agents";
import { MANAGED_AGENT_OWNER_TIMEOUT_SETTLEMENT_GRACE_MS, RuntimeManagedAgentInvocationService } from "../../src/agents/managed-invocation/index.js";
import type { ManagedAgentRuntimeAdapter, ManagedAgentRuntimeRecoveryCheckpoint } from "../../src/agents/managed-invocation/index.js";
import { requireCompletedInvocation, requireStartedInvocation, makeSnapshotInput, makeRequest, makeDescriptor, makeWriteDescriptor, makeIsolatedWorktreeRequest, makeSandboxRequest, makeRecord, makeReadonlyRecordForRequest, runtimeGeneratedProvenance, deferred, flushMicrotasks, makeRecoveryStore } from "./invocation-service-test-fixture.js";

describe("RuntimeManagedAgentInvocationService terminal lifecycle", () => {
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

  it("records a fenced commitment as pending on admission denial or authority observation failure", async () => {
    const request = makeRequest();
    const commitment = {
      commitmentId: "commitment-test",
      reservation: {
        jobId: "managed-economic-job:test",
        economicAttemptId: "economic-attempt:test",
        selectedIdentity: {
          route: {
            routeId: "opencode:managed-test-route",
            providerId: "opencode",
            modelId: "sonic",
            accountPolicyId: null,
          },
          account: { kind: "accountless" },
        },
      },
    } as never;
    const deniedPending = vi.fn();
    const denied = await new RuntimeManagedAgentInvocationService().start(
      request,
      {
        descriptor: makeDescriptor({ supportedProfiles: ["foundation-propose-writes"] }),
        invoke: vi.fn(),
      },
      makeSnapshotInput(),
      {
        economicDispatch: {
          commitment,
          dispatchFenceId: "managed-economic-dispatch:test",
          recordExecutionSettlementPending: deniedPending,
          createExecutionSettlement: vi.fn(() => ({} as never)),
          registerEconomicSettlement: vi.fn(),
        },
      },
    );
    expect(denied.status).toBe("denied");
    expect(deniedPending).toHaveBeenCalledOnce();
    expect(deniedPending).toHaveBeenCalledWith("runtime-admission-denied");

    const observationPending = vi.fn();
    const throwing = new RuntimeManagedAgentInvocationService({
      authorityObserver: { observe: vi.fn(async () => { throw new Error("synthetic observation failure"); }) },
    });
    const observationStarted = await throwing.start(request, {
      descriptor: makeDescriptor(),
      invoke: vi.fn(),
    }, makeSnapshotInput(), {
      economicDispatch: {
        commitment,
        dispatchFenceId: "managed-economic-dispatch:test",
        recordExecutionSettlementPending: observationPending,
        createExecutionSettlement: vi.fn(() => ({} as never)),
        registerEconomicSettlement: vi.fn(),
      },
    });
    expect(observationStarted.status).toBe("started");
    await expect(throwing.join(request.invocationId)).resolves.toMatchObject({
      status: "completed",
      record: { lifecycleState: "failed" },
    });
    expect(observationPending).toHaveBeenCalledOnce();
    expect(observationPending).toHaveBeenCalledWith("runtime-poststart-authority-failed");
  });

  it("records a fenced commitment as pending when the final recovery checkpoint fails", async () => {
    const request = makeIsolatedWorktreeRequest();
    const recoveryStore = makeRecoveryStore();
    let saveCount = 0;
    recoveryStore.save.mockImplementation(async (checkpoint) => {
      saveCount++;
      if (saveCount === 2) throw new Error("synthetic pre-fence checkpoint failure");
      recoveryStore.entries.set(
        checkpoint.request.invocationId,
        JSON.parse(JSON.stringify(checkpoint)) as ManagedAgentRuntimeRecoveryCheckpoint,
      );
    });
    const worktreeLeaseManager = {
      acquire: vi.fn(async ({ lease }) => ({
        ...lease,
        resourceUris: [...lease.resourceUris, "kiln://artifacts/write-1/worktree-lease"],
      })),
      release: vi.fn(async ({ lease }) => ({
        ...lease,
        healthStatus: "released" as const,
        cleanupStatus: "completed" as const,
      })),
    };
    const recordExecutionSettlementPending = vi.fn();
    const invoke = vi.fn();
    const service = new RuntimeManagedAgentInvocationService({ recoveryStore, worktreeLeaseManager });
    const started = await service.start(request, {
      descriptor: makeWriteDescriptor(),
      invoke,
    }, {
      capturedAt: "2026-08-02T00:00:00.000Z",
      routeId: "opencode:managed-test-route",
      routeSource: "explicit-managed-route",
    }, {
      economicDispatch: {
        commitment: {
          commitmentId: "commitment-write-test",
          reservation: {
            reservationId: "reservation:write-test",
            jobId: "managed-economic-job:write-test",
            economicAttemptId: "economic-attempt:write-test",
            policy: { policyId: "test-policy" },
            selectedIdentity: {
              route: {
                routeId: "opencode:managed-test-route",
                providerId: request.providerRoute.providerId,
                modelId: request.providerRoute.model,
                accountPolicyId: null,
              },
              account: { kind: "accountless" },
            },
            envelope: { kind: "bounded" },
            amounts: [],
            authorityRevision: "revision:write-test",
          },
        } as never,
        dispatchFenceId: "managed-economic-dispatch:write-test",
        recordExecutionSettlementPending,
        createExecutionSettlement: vi.fn(() => ({} as never)),
        registerEconomicSettlement: vi.fn(),
      },
    });

    expect(started.status).toBe("started");
    await expect(service.join(request.invocationId)).rejects.toThrow("synthetic pre-fence checkpoint failure");
    expect(recordExecutionSettlementPending).toHaveBeenCalledOnce();
    expect(recordExecutionSettlementPending).toHaveBeenCalledWith("runtime-recovery-checkpoint-failed");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("records and observes one terminal failure when post-adapter handoff validation fails", async () => {
    const request = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      input: {
        summary: "Inspect the contract",
        handoff: {
          roleIntent: "managed reviewer",
          requiredResultFields: ["verificationResults"],
        },
      },
    });
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ admission }) => makeReadonlyRecordForRequest(
        request,
        admission.capabilitySnapshot,
      )),
    };
    const terminalObserver = vi.fn();
    const service = new RuntimeManagedAgentInvocationService();

    const started = await service.start(request, adapter, makeSnapshotInput(), { terminalObserver });
    expect(started.status).toBe("started");
    await expect(service.join(request.invocationId)).rejects.toThrow(
      "missing required structured fields: verificationResults",
    );
    await flushMicrotasks();

    expect(service.status(request.invocationId)).toMatchObject({
      lifecycleState: "failed",
      record: {
        lifecycleState: "failed",
        resultHandoff: {
          summary: expect.stringContaining("missing required structured fields: verificationResults"),
        },
      },
    });
    expect(terminalObserver).toHaveBeenCalledTimes(1);
    expect(terminalObserver).toHaveBeenCalledWith(expect.objectContaining({
      record: expect.objectContaining({ lifecycleState: "failed" }),
    }));

    await expect(service.join(request.invocationId)).rejects.toThrow(
      "missing required structured fields: verificationResults",
    );
    expect(terminalObserver).toHaveBeenCalledTimes(1);
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
    if (cancelled.status !== "cancelled") throw new Error("expected child cancellation");
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
    expect(requireCompletedInvocation(joined).record.lifecycleState).toBe("cancelled");
    expect(service.status("invocation-1")?.record?.lifecycleState).toBe("cancelled");
    expect(service.status("invocation-1")?.error).toBeUndefined();
  });

  it("shuts down only invocations owned by one attached surface and awaits child execution settlement", async () => {
    const owner = {};
    const unrelatedOwner = {};
    const ownedSettlement = deferred<void>();
    let ownedSignal: AbortSignal | undefined;
    let unrelatedSignal: AbortSignal | undefined;
    const terminalObserver = vi.fn();
    const ownedRequest = makeRequest();
    const unrelatedRequest = defineManagedAgentInvocationRequest({
      ...makeRequest(),
      invocationId: "invocation-2",
      agentId: "agent-unrelated",
      parentSessionId: "session-unrelated",
    });
    const ownedAdapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ abortSignal, registerAdapterCompletion }) => {
        ownedSignal = abortSignal;
        registerAdapterCompletion(ownedSettlement.promise);
        await ownedSettlement.promise;
        throw new Error("owned provider execution settled after cancellation");
      }),
    };
    const unrelatedTerminal = deferred<ManagedAgentInvocationRecord>();
    const unrelatedAdapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ request, admission, abortSignal }) => {
        unrelatedSignal = abortSignal;
        await unrelatedTerminal.promise;
        return makeReadonlyRecordForRequest(request, admission.capabilitySnapshot);
      }),
    };
    const service = new RuntimeManagedAgentInvocationService();

    await service.start(ownedRequest, ownedAdapter, makeSnapshotInput(), {
      owner,
      terminalObserver,
    });
    await service.start(unrelatedRequest, unrelatedAdapter, makeSnapshotInput({
      routeId: "opencode:unrelated-route",
    }), { owner: unrelatedOwner });

    let shutdownSettled = false;
    const shutdown = service.shutdownOwner(owner, "Parent provider session disposed.")
      .then((snapshots) => {
        shutdownSettled = true;
        return snapshots;
      });
    await flushMicrotasks();

    expect(ownedSignal?.aborted).toBe(true);
    expect(unrelatedSignal?.aborted).toBe(false);
    expect(shutdownSettled).toBe(false);
    expect(service.status(ownedRequest.invocationId)?.lifecycleState).toBe("cancelled");
    expect(service.status(unrelatedRequest.invocationId)?.lifecycleState).toBe("running");

    ownedSettlement.resolve();
    const stopped = await shutdown;

    expect(stopped.map((snapshot) => snapshot.invocationId)).toEqual([ownedRequest.invocationId]);
    expect(stopped[0]?.record?.resultHandoff?.summary).toBe("Parent provider session disposed.");
    expect(terminalObserver).toHaveBeenCalledTimes(1);

    await service.shutdownOwner(owner, "Repeated disposal must be idempotent.");
    expect(terminalObserver).toHaveBeenCalledTimes(1);
    expect(unrelatedSignal?.aborted).toBe(false);

    unrelatedTerminal.resolve(makeReadonlyRecordForRequest(unrelatedRequest));
    await service.join(unrelatedRequest.invocationId);
  });

  it("bounds owner shutdown after a timed-out provider leaves raw execution settlement unresolved", async () => {
    vi.useFakeTimers();
    try {
      const owner = {};
      const rawSettlement = deferred<void>();
      const observerSettlement = deferred<void>();
      const request = makeRequest();
      const service = new RuntimeManagedAgentInvocationService();
      const started = await service.start(request, {
        descriptor: makeDescriptor(),
        invoke: async ({ admission, registerAdapterCompletion }) => {
          registerAdapterCompletion(rawSettlement.promise);
          return defineManagedAgentInvocationRecord({
            ...makeRecord(admission.capabilitySnapshot),
            lifecycleState: "timed_out",
          });
        },
      }, makeSnapshotInput(), {
        owner,
        terminalObserver: async () => await observerSettlement.promise,
      });
      expect(started.status).toBe("started");
      await service.join(request.invocationId);

      let shutdownSettled = false;
      const shutdown = service.shutdownOwner(owner).then((result) => {
        shutdownSettled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(MANAGED_AGENT_OWNER_TIMEOUT_SETTLEMENT_GRACE_MS);

      expect(shutdownSettled).toBe(false);
      observerSettlement.resolve();
      await expect(shutdown).resolves.toMatchObject([{
        invocationId: request.invocationId,
        lifecycleState: "timed_out",
      }]);
      expect(service.status(request.invocationId)?.lifecycleState).toBe("timed_out");

      rawSettlement.resolve();
    } finally {
      vi.useRealTimers();
    }
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
    expect(requireStartedInvocation(started).snapshot.lifecycleState).toBe("cancelled");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(joined.status).toBe("completed");
    expect(requireCompletedInvocation(joined).record.lifecycleState).toBe("cancelled");
    expect(requireCompletedInvocation(joined).record.resultHandoff?.summary).toBe("Parent runtime turn interrupted before child start.");
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
    expect(requireStartedInvocation(started).snapshot.lifecycleState).toBe("cancelled");
    expect(adapter.invoke).not.toHaveBeenCalled();
    expect(sandboxLeaseManager.release).toHaveBeenCalledTimes(1);
    expect(requireCompletedInvocation(joined).record.lifecycleState).toBe("cancelled");
    expect(requireCompletedInvocation(joined).record.resultHandoff?.summary)
      .toBe("Parent runtime turn interrupted during lease acquisition.");
    expect(requireCompletedInvocation(joined).record.resourceLease?.cleanupStatus).toBe("completed");
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
    expect(requireCompletedInvocation(joined).record.lifecycleState).toBe("cancelled");
    expect(requireCompletedInvocation(joined).record.resultHandoff?.summary).toBe("Parent runtime turn interrupted.");

    terminal.resolve(makeRecord());
    await flushMicrotasks();
    const joinedAfterLateSuccess = await service.join("invocation-1");
    expect(requireCompletedInvocation(joinedAfterLateSuccess).record.lifecycleState).toBe("cancelled");
    expect(requireCompletedInvocation(joinedAfterLateSuccess).record.resultHandoff?.summary).toBe("Parent runtime turn interrupted.");
    expect(service.status("invocation-1")?.error).toBeUndefined();
  });

  it("resolves cancellation joins without waiting for late adapter output", async () => {
    let adapterSignal: AbortSignal | undefined;
    const adapter: ManagedAgentRuntimeAdapter = {
      descriptor: makeDescriptor(),
      invoke: vi.fn(async ({ abortSignal }) => {
        adapterSignal = abortSignal;
        return await new Promise<ManagedAgentInvocationRecord>(() => undefined);
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
      joinPromise.then((result) => requireCompletedInvocation(result).record.lifecycleState),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 0)),
    ]);

    expect(adapterSignal?.aborted).toBe(true);
    if (cancelled.status !== "cancelled") throw new Error("expected child cancellation");
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
        provenance: runtimeGeneratedProvenance(makeRequest().providerRoute.model),
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
    expect(requireCompletedInvocation(joined).record).toMatchObject({
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

});
