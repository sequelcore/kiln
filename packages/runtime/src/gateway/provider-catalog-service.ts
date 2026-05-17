import type { GuiProviderCatalogStatus } from "@kilnai/gateway-contracts";
import { createProviderDiscoveryCache, DEFAULT_PROVIDER_DISCOVERY_CACHE_TTL_MS } from "./provider-discovery-cache.js";

export interface ProviderCatalogSnapshot<TDiscovery> {
  readonly status: GuiProviderCatalogStatus;
  readonly discovery: TDiscovery;
  readonly error?: string;
}

export interface ProviderCatalogService<TDiscovery> {
  snapshot(): ProviderCatalogSnapshot<TDiscovery>;
  refresh(options?: { readonly force?: boolean }): Promise<ProviderCatalogSnapshot<TDiscovery>>;
  ensureReady(): Promise<ProviderCatalogSnapshot<TDiscovery>>;
  startBackgroundRefresh(options?: { readonly force?: boolean }): void;
  subscribe(listener: (snapshot: ProviderCatalogSnapshot<TDiscovery>) => void): () => void;
}

export interface ProviderCatalogServiceOptions<TDiscovery> {
  readonly ttlMs?: number;
  readonly initialDiscovery?: TDiscovery;
  readonly onDiscoveryResolved?: (discovery: TDiscovery) => void;
}

export function createProviderCatalogService<TDiscovery>(
  resolveDiscovery: () => Promise<TDiscovery>,
  emptyDiscovery: TDiscovery,
  optionsOrTtlMs: number | ProviderCatalogServiceOptions<TDiscovery> = DEFAULT_PROVIDER_DISCOVERY_CACHE_TTL_MS,
): ProviderCatalogService<TDiscovery> {
  const options = typeof optionsOrTtlMs === "number" ? { ttlMs: optionsOrTtlMs } : optionsOrTtlMs;
  const cache = createProviderDiscoveryCache(resolveDiscovery, {
    ttlMs: options.ttlMs,
    initialValue: options.initialDiscovery,
    onResolved: options.onDiscoveryResolved,
  });
  const listeners = new Set<(snapshot: ProviderCatalogSnapshot<TDiscovery>) => void>();
  let discovery = options.initialDiscovery ?? emptyDiscovery;
  let status: GuiProviderCatalogStatus = options.initialDiscovery ? "ready" : "pending";
  let error: string | undefined;
  let inflight: Promise<ProviderCatalogSnapshot<TDiscovery>> | undefined;

  const snapshot = (): ProviderCatalogSnapshot<TDiscovery> => ({
    status,
    discovery,
    ...(error ? { error } : {}),
  });

  const notify = (): void => {
    const current = snapshot();
    for (const listener of listeners) {
      listener(current);
    }
  };

  const refresh = (options?: { readonly force?: boolean }): Promise<ProviderCatalogSnapshot<TDiscovery>> => {
    if (!options?.force && inflight) {
      return inflight;
    }
    status = status === "ready" ? "refreshing" : "pending";
    error = undefined;
    inflight = cache.get(options)
      .then((nextDiscovery) => {
        discovery = nextDiscovery;
        status = "ready";
        error = undefined;
        notify();
        return snapshot();
      })
      .catch((err: unknown) => {
        status = "error";
        error = err instanceof Error ? err.message : String(err);
        notify();
        throw err;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };

  return {
    snapshot,
    refresh,
    ensureReady() {
      if (status === "ready" || status === "refreshing") {
        return Promise.resolve(snapshot());
      }
      return refresh();
    },
    startBackgroundRefresh(options) {
      void refresh(options).catch(() => {
        // The status transition is captured in the service snapshot.
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
