import type { Credential } from "./credential.js";
import type { CredentialOutcome } from "./outcome.js";
import type { SelectionStrategy } from "./strategies.js";
import type { CooldownPolicy } from "./cooldown.js";

export interface CredentialPoolStatePort<TAuth> {
  onCredentialAdded(credential: Credential<TAuth>): void;
  onCredentialRemoved(credentialId: string): void;
  onLeaseAcquired(credentialId: string): void;
  onLeaseReleased(credentialId: string): void;
  onOutcomeReported(
    credentialId: string,
    outcome: CredentialOutcome,
    cooldownUntil: number | null,
  ): void;
  onSelectionStrategyChanged(strategy: SelectionStrategy): void;
}

export interface CredentialPoolConfig<TAuth> {
  readonly providerId: string;
  readonly strategy: SelectionStrategy;
  readonly cooldownPolicy: CooldownPolicy;
  readonly credentials: readonly Credential<TAuth>[];
  readonly statePort?: CredentialPoolStatePort<TAuth>;
}

export interface PoolMetrics {
  readonly totalCredentials: number;
  readonly availableCount: number;
  readonly coolingCount: number;
  readonly exhaustedCount: number;
  readonly totalRequests: number;
}

export function computePoolMetrics<TAuth>(
  credentials: readonly Credential<TAuth>[],
): PoolMetrics {
  const now = Date.now();
  let availableCount = 0;
  let coolingCount = 0;
  let exhaustedCount = 0;
  let totalRequests = 0;

  for (const cred of credentials) {
    totalRequests += cred.requestCount;

    if (cred.cooldownUntil === null || now >= cred.cooldownUntil) {
      availableCount++;
    } else if (cred.lastExhausted !== null) {
      exhaustedCount++;
    } else {
      coolingCount++;
    }
  }

  return {
    totalCredentials: credentials.length,
    availableCount,
    coolingCount,
    exhaustedCount,
    totalRequests,
  };
}