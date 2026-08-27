import { createHash } from "node:crypto";
import {
  createExecutionAccountRef,
  createManagedEconomicAmountFromDecimal,
  isDirectProviderId,
  type ExecutionAccountRef,
  type AdmittedExecutionTarget,
  type DirectProviderId,
  type ExecutionAccount,
  type ExecutionAccountAdmissionCandidate,
  type ExecutionTargetCatalog,
  type ManagedEconomicEvidenceIdentity,
  type ManagedEconomicQuotaEvidence,
  type OneRoundModelDispatcher,
  type ProviderUsageConfidence,
  type ProviderUsageQuotaObservation,
  type ProviderUsageSnapshot,
  type ProviderUsageSource,
  type ProviderModelRouteIdentity,
} from "@kilnai/core";
import {
  CodexOAuthCredentialPoolService,
  type CodexOAuthExecutionAccount,
  type CodexOAuthExecutionCredential,
} from "../agents/credential-pool/codex-oauth-credential-pool.js";
import {
  DirectProviderCredentialPoolService,
  isPooledDirectProviderId,
  type DirectProviderExecutionAccount,
  type DirectProviderExecutionCredential,
} from "../agents/credential-pool/direct-provider-credential-pool.js";
import {
  OpenCodeCredentialPoolService,
  type OpenCodeExecutionAccount,
  type OpenCodeExecutionCredential,
} from "../agents/credential-pool/opencode-credential-pool.js";
import type {
  AccountCapacityRecord,
  ExecutionAccountCandidateBinding,
  ExecutionAccountCapacityObservation,
} from "../execution-kernel/execution-account-capacity-authority.js";
import type {
  OperatorSessionCredentialPort,
  OperatorSessionExecutionCandidatePort,
  OperatorSessionResolvedCredential,
} from "../execution-routing/operator-session-execution-routing-service.js";
import { CodexOAuthModelTurnDispatcher } from "../execution-kernel/provider-adapters/codex-oauth-model-turn-dispatcher.js";
import { ProviderAdapterOneRoundDispatcher } from "../execution-kernel/provider-adapters/provider-adapter-one-round-dispatcher.js";
import type {
  GovernedOneRoundDispatcherResolver,
  GovernedOneRoundResolvedDispatch,
} from "../execution-kernel/governed-one-round-invocation.js";
import {
  ExecutionTargetDataPolicyAuthority,
  type ExecutionTargetDataPolicyIdentity,
  type SanitizedExecutionTargetDataPolicyDecision,
} from "../execution-routing/execution-target-data-policy-authority.js";
import type { ProviderAdapter } from "@kilnai/core";

/**
 * The configured execution catalog is the only durable input to this runtime.
 * Credential pools contribute secret-free revisions and, only after a fence,
 * the selected credential material.
 */
export interface ConfiguredExecutionAccountRuntimeOptions {
  readonly catalog: ExecutionTargetCatalog;
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
  readonly credentialRootDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
  readonly codexPool?: ConfiguredCodexExecutionAccountPool;
  /** Operator-session capacity is observed from the shared lease authority. */
  readonly observeOperatorSessionCapacity?: (
    candidates: readonly ExecutionAccountCandidateBinding[],
  ) => readonly ExecutionAccountCapacityObservation[];
}

export interface ConfiguredCodexExecutionAccountPool {
  listExecutionAccounts(): Promise<readonly CodexOAuthExecutionAccount[]>;
  /** Refreshes expiring credentials before admission and returns fresh snapshots. */
  prepareExecutionAccounts(): Promise<readonly CodexOAuthExecutionAccount[]>;
  listUsage(now?: Date): Promise<readonly ProviderUsageSnapshot[]>;
  refreshUsageForCredentials(credentialIds: readonly string[]): Promise<readonly ProviderUsageSnapshot[]>;
  resolveExecutionCredential(selected: CodexOAuthExecutionAccount): Promise<CodexOAuthExecutionCredential>;
  recordProviderOutcome(credentialId: string, error?: unknown): Promise<void>;
  createAdapterFromCredential?(input: {
    readonly credential: CodexOAuthExecutionCredential;
    readonly defaultModel: string;
  }): Promise<ProviderAdapter>;
}

export type ConfiguredExecutionCredential =
  | CodexOAuthExecutionCredential
  | OpenCodeExecutionCredential
  | DirectProviderExecutionCredential;

