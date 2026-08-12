import type {
  ExecutionRouteCatalog,
  ExecutionRouteCatalogEntry,
  ExecutionRouteRepairAction,
  ExecutionRouteReasonCode,
  ExecutionRouteSelectionIntent,
} from "@kilnai/gateway-contracts";

/**
 * Composition boundary for operator surfaces. The host owns configuration and
 * execution-service construction; Runtime accepts only a secret-free route
 * catalog and an admission result.
 */
export interface OperatorExecutionRouteAdmission {
  readonly routeId: string;
  /** Derived materialization data. Never accept these from an operator frame. */
  readonly providerId: string;
  readonly providerModelId: string;
}

export type OperatorExecutionRouteAdmissionResult =
  | { readonly ok: true; readonly admission: OperatorExecutionRouteAdmission }
  | {
    readonly ok: false;
    readonly reasonCode: ExecutionRouteReasonCode;
    readonly reason: string;
    readonly repairActions: readonly ExecutionRouteRepairAction[];
  };

export interface OperatorExecutionRouteSelectionPort {
  getCatalog(): Promise<ExecutionRouteCatalog>;
  admit(intent: ExecutionRouteSelectionIntent): Promise<OperatorExecutionRouteAdmissionResult>;
}

export function rejectUnavailableExecutionRoute(
  catalog: ExecutionRouteCatalog,
  intent: ExecutionRouteSelectionIntent,
): OperatorExecutionRouteAdmissionResult | undefined {
  const route = catalog.routes.find(({ routeId }) => routeId === intent.routeId);
  if (!route) {
    return { ok: false, reasonCode: "route-not-configured", reason: `Execution route '${intent.routeId}' is not configured.`, repairActions: ["refresh-route-catalog", "review-route-configuration"] };
  }
  if (route.availability !== "available") {
    return unavailable(route);
  }
  if (intent.accountOverrideId && !route.accountOverrideIds?.includes(intent.accountOverrideId)) {
    return { ok: false, reasonCode: "account-unavailable", reason: `Account override '${intent.accountOverrideId}' is not available for route '${route.routeId}'.`, repairActions: ["check-account", "select-another-route"] };
  }
  return undefined;
}

function unavailable(route: ExecutionRouteCatalogEntry): OperatorExecutionRouteAdmissionResult {
  return {
    ok: false,
    reasonCode: route.reasonCodes[0] ?? "unknown",
    reason: `Execution route '${route.routeId}' is ${route.availability}.`,
    repairActions: route.repairActions,
  };
}
