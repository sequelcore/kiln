import type { ExecutionTargetCatalog, ProviderUsageSnapshot } from "@kilnai/core";
import { CodexOAuthCredentialPoolService } from "@kilnai/runtime";
import { readGlobalConfig, readGlobalExecutionTargetCatalog } from "../config/global-config.js";

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
  readonly evidenceState: AccountUsageEvidenceState;
  readonly source: string;
  readonly confidence: string;
  readonly operatorAction: AccountUsageOperatorAction;
  readonly eligibleTargets: readonly string[];
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
  return {
    async inspect() {
      const now = defaults.now?.() ?? new Date();
      const catalog = defaults.readExecutionTargetCatalog();
      const usageByProvider = new Map<string, readonly ProviderUsageSnapshot[]>();
      const refreshFailures = new Set<string>();
      const credentialsByProvider = new Map<string, ReadonlySet<string>>();
      for (const provider of new Set(catalog.accounts.map((account) => account.providerId))) {
        const retained = await defaults.readProviderUsage(provider);
        let usage = retained;
        if (defaults.refreshProviderUsage !== undefined) {
          try {
            const refreshed = await defaults.refreshProviderUsage(provider);
            const refreshedIds = new Set(refreshed.map((entry) => entry.credentialId));
            usage = [...retained.filter((entry) => !refreshedIds.has(entry.credentialId)), ...refreshed];
          } catch {
            refreshFailures.add(provider);
          }
        }
        usageByProvider.set(provider, usage);
        credentialsByProvider.set(provider, new Set(await defaults.listCredentialIds(provider)));
      }
      const accounts = catalog.accounts.map((account): AccountUsageInspectionEntry => {
        const usage = usageByProvider.get(account.providerId)?.find((entry) => entry.credentialId === account.credentialId);
        const executable = credentialsByProvider.get(account.providerId)?.has(account.credentialId) === true;
        const fresh = usage !== undefined && Date.parse(usage.observedAt) <= now.getTime() && Date.parse(usage.validUntil) > now.getTime();
        const freshness = usage === undefined ? "missing" as const : fresh ? "fresh" as const : "stale" as const;
        const evidenceState = accountUsageEvidenceState(usage, freshness, refreshFailures.has(account.providerId));
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
          eligibleTargets: blocked ? [] : eligibleTargetIds(catalog, account.id),
        };
      }).sort((a, b) => a.accountId.localeCompare(b.accountId));
      return { operation: "account-usage", accounts, evidence: { authority: "global-execution-catalog", observedAt: now.toISOString() } };
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
    refreshProviderUsage: async (provider) => provider === "codex-oauth" ? codex.refreshUsage() : [],
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