export interface ConfiguredExecutionTarget {
  /** Concrete provider-route identity retained for post-admission binding. */
  readonly routeId: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly scope: string;
}

export interface ConfiguredExecutionCandidate {
  readonly candidate: ExecutionAccountAdmissionCandidate;
  readonly lease: ExecutionAccountCandidateBinding;
}

export interface ConfiguredExecutionCandidatePort {
  resolve(input: {
    readonly admission: AdmittedExecutionTarget;
    readonly route: ConfiguredExecutionTarget;
  }): Promise<readonly ConfiguredExecutionCandidate[]>;
}

export interface CommittedConfiguredAccountBindingInput {
  readonly capacityIdentity: string;
  readonly accountRef: ExecutionAccountRef;
  readonly credentialRevisionId: string;
}

export interface CommittedConfiguredAccountBinding {
  readonly accountId: string;
  readonly credentialId: string;
  /** Physical credential-file revision observed after the committed fence. */
  readonly credentialRevision: string;
}

type ConfiguredExecutionAccount =
  | ({ readonly providerId: "codex-oauth" } & CodexOAuthExecutionAccount)
  | OpenCodeExecutionAccount
  | DirectProviderExecutionAccount;

interface ConfiguredCredentialResolutionInput {
  readonly targetId: string;
  readonly accountId: string;
  readonly credentialId: string;
  readonly lease: AccountCapacityRecord;
  readonly catalog: ExecutionTargetCatalog;
}

type ConfiguredExecutionUsageEvidence = {
  readonly health: "healthy" | "unhealthy";
  readonly freshness: "fresh" | "stale" | "missing";
  readonly availability?: "available" | "exhausted" | "unknown";
  readonly observedAt?: string;
  readonly validUntil?: string;
  readonly source?: "provider-endpoint" | "provider-response-headers" | "unknown";
  readonly confidence?: ProviderUsageConfidence;
  readonly quota?: ProviderUsageQuotaObservation;
};

/**
 * Projects the configured account catalog into the secret-free candidate and
 * exact binding/adapter preparation ports used by every execution surface.
 */
export class ConfiguredExecutionAccountRuntime {
  #catalog: ExecutionTargetCatalog;
  readonly #codexPool: ConfiguredCodexExecutionAccountPool;
  readonly #openCodePool: OpenCodeCredentialPoolService;
  readonly #directPool: DirectProviderCredentialPoolService;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #now: () => Date;
  readonly #observeOperatorSessionCapacity?: ConfiguredExecutionAccountRuntimeOptions["observeOperatorSessionCapacity"];
  readonly #dataPolicyAuthority: ExecutionTargetDataPolicyAuthority;

  readonly operatorSessionCandidates: OperatorSessionExecutionCandidatePort;
  readonly modelGatewayCandidates: ConfiguredExecutionCandidatePort;
  readonly operatorSessionCredentials: OperatorSessionCredentialPort<ConfiguredExecutionCredential>;
  readonly modelGatewayDispatchers: GovernedOneRoundDispatcherResolver;

