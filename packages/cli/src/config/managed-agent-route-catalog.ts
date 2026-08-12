import type { ManagedInvocationToolOptions } from "@kilnai/runtime";
import {
  PENDING_MANAGED_AGENT_PROVIDER_MODEL_CATALOG_DIAGNOSTICS,
  discoverManagedAgentProviderModels,
  type ManagedAgentProviderModelCatalogDiagnostics,
} from "./managed-agent-provider-models.js";
import {
  createManagedInvocationToolOptionsCatalog,
  createManagedAccountRuntimeComposition,
  resolveManagedInvocationToolOptions,
  type ManagedAgentRouteConfigSource,
  type ManagedInvocationToolOptionsCatalog,
  type ResolveManagedInvocationToolOptionsContext,
} from "./managed-agent-routes.js";

export interface StagedManagedInvocationRouteCatalog {
  readonly managedInvocation?: ManagedInvocationToolOptions;
  refreshNow(): Promise<void>;
  startBackgroundRefresh(): void;
  dispose(): Promise<void>;
}

export interface CreateStagedManagedInvocationRouteCatalogOptions {
  readonly onRefreshError?: (error: unknown) => void;
  readonly reloadConfig?: () => ManagedAgentRouteConfigSource | null | undefined;
  readonly discoverProviderModels?: () => Promise<ManagedAgentProviderModelCatalogDiagnostics>;
  readonly refreshIntervalMs?: number;
}

type StagedManagedInvocationRouteContext = Omit<
  ResolveManagedInvocationToolOptionsContext,
  "providerModelEligibility" | "includeUnavailableRoutes"
>;

export async function createStagedManagedInvocationRouteCatalog(
  config: ManagedAgentRouteConfigSource | null | undefined,
  context: StagedManagedInvocationRouteContext,
  options: CreateStagedManagedInvocationRouteCatalogOptions = {},
): Promise<StagedManagedInvocationRouteCatalog> {
  const mark = createRouteCatalogStartupMarker();
  mark("route-catalog-entered");
  const currentConfig = () => options.reloadConfig?.() ?? config;
  const executionComposition = context.compositionMode !== "candidate-admission";
  let managedAccountComposition = executionComposition && !context.managedEconomicAuthority && config
    ? createManagedAccountRuntimeComposition(config, context.cwd)
    : undefined;
  let invocationService: ManagedInvocationToolOptions["invocationService"] | undefined;
  let invocationServiceKey: ManagedInvocationToolOptions["invocationServiceKey"] | undefined;
  const resolve = (providerModelCatalogDiagnostics: ManagedAgentProviderModelCatalogDiagnostics) => {
    const nextConfig = currentConfig();
    if (executionComposition && !context.managedEconomicAuthority && !managedAccountComposition && nextConfig) {
      managedAccountComposition = createManagedAccountRuntimeComposition(nextConfig, context.cwd);
    }
    if (managedAccountComposition && nextConfig?.executionCatalog) {
      managedAccountComposition.updateCatalog(nextConfig.executionCatalog);
    }
    return resolveManagedInvocationToolOptions(nextConfig, {
      ...context,
      ...(managedAccountComposition ? { managedAccountComposition } : {}),
      ...(invocationService ? { invocationService } : {}),
      ...(invocationServiceKey ? { invocationServiceKey } : {}),
      providerModelEligibility: providerModelCatalogDiagnostics,
      includeUnavailableRoutes: true,
    });
  };
  mark("route-catalog-initial-resolve-started");
  const initial = await resolve(PENDING_MANAGED_AGENT_PROVIDER_MODEL_CATALOG_DIAGNOSTICS);
  mark("route-catalog-initial-resolve-finished", {
    routes: initial.managedInvocation?.routes.length ?? 0,
    unavailableRoutes: initial.managedInvocation?.unavailableRoutes?.length ?? 0,
  });
  invocationService = initial.managedInvocation?.invocationService;
  invocationServiceKey = initial.managedInvocation?.invocationServiceKey;
  const catalog = initial.managedInvocation
    ? createManagedInvocationToolOptionsCatalog(initial.managedInvocation)
    : undefined;
  mark("route-catalog-created", { hasCatalog: Boolean(catalog) });
  const discoverProviderModels = options.discoverProviderModels ?? discoverManagedAgentProviderModels;
  let refreshInFlight: Promise<void> | undefined;
  let refreshInterval: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  const refreshNow = async (): Promise<void> => {
    if (!catalog || disposed) {
      return;
    }
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = refreshCatalog(catalog, resolve, discoverProviderModels, options.onRefreshError, () => disposed)
      .then(() => {
        invocationService = catalog.options.invocationService;
        invocationServiceKey = catalog.options.invocationServiceKey;
      })
      .finally(() => {
        refreshInFlight = undefined;
      });
    return refreshInFlight;
  };

  return {
    managedInvocation: catalog?.options,
    refreshNow,
    startBackgroundRefresh() {
      if (disposed) {
        return;
      }
      void refreshNow();
      if (!catalog || refreshInterval !== undefined || options.refreshIntervalMs === 0) {
        return;
      }
      refreshInterval = setInterval(() => {
        void refreshNow();
      }, options.refreshIntervalMs ?? 15000);
      refreshInterval.unref?.();
    },
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (refreshInterval !== undefined) {
        clearInterval(refreshInterval);
        refreshInterval = undefined;
      }
    },
  };
}

function createRouteCatalogStartupMarker(): (phase: string, detail?: Record<string, unknown>) => void {
  const startedAt = performance.now();
  return (phase, detail) => {
    if (process.env.KILN_STARTUP_PROFILE !== "1") {
      return;
    }
    process.stderr.write(`KILN_STARTUP_PROFILE ${JSON.stringify({
      type: "kiln_startup_profile",
      surface: "managed-agent-route-catalog",
      phase,
      elapsedMs: Math.round(performance.now() - startedAt),
      ...(detail ? { detail } : {}),
    })}\n`);
  };
}

async function refreshCatalog(
  catalog: ManagedInvocationToolOptionsCatalog | undefined,
  resolve: (providerModelCatalogDiagnostics: ManagedAgentProviderModelCatalogDiagnostics) => ReturnType<typeof resolveManagedInvocationToolOptions>,
  discoverProviderModels: () => Promise<ManagedAgentProviderModelCatalogDiagnostics>,
  onRefreshError: ((error: unknown) => void) | undefined,
  isDisposed: () => boolean,
): Promise<void> {
  if (!catalog) {
    return;
  }
  try {
    const providerModelCatalogDiagnostics = await discoverProviderModels();
    if (isDisposed()) {
      return;
    }
    const refreshed = await resolve(providerModelCatalogDiagnostics);
    if (isDisposed()) {
      return;
    }
    catalog.update(refreshed.managedInvocation ?? {
      routes: [],
      unavailableRoutes: [],
      agentCatalog: [],
      skillCatalog: [],
      requestedBy: catalog.options.requestedBy,
      requestSource: catalog.options.requestSource,
      ...(catalog.options.artifactStore ? { artifactStore: catalog.options.artifactStore } : {}),
      ...(catalog.options.invocationService ? { invocationService: catalog.options.invocationService } : {}),
      ...(catalog.options.invocationServiceKey ? { invocationServiceKey: catalog.options.invocationServiceKey } : {}),
      ...(catalog.options.sessionEventSink ? { sessionEventSink: catalog.options.sessionEventSink } : {}),
    });
  } catch (error: unknown) {
    onRefreshError?.(error);
  }
}
