import { createProviderUsageSnapshot, type ProviderUsageSnapshot } from "@kilnai/core";

function key(provider: string, credentialId: string): string {
  return `${provider.length}:${provider}${credentialId}`;
}

function isFresh(snapshot: ProviderUsageSnapshot, now: Date): boolean {
  return Date.parse(snapshot.validUntil) > now.getTime();
}

/** Process-local store for already sanitized provider-usage evidence. */
export class InMemoryProviderUsageStore {
  private readonly snapshots = new Map<string, ProviderUsageSnapshot>();

  put(snapshot: ProviderUsageSnapshot): void {
    const sanitized = createProviderUsageSnapshot(snapshot);
    this.snapshots.set(key(sanitized.provider, sanitized.credentialId), sanitized);
  }

  get(provider: string, credentialId: string, now = new Date()): ProviderUsageSnapshot | undefined {
    const snapshot = this.snapshots.get(key(provider, credentialId));
    return snapshot !== undefined && isFresh(snapshot, now) ? snapshot : undefined;
  }

  list(provider?: string, now = new Date()): readonly ProviderUsageSnapshot[] {
    return [...this.snapshots.values()].filter((snapshot) =>
      (provider === undefined || snapshot.provider === provider) && isFresh(snapshot, now));
  }

  remove(provider: string, credentialId: string): void {
    this.snapshots.delete(key(provider, credentialId));
  }
}
