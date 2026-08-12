import { isObjectRecord, readString } from "./unknown-value.js";

/**
 * localStorage boundary for session-store persisted preferences: plan mode,
 * the continuation target, and the last explicit execution-route selection. Pure
 * (fails open on storage errors), no store dependency.
 */

const PLAN_MODE_KEY = "kiln.gui.planMode";
const CONTINUATION_TARGET_KEY = "kiln.gui.continuationTarget";
const EXECUTION_ROUTE_SELECTION_KEY = "kiln.gui.executionRouteSelection:v1";

export function readStoredPlanMode(): boolean | null {
  try {
    const value = localStorage.getItem(PLAN_MODE_KEY);
    if (value === null) return null;
    return value === "true";
  } catch {
    return null;
  }
}

export function persistPlanMode(value: boolean): void {
  try {
    localStorage.setItem(PLAN_MODE_KEY, value ? "true" : "false");
  } catch {
    // fail-open
  }
}

export function readStoredExecutionRouteSelection(): { readonly routeId: string; readonly accountOverrideId?: string } | null {
  try {
    const raw = localStorage.getItem(EXECUTION_ROUTE_SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectRecord(parsed)) return null;
    const routeId = readString(parsed.routeId);
    if (!routeId) return null;
    return {
      routeId,
      ...(readString(parsed.accountOverrideId) ? { accountOverrideId: readString(parsed.accountOverrideId)! } : {}),
    };
  } catch {
    return null;
  }
}

export function writeStoredExecutionRouteSelection(routeId: string, accountOverrideId?: string): void {
  try {
    localStorage.setItem(EXECUTION_ROUTE_SELECTION_KEY, JSON.stringify({
      routeId,
      ...(accountOverrideId ? { accountOverrideId } : {}),
    }));
  } catch {
    // fail-open
  }
}

export function clearStoredContinuationTarget(): void {
  try {
    localStorage.removeItem(CONTINUATION_TARGET_KEY);
  } catch {
    // fail-open
  }
}
