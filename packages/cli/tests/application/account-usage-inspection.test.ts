import { describe, expect, it } from "vitest";
import type { ModelGatewayConfig, ProviderUsageSnapshot } from "@kilnai/core";
import { createAccountUsageInspectionService } from "../../src/application/account-usage-inspection.js";

const config: ModelGatewayConfig = {
  port: 4801,
  accounts: [
    { id: "plus", providerId: "codex-oauth", credentialId: "credential-plus", maxConcurrency: 1, reservedAffinitySlots: 0 },
    { id: "free", providerId: "codex-oauth", credentialId: "credential-free", maxConcurrency: 1, reservedAffinitySlots: 0 },
  ],
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: "REPLAY" }, principals: [], surfaces: { openAIResponses: { maxBodyBytes: 1000, maxConcurrentRequests: 1 } },
  virtualModels: [{ id: "codex-managed", providerId: "codex-oauth", providerModelId: "gpt", accountIds: ["plus", "free"], capabilities: ["text"], affinity: { continuity: "prefer", scope: "session", allowRebind: false } }],
};
const usage: ProviderUsageSnapshot[] = [
  { provider: "codex-oauth", credentialId: "credential-plus", plan: "plus", primary: { usedPercent: 100, resetsAt: "2026-07-22T13:00:00.000Z" }, availability: "exhausted", observedAt: "2026-07-22T11:59:00.000Z", validUntil: "2026-07-22T12:05:00.000Z", source: "provider-endpoint", confidence: "authoritative" },
  { provider: "codex-oauth", credentialId: "credential-free", plan: "free", availability: "unknown", observedAt: "2026-07-22T11:59:00.000Z", validUntil: "2026-07-22T12:05:00.000Z", source: "unknown", confidence: "unknown" },
];

describe("account usage inspection", () => {
  it("projects sanitized freshness and eligible routes without selection authority", async () => {
    const service = createAccountUsageInspectionService({
      readModelGateway: () => config,
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
