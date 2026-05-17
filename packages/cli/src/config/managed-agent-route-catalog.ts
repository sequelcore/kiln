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
  startBackgroundRefresh(): void;
}

export interface CreateStagedManagedInvocationRouteCatalogOptions {
  readonly onRefreshError?: (error: unknown) => void;
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
  const resolve = (providerModels: ManagedAgentProviderModels) =>
    resolveManagedInvocationToolOptions(config, {
      ...context,
      providerModels,
      includeUnavailableRoutes: true,
    });
  const initial = await resolve(PENDING_MANAGED_AGENT_PROVIDER_MODELS);
  const catalog = initial.managedInvocation
    ? createManagedInvocationToolOptionsCatalog(initial.managedInvocation)
    : undefined;

  return {
    managedInvocation: catalog?.options,
    startBackgroundRefresh() {
      refreshCatalog(catalog, resolve, options.onRefreshError);
    },
  };
}

function refreshCatalog(
  catalog: ManagedInvocationToolOptionsCatalog | undefined,
  resolve: (providerModels: ManagedAgentProviderModels) => ReturnType<typeof resolveManagedInvocationToolOptions>,
  onRefreshError: ((error: unknown) => void) | undefined,
): void {
  if (!catalog) {
    return;
  }
  void (async () => {
    const providerModels = await discoverManagedAgentProviderModels();
    const refreshed = await resolve(providerModels);
    if (refreshed.managedInvocation) {
      catalog.update(refreshed.managedInvocation);
    }
  })().catch((error: unknown) => {
    onRefreshError?.(error);
  });
}
