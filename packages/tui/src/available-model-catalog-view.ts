import type { AvailableModelCatalog } from "@kilnai/gateway-contracts";

/** Compact read-only TUI presentation; selection remains the execution-route picker. */
export function formatAvailableModelCatalog(catalog: AvailableModelCatalog | null): string {
  if (!catalog) return "Available models: waiting for Runtime catalog.";
  if (catalog.entries.length === 0) return "Available models: none discovered.";
  return ["Available models (read-only; choose configured routes in the route picker):", ...catalog.entries.map((entry) => `${entry.providerId}/${entry.providerModelId} — ${entry.discoveryState}, ${entry.eligibilityState}, ${entry.configuredState}`)].join("\n");
}
