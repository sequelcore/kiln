import type { GuiProviderCatalogStatus } from "@kilnai/gateway-contracts";
import { createProviderDiscoveryCache, DEFAULT_PROVIDER_DISCOVERY_CACHE_TTL_MS } from "./provider-discovery-cache.js";

export type ProviderCatalogFreshness = "fresh" | "stale" | "unknown";
export type ProviderCatalogClassification = "available" | "stale" | "failed" | "unavailable";

export interface ProviderCatalogEvidence {
  readonly classification: ProviderCatalogClassification;
  readonly summary: string;
}

export interface ProviderCatalogSnapshot<TDiscovery> {
  readonly status: GuiProviderCatalogStatus;
  readonly discovery: TDiscovery;
  readonly freshness: ProviderCatalogFreshness;
  readonly classification: ProviderCatalogClassification;
  readonly catalogEvidenceCurrent: boolean;
  readonly evidence: readonly ProviderCatalogEvidence[];
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
  readonly initialFreshness?: ProviderCatalogFreshness;
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
  let freshness: ProviderCatalogFreshness = options.initialDiscovery
    ? options.initialFreshness ?? "stale"
    : "unknown";
  let classification: ProviderCatalogClassification = options.initialDiscovery
    ? classifyFreshness(freshness)
    : "unavailable";
  let evidence: readonly ProviderCatalogEvidence[] = options.initialDiscovery
    ? evidenceFor(classification, undefined)
    : [];
  let error: string | undefined;
  let inflight: Promise<ProviderCatalogSnapshot<TDiscovery>> | undefined;

  const snapshot = (): ProviderCatalogSnapshot<TDiscovery> => ({
    status,
    discovery,
    freshness,
    classification,
    catalogEvidenceCurrent: freshness === "fresh" && classification === "available",
    evidence,
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
        freshness = "fresh";
        classification = "available";
        evidence = evidenceFor(classification, undefined);
        error = undefined;
        notify();
        return snapshot();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        status = "error";
        freshness = "stale";
        classification = "failed";
        evidence = evidenceFor(classification, message);
        error = message;
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

function classifyFreshness(freshness: ProviderCatalogFreshness): ProviderCatalogClassification {
  return freshness === "fresh" ? "available" : "stale";
}

function evidenceFor(
  classification: ProviderCatalogClassification,
  detail: string | undefined,
): readonly ProviderCatalogEvidence[] {
  switch (classification) {
    case "available":
      return [{ classification, summary: "Provider catalog is fresh." }];
    case "failed":
      return [{ classification, summary: `Provider catalog refresh failed: ${detail ?? "unknown error"}` }];
    case "stale":
      return [{ classification, summary: "Seeded provider catalog requires refresh before admission." }];
    case "unavailable":
      return [{ classification, summary: "Provider catalog is unavailable." }];
  }
}
