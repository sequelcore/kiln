import { describe, expect, it } from "vitest";
import { projectAvailableModelCatalog } from "../../src/gateway/available-model-catalog-projector.js";

describe("projectAvailableModelCatalog", () => {
  it("joins configured route identities deterministically while retaining unknown, stale, and ineligible observations", () => {
    const catalog = projectAvailableModelCatalog({
      discovery: {
        catalogEvidence: {
          status: "partial",
          source: { kind: "runtime-provider-catalog", id: "fixture" },
          observedAt: "2026-08-13T18:00:00.000Z",
          counts: { total: 3, returned: 3, omitted: 0 },
        },
        entries: [
          entry("unknown-provider", "model-z", "stale", false, ["stale-evidence"]),
          entry("provider-a", "model-b", "fresh", false, ["policy-denied"]),
          entry("provider-a", "model-a", "fresh", true, []),
        ],
      },
      configuredRoutes: [
        { routeId: "route-b", label: "B", providerId: "provider-a", providerModelId: "model-a" },
        { routeId: "route-a", label: "A", providerId: "provider-a", providerModelId: "model-a" },
      ],
    });

    expect(catalog.entries.map((item) => `${item.providerId}/${item.providerModelId}`)).toEqual([
      "provider-a/model-a",
      "provider-a/model-b",
      "unknown-provider/model-z",
    ]);
    expect(catalog.entries[0]).toMatchObject({
      configuredState: "configured",
      configuredRouteRefs: [{ routeId: "route-a" }, { routeId: "route-b" }],
      availabilityState: "available",
      eligibilityState: "eligible",
    });
    expect(catalog.entries[1]).toMatchObject({
      configuredState: "unconfigured",
      eligibilityState: "ineligible",
      reasonCodes: expect.arrayContaining(["policy-ineligible", "route-not-configured"]),
    });
    expect(catalog.entries[2]).toMatchObject({
      discoveryState: "stale",
      availabilityState: "unknown",
      eligibilityState: "ineligible",
      reasonCodes: expect.arrayContaining(["discovery-stale", "route-not-configured"]),
    });
  });
});

function entry(providerId: string, providerModelId: string, freshness: "fresh" | "stale", eligible: boolean, reasonCodes: string[]) {
  return {
    normalizedModel: { family: providerModelId },
    providerRoute: { providerId, providerModelId, scope: `${providerId}:direct` },
    rawEvidence: { rawId: providerModelId, provenance: "synthetic-fixture" },
    credentialEvidence: { state: "not-required" as const, source: "fixture" },
    entitlementEvidence: { state: "not-required" as const, source: "fixture" },
    freshness: { status: freshness, observedAt: "2026-08-13T18:00:00.000Z" },
    routeHealth: { status: freshness === "fresh" ? "healthy" as const : "unknown" as const },
    policyAdmission: { use: "interactive" as const, status: eligible ? "admitted" as const : "denied" as const },
    eligibility: { eligible, reasonCodes },
  };
}
