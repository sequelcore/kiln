import type {
  GuiProviderCatalogStateFrame,
  GuiProviderDiscoveryResult,
} from "@kilnai/gateway-contracts";
import { projectModelCatalog, type ConfiguredModelTarget } from "./model-catalog-projector.js";
import {
  loadModelsDevMetadata,
  type ModelsDevMetadataLoadResult,
} from "./models-dev-metadata-source.js";
import { projectGuiOperatorModels, projectGuiProviderModelDiscovery } from "./gui-provider-models.js";
import type { ProviderCatalogSnapshot } from "./provider-catalog-service.js";

type MetadataLoader = () => Promise<ModelsDevMetadataLoadResult>;

export async function projectProviderCatalogStateFrame(
  snapshot: ProviderCatalogSnapshot<readonly GuiProviderDiscoveryResult[]>,
  getConfiguredTargets: () => Promise<readonly ConfiguredModelTarget[]>,
  currentConfiguredTargets?: readonly ConfiguredModelTarget[],
  loadMetadata: MetadataLoader = loadModelsDevMetadata,
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

  const configuredTargets = currentConfiguredTargets ?? await getConfiguredTargets();
  const providerModelDiscovery = projectGuiProviderModelDiscovery(snapshot.discovery);
  const metadata = await loadMetadata();
  return {
    type: "provider_catalog_state",
    status: "ready",
    models: projectGuiOperatorModels(snapshot.discovery),
    providerDiscovery: snapshot.discovery,
    providerModelDiscovery,
    modelCatalog: projectModelCatalog({
      discovery: providerModelDiscovery,
      configuredTargets,
      ...(metadata.status === "available" ? { metadata: metadata.records } : {}),
    }),
  };
}
