import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  GUI_PROVIDER_DISPLAY_ORDER,
  getGuiProviderMetadata,
  isGuiProviderModeless,
  type GuiProviderGroup,
  type GuiProviderModelDiscoveryProjection,
} from "@kilnai/gateway-contracts";
import type { ProviderAuthDetails, ProviderDescriptor } from "../lib/session-store.js";

interface ProviderPickerProps {
  readonly open: boolean;
  readonly providers: readonly ProviderDescriptor[];
  readonly providerModelDiscovery: GuiProviderModelDiscoveryProjection | null;
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly onSwitchProvider: (provider: string, model?: string) => Promise<void>;
  readonly onAuthenticateProvider?: (provider: string, options?: { apiKey?: string; tier?: "go" | "zen" }) => Promise<void>;
  readonly onRefreshProviders?: () => void | Promise<void>;
  readonly onOpenChange: (open: boolean) => void;
  readonly providerAuthenticating?: boolean;
  readonly providerAuthProvider?: string | null;
  readonly providerAuthMessage?: string | null;
  readonly providerAuthDetails?: ProviderAuthDetails | null;
}

type PickerKeyEvent = Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">;

type PickerCategory = GuiProviderGroup;

interface PickerProvider {
  readonly id: string;
  readonly label: string;
  readonly category: PickerCategory;
  readonly free: boolean;
  readonly available: boolean;
  readonly models: readonly string[];
  readonly diagnosticModelCount: number;
  readonly reason?: string;
  readonly authState?: string;
  readonly authMethod?: "device_code" | "api_key";
  readonly authTier?: "go" | "zen";
}

const GROUP_ORDER: readonly PickerCategory[] = ["subscription", "harness", "direct-api"];

const GROUP_LABEL: Record<PickerCategory, string> = {
  subscription: "Subscription",
  harness: "Harness",
  "direct-api": "Direct API",
};

function asFocusable(element: Element | null): HTMLElement | null {
  return element instanceof HTMLElement ? element : null;
}

