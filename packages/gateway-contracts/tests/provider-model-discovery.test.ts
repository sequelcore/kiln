import { describe, expect, it } from "vitest";
import type {
  GuiInboundFrame,
  GuiProviderModelDiscoveryProjection,
  ModelCatalog,
} from "../src/index.js";

const SECRET_BEARING_ERROR = "authorization failed for sk-test-secret";

function createProjection(): GuiProviderModelDiscoveryProjection {
  return {
    catalogEvidence: {
      status: "partial",
      source: { kind: "harness", id: "opencode", version: "1.2.3" },
      observedAt: "2026-07-01T16:00:00.000Z",
      counts: { total: 397, returned: 3, omitted: 394 },
      failure: {
        classification: "authorization-failure",
        summary: "Provider authorization failed; raw error omitted.",
      },
    },
    entries: [
      {
        normalizedModel: { family: "gpt", version: "5.5" },
        providerRoute: {
          providerId: "codex-oauth",
          providerModelId: "gpt-5.5",
          scope: "account:primary",
        },
        harnessRoute: {
          harnessId: "opencode",
          reportedProviderId: "codex-oauth",
          reportedModelId: "gpt-5.5",
        },
        rawEvidence: {
          rawId: "codex-oauth/gpt-5.5",
          provenance: "harness-reported",
        },
        credentialEvidence: { state: "authenticated", source: "kiln-auth-store" },
        entitlementEvidence: { state: "confirmed", source: "provider-authoritative" },
        freshness: {
          status: "fresh",
          observedAt: "2026-07-01T16:00:00.000Z",
          expiresAt: "2026-07-01T16:05:00.000Z",
        },
        routeHealth: { status: "healthy" },
        policyAdmission: { use: "interactive", status: "admitted" },
        eligibility: { eligible: true, reasonCodes: [] },
      },
      {
        normalizedModel: { family: "claude", version: "4" },
        providerRoute: {
          providerId: "anthropic",
          providerModelId: "claude-4-stale",
          scope: "account:primary",
        },
        rawEvidence: {
          rawId: "anthropic/claude-4-stale",
          provenance: "cached",
        },
        credentialEvidence: { state: "authenticated", source: "kiln-auth-store" },
        entitlementEvidence: { state: "confirmed", source: "provider-authoritative" },
        freshness: {
          status: "stale",
          observedAt: "2026-06-30T16:00:00.000Z",
          expiresAt: "2026-06-30T16:05:00.000Z",
        },
        routeHealth: { status: "unknown", reason: "Fresh health evidence is missing." },
        policyAdmission: { use: "interactive", status: "admitted" },
        eligibility: { eligible: false, reasonCodes: ["stale-catalog"] },
      },
      {
        normalizedModel: { family: "deepseek", version: "v4" },
        providerRoute: {
          providerId: "opencode-go",
          providerModelId: "deepseek-v4-pro",
          scope: "account:primary",
        },
        harnessRoute: {
          harnessId: "opencode",
          reportedProviderId: "opencode-go",
          reportedModelId: "deepseek-v4-pro",
        },
        rawEvidence: {
          rawId: "opencode-go/deepseek-v4-pro",
          provenance: "harness-reported",
        },
        credentialEvidence: { state: "authenticated", source: "kiln-auth-store" },
        entitlementEvidence: { state: "unknown", source: "harness-reported" },
        freshness: {
          status: "fresh",
          observedAt: "2026-07-01T16:00:00.000Z",
        },
        routeHealth: { status: "healthy" },
        policyAdmission: { use: "interactive", status: "denied" },
        eligibility: {
          eligible: false,
          reasonCodes: ["missing-entitlement-evidence", "policy-denied"],
        },
      },
    ],
  };
}

function createModelCatalog(): ModelCatalog {
  return {
    observedAt: "2026-07-01T16:00:00.000Z",
    models: [{
      providerId: "codex-oauth",
      providerRouteId: "account:primary",
      providerModelId: "gpt-5.6-terra",
      access: "subscription",
      family: "gpt-5.6",
      discovery: "observed",
      eligibility: "eligible",
      availability: "available",
      provenance: [],
      targets: [{
        targetId: "codex-terra",
        label: "Codex Terra",
        access: "subscription",
        availability: "available",
        reasonCodes: ["configured"],
        repairActions: [],
        eligibleAccountCount: 1,
        accountOverrideIds: [],
        cost: { kind: "subscription" },
      }],
    }],
  };
}

describe("provider model discovery frames", () => {
  it("retains the provider-neutral public projection as setup evidence after auth", () => {
    const providerModelDiscovery = createProjection();
    const frame: GuiInboundFrame = {
      type: "provider_auth_completed",
      provider: "codex-oauth",
      requestId: "auth-1",
      modelCatalog: createModelCatalog(),
      models: { "codex-oauth": ["gpt-5.5"] },
      providerDiscovery: [],
      providerModelDiscovery,
    };

    if (frame.type !== "provider_auth_completed") throw new Error("unexpected frame");
    expect(frame.providerModelDiscovery.catalogEvidence.counts).toEqual({
      total: 397,
      returned: 3,
      omitted: 394,
    });
    expect(frame.providerModelDiscovery.entries.filter((entry) => entry.eligibility.eligible)).toHaveLength(1);
    expect(frame.providerModelDiscovery.entries.filter((entry) => entry.freshness.status === "stale")).toEqual([
      expect.objectContaining({ eligibility: expect.objectContaining({ eligible: false }) }),
    ]);
    expect(JSON.stringify(frame)).not.toContain(SECRET_BEARING_ERROR);
    expect(JSON.stringify(frame)).not.toContain("sk-test-secret");
  });
});
