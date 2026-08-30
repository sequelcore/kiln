import { describe, expect, it, vi } from "vitest";
import {
  createExecutionAccountPolicyId,
  createExecutionAccountRef,
  defineExecutionTargetCatalog,
  type ExecutionAccountAdmissionCandidate,
  type ExecutionTargetCatalog,
} from "@kilnai/core/agents";
import type { ActionEffectEnvelope, AuthorityDescriptor } from "@kilnai/core/engine";
import {
  OperatorSessionPreDispatchCancellationError,
  OperatorSessionPreProviderLaunchRejectionError,
  OperatorSessionExecutionRoutingService,
  type OperatorSessionAuthorityAdmissionPort,
  type OperatorSessionAuthorityAdmissionFacets,
} from "../../src/execution-routing/operator-session-execution-routing-service.js";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import type { ExecutionAccountCapacityAuthority } from "../../src/index.js";
import type { AccountCapacityAcquireInput, AccountCapacityRecord, ExecutionAccountCandidateBinding } from "../../src/execution-kernel/execution-account-capacity-authority.js";
import type { RuntimeConfigurationRevisionSnapshot } from "../../src/session/runtime-configuration-revision-pin.js";
import type { TurnBudgetAdmission } from "../../src/session/effective-authority-admission-bundle.js";

function acceptsExecutionAccountCapacityAuthority(authority: ExecutionAccountCapacityAuthority): void {
  void authority;
}