function providerDisplayIndex(providerId: string): number {
  const index = GUI_PROVIDER_DISPLAY_ORDER.indexOf(providerId);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function normalizeProviders(
  providers: readonly ProviderDescriptor[],
  providerModelDiscovery: GuiProviderModelDiscoveryProjection | null,
): PickerProvider[] {
  const byId = new Map<string, PickerProvider>();
  const routeEntries = providerModelDiscovery?.entries ?? [];
  for (const provider of providers) {
    const meta = getGuiProviderMetadata(provider.id);
    if (!meta) {
      continue;
    }
    const eligibleModels = routeEntries
      .filter((entry) => entry.providerRoute.providerId === provider.id && entry.eligibility.eligible)
      .map((entry) => entry.providerRoute.providerModelId);
    const diagnosticModelCount = routeEntries.filter((entry) => entry.providerRoute.providerId === provider.id).length;
    const models = (providerModelDiscovery ? eligibleModels : provider.models)
      .map((model) => model.trim())
      .filter((model) => model.length > 0);
    const firstIneligibleReason = routeEntries.find((entry) => (
      entry.providerRoute.providerId === provider.id
      && !entry.eligibility.eligible
      && entry.eligibility.reasonCodes.length > 0
    ))?.eligibility.reasonCodes.join(", ");
    byId.set(provider.id, {
      id: provider.id,
      label: meta.label,
      category: meta.group,
      free: meta.free,
      available: isGuiProviderModeless(provider.id)
        ? provider.available
        : models.length > 0,
      models,
      diagnosticModelCount,
      reason: firstIneligibleReason ?? provider.reason,
      authState: provider.authState,
      authMethod: meta.authMethod,
      authTier: meta.authTier,
    });
  }
  return Array.from(byId.values()).sort((left, right) => (
    providerDisplayIndex(left.id) - providerDisplayIndex(right.id)
  ));
}

function providerModelSummary(provider: PickerProvider): string {
  if (isGuiProviderModeless(provider.id)) {
    return "No model selection";
  }
  if (provider.diagnosticModelCount > provider.models.length) {
    return `${provider.models.length} eligible / ${provider.diagnosticModelCount} observed`;
  }
  return provider.models.length > 0 ? `${provider.models.length} models` : "No models";
}

function conciseUnavailableReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized.length === 0) {
    return "";
  }
  if (/auth|api[_ -]?key|credential/i.test(normalized)) {
    return "Auth is missing.";
  }
  if (/daemon.*not reachable|not reachable|connection|ECONNREFUSED/i.test(normalized)) {
    return "Local service is unreachable.";
  }
  if (/empty model list|no installed models|no models/i.test(normalized)) {
    return "No models found.";
  }
  if (/endpoint.*failed|request failed/i.test(normalized)) {
    return "Model endpoint failed.";
  }
  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}...` : normalized;
}

export function ProviderPicker(props: ProviderPickerProps) {
  const {
    activeModel,
    activeProvider,
    onAuthenticateProvider,
    onOpenChange,
    onRefreshProviders,
    onSwitchProvider,
    open,
    providerAuthenticating,
    providerModelDiscovery,
    providers,
  } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const initializedOpenRef = useRef(false);
  const [pane, setPane] = useState<"providers" | "models">("providers");
  const [providerIndex, setProviderIndex] = useState(0);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [modelIndex, setModelIndex] = useState(0);
  const [modelSearch, setModelSearch] = useState("");
  const [switchInFlight, setSwitchInFlight] = useState(false);
  const [refreshInFlight, setRefreshInFlight] = useState(false);
  const [authInFlight, setAuthInFlight] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const providerItems = useMemo(
    () => normalizeProviders(providers, providerModelDiscovery),
    [providerModelDiscovery, providers],
  );
  const providerIds = useMemo(
    () => providerItems.map((provider) => provider.id),
    [providerItems],
  );
  const providersById = useMemo(
    () => new Map(providerItems.map((provider) => [provider.id, provider] as const)),
    [providerItems],
  );
  const currentProvider = providerItems[providerIndex] ?? null;
  const currentProviderId = currentProvider?.id ?? null;
  const models = useMemo(
    () => selectedProviderId
      ? (providersById.get(selectedProviderId)?.models ?? [])
      : [],
    [providersById, selectedProviderId],
  );
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (query.length === 0) {
      return models;
    }
    return models.filter((model) => model.toLowerCase().includes(query));
  }, [modelSearch, models]);

  useEffect(() => {
    if (!open) {
      initializedOpenRef.current = false;
      return;
    }
    if (initializedOpenRef.current) {
      return;
    }
    initializedOpenRef.current = true;
    const activeIndex = activeProvider
      ? providerIds.indexOf(activeProvider)
      : -1;
    const firstAvailableIndex = providerItems.findIndex((provider) => provider.available);
    const resolvedIndex = activeIndex >= 0
      ? (providerItems[activeIndex]?.available ? activeIndex : (firstAvailableIndex >= 0 ? firstAvailableIndex : activeIndex))
      : (firstAvailableIndex >= 0 ? firstAvailableIndex : 0);
    setPane("providers");
    setProviderIndex(resolvedIndex);
    setSelectedProviderId(providerItems[resolvedIndex]?.id ?? providerItems[0]?.id ?? null);
    setModelIndex(0);
    setModelSearch("");
    setSwitchInFlight(false);
    setRefreshInFlight(false);
    setAuthInFlight(false);
    setSwitchError(null);
    setCopyNotice(null);
  }, [activeProvider, open, providerItems, providerIds]);

  useEffect(() => {
    if (!open || !initializedOpenRef.current) return;
    if (providerItems.length === 0) {
      setProviderIndex(0);
      setSelectedProviderId(null);
      setModelIndex(0);
      return;
    }

    setProviderIndex((previous) => Math.min(previous, providerItems.length - 1));
    setSelectedProviderId((previous) => {
      if (previous && providersById.has(previous)) {
        return previous;
      }
      return providerItems[Math.min(providerIndex, providerItems.length - 1)]?.id ?? providerItems[0]?.id ?? null;
    });
  }, [open, providerIndex, providerItems, providersById]);

  useEffect(() => {
    if (!open || pane !== "models") return;
    if (filteredModels.length === 0) {
      setModelIndex(0);
      return;
    }
    setModelIndex((previous) => Math.min(previous, filteredModels.length - 1));
  }, [filteredModels.length, open, pane]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusFirst = () => {
      const first = asFocusable(dialog.querySelector("button, [role='option']"));
      (first ?? dialog).focus();
    };
    focusFirst();
  }, [open, pane]);

  const close = useCallback((force = false) => {
    if ((switchInFlight || refreshInFlight || authInFlight || providerAuthenticating) && !force) return;
    onOpenChange(false);
    setPane("providers");
  }, [authInFlight, onOpenChange, providerAuthenticating, refreshInFlight, switchInFlight]);

  const refreshProviders = useCallback(async () => {
    if (!onRefreshProviders || refreshInFlight || switchInFlight || authInFlight || providerAuthenticating) {
      return;
    }
    setSwitchError(null);
    setRefreshInFlight(true);
    try {
      await onRefreshProviders();
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "Provider refresh failed. Please retry.");
    } finally {
      setRefreshInFlight(false);
    }
  }, [authInFlight, onRefreshProviders, providerAuthenticating, refreshInFlight, switchInFlight]);

  const copyText = async (text: string, label: string): Promise<void> => {
    setCopyNotice(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const element = document.createElement("textarea");
        element.value = text;
        element.setAttribute("readonly", "true");
        element.style.position = "fixed";
        element.style.left = "-9999px";
        document.body.appendChild(element);
        element.select();
        document.execCommand("copy");
        document.body.removeChild(element);
      }
      setCopyNotice(`${label} copied.`);
    } catch {
      setCopyNotice("Copy failed. Select the text manually.");
    }
  };

  const providerCanAuthenticate = useCallback((provider: PickerProvider | undefined): provider is PickerProvider => {
    if (!provider || provider.available || !provider.authMethod || !onAuthenticateProvider) {
      return false;
    }
    return provider.authState === "missing"
      || provider.authState === "expired"
      || /auth|api[_ -]?key|credential/i.test(provider.reason ?? "");
  }, [onAuthenticateProvider]);

  const authenticateProvider = useCallback(async (provider: PickerProvider): Promise<void> => {
    if (!onAuthenticateProvider || authInFlight || switchInFlight || refreshInFlight || providerAuthenticating) {
      return;
    }
    let apiKey: string | undefined;
    if (provider.authMethod === "api_key") {
      apiKey = window.prompt(`Paste ${provider.label} API key`)?.trim();
      if (!apiKey) {
        return;
      }
    }
    setSwitchError(null);
    setAuthInFlight(true);
    try {
      await onAuthenticateProvider(provider.id, {
        ...(apiKey ? { apiKey } : {}),
        ...(provider.authTier ? { tier: provider.authTier } : {}),
      });
      await onRefreshProviders?.();
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "Provider authentication failed. Please retry.");
    } finally {
      setAuthInFlight(false);
    }
  }, [authInFlight, onAuthenticateProvider, onRefreshProviders, providerAuthenticating, refreshInFlight, switchInFlight]);

  const openModelsOrCommit = useCallback(async (targetProviderId?: string) => {
    const providerId = targetProviderId ?? currentProviderId;
    if (!providerId) return;
    const provider = providersById.get(providerId);
    if (!provider?.available) {
      if (providerCanAuthenticate(provider)) {
        setSelectedProviderId(provider.id);
        setSwitchError("Press Authenticate to start provider sign-in.");
      }
      return;
    }

    const providerModels = provider.models;
    if (providerModels.length === 0) {
      setSwitchError(null);
      setSwitchInFlight(true);
      try {
        await onSwitchProvider(providerId, undefined);
        close(true);
      } catch (error) {
        setSwitchError(error instanceof Error ? error.message : "Provider switch failed. Please retry.");
      } finally {
        setSwitchInFlight(false);
      }
      return;
    }
    const defaultIndex = providerId === activeProvider && activeModel
      ? providerModels.indexOf(activeModel)
      : -1;
    setSwitchError(null);
    setSelectedProviderId(providerId);
    setModelIndex(defaultIndex >= 0 ? defaultIndex : 0);
    setModelSearch("");
    setPane("models");
  }, [activeModel, activeProvider, close, currentProviderId, onSwitchProvider, providerCanAuthenticate, providersById]);

  const commitModelSelection = useCallback(async (targetModel?: string) => {
    if (switchInFlight || refreshInFlight || authInFlight || providerAuthenticating) return;
    if (!selectedProviderId) return;
    if (!providersById.get(selectedProviderId)?.available) return;
    const selectedModel = targetModel ?? filteredModels[modelIndex];
    if (!selectedModel) return;
    setSwitchError(null);
    setSwitchInFlight(true);
    try {
      await onSwitchProvider(selectedProviderId, selectedModel);
      close(true);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "Provider switch failed. Please retry.");
    } finally {
      setSwitchInFlight(false);
    }
  }, [authInFlight, close, filteredModels, modelIndex, onSwitchProvider, providerAuthenticating, providersById, refreshInFlight, selectedProviderId, switchInFlight]);

  const moveProviderIndex = useCallback((direction: 1 | -1) => {
    if (providerItems.length === 0) return;
    setProviderIndex((previous) => {
      const total = providerItems.length;
      let next = previous;
      for (let scanned = 0; scanned < total; scanned += 1) {
        next = (next + direction + total) % total;
        const candidate = providerItems[next];
        if (candidate?.available || providerCanAuthenticate(candidate)) {
          return next;
        }
      }
      return previous;
    });
  }, [providerCanAuthenticate, providerItems]);

  const onDialogKeyDown = useCallback((event: PickerKeyEvent) => {
    if (event.key === "Tab") {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
      ).map(asFocusable).filter((node): node is HTMLElement => {
        if (!node) return false;
        if ("disabled" in node && node instanceof HTMLButtonElement) {
          return !node.disabled;
        }
        return true;
      });
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const currentIndex = focusable.findIndex((element) => element === active);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey) {
        if (currentIndex <= 0) {
          event.preventDefault();
          last.focus();
        }
      } else if (currentIndex === -1 || currentIndex >= focusable.length - 1) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (switchInFlight || refreshInFlight || authInFlight || providerAuthenticating) {
        return;
      }
      if (pane === "models") {
        setPane("providers");
        return;
      }
      close();
      return;
    }

    if (pane === "providers") {
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refreshProviders();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveProviderIndex(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveProviderIndex(-1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void openModelsOrCommit();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setModelIndex((previous) => (previous + 1) % Math.max(filteredModels.length, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setModelIndex((previous) => (
        previous <= 0
          ? Math.max(filteredModels.length - 1, 0)
          : previous - 1
      ));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void commitModelSelection();
    }
  }, [authInFlight, close, commitModelSelection, filteredModels.length, moveProviderIndex, openModelsOrCommit, pane, providerAuthenticating, refreshProviders, switchInFlight, refreshInFlight]);

  useEffect(() => {
    if (!open) return;

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      const target = event.target;
      if (target instanceof Node && !dialog.contains(target)) return;

      onDialogKeyDown(event);
    };

    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [onDialogKeyDown, open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Switch provider"
        tabIndex={-1}
        className="w-full max-w-2xl rounded-xl border border-[var(--color-border)] bg-[var(--color-background-panel)] p-4 shadow-2xl focus:outline-none"
      >
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Switch provider</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {pane === "providers" ? "Choose provider" : "Choose model"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {props.onRefreshProviders ? (
              <button
                type="button"
                aria-label="Refresh providers"
                onClick={() => {
                  void refreshProviders();
                }}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
                disabled={switchInFlight || refreshInFlight || authInFlight || props.providerAuthenticating}
              >
                {refreshInFlight ? "Refreshing..." : "Refresh"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => close()}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
              disabled={switchInFlight || refreshInFlight || authInFlight || props.providerAuthenticating}
            >
              Close
            </button>
          </div>
        </header>

        {pane === "providers" ? (
          <div role="listbox" aria-label="Providers" className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {GROUP_ORDER.map((category) => {
              const groupProviders = providerItems.filter((provider) => provider.category === category);
              if (groupProviders.length === 0) return null;
              return (
                <section key={category} role="group" aria-label={GROUP_LABEL[category]} className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{GROUP_LABEL[category]}</p>
                  <div className="space-y-1">
                    {groupProviders.map((provider) => {
                      const index = providerIds.indexOf(provider.id);
                      const selected = index === providerIndex;
                      const active = provider.id === props.activeProvider;
                      const authenticatable = providerCanAuthenticate(provider);
                      const busyAuthenticating = (authInFlight || props.providerAuthenticating) && props.providerAuthProvider === provider.id;
                      return (
                        <button
                          key={provider.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setProviderIndex(index);
                            setSelectedProviderId(provider.id);
                            setSwitchError(null);
                            void openModelsOrCommit(provider.id);
                          }}
                          onDoubleClick={() => {
                            void openModelsOrCommit(provider.id);
                          }}
                          disabled={(!provider.available && !authenticatable) || switchInFlight || refreshInFlight || authInFlight || props.providerAuthenticating}
                          aria-disabled={(!provider.available && !authenticatable) || switchInFlight || refreshInFlight || authInFlight || props.providerAuthenticating}
                          className={[
                            "flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]",
                            !provider.available && !authenticatable
                              ? "cursor-not-allowed border-[var(--color-border)] bg-[var(--color-background)] opacity-60"
                              : null,
                            selected
                              ? "border-[var(--color-border-active)] bg-[var(--color-background-element)]"
                              : "border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-background-element)]",
                          ].join(" ")}
                        >
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="flex items-center gap-2">
                              <span className="text-[var(--color-text)]">{provider.label}</span>
                              {provider.free ? (
                                <span className="rounded border border-status-success-border bg-status-success-background px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-success">
                                  Free
                                </span>
                              ) : null}
                              {active ? (
                                <span className="text-[11px] text-[var(--color-text-muted)]">Current</span>
                              ) : null}
                              {!provider.available ? (
                                <span className="text-[11px] text-[var(--color-text-muted)]">
                                  {authenticatable ? (busyAuthenticating ? "Authenticating" : "Sign in") : "Unavailable"}
                                </span>
                              ) : null}
                            </span>
                            {busyAuthenticating && props.providerAuthMessage ? (
                              <span className="text-xs text-[var(--color-text-muted)]">{props.providerAuthMessage}</span>
                            ) : null}
                            {!provider.available && provider.reason ? (
                              <span className="text-xs text-[var(--color-text-muted)]">{conciseUnavailableReason(provider.reason)}</span>
                            ) : null}
                          </span>
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {providerModelSummary(provider)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setModelSearch("");
                  setPane("providers");
                }}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
                disabled={switchInFlight || refreshInFlight}
              >
                Back
              </button>
              <p className="text-xs text-[var(--color-text-muted)]">
                {selectedProviderId ? resolveProviderLabel(selectedProviderId, providersById) : "Provider"}
              </p>
            </div>
            <input
              type="search"
              aria-label="Filter models"
              value={modelSearch}
              onChange={(event) => {
                setModelSearch(event.target.value);
                setModelIndex(0);
              }}
              placeholder="Filter models"
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
              disabled={switchInFlight || refreshInFlight || authInFlight || props.providerAuthenticating}
            />
            <div role="listbox" aria-label="Models" className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
              {filteredModels.map((model, index) => {
                const selected = index === modelIndex;
                return (
                  <button
                    key={model}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      setModelIndex(index);
                      void commitModelSelection(model);
                    }}
                    onDoubleClick={() => {
                      void commitModelSelection(model);
                    }}
                    disabled={switchInFlight}
                    className={[
                      "w-full rounded border px-3 py-2 text-left text-sm",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]",
                      selected
                        ? "border-[var(--color-border-active)] bg-[var(--color-background-element)] text-[var(--color-text)]"
                        : "border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-muted)] hover:bg-[var(--color-background-element)] hover:text-[var(--color-text)]",
                    ].join(" ")}
                  >
                    {model}
                  </button>
                );
              })}
            </div>
            {filteredModels.length === 0 ? (
              <p className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
                No models match the filter.
              </p>
            ) : null}
            {switchError ? (
              <p className="text-xs text-[var(--color-danger)]">{switchError}</p>
            ) : null}
          </div>
        )}

        {pane === "providers" && switchError ? (
          <p className="mt-3 text-xs text-[var(--color-danger)]">{switchError}</p>
        ) : null}

        {props.providerAuthenticating && props.providerAuthDetails ? (
          <section className="mt-4 space-y-3 rounded border border-[var(--color-border-active)] bg-[var(--color-background-element)] p-3">
            <div className="space-y-1">
              <p className="text-sm text-[var(--color-text)]">
                Complete browser sign-in
              </p>
              {props.providerAuthMessage ? (
                <p className="text-xs text-[var(--color-text-muted)]">{props.providerAuthMessage}</p>
              ) : null}
            </div>
            <div className="grid gap-2 text-xs">
              <div className="grid gap-1">
                <span className="text-[var(--color-text-muted)]">Link</span>
                <code className="select-all break-all rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-[var(--color-text)]">
                  {props.providerAuthDetails.verificationUri}
                </code>
              </div>
              <div className="grid gap-1">
                <span className="text-[var(--color-text-muted)]">Code</span>
                <code className="select-all rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-lg tracking-wide text-[var(--color-text)]">
                  {props.providerAuthDetails.userCode}
                </code>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.open(props.providerAuthDetails?.verificationUri, "_blank", "noopener,noreferrer")}
                className="rounded border border-[var(--color-border-active)] bg-[var(--color-background)] px-2 py-1 text-xs text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
              >
                Open link
              </button>
              <button
                type="button"
                onClick={() => {
                  if (props.providerAuthDetails) {
                    void copyText(props.providerAuthDetails.verificationUri, "Link");
                  }
                }}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
              >
                Copy link
              </button>
              <button
                type="button"
                onClick={() => {
                  if (props.providerAuthDetails) {
                    void copyText(props.providerAuthDetails.userCode, "Code");
                  }
                }}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
              >
                Copy code
              </button>
            </div>
            {copyNotice ? (
              <p className="text-xs text-[var(--color-text-muted)]">{copyNotice}</p>
            ) : null}
          </section>
        ) : null}

        <footer className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-3">
          <button
            type="button"
            onClick={() => close()}
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
            disabled={switchInFlight || refreshInFlight}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (pane === "providers") {
                const provider = currentProvider ?? undefined;
                if (providerCanAuthenticate(provider)) {
                  void authenticateProvider(provider);
                  return;
                }
                void openModelsOrCommit();
                return;
              }
              void commitModelSelection();
            }}
            disabled={switchInFlight || refreshInFlight || authInFlight || props.providerAuthenticating || (pane === "providers" ? !(Boolean(currentProvider?.available) || providerCanAuthenticate(currentProvider ?? undefined)) : !filteredModels[modelIndex])}
            className="rounded border border-[var(--color-border-active)] bg-[var(--color-background-element)] px-3 py-1.5 text-sm text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            {pane === "providers"
              ? (providerCanAuthenticate(currentProvider ?? undefined) ? (authInFlight || props.providerAuthenticating ? "Authenticating..." : "Authenticate") : "Next")
              : (switchInFlight ? "Switching..." : "Switch")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function resolveProviderLabel(providerId: string, providersById: Map<string, PickerProvider>): string {
  return providersById.get(providerId)?.label ?? providerId;
}
