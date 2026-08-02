import {
  createManagedEconomicAmountFromDecimal,
  type AccountRef,
  createAccountPolicyId,
  digestManagedEconomicValue,
  type DirectProviderId,
  type ManagedEconomicEvidenceIdentity,
  type ManagedEconomicQuotaEvidence,
  type ModelGatewayAccountEconomicsConfig,
  type ModelGatewayAccountUsageEvidence,
  type ModelGatewayConfig,
  type ProviderUsageSnapshot,
} from "@kilnai/core";
import {
  CodexOAuthCredentialPoolService,
  type CodexOAuthExecutionAccount,
} from "../agents/credential-pool/codex-oauth-credential-pool.js";
import {
  DirectProviderCredentialPoolService,
  isPooledDirectProviderId,
  type DirectProviderExecutionAccount,
} from "../agents/credential-pool/direct-provider-credential-pool.js";
import {
  OpenCodeCredentialPoolService,
  type OpenCodeExecutionAccount,
} from "../agents/credential-pool/opencode-credential-pool.js";
import {
  buildModelGatewayBoundCandidates,
  createModelGatewayCredentialRevisionId,
  type ModelGatewayBoundCandidate,
} from "../model-gateway/model-gateway-account-binding.js";
import type {
  ManagedAccountCandidatePort,
  ManagedAccountCandidateResolution,
} from "./managed-account-lease-authority.js";

export interface ConfiguredManagedAccountRuntimeOptions {
  readonly config: ModelGatewayConfig;
  readonly credentialRootDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
  readonly codexPool?: ConfiguredManagedCodexAccountPool;
}

export interface ConfiguredManagedCodexAccountPool {
  listExecutionAccounts(): Promise<readonly CodexOAuthExecutionAccount[]>;
  listUsage(now?: Date): Promise<readonly ProviderUsageSnapshot[]>;
}

export interface CommittedManagedAccountBindingInput {
  readonly accountPolicyId: string;
  readonly providerId: DirectProviderId;
  readonly model: string;
  readonly capacityIdentity: string;
  readonly accountRef: AccountRef;
  readonly credentialRevisionId: string;
}

export interface CommittedManagedAccountBinding {
  readonly virtualModelId: string;
  readonly accountId: string;
  readonly credentialId: string;
  readonly credentialRevision: string;
}

type ExecutionAccount =
  | ({ readonly providerId: "codex-oauth" } & CodexOAuthExecutionAccount)
  | OpenCodeExecutionAccount
  | DirectProviderExecutionAccount;

interface ConfiguredManagedAccountSnapshot {
  readonly resolution: ManagedAccountCandidateResolution;
  readonly bound: readonly ModelGatewayBoundCandidate[];
}

/**
 * Projects configured account policy and materializes only the credential revision
 * already fenced by a managed account lease.
 */