  constructor(options: ConfiguredExecutionAccountRuntimeOptions) {
    this.#catalog = options.catalog;
    this.#codexPool = options.codexPool
      ?? new CodexOAuthCredentialPoolService({ kilnHome: options.kilnHome, rootDir: options.credentialRootDir });
    this.#openCodePool = new OpenCodeCredentialPoolService({ kilnHome: options.kilnHome, rootDir: options.credentialRootDir });
    this.#directPool = new DirectProviderCredentialPoolService({
      kilnHome: options.kilnHome,
      rootDir: options.credentialRootDir,
      env: options.env,
    });
    this.#env = options.env ?? process.env;
    this.#now = options.now ?? (() => new Date());
    this.#observeOperatorSessionCapacity = options.observeOperatorSessionCapacity;
    this.#dataPolicyAuthority = new ExecutionTargetDataPolicyAuthority({ catalog: options.catalog, now: this.#now });

    const candidates: ConfiguredExecutionCandidatePort = {
      resolve: async ({ admission, route }) => this.#resolveCandidates(admission, route),
    };
    this.modelGatewayCandidates = candidates;
    this.operatorSessionCandidates = {
      resolve: async ({ admission, catalog }) => {
        const target = this.#targetForAdmission(admission, "operator-session", catalog);
        return this.#resolveCandidates(admission, target, catalog);
      },
    };
    this.operatorSessionCredentials = {
      resolve: async (input) => this.#resolveCredential(input),
    };
    this.modelGatewayDispatchers = {
      resolve: async ({ targetId, routeId, accountId, route, lease }) => this.#resolveModelGatewayDispatcher(targetId, routeId, accountId, route, lease),
    };
  }

  /** Replaces the immutable catalog snapshot used by subsequent admissions. */
  updateCatalog(catalog: ExecutionTargetCatalog): void {
    this.#catalog = catalog;
    this.#dataPolicyAuthority.updateCatalog(catalog);
  }

  /** Materializes an adapter from the exact credential already resolved by the owner. */
  async createProviderAdapterFromCredential(input: {
    readonly providerId: string;
    readonly providerModelId: string;
    readonly credential: ConfiguredExecutionCredential;
  }): Promise<ProviderAdapter> {
    const providerId = input.providerId;
    if (providerId === "codex-oauth") {
      if (!this.#codexPool.createAdapterFromCredential) {
        throw new Error("Configured Codex execution pool cannot materialize an exact provider adapter.");
      }
      return this.#codexPool.createAdapterFromCredential({
        credential: input.credential as CodexOAuthExecutionCredential,
        defaultModel: input.providerModelId,
      });
    }
    if (providerId === "opencode-go" || providerId === "opencode-zen") {
      return this.#openCodePool.createAdapterFromCredential({
        credential: input.credential as OpenCodeExecutionCredential,
        defaultModel: input.providerModelId,
      });
    }
    if (isDirectProviderId(providerId) && isPooledDirectProviderId(providerId)) {
      return this.#directPool.createAdapterFromCredential({
        credential: input.credential as DirectProviderExecutionCredential,
        defaultModel: input.providerModelId,
        openRouterAppUrl: this.#envValue("OPENROUTER_APP_URL"),
        openRouterAppName: this.#envValue("OPENROUTER_APP_NAME"),
      });
    }
    throw new Error(`Configured provider '${providerId}' has no exact provider adapter.`);
  }

  #envValue(name: string): string | undefined {
    return this.#env[name];
  }

  /**
   * Re-resolves the current secret-free identity and returns only the physical
   * credential revision that still matches the committed account fence.
   */
  async resolveCommittedAccountBinding(
    input: CommittedConfiguredAccountBindingInput,
  ): Promise<CommittedConfiguredAccountBinding> {
    const matches = await Promise.all(this.#catalog.accounts.map(async (account) => {
      if (account.economics.capacityIdentity !== input.capacityIdentity) return undefined;
      try {
        const execution = await this.#findExecutionAccount(account);
        if (configuredExecutionAccountRef(account, execution) !== input.accountRef) return undefined;
        if (configuredCredentialRevisionId(account, execution) !== input.credentialRevisionId) {
          throw new Error("Committed configured account credential revision changed.");
        }
        return { account, execution };
      } catch (error) {
        if (error instanceof Error && error.message.includes("credential revision changed")) throw error;
        return undefined;
      }
    }));
    const found = matches.filter((match): match is NonNullable<typeof match> => match !== undefined);
    if (found.length !== 1) {
      throw new Error(found.length === 0
        ? "Committed configured account is no longer executable."
        : "Committed configured account identity is ambiguous.");
    }
    const resolved = found[0];
    if (!resolved) throw new Error("Committed configured account is no longer executable.");
    const { account, execution } = resolved;
    return {
      accountId: account.id,
      credentialId: account.credentialId,
      credentialRevision: execution.revision,
    };
  }

  async #resolveCandidates(
    admission: AdmittedExecutionTarget,
    route: ConfiguredExecutionTarget,
    catalog: ExecutionTargetCatalog = this.#catalog,
  ): Promise<readonly ConfiguredExecutionCandidate[]> {
    const configuredRoute = this.#targetForAdmission(admission, route.scope, catalog);
    if (
      configuredRoute.routeId !== route.routeId
      || configuredRoute.providerId !== route.providerId
      || configuredRoute.providerModelId !== route.providerModelId
      || configuredRoute.scope !== route.scope
    ) {
      throw new Error("Execution candidate route does not match the admitted execution target.");
    }
    new ExecutionTargetDataPolicyAuthority({ catalog, now: this.#now }).assertAdmitted({
      targetId: admission.targetId,
      providerId: configuredRoute.providerId,
      providerModelId: configuredRoute.providerModelId,
    });
    const usageLookupAt = this.#validNow();
    const accountIds = admittedAccountIds(admission);
    const accounts = accountIds.map((accountId) => this.#requireAccount(accountId, catalog));
    const executionAccounts = await this.#listExecutionAccounts(admission.providerId as DirectProviderId, true);
    const usage = await this.#listUsage(
      admission.providerId as DirectProviderId,
      usageLookupAt,
      accounts.map(({ credentialId }) => credentialId),
    );
    // A refresh observes provider state asynchronously after the cache lookup.
    // Freshness must be judged against a clock captured after that observation;
    // otherwise every newly refreshed snapshot appears to come from the future.
    const evaluationTime = this.#validNow();
    const cost = configuredTargetEconomics(catalog, admission.targetId);
    const candidates: ConfiguredExecutionCandidate[] = [];

    for (const account of accounts) {
      if (account.providerId !== admission.providerId) {
        throw new Error(`Execution account '${account.id}' does not belong to the admitted provider.`);
      }
      const execution = executionAccounts.find(({ credentialId }) => credentialId === account.credentialId);
      if (execution === undefined) continue;
      const usageEvidence = deriveUsageEvidence(
        usage.find((entry) => entry.provider === account.providerId && entry.credentialId === account.credentialId),
        evaluationTime,
      );
      const accountRef = configuredExecutionAccountRef(account, execution);
      const quota = projectAccountQuota(account.providerId, usageEvidence);
      const health = usageEvidence.health;
      const lease = {
        candidate: Object.freeze({
          account: accountRef,
          route: Object.freeze(configuredRoute),
          health,
          leaseCapacity: "available" as const,
          pressure: usagePressure(usageEvidence),
          reservedForNewWork: false,
        }),
        capacityIdentity: account.economics.capacityIdentity,
        credentialRevisionId: configuredCredentialRevisionId(account, execution),
        usageEvidence,
        accountEconomics: Object.freeze({ ...account.economics }),
        quotaEvidence: projectManagedEconomicQuotaEvidence(
          account.economics,
          usageEvidence,
          account.providerId as DirectProviderId,
          account.credentialId,
        ),
        capacity: Object.freeze({
          maxConcurrency: account.maxConcurrency,
          reservedAffinitySlots: account.reservedAffinitySlots,
        }),
      } satisfies ExecutionAccountCandidateBinding;
      candidates.push({
        candidate: Object.freeze({
          accountId: account.id,
          safety: "eligible",
          health,
          quota,
          capacity: "available",
          economicCost: cost,
          pressure: usagePressure(usageEvidence),
        }),
        lease,
      });
    }
    if (route.scope !== "operator-session" || !this.#observeOperatorSessionCapacity) return Object.freeze(candidates);
    const capacity = this.#observeOperatorSessionCapacity(candidates.map(({ lease }) => lease));
    return Object.freeze(candidates.map((entry) => {
      const observed = capacity.find((candidate) => candidate.account === entry.lease.candidate.account);
      return observed?.leaseCapacity === "unavailable" || observed?.reservedForNewWork
        ? { ...entry, candidate: Object.freeze({ ...entry.candidate, capacity: "exhausted" as const }) }
        : entry;
    }));
  }

  async #resolveCredential(
    input: ConfiguredCredentialResolutionInput,
    allowHeld = false,
  ): Promise<OperatorSessionResolvedCredential<ConfiguredExecutionCredential>> {
    if (input.lease.state !== "dispatch-fenced" && !(allowHeld && input.lease.state === "held")) {
      throw new Error("Configured execution credential resolution requires a dispatch-fenced account lease.");
    }
    const account = this.#requireAccount(input.accountId, input.catalog);
    if (account.credentialId !== input.credentialId) {
      throw new Error("Configured execution credential identity does not match the account catalog.");
    }
    this.#assertDataPolicyForCredential(input.targetId, account, input.lease.route, input.catalog);
      const execution = await this.#findExecutionAccount(account);
    if (configuredExecutionAccountRef(account, execution) !== input.lease.accountRef) {
      throw new Error("Configured execution account identity changed after capacity admission.");
    }
    const credentialRevisionId = configuredCredentialRevisionId(account, execution);
    if (credentialRevisionId !== input.lease.credentialRevisionId) {
      throw new Error("Configured execution credential revision changed after capacity admission.");
    }
    const credential = await this.#resolveExecutionCredential(account.providerId as DirectProviderId, execution);
    if (credential.credentialId !== account.credentialId) {
      throw new Error("Configured execution credential resolver returned a different credential identity.");
    }
    return { credential, credentialId: credential.credentialId, credentialRevisionId };
  }

  async #resolveModelGatewayDispatcher(
    targetId: string,
    routeId: string,
    accountId: string,
    route: { readonly providerId: string; readonly providerModelId: string },
    lease: AccountCapacityRecord,
  ): Promise<GovernedOneRoundResolvedDispatch> {
    const account = this.#requireAccount(accountId);
    if (account.providerId !== route.providerId) {
      throw new Error("Configured execution account does not match the dispatched provider route.");
    }
    if (!isDirectProviderId(route.providerId)) {
      throw new Error("Configured execution route is not directly dispatchable.");
    }
    const { credential } = await this.#resolveCredential({
      targetId,
      accountId,
      credentialId: account.credentialId,
      lease,
      catalog: this.#catalog,
    }, true);
    const binding = Object.freeze({
      status: "bound" as const,
      routeId,
      accountId,
      credentialId: account.credentialId,
      credentialRevision: lease.credentialRevisionId,
    });
    if (route.providerId === "codex-oauth") {
      const codexCredential = credential as CodexOAuthExecutionCredential;
      const dispatcher = new CodexOAuthModelTurnDispatcher({
        account: lease.accountRef,
        credential: {
          accessToken: codexCredential.accessToken,
          ...(codexCredential.chatgptAccountId === undefined ? {} : { chatgptAccountId: codexCredential.chatgptAccountId }),
        },
        fetch,
      });
      return { dispatcher: this.#recordCodexOutcome(dispatcher, codexCredential.credentialId), binding };
    }
    if (route.providerId === "opencode-go" || route.providerId === "opencode-zen") {
      const adapter = await this.#openCodePool.createAdapterFromCredential({
        credential: credential as OpenCodeExecutionCredential,
        defaultModel: route.providerModelId,
      });
      return {
        dispatcher: new ProviderAdapterOneRoundDispatcher({
          account: lease.accountRef,
          providerId: route.providerId,
          adapter,
          requestIdentity: { requestId: lease.runtimeInvocationId },
        }),
        binding,
      };
    }
    if (isPooledDirectProviderId(route.providerId)) {
      const adapter = await this.#directPool.createAdapterFromCredential({
        credential: credential as DirectProviderExecutionCredential,
        defaultModel: route.providerModelId,
      });
      return {
        dispatcher: new ProviderAdapterOneRoundDispatcher({
          account: lease.accountRef,
          providerId: route.providerId,
          adapter,
          requestIdentity: { requestId: lease.runtimeInvocationId },
        }),
        binding,
      };
    }
    throw new Error(`Configured provider '${route.providerId}' has no model gateway dispatcher.`);
  }

  #recordCodexOutcome(
    dispatcher: OneRoundModelDispatcher,
    credentialId: string,
  ): OneRoundModelDispatcher {
    return {
      dispatchOneRound: async (input) => {
        try {
          const result = await dispatcher.dispatchOneRound(input);
          await this.#codexPool.recordProviderOutcome(credentialId).catch(() => undefined);
          return result;
        } catch (error) {
          await this.#codexPool.recordProviderOutcome(credentialId, error).catch(() => undefined);
          throw error;
        }
      },
    };
  }

  async #findExecutionAccount(account: ExecutionAccount): Promise<ConfiguredExecutionAccount> {
    const executionAccounts = await this.#listExecutionAccounts(account.providerId as DirectProviderId);
    const execution = executionAccounts.find(({ credentialId }) => credentialId === account.credentialId);
    if (execution === undefined) throw new Error(`Configured execution account '${account.id}' is no longer executable.`);
    return execution;
  }

  async #resolveExecutionCredential(
    providerId: DirectProviderId,
    execution: ConfiguredExecutionAccount,
  ): Promise<ConfiguredExecutionCredential> {
    if (providerId === "codex-oauth") {
      return this.#codexPool.resolveExecutionCredential(execution as CodexOAuthExecutionAccount);
    }
    if (providerId === "opencode-go" || providerId === "opencode-zen") {
      return this.#openCodePool.resolveExecutionCredential(execution as OpenCodeExecutionAccount);
    }
    if (isPooledDirectProviderId(providerId)) {
      return this.#directPool.resolveExecutionCredential(execution as DirectProviderExecutionAccount);
    }
    throw new Error(`Configured provider '${providerId}' has no execution credential resolver.`);
  }

  async #listExecutionAccounts(
    providerId: DirectProviderId,
    prepareForAdmission = false,
  ): Promise<readonly ConfiguredExecutionAccount[]> {
    if (providerId === "codex-oauth") {
      const accounts = prepareForAdmission
        ? await this.#codexPool.prepareExecutionAccounts()
        : await this.#codexPool.listExecutionAccounts();
      return accounts.map((account) => ({ providerId, ...account }));
    }
    if (providerId === "opencode-go" || providerId === "opencode-zen") {
      return this.#openCodePool.listExecutionAccounts(providerId === "opencode-go" ? "go" : "zen");
    }
    if (isPooledDirectProviderId(providerId)) return this.#directPool.listExecutionAccounts(providerId);
    return [];
  }

  async #listUsage(
    providerId: DirectProviderId,
    now: Date,
    admittedCredentialIds: readonly string[],
  ): Promise<readonly ProviderUsageSnapshot[]> {
    if (providerId !== "codex-oauth") return [];
    const cached = await this.#codexPool.listUsage(now);
    const cachedIds = new Set(cached.map(({ credentialId }) => credentialId));
    const missingIds = admittedCredentialIds.filter((credentialId) => !cachedIds.has(credentialId));
    if (missingIds.length === 0) return cached;
    const refreshed = await this.#codexPool.refreshUsageForCredentials(missingIds);
    const refreshedIds = new Set(refreshed.map(({ credentialId }) => credentialId));
    return [...cached.filter(({ credentialId }) => !refreshedIds.has(credentialId)), ...refreshed];
  }

  #targetForAdmission(admission: AdmittedExecutionTarget, scope: string, catalog: ExecutionTargetCatalog = this.#catalog): ConfiguredExecutionTarget {
    const target = catalog.targets.find(({ id }) => id === admission.targetId);
    if (!target) throw new Error(`Execution target '${admission.targetId}' is unavailable.`);
    if (target.providerId !== admission.providerId || target.providerModelId !== admission.providerModelId) {
      throw new Error("Execution admission does not match the catalog target.");
    }
    return { routeId: target.id, providerId: target.providerId, providerModelId: target.providerModelId, scope };
  }

  /** Returns the exact sanitized policy decision used by this configured Runtime. */
  assertAdmittedDataPolicy(identity: ExecutionTargetDataPolicyIdentity): SanitizedExecutionTargetDataPolicyDecision {
    return this.#dataPolicyAuthority.assertAdmitted(identity);
  }

  #assertDataPolicyForCredential(targetId: string, account: ExecutionAccount, identity: ProviderModelRouteIdentity, catalog: ExecutionTargetCatalog): void {
    const target = catalog.targets.find(({ id }) => id === targetId);
    if (!target) throw new Error(`Execution target '${targetId}' is unavailable.`);
    const accountPolicy = catalog.accountPolicies.find(({ id }) => id === target.accountPolicyId);
    const accountAdmitted = accountPolicy?.accountIds.includes(account.id) === true;
    if (!accountAdmitted) throw new Error("Configured execution account does not belong to the committed execution target.");
    new ExecutionTargetDataPolicyAuthority({ catalog, now: this.#now }).assertAdmitted({
      targetId,
      providerId: identity.providerId,
      providerModelId: identity.providerModelId,
    });
  }

  #requireAccount(accountId: string, catalog: ExecutionTargetCatalog = this.#catalog): ExecutionAccount {
    const account = catalog.accounts.find(({ id }) => id === accountId);
    if (!account) throw new Error(`Configured execution account '${accountId}' is unavailable.`);
    return account;
  }

  #validNow(): Date {
    const now = this.#now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError("Configured execution usage clock must return a valid Date.");
    }
    return now;
  }
}

