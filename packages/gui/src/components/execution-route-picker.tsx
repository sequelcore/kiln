import type { ExecutionRouteCatalog, ExecutionRouteRepairAction } from "@kilnai/gateway-contracts";
import { useMemo, useReducer } from "react";
import { ModelSelectorCommand } from "@/components/ai-elements/model-selector";
import { CommandInput } from "@/components/ui/command";
import { ExecutionRouteBrandRail } from "./execution-route-brand-rail.js";
import { ExecutionRouteList } from "./execution-route-list.js";
import { executionRouteBrands, filterExecutionRouteOptions, projectExecutionRoutePicker, type ExecutionRouteAccessFilter } from "./execution-route-picker-model.js";
import { ExecutionRouteTypeFilter } from "./execution-route-type-filter.js";

export interface ExecutionRouteRepairRequest { readonly routeId: string; readonly providerId: string; readonly action: ExecutionRouteRepairAction; }
export type ExecutionRouteSelectionStatus =
  | { readonly state: "idle" }
  | { readonly state: "selecting"; readonly routeId: string }
  | { readonly state: "failed"; readonly message: string };
type PickerState = { readonly query: string; readonly brandId: string | null; readonly access: ExecutionRouteAccessFilter };
type PickerAction = { readonly type: "query"; readonly query: string } | { readonly type: "brand"; readonly brandId: string | null } | { readonly type: "access"; readonly access: ExecutionRouteAccessFilter };
function reducer(state: PickerState, action: PickerAction): PickerState {
  if (action.type === "query") return { ...state, query: action.query, ...(action.query.trim() ? { brandId: null } : {}) };
  if (action.type === "brand") return { ...state, brandId: action.brandId, query: "" };
  return { ...state, access: action.access };
}

export function ExecutionRoutePicker(props: {
  readonly catalog: ExecutionRouteCatalog;
  readonly activeRouteId?: string | null;
  readonly activeAccountOverrideId?: string | null;
  readonly selectionStatus?: ExecutionRouteSelectionStatus;
  readonly onSelect: (selection: { routeId: string; accountOverrideId?: string }) => void;
  readonly onRepair: (request: ExecutionRouteRepairRequest) => void | Promise<void>;
}) {
  const rows = useMemo(() => projectExecutionRoutePicker(props.catalog), [props.catalog]);
  const [state, dispatch] = useReducer(reducer, { query: "", brandId: null, access: "all" });
  const routes = useMemo(() => filterExecutionRouteOptions(rows, state), [rows, state]);
  const selectionStatus = props.selectionStatus ?? { state: "idle" };
  const selectedRouteLabel = selectionStatus.state === "selecting"
    ? rows.find((route) => route.routeId === selectionStatus.routeId)?.label ?? selectionStatus.routeId
    : null;
  return <ModelSelectorCommand id="execution-route-picker" label="Search execution targets" shouldFilter={false}>
    <CommandInput aria-label="Search execution targets" placeholder="Search execution targets…" value={state.query} onValueChange={(query) => dispatch({ type: "query", query })} />
    <div className="flex min-h-0 border-t border-border/70">
      <ExecutionRouteBrandRail brands={executionRouteBrands(rows)} selectedBrandId={state.brandId} onSelectBrand={(brandId) => dispatch({ type: "brand", brandId })} />
      <div className="flex min-w-0 flex-1 flex-col border-l border-border/70">
        <div className="flex items-center gap-1 border-b border-border/70 p-1.5"><ExecutionRouteTypeFilter value={state.access} onChange={(access) => dispatch({ type: "access", access })} /></div>
        {selectionStatus.state === "selecting" ? (
          <div role="status" aria-live="polite" className="border-b border-border/70 px-2.5 py-2 text-xs text-muted-foreground">
            Selecting {selectedRouteLabel}…
          </div>
        ) : null}
        {selectionStatus.state === "failed" ? (
          <div role="alert" className="border-b border-destructive/30 px-2.5 py-2 text-xs text-destructive">
            {selectionStatus.message}
          </div>
        ) : null}
        <ExecutionRouteList routes={routes} activeRouteId={props.activeRouteId} activeAccountOverrideId={props.activeAccountOverrideId} selectionPending={selectionStatus.state === "selecting"} onSelect={props.onSelect} onRepair={props.onRepair} />
      </div>
    </div>
  </ModelSelectorCommand>;
}
