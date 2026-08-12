import { createHash } from "node:crypto";
import {
  createAccountRef,
  createManagedEconomicAmountFromDecimal,
  type AccountRef,
  type AdmittedExecutionRoute,
  type DirectProviderId,
  type ExecutionAccount,
  type ExecutionAccountCandidate,
  type ExecutionCatalog,
  type ManagedEconomicEvidenceIdentity,
  type ManagedEconomicQuotaEvidence,
  type ProviderUsageConfidence,
  type ProviderUsageQuotaObservation,
  type ProviderUsageSnapshot,
  type ProviderUsageSource,
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
  ManagedAccountCandidateBinding,
  ManagedAccountCapacityObservation,
} from "./managed-account-lease-authority.js";
import type {
  OperatorSessionCredentialPort,
  OperatorSessionExecutionCandidatePort,
  OperatorSessionResolvedCredential,
} from "../execution-routing/operator-session-execution-routing-service.js";

/**
 * The configured execution catalog is the only durable input to this runtime.
 * Credential pools contribute secret-free revisions and, only after a fence,
 * the selected credential material.
 */
export interface ConfiguredExecutionAccountRuntimeOptions {
  readonly catalog: ExecutionCatalog;
  readonly credentialRootDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
  readonly codexPool?: ConfiguredCodexExecutionAccountPool;
  /** Operator-session capacity is observed from the shared lease authority. */
  readonly observeOperatorSessionCapacity?: (
    candidates: readonly ManagedAccountCandidateBinding[],
  ) => readonly ManagedAccountCapacityObservation[];
}

export interface ConfiguredCodexExecutionAccountPool {
  listExecutionAccounts(): Promise<readonly CodexOAuthExecutionAccount[]>;
  listUsage(now?: Date): Promise<readonly ProviderUsageSnapshot[]>;
  resolveExecutionCredential(selected: CodexOAuthExecutionAccount): Promise<CodexOAuthExecutionCredential>;
}

export type ConfiguredExecutionCredential =
  | CodexOAuthExecutionCredential
  | OpenCodeExecutionCredential
  | DirectProviderExecutionCredential;

export interface ConfiguredExecutionRoute {
  readonly providerId: string;
  readonly providerModelId: string;
  readonly scope: string;
}

export interface ConfiguredExecutionCandidate {
  readonly candidate: ExecutionAccountCandidate;
  readonly lease: ManagedAccountCandidateBinding;
}

export interface ConfiguredExecutionCandidatePort {
  resolve(input: {
    readonly admission: AdmittedExecutionRoute;
    readonly route: ConfiguredExecutionRoute;
  }): Promise<readonly ConfiguredExecutionCandidate[]>;
}

export interface CommittedConfiguredAccountBindingInput {
  readonly capacityIdentity: string;
  readonly accountRef: AccountRef;
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
 * post-fence credential ports used by every execution surface.
 */
export class ConfiguredExecutionAccountRuntime {
  #catalog: ExecutionCatalog;
  readonly #codexPool: ConfiguredCodexExecutionAccountPool;
  readonly #openCodePool: OpenCodeCredentialPoolService;
  readonly #directPool: DirectProviderCredentialPoolService;
  readonly #now: () => Date;
  readonly #observeOperatorSessionCapacity?: ConfiguredExecutionAccountRuntimeOptions["observeOperatorSessionCapacity"];

  readonly operatorSessionCandidates: OperatorSessionExecutionCandidatePort;
  readonly modelGatewayCandidates: ConfiguredExecutionCandidatePort;
  readonly operatorSessionCredentials: OperatorSessionCredentialPort<ConfiguredExecutionCredential>;

  constructor(options: ConfiguredExecutionAccountRuntimeOptions) {
    this.#catalog = options.catalog;
    this.#codexPool = options.codexPool
      ?? new CodexOAuthCredentialPoolService({ rootDir: options.credentialRootDir });
    this.#openCodePool = new OpenCodeCredentialPoolService({ rootDir: options.credentialRootDir });
    this.#directPool = new DirectProviderCredentialPoolService({
      rootDir: options.credentialRootDir,
      env: options.env,
    });
    this.#now = options.now ?? (() => new Date());
    this.#observeOperatorSessionCapacity = options.observeOperatorSessionCapacity;