function admittedAccountIds(admission: AdmittedExecutionTarget): readonly string[] {
  return admission.accountSelection.kind === "operator-override"
    ? [admission.accountSelection.accountId]
    : admission.accountSelection.eligibleAccountIds;
}

function configuredTargetEconomics(catalog: ExecutionTargetCatalog, targetId: string) {
  const target = catalog.targets.find(({ id }) => id === targetId);
  if (!target) throw new Error(`Execution target '${targetId}' is unavailable.`);
  const cost = target.economics.executionEnvelope.limits[0];
  if (!cost) throw new Error(`Execution target '${targetId}' has no executable economic envelope.`);
  return cost;
}

function configuredExecutionAccountRef(
  account: Pick<ExecutionAccount, "id">,
  execution: Pick<ConfiguredExecutionAccount, "fileIdentity" | "revision">,
): ExecutionAccountRef {
  return createExecutionAccountRef(`configured:${account.id}:${execution.fileIdentity}:${execution.revision}`);
}

function configuredCredentialRevisionId(
  account: Pick<ExecutionAccount, "providerId" | "credentialId">,
  execution: Pick<ConfiguredExecutionAccount, "fileIdentity" | "revision">,
): string {
  const hash = createHash("sha256");
  for (const value of [account.providerId, account.credentialId, execution.fileIdentity, execution.revision]) {
    hash.update(`${Buffer.byteLength(value, "utf8")}:`);
    hash.update(value);
    hash.update(";");
  }
  return hash.digest("hex");
}

