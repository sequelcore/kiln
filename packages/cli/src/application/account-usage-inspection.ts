import type { ExecutionCatalog, ProviderUsageSnapshot } from "@kilnai/core";
import { CodexOAuthCredentialPoolService } from "@kilnai/runtime";
import { readGlobalConfig, readGlobalExecutionCatalog } from "../config/global-config.js";

export interface AccountUsageInspectionService {
  inspect(): Promise<AccountUsageInspection>;
}

export interface AccountUsageInspection {
  readonly operation: "account-usage";
  readonly accounts: readonly AccountUsageInspectionEntry[];
  readonly evidence: { readonly authority: "global-execution-catalog"; readonly observedAt: string };
}

export interface AccountUsageInspectionEntry {
  readonly provider: string;
  readonly accountId: string;
  readonly credentialId: string;
  readonly plan?: string;
  readonly availability: "available" | "exhausted" | "unknown";
  readonly primary?: { readonly usedPercent: number; readonly resetsAt?: string };
  readonly secondary?: { readonly usedPercent: number; readonly resetsAt?: string };
  readonly freshness: "fresh" | "stale" | "missing";
  readonly source: string;
  readonly confidence: string;
  readonly eligibleRoutes: readonly string[];
}

export interface CreateAccountUsageInspectionServiceOptions {
  readonly readExecutionCatalog: () => ExecutionCatalog;
  readonly readProviderUsage: (provider: string) => Promise<readonly ProviderUsageSnapshot[]>;
  readonly listCredentialIds: (provider: string) => Promise<readonly string[]>;
  readonly now?: () => Date;
}

export function createAccountUsageInspectionService(
  options?: CreateAccountUsageInspectionServiceOptions,
  kilnHome?: string,
): AccountUsageInspectionService {
  const defaults = options ?? defaultOptions(kilnHome);
  return {
    async inspect() {
      const now = defaults.now?.() ?? new Date();
      const catalog = defaults.readExecutionCatalog();
      const usageByProvider = new Map<string, readonly ProviderUsageSnapshot[]>();
      const credentialsByProvider = new Map<string, ReadonlySet<string>>();
      for (const provider of new Set(catalog.accounts.map((account) => account.providerId))) {
        usageByProvider.set(provider, await defaults.readProviderUsage(provider));
        credentialsByProvider.set(provider, new Set(await defaults.listCredentialIds(provider)));
      }
      const accounts = catalog.accounts.map((account): AccountUsageInspectionEntry => {
        const usage = usageByProvider.get(account.providerId)?.find((entry) => entry.credentialId === account.credentialId);
        const executable = credentialsByProvider.get(account.providerId)?.has(account.credentialId) === true;
        const fresh = usage !== undefined && Date.parse(usage.observedAt) <= now.getTime() && Date.parse(usage.validUntil) > now.getTime();
        const freshness = usage === undefined ? "missing" as const : fresh ? "fresh" as const : "stale" as const;
        const blocked = !executable || (fresh && usage?.availability === "exhausted");
        return {
          provider: account.providerId,
          accountId: account.id,
          credentialId: account.credentialId,
          ...(usage?.plan === undefined ? {} : { plan: usage.plan }),
          availability: usage?.availability ?? "unknown",
          ...(usage?.primary === undefined ? {} : { primary: usage.primary }),
          ...(usage?.secondary === undefined ? {} : { secondary: usage.secondary }),
          freshness,
          source: usage?.source ?? "unknown",
          confidence: usage?.confidence ?? "unknown",
          eligibleRoutes: blocked ? [] : eligibleRouteIds(catalog, account.id),
        };
      }).sort((a, b) => a.accountId.localeCompare(b.accountId));
      return { operation: "account-usage", accounts, evidence: { authority: "global-execution-catalog", observedAt: now.toISOString() } };
    },
  };
}

function defaultOptions(kilnHome?: string): CreateAccountUsageInspectionServiceOptions {
  const codex = new CodexOAuthCredentialPoolService({ kilnHome });
  return {
    readExecutionCatalog: () => {
      const catalog = readGlobalExecutionCatalog(readGlobalConfig());
      if (!catalog) throw new Error("Execution catalog is required to inspect account usage.");
      return catalog;
    },
    readProviderUsage: async (provider) => provider === "codex-oauth" ? codex.listUsage() : [],
    listCredentialIds: async (provider) => provider === "codex-oauth" ? (await codex.listExecutionAccounts()).map((entry) => entry.credentialId) : [],
  };
}

function eligibleRouteIds(catalog: ExecutionCatalog, accountId: string): string[] {
  const policyById = new Map(catalog.accountPolicies.map((policy) => [policy.id, policy]));
  return catalog.routes.flatMap((route) => {
    if (route.accountSelection.mode === "exact") {
      return route.accountSelection.accountId === accountId ? [route.id] : [];
    }
    return policyById.get(route.accountSelection.accountPolicyId)?.accountIds.includes(accountId)
      ? [route.id]
      : [];
  }).sort();
}
