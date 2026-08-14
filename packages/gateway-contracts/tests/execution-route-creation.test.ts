import { describe, expect, it } from "vitest";
import { ExecutionRouteCreationRequestSchema } from "../src/execution-route-creation.js";

const request = { requestId: "request", expectedRevision: `sha256:${"a".repeat(64)}`, discoveryIdentity: { providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model" }, material: { routeId: "route", label: "Route", accountSelection: { mode: "exact", accountId: "account" }, dataClassification: "public", dataPolicyEvidence: { providerId: "provider", providerModelId: "model", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "public", permittedClassifications: ["public"], sourceIdentity: "source", sourceRevision: "v1", sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }, economics: { adapterCapabilityId: "adapter", adapterCapabilityVersion: "v1", authBillingChannel: "oauth", executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled", overagePosture: "disabled", contextClass: "standard", cacheClass: "provider", priceEvidence: { kind: "subscription", rateCardId: "rate", rateCardRevision: "v1", evidence: { sourceIdentity: "source", sourceRevision: "v1", sourceDigest: `sha256:${"c".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", confidence: "high", authority: "configured" } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } } } } as const;
describe("ExecutionRouteCreationRequestSchema", () => {
  it("rejects unknown and secret-like material", () => {
    expect(ExecutionRouteCreationRequestSchema.parse(request)).toEqual(request);
    expect(() => ExecutionRouteCreationRequestSchema.parse({ ...request, secret: "x" })).toThrow();
    expect(() => ExecutionRouteCreationRequestSchema.parse({ ...request, material: { ...request.material, apiKey: "x" } })).toThrow();
    expect(() => ExecutionRouteCreationRequestSchema.parse({ ...request, material: { ...request.material, dataPolicyEvidence: { ...request.material.dataPolicyEvidence, retention: { posture: "zero", days: 1 } } } })).toThrow();
  });

  it("requires a concrete configuration revision", () => {
    expect(() => ExecutionRouteCreationRequestSchema.parse({ ...request, expectedRevision: "absent" })).toThrow();
  });
});
