import type { ExecutionTargetCatalog, ProviderUsageSnapshot } from "@kilnai/core";
import { CodexOAuthCredentialPoolService } from "@kilnai/runtime";
import { readGlobalConfig, readGlobalExecutionTargetCatalog } from "../config/global-config.js";

export interface AccountUsageInspectionService {
  inspect(): Promise<AccountUsageInspection>;
  refresh(): Promise<AccountUsageRefresh>;
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
  readonly evidenceState: AccountUsageEvidenceState;
  readonly source: string;
  readonly confidence: string;
  readonly operatorAction: AccountUsageOperatorAction;
  readonly eligibleTargets: readonly string[];
}

export interface AccountUsageRefresh {
  readonly operation: "account-usage-refresh";
  readonly accounts: readonly AccountUsageInspectionEntry[];
  readonly evidence: {
    readonly authority: "global-execution-catalog";
    readonly observedAt: string;
    readonly refreshedProviders: readonly string[];
    readonly failedProviders: readonly string[];
  };
}

export type AccountUsageEvidenceState =
  | "fresh"
  | "stale"
  | "missing"
  | "provider-failed"
  | "credential-unavailable";

export type AccountUsageOperatorAction =
  | "none"
  | "wait-for-provider-reset"
  | "refresh-provider-usage"
  | "retry-provider-usage-refresh"
  | "repair-provider-credential";

export interface CreateAccountUsageInspectionServiceOptions {
  readonly readExecutionTargetCatalog: () => ExecutionTargetCatalog;
  readonly readProviderUsage: (provider: string) => Promise<readonly ProviderUsageSnapshot[]>;
  readonly refreshProviderUsage?: (provider: string) => Promise<readonly ProviderUsageSnapshot[]>;
  readonly listCredentialIds: (provider: string) => Promise<readonly string[]>;
  readonly now?: () => Date;
}

export function createAccountUsageInspectionService(
  options?: CreateAccountUsageInspectionServiceOptions,
  kilnHome?: string,
): AccountUsageInspectionService {
  const defaults = options ?? defaultOptions(kilnHome);
  const load = async (mode: "inspect" | "refresh"): Promise<{
    readonly catalog: ExecutionTargetCatalog;
    readonly usageByProvider: ReadonlyMap<string, readonly ProviderUsageSnapshot[]>;
    readonly credentialsByProvider: ReadonlyMap<string, ReadonlySet<string>>;
    readonly refreshFailures: ReadonlySet<string>;
    readonly providers: readonly string[];
  }> => {
    const catalog = defaults.readExecutionTargetCatalog();
    const providers = [...new Set(catalog.accounts.map((account) => account.providerId))].sort();
    const refreshProviderUsage = defaults.refreshProviderUsage;
    if (mode === "refresh" && refreshProviderUsage === undefined) {
      throw new Error("Provider usage refresh is unavailable.");
    }
    const usageByProvider = new Map<string, readonly ProviderUsageSnapshot[]>();
    const refreshFailures = new Set<string>();
    const credentialsByProvider = new Map<string, ReadonlySet<string>>();
    for (const provider of providers) {
      const retained = await defaults.readProviderUsage(provider);
      let usage = retained;
      if (mode === "refresh" && refreshProviderUsage !== undefined) {
        try {
          const refreshed = await refreshProviderUsage(provider);
          const refreshedIds = new Set(refreshed.map((entry) => entry.credentialId));
          usage = [...retained.filter((entry) => !refreshedIds.has(entry.credentialId)), ...refreshed];
        } catch {
          refreshFailures.add(provider);
        }
      }
      usageByProvider.set(provider, usage);
      credentialsByProvider.set(provider, new Set(await defaults.listCredentialIds(provider)));
    }
    return { catalog, usageByProvider, credentialsByProvider, refreshFailures, providers };
  };

  const project = (
    loaded: Awaited<ReturnType<typeof load>>,
    now: Date,
  ): readonly AccountUsageInspectionEntry[] => loaded.catalog.accounts.map((account): AccountUsageInspectionEntry => {
    const usage = loaded.usageByProvider.get(account.providerId)?.find(
      (entry) => entry.credentialId === account.credentialId,
    );
    const executable = loaded.credentialsByProvider.get(account.providerId)?.has(account.credentialId) === true;
    const fresh = usage !== undefined
      && Date.parse(usage.observedAt) <= now.getTime()
      && Date.parse(usage.validUntil) > now.getTime();
    const freshness = usage === undefined ? "missing" as const : fresh ? "fresh" as const : "stale" as const;
    const evidenceState = accountUsageEvidenceState(
      usage,
      freshness,
      loaded.refreshFailures.has(account.providerId),
    );
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
      evidenceState,
      source: usage?.source ?? "unknown",
      confidence: usage?.confidence ?? "unknown",
      operatorAction: accountUsageOperatorAction(evidenceState, usage?.availability),
      eligibleTargets: blocked ? [] : eligibleTargetIds(loaded.catalog, account.id),
    };
  }).sort((a, b) => a.accountId.localeCompare(b.accountId));

  return {
    async inspect(): Promise<AccountUsageInspection> {
      const loaded = await load("inspect");
      const now = defaults.now?.() ?? new Date();
      const accounts = project(loaded, now);
      return { operation: "account-usage", accounts, evidence: { authority: "global-execution-catalog", observedAt: now.toISOString() } };
    },
    async refresh(): Promise<AccountUsageRefresh> {
      const loaded = await load("refresh");
      const now = defaults.now?.() ?? new Date();
      const accounts = project(loaded, now);
      return {
        operation: "account-usage-refresh",
        accounts,
        evidence: {
          authority: "global-execution-catalog",
          observedAt: now.toISOString(),
          refreshedProviders: loaded.providers.filter((provider) => !loaded.refreshFailures.has(provider)),
          failedProviders: [...loaded.refreshFailures].sort(),
        },
      };
    },
  };
}

