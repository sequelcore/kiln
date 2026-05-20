import type { ManagedInvocationToolOptions } from "@kilnai/runtime";
import {
  PENDING_MANAGED_AGENT_PROVIDER_MODELS,
  discoverManagedAgentProviderModels,
  type ManagedAgentProviderModels,
} from "./managed-agent-provider-models.js";
import {
  createManagedInvocationToolOptionsCatalog,
  resolveManagedInvocationToolOptions,
  type ManagedAgentRouteConfigSource,
  type ManagedInvocationToolOptionsCatalog,
  type ResolveManagedInvocationToolOptionsContext,
} from "./managed-agent-routes.js";

export interface StagedManagedInvocationRouteCatalog {
  readonly managedInvocation?: ManagedInvocationToolOptions;
  refreshNow(): Promise<void>;
  startBackgroundRefresh(): void;
}

export interface CreateStagedManagedInvocationRouteCatalogOptions {
  readonly onRefreshError?: (error: unknown) => void;
  readonly reloadConfig?: () => ManagedAgentRouteConfigSource | null | undefined;
  readonly discoverProviderModels?: () => Promise<ManagedAgentProviderModels>;
  readonly refreshIntervalMs?: number;
}

type StagedManagedInvocationRouteContext = Omit<
  ResolveManagedInvocationToolOptionsContext,
  "providerModels" | "includeUnavailableRoutes"
>;

export async function createStagedManagedInvocationRouteCatalog(
  config: ManagedAgentRouteConfigSource | null | undefined,
  context: StagedManagedInvocationRouteContext,
  options: CreateStagedManagedInvocationRouteCatalogOptions = {},
): Promise<StagedManagedInvocationRouteCatalog> {
  const currentConfig = () => options.reloadConfig?.() ?? config;
  const resolve = (providerModels: ManagedAgentProviderModels) =>
    resolveManagedInvocationToolOptions(currentConfig(), {
      ...context,
      providerModels,
      includeUnavailableRoutes: true,
    });
  const initial = await resolve(PENDING_MANAGED_AGENT_PROVIDER_MODELS);
  const catalog = initial.managedInvocation
    ? createManagedInvocationToolOptionsCatalog(initial.managedInvocation)
    : undefined;
  const discoverProviderModels = options.discoverProviderModels ?? discoverManagedAgentProviderModels;
  let refreshInFlight: Promise<void> | undefined;
  let refreshInterval: ReturnType<typeof setInterval> | undefined;

  const refreshNow = async (): Promise<void> => {
    if (!catalog) {
      return;
    }
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = refreshCatalog(catalog, resolve, discoverProviderModels, options.onRefreshError)
      .finally(() => {
        refreshInFlight = undefined;
      });
    return refreshInFlight;
  };

  return {
    managedInvocation: catalog?.options,
    refreshNow,
    startBackgroundRefresh() {
      void refreshNow();
      if (!catalog || refreshInterval !== undefined || options.refreshIntervalMs === 0) {
        return;
      }
      refreshInterval = setInterval(() => {
        void refreshNow();
      }, options.refreshIntervalMs ?? 15000);
      refreshInterval.unref?.();
    },
  };
}

async function refreshCatalog(
  catalog: ManagedInvocationToolOptionsCatalog | undefined,
  resolve: (providerModels: ManagedAgentProviderModels) => ReturnType<typeof resolveManagedInvocationToolOptions>,
  discoverProviderModels: () => Promise<ManagedAgentProviderModels>,
  onRefreshError: ((error: unknown) => void) | undefined,
): Promise<void> {
  if (!catalog) {
    return;
  }
  try {
    const providerModels = await discoverProviderModels();
    const refreshed = await resolve(providerModels);
    if (refreshed.managedInvocation) {
      catalog.update(refreshed.managedInvocation);
    }
  } catch (error: unknown) {
    onRefreshError?.(error);
  }
}
