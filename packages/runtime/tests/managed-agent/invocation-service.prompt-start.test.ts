import { describe, expect, it, vi } from "vitest";
import { type ManagedAgentInvocationRecord } from "@kilnai/core/agents";
import { RuntimeManagedAgentInvocationService } from "../../src/agents/managed-invocation/index.js";
import type { ManagedAgentRuntimeAdapter, ManagedAgentRuntimePromptAdmissionRecord } from "../../src/agents/managed-invocation/index.js";
import { makeSnapshotInput, makeRequest, makeDescriptor, makeRecord, deferred } from "./invocation-service-test-fixture.js";

describe("RuntimeManagedAgentInvocationService prompt and start", () => {
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
        }).claimed.map((prompt: ManagedAgentRuntimePromptAdmissionRecord) => prompt.promptAdmissionId);
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

});
