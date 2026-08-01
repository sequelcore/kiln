import {
  createAccountPolicyId,
  type DirectProviderId,
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

type ExecutionAccount =
  | ({ readonly providerId: "codex-oauth" } & CodexOAuthExecutionAccount)
  | OpenCodeExecutionAccount
  | DirectProviderExecutionAccount;

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
        candidate: {
          ...entry.candidate,
          pressure: usagePressure(entry),
        },
        capacityIdentity: entry.binding.accountId,
        credentialRevisionId: createModelGatewayCredentialRevisionId(entry.binding),
        usageEvidence: entry.usageEvidence,
        capacity: entry.capacity,
      })),
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
