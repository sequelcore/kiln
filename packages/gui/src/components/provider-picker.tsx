import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProviderDescriptor } from "../lib/session-store.js";
import { PROVIDER_DISPLAY_ORDER, PROVIDER_METADATA, type ProviderCategory } from "../lib/provider-metadata.js";

interface ProviderPickerProps {
  readonly open: boolean;
  readonly providers: readonly ProviderDescriptor[];
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly onSwitchProvider: (provider: string, model?: string) => void;
  readonly onOpenChange: (open: boolean) => void;
}

type PickerKeyEvent = Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">;

type PickerCategory = ProviderCategory | "other";

interface PickerProvider {
  readonly id: string;
  readonly label: string;
  readonly category: PickerCategory;
  readonly free: boolean;
  readonly models: readonly string[];
}

const GROUP_ORDER: readonly PickerCategory[] = ["subscription", "harness", "direct-api", "other"];

const GROUP_LABEL: Record<PickerCategory, string> = {
  subscription: "Subscription",
  harness: "Harness",
  "direct-api": "Direct API",
  other: "Other",
};

function asFocusable(element: Element | null): HTMLElement | null {
  return element instanceof HTMLElement ? element : null;
}

function normalizeProviders(providers: readonly ProviderDescriptor[]): PickerProvider[] {
  const byId = new Map(providers.map((provider) => [provider.id, provider] as const));

  const known = PROVIDER_DISPLAY_ORDER.map((providerId) => {
    const fromWelcome = byId.get(providerId);
    const meta = PROVIDER_METADATA[providerId] ?? {
      id: providerId,
      label: providerId,
      category: "direct-api" as const,
      free: false,
    };
    return {
      id: providerId,
      label: fromWelcome?.label ?? meta.label,
      category: fromWelcome?.group ?? meta.category,
      free: fromWelcome?.free ?? Boolean(meta.free),
      models: fromWelcome?.models ?? [],
    } satisfies PickerProvider;
  });

  const knownIds = new Set(PROVIDER_DISPLAY_ORDER);
  const unknown = providers
    .filter((provider) => !knownIds.has(provider.id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((provider) => ({
      id: provider.id,
      label: provider.label || provider.id,
      category: "other" as const,
      free: provider.free,
      models: provider.models,
    }));

  return [...known, ...unknown];
}

export function ProviderPicker(props: ProviderPickerProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [pane, setPane] = useState<"providers" | "models">("providers");
  const [providerIndex, setProviderIndex] = useState(0);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [modelIndex, setModelIndex] = useState(0);

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
  const currentProviderId = providerIds[providerIndex] ?? null;
  const models = selectedProviderId
    ? (providersById.get(selectedProviderId)?.models ?? [])
    : [];

  useEffect(() => {
    if (!props.open) return;
    const activeIndex = props.activeProvider
      ? providerIds.indexOf(props.activeProvider)
      : -1;
    const resolvedIndex = activeIndex >= 0 ? activeIndex : 0;
    setPane("providers");
    setProviderIndex(resolvedIndex);
    setSelectedProviderId(providerIds[resolvedIndex] ?? providerIds[0] ?? null);
    setModelIndex(0);
  }, [props.activeProvider, props.open, providerIds]);

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

  const close = () => {
    props.onOpenChange(false);
    setPane("providers");
  };

  const openModelsOrCommit = () => {
    const providerId = currentProviderId;
    if (!providerId) return;

    const providerModels = providersById.get(providerId)?.models ?? [];
    if (providerModels.length === 0) {
      props.onSwitchProvider(providerId);
      close();
      return;
    }

    const defaultIndex = providerId === props.activeProvider && props.activeModel
      ? providerModels.indexOf(props.activeModel)
      : -1;
    setSelectedProviderId(providerId);
    setModelIndex(defaultIndex >= 0 ? defaultIndex : 0);
    setPane("models");
  };

  const commitModelSelection = () => {
    if (!selectedProviderId) return;
    const selectedModel = models[modelIndex];
    props.onSwitchProvider(selectedProviderId, selectedModel);
    close();
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
      if (pane === "models") {
        setPane("providers");
        return;
      }
      close();
      return;
    }

    if (pane === "providers") {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setProviderIndex((previous) => (previous + 1) % Math.max(providerIds.length, 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setProviderIndex((previous) => (
          previous <= 0
            ? Math.max(providerIds.length - 1, 0)
            : previous - 1
        ));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        openModelsOrCommit();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setModelIndex((previous) => (previous + 1) % Math.max(models.length, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setModelIndex((previous) => (
        previous <= 0
          ? Math.max(models.length - 1, 0)
          : previous - 1
      ));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commitModelSelection();
    }
  }, [close, commitModelSelection, models.length, openModelsOrCommit, pane, providerIds.length]);

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
          <button
            type="button"
            onClick={close}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            Close
          </button>
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
                          }}
                          onDoubleClick={openModelsOrCommit}
                          className={[
                            "flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]",
                            selected
                              ? "border-[var(--color-border-active)] bg-[var(--color-background-element)]"
                              : "border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-background-element)]",
                          ].join(" ")}
                        >
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
                          </span>
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {provider.models.length > 0 ? `${provider.models.length} models` : "provider-only"}
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
                onClick={() => setPane("providers")}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
              >
                Back
              </button>
              <p className="text-xs text-[var(--color-text-muted)]">
                {selectedProviderId ? resolveProviderLabel(selectedProviderId, providersById) : "Provider"}
              </p>
            </div>
            <div role="listbox" aria-label="Models" className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
              {models.map((model, index) => {
                const selected = index === modelIndex;
                return (
                  <button
                    key={model}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => setModelIndex(index)}
                    onDoubleClick={commitModelSelection}
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
          </div>
        )}

        <footer className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-3">
          <button
            type="button"
            onClick={close}
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={pane === "providers" ? openModelsOrCommit : commitModelSelection}
            className="rounded border border-[var(--color-border-active)] bg-[var(--color-background-element)] px-3 py-1.5 text-sm text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
          >
            {pane === "providers" ? "Next" : "Switch"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function resolveProviderLabel(providerId: string, providersById: Map<string, PickerProvider>): string {
  return providersById.get(providerId)?.label ?? PROVIDER_METADATA[providerId]?.label ?? providerId;
}
