import type { StateCreator } from "zustand";
import { readString } from "./unknown-value.js";
import {
  clearStoredContinuationTarget,
  persistPlanMode,
  readStoredPlanMode,
  readStoredProviderSelection,
  writeStoredProviderSelection,
} from "./session-store-persistence.js";
import { resolveStoredProviderSelectionRestore } from "./provider-selection-restore.js";
import {
  nextProviderAuthRequestId,
  nextProviderSwitchRequestId,
  providerAuthDebug,
} from "./provider-request-correlation.js";
import {
  areProviderDescriptorsEqual,
  normalizeProviderDescriptors,
  providerSelectionFailureMessage,
  providerSupportsSelection,
} from "./provider-catalog-projection.js";
import type { ProviderLifecycleActions, SessionStore } from "./session-store-state.js";

/**
 * Provider catalog projection, active-provider selection, and provider
 * OAuth/device-code authentication lifecycle, including bootstrap of the
 * catalog on `welcome` (~90% of `onWelcome`'s body is provider-catalog
 * bootstrap, not connection setup, hence its placement here).
 */

const PROVIDER_SWITCH_TIMEOUT_MS = 5_000;
const PROVIDER_AUTH_TIMEOUT_MS = 15 * 60 * 1000;

export const createProviderLifecycleSlice: StateCreator<
  SessionStore,
  [],
  [],
  ProviderLifecycleActions
