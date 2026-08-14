import { describe, expect, it, vi } from "vitest";
import { createCurrentExecutionRoute } from "../../src/application/current-execution-route-creation.js";

describe("createCurrentExecutionRoute", () => {
  it("rejects discovery drift immediately before mutation", async () => {
    const mutate = vi.fn();
    await expect(createCurrentExecutionRoute({
      request: request(), admittedEvidence: { entry: entry(), catalogObservedAt: "2026-08-13T18:00:00.000Z" },
      resolveCurrentEvidence: async () => ({ catalog: { observedAt: "2026-08-13T18:01:00.000Z", entries: [{ ...entry(), eligibilityState: "ineligible" as const }] }, executionCatalog: catalog(), revision: request().expectedRevision }),
      mutateGlobalConfig: mutate, refreshExecutionRoutes: async () => undefined,
    })).rejects.toThrow(/changed/u);
    expect(mutate).not.toHaveBeenCalled();
  });
});

function entry() { return { providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model", discoveryState: "observed" as const, eligibilityState: "eligible" as const, availabilityState: "available" as const, configuredState: "unconfigured" as const, configuredRouteRefs: [], reasonCodes: ["discovery-observed" as const] }; }
function catalog() { return { accounts: [{ id: "account", providerId: "provider", credentialId: "opaque", maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: "fixture", subscriptionClass: "subscription" as const, quotaClassId: "fixture", creditPosture: "disabled" as const, overagePosture: "disabled" as const } }], accountPolicies: [], routes: [] }; }
function request() { const evidence = { sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", confidence: "high" as const, authority: "configured" as const }; return { requestId: "request", expectedRevision: `sha256:${"c".repeat(64)}`, discoveryIdentity: { providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model" }, material: { routeId: "route", label: "Route", accountSelection: { mode: "exact" as const, accountId: "account" }, dataClassification: "public" as const, dataPolicyEvidence: { providerId: "provider", providerModelId: "model", dataUse: "not-used" as const, trainingPosture: "prohibited" as const, retention: { posture: "zero" as const, days: 0 }, permittedMaximumClassification: "public" as const, permittedClassifications: ["public"] as const, sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"b".repeat(64)}` as const, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }, economics: { adapterCapabilityId: "fixture", adapterCapabilityVersion: "v1", authBillingChannel: "fixture", executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled" as const, overagePosture: "disabled" as const, contextClass: "standard", cacheClass: "provider", priceEvidence: { kind: "subscription" as const, rateCardId: "fixture", rateCardRevision: "v1", evidence }, auxiliaryCharges: [], executionEnvelope: { limits: [] } } } }; }