const catalog = defineExecutionTargetCatalog({
  accounts: [
    { id: "personal", providerId: "codex", credentialId: "credential-personal", maxConcurrency: 2, reservedAffinitySlots: 0, economics: economics() },
    { id: "work", providerId: "codex", credentialId: "credential-work", maxConcurrency: 2, reservedAffinitySlots: 0, economics: economics() },
  ],
  accountPolicies: [{ id: "codex-policy", accountIds: ["personal", "work"], strategy: "economic-least-pressure" }],
  targets: [{
    id: "terra", label: "Terra", providerId: "codex", providerModelId: "gpt-5.6-terra",
    dataClassification: "internal",
    dataPolicyEvidence: { providerId: "codex", providerModelId: "gpt-5.6-terra", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"c".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-08-31T00:00:00.000Z" },
    accountPolicyId: "codex-policy", economics: routeEconomics(),
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
  const dispatch = vi.fn(async (_input: unknown) => { events.push("dispatch"); return "done"; });
  const authority = {
    acquireAccountCapacity: vi.fn((_input: AccountCapacityAcquireInput) => ({ status: "acquired" as const, record: acquiredRecord(), replay: false })),
    releaseAccountCapacityPreFence: vi.fn(() => acquiredRecord()),
    fenceAccountCapacityDispatch: vi.fn(() => ({ ...acquiredRecord(), state: "dispatch-fenced" as const, dispatchFenceId: "turn-1:dispatch" })),
    settleAccountCapacity: vi.fn(() => ({ ...acquiredRecord(), state: "released" as const })),
  };
  const routing = new OperatorSessionExecutionRoutingService({
    catalogSource: {
      capture: vi.fn(async () => ({
        catalog,
        configurationRevision: revisionSnapshot("R1"),
      })),
      activate: vi.fn(),
    },
    candidates: { resolve: vi.fn(async () => [{ candidate: candidate("personal"), lease: leaseBinding("personal") }, { candidate: candidate("work", { health: "unhealthy" }), lease: leaseBinding("work") }]) },
    accountCapacityAuthority: authority,
    credentials: { resolve: vi.fn(async () => { events.push("credential"); return { credential: { opaque: "credential" }, credentialId: "credential-personal", credentialRevisionId: "a".repeat(64) }; }) },
    authorityAdmission: {
      preflight: vi.fn(async () => admittedBudget()),
      prepare: vi.fn(async () => authorityFacets()),
      persist: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    },
    dispatch: { dispatchCommittedTurn: async (input) => dispatch(input) },
    ...overrides,
  });
  return { routing, authority, dispatch, events };
}

function authorityFacets(): OperatorSessionAuthorityAdmissionFacets {
  return {
    sessionId: "session-1",
    turnId: "turn-1",
    sessionRevision: revisionSnapshot("R1"),
    session: {
      skillCatalog: { catalogId: "operator", revision: "skills-r1", skillIds: ["research"] },
      authorityCeiling: { maximumAuthority: "audited", reason: "operator session policy" },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute", requestedAuthority: "audited", admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection", reason: "admitted", completeness: "authoritative",
        toolCount: 1, deniedToolCount: 0, sandboxProjection: "workspace_write",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [{
          toolName: "read_file",
          authority: { level: 1, allowed: true, requiresApproval: false, reason: "read-only" } satisfies AuthorityDescriptor,
          effectEnvelope: {
            operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "none",
            identityUse: "none", consequences: ["local-state"], idempotency: "idempotent",
          } satisfies ActionEffectEnvelope,
        }],
        deniedToolNames: [],
      },
      effectCeiling: {
        operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "metadata",
        identityUse: "none", consequences: ["local-state"], idempotency: "idempotent",
      },
    },
  };
}

function admittedBudget(): TurnBudgetAdmission {
  return { status: "admitted", reason: "observed-below-limit", observation: { observedTokens: 1, source: "test" } };
}

function revisionSnapshot(revisionSetId: string): RuntimeConfigurationRevisionSnapshot {
  return {
    revisionSetId,
    revisions: { execution: revisionSetId },
  };
}

function catalogForRevision(revisionSetId: string): ExecutionTargetCatalog {
  const model = `gpt-5.6-${revisionSetId.toLowerCase()}`;
  const accountId = revisionSetId === "R1" ? "personal" : "work";
  const credentialId = revisionSetId === "R1" ? "credential-personal" : "credential-work";
  return defineExecutionTargetCatalog({
    accounts: [{ id: accountId, providerId: "codex", credentialId, maxConcurrency: 2, reservedAffinitySlots: 0, economics: economics() }],
    accountPolicies: [{ id: "codex-policy", accountIds: [accountId], strategy: "economic-least-pressure" }],
    targets: [{
      id: "terra", label: "Terra", providerId: "codex", providerModelId: model,
      dataClassification: "internal",
      dataPolicyEvidence: { providerId: "codex", providerModelId: model, dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: revisionSetId, sourceDigest: `sha256:${"c".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-08-31T00:00:00.000Z" },
      accountPolicyId: "codex-policy", economics: routeEconomics(),
    }],
  });
}

describe("OperatorSessionExecutionRoutingService", () => {
  it("settles capacity unknown when committed dispatch reports an unknown provider outcome", async () => {
    const { routing, authority } = service({
      readDispatchOutcome: () => "unknown",
    });

    await expect(routing.execute({
      executionId: "turn-1",
      intentFingerprint: `sha256:${"b".repeat(64)}`,
      intent: { targetId: "terra" },
      payload: undefined,
    })).resolves.toMatchObject({ evidence: { status: "unknown" }, result: "done" });

    expect(authority.settleAccountCapacity).toHaveBeenCalledWith(
      "turn-1",
      "turn-1:dispatch",
      expect.objectContaining({ kind: "unknown" }),
    );
  });

  it("admits one effective authority bundle after credential identity is bound and carries it separately", async () => {
    const prepare = vi.fn(async () => authorityFacets());
    const persist = vi.fn(async () => undefined);
    const authorityAdmission: OperatorSessionAuthorityAdmissionPort<undefined> = {
      preflight: vi.fn(async () => admittedBudget()), prepare, persist, abort: vi.fn(async () => undefined),
    };
    const dispatch = vi.fn(async (committed) => {
      expect(committed.authorityAdmission).toBeDefined();
      expect(committed.credential).toEqual({ opaque: "credential" });
      return "done";
    });
    const { routing, authority } = service({
      authorityAdmission,
      dispatch: { dispatchCommittedTurn: dispatch },
    });

    await expect(routing.execute({
      executionId: "turn-1",
      intentFingerprint: `sha256:${"b".repeat(64)}`,
      intent: { targetId: "terra" },
      payload: undefined,
    })).resolves.toMatchObject({ result: "done" });

    expect(prepare).toHaveBeenCalledOnce();
    expect(authority.fenceAccountCapacityDispatch).toHaveBeenCalledBefore(prepare);
    expect(prepare).toHaveBeenCalledBefore(persist);
    expect(persist).toHaveBeenCalledBefore(dispatch);
  });

  it("aborts a persisted prepared admission when committed dispatch rejects before consumption", async () => {
    const abort = vi.fn(async () => undefined);
    const authorityAdmission: OperatorSessionAuthorityAdmissionPort<undefined> = {
      preflight: vi.fn(async () => admittedBudget()),
      prepare: vi.fn(async () => authorityFacets()),
      persist: vi.fn(async () => undefined),
      abort,
    };
    const { routing, authority } = service({
      authorityAdmission,
      dispatch: { dispatchCommittedTurn: vi.fn(async () => { throw new OperatorSessionPreDispatchCancellationError("pre-consume isolation failed"); }) },
    });

    await expect(routing.execute({
      executionId: "turn-1",
      intentFingerprint: `sha256:${"b".repeat(64)}`,
      intent: { targetId: "terra" },
      payload: undefined,
    })).rejects.toThrow(/isolation failed/iu);

    expect(abort).toHaveBeenCalledWith("turn-1");
    expect(authority.settleAccountCapacity).toHaveBeenCalledWith(
      "turn-1",
      "turn-1:dispatch",
      expect.objectContaining({ kind: "completed", outcome: "cancelled" }),
    );
  });

  it("durably settles a known pre-provider rejection as failed rather than unknown", async () => {
    const { routing, authority } = service({
      dispatch: {
        dispatchCommittedTurn: vi.fn(async () => {
          throw new OperatorSessionPreProviderLaunchRejectionError("counterfeit host enforcement");
        }),
      },
    });

    await expect(routing.execute({
      executionId: "turn-1",
      intentFingerprint: `sha256:${"b".repeat(64)}`,
      intent: { targetId: "terra" },
      payload: undefined,
    })).rejects.toThrow(/counterfeit host enforcement/iu);
    expect(authority.settleAccountCapacity).toHaveBeenCalledWith(
      "turn-1",
      "turn-1:dispatch",
      expect.objectContaining({ kind: "completed", outcome: "provider-error" }),
    );
  });

  it.each([
    ["observed-at-or-above-limit", { status: "denied" as const, reason: "observed-at-or-above-limit" as const, action: "stop" as const, message: "budget reached", observation: { observedTokens: 100, source: "test" } }],
    ["usage-unknown", { status: "denied" as const, reason: "usage-unknown" as const, action: "stop" as const, message: "budget unavailable" }],
  ])("denies a %s budget before capacity, credential, authority, or dispatch", async (_reason, budget) => {
    const preflight = vi.fn(async () => { throw new Error(budget.message); });
    const prepare = vi.fn(async () => authorityFacets());
    const authorityAdmission: OperatorSessionAuthorityAdmissionPort<undefined> = {
      preflight,
      prepare,
      persist: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    const { routing, authority, dispatch, events } = service({ authorityAdmission });

    await expect(routing.execute({
      executionId: "turn-1",
      intentFingerprint: `sha256:${"b".repeat(64)}`,
      intent: { targetId: "terra" },
      payload: undefined,
    })).rejects.toThrow(/budget|bound/i);

    expect(authority.acquireAccountCapacity).not.toHaveBeenCalled();
    expect(preflight).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("settles unknown before releasing the mutex when post-fence authority preparation fails", async () => {
    const prepare = vi.fn(async () => { throw new Error("prepare failed"); });
    const authorityAdmission: OperatorSessionAuthorityAdmissionPort<undefined> = {
      preflight: vi.fn(async () => admittedBudget()),
      prepare,
      persist: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    const { routing, authority, dispatch } = service({ authorityAdmission });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined })).rejects.toThrow(/prepare failed/);
    expect(authority.settleAccountCapacity).toHaveBeenCalledWith("turn-1", "turn-1:dispatch", expect.objectContaining({ kind: "completed", outcome: "cancelled" }));
    expect(dispatch).not.toHaveBeenCalled();
  });

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
    const { routing, authority, events } = service();

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined })).resolves.toMatchObject({
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

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined })).rejects.toThrow(/does not match/i);
    expect(authority.acquireAccountCapacity).not.toHaveBeenCalled();
  });

  it("keeps an exact override inside automatic policy and passes it through the same gates", async () => {
    const { routing, authority } = service({ candidates: { resolve: vi.fn(async () => [{ candidate: candidate("personal", { health: "unhealthy" }), lease: leaseBinding("personal") }, { candidate: candidate("work"), lease: leaseBinding("work") }]) } });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { targetId: "terra", accountOverrideId: "personal" }, payload: undefined })).rejects.toMatchObject({
      routingFailureCode: "health-unhealthy",
    });

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

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined })).resolves.toMatchObject({ accountId: "work" });

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

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { targetId: "terra", accountOverrideId: "personal" }, payload: undefined })).rejects.toThrow(/no available shared capacity/i);
    expect(capacityAuthority.acquireAccountCapacity).toHaveBeenCalledOnce();
    expect(capacityAuthority.acquireAccountCapacity).toHaveBeenCalledWith(expect.objectContaining({ candidates: [personal] }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects a lease whose account reference does not belong to the logical candidate before capacity or credential authority", async () => {
    const wrong = leaseBinding("work");
    const { routing, authority } = service({
      candidates: { resolve: vi.fn(async () => [{ candidate: candidate("personal"), lease: wrong }]) },
    });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined })).rejects.toThrow(/does not belong/i);
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

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined })).rejects.toThrow(/synthetic fence failure/);
    expect(capacityAuthority.releaseAccountCapacityPreFence).toHaveBeenCalledWith("turn-1");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("releases the admission mutex even when pre-fence cleanup also throws", async () => {
    let fenceAttempts = 0;
    const capacityAuthority = {
      acquireAccountCapacity: vi.fn(() => ({ status: "acquired" as const, record: acquiredRecord(), replay: false })),
      releaseAccountCapacityPreFence: vi.fn(() => { throw new Error("synthetic cleanup failure"); }),
      fenceAccountCapacityDispatch: vi.fn(() => {
        fenceAttempts += 1;
        if (fenceAttempts === 1) throw new Error("synthetic fence failure");
        return { ...acquiredRecord(), state: "dispatch-fenced" as const, dispatchFenceId: "turn-2:dispatch" };
      }),
      settleAccountCapacity: vi.fn(() => ({ ...acquiredRecord(), state: "released" as const })),
    };
    const { routing } = service({ accountCapacityAuthority: capacityAuthority });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"1".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined }))
      .rejects.toThrow(/cleanup failure/iu);
    await expect(routing.execute({ executionId: "turn-2", intentFingerprint: `sha256:${"2".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined }))
      .resolves.toMatchObject({ result: "done" });
  });

  it.each([
    ["credential ID", { credential: {}, credentialId: "credential-other", credentialRevisionId: "a".repeat(64) }],
    ["credential revision", { credential: {}, credentialId: "credential-personal", credentialRevisionId: "b".repeat(64) }],
  ])("does not dispatch when post-fence %s drifts", async (_name, resolved) => {
    const { routing, authority, dispatch } = service({ credentials: { resolve: vi.fn(async () => resolved) } });

    await expect(routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined })).rejects.toThrow(/does not match/i);

    expect(authority.fenceAccountCapacityDispatch).toHaveBeenCalledWith("turn-1", "turn-1:dispatch");
    expect(authority.settleAccountCapacity).toHaveBeenCalledWith("turn-1", "turn-1:dispatch", expect.objectContaining({ kind: "completed", outcome: "cancelled" }));
    expect(authority.settleAccountCapacity).toHaveBeenCalledOnce();
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

    await routing.execute({ executionId: "turn-1", intentFingerprint: `sha256:${"b".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined });
    expect(order).toEqual(["fence", "credential", "dispatch"]);
    expect(authority.releaseAccountCapacityPreFence).not.toHaveBeenCalled();
  });

  it("keeps concurrent executions internally on one catalog revision while activation is serialized", async () => {
    const r1Catalog = catalogForRevision("R1");
    const r2Catalog = catalogForRevision("R2");
    let current = { catalog: r1Catalog, configurationRevision: revisionSnapshot("R1") };
    let captureCount = 0;
    let releaseFirstCapture!: () => void;
    const firstCaptureBlocked = new Promise<void>((resolve) => { releaseFirstCapture = resolve; });
    let firstCaptureEntered!: () => void;
    const firstCaptureStarted = new Promise<void>((resolve) => { firstCaptureEntered = resolve; });
    let activeRevision: string | undefined;
    const activationOrder: string[] = [];
    const catalogSource = {
      capture: vi.fn(async () => {
        const captured = current;
        captureCount += 1;
        if (captureCount === 1) {
          firstCaptureEntered();
          await firstCaptureBlocked;
        }
        return captured;
      }),
      activate: vi.fn(async ({ configurationRevision }: { readonly configurationRevision: RuntimeConfigurationRevisionSnapshot }) => {
        activeRevision = configurationRevision.revisionSetId;
        activationOrder.push(`activate:${activeRevision}`);
      }),
    };
    const authority = {
      acquireAccountCapacity: vi.fn((input: AccountCapacityAcquireInput) => {
        const accountId = input.candidates[0]!.candidate.account.slice("configured:".length);
        const revision = accountId === "personal" ? "R1" : "R2";
        return {
          status: "acquired" as const,
          record: {
            ...acquiredRecord(),
            accountRef: createExecutionAccountRef(`configured:${accountId}`),
            capacityIdentity: `codex:${accountId}`,
            credentialRevisionId: revision,
          },
          replay: false,
        };
      }),
      releaseAccountCapacityPreFence: vi.fn(() => acquiredRecord()),
      fenceAccountCapacityDispatch: vi.fn((_executionId: string, fenceId: string) => ({
        ...acquiredRecord(),
        state: "dispatch-fenced" as const,
        dispatchFenceId: fenceId,
      })),
      settleAccountCapacity: vi.fn(() => ({ ...acquiredRecord(), state: "released" as const })),
    };
    let releaseFirstCredential!: () => void;
    const firstCredentialBlocked = new Promise<void>((resolve) => { releaseFirstCredential = resolve; });
    const credentials = {
      resolve: vi.fn(async ({ credentialId, lease, configurationRevision }: {
        readonly credentialId: string;
        readonly lease: AccountCapacityRecord;
        readonly configurationRevision: RuntimeConfigurationRevisionSnapshot;
      }) => {
        expect(activeRevision).toBe(configurationRevision.revisionSetId);
        if (configurationRevision.revisionSetId === "R1") await firstCredentialBlocked;
        return { credential: { revision: configurationRevision.revisionSetId }, credentialId, credentialRevisionId: lease.credentialRevisionId };
      }),
    };
    const routing = new OperatorSessionExecutionRoutingService({
      catalogSource,
      candidates: {
        resolve: vi.fn(async ({ admission, catalog, configurationRevision }: {
          readonly admission: { readonly targetId: string; readonly providerModelId: string };
          readonly catalog: ExecutionTargetCatalog;
          readonly configurationRevision: RuntimeConfigurationRevisionSnapshot;
        }) => {
          expect(activeRevision).toBe(configurationRevision.revisionSetId);
          const account = catalog.accounts[0]!;
          expect(admission.providerModelId).toBe(account === r1Catalog.accounts[0] ? "gpt-5.6-r1" : "gpt-5.6-r2");
          return [{ candidate: candidate(account.id), lease: {
            ...leaseBinding(account.id),
            candidate: { ...leaseBinding(account.id).candidate, route: { providerId: "codex", providerModelId: admission.providerModelId, scope: "operator-session" } },
            credentialRevisionId: configurationRevision.revisionSetId === "R1" ? "R1" : "R2",
          } }];
        }),
      },
      accountCapacityAuthority: authority,
      credentials,
      authorityAdmission: {
        preflight: vi.fn(async () => admittedBudget()),
        prepare: vi.fn(async () => authorityFacets()),
        persist: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
      },
      dispatch: { dispatchCommittedTurn: vi.fn(async (committed) => ({ revision: committed.configurationRevision.revisionSetId, model: committed.admission.providerModelId })) },
    });

    const first = routing.execute({ executionId: "turn-r1", intentFingerprint: `sha256:${"1".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined });
    await firstCaptureStarted;
    current = { catalog: r2Catalog, configurationRevision: revisionSnapshot("R2") };
    const second = routing.execute({ executionId: "turn-r2", intentFingerprint: `sha256:${"2".repeat(64)}`, intent: { targetId: "terra" }, payload: undefined });
    await Promise.resolve();
    expect(catalogSource.activate).not.toHaveBeenCalled();
    releaseFirstCapture();
    await vi.waitFor(() => expect(catalogSource.activate).toHaveBeenCalledWith(expect.objectContaining({ configurationRevision: expect.objectContaining({ revisionSetId: "R1" }) })));
    expect(catalogSource.activate).toHaveBeenCalledTimes(1);
    releaseFirstCredential();

    await expect(first).resolves.toMatchObject({
      accountId: "personal",
      admission: { providerModelId: "gpt-5.6-r1" },
      result: { revision: "R1", model: "gpt-5.6-r1" },
    });
    await expect(second).resolves.toMatchObject({
      accountId: "work",
      admission: { providerModelId: "gpt-5.6-r2" },
      result: { revision: "R2", model: "gpt-5.6-r2" },
    });
    expect(activationOrder).toEqual(["activate:R1", "activate:R2"]);
  });
});
