import type {
  AvailableModelCatalog,
  AvailableModelCatalogEntry,
  AvailableModelReasonCode,
  ExecutionRouteCatalog,
  GuiProviderModelDiscoveryProjection,
} from "@kilnai/gateway-contracts";

export interface AvailableModelConfiguredRouteIdentity {
  readonly routeId: string;
  readonly label: string;
  readonly providerId: string;
  readonly providerModelId: string;
}

export function projectAvailableModelCatalog(input: {
  readonly discovery: GuiProviderModelDiscoveryProjection;
  readonly configuredRoutes: readonly AvailableModelConfiguredRouteIdentity[];
}): AvailableModelCatalog {
  return {
    observedAt: input.discovery.catalogEvidence.observedAt,
    entries: input.discovery.entries
      .map((entry): AvailableModelCatalogEntry => {
        const refs = input.configuredRoutes
          .filter((route) => route.providerId === entry.providerRoute.providerId
            && route.providerModelId === entry.providerRoute.providerModelId)
          .map(({ routeId, label }) => ({ routeId, label }))
          .sort((left, right) => left.routeId.localeCompare(right.routeId));
        const discoveryState = input.discovery.catalogEvidence.status === "failed"
          ? "failed" as const
          : entry.freshness.status === "stale" ? "stale" as const : "observed" as const;
        const eligibilityState = discoveryState === "failed"
          ? "unknown" as const
          : entry.eligibility.eligible ? "eligible" as const
            : entry.eligibility.reasonCodes.length > 0 ? "ineligible" as const : "unknown" as const;
        const availabilityState = discoveryState !== "observed"
          ? "unknown" as const
          : entry.routeHealth.status === "healthy" && eligibilityState === "eligible"
            ? "available" as const
            : entry.routeHealth.status === "unhealthy" || eligibilityState === "ineligible"
              ? "unavailable" as const : "unknown" as const;
        const reasonCodes: AvailableModelReasonCode[] = [
          discoveryState === "observed" ? "discovery-observed" : discoveryState === "stale" ? "discovery-stale" : "discovery-failed",
          eligibilityState === "eligible" ? "model-eligible" : eligibilityState === "ineligible" ? "policy-ineligible" : "eligibility-unknown",
          availabilityState === "available" ? "model-available" : availabilityState === "unavailable" ? "model-unavailable" : "availability-unknown",
          refs.length > 0 ? "configured-route-present" : "route-not-configured",
        ];
        return {
          providerId: entry.providerRoute.providerId,
          providerRouteId: entry.providerRoute.scope,
          providerModelId: entry.providerRoute.providerModelId,
          discoveryState,
          eligibilityState,
          availabilityState,
          configuredState: refs.length > 0 ? "configured" : "unconfigured",
          configuredRouteRefs: refs,
          reasonCodes,
        };
      })
      .sort((left, right) => left.providerId.localeCompare(right.providerId)
        || left.providerRouteId.localeCompare(right.providerRouteId)
        || left.providerModelId.localeCompare(right.providerModelId)),
  };
}

/**
 * The only Runtime projection joining discovery evidence to configured routes.
 * Operator surfaces receive this value as-is; it is not an execution selector.
 */
export function projectAvailableModelCatalogForExecutionRoutes(input: {
  readonly discovery: GuiProviderModelDiscoveryProjection;
  readonly executionRouteCatalog: ExecutionRouteCatalog;
}): AvailableModelCatalog {
  return projectAvailableModelCatalog({
    discovery: input.discovery,
    configuredRoutes: input.executionRouteCatalog.routes.map((route) => ({
      routeId: route.routeId,
      label: route.label,
      providerId: route.providerId,
      providerModelId: route.providerModelId,
    })),
  });
}
