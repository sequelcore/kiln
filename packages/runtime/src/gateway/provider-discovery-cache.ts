export const DEFAULT_PROVIDER_DISCOVERY_CACHE_TTL_MS = 30_000;

export interface ProviderDiscoveryCache<TDiscovery> {
  get(options?: { readonly force?: boolean }): Promise<TDiscovery>;
  peek(): TDiscovery | undefined;
  clear(): void;
}

export interface ProviderDiscoveryCacheOptions<TDiscovery> {
  readonly ttlMs?: number;
  readonly initialValue?: TDiscovery;
  readonly onResolved?: (value: TDiscovery) => void;
}

export function createProviderDiscoveryCache<TDiscovery>(
  resolveDiscovery: () => Promise<TDiscovery>,
  optionsOrTtlMs: number | ProviderDiscoveryCacheOptions<TDiscovery> = DEFAULT_PROVIDER_DISCOVERY_CACHE_TTL_MS,
): ProviderDiscoveryCache<TDiscovery> {
  const options = typeof optionsOrTtlMs === "number" ? { ttlMs: optionsOrTtlMs } : optionsOrTtlMs;
  const ttlMs = options.ttlMs ?? DEFAULT_PROVIDER_DISCOVERY_CACHE_TTL_MS;
  let cache: { readonly value: TDiscovery; readonly expiresAt: number } | undefined = options.initialValue
    ? { value: options.initialValue, expiresAt: 0 }
    : undefined;
  let inflight: { readonly sequence: number; readonly promise: Promise<TDiscovery> } | undefined;
  let queuedForcedRefresh: Promise<TDiscovery> | undefined;
  let sequence = 0;
  let latestResolvedSequence = 0;

  const load = (): Promise<TDiscovery> => {
    const currentSequence = ++sequence;
    const promise = resolveDiscovery()
      .then((value) => {
        if (currentSequence >= latestResolvedSequence) {
          latestResolvedSequence = currentSequence;
          cache = { value, expiresAt: Date.now() + ttlMs };
          options.onResolved?.(value);
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
      if (inflight) {
        if (options?.force) {
          queuedForcedRefresh ??= inflight.promise
            .then(load, load)
            .finally(() => {
              queuedForcedRefresh = undefined;
            });
          return queuedForcedRefresh;
        }
        return inflight.promise;
      }
      if (!options?.force) {
        if (cache && cache.expiresAt > Date.now()) {
          return Promise.resolve(cache.value);
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
      queuedForcedRefresh = undefined;
    },
  };
}
