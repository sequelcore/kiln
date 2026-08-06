import { describe, expect, it, vi } from "vitest";
import type { ManagedEconomicCommitment, ManagedEconomicSettlement } from "@kilnai/core";
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
    settleExecution: vi.fn(),
    recordExecutionSettlementPending: vi.fn(),
  };
  return port;
}

describe("ManagedEconomicDispatchCoordinator", () => {
  it("fences before constructing the exact committed adapter", async () => {
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
    expect(events).toEqual(["commit:economic-attempt-a", "fence", "adapter:account-bound"]);
    events.push("provider-effect");
    expect(events).toEqual([
      "commit:economic-attempt-a",
      "fence",
      "adapter:account-bound",
      "provider-effect",
    ]);

    const economicSettlement = settlement(prepared.dispatchFenceId);
    prepared.registerEconomicSettlement(Promise.resolve(economicSettlement));
    await vi.waitFor(() => expect(economicAuthority.settleExecution).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      prepared.dispatchFenceId,
      economicSettlement,
    ));
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

  it("keeps capacity pending when adapter construction fails after the dispatch fence", async () => {
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
    expect(economicAuthority.fenceDispatch).toHaveBeenCalledOnce();
    expect(economicAuthority.recordExecutionSettlementPending).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      expect.any(String),
      "post-fence-adapter-materialization-failed",
    );
    expect(economicAuthority.releasePreFence).not.toHaveBeenCalled();
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

  it("releases the held commitment when the lifecycle is already aborted before dispatch fencing", async () => {
    const economicAuthority = authority();
    const controller = new AbortController();
    controller.abort(new Error("synthetic pre-fence abort"));
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });

    await expect(coordinator.prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      adoption: {} as never,
      admissionProfile: "foundation-readonly-plan",
      abortSignal: controller.signal,
    })).rejects.toThrow("synthetic pre-fence abort");

    expect(economicAuthority.fenceDispatch).not.toHaveBeenCalled();
    expect(economicAuthority.releasePreFence).toHaveBeenCalledWith("job-a", "economic-attempt-a");
  });

  it("aborts bounded adapter materialization and keeps the fenced commitment pending", async () => {
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
    expect(economicAuthority.recordExecutionSettlementPending).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      expect.any(String),
      "registered-execution-settlement-missing",
    );
    expect(economicAuthority.releasePreFence).not.toHaveBeenCalled();
  });

  it("expires an unused fenced commitment as settlement-pending", async () => {
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

    await vi.waitFor(() => expect(economicAuthority.recordExecutionSettlementPending).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      preparation.dispatchFenceId,
      "registered-execution-settlement-missing",
    ));
    expect(economicAuthority.releasePreFence).not.toHaveBeenCalled();
    expect(economicAuthority.fenceDispatch).toHaveBeenCalledOnce();
  });

  it("expires a registered settlement that does not resolve", async () => {
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
    preparation.registerEconomicSettlement(new Promise<ManagedEconomicSettlement>(() => undefined));

    await vi.waitFor(() => expect(economicAuthority.recordExecutionSettlementPending).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      preparation.dispatchFenceId,
      "registered-execution-settlement-timed-out",
    ));
    expect(economicAuthority.settleExecution).not.toHaveBeenCalled();
    expect(economicAuthority.releasePreFence).not.toHaveBeenCalled();
  });

  it("keeps capacity pending when a typed settlement reports unknown outcome", async () => {
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
    const unknown: ManagedEconomicSettlement = {
      kind: "unknown",
      reservationId: prepared.commitment.reservation.reservationId,
      dispatchFenceId: prepared.dispatchFenceId,
      actualIdentity: prepared.commitment.reservation.selectedIdentity,
      reason: "provider-charge-unavailable",
      evidence: null,
    };
    prepared.registerEconomicSettlement(Promise.resolve(unknown));

    await vi.waitFor(() => expect(economicAuthority.settleExecution).toHaveBeenCalledWith(
      "job-a",
      "economic-attempt-a",
      prepared.dispatchFenceId,
      unknown,
    ));
    expect(economicAuthority.releasePreFence).not.toHaveBeenCalled();
  });

  it("keeps capacity when a registered provider settlement rejects", async () => {
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
    prepared.registerEconomicSettlement(Promise.reject(new Error("provider outcome unknown")));

    await vi.waitFor(() => expect(economicAuthority.recordExecutionSettlementPending).toHaveBeenCalledOnce());
    expect(economicAuthority.settleExecution).not.toHaveBeenCalled();
  });

  it("does not expose pre-fence compensation after preparation", async () => {
    const economicAuthority = authority();
    const prepared = await new ManagedEconomicDispatchCoordinator({
      authority: economicAuthority,
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => ({ descriptor: {} }) as never,
    }).prepare({
      jobId: "job-a",
      economicAttemptId: "economic-attempt-a",
      intentFingerprint: `sha256:${"9".repeat(64)}`,
      adoption: {} as never,
      admissionProfile: "foundation-readonly-plan",
    });

    expect(prepared).toMatchObject({ status: "prepared" });
    expect(prepared).not.toHaveProperty("releaseBeforeProviderEffect");
    expect(prepared).not.toHaveProperty("beforeProviderEffect");
    expect(economicAuthority.fenceDispatch).toHaveBeenCalledOnce();
  });

  function settlement(dispatchFenceId: string): ManagedEconomicSettlement {
    return {
      kind: "subscription",
      reservationId: "reservation-a",
      dispatchFenceId,
      actualIdentity: commitment().reservation.selectedIdentity,
      units: [{ atoms: "12", scale: 0, unit: "input-token", scheme: { kind: "unit" } }],
      evidence: {
        sourceIdentity: "provider-usage",
        sourceRevision: "usage-1",
        sourceDigest: `sha256:${"d".repeat(64)}`,
        observedAt: "2026-08-01T00:00:00.000Z",
        validUntil: "2026-08-01T01:00:00.000Z",
        confidence: "high",
        authority: "provider-reported",
      },
    };
  }
});