function deriveUsageEvidence(
  usage: ProviderUsageSnapshot | undefined,
  now: Date,
): ConfiguredExecutionUsageEvidence {
  if (usage === undefined) return { health: "healthy", freshness: "missing" };
  const observedAt = Date.parse(usage.observedAt);
  const validUntil = Date.parse(usage.validUntil);
  const freshness = Number.isFinite(observedAt) && Number.isFinite(validUntil)
    && observedAt <= now.getTime() && validUntil > now.getTime()
    ? "fresh"
    : "stale";
  return {
    // Credential/provider health is enforced by the executable-account pool.
    // Usage availability belongs exclusively to the quota facet so admission
    // can retain the actual fail-closed reason (unknown versus exhausted).
    health: "healthy",
    freshness,
    availability: usage.availability,
    observedAt: usage.observedAt,
    validUntil: usage.validUntil,
    source: usageSource(usage.source),
    confidence: usage.confidence,
    quota: {
      ...(usage.primary === undefined ? {} : { primary: usage.primary }),
      ...(usage.secondary === undefined ? {} : { secondary: usage.secondary }),
      ...(usage.credits === undefined ? {} : { credits: usage.credits }),
      ...(usage.spendControl === undefined ? {} : { spendControl: usage.spendControl }),
      exhaustionReason: usage.exhaustionReason,
    },
  };
}

