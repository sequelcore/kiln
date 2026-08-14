import { describe, expect, it, vi } from "vitest";
import { runRouteCreateCommand } from "../../src/application/route-create-command.js";

describe("runRouteCreateCommand", () => {
  it.each(["{", JSON.stringify({ requestId: "request", token: "secret" })])("rejects malformed or secret-bearing input before authority", async (source) => {
    const create = vi.fn();
    await expect(runRouteCreateCommand({ source, preview: false, create })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["Current evidence is stale.", "Global config revision conflict."])("propagates canonical authority rejection: %s", async (message) => {
    await expect(runRouteCreateCommand({ source: JSON.stringify(request()), preview: false, create: async () => { throw new Error(message); } })).rejects.toThrow(message);
  });

  it("validates in preview mode without committing and delegates success only once", async () => {
    const create = vi.fn(async (_request, preview) => ({ status: preview ? "previewed" as const : "created" as const, revision: request().expectedRevision }));
    expect(await runRouteCreateCommand({ source: JSON.stringify(request()), preview: true, create })).toMatchObject({ status: "previewed" });
    expect(await runRouteCreateCommand({ source: JSON.stringify(request()), preview: false, create })).toMatchObject({ status: "created" });
    expect(create).toHaveBeenNthCalledWith(1, request(), true);
    expect(create).toHaveBeenNthCalledWith(2, request(), false);
  });
});

function request() { const evidence = { sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", confidence: "high", authority: "configured" }; return { requestId: "request", expectedRevision: `sha256:${"c".repeat(64)}`, discoveryIdentity: { providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model" }, material: { routeId: "route", label: "Route", accountSelection: { mode: "exact", accountId: "account" }, dataClassification: "public", dataPolicyEvidence: { providerId: "provider", providerModelId: "model", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "public", permittedClassifications: ["public"], sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }, economics: { adapterCapabilityId: "fixture", adapterCapabilityVersion: "v1", authBillingChannel: "fixture", executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled", overagePosture: "disabled", contextClass: "standard", cacheClass: "provider", priceEvidence: { kind: "subscription", rateCardId: "fixture", rateCardRevision: "v1", evidence }, auxiliaryCharges: [], executionEnvelope: { limits: [] } } } }; }
