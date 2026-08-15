import { defineExecutionCatalog } from "@kilnai/core";
import { describe, expect, it } from "vitest";
import { admitManagedDirectTarget } from "./managed-direct-target-admission.js";
import type { ResolvedManagedTargetConfig } from "./resolved-managed-target.js";

const amount = {
  atoms: "1",
  scale: 0,
  unit: "request",
  scheme: { kind: "currency" as const, currency: "USD" },
};
const evidence = {
  sourceIdentity: "fixture",
  sourceRevision: "v1",
  sourceDigest: `sha256:${"a".repeat(64)}`,
  observedAt: "2026-01-01T00:00:00.000Z",
  validUntil: "2026-12-31T00:00:00.000Z",
  confidence: "high" as const,
  authority: "configured" as const,
};
const catalog = defineExecutionCatalog({
  accounts: [{
    id: "account-a",
    providerId: "codex-oauth",
    credentialId: "credential-a",
    maxConcurrency: 1,
    reservedAffinitySlots: 0,
    economics: {
      capacityIdentity: "capacity-a",
      subscriptionClass: "subscription",
      quotaClassId: "quota-a",
      creditPosture: "disabled",
      overagePosture: "disabled",
    },
  }],
  accountPolicies: [{ id: "codex-automatic", accountIds: ["account-a"], strategy: "economic-least-pressure" }],
  routes: [{
    id: "terra",
    label: "Terra",
    providerId: "codex-oauth",
    providerModelId: "gpt-5.6-terra",
    dataClassification: "internal",
    dataPolicyEvidence: { providerId: "codex-oauth", providerModelId: "gpt-5.6-terra", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-08-31T00:00:00.000Z" },
    accountSelection: { mode: "automatic", accountPolicyId: "codex-automatic" },
    economics: {
      adapterCapabilityId: "adapter",
      adapterCapabilityVersion: "v1",
      authBillingChannel: "subscription",
      executionMode: "managed",
      serviceTier: "standard",
      rateCardBasis: "request",
      envelopeSemantics: "bounded",
      fallbackPosture: "disabled",
      overagePosture: "disabled",
      contextClass: "default",
      cacheClass: "none",
      priceEvidence: { kind: "subscription", rateCardId: "rate", rateCardRevision: "v1", evidence },
      auxiliaryCharges: [],
      executionEnvelope: { limits: [amount] },
    },
  }],
});

function directTarget(id: string): Extract<ResolvedManagedTargetConfig, { readonly kind: "direct" }> {
  return {
    id,
    kind: "direct",
    profiles: ["foundation-readonly-plan"],
    authorityProfiles: [],
  };
}

describe("managed direct target admission", () => {
  it("admits one canonical target identity without translating through an alias", () => {
    const target = directTarget("terra");
    const admitted = admitManagedDirectTarget(catalog, target);

    expect(admitted.target).toBe(target);
    expect(admitted.executionRoute.id).toBe("terra");
    expect(admitted.admission).toMatchObject({
      routeId: "terra",
      providerId: "codex-oauth",
      providerModelId: "gpt-5.6-terra",
      accountSelection: { mode: "automatic", accountPolicyId: "codex-automatic" },
    });
  });

  it("fails closed when the canonical target catalog is absent or does not contain the target", () => {
    expect(() => admitManagedDirectTarget(undefined, directTarget("terra"))).toThrow(/target catalog/u);
    expect(() => admitManagedDirectTarget(catalog, directTarget("missing"))).toThrow(/unavailable/u);
  });

  it("does not expose managed-route alias vocabulary", () => {
    const admitted = admitManagedDirectTarget(catalog, directTarget("terra"));

    expect(admitted.target).not.toHaveProperty("executionRouteId");
    expect(admitted).not.toHaveProperty("projection");
    expect(JSON.stringify(admitted)).not.toContain("managed-terra");
  });
});
