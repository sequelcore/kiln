import { describe, expect, it } from "vitest";
import type { ExecutionCatalog, ExecutionRouteDataPolicyEvidence } from "@kilnai/core";
import { ExecutionRouteDataPolicyAuthority } from "../../src/execution-routing/execution-route-data-policy-authority.js";

const evidence = (): ExecutionRouteDataPolicyEvidence => ({
  providerId: "opencode-go", providerModelId: "deepseek-v4-flash", dataUse: "not-used",
  trainingPosture: "prohibited", retention: { posture: "zero", days: 0 },
  permittedMaximumClassification: "confidential", permittedClassifications: ["public", "internal", "confidential"],
  sourceIdentity: "opencode-go-privacy", sourceRevision: "2026-08-01",
  sourceDigest: `sha256:${"c".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-08-31T00:00:00.000Z",
});

function catalog(policy = evidence()): ExecutionCatalog {
  return { accounts: [], accountPolicies: [], routes: [{
    id: "deepseek-scout", label: "DeepSeek Scout", providerId: "opencode-go", providerModelId: "deepseek-v4-flash",
    dataClassification: "confidential", dataPolicyEvidence: policy,
    accountSelection: { mode: "exact", accountId: "scout" }, economics: {} as never,
  }] };
}

describe("ExecutionRouteDataPolicyAuthority", () => {
  it("returns a sanitized current decision for the exact direct identity", () => {
    const authority = new ExecutionRouteDataPolicyAuthority({ catalog: catalog(), now: () => new Date("2026-08-15T00:00:00.000Z") });
    expect(authority.evaluate({ routeId: "deepseek-scout", providerId: "opencode-go", providerModelId: "deepseek-v4-flash" })).toEqual({
      decision: { status: "admitted", freshness: "current", reason: "policy-admitted" },
      evidence: {
        providerId: "opencode-go", providerModelId: "deepseek-v4-flash", sourceIdentity: "opencode-go-privacy",
        sourceRevision: "2026-08-01", sourceDigest: `sha256:${"c".repeat(64)}`,
        trainingPosture: "prohibited", retentionPosture: "zero", retentionDays: 0,
        maximumClassification: "confidential", observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-08-31T00:00:00.000Z",
      },
    });
  });

  it("denies drift without accepting caller-controlled classification", () => {
    const authority = new ExecutionRouteDataPolicyAuthority({ catalog: catalog(), now: () => new Date("2026-08-15T00:00:00.000Z") });
    const result = authority.evaluate({ routeId: "deepseek-scout", providerId: "native-opencode", providerModelId: "deepseek-v4-flash" });
    expect(result.decision).toEqual({ status: "denied", freshness: "current", reason: "provider-mismatch" });
    expect(JSON.stringify(result)).not.toMatch(/secret|payload|content|path/iu);
  });
});