function usageSource(source: ProviderUsageSource): "provider-endpoint" | "provider-response-headers" | "unknown" {
  return source === "provider-endpoint" || source === "provider-response-headers" ? source : "unknown";
}

function projectManagedEconomicQuotaEvidence(
  economics: ExecutionAccount["economics"],
  usage: ConfiguredExecutionUsageEvidence,
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
      ...(window.windowDurationMinutes === undefined ? {} : { windowDurationMinutes: window.windowDurationMinutes }),
      resetsAt: window.resetsAt ?? null,
    })),
    evidence,
    ...observation,
  };
}

function providerQuotaEvidenceIdentity(
  usage: ConfiguredExecutionUsageEvidence,
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

function usagePressure(usage: ConfiguredExecutionUsageEvidence): number {
  if (usage.freshness !== "fresh" || usage.availability === "unknown") return 1;
  if (usage.availability === "exhausted") return Number.MAX_SAFE_INTEGER;
  return 0;
}

function projectAccountQuota(
  providerId: string,
  usage: ConfiguredExecutionUsageEvidence,
): ExecutionAccountAdmissionCandidate["quota"] {
  if (providerId !== "codex-oauth") {
    return usage.freshness === "fresh" && usage.availability === "exhausted" ? "exhausted" : "available";
  }
  const authoritative = usage.freshness === "fresh"
    && usage.confidence === "authoritative"
    && usage.source !== "unknown";
  if (!authoritative || usage.availability === undefined || usage.availability === "unknown") return "unknown";
  return usage.availability;
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

function digestManagedEconomicValue(value: unknown): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(value));
  return `sha256:${hash.digest("hex")}`;
}