> = (set, get) => ({
  markProviderCatalogRefreshing: () => {
    set({
      providerCatalogStatus: "refreshing",
      providerCatalogError: null,
    });
  },

  markProviderCatalogError: (message) => {
    set({
      providerCatalogStatus: "error",
      providerCatalogError: message,
    });
  },

  onWelcome: (frame) => {
    const current = get();
    if (current.providerSwitchTimeoutId) {
      clearTimeout(current.providerSwitchTimeoutId);
    }
    if (current.providerAuthTimeoutId) {
      clearTimeout(current.providerAuthTimeoutId);
    }
    const providers = normalizeProviderDescriptors(frame.providers ?? []);
    const explicitActiveProvider = readString(frame.activeProvider);
    const explicitActiveModel = readString(frame.activeModel);
    const requestedModel = explicitActiveModel ?? null;
    const activeProviderDescriptor = explicitActiveProvider
      ? providers.find((provider) => (
        provider.id === explicitActiveProvider
          && providerSupportsSelection(provider, requestedModel, frame.providerModelDiscovery)
      ))
      : undefined;
    const activeProvider = activeProviderDescriptor ? explicitActiveProvider ?? null : null;
    const activeModel = activeProviderDescriptor ? requestedModel : null;
    const persistedPlanMode = readStoredPlanMode();
    const welcomePlanMode = frame.executionMode ? frame.executionMode === "plan" : undefined;
    const resolvedPlanMode = persistedPlanMode ?? welcomePlanMode ?? current.planMode;
    const explicitSelection = Boolean(activeProvider);
    clearStoredContinuationTarget();

    set({
      providers,
      providerDiscovery: frame.providerDiscovery ?? current.providerDiscovery,
      providerModelDiscovery: frame.providerModelDiscovery,
      providerCatalogStatus: "ready",
      providerCatalogError: null,
      activeProvider,
      activeModel,
      authorityStatus: frame.authorityStatus ?? current.authorityStatus,
      planMode: resolvedPlanMode,
      routeMode: explicitSelection ? "user" : "auto",
      providerExplicitSelection: explicitSelection,
      continuationTargetId: current.continuationTargetId,
      status: "ready",
      providerOperationFailure: explicitActiveProvider && !activeProviderDescriptor
        ? (() => {
            const provider = providers.find((candidate) => candidate.id === explicitActiveProvider);
            const message = provider
              ? providerSelectionFailureMessage(provider, requestedModel, frame.providerModelDiscovery)
              : `${explicitActiveProvider} is unavailable.`;
            return {
              operation: "catalog" as const,
              provider: explicitActiveProvider,
              model: requestedModel,
              message,
            };
          })()
        : null,
      providerSwitching: false,
      providerSwitchTarget: null,
      providerSwitchTimeoutId: null,
      providerAuthenticating: false,
      providerAuthTarget: null,
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: null,
    });
    persistPlanMode(resolvedPlanMode);
    const restore = resolveStoredProviderSelectionRestore(get(), { allowActiveOverride: true });
    if (restore) {
      get().switchProvider(restore.provider, restore.model ?? undefined);
    } else if (activeProvider) {
      writeStoredProviderSelection(activeProvider, activeModel);
    } else {
      const stored = readStoredProviderSelection();
      const storedProvider = stored
        ? providers.find((provider) => provider.id === stored.provider)
        : undefined;
      if (stored && storedProvider && !providerSupportsSelection(
        storedProvider,
        stored.model,
        frame.providerModelDiscovery,
      )) {
        set({
          providerOperationFailure: {
            operation: "catalog",
            provider: storedProvider.id,
            model: stored.model,
            message: providerSelectionFailureMessage(
              storedProvider,
              stored.model,
              frame.providerModelDiscovery,
            ),
          },
        });
      }
    }
  },

  onProvidersRefreshed: (nextProviders, nextProviderDiscovery, nextProviderModelDiscovery) => {
    const current = get();
    const providers = normalizeProviderDescriptors(nextProviders);
    const activeProvider = current.activeProvider;
    const activeModel = current.activeModel;
    const requestedModel = activeModel ?? null;
    const activeStillAvailable = activeProvider
      ? providers.some((provider) => (
        provider.id === activeProvider
          && providerSupportsSelection(
            provider,
            requestedModel,
            nextProviderModelDiscovery ?? current.providerModelDiscovery,
          )
      ))
      : false;
    const nextActiveProvider = activeStillAvailable ? activeProvider : null;
    const nextActiveModel = activeStillAvailable ? activeModel : null;
    const nextProviderExplicitSelection = activeStillAvailable && current.providerExplicitSelection;
    const nextRouteMode = nextProviderExplicitSelection ? "user" : "auto";

    if (
      areProviderDescriptorsEqual(current.providers, providers)
      && current.activeProvider === nextActiveProvider
      && current.activeModel === nextActiveModel
      && current.providerExplicitSelection === nextProviderExplicitSelection
      && current.routeMode === nextRouteMode
      && (nextProviderModelDiscovery === undefined
        || current.providerModelDiscovery === nextProviderModelDiscovery)
    ) {
      return;
    }

    set({
      providers,
      providerDiscovery: nextProviderDiscovery ?? current.providerDiscovery,
      providerModelDiscovery: nextProviderModelDiscovery ?? current.providerModelDiscovery,
      providerCatalogStatus: "ready",
      providerCatalogError: null,
      activeProvider: nextActiveProvider,
      activeModel: nextActiveModel,
      routeMode: nextRouteMode,
      providerExplicitSelection: nextProviderExplicitSelection,
      providerOperationFailure: activeProvider && !activeStillAvailable
        ? (() => {
            const provider = providers.find((candidate) => candidate.id === activeProvider);
            const message = provider
              ? providerSelectionFailureMessage(
                  provider,
                  requestedModel,
                  nextProviderModelDiscovery ?? current.providerModelDiscovery,
                )
              : `${activeProvider} is unavailable.`;
            return {
              operation: "catalog" as const,
              provider: activeProvider,
              model: requestedModel,
              message,
            };
          })()
        : current.providerOperationFailure?.operation === "catalog"
          ? null
          : current.providerOperationFailure,
    });

    const restore = resolveStoredProviderSelectionRestore(get());
    if (restore) {
      get().switchProvider(restore.provider, restore.model ?? undefined);
    }
  },

  onProviderChanged: (frame) => {
    const state = get();
    const nextModel = readString(frame.model) ?? null;
    if (
      !state.providerSwitching
      || !state.providerSwitchTarget
    ) {
      return;
    }
    if (
      state.providerSwitchTarget.provider !== frame.provider
      || state.providerSwitchTarget.model !== nextModel
      || state.providerSwitchTarget.requestId !== frame.requestId
    ) {
      if (state.providerSwitchTimeoutId) {
        clearTimeout(state.providerSwitchTimeoutId);
      }
      set({
        providerSwitching: false,
        providerSwitchTarget: null,
        providerSwitchTimeoutId: null,
        providerOperationFailure: {
          operation: "switch",
          provider: state.providerSwitchTarget.provider,
          model: state.providerSwitchTarget.model,
          requestId: state.providerSwitchTarget.requestId,
          message: "Provider switch acknowledgement did not match the pending request.",
        },
      });
      return;
    }
    // The pending switch target was validated before sending. Dashboard provider
    // discovery can refresh while the runtime acknowledgement is in flight.
    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }
    set({
      activeProvider: frame.provider,
      activeModel: nextModel,
      routeMode: "user",
      providerExplicitSelection: true,
      providerSwitching: false,
      providerSwitchTarget: null,
      providerSwitchTimeoutId: null,
      respondingProvider: state.status === "running" ? state.respondingProvider : null,
      respondingModel: state.status === "running" ? state.respondingModel : null,
    });
    writeStoredProviderSelection(frame.provider, nextModel);
  },

  onProviderChangeFailed: (frame) => {
    const state = get();
    const target = state.providerSwitchTarget;
    if (!state.providerSwitching || !target || target.requestId !== frame.requestId) {
      return;
    }
    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }
    set({
      providerSwitching: false,
      providerSwitchTarget: null,
      providerSwitchTimeoutId: null,
      providerOperationFailure: {
        operation: "switch",
        provider: frame.provider ?? target.provider,
        model: frame.model ?? target.model,
        requestId: frame.requestId,
        message: frame.reason,
      },
    });
  },

  onProviderAuthStarted: (frame) => {
    const state = get();
    if (
      !state.providerAuthenticating
      || !state.providerAuthTarget
      || state.providerAuthTarget.provider !== frame.provider
      || state.providerAuthTarget.requestId !== frame.requestId
    ) {
      providerAuthDebug("ignored started frame without matching pending request", {
        provider: frame.provider,
        requestId: frame.requestId,
        pendingProvider: state.providerAuthTarget?.provider,
        pendingRequestId: state.providerAuthTarget?.requestId,
        providerAuthenticating: state.providerAuthenticating,
      });
      return;
    }
    providerAuthDebug("started frame accepted", {
      provider: frame.provider,
      requestId: frame.requestId,
      method: frame.method,
      ...(frame.method === "browser_oauth"
        ? { authorizationUri: frame.authorizationUri }
        : {
            verificationUri: frame.verificationUri,
            hasUserCode: frame.userCode.trim().length > 0,
          }),
      message: frame.message,
    });
    set({
      providerAuthMessage: frame.message ?? "Complete provider sign-in, then return to Kiln.",
      providerAuthDetails: frame.method === "browser_oauth"
        ? { method: "browser_oauth", authorizationUri: frame.authorizationUri }
        : {
            method: "device_code",
            verificationUri: frame.verificationUri,
            userCode: frame.userCode,
          },
      providerOperationFailure: null,
    });
  },

  onProviderAuthCompleted: (frame) => {
    const state = get();
    if (
      !state.providerAuthenticating
      || !state.providerAuthTarget
      || state.providerAuthTarget.provider !== frame.provider
      || state.providerAuthTarget.requestId !== frame.requestId
    ) {
      providerAuthDebug("ignored completed frame without matching pending request", {
        provider: frame.provider,
        requestId: frame.requestId,
        pendingProvider: state.providerAuthTarget?.provider,
        pendingRequestId: state.providerAuthTarget?.requestId,
        providerAuthenticating: state.providerAuthenticating,
      });
      return;
    }
    providerAuthDebug("completed frame accepted", {
      provider: frame.provider,
      requestId: frame.requestId,
      providerCount: frame.providers?.length,
      modelCount: frame.models?.[frame.provider]?.length,
      discovery: frame.providerDiscovery?.find((entry) => entry.provider === frame.provider),
    });
    if (state.providerAuthTimeoutId) {
      clearTimeout(state.providerAuthTimeoutId);
    }
    set({
      providers: normalizeProviderDescriptors(frame.providers ?? state.providers),
      providerDiscovery: frame.providerDiscovery ?? state.providerDiscovery,
      providerModelDiscovery: frame.providerModelDiscovery,
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
    if (
      !state.providerAuthenticating
      || !state.providerAuthTarget
      || state.providerAuthTarget.provider !== frame.provider
      || state.providerAuthTarget.requestId !== frame.requestId
    ) {
      providerAuthDebug("ignored failed frame without matching pending request", {
        provider: frame.provider,
        requestId: frame.requestId,
        pendingProvider: state.providerAuthTarget?.provider,
        pendingRequestId: state.providerAuthTarget?.requestId,
        providerAuthenticating: state.providerAuthenticating,
        message: frame.message,
      });
      return;
    }
    providerAuthDebug("failed frame accepted", {
      provider: frame.provider,
      requestId: frame.requestId,
      message: frame.message,
    });
    if (state.providerAuthTimeoutId) {
      clearTimeout(state.providerAuthTimeoutId);
    }
    set({
      providerAuthenticating: false,
      providerAuthTarget: null,
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: null,
      providerOperationFailure: {
        operation: "authenticate",
        provider: frame.provider,
        requestId: frame.requestId,
        message: frame.message,
      },
    });
  },

  switchProvider: (provider, model) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) {
      return false;
    }
    if (state.providerCatalogStatus !== "ready") {
      set({
        providerOperationFailure: {
          operation: "catalog",
          message: state.providerCatalogStatus === "error"
            ? state.providerCatalogError ?? "Provider catalog is unavailable. Refresh providers and retry."
            : "Provider catalog is still loading. Please retry once startup completes.",
        },
      });
      return false;
    }

    const targetProvider = state.providers.find((candidate) => candidate.id === provider);
    if (!targetProvider) {
      if (!state.providerSwitching) {
        set({
          providerSwitching: false,
          providerSwitchTarget: null,
          providerSwitchTimeoutId: null,
          providerOperationFailure: {
            operation: "switch",
            provider,
            model: readString(model) ?? null,
            message: `${provider} is unavailable.`,
          },
        });
      }
      return false;
    }
    const normalizedModel = readString(model) ?? null;
    if (!providerSupportsSelection(targetProvider, normalizedModel, state.providerModelDiscovery)) {
      if (!state.providerSwitching) {
        set({
          providerSwitching: false,
          providerSwitchTarget: null,
          providerSwitchTimeoutId: null,
          providerOperationFailure: {
            operation: "switch",
            provider,
            model: normalizedModel,
            message: providerSelectionFailureMessage(
              targetProvider,
              normalizedModel,
              state.providerModelDiscovery,
            ),
          },
        });
      }
      return false;
    }

    if (state.providerSwitchTimeoutId) {
      clearTimeout(state.providerSwitchTimeoutId);
    }

    const requestId = nextProviderSwitchRequestId();
    const timeoutId = setTimeout(() => {
      const latest = get();
      if (!latest.providerSwitching) return;
      set({
        providerSwitching: false,
        providerSwitchTarget: null,
        providerSwitchTimeoutId: null,
        providerOperationFailure: {
          operation: "switch",
          provider,
          model: normalizedModel,
          requestId,
          message: "Provider switch timed out. Please retry.",
        },
      });
    }, PROVIDER_SWITCH_TIMEOUT_MS);

    set({
      providerSwitching: true,
      providerSwitchTarget: { provider, model: normalizedModel, requestId },
      providerSwitchTimeoutId: timeoutId,
      providerOperationFailure: null,
    });

    try {
      outboundSend({
        type: "provider",
        provider,
        ...(normalizedModel ? { model: normalizedModel } : {}),
        requestId,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      set({
        providerSwitching: false,
        providerSwitchTarget: null,
        providerSwitchTimeoutId: null,
        providerOperationFailure: {
          operation: "switch",
          provider,
          model: normalizedModel,
          requestId,
          message: error instanceof Error ? error.message : "Provider switch failed.",
        },
      });
      return false;
    }

    return true;
  },

  authenticateProvider: (provider, options = {}) => {
    const state = get();
    const outboundSend = state.outboundSend;
    if (!outboundSend) {
      return false;
    }
    if (state.providerAuthTimeoutId) {
      clearTimeout(state.providerAuthTimeoutId);
    }
    const requestId = nextProviderAuthRequestId();
    const timeoutId = setTimeout(() => {
      const latest = get();
      if (!latest.providerAuthenticating) return;
      providerAuthDebug("timed out waiting for provider auth completion", {
        provider,
        requestId,
      });
      set({
        providerAuthenticating: false,
        providerAuthTarget: null,
        providerAuthMessage: null,
        providerAuthDetails: null,
        providerAuthTimeoutId: null,
        providerOperationFailure: {
          operation: "authenticate",
          provider,
          requestId,
          message: "Provider authentication timed out. Please retry.",
        },
      });
    }, PROVIDER_AUTH_TIMEOUT_MS);

    set({
      providerAuthenticating: true,
      providerAuthTarget: { provider, requestId },
      providerAuthMessage: null,
      providerAuthDetails: null,
      providerAuthTimeoutId: timeoutId,
      providerOperationFailure: null,
    });

    try {
      providerAuthDebug("sending provider_auth frame", {
        provider,
        requestId,
        hasApiKey: Boolean(options.apiKey),
        tier: options.tier,
      });
      outboundSend({
        type: "provider_auth",
        provider,
        requestId,
        ...(provider === "codex-oauth" ? { flow: "browser" as const } : {}),
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(options.tier ? { tier: options.tier } : {}),
      });
    } catch (error) {
      clearTimeout(timeoutId);
      providerAuthDebug("failed to send provider_auth frame", {
        provider,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      set({
        providerAuthenticating: false,
        providerAuthTarget: null,
        providerAuthMessage: null,
        providerAuthDetails: null,
        providerAuthTimeoutId: null,
        providerOperationFailure: {
          operation: "authenticate",
          provider,
          requestId,
          message: error instanceof Error ? error.message : "Provider authentication failed.",
        },
      });
      return false;
    }
    return true;
  },
});
