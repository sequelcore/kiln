import { describe, expect, it, vi } from "vitest";
import {
  createExecutionAccountPolicyId,
  createExecutionAccountRef,
  defineExecutionCatalog,
  type ExecutionAccountAdmissionCandidate,
} from "@kilnai/core";
import {
  OperatorSessionExecutionRoutingService,
  type AccountCapacityAcquireInput,
  type AccountCapacityRecord,
  type ExecutionAccountCandidateBinding,
} from "../../src/index.js";
import {
  fingerprintOperatorTurnIntent,
  OperatorSessionExecutionBridge,
  OperatorTurnDispatcher,
} from "../../src/execution-routing/operator-turn-dispatcher.js";

const revision = "a".repeat(64);
const catalog = defineExecutionCatalog({
  accounts: [
    {
      id: "personal",
      providerId: "codex",
      credentialId: "credential-personal",
      maxConcurrency: 2,
      reservedAffinitySlots: 0,
      economics: accountEconomics(),
    },
    {
      id: "work",
      providerId: "codex",
      credentialId: "credential-work",
      maxConcurrency: 2,
      reservedAffinitySlots: 0,
      economics: accountEconomics(),
    },
  ],
  accountPolicies: [{ id: "codex-policy", accountIds: ["personal", "work"], strategy: "economic-least-pressure" }],
  routes: [
    {
      id: "terra",
      label: "Terra",
      providerId: "codex",
      providerModelId: "gpt-5.6-terra",
      dataClassification: "internal",
      dataPolicyEvidence: { providerId: "codex", providerModelId: "gpt-5.6-terra", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"c".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-08-31T00:00:00.000Z" },
      accountSelection: { mode: "automatic", accountPolicyId: "codex-policy" },
      economics: routeEconomics(),
    },
    {
      id: "luna",
      label: "Luna",
      providerId: "codex",
      providerModelId: "gpt-5.6-luna",
      dataClassification: "internal",
      dataPolicyEvidence: { providerId: "codex", providerModelId: "gpt-5.6-luna", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"c".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-08-31T00:00:00.000Z" },
      accountSelection: { mode: "exact", accountId: "work" },
      economics: routeEconomics(),
    },
  ],
});

function accountEconomics() {
  return {
    capacityIdentity: "capacity",
    subscriptionClass: "subscription" as const,
    quotaClassId: "quota",
    creditPosture: "disabled" as const,
    overagePosture: "disabled" as const,
  };
}

function routeEconomics() {
  return {
    adapterCapabilityId: "cap",
    adapterCapabilityVersion: "1",
    authBillingChannel: "oauth",
    executionMode: "direct" as const,
    serviceTier: "default",
    rateCardBasis: "subscription",
    envelopeSemantics: "turn",
    fallbackPosture: "disabled" as const,
    overagePosture: "disabled" as const,
    contextClass: "default",
    cacheClass: "none",
    priceEvidence: {
      kind: "subscription" as const,
      rateCardId: "card",
      rateCardRevision: "1",
      evidence: {
        sourceIdentity: "test-source",
        sourceRevision: "1",
        sourceDigest: `sha256:${"b".repeat(64)}`,
        observedAt: "2026-08-01T00:00:00.000Z",
        validUntil: "2026-09-01T00:00:00.000Z",
        confidence: "high" as const,
        authority: "configured" as const,
      },
    },
    auxiliaryCharges: [],
    executionEnvelope: { limits: [] },
  };
}

function candidate(accountId: string, overrides: Partial<ExecutionAccountAdmissionCandidate> = {}): ExecutionAccountAdmissionCandidate {
  return {
    accountId,
    safety: "eligible",
    health: "healthy",
    quota: "available",
    capacity: "available",
    economicCost: {
      atoms: "1",
      scale: 0,
      unit: "request",
      scheme: { kind: "currency", currency: "USD" },
    },
    pressure: 0,
    ...overrides,
  };
}

function leaseBinding(accountId: string, model = "gpt-5.6-terra"): ExecutionAccountCandidateBinding {
  return {
    candidate: {
      account: createExecutionAccountRef(`configured:${accountId}`),
      route: { providerId: "codex", providerModelId: model, scope: "operator-session" },
      health: "healthy",
      leaseCapacity: "available",
      pressure: 0,
      reservedForNewWork: false,
    },
    capacityIdentity: `codex:${accountId}`,
    credentialRevisionId: revision,
    usageEvidence: { health: "healthy", freshness: "missing" },
    capacity: { maxConcurrency: 2, reservedAffinitySlots: 0 },
  };
}

function acquiredRecord(accountId = "personal", model = "gpt-5.6-terra"): AccountCapacityRecord {
  return {
    leaseId: "lease",
    runtimeInvocationId: "turn-1",
    accountPolicyId: createExecutionAccountPolicyId("codex-policy"),
    accountRef: createExecutionAccountRef(`configured:${accountId}`),
    route: { providerId: "codex", providerModelId: model, scope: "operator-session" },
    capacityIdentity: `codex:${accountId}`,
    credentialRevisionId: revision,
    state: "held",
    selectionReason: "least-pressure",
    candidateRejections: [],
  };
}

function dispatcher(overrides: {
  readonly candidates?: readonly { readonly candidate: ExecutionAccountAdmissionCandidate; readonly lease: ExecutionAccountCandidateBinding }[];
  readonly order?: string[];
} = {}) {
  const order = overrides.order ?? [];
  let acquiredAccountId = "personal";
  const authority = {
    acquireAccountCapacity: vi.fn((input: AccountCapacityAcquireInput) => {
      acquiredAccountId = input.candidates[0]!.candidate.account.slice("configured:".length);
      return { status: "acquired" as const, record: acquiredRecord(acquiredAccountId), replay: false };
    }),
    releaseAccountCapacityPreFence: vi.fn(() => acquiredRecord(acquiredAccountId)),
    fenceAccountCapacityDispatch: vi.fn(() => {
      order.push("fence");
      return { ...acquiredRecord(acquiredAccountId), state: "dispatch-fenced" as const, dispatchFenceId: "turn-1:dispatch" };
    }),
    settleAccountCapacity: vi.fn(() => ({ ...acquiredRecord(acquiredAccountId), state: "released" as const })),
  };
  const dispatch = vi.fn(async ({ accountId, payload }: {
    readonly accountId: string;
    readonly payload: { readonly result?: string };
  }) => {
    order.push("adapter");
    return payload.result ?? accountId;
  });
  const routing = new OperatorSessionExecutionRoutingService({
    catalog,
    candidates: {
      resolve: vi.fn(async () => overrides.candidates ?? [
        { candidate: candidate("personal"), lease: leaseBinding("personal") },
        { candidate: candidate("work", { pressure: 1 }), lease: leaseBinding("work") },
      ]),
    },
    accountCapacityAuthority: authority,
    credentials: {
      resolve: vi.fn(async ({ credentialId }: { readonly accountId: string; readonly credentialId: string }) => {
        order.push("credential");
        return {
          credential: { opaque: true },
          credentialId,
          credentialRevisionId: revision,
        };
      }),
    },
    dispatch: { dispatchCommittedTurn: dispatch },
  });
  return { dispatcher: new OperatorTurnDispatcher(routing), authority, order, dispatch };
}

describe("OperatorTurnDispatcher", () => {
  it("requires one composition-owned gateway binding and cannot be rebound", async () => {
    const bridge = new OperatorSessionExecutionBridge<unknown, { readonly value: string }, string>();
    await expect(Promise.resolve().then(() => bridge.dispatchCommittedTurn({} as never))).rejects.toThrow(/not bound/i);
    bridge.bind(async ({ binding, payload }) => `${binding.accountId}:${payload.value}`);
    await expect(Promise.resolve().then(() => bridge.dispatchCommittedTurn({} as never))).rejects.toThrow();
    expect(() => bridge.bind(async () => "rebound")).toThrow(/already bound/i);
  });

  it("passes an automatic route through the routing service and returns committed evidence", async () => {
    const { dispatcher, dispatch } = dispatcherFixture();

    const result = await dispatcher.dispatchTurn({
      executionId: "turn-1",
      intentFingerprint: fingerprintOperatorTurnIntent({ executionId: "turn-1", intent: { routeId: "terra" } }),
      intent: { routeId: "terra" },
      payload: { result: "terra" },
    });

    expect(result.result).toBe("terra");
    expect(result.evidence).toMatchObject({
      routeId: "terra",
      accountId: "personal",
      credentialId: "credential-personal",
      credentialRevision: revision,
      status: "completed",
    });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "personal",
      credential: { opaque: true },
      payload: { result: "terra" },
    }));
  });

  it("keeps an exact operator override inside the same service boundary", async () => {
    const { dispatcher, authority } = dispatcherFixture({
      candidates: [{ candidate: candidate("work"), lease: leaseBinding("work") }],
    });

    const result = await dispatcher.dispatchTurn({
      executionId: "turn-1",
      intentFingerprint: fingerprintOperatorTurnIntent({ executionId: "turn-1", intent: { routeId: "terra", accountOverrideId: "work" } }),
      intent: { routeId: "terra", accountOverrideId: "work" },
      payload: {},
    });

    expect(result.result).toBe("work");
    expect(result.evidence.accountId).toBe("work");
    expect(authority.acquireAccountCapacity).toHaveBeenCalledWith(expect.objectContaining({ candidates: [leaseBinding("work")] }));
  });

  it("does not invoke the committed callback before the capacity fence and credential resolution", async () => {
    const order: string[] = [];
    const { dispatcher } = dispatcherFixture({ order });

    await dispatcher.dispatchTurn({
      executionId: "turn-1",
      intentFingerprint: fingerprintOperatorTurnIntent({ executionId: "turn-1", intent: { routeId: "terra" } }),
      intent: { routeId: "terra" },
      payload: { result: "done" },
    });

    expect(order).toEqual(["fence", "credential", "adapter"]);
  });

  it("rejects before any adapter construction when no eligible account remains", async () => {
    const { dispatcher, dispatch } = dispatcherFixture({
      candidates: [{ candidate: candidate("personal", { health: "unhealthy" }), lease: leaseBinding("personal") }],
    });

    await expect(dispatcher.dispatchTurn({
      executionId: "turn-1",
      intentFingerprint: fingerprintOperatorTurnIntent({ executionId: "turn-1", intent: { routeId: "terra" } }),
      intent: { routeId: "terra" },
      payload: { result: "constructed" },
    })).rejects.toThrow(/no eligible account/i);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

function dispatcherFixture(options: Parameters<typeof dispatcher>[0] = {}) {
  return dispatcher(options);
}
