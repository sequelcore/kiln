import { describe, expect, it } from "vitest";
import type { ModelCatalogEntry } from "@kilnai/gateway-contracts";
import { completeExecutionTargetDraft, startExecutionTargetDraft } from "../../src/application/execution-target-draft.js";

const discovery: ModelCatalogEntry = {
  providerId: "codex-oauth",
  providerRouteId: "codex-oauth:direct",
  providerModelId: "codex/gpt-fixture",
  access: "subscription",
  family: "gpt-fixture",
  discovery: "observed",
  eligibility: "eligible",
  availability: "available",
  provenance: [],
  targets: [],
};

describe("execution target draft", () => {
  it("starts from the exact discovery identity and stays incomplete without material choices", () => {
    expect(startExecutionTargetDraft(discovery)).toEqual({
      status: "incomplete",
      discoveryIdentity: {
        providerId: "codex-oauth",
        providerRouteId: "codex-oauth:direct",
        providerModelId: "codex/gpt-fixture",
      },
      missingFields: ["targetId", "label", "accountPolicyId", "dataClassification", "dataPolicyEvidence", "economics"],
    });
  });

  it("rejects stale/ineligible discovery and secret-like draft material", () => {
    expect(() => startExecutionTargetDraft({ ...discovery, discovery: "stale" })).toThrow(/observed/u);
    expect(() => completeExecutionTargetDraft({
      draft: startExecutionTargetDraft(discovery),
      material: { ...material(), apiKey: "not-allowed" } as never,
      discoveryEvidence: managedDiscoveryEvidence(),
      catalog: catalog(),
    })).toThrow(/secret or credential/u);
  });

  it("admits a complete draft through the canonical execution catalog validator", () => {
    const complete = completeExecutionTargetDraft({
      draft: startExecutionTargetDraft(discovery),
      material: material(),
      discoveryEvidence: managedDiscoveryEvidence(),
      catalog: catalog(),
    });
    expect(complete.status).toBe("complete");
    expect(complete.target).toMatchObject({
      id: "fixture-target",
      providerId: discovery.providerId,
      providerModelId: discovery.providerModelId,
    });
  });

  it("rejects duplicate target ids through the same canonical catalog validator", () => {
    const existing = catalog();
    expect(() => completeExecutionTargetDraft({
      draft: startExecutionTargetDraft(discovery),
      material: material(),
      discoveryEvidence: managedDiscoveryEvidence(),
      catalog: {
        ...existing,
        targets: [{
          ...material(),
          id: "fixture-target",
          providerId: discovery.providerId,
          providerModelId: discovery.providerModelId,
          label: "Existing target",
        }],
      },
    })).toThrow(/unique canonical id/u);
  });
});

const accountEconomics = { capacityIdentity: "fixture", subscriptionClass: "subscription" as const, quotaClassId: "fixture", creditPosture: "disabled" as const, overagePosture: "disabled" as const };
const economics = { adapterCapabilityId: "fixture", adapterCapabilityVersion: "v1", authBillingChannel: "oauth", executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled" as const, overagePosture: "disabled" as const, contextClass: "standard", cacheClass: "provider", priceEvidence: { kind: "subscription" as const, rateCardId: "fixture", rateCardRevision: "v1", evidence: { sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", confidence: "high" as const, authority: "configured" as const } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } };
const policy = { providerId: discovery.providerId, providerModelId: discovery.providerModelId, dataUse: "not-used" as const, trainingPosture: "prohibited" as const, retention: { posture: "zero" as const, days: 0 }, permittedMaximumClassification: "confidential" as const, permittedClassifications: ["public", "internal", "confidential"] as const, sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"b".repeat(64)}` as const, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" };
function catalog() { return { accounts: [{ id: "account", providerId: discovery.providerId, credentialId: "opaque-ref", maxConcurrency: 1, reservedAffinitySlots: 0, economics: accountEconomics }], accountPolicies: [{ id: "fixture-policy", accountIds: ["account"], strategy: "economic-least-pressure" as const }], targets: [] }; }
function material() { return { targetId: "fixture-target", label: "Fixture target", accountPolicyId: "fixture-policy", dataClassification: "confidential" as const, dataPolicyEvidence: policy, economics }; }
function managedDiscoveryEvidence() { return { evidenceIdentity: "runtime-provider-catalog:fixture", evidenceRevision: `sha256:${"d".repeat(64)}` as const, observedAt: "2026-08-20T00:00:00.000Z", expiresAt: "2027-08-20T00:00:00.000Z" }; }
