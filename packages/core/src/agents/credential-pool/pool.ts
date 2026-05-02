import type { Credential, Lease } from "./credential.js";
import {
  createCredential,
  recordSuccess,
  recordExhaustion,
  recordFailure,
  clearExpiredCooldown,
  acquireSoftLease,
  releaseSoftLease,
  getHealthStatus,
} from "./credential.js";
import type { CredentialOutcome } from "./outcome.js";
import type { CredentialPoolStatePort } from "./state-port.js";
import { AllCredentialsExhaustedError, getResetAt, isRetryable } from "./outcome.js";
import type { SelectionStrategy } from "./strategies.js";
import { selectCredential, createInitialSelectionContext, updateSelectionContext } from "./strategies.js";
import type { CooldownPolicy } from "./cooldown.js";
import { DEFAULT_COOLDOWN_POLICY, computeCooldownUntil } from "./cooldown.js";
import { computePoolMetrics, type PoolMetrics } from "./state-port.js";

export interface CredentialPoolSnapshot {
  readonly providerId: string;
  readonly strategy: SelectionStrategy;
  readonly metrics: PoolMetrics;
  readonly entries: readonly CredentialPoolEntrySnapshot[];
}

export interface CredentialPoolEntrySnapshot {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly priority: number;
  readonly tier?: string;
  readonly health: "ok" | "cooling" | "exhausted";
  readonly requestCount: number;
  readonly lastSuccess: number | null;
  readonly lastExhausted: number | null;
  readonly cooldownUntil: number | null;
}

export class CredentialPool<TAuth> {
  private readonly providerId: string;
  private strategy: SelectionStrategy;
  private readonly cooldownPolicy: CooldownPolicy;
  private credentials: Map<string, Credential<TAuth>>;
  private selectionContext: { lastSelectedId: string | null; selectionIndex: number };
  private readonly statePort?: CredentialPoolStatePort<TAuth>;

  constructor(
    providerId: string,
    options?: {
      readonly strategy?: SelectionStrategy;
      readonly cooldownPolicy?: CooldownPolicy;
      readonly credentials?: readonly Credential<TAuth>[];
      readonly statePort?: CredentialPoolStatePort<TAuth>;
    },
  ) {
    this.providerId = providerId;
    this.strategy = options?.strategy ?? "fill-first";
    this.cooldownPolicy = options?.cooldownPolicy ?? DEFAULT_COOLDOWN_POLICY;
    this.statePort = options?.statePort;

    this.credentials = new Map();
    this.selectionContext = createInitialSelectionContext();

    if (options?.credentials) {
      for (const cred of options.credentials) {
        this.credentials.set(cred.id, { ...cred });
      }
    }
  }

  acquire(): Lease<TAuth> {
    const credentialsArray = Array.from(this.credentials.values());

    const selectedId = selectCredential(this.strategy, credentialsArray, this.selectionContext);

    if (selectedId === null) {
      throw new AllCredentialsExhaustedError();
    }

    const credential = this.credentials.get(selectedId);
    if (!credential) {
      throw new AllCredentialsExhaustedError();
    }

    const updated = acquireSoftLease(clearExpiredCooldown(credential));
    this.credentials.set(selectedId, updated);

    this.selectionContext = updateSelectionContext(
      this.selectionContext,
      selectedId,
      credentialsArray.length,
    );

    this.statePort?.onLeaseAcquired(selectedId);

    return {
      credentialId: selectedId,
      auth: updated.auth,
      acquiredAt: Date.now(),
      providerId: this.providerId,
    };
  }

  report(lease: Lease<TAuth>, outcome: CredentialOutcome): void {
    const credential = this.credentials.get(lease.credentialId);
    if (!credential) {
      return;
    }

    const now = Date.now();
    const cooldownUntil = isRetryable(outcome)
      ? computeCooldownUntil(this.cooldownPolicy, getResetAt(outcome))
      : null;
    let updated: Credential<TAuth>;

    if (outcome.type === "ok") {
      updated = recordSuccess(credential, now);
    } else if (cooldownUntil !== null) {
      updated = recordExhaustion(credential, cooldownUntil, now);
    } else {
      updated = recordFailure(credential);
    }

    updated = releaseSoftLease(updated);
    this.credentials.set(lease.credentialId, updated);

    this.statePort?.onLeaseReleased(lease.credentialId);
    this.statePort?.onOutcomeReported(lease.credentialId, outcome, cooldownUntil);
  }

  snapshot(): CredentialPoolSnapshot {
    const credentialsArray = Array.from(this.credentials.values());
    const now = Date.now();

    const entries: CredentialPoolEntrySnapshot[] = credentialsArray.map((cred) => ({
      id: cred.id,
      label: cred.label,
      source: cred.source,
      priority: cred.priority,
      tier: cred.tier,
      health: getHealthStatus(cred, now),
      requestCount: cred.requestCount,
      lastSuccess: cred.lastSuccess,
      lastExhausted: cred.lastExhausted,
      cooldownUntil: cred.cooldownUntil,
    }));

    return {
      providerId: this.providerId,
      strategy: this.strategy,
      metrics: computePoolMetrics(credentialsArray),
      entries,
    };
  }

  addCredential(
    id: string,
    label: string,
    auth: TAuth,
    options?: {
      readonly source?: "manual" | "env" | "imported";
      readonly priority?: number;
      readonly tier?: string;
    },
  ): void {
    const credential = createCredential(id, label, this.providerId, auth, options);
    this.credentials.set(id, credential);
    this.statePort?.onCredentialAdded(credential);
  }

  removeCredential(id: string): boolean {
    const existed = this.credentials.has(id);
    if (existed) {
      this.credentials.delete(id);
      this.statePort?.onCredentialRemoved(id);
    }
    return existed;
  }

  getCredential(id: string): Credential<TAuth> | undefined {
    return this.credentials.get(id);
  }

  getAllCredentials(): readonly Credential<TAuth>[] {
    return Array.from(this.credentials.values());
  }

  setStrategy(strategy: SelectionStrategy): void {
    this.strategy = strategy;
    this.statePort?.onSelectionStrategyChanged(strategy);
  }

  getStrategy(): SelectionStrategy {
    return this.strategy;
  }

  reloadCredentials(credentials: readonly Credential<TAuth>[]): void {
    const oldIds = new Set(this.credentials.keys());
    const newIds = new Set<string>();

    for (const cred of credentials) {
      newIds.add(cred.id);
      if (!this.credentials.has(cred.id)) {
        this.statePort?.onCredentialAdded(cred);
      }
      this.credentials.set(cred.id, { ...cred });
    }

    for (const id of oldIds) {
      if (!newIds.has(id)) {
        this.credentials.delete(id);
        this.statePort?.onCredentialRemoved(id);
      }
    }
  }

  getProviderId(): string {
    return this.providerId;
  }
}
