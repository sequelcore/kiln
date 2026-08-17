import { describe, expect, it } from "vitest";
import { defineExecutionCatalog, type ProviderUsageSnapshot } from "@kilnai/core/agents";
import { createAccountUsageInspectionService } from "../../src/application/account-usage-inspection.js";

const catalog = defineExecutionCatalog({
  accounts: [
    { id: "plus", providerId: "codex-oauth", credentialId: "credential-plus", maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: "plus", subscriptionClass: "subscription", quotaClassId: "plus", creditPosture: "disabled", overagePosture: "disabled" } },
    { id: "free", providerId: "codex-oauth", credentialId: "credential-free", maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: "free", subscriptionClass: "subscription", quotaClassId: "free", creditPosture: "disabled", overagePosture: "disabled" } },
  ],
  accountPolicies: [{ id: "codex-automatic", accountIds: ["plus", "free"], strategy: "economic-least-pressure" }],
  routes: [{ id: "codex-managed", label: "Codex", providerId: "codex-oauth", providerModelId: "gpt", dataClassification: "internal", dataPolicyEvidence: { providerId: "codex-oauth", providerModelId: "gpt", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-07-01T00:00:00.000Z", expiresAt: "2027-08-01T00:00:00.000Z" }, accountSelection: { mode: "automatic", accountPolicyId: "codex-automatic" }, economics: { adapterCapabilityId: "codex", adapterCapabilityVersion: "v1", authBillingChannel: "oauth", executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled", overagePosture: "disabled", contextClass: "standard", cacheClass: "provider", priceEvidence: { kind: "subscription", rateCardId: "codex", rateCardRevision: "v1", evidence: { sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-07-01T00:00:00.000Z", validUntil: "2026-08-01T00:00:00.000Z", confidence: "high", authority: "configured" } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } } }],
});
const usage: ProviderUsageSnapshot[] = [
  { provider: "codex-oauth", credentialId: "credential-plus", plan: "plus", primary: { bucketId: "primary", usedPercent: 100, resetsAt: "2026-07-22T13:00:00.000Z" }, exhaustionReason: "workspace-owner-usage-limit-reached", availability: "exhausted", observedAt: "2026-07-22T11:59:00.000Z", validUntil: "2026-07-22T12:05:00.000Z", source: "provider-endpoint", confidence: "authoritative" },
  { provider: "codex-oauth", credentialId: "credential-free", plan: "free", exhaustionReason: null, availability: "unknown", observedAt: "2026-07-22T11:59:00.000Z", validUntil: "2026-07-22T12:05:00.000Z", source: "unknown", confidence: "unknown" },
];

describe("account usage inspection", () => {
  it("projects sanitized freshness and eligible routes without selection authority", async () => {
    const service = createAccountUsageInspectionService({
      readExecutionCatalog: () => catalog,
      readProviderUsage: async () => usage,
      listCredentialIds: async () => ["credential-plus", "credential-free"],
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    const result = await service.inspect();
    expect(result.accounts).toEqual([
      expect.objectContaining({ accountId: "free", credentialId: "credential-free", freshness: "fresh", availability: "unknown", eligibleRoutes: ["codex-managed"] }),
      expect.objectContaining({ accountId: "plus", credentialId: "credential-plus", freshness: "fresh", availability: "exhausted", eligibleRoutes: [] }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/email|access_token|refresh_token|fileIdentity|path|raw/i);
  });
});
