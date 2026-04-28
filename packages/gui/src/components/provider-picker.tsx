import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  GUI_PROVIDER_DISPLAY_ORDER,
  getGuiProviderMetadata,
  isGuiProviderModeless,
  type GuiProviderGroup,
} from "@kilnai/gateway-contracts";
import type { ProviderDescriptor } from "../lib/session-store.js";

interface ProviderPickerProps {
  readonly open: boolean;
  readonly providers: readonly ProviderDescriptor[];
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly onSwitchProvider: (provider: string, model?: string) => Promise<void>;
  readonly onRefreshProviders?: () => void | Promise<void>;
  readonly onOpenChange: (open: boolean) => void;
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
  readonly reason?: string;
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

function normalizeProviders(providers: readonly ProviderDescriptor[]): PickerProvider[] {
  const byId = new Map<string, PickerProvider>();
  for (const provider of providers) {
    const meta = getGuiProviderMetadata(provider.id);
    if (!meta) {
      continue;
    }
    const models = provider.models
      .map((model) => model.trim())
      .filter((model) => model.length > 0);
    byId.set(provider.id, {
      id: provider.id,
      label: meta.label,
      category: meta.group,
      free: meta.free,
      available: provider.available && (models.length > 0 || isGuiProviderModeless(provider.id)),
      models,
      reason: provider.reason,
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const initializedOpenRef = useRef(false);
  const [pane, setPane] = useState<"providers" | "models">("providers");
  const [providerIndex, setProviderIndex] = useState(0);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [modelIndex, setModelIndex] = useState(0);
  const [modelSearch, setModelSearch] = useState("");
  const [switchInFlight, setSwitchInFlight] = useState(false);
  const [refreshInFlight, setRefreshInFlight] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const providerItems = useMemo(
    () => normalizeProviders(props.providers),
    [props.providers],
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
  const models = selectedProviderId
    ? (providersById.get(selectedProviderId)?.models ?? [])
    : [];
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (query.length === 0) {
      return models;
    }
    return models.filter((model) => model.toLowerCase().includes(query));
  }, [modelSearch, models]);

  useEffect(() => {
    if (!props.open) {
      initializedOpenRef.current = false;
      return;
    }
    if (initializedOpenRef.current) {
      return;
    }
    initializedOpenRef.current = true;
    const activeIndex = props.activeProvider
      ? providerIds.indexOf(props.activeProvider)
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
    setSwitchError(null);
  }, [props.activeProvider, props.open, providerItems, providerIds]);

  useEffect(() => {
    if (!props.open || !initializedOpenRef.current) return;
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
  }, [props.open, providerIndex, providerItems, providersById]);

  useEffect(() => {
    if (!props.open || pane !== "models") return;
    if (filteredModels.length === 0) {
      setModelIndex(0);
      return;
    }
    setModelIndex((previous) => Math.min(previous, filteredModels.length - 1));
  }, [filteredModels.length, pane, props.open]);

  useEffect(() => {
    if (!props.open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusFirst = () => {
      const first = asFocusable(dialog.querySelector("button, [role='option']"));
      (first ?? dialog).focus();
    };
    focusFirst();
  }, [props.open, pane]);

  const close = (force = false) => {
    if ((switchInFlight || refreshInFlight) && !force) return;
    props.onOpenChange(false);
    setPane("providers");
  };

  const refreshProviders = async () => {
    if (!props.onRefreshProviders || refreshInFlight || switchInFlight) {
      return;
    }
    setSwitchError(null);
    setRefreshInFlight(true);
    try {
      await props.onRefreshProviders();
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "Provider refresh failed. Please retry.");
    } finally {
      setRefreshInFlight(false);
    }
  };

  const openModelsOrCommit = async (targetProviderId?: string) => {
    const providerId = targetProviderId ?? currentProviderId;
    if (!providerId) return;
    const provider = providersById.get(providerId);
    if (!provider?.available) {
      return;
    }

    const providerModels = provider.models;
    if (providerModels.length === 0) {
      setSwitchError(null);
      setSwitchInFlight(true);
      try {
        await props.onSwitchProvider(providerId, undefined);
        close(true);
      } catch (error) {
        setSwitchError(error instanceof Error ? error.message : "Provider switch failed. Please retry.");
      } finally {
        setSwitchInFlight(false);
      }
      return;
    }
    const defaultIndex = providerId === props.activeProvider && props.activeModel
      ? providerModels.indexOf(props.activeModel)
      : -1;
    setSwitchError(null);
    setSelectedProviderId(providerId);
    setModelIndex(defaultIndex >= 0 ? defaultIndex : 0);
    setModelSearch("");
    setPane("models");
  };

  const commitModelSelection = async (targetModel?: string) => {
    if (switchInFlight || refreshInFlight) return;
    if (!selectedProviderId) return;
    if (!providersById.get(selectedProviderId)?.available) return;
    const selectedModel = targetModel ?? filteredModels[modelIndex];
    if (!selectedModel) return;
    setSwitchError(null);
    setSwitchInFlight(true);
    try {
      await props.onSwitchProvider(selectedProviderId, selectedModel);
      close(true);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "Provider switch failed. Please retry.");
    } finally {
      setSwitchInFlight(false);
    }
  };

  const moveProviderIndex = (direction: 1 | -1) => {
    if (providerItems.length === 0) return;
    setProviderIndex((previous) => {
      const total = providerItems.length;
      let next = previous;
      for (let scanned = 0; scanned < total; scanned += 1) {
        next = (next + direction + total) % total;
        if (providerItems[next]?.available) {
          return next;
        }
      }
      return previous;
    });
  };

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
      if (switchInFlight || refreshInFlight) {
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
  }, [close, commitModelSelection, filteredModels.length, moveProviderIndex, openModelsOrCommit, pane, refreshProviders, switchInFlight, refreshInFlight]);

  useEffect(() => {
    if (!props.open) return;

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
  }, [onDialogKeyDown, props.open]);

  if (!props.open) return null;

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
                disabled={switchInFlight || refreshInFlight}
              >
                {refreshInFlight ? "Refreshing..." : "Refresh"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => close()}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
              disabled={switchInFlight || refreshInFlight}
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
                          disabled={!provider.available || switchInFlight || refreshInFlight}
                          aria-disabled={!provider.available || switchInFlight || refreshInFlight}
                          className={[
                            "flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]",
                            !provider.available
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
                                <span className="rounded border border-[var(--color-success)]/60 bg-[var(--color-success)]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-success)]">
                                  Free
                                </span>
                              ) : null}
                              {active ? (
                                <span className="text-[11px] text-[var(--color-text-muted)]">Current</span>
                              ) : null}
                              {!provider.available ? (
                                <span className="text-[11px] text-[var(--color-text-muted)]">Unavailable</span>
                              ) : null}
                            </span>
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
              disabled={switchInFlight || refreshInFlight}
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
                openModelsOrCommit();
                return;
              }
              void commitModelSelection();
            }}
            disabled={switchInFlight || refreshInFlight || (pane === "providers" ? !Boolean(currentProvider?.available) : !Boolean(filteredModels[modelIndex]))}
            className="rounded border border-[var(--color-border-active)] bg-[var(--color-background-element)] px-3 py-1.5 text-sm text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            {pane === "providers" ? "Next" : (switchInFlight ? "Switching..." : "Switch")}
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
