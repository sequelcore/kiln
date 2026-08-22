import { describe, expect, it, vi } from "vitest";
import { admitOperatorExecutionIntent, defineExecutionCatalog } from "@kilnai/core/agents";
import { ConfiguredExecutionAccountRuntime } from "../../src/managed-account-leases/configured-execution-account-runtime.js";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";

const codexExecution = {
  credentialId: "credential-a",
  fileIdentity: "a".repeat(64),
  revision: "b".repeat(64),
};

const dataPolicyEvidence = (expiresAt = "2026-12-31T00:00:00.000Z") => ({
  providerId: "codex-oauth", providerModelId: "gpt-test", dataUse: "not-used" as const,
  trainingPosture: "prohibited" as const, retention: { posture: "zero" as const, days: 0 },
  permittedMaximumClassification: "internal" as const, permittedClassifications: ["public", "internal"] as const,
  sourceIdentity: "fixture-privacy", sourceRevision: "revision-1", sourceDigest: `sha256:${"d".repeat(64)}` as const,
  observedAt: "2026-01-01T00:00:00.000Z", expiresAt,
});

const catalog = defineExecutionCatalog({
  accounts: [
    {
      id: "account-a",
      providerId: "codex-oauth",
      credentialId: "credential-a",
      maxConcurrency: 2,
      reservedAffinitySlots: 1,
      economics: accountEconomics("codex-capacity-a"),
    },
    {
      id: "account-b",
      providerId: "codex-oauth",
      credentialId: "credential-b",
      maxConcurrency: 1,
      reservedAffinitySlots: 0,
      economics: accountEconomics("codex-capacity-b"),
    },
  ],
  accountPolicies: [{ id: "codex-policy", accountIds: ["account-a", "account-b"], strategy: "economic-least-pressure" }],
  routes: [{
    id: "codex-route",
    label: "Codex route",
    providerId: "codex-oauth",
    providerModelId: "gpt-test",
    dataClassification: "internal",
    dataPolicyEvidence: dataPolicyEvidence(),
    accountSelection: { mode: "automatic", accountPolicyId: "codex-policy" },
    economics: routeEconomics(),
  }],
});

function snapshotContext(effectiveCatalog: typeof catalog) {
  return {
    catalog: effectiveCatalog,
    configurationRevision: { revisionSetId: "fixture", revisions: { "execution-catalog": "fixture" } },
  };
}

