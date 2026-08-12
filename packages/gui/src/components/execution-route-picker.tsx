import type { ExecutionRouteCatalog, ExecutionRouteRepairAction } from "@kilnai/gateway-contracts";
import { projectExecutionRoutePicker } from "./execution-route-picker-model.js";

export interface ExecutionRouteRepairRequest {
  readonly routeId: string;
  readonly providerId: string;
  readonly action: ExecutionRouteRepairAction;
}

export function ExecutionRoutePicker(props: {
  readonly catalog: ExecutionRouteCatalog;
  readonly activeRouteId?: string | null;
  readonly onSelect: (selection: { routeId: string; accountOverrideId?: string }) => void;
  readonly onRepair: (request: ExecutionRouteRepairRequest) => void | Promise<void>;
}) {
  return <div id="execution-route-picker" aria-label="Execution routes">{projectExecutionRoutePicker(props.catalog).map((route) => <div key={route.routeId}><button type="button" disabled={!route.available} aria-pressed={props.activeRouteId === route.routeId} onClick={() => props.onSelect({ routeId: route.routeId })}>{route.label}</button>{!route.available && <><p>{route.reason}</p><div aria-label={`${route.label} repair actions`}>{route.repairActions.map((action) => {
    const label = repairActionLabel(action, route.providerId);
    return label ? <button key={action} type="button" onClick={() => { void props.onRepair({ routeId: route.routeId, providerId: route.providerId, action }); }}>{label}</button> : <span key={action}>{action}</span>;
  })}</div></>}{route.available && route.accountOptions.length > 1 && <select aria-label={`${route.label} account override`} onChange={(event) => props.onSelect({ routeId: route.routeId, ...(event.target.value ? { accountOverrideId: event.target.value } : {}) })}>{route.accountOptions.map((option) => <option key={option.id} value={option.id}>{option.mode === "automatic" ? "Automatic" : option.id}</option>)}</select>}</div>)}</div>;
}

function repairActionLabel(action: ExecutionRouteRepairAction, providerId: string): string | null {
  switch (action) {
    case "authenticate-provider":
      return `Authenticate ${providerId}`;
    case "refresh-route-catalog":
      return "Refresh execution routes";
    default:
      return null;
  }
}
