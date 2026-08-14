import type { ExecutionRouteCatalog, GuiProviderModelDiscoveryProjection } from "@kilnai/gateway-contracts";
import {
  projectAvailableModelCatalogForExecutionRoutes,
} from "@kilnai/runtime";

/** Read-only CLI projection. Runtime remains the sole discovery/configuration join owner. */
export function projectAvailableModelDiagnostic(input: {
  readonly discovery: GuiProviderModelDiscoveryProjection;
  readonly executionRouteCatalog: ExecutionRouteCatalog;
}) {
  return projectAvailableModelCatalogForExecutionRoutes(input);
}
