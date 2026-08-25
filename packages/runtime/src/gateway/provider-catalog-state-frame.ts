import type {
  ExecutionRouteCatalog,
  GuiProviderCatalogStateFrame,
  GuiProviderDiscoveryResult,
} from "@kilnai/gateway-contracts";
import { projectAvailableModelCatalogForExecutionRoutes } from "./available-model-catalog-projector.js";
import { projectGuiOperatorModels, projectGuiProviderModelDiscovery } from "./gui-provider-models.js";
import type { ProviderCatalogSnapshot } from "./provider-catalog-service.js";

export async function projectProviderCatalogStateFrame(
  snapshot: ProviderCatalogSnapshot<readonly GuiProviderDiscoveryResult[]>,
  getExecutionRouteCatalog: () => Promise<ExecutionRouteCatalog>,
  currentExecutionRouteCatalog?: ExecutionRouteCatalog,
): Promise<GuiProviderCatalogStateFrame> {
  if (snapshot.status === "pending" || snapshot.status === "refreshing") {
    return { type: "provider_catalog_state", status: snapshot.status };
  }
  if (snapshot.status === "error") {
    return {
      type: "provider_catalog_state",
      status: "error",
      message: snapshot.error ?? "Provider and model discovery failed.",
    };
  }

  const executionRouteCatalog = currentExecutionRouteCatalog ?? await getExecutionRouteCatalog();
  const providerModelDiscovery = projectGuiProviderModelDiscovery(snapshot.discovery);
  return {
    type: "provider_catalog_state",
    status: "ready",
    models: projectGuiOperatorModels(snapshot.discovery),
    providerDiscovery: snapshot.discovery,
    providerModelDiscovery,
    executionRouteCatalog,
    availableModels: projectAvailableModelCatalogForExecutionRoutes({
      discovery: providerModelDiscovery,
      executionRouteCatalog,
    }),
  };
}
