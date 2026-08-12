import {
  getGuiProviderMetadata,
  type ExecutionRouteCatalog,
  type ExecutionRouteCatalogEntry,
  type ExecutionRouteRepairAction,
  type GuiProviderAccess,
} from "@kilnai/gateway-contracts";

export type ExecutionRouteAccessFilter = GuiProviderAccess | "all";

export interface ExecutionRouteAccountOption {
  readonly id: string | undefined;
  readonly mode: "automatic" | "exact";
}

export interface ExecutionRoutePickerRow {
  readonly routeId: string;
  readonly label: string;
  /** Derived display evidence only; routeId remains the selection authority. */
  readonly providerId: string;
  /** Derived display evidence only; routeId remains the selection authority. */
  readonly providerModelId: string;
  readonly brandId: string;
  readonly brandLabel: string;
  readonly access: GuiProviderAccess | null;
  readonly free: boolean;
  readonly available: boolean;
  readonly reason?: string;
  readonly repairActions: readonly ExecutionRouteRepairAction[];
  readonly accountOptions: readonly ExecutionRouteAccountOption[];
  readonly searchText: string;
}

export interface ExecutionRouteBrandOption {
  readonly id: string;
  readonly label: string;
}

export const EXECUTION_ROUTE_ACCESS_ORDER: readonly GuiProviderAccess[] = ["subscription", "harness", "api", "local"];
export const EXECUTION_ROUTE_ACCESS_LABEL: Readonly<Record<GuiProviderAccess, string>> = {
  subscription: "Subscription",
  harness: "Harness",
  api: "API",
  local: "Local",
};

export function projectExecutionRoutePicker(catalog: ExecutionRouteCatalog): readonly ExecutionRoutePickerRow[] {
  return catalog.routes.map(projectRoute);
}

export function executionRouteBrands(routes: readonly ExecutionRoutePickerRow[]): readonly ExecutionRouteBrandOption[] {
  const seen = new Set<string>();
  return routes.flatMap((route) => {
    if (seen.has(route.brandId)) return [];
    seen.add(route.brandId);
    return [{ id: route.brandId, label: getGuiProviderMetadata(route.brandId)?.label ?? route.brandLabel }];
  });
}

export function filterExecutionRouteOptions(
  routes: readonly ExecutionRoutePickerRow[],
  filters: { readonly query: string; readonly brandId: string | null; readonly access: ExecutionRouteAccessFilter },
): readonly ExecutionRoutePickerRow[] {
  const terms = filters.query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return routes.filter((route) =>
    (filters.brandId === null || route.brandId === filters.brandId) &&
    (filters.access === "all" || route.access === filters.access) &&
    terms.every((term) => route.searchText.includes(term)),
  );
}

export function conciseExecutionRouteUnavailableReason(reason: string): string {
  return reason.length > 72 ? `${reason.slice(0, 69).trimEnd()}…` : reason;
}

function projectRoute(route: ExecutionRouteCatalogEntry): ExecutionRoutePickerRow {
  const metadata = getGuiProviderMetadata(route.providerId);
  const brandId = metadata?.brandId ?? route.providerId;
  const accountOptions: readonly ExecutionRouteAccountOption[] = route.accountSelection.mode === "automatic"
    ? [{ id: undefined, mode: "automatic" }, ...(route.accountOverrideIds ?? []).map((id) => ({ id, mode: "exact" as const }))]
    : [{ id: undefined, mode: "exact" }];
  return {
    routeId: route.routeId,
    label: route.label,
    providerId: route.providerId,
    providerModelId: route.providerModelId,
    brandId,
    brandLabel: metadata?.label ?? route.providerId,
    access: metadata?.access ?? null,
    free: metadata?.free ?? false,
    available: route.availability === "available",
    ...(route.availability === "available" ? {} : { reason: route.reasonCodes.join(", ") }),
    repairActions: route.repairActions,
    accountOptions,
    searchText: [route.label, route.providerId, route.providerModelId, metadata?.label, ...accountOptions.map((option) => option.id ?? "automatic")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}
