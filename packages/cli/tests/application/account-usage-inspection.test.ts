import { describe, expect, it, vi } from "vitest";
import { defineExecutionTargetCatalog, type ProviderUsageSnapshot } from "@kilnai/core/agents";
import { createAccountUsageInspectionService } from "../../src/application/account-usage-inspection.js";

const catalog = defineExecutionTargetCatalog({
  accounts: [
    { id: "plus", providerId: "codex-oauth", credentialId: "credential-plus", maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: "plus", subscriptionClass: "subscription", quotaClassId: "plus", creditPosture: "disabled", overagePosture: "disabled" } },
    { id: "free", providerId: "codex-oauth", credentialId: "credential-free", maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: "free", subscriptionClass: "subscription", quotaClassId: "free", creditPosture: "disabled", overagePosture: "disabled" } },
  ],
  accountPolicies: [{ id: "codex-automatic", accountIds: ["plus", "free"], strategy: "economic-least-pressure" }],
  targets: [{ id: "codex-managed", label: "Codex", providerId: "codex-oauth", providerModelId: "gpt", dataClassification: "internal", dataPolicyEvidence: { providerId: "codex-oauth", providerModelId: "gpt", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-07-01T00:00:00.000Z", expiresAt: "2027-08-01T00:00:00.000Z" }, accountPolicyId: "codex-automatic", economics: { adapterCapabilityId: "codex", adapterCapabilityVersion: "v1", authBillingChannel: "oauth", executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled", overagePosture: "disabled", contextClass: "standard", cacheClass: "provider", priceEvidence: { kind: "subscription", rateCardId: "codex", rateCardRevision: "v1", evidence: { sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-07-01T00:00:00.000Z", validUntil: "2026-08-01T00:00:00.000Z", confidence: "high", authority: "configured" } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } } }],
});
const usage: ProviderUsageSnapshot[] = [
  { provider: "codex-oauth", credentialId: "credential-plus", plan: "plus", primary: { bucketId: "primary", usedPercent: 100, resetsAt: "2026-07-22T13:00:00.000Z" }, exhaustionReason: "workspace-owner-usage-limit-reached", availability: "exhausted", observedAt: "2026-07-22T11:59:00.000Z", validUntil: "2026-07-22T12:05:00.000Z", source: "provider-endpoint", confidence: "authoritative" },
  { provider: "codex-oauth", credentialId: "credential-free", plan: "free", exhaustionReason: null, availability: "unknown", observedAt: "2026-07-22T11:59:00.000Z", validUntil: "2026-07-22T12:05:00.000Z", source: "unknown", confidence: "unknown" },
];

describe("account usage inspection", () => {
  it("projects sanitized freshness and eligible routes without selection authority", async () => {
    const service = createAccountUsageInspectionService({
      readExecutionTargetCatalog: () => catalog,
      readProviderUsage: async () => usage,
      listCredentialIds: async () => ["credential-plus", "credential-free"],
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    const result = await service.inspect();
    expect(result.accounts).toEqual([
      expect.objectContaining({ accountId: "free", credentialId: "credential-free", freshness: "fresh", availability: "unknown", eligibleTargets: ["codex-managed"] }),
      expect.objectContaining({ accountId: "plus", credentialId: "credential-plus", freshness: "fresh", availability: "exhausted", eligibleTargets: [] }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/email|access_token|refresh_token|fileIdentity|path|raw/i);
  });

  it("keeps inspection read-only and refreshes only through the explicit application operation", async () => {
    const refreshProviderUsage = vi.fn(async () => usage);
    const service = createAccountUsageInspectionService({
      readExecutionTargetCatalog: () => catalog,
      readProviderUsage: async () => [],
      refreshProviderUsage,
      listCredentialIds: async () => ["credential-plus", "credential-free"],
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    const inspected = await service.inspect();
    expect(refreshProviderUsage).not.toHaveBeenCalled();

    const result = await service.refresh();

    expect(refreshProviderUsage).toHaveBeenCalledWith("codex-oauth");
    expect(inspected.operation).toBe("account-usage");
    expect(result.operation).toBe("account-usage-refresh");
    expect(result.accounts).toEqual([
      expect.objectContaining({ accountId: "free", evidenceState: "fresh", operatorAction: "none" }),
      expect.objectContaining({ accountId: "plus", evidenceState: "fresh", operatorAction: "wait-for-provider-reset" }),
    ]);
  });

  it("projects refresh freshness against time observed after the provider call", async () => {
    const refreshedAt = "2026-07-22T12:00:01.000Z";
    let currentTime = new Date("2026-07-22T12:00:00.000Z");
    const service = createAccountUsageInspectionService({
      readExecutionTargetCatalog: () => catalog,
      readProviderUsage: async () => [],
      refreshProviderUsage: async () => {
        currentTime = new Date("2026-07-22T12:00:02.000Z");
        return usage.map((snapshot) => ({
          ...snapshot,
          observedAt: refreshedAt,
          validUntil: "2026-07-22T12:05:01.000Z",
        }));
      },
      listCredentialIds: async () => ["credential-plus", "credential-free"],
      now: () => currentTime,
    });

    const result = await service.refresh();

    expect(result.accounts.every((account) => account.freshness === "fresh")).toBe(true);
    expect(result.evidence.observedAt).toBe("2026-07-22T12:00:02.000Z");
  });

  it.each([
    ["provider-request-failed", "provider-failed", "retry-provider-usage-refresh"],
    ["provider-response-unusable", "provider-failed", "retry-provider-usage-refresh"],
    ["credential-unavailable", "credential-unavailable", "repair-provider-credential"],
  ] as const)("keeps %s distinct from missing evidence", async (source, evidenceState, operatorAction) => {
    const failed = usage.map((snapshot) => ({
      ...snapshot,
      availability: "unknown" as const,
      source,
      confidence: "unknown" as const,
    }));
    const service = createAccountUsageInspectionService({
      readExecutionTargetCatalog: () => catalog,
      readProviderUsage: async () => [],
      refreshProviderUsage: async () => failed,
      listCredentialIds: async () => ["credential-plus", "credential-free"],
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    expect((await service.refresh()).accounts).toEqual([
      expect.objectContaining({ evidenceState, operatorAction, freshness: "fresh", source }),
      expect.objectContaining({ evidenceState, operatorAction, freshness: "fresh", source }),
    ]);
  });

  it("projects retained expired evidence as stale when refresh is unavailable", async () => {
    const expired = usage.map((snapshot) => ({
      ...snapshot,
      validUntil: "2026-07-22T11:59:59.000Z",
    }));
    const service = createAccountUsageInspectionService({
      readExecutionTargetCatalog: () => catalog,
      readProviderUsage: async () => expired,
      listCredentialIds: async () => ["credential-plus", "credential-free"],
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    expect((await service.inspect()).accounts).toEqual([
      expect.objectContaining({ evidenceState: "stale", freshness: "stale", operatorAction: "refresh-provider-usage" }),
      expect.objectContaining({ evidenceState: "stale", freshness: "stale", operatorAction: "refresh-provider-usage" }),
    ]);
  });

  it("reports a provider refresh failure without presenting retained evidence as current", async () => {
    const expired = usage.map((snapshot) => ({
      ...snapshot,
      validUntil: "2026-07-22T11:59:59.000Z",
    }));
    const service = createAccountUsageInspectionService({
      readExecutionTargetCatalog: () => catalog,
      readProviderUsage: async () => expired,
      refreshProviderUsage: async () => { throw new Error("private provider failure"); },
      listCredentialIds: async () => ["credential-plus", "credential-free"],
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    const result = await service.refresh();

    expect(result.evidence).toMatchObject({
      refreshedProviders: [],
      failedProviders: ["codex-oauth"],
    });
    expect(result.accounts).toEqual([
      expect.objectContaining({ evidenceState: "provider-failed", operatorAction: "retry-provider-usage-refresh" }),
      expect.objectContaining({ evidenceState: "provider-failed", operatorAction: "retry-provider-usage-refresh" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("private provider failure");
  });
});
