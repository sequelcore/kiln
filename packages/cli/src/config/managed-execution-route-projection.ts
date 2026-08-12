import {
  admitOperatorExecutionIntent,
  type AdmittedExecutionRoute,
  type ExecutionCatalog,
  type ExecutionRoute,
} from "@kilnai/core";
import type { KilnManagedAgentRouteConfig } from "../kiln-yaml-types.js";

export interface ManagedDirectExecutionRouteProjection {
  readonly route: Extract<KilnManagedAgentRouteConfig, { readonly kind: "direct" }>;
  readonly executionRoute: ExecutionRoute;
  readonly admission: AdmittedExecutionRoute;
}

/**
 * Resolves a managed direct route through the one operator execution catalog.
 * The managed-agent declaration contributes only the route reference; physical
 * provider/model/account identity is returned by Core admission.
 */
export function admitManagedDirectExecutionRoute(
  catalog: ExecutionCatalog | undefined,
  route: Extract<KilnManagedAgentRouteConfig, { readonly kind: "direct" }>,
): ManagedDirectExecutionRouteProjection {
  if (!catalog) {
    throw new Error(
      `Managed direct route '${route.id}' requires executionCatalog; direct route identity cannot be inferred from managed-agent config.`,
    );
  }
  const executionRoute = catalog.routes.find(({ id }) => id === route.executionRouteId);
  if (!executionRoute) {
    throw new Error(
      `Managed direct route '${route.id}' references unavailable execution route '${route.executionRouteId}'.`,
    );
  }
  return {
    route,
    executionRoute,
    admission: admitOperatorExecutionIntent(catalog, { routeId: route.executionRouteId }),
  };
}
