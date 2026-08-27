import { describe, expect, it } from "vitest";
import type { ExecutionTargetCatalog, ProviderUsageSnapshot } from "@kilnai/core/agents";
import { createAccountUsageInspectionService } from "./account-usage-inspection.js";

const catalog = {
  accounts: [
    { id: "automatic-account", providerId: "codex-oauth", credentialId: "automatic-credential" },
    { id: "exact-account", providerId: "codex-oauth", credentialId: "exact-credential" },
  ],
  accountPolicies: [
    { id: "automatic-policy", accountIds: ["automatic-account"] },
    { id: "exact-policy", accountIds: ["exact-account"] },
  ],
  targets: [
    { id: "automatic-target", accountPolicyId: "automatic-policy" },
    { id: "exact-target", accountPolicyId: "exact-policy" },
  ],
} as unknown as ExecutionTargetCatalog;

describe("account usage inspection", () => {
  it("projects eligible execution targets from the execution catalog", async () => {
    const service = createAccountUsageInspectionService({
      readExecutionTargetCatalog: () => catalog,
      listCredentialIds: async () => ["automatic-credential", "exact-credential"],
      readProviderUsage: async (): Promise<readonly ProviderUsageSnapshot[]> => [],
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });

    await expect(service.inspect()).resolves.toEqual({
      operation: "account-usage",
      accounts: [
        expect.objectContaining({ accountId: "automatic-account", eligibleTargets: ["automatic-target"] }),
        expect.objectContaining({ accountId: "exact-account", eligibleTargets: ["exact-target"] }),
      ],
      evidence: { authority: "global-execution-catalog", observedAt: "2026-08-11T00:00:00.000Z" },
    });
  });

  it("fails closed when the configured credential is not executable", async () => {
    const service = createAccountUsageInspectionService({
      readExecutionTargetCatalog: () => catalog,
      listCredentialIds: async () => [],
      readProviderUsage: async (): Promise<readonly ProviderUsageSnapshot[]> => [],
    });

    const result = await service.inspect();
    expect(result.accounts.every((account) => account.eligibleTargets.length === 0)).toBe(true);
  });
});
