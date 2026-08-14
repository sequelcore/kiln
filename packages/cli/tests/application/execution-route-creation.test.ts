import { describe, expect, it, vi } from "vitest";
import { createExecutionRoute } from "../../src/application/execution-route-creation.js";

describe("createExecutionRoute", () => {
  it("commits with expected revision and refreshes only after success", async () => {
    const order: string[] = [];
    const mutate = vi.fn((mutation, options) => {
      order.push("mutate");
      expect(options).toEqual({ expectedRevision: "sha256:expected" });
      const config = mutation({ version: "2", executionCatalog: { accounts: [account()], accountPolicies: [], routes: [] } });
      return { config, previousRevision: "sha256:expected", revision: "sha256:next" };
    });
    const refresh = vi.fn(async () => { order.push("refresh"); });
    const result = await createExecutionRoute({ draft: completeDraft(), expectedRevision: "sha256:expected", mutateGlobalConfig: mutate, refreshExecutionRoutes: refresh });
    expect(order).toEqual(["mutate", "refresh"]);
    expect(result.status).toBe("created");
  });

  it("reports a committed revision when only the post-commit refresh fails", async () => {
    const result = await createExecutionRoute({
      draft: completeDraft(), expectedRevision: "sha256:expected",
      mutateGlobalConfig: (mutation) => ({ config: mutation({ version: "2", executionCatalog: { accounts: [account()], accountPolicies: [], routes: [] } }), previousRevision: "sha256:expected", revision: "sha256:committed" }),
      refreshExecutionRoutes: async () => { throw new Error("refresh failed"); },
    });
    expect(result).toMatchObject({ status: "committed-refresh-failed", revision: "sha256:committed" });
  });

  it.each(["revision drift", "invalid current config"])("does not refresh or partially apply when mutation rejects %s", async (message) => {
    const refresh = vi.fn();
    await expect(createExecutionRoute({
      draft: completeDraft(),
      expectedRevision: "sha256:expected",
      mutateGlobalConfig: () => { throw new Error(message); },
      refreshExecutionRoutes: refresh,
    })).rejects.toThrow(message);
    expect(refresh).not.toHaveBeenCalled();
  });
});

function completeDraft() {
  return {
    status: "complete" as const,
    discoveryIdentity: { providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model" },
    route: {
      id: "route",
      label: "Route",
      providerId: "provider",
      providerModelId: "model",
      accountSelection: { mode: "exact" as const, accountId: "account" },
      dataClassification: "public" as const,
      dataPolicyEvidence: dataPolicyEvidence(),
      economics: routeEconomics(),
    },
  };
}

function account() {
  return { id: "account", providerId: "provider", credentialId: "opaque-ref", maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: "fixture", subscriptionClass: "subscription" as const, quotaClassId: "fixture", creditPosture: "disabled" as const, overagePosture: "disabled" as const } };
}

function routeEconomics() {
  return { adapterCapabilityId: "fixture", adapterCapabilityVersion: "v1", authBillingChannel: "fixture", executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled" as const, overagePosture: "disabled" as const, contextClass: "standard", cacheClass: "provider", priceEvidence: { kind: "subscription" as const, rateCardId: "fixture", rateCardRevision: "v1", evidence: { sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", confidence: "high" as const, authority: "configured" as const } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } };
}

function dataPolicyEvidence() {
  return { providerId: "provider", providerModelId: "model", dataUse: "not-used" as const, trainingPosture: "prohibited" as const, retention: { posture: "zero" as const, days: 0 }, permittedMaximumClassification: "public" as const, permittedClassifications: ["public"] as const, sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"b".repeat(64)}` as const, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" };
}