export class ConfiguredManagedAccountRuntime
implements ManagedAccountCandidatePort {
  readonly #codexPool: ConfiguredManagedCodexAccountPool;
  readonly #openCodePool: OpenCodeCredentialPoolService;
  readonly #directPool: DirectProviderCredentialPoolService;
  readonly #now: () => Date;
  #config: ModelGatewayConfig;

  constructor(options: ConfiguredManagedAccountRuntimeOptions) {
    this.#config = options.config;
    this.#codexPool = options.codexPool
      ?? new CodexOAuthCredentialPoolService({ rootDir: options.credentialRootDir });
    this.#openCodePool = new OpenCodeCredentialPoolService({ rootDir: options.credentialRootDir });
    this.#directPool = new DirectProviderCredentialPoolService({
      rootDir: options.credentialRootDir,
      env: options.env,
    });
    this.#now = options.now ?? (() => new Date());
  }

  updateConfig(config: ModelGatewayConfig): void {
    this.#config = config;
  }

  async resolve(input: Parameters<ManagedAccountCandidatePort["resolve"]>[0]): Promise<ManagedAccountCandidateResolution> {
    return (await this.#resolveSnapshot(input)).resolution;
  }

  async #resolveSnapshot(
    input: Parameters<ManagedAccountCandidatePort["resolve"]>[0],
  ): Promise<ConfiguredManagedAccountSnapshot> {
    const policyId = createAccountPolicyId(input.accountPolicyId);
    const model = this.#config.virtualModels.find((candidate) => candidate.id === policyId);
    if (model === undefined) throw new Error(`Managed account policy '${policyId}' is unavailable.`);
    if (
      model.providerId !== input.providerRoute.providerId
      || model.providerModelId !== input.providerRoute.model
    ) {
      throw new Error(`Managed account policy '${policyId}' does not match the admitted provider route.`);
    }
    const now = this.#now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError("Managed account usage clock must return a valid Date.");
    }
    const executionAccounts = await this.#listExecutionAccounts(model.providerId);
    const usage = await this.#listUsage(model.providerId, now);
    const bound = buildModelGatewayBoundCandidates({
      virtualModel: model,
      accounts: this.#config.accounts,
      executionAccounts,
      usage,
      now,
      pressure: () => 0,
      reservedForNewWork: () => false,
    });
    return {
      bound,
      resolution: {
        route: {
          providerId: model.providerId,
          providerModelId: model.providerModelId,
          scope: `virtual:${model.id}`,
        },
        affinityPolicy: model.affinity.continuity === "none"
          ? { continuity: "none" }
          : {
              continuity: model.affinity.continuity,
              scope: requireAffinityScope(model.affinity.scope),
              ...(model.affinity.allowRebind === undefined ? {} : { allowRebind: model.affinity.allowRebind }),
            },
        candidates: bound.map((entry) => ({
          ...projectConfiguredEconomicCandidate(
            requireConfiguredAccount(this.#config, entry.binding.accountId),
            entry.usageEvidence,
            entry.binding.credentialId,
          ),
          candidate: {
            ...entry.candidate,
            pressure: usagePressure(entry),
          },
          credentialRevisionId: createModelGatewayCredentialRevisionId(entry.binding),
          usageEvidence: entry.usageEvidence,
          capacity: entry.capacity,
        })),
      },
    };
  }

  /** Re-resolves current secret-free evidence and returns only the revision durably committed by authority. */
  async resolveCommittedAccountBinding(
    input: CommittedManagedAccountBindingInput,
  ): Promise<CommittedManagedAccountBinding> {
    const snapshot = await this.#resolveSnapshot({
      accountPolicyId: createAccountPolicyId(input.accountPolicyId),
      providerRoute: {
        providerId: input.providerId,
        model: input.model,
        surface: "managed-economic-postcommit",
      },
    });
    const selected = snapshot.bound.find((candidate) =>
      configuredCapacityIdentity(this.#config, candidate.binding.accountId) === input.capacityIdentity
      && candidate.candidate.account === input.accountRef);
    if (!selected) {
      throw new Error("Committed managed account is no longer executable.");
    }
    if (createModelGatewayCredentialRevisionId(selected.binding) !== input.credentialRevisionId) {
      throw new Error("Committed managed account credential revision changed.");
    }
    if (selected.binding.providerId !== input.providerId) {
      throw new Error("Committed managed account binding is unavailable.");
    }
    return {
      virtualModelId: input.accountPolicyId,
      accountId: selected.binding.accountId,
      credentialId: selected.binding.credentialId,
      credentialRevision: selected.binding.execution.revision,
    };
  }

  async #listExecutionAccounts(providerId: DirectProviderId): Promise<readonly ExecutionAccount[]> {
    if (providerId === "codex-oauth") {
      return (await this.#codexPool.listExecutionAccounts()).map((account) => ({ providerId, ...account }));
    }
    if (providerId === "opencode-go" || providerId === "opencode-zen") {
      return this.#openCodePool.listExecutionAccounts(providerId === "opencode-go" ? "go" : "zen");
    }
    if (isPooledDirectProviderId(providerId)) return this.#directPool.listExecutionAccounts(providerId);
    return [];
  }

  async #listUsage(providerId: DirectProviderId, now: Date): Promise<readonly ProviderUsageSnapshot[]> {
    return providerId === "codex-oauth" ? this.#codexPool.listUsage(now) : [];
  }

}

function projectConfiguredEconomicCandidate(
  account: ModelGatewayConfig["accounts"][number],
  usage: ModelGatewayAccountUsageEvidence,
  credentialId: string,
): {
  readonly capacityIdentity: string;
  readonly accountEconomics?: ModelGatewayAccountEconomicsConfig;
  readonly quotaEvidence?: ManagedEconomicQuotaEvidence;
} {
  const economics = account.economics;
  if (economics === undefined) return { capacityIdentity: account.id };
  return {
    capacityIdentity: economics.capacityIdentity,
    accountEconomics: Object.freeze({ ...economics }),
    quotaEvidence: projectManagedEconomicQuotaEvidence(
      economics,
      usage,
      account.providerId,
      credentialId,
    ),
  };
}