describe("ConfiguredExecutionAccountRuntime", () => {
  it("preserves the selected route id when two routes share provider, model, and accounts", async () => {
    const duplicateCatalog = defineExecutionCatalog({
      ...catalog,
      routes: [catalog.routes[0]!, { ...catalog.routes[0]!, id: "codex-route-alternate", label: "Alternate" }],
    });
    const codexPool = pool([codexExecution]);
    const runtime = new ConfiguredExecutionAccountRuntime({
      catalog: duplicateCatalog, codexPool, now: () => new Date("2026-08-15T00:00:00.000Z"),
    });
    const admission = admitOperatorExecutionIntent(duplicateCatalog, { routeId: "codex-route-alternate" });
    const [selected] = await runtime.operatorSessionCandidates.resolve({ admission, ...snapshotContext(duplicateCatalog) });
    if (!selected) throw new Error("fixture candidate missing");
    await expect(runtime.operatorSessionCredentials.resolve({
      routeId: admission.routeId,
      accountId: "account-a", credentialId: "credential-a",
      ...snapshotContext(duplicateCatalog),
      lease: {
        leaseId: "lease-duplicate", runtimeInvocationId: "turn-duplicate", accountPolicyId: "codex-policy" as never,
        accountRef: selected.lease.candidate.account, route: selected.lease.candidate.route,
        capacityIdentity: selected.lease.capacityIdentity, credentialRevisionId: selected.lease.credentialRevisionId,
        state: "dispatch-fenced", selectionReason: "least-pressure", candidateRejections: [], dispatchFenceId: "turn-duplicate:dispatch",
      },
    })).resolves.toMatchObject({ credentialId: "credential-a" });
  });

  it("denies expired evidence before account listing or usage lookup", async () => {
    const codexPool = pool([codexExecution]);
    const expiredCatalog = defineExecutionCatalog({
      ...catalog,
      routes: catalog.routes.map((route) => ({ ...route, dataPolicyEvidence: dataPolicyEvidence("2026-08-01T00:00:00.000Z") })),
    });
    const runtime = new ConfiguredExecutionAccountRuntime({ catalog: expiredCatalog, codexPool, now: () => new Date("2026-08-15T00:00:00.000Z") });
    const admission = admitOperatorExecutionIntent(expiredCatalog, { routeId: "codex-route" });
    await expect(runtime.operatorSessionCandidates.resolve({ admission, ...snapshotContext(expiredCatalog) })).rejects.toThrow(/expired-evidence/u);
    expect(codexPool.listExecutionAccounts).not.toHaveBeenCalled();
    expect(codexPool.listUsage).not.toHaveBeenCalled();
  });

  it("denies before any credential pool lookup or credential resolution", async () => {
    const codexPool = pool([codexExecution]);
    const expiredCatalog = defineExecutionCatalog({
      ...catalog,
      routes: catalog.routes.map((route) => ({ ...route, dataPolicyEvidence: dataPolicyEvidence("2026-08-01T00:00:00.000Z") })),
    });
    const runtime = new ConfiguredExecutionAccountRuntime({
      catalog: expiredCatalog, codexPool, now: () => new Date("2026-08-15T00:00:00.000Z"),
    });
    await expect(runtime.operatorSessionCredentials.resolve({
      routeId: "codex-route",
      accountId: "account-a", credentialId: "credential-a",
      ...snapshotContext(expiredCatalog),
      lease: {
        leaseId: "lease-denied", runtimeInvocationId: "turn-denied", accountPolicyId: "codex-policy" as never,
        accountRef: "configured:synthetic" as never,
        route: { providerId: "codex-oauth", providerModelId: "gpt-test", scope: "operator-session" },
        capacityIdentity: "codex-capacity-a", credentialRevisionId: "synthetic", state: "dispatch-fenced",
        selectionReason: "least-pressure", candidateRejections: [], dispatchFenceId: "turn-denied:dispatch",
      },
    })).rejects.toThrow(/expired-evidence/u);
    expect(codexPool.listExecutionAccounts).not.toHaveBeenCalled();
    expect(codexPool.resolveExecutionCredential).not.toHaveBeenCalled();
  });

  it("projects canonical accounts into operator and Gateway candidate ports without resolving credentials", async () => {
    const codexPool = pool([codexExecution]);
    const runtime = new ConfiguredExecutionAccountRuntime({
      catalog,
      codexPool,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    const admission = admitOperatorExecutionIntent(catalog, { routeId: "codex-route" });

    const operator = await runtime.operatorSessionCandidates.resolve({ admission, ...snapshotContext(catalog) });
    expect(operator).toHaveLength(1);
    expect(operator[0]).toMatchObject({
      candidate: { accountId: "account-a", economicCost: { atoms: "1", unit: "request" } },
      lease: {
        candidate: {
          account: `configured:account-a:${codexExecution.fileIdentity}:${codexExecution.revision}`,
          route: { providerId: "codex-oauth", providerModelId: "gpt-test", scope: "operator-session" },
        },
        capacityIdentity: "codex-capacity-a",
        capacity: { maxConcurrency: 2, reservedAffinitySlots: 1 },
      },
    });
    const gateway = await runtime.modelGatewayCandidates.resolve({
      admission,
      route: { routeId: "codex-route", providerId: "codex-oauth", providerModelId: "gpt-test", scope: "virtual:overlay" },
    });
    expect(gateway[0]?.lease.candidate.route.scope).toBe("virtual:overlay");
    expect(codexPool.resolveExecutionCredential).not.toHaveBeenCalled();
  });

  it("resolves admitted candidates from the canonical route and rejects route drift", async () => {
    const runtime = new ConfiguredExecutionAccountRuntime({
      catalog,
      codexPool: pool([codexExecution]),
    });
    const admission = admitOperatorExecutionIntent(catalog, { routeId: "codex-route" });

    const candidates = await runtime.operatorSessionCandidates.resolve({ admission, ...snapshotContext(catalog) });
    expect(candidates[0]?.lease.accountEconomics?.capacityIdentity).toBe("codex-capacity-a");

    await expect(runtime.modelGatewayCandidates.resolve({
      admission,
      route: { routeId: "codex-route", providerId: "openai", providerModelId: "gpt-test", scope: "virtual:overlay" },
    })).rejects.toThrow(/does not match/u);
    await expect(runtime.modelGatewayCandidates.resolve({
      admission,
      route: { routeId: "other-route", providerId: "codex-oauth", providerModelId: "gpt-test", scope: "virtual:overlay" },
    })).rejects.toThrow(/does not match/u);
  });

  it("materializes a Gateway dispatcher only from a dispatch-fenced canonical credential", async () => {
    const codexPool = pool([codexExecution], [usageSnapshot("credential-a", "available")]);
    const runtime = new ConfiguredExecutionAccountRuntime({
      catalog,
      codexPool,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    const admission = admitOperatorExecutionIntent(catalog, { routeId: "codex-route" });
    const route = { routeId: "codex-route", providerId: "codex-oauth", providerModelId: "gpt-test", scope: "virtual:codex" };
    const candidates = await runtime.modelGatewayCandidates.resolve({ admission, route });
    const authority = new SqliteManagedAccountLeaseAuthority({
      path: ":memory:",
      participantKind: "model-gateway-ingress",
      recoveryDomain: `configured-dispatcher-${crypto.randomUUID()}`,
      configurationRevision: "test",
    });
    try {
      const acquired = authority.acquireAccountCapacity({
        runtimeInvocationId: "attempt",
        intentFingerprint: `sha256:${"a".repeat(64)}`,
        accountPolicyId: "codex-policy",
        route,
        candidates: candidates.map(({ lease }) => lease),
      });
      expect(acquired.status).toBe("acquired");
      if (acquired.status !== "acquired") throw new Error("fixture capacity was not acquired");
      await expect(runtime.modelGatewayDispatchers.resolve({
        identity: { tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn" },
        accountId: "account-a",
        routeId: "codex-route",
        route,
        lease: acquired.record,
      })).rejects.toThrow("durable dispatch fence identity");

      const fenced = authority.fenceAccountCapacityDispatch("attempt", "attempt:dispatch");
      await expect(runtime.modelGatewayDispatchers.resolve({
        identity: { tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn" },
        accountId: "account-a",
        routeId: "codex-route",
        route,
        lease: fenced,
      })).resolves.toMatchObject({ dispatchOneRound: expect.any(Function) });
      expect(codexPool.resolveExecutionCredential).toHaveBeenCalledOnce();
    } finally {
      authority.close();
    }
  });

  it("projects shared operator-session capacity into candidate admission evidence", async () => {
    const runtime = new ConfiguredExecutionAccountRuntime({
      catalog,
      codexPool: pool([codexExecution]),
      observeOperatorSessionCapacity: (candidates) => candidates.map(({ candidate, capacityIdentity }) => ({
        account: candidate.account,
        capacityIdentity,
        leaseCapacity: "unavailable" as const,
        reservedForNewWork: false,
      })),
    });
    const admission = admitOperatorExecutionIntent(catalog, { routeId: "codex-route" });

    await expect(runtime.operatorSessionCandidates.resolve({ admission, ...snapshotContext(catalog) })).resolves.toMatchObject([
      { candidate: { accountId: "account-a", capacity: "exhausted" } },
    ]);
  });

  it("returns only the canonical post-fence credential identity and rejects revision drift", async () => {
    const codexPool = pool([codexExecution]);
    const runtime = new ConfiguredExecutionAccountRuntime({ catalog, codexPool });
    const admission = admitOperatorExecutionIntent(catalog, { routeId: "codex-route" });
    const [selected] = await runtime.operatorSessionCandidates.resolve({ admission, ...snapshotContext(catalog) });
    if (!selected) throw new Error("fixture candidate missing");
    const lease = {
      leaseId: "lease-1",
      runtimeInvocationId: "turn-1",
      accountPolicyId: "codex-policy" as never,
      accountRef: selected.lease.candidate.account,
      route: selected.lease.candidate.route,
      capacityIdentity: selected.lease.capacityIdentity,
      credentialRevisionId: selected.lease.credentialRevisionId,
      state: "dispatch-fenced" as const,
      selectionReason: "least-pressure" as const,
      candidateRejections: [],
      dispatchFenceId: "turn-1:dispatch",
    };

    await expect(runtime.operatorSessionCredentials.resolve({
      routeId: "codex-route",
      accountId: "account-a",
      credentialId: "credential-a",
      ...snapshotContext(catalog),
      lease,
    })).resolves.toMatchObject({
      credential: { credentialId: "credential-a" },
      credentialId: "credential-a",
      credentialRevisionId: selected.lease.credentialRevisionId,
    });
    expect(codexPool.resolveExecutionCredential).toHaveBeenCalledTimes(1);

    await expect(runtime.resolveCommittedAccountBinding({
      capacityIdentity: selected.lease.capacityIdentity,
      accountRef: selected.lease.candidate.account,
      credentialRevisionId: selected.lease.credentialRevisionId,
    })).resolves.toEqual({
      accountId: "account-a",
      credentialId: "credential-a",
      credentialRevision: codexExecution.revision,
    });

    await expect(runtime.resolveCommittedAccountBinding({
      capacityIdentity: selected.lease.capacityIdentity,
      accountRef: selected.lease.candidate.account,
      credentialRevisionId: "f".repeat(64),
    })).rejects.toThrow(/revision/u);
  });

  it("projects authoritative quota against the canonical account economics", async () => {
    const runtime = new ConfiguredExecutionAccountRuntime({
      catalog,
      codexPool: pool([codexExecution], [{
        provider: "codex-oauth",
        credentialId: "credential-a",
        availability: "available",
        observedAt: "2026-08-11T11:59:00.000Z",
        validUntil: "2026-08-11T12:05:00.000Z",
        source: "provider-endpoint",
        confidence: "authoritative",
        primary: {
          bucketId: "primary",
          usedPercent: 37.5,
          windowDurationMinutes: 300,
          resetsAt: "2026-08-11T13:00:00.000Z",
        },
        exhaustionReason: null,
      }]),
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    const admission = admitOperatorExecutionIntent(catalog, { routeId: "codex-route" });
    const [candidate] = await runtime.operatorSessionCandidates.resolve({ admission, ...snapshotContext(catalog) });
    expect(candidate?.lease).toMatchObject({
      accountEconomics: { capacityIdentity: "codex-capacity-a" },
      quotaEvidence: {
        kind: "known",
        capacityIdentity: "codex-capacity-a",
        buckets: [{ remaining: { atoms: "625", scale: 1, unit: "percent" } }],
      },
    });
  });

  it("refreshes missing Codex quota before projecting automatic account candidates", async () => {
    const refreshedUsage = [usageSnapshot("credential-a", "exhausted"), usageSnapshot("credential-b", "available")];
    const codexPool = pool([
      codexExecution,
      { credentialId: "credential-b", fileIdentity: "c".repeat(64), revision: "d".repeat(64) },
    ], [], refreshedUsage);
    const runtime = new ConfiguredExecutionAccountRuntime({
      catalog,
      codexPool,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    const admission = admitOperatorExecutionIntent(catalog, { routeId: "codex-route" });

    const candidates = await runtime.operatorSessionCandidates.resolve({ admission, ...snapshotContext(catalog) });

    expect(codexPool.refreshUsageForCredentials).toHaveBeenCalledWith(["credential-a", "credential-b"]);
    expect(candidates.map(({ candidate }) => ({ accountId: candidate.accountId, quota: candidate.quota }))).toEqual([
      { accountId: "account-a", quota: "exhausted" },
      { accountId: "account-b", quota: "available" },
    ]);
  });

  it("fails closed when Codex quota remains unknown after refresh", async () => {
    const unknownUsage = [{
      ...usageSnapshot("credential-a", "available"),
      availability: "unknown" as const,
      source: "provider-request-failed" as const,
      confidence: "unknown" as const,
    }];
    const runtime = new ConfiguredExecutionAccountRuntime({
      catalog,
      codexPool: pool([codexExecution], [], unknownUsage),
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    const admission = admitOperatorExecutionIntent(catalog, { routeId: "codex-route" });

    await expect(runtime.operatorSessionCandidates.resolve({ admission, ...snapshotContext(catalog) })).resolves.toMatchObject([
      { candidate: { accountId: "account-a", health: "unhealthy", quota: "unknown" } },
    ]);
  });
});

function pool(
  accounts: readonly typeof codexExecution[],
  usage: readonly Record<string, unknown>[] = [],
  refreshedUsage: readonly Record<string, unknown>[] = usage,
) {
  return {
    listExecutionAccounts: vi.fn(async () => accounts),
    listUsage: vi.fn(async () => usage),
    refreshUsageForCredentials: vi.fn(async () => refreshedUsage),
    resolveExecutionCredential: vi.fn(async (selected: typeof codexExecution) => ({
      credentialId: selected.credentialId,
      accessToken: "synthetic-access-token",
      chatgptAccountId: "synthetic-account",
    })),
    recordProviderOutcome: vi.fn(async () => undefined),
  };
}

function usageSnapshot(credentialId: string, availability: "available" | "exhausted") {
  return {
    provider: "codex-oauth",
    credentialId,
    availability,
    observedAt: "2026-08-11T11:59:00.000Z",
    validUntil: "2026-08-11T12:05:00.000Z",
    source: "provider-endpoint",
    confidence: "authoritative",
    exhaustionReason: availability === "exhausted" ? "primary-window" : null,
  } as const;
}

function accountEconomics(capacityIdentity: string) {
  return {
    capacityIdentity,
    subscriptionClass: "subscription" as const,
    quotaClassId: "codex-five-hour-window",
    creditPosture: "committed" as const,
    overagePosture: "disabled" as const,
  };
}

function routeEconomics() {
  return {
    adapterCapabilityId: "text",
    adapterCapabilityVersion: "1",
    authBillingChannel: "oauth",
    executionMode: "direct",
    serviceTier: "default",
    rateCardBasis: "subscription",
    envelopeSemantics: "turn",
    fallbackPosture: "disabled" as const,
    overagePosture: "disabled" as const,
    contextClass: "default",
    cacheClass: "none",
    priceEvidence: {
      kind: "subscription" as const,
      rateCardId: "codex",
      rateCardRevision: "1",
      evidence: {
        sourceIdentity: "test-source",
        sourceRevision: "1",
        sourceDigest: `sha256:${"a".repeat(64)}`,
        observedAt: "2026-08-01T00:00:00.000Z",
        validUntil: "2026-09-01T00:00:00.000Z",
        confidence: "high" as const,
        authority: "configured" as const,
      },
    },
    auxiliaryCharges: [],
    executionEnvelope: {
      limits: [{ atoms: "1", scale: 0, unit: "request", scheme: { kind: "unit" as const } }],
    },
  };
}