function defaultOptions(kilnHome?: string): CreateAccountUsageInspectionServiceOptions {
  const codex = new CodexOAuthCredentialPoolService({ kilnHome });
  return {
    readExecutionTargetCatalog: () => {
      const catalog = readGlobalExecutionTargetCatalog(readGlobalConfig());
      if (!catalog) throw new Error("Execution catalog is required to inspect account usage.");
      return catalog;
    },
    readProviderUsage: async (provider) => provider === "codex-oauth" ? codex.listRetainedUsage() : [],
    refreshProviderUsage: async (provider) => {
      if (provider !== "codex-oauth") throw new Error(`Provider usage refresh is unsupported for '${provider}'.`);
      return codex.refreshUsage();
    },
    listCredentialIds: async (provider) => provider === "codex-oauth" ? (await codex.listExecutionAccounts()).map((entry) => entry.credentialId) : [],
  };
}

function accountUsageEvidenceState(
  usage: ProviderUsageSnapshot | undefined,
  freshness: AccountUsageInspectionEntry["freshness"],
  refreshFailed: boolean,
): AccountUsageEvidenceState {
  if (refreshFailed) return "provider-failed";
  if (usage?.source === "credential-unavailable") return "credential-unavailable";
  if (usage?.source === "provider-request-failed" || usage?.source === "provider-response-unusable") return "provider-failed";
  return freshness;
}

function accountUsageOperatorAction(
  evidenceState: AccountUsageEvidenceState,
  availability: ProviderUsageSnapshot["availability"] | undefined,
): AccountUsageOperatorAction {
  if (evidenceState === "credential-unavailable") return "repair-provider-credential";
  if (evidenceState === "provider-failed") return "retry-provider-usage-refresh";
  if (evidenceState === "stale" || evidenceState === "missing") return "refresh-provider-usage";
  return availability === "exhausted" ? "wait-for-provider-reset" : "none";
}

function eligibleTargetIds(catalog: ExecutionTargetCatalog, accountId: string): string[] {
  const policyById = new Map(catalog.accountPolicies.map((policy) => [policy.id, policy]));
  return catalog.targets.flatMap((target) => {
    return policyById.get(target.accountPolicyId)?.accountIds.includes(accountId)
      ? [target.id]
      : [];
  }).sort();
}
