import { describe, expect, it, vi } from "vitest";
import { createExecutionAccountPolicyId, createExecutionAccountRef, defineExecutionCatalog, type ExecutionAccountAdmissionCandidate } from "@kilnai/core";
import { OperatorSessionExecutionRoutingService } from "../../src/execution-routing/operator-session-execution-routing-service.js";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import type { ExecutionAccountCapacityAuthority } from "../../src/index.js";
import type { AccountCapacityAcquireInput, AccountCapacityRecord, ExecutionAccountCandidateBinding } from "../../src/execution-kernel/execution-account-capacity-authority.js";

function acceptsExecutionAccountCapacityAuthority(authority: ExecutionAccountCapacityAuthority): void {
  void authority;
}

const catalog = defineExecutionCatalog({
  accounts: [
    { id: "personal", providerId: "codex", credentialId: "credential-personal", maxConcurrency: 2, reservedAffinitySlots: 0, economics: economics() },
    { id: "work", providerId: "codex", credentialId: "credential-work", maxConcurrency: 2, reservedAffinitySlots: 0, economics: economics() },
  ],
  accountPolicies: [{ id: "codex-policy", accountIds: ["personal", "work"], strategy: "economic-least-pressure" }],
  routes: [{
    id: "terra", label: "Terra", providerId: "codex", providerModelId: "gpt-5.6-terra",
    dataClassification: "internal",
    dataPolicyEvidence: { providerId: "codex", providerModelId: "gpt-5.6-terra", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"c".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-08-31T00:00:00.000Z" },
    accountSelection: { mode: "automatic", accountPolicyId: "codex-policy" }, economics: routeEconomics(),
  }],
});

function economics() { return { capacityIdentity: "capacity", subscriptionClass: "subscription" as const, quotaClassId: "quota", creditPosture: "disabled" as const, overagePosture: "disabled" as const }; }
function routeEconomics() { return { adapterCapabilityId: "cap", adapterCapabilityVersion: "1", authBillingChannel: "oauth", executionMode: "direct", serviceTier: "default", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled" as const, overagePosture: "disabled" as const, contextClass: "default", cacheClass: "none", priceEvidence: { kind: "subscription" as const, rateCardId: "card", rateCardRevision: "1", evidence: { sourceIdentity: "test-source", sourceRevision: "1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", validUntil: "2026-09-01T00:00:00.000Z", confidence: "high" as const, authority: "configured" as const } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } }; }

function candidate(accountId: string, overrides: Partial<ExecutionAccountAdmissionCandidate> = {}): ExecutionAccountAdmissionCandidate {
  return { accountId, safety: "eligible", health: "healthy", quota: "available", capacity: "available", economicCost: { atoms: "1", scale: 0, unit: "request", scheme: { kind: "currency" as const, currency: "USD" } }, pressure: 0, ...overrides };
}

function leaseBinding(accountId: string): ExecutionAccountCandidateBinding {
  const route = { providerId: "codex", providerModelId: "gpt-5.6-terra", scope: "operator-session" };
  return { candidate: { account: createExecutionAccountRef(`configured:${accountId}`), route, health: "healthy", leaseCapacity: "available", pressure: 0, reservedForNewWork: false }, capacityIdentity: `codex:${accountId}`, credentialRevisionId: "a".repeat(64), usageEvidence: { health: "healthy", freshness: "missing" }, capacity: { maxConcurrency: 2, reservedAffinitySlots: 0 } };
}

function acquiredRecord(): AccountCapacityRecord {
  return { leaseId: "lease", runtimeInvocationId: "turn-1", accountPolicyId: createExecutionAccountPolicyId("codex-policy"), accountRef: createExecutionAccountRef("configured:personal"), route: { providerId: "codex", providerModelId: "gpt-5.6-terra", scope: "operator-session" }, capacityIdentity: "codex:personal", credentialRevisionId: "a".repeat(64), state: "held", selectionReason: "least-pressure", candidateRejections: [] };
}

function service(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const dispatch = vi.fn(async () => { events.push("dispatch"); return "done"; });
  const authority = {
    acquireAccountCapacity: vi.fn((_input: AccountCapacityAcquireInput) => ({ status: "acquired" as const, record: acquiredRecord(), replay: false })),
    releaseAccountCapacityPreFence: vi.fn(() => acquiredRecord()),
    fenceAccountCapacityDispatch: vi.fn(() => ({ ...acquiredRecord(), state: "dispatch-fenced" as const, dispatchFenceId: "turn-1:dispatch" })),
    settleAccountCapacity: vi.fn(() => ({ ...acquiredRecord(), state: "released" as const })),
  };
  const routing = new OperatorSessionExecutionRoutingService({
    catalog,
    candidates: { resolve: vi.fn(async () => [{ candidate: candidate("personal"), lease: leaseBinding("personal") }, { candidate: candidate("work", { health: "unhealthy" }), lease: leaseBinding("work") }]) },
    accountCapacityAuthority: authority,
    credentials: { resolve: vi.fn(async () => { events.push("credential"); return { credential: { opaque: "credential" }, credentialId: "credential-personal", credentialRevisionId: "a".repeat(64) }; }) },
    dispatch: { dispatchCommittedTurn: async (input) => dispatch(input) },
    ...overrides,
  });
  return { routing, authority, dispatch, events };
}

describe("OperatorSessionExecutionRoutingService", () => {
  it("exposes a provider-neutral capacity authority structurally satisfied by the SQLite authority", () => {
    const authority = new SqliteManagedAccountLeaseAuthority({
      path: ":memory:",
      participantKind: "operator-session",
      recoveryDomain: "structural-contract-test",
      configurationRevision: "test",
    });
    try {
      acceptsExecutionAccountCapacityAuthority(authority);
    } finally {
      authority.close();
    }
  });

  it("admits automatic selection in Core, leases before resolving a credential, then fences before dispatch", async () => {
    const { routing, authority, events, dispatch } = service();

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { routeId: "terra" }, payload: undefined })).resolves.toMatchObject({
      result: "done",
      accountId: "personal",
      evidence: {
        routeId: "terra",
        credentialId: "credential-personal",
        credentialRevision: "a".repeat(64),
        capacityIdentity: "codex:personal",
        leaseId: "lease",
        status: "completed",
      },
    });

    expect(authority.acquireAccountCapacity).toHaveBeenCalledWith(expect.objectContaining({ accountPolicyId: "codex-policy", candidates: [leaseBinding("personal")] }));
    expect(authority.fenceAccountCapacityDispatch).toHaveBeenCalledWith("turn-1", "turn-1:dispatch");
    expect(events).toEqual(["credential", "dispatch"]);
  });

  it("fails closed when the selected binding targets a different route", async () => {
    const wrong = leaseBinding("personal");
    const { routing, authority } = service({
      candidates: {
        resolve: vi.fn(async () => [{
          candidate: candidate("personal"),
          lease: {
            ...wrong,
            candidate: {
              ...wrong.candidate,
              route: { ...wrong.candidate.route, providerModelId: "other-model" },
            },
          },
        }]),
      },
    });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { routeId: "terra" }, payload: undefined })).rejects.toThrow(/does not match/i);
    expect(authority.acquireAccountCapacity).not.toHaveBeenCalled();
  });

  it("keeps an exact override inside automatic policy and passes it through the same gates", async () => {
    const { routing, authority } = service({ candidates: { resolve: vi.fn(async () => [{ candidate: candidate("personal", { health: "unhealthy" }), lease: leaseBinding("personal") }, { candidate: candidate("work"), lease: leaseBinding("work") }]) } });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { routeId: "terra", accountOverrideId: "personal" }, payload: undefined })).rejects.toThrow(/no eligible account/i);

    expect(authority.acquireAccountCapacity).not.toHaveBeenCalled();
  });

  it("tries the next economically eligible automatic account when live shared capacity rejects the cheaper account", async () => {
    const personal = leaseBinding("personal");
    const work = leaseBinding("work");
    const capacityAuthority = {
      acquireAccountCapacity: vi.fn((input: AccountCapacityAcquireInput) =>
        input.candidates[0] === personal
          ? { status: "unavailable" as const, rejections: [] }
          : { status: "acquired" as const, record: { ...acquiredRecord(), accountRef: createExecutionAccountRef("configured:work"), capacityIdentity: "codex:work" }, replay: false },
      ),
      releaseAccountCapacityPreFence: vi.fn(() => acquiredRecord()),
      fenceAccountCapacityDispatch: vi.fn(() => ({ ...acquiredRecord(), accountRef: createExecutionAccountRef("configured:work"), capacityIdentity: "codex:work", state: "dispatch-fenced" as const, dispatchFenceId: "turn-1:dispatch" })),
      settleAccountCapacity: vi.fn(() => ({ ...acquiredRecord(), state: "released" as const })),
    };
    const dispatch = vi.fn(async () => "done");
    const { routing } = service({
      candidates: {
        resolve: vi.fn(async () => [
          { candidate: candidate("personal", { economicCost: { atoms: "1", scale: 0, unit: "request", scheme: { kind: "currency", currency: "USD" } } }), lease: personal },
          { candidate: candidate("work", { economicCost: { atoms: "2", scale: 0, unit: "request", scheme: { kind: "currency", currency: "USD" } } }), lease: work },
        ]),
      },
      accountCapacityAuthority: capacityAuthority,
      credentials: { resolve: vi.fn(async () => ({ credential: {}, credentialId: "credential-work", credentialRevisionId: "a".repeat(64) })) },
      dispatch: { dispatchCommittedTurn: dispatch },
    });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { routeId: "terra" }, payload: undefined })).resolves.toMatchObject({ accountId: "work" });

    expect(capacityAuthority.acquireAccountCapacity).toHaveBeenNthCalledWith(1, expect.objectContaining({ candidates: [personal] }));
    expect(capacityAuthority.acquireAccountCapacity).toHaveBeenNthCalledWith(2, expect.objectContaining({ candidates: [work] }));
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("does not fall back from an exact account when live shared capacity rejects it", async () => {
    const personal = leaseBinding("personal");
    const work = leaseBinding("work");
    const capacityAuthority = {
      acquireAccountCapacity: vi.fn(() => ({ status: "unavailable" as const, rejections: [] })),
      releaseAccountCapacityPreFence: vi.fn(() => acquiredRecord()),
      fenceAccountCapacityDispatch: vi.fn(() => acquiredRecord()),
      settleAccountCapacity: vi.fn(() => acquiredRecord()),
    };
    const { routing, dispatch } = service({
      candidates: { resolve: vi.fn(async () => [{ candidate: candidate("personal"), lease: personal }, { candidate: candidate("work"), lease: work }]) },
      accountCapacityAuthority: capacityAuthority,
    });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { routeId: "terra", accountOverrideId: "personal" }, payload: undefined })).rejects.toThrow(/no available shared capacity/i);
    expect(capacityAuthority.acquireAccountCapacity).toHaveBeenCalledOnce();
    expect(capacityAuthority.acquireAccountCapacity).toHaveBeenCalledWith(expect.objectContaining({ candidates: [personal] }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects a lease whose account reference does not belong to the logical candidate before capacity or credential authority", async () => {
    const wrong = leaseBinding("work");
    const { routing, authority } = service({
      candidates: { resolve: vi.fn(async () => [{ candidate: candidate("personal"), lease: wrong }]) },
    });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { routeId: "terra" }, payload: undefined })).rejects.toThrow(/does not belong/i);
    expect(authority.acquireAccountCapacity).not.toHaveBeenCalled();
  });

  it("releases a held lease when dispatch fencing throws", async () => {
    const capacityAuthority = {
        acquireAccountCapacity: vi.fn(() => ({ status: "acquired" as const, record: acquiredRecord(), replay: false })),
        releaseAccountCapacityPreFence: vi.fn(() => ({ ...acquiredRecord(), state: "released" as const })),
        fenceAccountCapacityDispatch: vi.fn(() => { throw new Error("synthetic fence failure"); }),
        settleAccountCapacity: vi.fn(() => acquiredRecord()),
    };
    const { routing, dispatch } = service({ accountCapacityAuthority: capacityAuthority });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { routeId: "terra" }, payload: undefined })).rejects.toThrow(/synthetic fence failure/);
    expect(capacityAuthority.releaseAccountCapacityPreFence).toHaveBeenCalledWith("turn-1");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ["credential ID", { credential: {}, credentialId: "credential-other", credentialRevisionId: "a".repeat(64) }],
    ["credential revision", { credential: {}, credentialId: "credential-personal", credentialRevisionId: "b".repeat(64) }],
  ])("does not dispatch when post-fence %s drifts", async (_name, resolved) => {
    const { routing, authority, dispatch } = service({ credentials: { resolve: vi.fn(async () => resolved) } });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { routeId: "terra" }, payload: undefined })).rejects.toThrow(/does not match/i);

    expect(authority.fenceAccountCapacityDispatch).toHaveBeenCalledWith("turn-1", "turn-1:dispatch");
    expect(authority.settleAccountCapacity).toHaveBeenCalledWith("turn-1", "turn-1:dispatch", expect.objectContaining({ kind: "unknown", reason: "credential-identity-drift" }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("re-resolves the committed credential only after dispatch fencing", async () => {
    const order: string[] = [];
    const { routing, authority } = service({
      accountCapacityAuthority: {
        acquireAccountCapacity: vi.fn(() => ({ status: "acquired" as const, record: acquiredRecord(), replay: false })), releaseAccountCapacityPreFence: vi.fn(),
        fenceAccountCapacityDispatch: vi.fn(() => { order.push("fence"); return { ...acquiredRecord(), state: "dispatch-fenced" as const, dispatchFenceId: "turn-1:dispatch" }; }), settleAccountCapacity: vi.fn(),
      },
      credentials: { resolve: vi.fn(async () => { order.push("credential"); return { credential: {}, credentialId: "credential-personal", credentialRevisionId: "a".repeat(64) }; }) },
      dispatch: { dispatchCommittedTurn: vi.fn(async () => { order.push("dispatch"); return "done"; }) },
    });

    await routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { routeId: "terra" }, payload: undefined });
    expect(order).toEqual(["fence", "credential", "dispatch"]);
    expect(authority.releaseAccountCapacityPreFence).not.toHaveBeenCalled();
  });
});
