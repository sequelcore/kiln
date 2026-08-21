import { describe, expect, it } from "vitest";
import type { AvailableModelCatalogEntry } from "@kilnai/gateway-contracts";
import { completeExecutionRouteDraft, startExecutionRouteDraft } from "../../src/application/execution-route-draft.js";

const discovery: AvailableModelCatalogEntry = {
  providerId: "codex-oauth",
  providerRouteId: "codex-oauth:direct",
  providerModelId: "codex/gpt-fixture",
  discoveryState: "observed",
  eligibilityState: "eligible",
  availabilityState: "available",
  configuredState: "unconfigured",
  configuredRouteRefs: [],
  reasonCodes: ["discovery-observed", "model-eligible", "model-available", "route-not-configured"],
};

describe("execution target draft", () => {
  it("starts from the exact discovery identity and stays incomplete without material choices", () => {
    expect(startExecutionRouteDraft(discovery)).toEqual({
      status: "incomplete",
      discoveryIdentity: {
        providerId: "codex-oauth",
        providerRouteId: "codex-oauth:direct",
        providerModelId: "codex/gpt-fixture",
      },
      missingFields: ["routeId", "label", "accountSelection", "dataClassification", "dataPolicyEvidence", "economics"],
    });
  });

  it("rejects stale/ineligible discovery and secret-like draft material", () => {
    expect(() => startExecutionRouteDraft({ ...discovery, discoveryState: "stale" })).toThrow(/observed/u);
    expect(() => completeExecutionRouteDraft({
      draft: startExecutionRouteDraft(discovery),
      material: { ...material(), apiKey: "not-allowed" } as never,
      discoveryEvidence: managedDiscoveryEvidence(),
      catalog: catalog(),
    })).toThrow(/secret or credential/u);
  });

  it("admits a complete draft through the canonical execution catalog validator", () => {
    const complete = completeExecutionRouteDraft({
      draft: startExecutionRouteDraft(discovery),
      material: material(),
      discoveryEvidence: managedDiscoveryEvidence(),
      catalog: catalog(),
    });
    expect(complete.status).toBe("complete");
    expect(complete.route).toMatchObject({
      id: "fixture-route",
      providerId: discovery.providerId,
      providerModelId: discovery.providerModelId,
    });
  });

  it("rejects duplicate route ids through the same canonical catalog validator", () => {
    const existing = catalog();
    expect(() => completeExecutionRouteDraft({
      draft: startExecutionRouteDraft(discovery),
      material: material(),
      discoveryEvidence: managedDiscoveryEvidence(),
      catalog: {
        ...existing,
        routes: [{
          ...material(),
          id: "fixture-route",
          providerId: discovery.providerId,
          providerModelId: discovery.providerModelId,
          label: "Existing route",
        }],
      },
    })).toThrow(/unique canonical id/u);
  });
});

const accountEconomics = { capacityIdentity: "fixture", subscriptionClass: "subscription" as const, quotaClassId: "fixture", creditPosture: "disabled" as const, overagePosture: "disabled" as const };
const economics = { adapterCapabilityId: "fixture", adapterCapabilityVersion: "v1", authBillingChannel: "oauth", executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled" as const, overagePosture: "disabled" as const, contextClass: "standard", cacheClass: "provider", priceEvidence: { kind: "subscription" as const, rateCardId: "fixture", rateCardRevision: "v1", evidence: { sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", confidence: "high" as const, authority: "configured" as const } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } };
const policy = { providerId: discovery.providerId, providerModelId: discovery.providerModelId, dataUse: "not-used" as const, trainingPosture: "prohibited" as const, retention: { posture: "zero" as const, days: 0 }, permittedMaximumClassification: "confidential" as const, permittedClassifications: ["public", "internal", "confidential"] as const, sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"b".repeat(64)}` as const, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" };
function catalog() { return { accounts: [{ id: "account", providerId: discovery.providerId, credentialId: "opaque-ref", maxConcurrency: 1, reservedAffinitySlots: 0, economics: accountEconomics }], accountPolicies: [], routes: [] }; }
function material() { return { routeId: "fixture-route", label: "Fixture route", accountSelection: { mode: "exact" as const, accountId: "account" }, dataClassification: "confidential" as const, dataPolicyEvidence: policy, economics }; }
function managedDiscoveryEvidence() { return { evidenceIdentity: "runtime-provider-catalog:fixture", evidenceRevision: `sha256:${"d".repeat(64)}` as const, observedAt: "2026-08-20T00:00:00.000Z", expiresAt: "2027-08-20T00:00:00.000Z" }; }
