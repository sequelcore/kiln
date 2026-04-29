export const DEFAULT_PROVIDER_DISCOVERY_CACHE_TTL_MS = 30_000;

export interface ProviderDiscoveryCache<TDiscovery> {
  get(options?: { readonly force?: boolean }): Promise<TDiscovery>;
  peek(): TDiscovery | undefined;
  clear(): void;
}

export function createProviderDiscoveryCache<TDiscovery>(
  resolveDiscovery: () => Promise<TDiscovery>,
  ttlMs: number = DEFAULT_PROVIDER_DISCOVERY_CACHE_TTL_MS,
): ProviderDiscoveryCache<TDiscovery> {
  let cache: { readonly value: TDiscovery; readonly expiresAt: number } | undefined;
  let inflight: { readonly sequence: number; readonly promise: Promise<TDiscovery> } | undefined;
  let sequence = 0;
  let latestResolvedSequence = 0;

  const load = (): Promise<TDiscovery> => {
    const currentSequence = ++sequence;
    const promise = resolveDiscovery()
      .then((value) => {
        if (currentSequence >= latestResolvedSequence) {
          latestResolvedSequence = currentSequence;
          cache = { value, expiresAt: Date.now() + ttlMs };
        }
        return value;
      })
      .finally(() => {
        if (inflight?.sequence === currentSequence) {
          inflight = undefined;
        }
      });
    inflight = { sequence: currentSequence, promise };
    return promise;
  };

  return {
    get(options) {
      if (!options?.force) {
        if (cache && cache.expiresAt > Date.now()) {
          return Promise.resolve(cache.value);
        }
        if (inflight) {
          return inflight.promise;
        }
      }
      return load();
    },
    peek() {
      return cache?.value;
    },
    clear() {
      cache = undefined;
      inflight = undefined;
    },
  };
}
