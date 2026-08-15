import {
  admitOperatorExecutionIntent,
  type AdmittedExecutionRoute,
  type ExecutionCatalog,
  type ExecutionRoute,
} from "@kilnai/core";
import type { ResolvedManagedTargetConfig } from "./resolved-managed-target.js";

export interface ManagedDirectTargetAdmission {
  readonly target: Extract<ResolvedManagedTargetConfig, { readonly kind: "direct" }>;
  readonly executionRoute: ExecutionRoute;
  readonly admission: AdmittedExecutionRoute;
}

export function admitManagedDirectTarget(
  catalog: ExecutionCatalog | undefined,
  target: Extract<ResolvedManagedTargetConfig, { readonly kind: "direct" }>,
): ManagedDirectTargetAdmission {
  if (!catalog) throw new Error(`Managed direct target '${target.id}' requires the global target catalog.`);
  const executionRoute = catalog.routes.find(({ id }) => id === target.id);
  if (!executionRoute) throw new Error(`Managed direct target '${target.id}' is unavailable.`);
  return {
    target,
    executionRoute,
    admission: admitOperatorExecutionIntent(catalog, { routeId: target.id }),
  };
}
