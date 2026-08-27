import type { StateCreator } from "zustand";
import {
  clearStoredContinuationTarget,
  persistPlanMode,
  readStoredPlanMode,
  writeStoredExecutionTargetSelection,
} from "./session-store-persistence.js";
import { resolveStoredExecutionTargetSelectionRestore } from "./execution-target-selection-restore.js";
import {
  nextExecutionTargetSelectionRequestId,
  nextModelCatalogRefreshRequestId,
  nextProviderAuthRequestId,
} from "./provider-request-correlation.js";
import { normalizeProviderDescriptors } from "./provider-catalog-projection.js";
import type { ExecutionTargetLifecycleActions, SessionStore } from "./session-store-state.js";

const TARGET_SELECTION_TIMEOUT_MS = 5_000;
const MODEL_CATALOG_REFRESH_TIMEOUT_MS = 15_000;
const PROVIDER_AUTH_TIMEOUT_MS = 15 * 60 * 1_000;

export const createExecutionTargetLifecycleSlice: StateCreator<SessionStore, [], [], ExecutionTargetLifecycleActions> = (set, get) => ({
  markProviderCatalogRefreshing: () => set({ providerCatalogStatus: "refreshing", providerCatalogError: null }),
  markProviderCatalogError: (message) => set({ providerCatalogStatus: "error", providerCatalogError: message }),

  onWelcome: (frame) => {
    const state = get();
    if (state.executionTargetSelectionTimeoutId) clearTimeout(state.executionTargetSelectionTimeoutId);
    if (state.modelCatalogRefreshTimeoutId) clearTimeout(state.modelCatalogRefreshTimeoutId);
    if (state.providerAuthTimeoutId) clearTimeout(state.providerAuthTimeoutId);
    const planMode = readStoredPlanMode() ?? frame.executionMode === "plan";
    clearStoredContinuationTarget();
    set({
      modelCatalog: frame.modelCatalog,
      activeTargetId: frame.activeTargetId ?? null,
      authorityStatus: frame.authorityStatus ?? state.authorityStatus,
      planMode,
      status: "ready",
      providerCatalogStatus: "pending",
      providerCatalogError: null,
      providerOperationFailure: null,
      executionTargetSelecting: false,
      executionTargetSelectionTarget: null,
      executionTargetSelectionTimeoutId: null,
      modelCatalogRefresh: { state: "idle" },
      modelCatalogRefreshTimeoutId: null,
      providerAuthenticating: false,
      providerAuthTarget: null,
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: null,
    });
    persistPlanMode(planMode);
    restoreSelection(get(), true);
  },

  onModelCatalogRefreshed: (frame) => {
    const state = get();
    if (state.modelCatalogRefresh.state !== "refreshing" || state.modelCatalogRefresh.requestId !== frame.requestId) return;
    if (state.modelCatalogRefreshTimeoutId) clearTimeout(state.modelCatalogRefreshTimeoutId);
    set({
      modelCatalog: frame.modelCatalog,
      providerCatalogStatus: "ready",
      providerCatalogError: null,
      modelCatalogRefresh: { state: "idle" },
      modelCatalogRefreshTimeoutId: null,
    });
    restoreSelection(get());
  },

  onProviderCatalogState: (frame) => {
    if (frame.status === "error") {
      set({ providerCatalogStatus: "error", providerCatalogError: frame.message });
      return;
    }
    if (frame.status !== "ready") {
      set({ providerCatalogStatus: frame.status, providerCatalogError: null });
      return;
    }
    set({
      providerCatalogStatus: "ready",
      providerCatalogError: null,
      providerDiscovery: frame.providerDiscovery,
      providerModelDiscovery: frame.providerModelDiscovery,
      modelCatalog: frame.modelCatalog,
    });
    restoreSelection(get());
  },

  onModelCatalogRefreshFailed: (frame) => {
    const state = get();
    if (state.modelCatalogRefresh.state !== "refreshing" || state.modelCatalogRefresh.requestId !== frame.requestId) return;
    if (state.modelCatalogRefreshTimeoutId) clearTimeout(state.modelCatalogRefreshTimeoutId);
    set({
      modelCatalogRefresh: { state: "failed", message: frame.message },
      modelCatalogRefreshTimeoutId: null,
      providerCatalogStatus: "error",
      providerCatalogError: frame.message,
    });
  },

  onExecutionTargetWizardResult: (frame) => {
    set({
      executionTargetWizardResult: frame,
      ...(frame.status === "created" ? { modelCatalog: frame.modelCatalog } : {}),
    });
  },

  onExecutionTargetChanged: (frame) => {
    const state = get();
    const target = state.executionTargetSelectionTarget;
    if (!state.executionTargetSelecting || !target || target.requestId !== frame.requestId || target.targetId !== frame.targetId) return;
    if (state.executionTargetSelectionTimeoutId) clearTimeout(state.executionTargetSelectionTimeoutId);
    set({
      activeTargetId: frame.targetId,
      activeAccountOverrideId: target.accountOverrideId ?? null,
      routeMode: "user",
      executionTargetSelecting: false,
      executionTargetSelectionTarget: null,
      executionTargetSelectionTimeoutId: null,
      providerOperationFailure: null,
    });
    writeStoredExecutionTargetSelection(frame.targetId, target.accountOverrideId);
  },

  onExecutionTargetChangeFailed: (frame) => {
    const state = get();
    const target = state.executionTargetSelectionTarget;
    if (!state.executionTargetSelecting || !target || target.requestId !== frame.requestId || target.targetId !== frame.targetId) return;
    if (state.executionTargetSelectionTimeoutId) clearTimeout(state.executionTargetSelectionTimeoutId);
    set({
      executionTargetSelecting: false,
      executionTargetSelectionTarget: null,
      executionTargetSelectionTimeoutId: null,
      providerOperationFailure: { operation: "select-target", requestId: frame.requestId, message: frame.reason },
    });
  },

  selectExecutionTarget: (targetId, accountOverrideId) => {
    const state = get();
    if (!state.outboundSend) {
      set({ providerOperationFailure: { operation: "select-target", message: "Model selection requires an active gateway connection." } });
      return false;
    }
    const target = state.modelCatalog.models.flatMap((model) => model.targets)
      .find((candidate) => candidate.targetId === targetId);
    if (target?.availability !== "available" || (accountOverrideId && !target.accountOverrideIds.includes(accountOverrideId))) {
      set({ providerOperationFailure: { operation: "select-target", message: `Execution target '${targetId}' is unavailable.` } });
      return false;
    }
    if (state.executionTargetSelectionTimeoutId) clearTimeout(state.executionTargetSelectionTimeoutId);
    const requestId = nextExecutionTargetSelectionRequestId();
    const timeoutId = setTimeout(() => {
      if (get().executionTargetSelectionTarget?.requestId !== requestId) return;
      set({
        executionTargetSelecting: false,
        executionTargetSelectionTarget: null,
        executionTargetSelectionTimeoutId: null,
        providerOperationFailure: { operation: "select-target", requestId, message: "Model selection timed out. Please retry." },
      });
    }, TARGET_SELECTION_TIMEOUT_MS);
    set({
      executionTargetSelecting: true,
      executionTargetSelectionTarget: { targetId, ...(accountOverrideId ? { accountOverrideId } : {}), requestId },
      executionTargetSelectionTimeoutId: timeoutId,
      providerOperationFailure: null,
    });
    try {
      state.outboundSend({ type: "execution_target", targetId, ...(accountOverrideId ? { accountOverrideId } : {}), requestId });
    } catch (error) {
      clearTimeout(timeoutId);
      set({
        executionTargetSelecting: false,
        executionTargetSelectionTarget: null,
        executionTargetSelectionTimeoutId: null,
        providerOperationFailure: { operation: "select-target", requestId, message: error instanceof Error ? error.message : "Model selection failed." },
      });
      return false;
    }
    return true;
  },

  refreshModelCatalog: () => {
    const state = get();
    if (!state.outboundSend || state.modelCatalogRefresh.state === "refreshing") return false;
    if (state.modelCatalogRefreshTimeoutId) clearTimeout(state.modelCatalogRefreshTimeoutId);
    const requestId = nextModelCatalogRefreshRequestId();
    const timeoutId = setTimeout(() => {
      const latest = get();
      if (latest.modelCatalogRefresh.state !== "refreshing" || latest.modelCatalogRefresh.requestId !== requestId) return;
      const message = "Model catalog refresh timed out. Please retry.";
      set({ modelCatalogRefresh: { state: "failed", message }, modelCatalogRefreshTimeoutId: null });
    }, MODEL_CATALOG_REFRESH_TIMEOUT_MS);
    set({ modelCatalogRefresh: { state: "refreshing", requestId }, modelCatalogRefreshTimeoutId: timeoutId });
    try {
      state.outboundSend({ type: "refresh_model_catalog", requestId });
    } catch (error) {
      clearTimeout(timeoutId);
      set({
        modelCatalogRefresh: { state: "failed", message: error instanceof Error ? error.message : "Model catalog refresh failed." },
        modelCatalogRefreshTimeoutId: null,
      });
      return false;
    }
    return true;
  },

  onProviderAuthStarted: (frame) => {
    const state = get();
    if (state.providerAuthTarget?.requestId !== frame.requestId || state.providerAuthTarget.provider !== frame.provider) return;
    set({
      providerAuthMessage: frame.message ?? "Complete provider sign-in, then return to Kiln.",
      providerAuthDetails: frame.method === "browser_oauth"
        ? { method: "browser_oauth", authorizationUri: frame.authorizationUri }
        : { method: "device_code", verificationUri: frame.verificationUri, userCode: frame.userCode },
      providerOperationFailure: null,
    });
  },
  onProviderAuthCompleted: (frame) => {
    const state = get();
    if (state.providerAuthTarget?.requestId !== frame.requestId || state.providerAuthTarget.provider !== frame.provider) return;
    if (state.providerAuthTimeoutId) clearTimeout(state.providerAuthTimeoutId);
    set({
      providers: normalizeProviderDescriptors(frame.providers ?? state.providers),
      providerDiscovery: frame.providerDiscovery ?? state.providerDiscovery,
      providerModelDiscovery: frame.providerModelDiscovery,
      modelCatalog: frame.modelCatalog,
      providerCatalogStatus: "ready",
      providerCatalogError: null,
      providerAuthenticating: false,
      providerAuthTarget: null,
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: null,
      providerOperationFailure: null,
    });
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
    const timeoutId = setTimeout(() => {
      if (get().providerAuthTarget?.requestId !== requestId) return;
      set({ providerAuthenticating: false, providerAuthTarget: null, providerAuthMessage: null, providerAuthDetails: null, providerAuthTimeoutId: null, providerOperationFailure: { operation: "authenticate", provider, requestId, message: "Provider authentication timed out. Please retry." } });
    }, PROVIDER_AUTH_TIMEOUT_MS);
    set({ providerAuthenticating: true, providerAuthTarget: { provider, requestId }, providerAuthMessage: null, providerAuthDetails: null, providerAuthTimeoutId: timeoutId, providerOperationFailure: null });
    try {
      state.outboundSend({ type: "provider_auth", provider, requestId, ...(provider === "codex-oauth" ? { flow: "browser" as const } : {}), ...(options.apiKey ? { apiKey: options.apiKey } : {}), ...(options.tier ? { tier: options.tier } : {}) });
    } catch (error) {
      clearTimeout(timeoutId);
      set({ providerAuthenticating: false, providerAuthTarget: null, providerAuthTimeoutId: null, providerOperationFailure: { operation: "authenticate", provider, requestId, message: error instanceof Error ? error.message : "Provider authentication failed." } });
      return false;
    }
    return true;
  },
});

function restoreSelection(state: SessionStore, allowActiveOverride = false): void {
  const restore = resolveStoredExecutionTargetSelectionRestore(state, { allowActiveOverride });
  if (restore) state.selectExecutionTarget(restore.targetId, restore.accountOverrideId);
}
