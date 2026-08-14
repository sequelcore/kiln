import { describe, expect, it } from "vitest";
import { projectAvailableModelDiagnostic } from "../../src/application/available-model-diagnostic.js";

describe("projectAvailableModelDiagnostic", () => {
  it.each([
    ["unknown", entry({ eligibilityState: "unknown", availabilityState: "unknown" }), ["eligibility-unknown", "availability-unknown"]],
    ["stale", entry({ discoveryState: "stale", availabilityState: "unknown" }), ["discovery-stale", "availability-unknown"]],
    ["unconfigured", entry({}), ["route-not-configured"]],
  ])("retains %s runtime evidence in the read-only diagnostic", (_case, model, expectedReasons) => {
    const result = projectAvailableModelDiagnostic({
      discovery: discovery(model),
      executionRouteCatalog: { routes: [] },
    });
    expect(result.entries).toEqual([expect.objectContaining({
      providerId: "provider",
      providerModelId: "model",
      configuredState: "unconfigured",
      reasonCodes: expect.arrayContaining(expectedReasons),
    })]);
  });
});

function discovery(model: ReturnType<typeof entry>) {
  return { catalogEvidence: { status: "complete" as const, source: { kind: "runtime-provider-catalog" as const, id: "fixture" }, observedAt: "2026-08-13T18:00:00.000Z", counts: { total: 1, returned: 1, omitted: 0 } }, entries: [model] };
}

function entry(change: { discoveryState?: "stale"; eligibilityState?: "unknown"; availabilityState?: "unknown" }) {
  const stale = change.discoveryState === "stale";
  const eligible = change.eligibilityState !== "unknown";
  return { normalizedModel: { family: "model" }, providerRoute: { providerId: "provider", providerModelId: "model", scope: "provider:direct" }, rawEvidence: { rawId: "model", provenance: "fixture" }, credentialEvidence: { state: "not-required" as const, source: "fixture" }, entitlementEvidence: { state: "not-required" as const, source: "fixture" }, freshness: { status: stale ? "stale" as const : "fresh" as const, observedAt: "2026-08-13T18:00:00.000Z" }, routeHealth: { status: change.availabilityState === "unknown" ? "unknown" as const : "healthy" as const }, policyAdmission: { use: "interactive" as const, status: eligible ? "admitted" as const : "pending" as const }, eligibility: { eligible, reasonCodes: eligible ? [] : [] } };
}
