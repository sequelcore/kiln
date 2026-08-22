import { describe, expect, it, vi } from "vitest";
import { defineExecutionCatalog, createExecutionAccountPolicyId, createExecutionAccountRef, type ProviderAdapter } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import type { AccountCapacityRecord, ExecutionAccountCapacityAuthority } from "../../src/execution-kernel/execution-account-capacity-authority.js";
import { FixedRouteGatewayAuthorityAdmission } from "../../src/gateway/gateway-authority-admission.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";

const catalog = defineExecutionCatalog({
  accounts: [{ id: "account-1", providerId: "provider-1", credentialId: "credential-1", maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: "capacity-1", subscriptionClass: "subscription", quotaClassId: "quota-1", creditPosture: "disabled", overagePosture: "disabled" } }],
  accountPolicies: [{ id: "policy-1", accountIds: ["account-1"], strategy: "economic-least-pressure" }],
  routes: [{
    id: "route-1", label: "Gateway", providerId: "provider-1", providerModelId: "model-1", dataClassification: "internal",
    dataPolicyEvidence: { providerId: "provider-1", providerModelId: "model-1", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture", sourceRevision: "r1", sourceDigest: `sha256:${"c".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-08-01T00:00:00.000Z" },
    accountSelection: { mode: "automatic", accountPolicyId: "policy-1" },
    economics: { adapterCapabilityId: "provider-1", adapterCapabilityVersion: "1", authBillingChannel: "api-key", executionMode: "direct", serviceTier: "default", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled", overagePosture: "disabled", contextClass: "default", cacheClass: "none", priceEvidence: { kind: "subscription", rateCardId: "fixture", rateCardRevision: "r1", evidence: { sourceIdentity: "fixture", sourceRevision: "r1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", validUntil: "2027-08-01T00:00:00.000Z", confidence: "high", authority: "configured" } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } },
  }],
});

function capacityRecord(state: AccountCapacityRecord["state"]): AccountCapacityRecord {
  return { leaseId: "lease-1", runtimeInvocationId: "ingress-1", accountPolicyId: createExecutionAccountPolicyId("policy-1"), accountRef: createExecutionAccountRef("configured:account-1"), route: { providerId: "provider-1", providerModelId: "model-1", scope: "operator-session" }, capacityIdentity: "capacity-1", credentialRevisionId: "b".repeat(64), state, selectionReason: "least-pressure", candidateRejections: [], ...(state === "held" ? {} : { dispatchFenceId: "ingress-1:dispatch" }) };
}

async function fixture(overrides: { readonly persistBundle?: (bundle: unknown) => void | Promise<void>; readonly duplicateRoute?: boolean } = {}) {
  const sessionRegistry = new SessionRegistry();
  const session = new RuntimeSession({ appName: "app-1", tenantId: "tenant-1", userId: "user-1", systemPrompt: "", sessionId: "session-1" });
  await sessionRegistry.save(session);
  const provider: ProviderAdapter = { name: "provider-1", createMessage: vi.fn(), streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"] };
  const capacity: ExecutionAccountCapacityAuthority = {
    acquireAccountCapacity: vi.fn(() => ({ status: "acquired", record: capacityRecord("held"), replay: false })),
    releaseAccountCapacityPreFence: vi.fn(() => capacityRecord("held")),
    fenceAccountCapacityDispatch: vi.fn(() => capacityRecord("dispatch-fenced")),
    settleAccountCapacity: vi.fn(() => capacityRecord("released")),
  };
  const persist = vi.fn(overrides.persistBundle ?? (() => undefined));
  const routes = overrides.duplicateRoute ? [...catalog.routes, { ...catalog.routes[0]!, id: "route-duplicate" }] : catalog.routes;
  const admission = new FixedRouteGatewayAuthorityAdmission({
    appName: "app-1", routeId: "route-1", snapshot: { catalog: { ...catalog, routes }, configurationRevision: { revisionSetId: "gateway-r1", revisions: { global: "global-r1" } } }, sessionRegistry,
    candidates: { resolve: vi.fn(async () => [{ candidate: { accountId: "account-1", safety: "eligible", health: "healthy", quota: "available", capacity: "available", economicCost: { atoms: "0", scale: 0, unit: "request", scheme: { kind: "currency", currency: "USD" } }, pressure: 0 }, lease: { candidate: { account: createExecutionAccountRef("configured:account-1"), route: { providerId: "provider-1", providerModelId: "model-1", scope: "operator-session" }, health: "healthy", leaseCapacity: "available", pressure: 0, reservedForNewWork: false }, capacityIdentity: "capacity-1", credentialRevisionId: "b".repeat(64), usageEvidence: { health: "healthy", freshness: "fresh", availability: "available" }, capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 } } }]) },
    accountCapacityAuthority: capacity,
    credentials: { resolve: vi.fn(async () => ({ credential: { token: "secret" }, credentialId: "credential-1", credentialRevisionId: "b".repeat(64) })) },
    evidenceStore: { persist, loadSessionFacet: vi.fn(() => undefined) },
    persistOperatorAdoptionDecision: vi.fn(async () => undefined), createProvider: vi.fn(() => provider), now: () => new Date("2026-08-22T18:00:00.000Z"),
  });
  return { admission, capacity, persist, provider };
}