    const candidates: ConfiguredExecutionCandidatePort = {
      resolve: async ({ admission, route }) => this.#resolveCandidates(admission, route),
    };
    this.modelGatewayCandidates = candidates;
    this.operatorSessionCandidates = {
      resolve: async ({ admission }) => {
        const route = this.#routeForAdmission(admission, "operator-session");
        return candidates.resolve({ admission, route });
      },
    };
    this.operatorSessionCredentials = {
      resolve: async (input) => this.#resolveCredential(input),
    };
  }

  /** Replaces the immutable catalog snapshot used by subsequent admissions. */
  updateCatalog(catalog: ExecutionCatalog): void {
    this.#catalog = catalog;
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
        if (configuredAccountRef(account, execution) !== input.accountRef) return undefined;
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
    admission: AdmittedExecutionRoute,
    route: ConfiguredExecutionRoute,
  ): Promise<readonly ConfiguredExecutionCandidate[]> {
    const configuredRoute = this.#routeForAdmission(admission, route.scope);
    if (
      configuredRoute.providerId !== route.providerId
      || configuredRoute.providerModelId !== route.providerModelId
      || configuredRoute.scope !== route.scope
    ) {
      throw new Error("Execution candidate route does not match the admitted execution route.");
    }
    const now = this.#validNow();
    const accountIds = admittedAccountIds(admission);
    const accounts = accountIds.map((accountId) => this.#requireAccount(accountId));
    const executionAccounts = await this.#listExecutionAccounts(admission.providerId as DirectProviderId);
    const usage = await this.#listUsage(admission.providerId as DirectProviderId, now);
    const cost = configuredRouteEconomics(this.#catalog, admission.routeId);
    const candidates: ConfiguredExecutionCandidate[] = [];

    for (const account of accounts) {
      if (account.providerId !== admission.providerId) {
        throw new Error(`Execution account '${account.id}' does not belong to the admitted provider.`);
      }
      const execution = executionAccounts.find(({ credentialId }) => credentialId === account.credentialId);
      if (execution === undefined) continue;
      const usageEvidence = deriveUsageEvidence(
        usage.find((entry) => entry.provider === account.providerId && entry.credentialId === account.credentialId),
        now,
      );
      const accountRef = configuredAccountRef(account, execution);
      const quotaExhausted = usageEvidence.freshness === "fresh" && usageEvidence.availability === "exhausted";
      const lease = {
        candidate: Object.freeze({
          account: accountRef,
          route: Object.freeze(configuredRoute),
          health: usageEvidence.health,
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
      } satisfies ManagedAccountCandidateBinding;
      candidates.push({
        candidate: Object.freeze({
          accountId: account.id,
          safety: "eligible",
          health: usageEvidence.health,
          quota: quotaExhausted ? "exhausted" : "available",
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
    input: Parameters<OperatorSessionCredentialPort<ConfiguredExecutionCredential>["resolve"]>[0],
  ): Promise<OperatorSessionResolvedCredential<ConfiguredExecutionCredential>> {
    if (input.lease.state !== "dispatch-fenced") {
      throw new Error("Configured execution credential resolution requires a dispatch-fenced account lease.");
    }
    const account = this.#requireAccount(input.accountId);
    if (account.credentialId !== input.credentialId) {
      throw new Error("Configured execution credential identity does not match the account catalog.");
    }
    const execution = await this.#findExecutionAccount(account);
    if (configuredAccountRef(account, execution) !== input.lease.accountRef) {
      throw new Error("Configured execution account identity changed after the dispatch fence.");
    }
    const credentialRevisionId = configuredCredentialRevisionId(account, execution);
    if (credentialRevisionId !== input.lease.credentialRevisionId) {
      throw new Error("Configured execution credential revision changed after the dispatch fence.");
    }
    const credential = await this.#resolveExecutionCredential(account.providerId as DirectProviderId, execution);
    if (credential.credentialId !== account.credentialId) {
      throw new Error("Configured execution credential resolver returned a different credential identity.");
    }
    return { credential, credentialId: credential.credentialId, credentialRevisionId };
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

  async #listExecutionAccounts(providerId: DirectProviderId): Promise<readonly ConfiguredExecutionAccount[]> {
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

  #routeForAdmission(admission: AdmittedExecutionRoute, scope: string): ConfiguredExecutionRoute {
    const route = this.#catalog.routes.find(({ id }) => id === admission.routeId);
    if (!route) throw new Error(`Execution route '${admission.routeId}' is unavailable.`);
    if (route.providerId !== admission.providerId || route.providerModelId !== admission.providerModelId) {
      throw new Error("Execution admission does not match the catalog route.");
    }
    return { providerId: route.providerId, providerModelId: route.providerModelId, scope };
  }

  #requireAccount(accountId: string): ExecutionAccount {
    const account = this.#catalog.accounts.find(({ id }) => id === accountId);
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

function admittedAccountIds(admission: AdmittedExecutionRoute): readonly string[] {
  return admission.accountSelection.mode === "exact"
    ? [admission.accountSelection.accountId]
    : admission.accountSelection.eligibleAccountIds;
}

function configuredRouteEconomics(catalog: ExecutionCatalog, routeId: string) {
  const route = catalog.routes.find(({ id }) => id === routeId);
  if (!route) throw new Error(`Execution route '${routeId}' is unavailable.`);
  const cost = route.economics.executionEnvelope.limits[0];
  if (!cost) throw new Error(`Execution route '${routeId}' has no executable economic envelope.`);
  return cost;
}

function configuredAccountRef(
  account: Pick<ExecutionAccount, "id">,
  execution: Pick<ConfiguredExecutionAccount, "fileIdentity" | "revision">,
): AccountRef {
  return createAccountRef(`configured:${account.id}:${execution.fileIdentity}:${execution.revision}`);
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
    health: freshness === "fresh" && usage.availability === "exhausted" ? "unhealthy" : "healthy",
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
