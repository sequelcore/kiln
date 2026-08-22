import type { StateCreator } from "zustand";
import { clearStoredContinuationTarget, persistPlanMode, readStoredPlanMode, writeStoredExecutionRouteSelection } from "./session-store-persistence.js";
import { resolveStoredExecutionRouteSelectionRestore } from "./execution-route-selection-restore.js";
import { nextExecutionRouteSelectionRequestId, nextProviderAuthRequestId } from "./provider-request-correlation.js";
import { normalizeProviderDescriptors } from "./provider-catalog-projection.js";
import type { ExecutionRouteLifecycleActions, SessionStore } from "./session-store-state.js";

const ROUTE_SELECTION_TIMEOUT_MS = 5_000;
const PROVIDER_AUTH_TIMEOUT_MS = 15 * 60 * 1000;

export const createExecutionRouteLifecycleSlice: StateCreator<SessionStore, [], [], ExecutionRouteLifecycleActions> = (set, get) => ({
  markProviderCatalogRefreshing: () => set({ providerCatalogStatus: "refreshing", providerCatalogError: null }),
  markProviderCatalogError: (message) => set({ providerCatalogStatus: "error", providerCatalogError: message }),

  onWelcome: (frame) => {
    const state = get();
    if (state.executionRouteSelectionTimeoutId) clearTimeout(state.executionRouteSelectionTimeoutId);
    if (state.providerAuthTimeoutId) clearTimeout(state.providerAuthTimeoutId);
    const planMode = readStoredPlanMode() ?? (frame.executionMode === "plan");
    clearStoredContinuationTarget();
    set({
      executionRouteCatalog: frame.executionRouteCatalog,
      availableModels: frame.availableModels,
      activeRouteId: frame.activeRouteId ?? null,
      authorityStatus: frame.authorityStatus ?? state.authorityStatus,
      planMode,
      status: "ready",
      providerCatalogStatus: "ready",
      providerCatalogError: null,
      providerOperationFailure: null,
      executionRouteSelecting: false,
      executionRouteSelectionTarget: null,
      executionRouteSelectionTimeoutId: null,
      providerAuthenticating: false,
      providerAuthTarget: null,
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: null,
    });
    persistPlanMode(planMode);
    const restore = resolveStoredExecutionRouteSelectionRestore(get(), { allowActiveOverride: true });
    if (restore) get().selectExecutionRoute(restore.routeId, restore.accountOverrideId);
  },

  onExecutionRoutesRefreshed: (frame) => {
    set({ executionRouteCatalog: frame.executionRouteCatalog, availableModels: frame.availableModels, providerCatalogStatus: "ready", providerCatalogError: null });
    const restore = resolveStoredExecutionRouteSelectionRestore(get());
    if (restore) get().selectExecutionRoute(restore.routeId, restore.accountOverrideId);
  },

  onExecutionTargetWizardResult: (frame) => {
    set({
      executionTargetWizardResult: frame,
      ...(frame.status === "created" ? { executionRouteCatalog: frame.executionRouteCatalog, availableModels: frame.availableModels } : {}),
    });
  },

  onExecutionRouteChanged: (frame) => {
    const state = get();
    const target = state.executionRouteSelectionTarget;
    if (!state.executionRouteSelecting || !target || target.requestId !== frame.requestId || target.routeId !== frame.routeId) return;
    if (state.executionRouteSelectionTimeoutId) clearTimeout(state.executionRouteSelectionTimeoutId);
    set({ activeRouteId: frame.routeId, activeAccountOverrideId: target.accountOverrideId ?? null, routeMode: "user", executionRouteSelecting: false, executionRouteSelectionTarget: null, executionRouteSelectionTimeoutId: null, providerOperationFailure: null });
    writeStoredExecutionRouteSelection(frame.routeId, target.accountOverrideId);
  },

  onExecutionRouteChangeFailed: (frame) => {
    const state = get();
    const target = state.executionRouteSelectionTarget;
    if (!state.executionRouteSelecting || !target || target.requestId !== frame.requestId || target.routeId !== frame.routeId) return;
    if (state.executionRouteSelectionTimeoutId) clearTimeout(state.executionRouteSelectionTimeoutId);
    set({ executionRouteSelecting: false, executionRouteSelectionTarget: null, executionRouteSelectionTimeoutId: null, providerOperationFailure: { operation: "select-route", requestId: frame.requestId, message: frame.reason } });
  },

  selectExecutionRoute: (routeId, accountOverrideId) => {
    const state = get();
    if (!state.outboundSend) return false;
    const route = state.executionRouteCatalog.routes.find((candidate) => candidate.routeId === routeId);
    if (route?.availability !== "available" || (accountOverrideId && !route.accountOverrideIds?.includes(accountOverrideId))) {
      set({ providerOperationFailure: { operation: "select-route", message: route ? `Execution target '${routeId}' is ${route.availability}.` : `Execution target '${routeId}' is unavailable.` } });
      return false;
    }
    if (state.executionRouteSelectionTimeoutId) clearTimeout(state.executionRouteSelectionTimeoutId);
    const requestId = nextExecutionRouteSelectionRequestId();
    const timeoutId = setTimeout(() => {
      const latest = get();
      if (latest.executionRouteSelectionTarget?.requestId !== requestId) return;
      set({ executionRouteSelecting: false, executionRouteSelectionTarget: null, executionRouteSelectionTimeoutId: null, providerOperationFailure: { operation: "select-route", requestId, message: "Execution-route selection timed out. Please retry." } });
    }, ROUTE_SELECTION_TIMEOUT_MS);
    set({ executionRouteSelecting: true, executionRouteSelectionTarget: { routeId, ...(accountOverrideId ? { accountOverrideId } : {}), requestId }, executionRouteSelectionTimeoutId: timeoutId, providerOperationFailure: null });
    try { state.outboundSend({ type: "execution_route", routeId, ...(accountOverrideId ? { accountOverrideId } : {}), requestId }); }
    catch (error) { clearTimeout(timeoutId); set({ executionRouteSelecting: false, executionRouteSelectionTarget: null, executionRouteSelectionTimeoutId: null, providerOperationFailure: { operation: "select-route", requestId, message: error instanceof Error ? error.message : "Execution-route selection failed." } }); return false; }
    return true;
  },

  onProviderAuthStarted: (frame) => {
    const state = get();
    if (state.providerAuthTarget?.requestId !== frame.requestId || state.providerAuthTarget.provider !== frame.provider) return;
    set({ providerAuthMessage: frame.message ?? "Complete provider sign-in, then return to Kiln.", providerAuthDetails: frame.method === "browser_oauth" ? { method: "browser_oauth", authorizationUri: frame.authorizationUri } : { method: "device_code", verificationUri: frame.verificationUri, userCode: frame.userCode }, providerOperationFailure: null });
  },
  onProviderAuthCompleted: (frame) => {
    const state = get();
    if (state.providerAuthTarget?.requestId !== frame.requestId || state.providerAuthTarget.provider !== frame.provider) return;
    if (state.providerAuthTimeoutId) clearTimeout(state.providerAuthTimeoutId);
    set({ providers: normalizeProviderDescriptors(frame.providers ?? state.providers), providerDiscovery: frame.providerDiscovery ?? state.providerDiscovery, providerModelDiscovery: frame.providerModelDiscovery, availableModels: frame.availableModels, executionRouteCatalog: frame.executionRouteCatalog, providerCatalogStatus: "ready", providerCatalogError: null, providerAuthenticating: false, providerAuthTarget: null, providerAuthMessage: null, providerAuthDetails: null, providerAuthTimeoutId: null, providerOperationFailure: null });
  },
  onProviderAuthFailed: (frame) => {
    const state = get();
    if (state.providerAuthTarget?.requestId !== frame.requestId || state.providerAuthTarget.provider !== frame.provider) return;
    if (state.providerAuthTimeoutId) clearTimeout(state.providerAuthTimeoutId);
    set({ providerAuthenticating: false, providerAuthTarget: null, providerAuthMessage: null, providerAuthDetails: null, providerAuthTimeoutId: null, providerOperationFailure: { operation: "authenticate", provider: frame.provider, requestId: frame.requestId, message: frame.message } });
  },
  authenticateProvider: (provider, options = {}) => {
    const state = get();
    if (!state.outboundSend) return false;
    if (state.providerAuthTimeoutId) clearTimeout(state.providerAuthTimeoutId);
    const requestId = nextProviderAuthRequestId();
    const timeoutId = setTimeout(() => { if (get().providerAuthTarget?.requestId === requestId) set({ providerAuthenticating: false, providerAuthTarget: null, providerAuthMessage: null, providerAuthDetails: null, providerAuthTimeoutId: null, providerOperationFailure: { operation: "authenticate", provider, requestId, message: "Provider authentication timed out. Please retry." } }); }, PROVIDER_AUTH_TIMEOUT_MS);
    set({ providerAuthenticating: true, providerAuthTarget: { provider, requestId }, providerAuthMessage: null, providerAuthDetails: null, providerAuthTimeoutId: timeoutId, providerOperationFailure: null });
    try { state.outboundSend({ type: "provider_auth", provider, requestId, ...(provider === "codex-oauth" ? { flow: "browser" as const } : {}), ...(options.apiKey ? { apiKey: options.apiKey } : {}), ...(options.tier ? { tier: options.tier } : {}) }); } catch (error) { clearTimeout(timeoutId); set({ providerAuthenticating: false, providerAuthTarget: null, providerAuthTimeoutId: null, providerOperationFailure: { operation: "authenticate", provider, requestId, message: error instanceof Error ? error.message : "Provider authentication failed." } }); return false; }
    return true;
  },
});