function projectManagedEconomicQuotaEvidence(
  economics: ModelGatewayAccountEconomicsConfig,
  usage: ModelGatewayAccountUsageEvidence,
  providerId: DirectProviderId,
  credentialId: string,
): ManagedEconomicQuotaEvidence {
  const evidence = providerQuotaEvidenceIdentity(usage, providerId, credentialId);
  const quota = usage.quota;
  const observation = quota === undefined
    ? {}
    : {
        ...(quota.credits === undefined ? {} : { credits: quota.credits }),
        ...(quota.spendControl === undefined ? {} : { spendControl: quota.spendControl }),
        exhaustionReason: quota.exhaustionReason,
      };
  if (usage.freshness !== "fresh") {
    return {
      kind: "unknown",
      capacityIdentity: economics.capacityIdentity,
      subscriptionClass: "unknown",
      reason: usage.freshness === "missing" ? "provider-quota-missing" : "provider-quota-stale",
      evidence,
      ...observation,
    };
  }
  if (usage.confidence !== "authoritative" || usage.source === "unknown") {
    return {
      kind: "unknown",
      capacityIdentity: economics.capacityIdentity,
      subscriptionClass: "unknown",
      reason: "provider-quota-not-authoritative",
      evidence,
      ...observation,
    };
  }
  const windows = [quota?.primary, quota?.secondary].filter((window) => window !== undefined);
  if (windows.length === 0) {
    return {
      kind: "unknown",
      capacityIdentity: economics.capacityIdentity,
      subscriptionClass: "unknown",
      reason: "provider-quota-buckets-unavailable",
      evidence,
      ...observation,
    };
  }
  if (evidence === null) throw new Error("Fresh authoritative provider quota requires evidence identity.");
  return {
    kind: "known",
    capacityIdentity: economics.capacityIdentity,
    subscriptionClass: economics.subscriptionClass,
    quotaClassId: economics.quotaClassId,
    buckets: windows.map((window) => ({
      bucketId: window.bucketId,
      dimension: "percent",
      remaining: createManagedEconomicAmountFromDecimal({
        value: subtractPercentFromHundred(window.usedPercent),
        unit: "percent",
        scheme: { kind: "unit" },
      }),
      ...(window.windowDurationMinutes === undefined
        ? {}
        : { windowDurationMinutes: window.windowDurationMinutes }),
      resetsAt: window.resetsAt ?? null,
    })),
    evidence,
    ...observation,
  };
}

function providerQuotaEvidenceIdentity(
  usage: ModelGatewayAccountUsageEvidence,
  providerId: DirectProviderId,
  credentialId: string,
): ManagedEconomicEvidenceIdentity | null {
  if (
    usage.freshness === "missing"
    || usage.observedAt === undefined
    || usage.validUntil === undefined
    || usage.confidence !== "authoritative"
    || usage.source === undefined
    || usage.source === "unknown"
  ) return null;
  const sourceDigest = digestManagedEconomicValue({
    providerId,
    credentialId,
    observedAt: usage.observedAt,
    validUntil: usage.validUntil,
    source: usage.source,
    quota: usage.quota ?? null,
  });
  return {
    sourceIdentity: `${providerId}:quota:${credentialId}`,
    sourceRevision: sourceDigest,
    sourceDigest,
    observedAt: usage.observedAt,
    validUntil: usage.validUntil,
    confidence: "high",
    authority: "provider-reported",
  };
}

function subtractPercentFromHundred(usedPercent: number): string {
  const decimal = expandDecimal(String(usedPercent));
  const [whole, fraction = ""] = decimal.split(".");
  const scale = fraction.length;
  const factor = 10n ** BigInt(scale);
  const usedAtoms = BigInt(`${whole}${fraction}`);
  const remainingAtoms = 100n * factor - usedAtoms;
  if (scale === 0) return remainingAtoms.toString();
  const padded = remainingAtoms.toString().padStart(scale + 1, "0");
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function expandDecimal(value: string): string {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(value);
  if (!match) throw new TypeError("Provider usage percentage is not a decimal number.");
  const digits = `${match[1]}${match[2] ?? ""}`;
  const decimalIndex = match[1]!.length + Number(match[3] ?? 0);
  if (decimalIndex <= 0) return `0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function requireConfiguredAccount(
  config: ModelGatewayConfig,
  accountId: string,
): ModelGatewayConfig["accounts"][number] {
  const account = config.accounts.find((candidate) => candidate.id === accountId);
  if (account === undefined) throw new Error(`Configured managed account '${accountId}' is unavailable.`);
  return account;
}

function configuredCapacityIdentity(config: ModelGatewayConfig, accountId: string): string {
  const account = requireConfiguredAccount(config, accountId);
  return account.economics?.capacityIdentity ?? account.id;
}

function usagePressure(candidate: ModelGatewayBoundCandidate): number {
  const usage = candidate.usageEvidence;
  if (usage.freshness !== "fresh" || usage.availability === "unknown") return 1;
  if (usage.availability === "exhausted") return Number.MAX_SAFE_INTEGER;
  return 0;
}

function requireAffinityScope(value: "session" | "turn" | undefined): "session" | "turn" {
  if (value === undefined) throw new Error("Managed account affinity continuity requires an explicit scope.");
  return value;
}