const request = { ingressId: "ingress-1", appName: "app-1", tenantId: "tenant-1", userId: "user-1", sessionId: "session-1", channel: "api", userParts: textParts("hello") } as const;

describe("FixedRouteGatewayAuthorityAdmission", () => {
  it("persists one complete bundle and keeps productive dispatch inside the account fence", async () => {
    const { admission, capacity, persist, provider } = await fixture();
    const dispatch = vi.fn(async (commit) => {
      expect(commit.bundle.admissionId).toMatch(/^sha256:/u);
      expect(commit.bundle.turn.execution).toMatchObject({ status: "routed", route: { routeId: "route-1" } });
      expect(commit.bundle.turn.tools.allowedToolPermissions).toEqual([]);
      expect(commit.bundle.turn.effectCeiling).toEqual({
        operation: "mutate",
        boundaries: ["workspace", "network"],
        reversibility: "irreversible",
        dataEgress: "sensitive-data",
        identityUse: "authenticated",
        consequences: ["local-state"],
        idempotency: "non-idempotent",
      });
      expect(commit.perCallConfig.turnId).toBe(commit.bundle.turnId);
      expect(commit.perCallConfig.admittedExecutionRoute?.routeId).toBe("route-1");
      expect(commit.provider).toBe(provider);
      expect(capacity.fenceAccountCapacityDispatch).toHaveBeenCalledOnce();
      expect(capacity.settleAccountCapacity).not.toHaveBeenCalled();
      return "done";
    });
    await expect(admission.execute(request, dispatch)).resolves.toBe("done");
    expect(persist).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(capacity.settleAccountCapacity).toHaveBeenCalledOnce();
  });

  it("records external messaging as an authenticated external-state effect", async () => {
    const { admission } = await fixture();
    await admission.execute({ ...request, channel: "whatsapp" }, async (commit) => {
      expect(commit.bundle.turn.effectCeiling.boundaries).toEqual(["workspace", "network", "external-system"]);
      expect(commit.bundle.turn.effectCeiling.consequences).toEqual(["local-state", "external-state"]);
      return undefined;
    });
  });

  it("records the ingress authority request without allowing it to widen admitted authority", async () => {
    const { admission, persist } = await fixture();

    await admission.execute({ ...request, requestedAuthority: "destructive" }, async (commit) => {
      expect(commit.bundle.turn.authority).toMatchObject({
        requestedAuthority: "destructive",
        admittedAuthority: "fail_closed",
      });
      return undefined;
    });

    expect(persist).toHaveBeenCalledOnce();
  });

  it("fails closed before provider creation or dispatch when bundle persistence fails", async () => {
    const { admission, provider } = await fixture({ persistBundle: () => { throw new Error("evidence unavailable"); } });
    const dispatch = vi.fn(async () => "unreachable");
    await expect(admission.execute(request, dispatch)).rejects.toThrow(/evidence unavailable/iu);
    expect(dispatch).not.toHaveBeenCalled();
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("rejects a request for a different exact logical session", async () => {
    const { admission } = await fixture();
    await expect(admission.execute({ ...request, sessionId: "other-session" }, async () => "unreachable")).rejects.toThrow(/exact Runtime session/iu);
  });

  it("rejects ambiguous provider/model routes at composition time", async () => {
    await expect(fixture({ duplicateRoute: true })).rejects.toThrow(/exactly one canonical route/iu);
  });
});
