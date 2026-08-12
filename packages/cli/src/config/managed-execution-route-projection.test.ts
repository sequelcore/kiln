import { describe, expect, it } from "vitest";
import { defineExecutionCatalog } from "@kilnai/core";
import { admitManagedDirectExecutionRoute } from "./managed-execution-route-projection.js";

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

describe("managed execution route projection", () => {
  it("admits direct managed identity from the canonical execution catalog", () => {
    const projection = admitManagedDirectExecutionRoute(catalog, {
      id: "managed-terra",
      kind: "direct",
      executionRouteId: "terra",
    });

    expect(projection.admission).toMatchObject({
      routeId: "terra",
      providerId: "codex-oauth",
      providerModelId: "gpt-5.6-terra",
      accountSelection: { mode: "automatic", accountPolicyId: "codex-automatic" },
    });
  });

  it("fails closed when direct route authority is absent or stale", () => {
    const route = { id: "managed-terra", kind: "direct" as const, executionRouteId: "terra" };
    expect(() => admitManagedDirectExecutionRoute(undefined, route)).toThrow(/executionCatalog/u);
    expect(() => admitManagedDirectExecutionRoute(catalog, { ...route, executionRouteId: "missing" })).toThrow(/unavailable/u);
  });
});
