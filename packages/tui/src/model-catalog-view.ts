import type { ModelCatalog } from "@kilnai/gateway-contracts";

/** Compact TUI projection of the same model catalog used by every operator surface. */
export function formatModelCatalog(catalog: ModelCatalog | null): string {
  if (!catalog) return "Models: waiting for Runtime catalog.";
  if (catalog.models.length === 0) return "Models: none discovered.";
  return [
    "Models:",
    ...catalog.models.map((model) => (
      `${model.providerId}/${model.providerModelId} — ${model.discovery}, ${model.eligibility}, ${model.targets.length > 0 ? "configured" : "setup required"}`
    )),
  ].join("\n");
}
