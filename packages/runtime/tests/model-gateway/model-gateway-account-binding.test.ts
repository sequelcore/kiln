import { describe, expect, it } from "vitest";
import { createAccountRef, type ModelGatewayAccountConfig, type ModelGatewayVirtualModelConfig } from "@kilnai/core";
import { buildModelGatewayBoundCandidates } from "../../src/model-gateway/model-gateway-account-binding.js";

const model: ModelGatewayVirtualModelConfig = {
  id: "codex-managed",
  providerId: "codex-oauth",
  providerModelId: "gpt-test",
  accountIds: ["plus", "free"],
  capabilities: ["text"],
  affinity: { continuity: "prefer", scope: "session", allowRebind: false },
};
const accounts: readonly ModelGatewayAccountConfig[] = [
  { id: "plus", providerId: "codex-oauth", credentialId: "credential-plus", maxConcurrency: 1, reservedAffinitySlots: 0 },
  { id: "free", providerId: "codex-oauth", credentialId: "credential-free", maxConcurrency: 1, reservedAffinitySlots: 0 },
];
const execution = [
  { credentialId: "credential-free", fileIdentity: "f".repeat(64), revision: "1".repeat(64) },
  { credentialId: "credential-plus", fileIdentity: "p".repeat(64), revision: "2".repeat(64) },
];

describe("model gateway explicit account binding", () => {
  it("admits multiple credentials only through configured accountIds and excludes fresh exhaustion", () => {
    const candidates = buildModelGatewayBoundCandidates({
      virtualModel: model,
      accounts,
      executionAccounts: execution,
      usage: [
        { provider: "codex-oauth", credentialId: "credential-plus", availability: "exhausted", observedAt: "2026-07-22T11:59:00.000Z", validUntil: "2026-07-22T12:05:00.000Z", source: "provider-endpoint", confidence: "authoritative" },
        { provider: "codex-oauth", credentialId: "credential-free", availability: "unknown", observedAt: "2026-07-22T11:59:00.000Z", validUntil: "2026-07-22T12:05:00.000Z", source: "unknown", confidence: "unknown" },
      ],
      now: new Date("2026-07-22T12:00:00.000Z"),
      pressure: () => 0,
      reservedForNewWork: () => false,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.find((entry) => entry.binding.accountId === "plus")).toMatchObject({ candidate: { health: "unhealthy" }, usageEvidence: { freshness: "fresh", availability: "exhausted" } });
    expect(candidates.find((entry) => entry.binding.accountId === "free")).toMatchObject({ candidate: { health: "healthy" }, usageEvidence: { freshness: "fresh", availability: "unknown" } });
    expect(candidates[0]!.candidate.account).toEqual(createAccountRef(`configured:plus:${"p".repeat(64)}:${"2".repeat(64)}`));
  });

  it("ignores unbound credentials and keeps stale exhaustion eligible", () => {
    const candidates = buildModelGatewayBoundCandidates({
      virtualModel: { ...model, accountIds: ["plus"] },
      accounts,
      executionAccounts: [...execution, { credentialId: "unbound", fileIdentity: "u".repeat(64), revision: "3".repeat(64) }],
      usage: [{ provider: "codex-oauth", credentialId: "credential-plus", availability: "exhausted", observedAt: "2026-07-22T11:00:00.000Z", validUntil: "2026-07-22T11:59:59.000Z", source: "provider-endpoint", confidence: "authoritative" }],
      now: new Date("2026-07-22T12:00:00.000Z"), pressure: () => 3, reservedForNewWork: () => false,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ binding: { credentialId: "credential-plus" }, candidate: { health: "healthy", pressure: 3 }, usageEvidence: { freshness: "stale" } });
  });
});
