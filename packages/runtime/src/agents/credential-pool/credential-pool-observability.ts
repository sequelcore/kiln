import type { CredentialPool, CredentialPoolSnapshot } from "@kilnai/core";

export interface CredentialPoolObservation {
  readonly provider: string;
  readonly credentialPool: CredentialPoolSnapshot;
}

interface RegisteredCredentialPool {
  readonly provider: string;
  readonly pool: CredentialPool<unknown>;
}

export class CredentialPoolObservabilityRegistry {
  private readonly pools: RegisteredCredentialPool[] = [];

  register<TAuth>(provider: string, pool: CredentialPool<TAuth>): void {
    this.pools.push({ provider, pool: pool as CredentialPool<unknown> });
  }

  snapshot(): readonly CredentialPoolObservation[] {
    return this.pools
      .map(({ provider, pool }) => ({
        provider,
        credentialPool: pool.snapshot(),
      }));
  }
}
