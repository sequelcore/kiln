import type { ExecutionRouteCatalog, ExecutionRouteCatalogEntry, ExecutionRouteRepairAction } from "@kilnai/gateway-contracts";

export interface ExecutionRoutePickerRow {
  readonly routeId: string;
  readonly label: string;
  readonly providerId: string;
  readonly available: boolean;
  readonly reason?: string;
  readonly repairActions: readonly ExecutionRouteRepairAction[];
  readonly accountOptions: readonly { readonly id: string; readonly mode: "automatic" | "exact" }[];
}

export function projectExecutionRoutePicker(catalog: ExecutionRouteCatalog): readonly ExecutionRoutePickerRow[] {
  return catalog.routes.map(projectRoute).sort((a, b) => a.label.localeCompare(b.label));
}

function projectRoute(route: ExecutionRouteCatalogEntry): ExecutionRoutePickerRow {
  return {
    routeId: route.routeId,
    label: route.label,
    providerId: route.providerId,
    available: route.availability === "available",
    ...(route.availability === "available" ? {} : { reason: route.reasonCodes.join(", ") }),
    repairActions: route.repairActions,
    accountOptions: [
      { id: "", mode: "automatic" },
      ...((route.accountOverrideIds ?? []).map((id) => ({ id, mode: "exact" as const }))),
    ],
  };
}
