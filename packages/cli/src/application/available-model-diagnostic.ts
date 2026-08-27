import type { GuiProviderModelDiscoveryProjection } from "@kilnai/gateway-contracts";
import {
  projectModelCatalog,
  type ConfiguredModelTarget,
} from "@kilnai/runtime";

/** Read-only CLI projection. Runtime remains the sole discovery/configuration join owner. */
export function projectAvailableModelDiagnostic(input: {
  readonly discovery: GuiProviderModelDiscoveryProjection;
  readonly configuredTargets: readonly ConfiguredModelTarget[];
}) {
  return projectModelCatalog(input);
}
