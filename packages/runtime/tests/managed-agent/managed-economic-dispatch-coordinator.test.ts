import { describe, expect, it, vi } from "vitest";
import type { ManagedEconomicCommitment } from "@kilnai/core";
import {
  ManagedEconomicDispatchCoordinator,
  type ManagedEconomicDispatchAuthorityPort,
} from "../../src/agents/managed-invocation/economic-dispatch-coordinator.js";

function commitment(): ManagedEconomicCommitment {
  return {
    commitmentId: "commitment-a",
    reservation: {
      reservationId: "reservation-a",
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      policy: {} as never,
      selectedIdentity: {
        route: {
          routeId: "route-a",
          providerId: "codex-oauth",
          modelId: "gpt-test",
          adapterCapabilityId: "direct-runtime",
          adapterCapabilityVersion: "1",
        } as never,
        account: {
          kind: "account-bound",
          capacityIdentity: "account-b",
          accountRef: "configured:account-b" as never,
          credentialRevision: "b".repeat(64),
          creditPosture: "disabled",
          overagePosture: "disabled",
        },
      },
      priceIdentity: null,
      envelope: { kind: "bounded", digest: `sha256:${"a".repeat(64)}`, limits: [] },
      amounts: [],
      authorityRevision: `sha256:${"c".repeat(64)}`,
    },
    rejected: [],
    notSelected: [],
  };
}

function authority(state: "held" | "dispatch-fenced" = "held") {
  const selected = commitment();
  const port: ManagedEconomicDispatchAuthorityPort = {
    acquire: vi.fn(() => ({
      status: "committed" as const,
      replay: state !== "held",
      record: { commitment: selected, state } as never,
    })),
    releasePreFence: vi.fn(),
    fenceDispatch: vi.fn(),
    settleSuccessfulExecution: vi.fn(),
    recordExecutionSettlementPending: vi.fn(),
  };
  return port;
}

describe("ManagedEconomicDispatchCoordinator", () => {
  it("constructs the exact adapter only after commitment and fences immediately before effect", async () => {
    const events: string[] = [];
    const economicAuthority = authority();
    vi.mocked(economicAuthority.acquire).mockImplementation((input) => {
      events.push(`commit:${input.economicAttemptId}`);
      return {
        status: "committed",
        replay: false,
        record: { commitment: commitment(), state: "held" } as never,
      };
    });
    vi.mocked(economicAuthority.fenceDispatch).mockImplementation(() => {
      events.push("fence");
      return undefined as never;
    });
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async ({ commitment: selected }) => {
        events.push(`adapter:${selected.reservation.selectedIdentity.account.kind}`);
        return { descriptor: {} } as never;
      },
    });

    const prepared = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      adoption: {} as never,
      admissionProfile: "foundation-readonly-plan",
    });
    if (prepared.status !== "prepared") throw new Error("fixture");
    expect(events).toEqual(["commit:economic-attempt-a", "adapter:account-bound"]);

    await prepared.beforeProviderEffect();
    events.push("provider-effect");
    expect(events).toEqual([
      "commit:economic-attempt-a",
      "adapter:account-bound",
      "fence",
      "provider-effect",
    ]);

    prepared.registerExecutionSettlement(Promise.resolve());
    await vi.waitFor(() => expect(economicAuthority.settleSuccessfulExecution).toHaveBeenCalledOnce());
  });

  it("does not redispatch a replay whose durable commitment is already fenced", async () => {
    const createAdapter = vi.fn();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: authority("dispatch-fenced"),
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter,
    });

    await expect(coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      adoption: {} as never,
      admissionProfile: "foundation-readonly-plan",
    })).resolves.toMatchObject({ status: "already-dispatched" });
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("releases a definitely pre-fence commitment when exact adapter construction fails", async () => {
    const economicAuthority = authority();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => { throw new Error("synthetic adapter failure"); },
    });

    await expect(coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      adoption: {} as never,
      admissionProfile: "foundation-readonly-plan",
    })).rejects.toThrow("synthetic adapter failure");
    expect(economicAuthority.releasePreFence).toHaveBeenCalledWith("job-a", "economic-attempt-a");
  });

  it("releases a commitment when its configured lifecycle timeout is invalid", async () => {
    const economicAuthority = authority();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 0,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });

    await expect(coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      adoption: {} as never,
      admissionProfile: "foundation-readonly-plan",
    })).rejects.toThrow("timeout must be a positive finite number");
    expect(economicAuthority.releasePreFence).toHaveBeenCalledOnce();
  });

  it("aborts bounded adapter materialization and releases the pre-fence commitment", async () => {
    const economicAuthority = authority();
    const controller = new AbortController();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => await new Promise(() => undefined),
    });

    const preparation = coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      adoption: {} as never,
      admissionProfile: "foundation-readonly-plan",
      abortSignal: controller.signal,
    });
    controller.abort(new Error("synthetic lifecycle deadline"));

    await expect(preparation).rejects.toThrow("synthetic lifecycle deadline");
    expect(economicAuthority.releasePreFence).toHaveBeenCalledTimes(1);
  });

  it("expires an unused prepared commitment at the route lifecycle deadline", async () => {
    const economicAuthority = authority();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 5,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });

    const preparation = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      adoption: {} as never,
      admissionProfile: "foundation-readonly-plan",
    });
    if (preparation.status !== "prepared") throw new Error("fixture");

    await vi.waitFor(() => expect(economicAuthority.releasePreFence).toHaveBeenCalledOnce());
    await expect(preparation.beforeProviderEffect()).rejects.toThrow(
      "Managed economic lifecycle timed out after 5ms.",
    );
    expect(economicAuthority.fenceDispatch).not.toHaveBeenCalled();
  });

  it("keeps capacity when a registered provider settlement remains unknown", async () => {
    const economicAuthority = authority();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });
    const prepared = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      adoption: {} as never,
      admissionProfile: "foundation-readonly-plan",
    });
    if (prepared.status !== "prepared") throw new Error("fixture");
    await prepared.beforeProviderEffect();
    prepared.registerExecutionSettlement(Promise.reject(new Error("provider outcome unknown")));

    await vi.waitFor(() => expect(economicAuthority.recordExecutionSettlementPending).toHaveBeenCalledOnce());
    expect(economicAuthority.settleSuccessfulExecution).not.toHaveBeenCalled();
  });

  it("compensates a prepared pre-effect dispatch exactly once and never releases after fencing", async () => {
    const economicAuthority = authority();
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });
    const preEffect = await coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      adoption: {} as never,
      admissionProfile: "foundation-readonly-plan",
    });
    if (preEffect.status !== "prepared") throw new Error("fixture");
    preEffect.releaseBeforeProviderEffect();
    preEffect.releaseBeforeProviderEffect();
    expect(economicAuthority.releasePreFence).toHaveBeenCalledTimes(1);

    const postFenceAuthority = authority();
    const postFence = await new ManagedEconomicDispatchCoordinator({
      authority: postFenceAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => ({ descriptor: {} }) as never,
    }).prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      adoption: {} as never,
      admissionProfile: "foundation-readonly-plan",
    });
    if (postFence.status !== "prepared") throw new Error("fixture");
    await postFence.beforeProviderEffect();
    postFence.releaseBeforeProviderEffect();
    expect(postFenceAuthority.releasePreFence).not.toHaveBeenCalled();
  });
});
