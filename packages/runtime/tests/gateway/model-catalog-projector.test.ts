import { describe, expect, it } from "vitest";

import { projectModelCatalog } from "../../src/gateway/model-catalog-projector.js";

describe("projectModelCatalog", () => {
  it("joins discovered models, configured targets, capabilities, and enrichment deterministically", () => {
    const catalog = projectModelCatalog({
      discovery: {
        catalogEvidence: {
          status: "complete",
          source: { kind: "runtime-provider-catalog", id: "fixture" },
          observedAt: "2026-08-26T16:00:00.000Z",
          counts: { total: 2, returned: 2, omitted: 0 },
        },
        entries: [
          discovered("provider-a", "model-b", "provider-a:direct"),
          discovered("provider-a", "model-a", "provider-a:direct", {
            supportsTools: true,
            supportsStructuredOutput: true,
            supportsVision: true,
            contextWindow: 200_000,
          }),
        ],
      },
      configuredTargets: [
        target("target-b", "provider-a", "model-a"),
        target("target-a", "provider-a", "model-a"),
      ],
      metadata: [{
        providerId: "provider-a",
        providerModelId: "model-a",
        displayName: "Model A",
        family: "family-a",
        releaseDate: "2026-07-01",
        lifecycle: "active",
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        reasoning: true,
        source: "models.dev",
        observedAt: "2026-08-26T15:59:00.000Z",
      }],
      revision: "catalog-1",
    });

    expect(catalog.models.map((model) => model.providerModelId)).toEqual(["model-a", "model-b"]);
    expect(catalog.models[0]).toMatchObject({
      displayName: "Model A",
      family: "family-a",
      capabilities: {
        inputModalities: ["text", "image"],
        tools: true,
        structuredOutput: true,
        reasoning: true,
        contextWindow: 200_000,
      },
    });
    expect(catalog.models[0]?.targets.map((item) => item.targetId)).toEqual(["target-a", "target-b"]);
    expect(catalog.models[1]?.targets).toEqual([]);
  });

  it("retains a configured unavailable target when provider discovery has no matching model", () => {
    const catalog = projectModelCatalog({
      discovery: {
        catalogEvidence: {
          status: "failed",
          source: { kind: "runtime-provider-catalog", id: "fixture" },
          observedAt: "2026-08-26T16:00:00.000Z",
          counts: { total: 0, returned: 0, omitted: 0 },
        },
        entries: [],
      },
      configuredTargets: [{
        ...target("target-a", "provider-a", "model-a"),
        availability: "unavailable",
        reasonCodes: ["missing-credentials"],
        repairActions: ["authenticate-provider"],
      }],
    });

    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]).toMatchObject({
      providerRouteId: "configured:target-a",
      discovery: "failed",
      availability: "unavailable",
      targets: [{ targetId: "target-a", availability: "unavailable" }],
    });
  });
});

function discovered(
  providerId: string,
  providerModelId: string,
  scope: string,
  modelCapabilities?: Record<string, unknown>,
) {
  return {
    normalizedModel: { family: providerModelId },
    providerRoute: { providerId, providerModelId, scope },
    rawEvidence: { rawId: providerModelId, provenance: "synthetic-fixture" },
    credentialEvidence: { state: "not-required" as const, source: "fixture" },
    entitlementEvidence: { state: "not-required" as const, source: "fixture" },
    freshness: { status: "fresh" as const, observedAt: "2026-08-26T16:00:00.000Z" },
    routeHealth: { status: "healthy" as const },
    policyAdmission: { use: "interactive" as const, status: "admitted" as const },
    eligibility: { eligible: true, reasonCodes: [] },
    ...(modelCapabilities ? { modelCapabilities } : {}),
  };
}

function target(targetId: string, providerId: string, providerModelId: string) {
  return {
    targetId,
    label: targetId,
    providerId,
    providerModelId,
    access: "api" as const,
    availability: "available" as const,
    reasonCodes: ["configured" as const],
    repairActions: [],
    eligibleAccountCount: 1,
    accountOverrideIds: [],
    cost: { kind: "metered" as const, currency: "USD", inputPerMillion: 1, outputPerMillion: 5 },
  };
}
