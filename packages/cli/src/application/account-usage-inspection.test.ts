import { describe, expect, it } from "vitest";
import type { ExecutionCatalog, ProviderUsageSnapshot } from "@kilnai/core";
import { createAccountUsageInspectionService } from "./account-usage-inspection.js";

const catalog = {
  accounts: [
    { id: "automatic-account", providerId: "codex-oauth", credentialId: "automatic-credential" },
    { id: "exact-account", providerId: "codex-oauth", credentialId: "exact-credential" },
  ],
  accountPolicies: [{ id: "automatic-policy", accountIds: ["automatic-account"] }],
  routes: [
    { id: "automatic-route", accountSelection: { mode: "automatic", accountPolicyId: "automatic-policy" } },
    { id: "exact-route", accountSelection: { mode: "exact", accountId: "exact-account" } },
  ],
} as unknown as ExecutionCatalog;

describe("account usage inspection", () => {
  it("projects eligible execution targets from the execution catalog", async () => {
    const service = createAccountUsageInspectionService({
      readExecutionCatalog: () => catalog,
      listCredentialIds: async () => ["automatic-credential", "exact-credential"],
      readProviderUsage: async (): Promise<readonly ProviderUsageSnapshot[]> => [],
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });

    await expect(service.inspect()).resolves.toEqual({
      operation: "account-usage",
      accounts: [
        expect.objectContaining({ accountId: "automatic-account", eligibleRoutes: ["automatic-route"] }),
        expect.objectContaining({ accountId: "exact-account", eligibleRoutes: ["exact-route"] }),
      ],
      evidence: { authority: "global-execution-catalog", observedAt: "2026-08-11T00:00:00.000Z" },
    });
  });

  it("fails closed when the configured credential is not executable", async () => {
    const service = createAccountUsageInspectionService({
      readExecutionCatalog: () => catalog,
      listCredentialIds: async () => [],
      readProviderUsage: async (): Promise<readonly ProviderUsageSnapshot[]> => [],
    });

    const result = await service.inspect();
    expect(result.accounts.every((account) => account.eligibleRoutes.length === 0)).toBe(true);
  });
});
