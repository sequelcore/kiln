import { readStoredExecutionRouteSelection } from "./session-store-persistence.js";
import type { SessionStoreState } from "./session-store-state.js";

/**
 * Decides whether a persisted execution-route selection should be restored right
 * now, given catalog readiness and any active/explicit selection already in
 * place. Shared between connection-lifecycle (on sender attach) and
 * execution-route lifecycle (on welcome/catalog refresh); no single slice owns it.
 * Pure, no store dependency.
 */

export function resolveStoredExecutionRouteSelectionRestore(
  state: SessionStoreState,
  options: { readonly allowActiveOverride?: boolean } = {},
): { readonly routeId: string; readonly accountOverrideId?: string } | null {
  if (
    state.executionRouteSelecting
    || state.providerCatalogStatus !== "ready"
    || !state.outboundSend
  ) {
    return null;
  }
  const stored = readStoredExecutionRouteSelection();
  if (!stored) {
    return null;
  }
  const route = state.executionRouteCatalog.routes.find((candidate) => candidate.routeId === stored.routeId);
  if (!route || route.availability !== "available") {
    return null;
  }
  if (!options.allowActiveOverride && state.activeRouteId) {
    return null;
  }
  if (options.allowActiveOverride && state.activeRouteId === stored.routeId) {
    return null;
  }
  return stored;
}
