import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import {
  GUI_PROVIDER_DISPLAY_ORDER,
  getGuiProviderMetadata,
  isGuiProviderModeless,
  type GuiProviderGroup,
  type GuiProviderModelDiscoveryProjection,
} from "@kilnai/gateway-contracts";
import type { ProviderAuthDetails, ProviderDescriptor } from "../lib/session-store/index.js";
import { ModelSelector, ModelSelectorCommand } from "@/components/ai-elements/model-selector";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DialogFooter } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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
  readonly finalFocus?: RefObject<HTMLElement | null>;
}

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
const EMPTY_MODELS: readonly string[] = [];

const GROUP_LABEL: Record<PickerCategory, string> = {
  subscription: "Subscription",
  harness: "Harness",
  "direct-api": "Direct API",
};

function providerDisplayIndex(providerId: string): number {
  const index = GUI_PROVIDER_DISPLAY_ORDER.indexOf(providerId);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function normalizeProviders(
  providers: readonly ProviderDescriptor[],
  providerModelDiscovery: GuiProviderModelDiscoveryProjection | null,
): PickerProvider[] {
  const routeEntries = providerModelDiscovery?.entries ?? [];
  const normalized = new Map<string, PickerProvider>();
  for (const provider of providers) {
    const meta = getGuiProviderMetadata(provider.id);
    if (!meta) continue;

    const eligibleModels: string[] = [];
    let diagnosticModelCount = 0;
    let firstIneligibleReason: string | undefined;
    for (const entry of routeEntries) {
      if (entry.providerRoute.providerId !== provider.id) continue;
      diagnosticModelCount += 1;
      if (entry.eligibility.eligible) {
        eligibleModels.push(entry.providerRoute.providerModelId);
      } else if (!firstIneligibleReason && entry.eligibility.reasonCodes.length > 0) {
        firstIneligibleReason = entry.eligibility.reasonCodes.join(", ");
      }
    }
    const models = (providerModelDiscovery ? eligibleModels : provider.models)
      .map((model) => model.trim())
      .filter((model) => model.length > 0);
    normalized.set(provider.id, {
      id: provider.id,
      label: meta.label,
      category: meta.group,
      free: meta.free,
      available: isGuiProviderModeless(provider.id) ? provider.available : models.length > 0,
      models,
      diagnosticModelCount,
      reason: firstIneligibleReason ?? provider.reason,
      authState: provider.authState,
      authMethod: meta.authMethod,
      authTier: meta.authTier,
    });
  }
  return [...normalized.values()]
    .sort((left, right) => providerDisplayIndex(left.id) - providerDisplayIndex(right.id));
}

function providerModelSummary(provider: PickerProvider): string {
  if (isGuiProviderModeless(provider.id)) return "No model selection";
  if (provider.diagnosticModelCount > provider.models.length) {
    return `${provider.models.length} eligible / ${provider.diagnosticModelCount} observed`;
  }
  return provider.models.length > 0 ? `${provider.models.length} models` : "No models";
}

function conciseUnavailableReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized.length === 0) return "";
  if (/auth|api[_ -]?key|credential/i.test(normalized)) return "Auth is missing.";
  if (/daemon.*not reachable|not reachable|connection|ECONNREFUSED/i.test(normalized)) {
    return "Local service is unreachable.";
  }
  if (/empty model list|no installed models|no models/i.test(normalized)) return "No models found.";
  if (/endpoint.*failed|request failed/i.test(normalized)) return "Model endpoint failed.";
  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}...` : normalized;
}

function matchesProvider(provider: PickerProvider, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [provider.label, provider.id, GROUP_LABEL[provider.category]]
    .some((value) => value.toLowerCase().includes(normalized));
}

export function ProviderPicker(props: ProviderPickerProps) {
  const wasOpen = useRef(false);
  const [pane, setPane] = useState<"providers" | "models">("providers");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [providerQuery, setProviderQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [switchInFlight, setSwitchInFlight] = useState(false);
  const [refreshInFlight, setRefreshInFlight] = useState(false);
  const [authInFlight, setAuthInFlight] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const providerItems = useMemo(
    () => normalizeProviders(props.providers, props.providerModelDiscovery),
    [props.providerModelDiscovery, props.providers],
  );
  const providersById = useMemo(
    () => new Map(providerItems.map((provider) => [provider.id, provider] as const)),
    [providerItems],
  );
  const selectedProvider = selectedProviderId ? providersById.get(selectedProviderId) ?? null : null;
  const models = selectedProvider?.models ?? EMPTY_MODELS;
  const filteredProviders = useMemo(
    () => providerItems.filter((provider) => matchesProvider(provider, providerQuery)),
    [providerItems, providerQuery],
  );
  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    return query ? models.filter((model) => model.toLowerCase().includes(query)) : models;
  }, [modelQuery, models]);
  const busy = switchInFlight || refreshInFlight || authInFlight || props.providerAuthenticating === true;

  const providerCanAuthenticate = useCallback((provider: PickerProvider | null | undefined): provider is PickerProvider => {
    if (!provider || provider.available || !provider.authMethod || !props.onAuthenticateProvider) return false;
    return provider.authState === "missing"
      || provider.authState === "expired"
      || /auth|api[_ -]?key|credential/i.test(provider.reason ?? "");
  }, [props.onAuthenticateProvider]);

  const selectProvider = useCallback((providerId: string | null) => {
    if (providerId === selectedProviderId) return;
    setSelectedProviderId(providerId);
    setApiKey("");
  }, [selectedProviderId]);

  useEffect(() => {
    if (!props.open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    const active = props.activeProvider ? providersById.get(props.activeProvider) : undefined;
    const firstAvailable = providerItems.find((provider) => provider.available);
    const initialProvider = active?.available ? active : firstAvailable ?? active ?? providerItems[0] ?? null;

    setPane("providers");
    setSelectedProviderId(initialProvider?.id ?? null);
    setSelectedModelId(null);
    setProviderQuery("");
    setModelQuery("");
    setApiKey("");
    setSwitchInFlight(false);
    setRefreshInFlight(false);
    setAuthInFlight(false);
    setSwitchError(null);
    setCopyNotice(null);
  }, [props.activeProvider, props.open, providerItems, providersById]);

  useEffect(() => {
    if (!props.open || providerItems.length === 0) return;
    if (selectedProviderId && providersById.has(selectedProviderId)) return;
    selectProvider(providerItems.find((provider) => provider.available)?.id ?? providerItems[0]?.id ?? null);
  }, [props.open, providerItems, providersById, selectProvider, selectedProviderId]);

  useEffect(() => {
    if (pane === "providers") {
      if (selectedProviderId && filteredProviders.some((provider) => provider.id === selectedProviderId)) return;
      selectProvider(filteredProviders[0]?.id ?? null);
      return;
    }
    if (selectedModelId && filteredModels.includes(selectedModelId)) return;
    setSelectedModelId(filteredModels[0] ?? null);
  }, [filteredModels, filteredProviders, pane, selectProvider, selectedModelId, selectedProviderId]);

  const close = useCallback((force = false) => {
    if (busy && !force) return;
    props.onOpenChange(false);
    setPane("providers");
  }, [busy, props.onOpenChange]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) close();
  }, [close]);

  const refreshProviders = useCallback(async () => {
    if (!props.onRefreshProviders || busy) return;
    setSwitchError(null);
    setRefreshInFlight(true);
    try {
      await props.onRefreshProviders();
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "Provider refresh failed. Please retry.");
    } finally {
      setRefreshInFlight(false);
    }
  }, [busy, props.onRefreshProviders]);

  const copyText = async (text: string, label: string): Promise<void> => {
    setCopyNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      setCopyNotice(`${label} copied.`);
    } catch {
      setCopyNotice("Copy failed. Select the text manually.");
    }
  };

  const authenticateProvider = useCallback(async (provider: PickerProvider) => {
    if (!props.onAuthenticateProvider || busy) return;
    const credential = provider.authMethod === "api_key" ? apiKey.trim() : undefined;
    if (provider.authMethod === "api_key" && !credential) {
      setSwitchError(`Enter the ${provider.label} API key.`);
      return;
    }

    setSwitchError(null);
    setAuthInFlight(true);
    try {
      await props.onAuthenticateProvider(provider.id, {
        ...(credential ? { apiKey: credential } : {}),
        ...(provider.authTier ? { tier: provider.authTier } : {}),
      });
      setApiKey("");
      await props.onRefreshProviders?.();
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "Provider authentication failed. Please retry.");
    } finally {
      setAuthInFlight(false);
    }
  }, [apiKey, busy, props.onAuthenticateProvider, props.onRefreshProviders]);

  const openModelsOrCommit = useCallback(async (providerId: string | null = selectedProviderId) => {
    if (!providerId || busy) return;
    const provider = providersById.get(providerId);
    if (!provider?.available) {
      if (providerCanAuthenticate(provider)) {
        selectProvider(provider.id);
        setApiKey("");
        setSwitchError("Press Authenticate to start provider sign-in.");
      }
      return;
    }

    if (provider.models.length === 0) {
      setSwitchError(null);
      setSwitchInFlight(true);
      try {
        await props.onSwitchProvider(provider.id, undefined);
        close(true);
      } catch (error) {
        setSwitchError(error instanceof Error ? error.message : "Provider switch failed. Please retry.");
      } finally {
        setSwitchInFlight(false);
      }
      return;
    }

    const activeModel = provider.id === props.activeProvider && props.activeModel && provider.models.includes(props.activeModel)
      ? props.activeModel
      : provider.models[0] ?? null;
    selectProvider(provider.id);
    setSelectedModelId(activeModel);
    setModelQuery("");
    setSwitchError(null);
    setPane("models");
  }, [busy, close, props.activeModel, props.activeProvider, props.onSwitchProvider, providerCanAuthenticate, providersById, selectProvider, selectedProviderId]);

  const commitModelSelection = useCallback(async (modelId: string | null = selectedModelId) => {
    if (!selectedProviderId || !modelId || busy || !providersById.get(selectedProviderId)?.available) return;
    setSwitchError(null);
    setSwitchInFlight(true);
    try {
      await props.onSwitchProvider(selectedProviderId, modelId);
      close(true);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "Provider switch failed. Please retry.");
    } finally {
      setSwitchInFlight(false);
    }
  }, [busy, close, props.onSwitchProvider, providersById, selectedModelId, selectedProviderId]);

  const handleContentKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || pane !== "models" || busy) return;
    event.preventDefault();
    event.stopPropagation();
    setPane("providers");
    setModelQuery("");
    setSwitchError(null);
  };

  const commandValue = pane === "providers" ? selectedProviderId ?? undefined : selectedModelId ?? undefined;

  return (
    <ModelSelector
      open={props.open}
      onOpenChange={handleOpenChange}
      title="Switch provider"
      description={pane === "providers" ? "Choose a provider." : "Choose a model."}
      finalFocus={props.finalFocus}
      onContentKeyDown={handleContentKeyDown}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-medium text-foreground">Switch provider</h2>
          <p className="truncate text-xs text-muted-foreground">
            {pane === "providers" ? "Choose provider" : selectedProvider?.label ?? "Choose model"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {pane === "models" ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPane("providers");
                setModelQuery("");
                setSwitchError(null);
              }}
            >
              Back
            </Button>
          ) : null}
          {props.onRefreshProviders ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              aria-label="Refresh providers"
              disabled={busy}
              onClick={() => void refreshProviders()}
            >
              {refreshInFlight ? "Refreshing..." : "Refresh"}
            </Button>
          ) : null}
          <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => close()}>
            Close
          </Button>
        </div>
      </div>

      <ModelSelectorCommand
        label={pane === "providers" ? "Filter providers" : "Filter models"}
        value={commandValue}
        onValueChange={(value) => {
          if (pane === "providers") selectProvider(value || null);
          else setSelectedModelId(value || null);
        }}
      >
        {pane === "providers" ? (
          <CommandInput
            aria-label="Filter providers"
            placeholder="Search providers"
            value={providerQuery}
            onValueChange={setProviderQuery}
            disabled={busy}
            autoFocus
          />
        ) : (
          <CommandInput
            aria-label="Filter models"
            placeholder="Filter models"
            value={modelQuery}
            onValueChange={setModelQuery}
            disabled={busy}
            autoFocus
          />
        )}

        <CommandList label={pane === "providers" ? "Providers" : "Models"} className="max-h-[50vh] p-2">
        {pane === "providers" ? (
          <>
            <CommandEmpty>No providers match.</CommandEmpty>
            {GROUP_ORDER.map((category) => {
              const groupProviders = filteredProviders.filter((provider) => provider.category === category);
              if (groupProviders.length === 0) return null;
              return (
                <CommandGroup key={category} heading={GROUP_LABEL[category]} aria-label={GROUP_LABEL[category]}>
                  {groupProviders.map((provider) => {
                    const authenticatable = providerCanAuthenticate(provider);
                    const busyAuthenticating = busy && props.providerAuthProvider === provider.id;
                    return (
                      <CommandItem
                        key={provider.id}
                        value={provider.id}
                        disabled={(!provider.available && !authenticatable) || busy}
                        aria-disabled={(!provider.available && !authenticatable) || busy}
                        onSelect={() => void openModelsOrCommit(provider.id)}
                        className="items-start py-2.5"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{provider.label}</span>
                            {provider.free ? <Badge variant="secondary">Free</Badge> : null}
                            {provider.id === props.activeProvider ? <span className="text-xs text-muted-foreground">Current</span> : null}
                            {!provider.available ? (
                              <span className="text-xs text-muted-foreground">
                                {authenticatable ? (busyAuthenticating ? "Authenticating" : "Sign in") : "Unavailable"}
                              </span>
                            ) : null}
                          </span>
                          {busyAuthenticating && props.providerAuthMessage ? (
                            <span className="text-xs text-muted-foreground">{props.providerAuthMessage}</span>
                          ) : null}
                          {!provider.available && provider.reason ? (
                            <span className="text-xs text-muted-foreground">{conciseUnavailableReason(provider.reason)}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{providerModelSummary(provider)}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
          </>
        ) : (
          <>
            <CommandEmpty>No models match the filter.</CommandEmpty>
            <CommandGroup heading={selectedProvider?.label ?? "Models"} aria-label="Models">
              {filteredModels.map((model) => (
                <CommandItem
                  key={model}
                  value={model}
                  disabled={busy}
                  onSelect={() => void commitModelSelection(model)}
                  className="py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate">{model}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        </CommandList>
      </ModelSelectorCommand>

      {selectedProvider && providerCanAuthenticate(selectedProvider) && selectedProvider.authMethod === "api_key" ? (
        <div className="border-t border-border px-4 py-3">
          <Field>
            <FieldLabel htmlFor="provider-api-key">{selectedProvider.label} API key</FieldLabel>
            <Input
              id="provider-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              disabled={busy}
              onChange={(event) => setApiKey(event.currentTarget.value)}
            />
            <FieldDescription>The credential is sent directly to the provider authentication boundary and is not retained by this form.</FieldDescription>
          </Field>
        </div>
      ) : null}

      {switchError ? (
        <div className="px-4 pb-3">
          <Alert variant="destructive"><AlertDescription>{switchError}</AlertDescription></Alert>
        </div>
      ) : null}

      {props.providerAuthenticating && props.providerAuthDetails ? (
        <section className="flex flex-col gap-3 border-t border-border px-4 py-3" aria-label="Provider authentication">
          <div className="flex flex-col gap-1">
            <p className="font-medium text-foreground">Complete browser sign-in</p>
            {props.providerAuthMessage ? <p className="text-xs text-muted-foreground">{props.providerAuthMessage}</p> : null}
          </div>
          {props.providerAuthDetails.method === "device_code" ? (
            <dl className="grid grid-cols-[auto_1fr] gap-2 text-xs">
              <dt className="text-muted-foreground">Link</dt>
              <dd><code className="select-all break-all text-foreground">{props.providerAuthDetails.verificationUri}</code></dd>
              <dt className="text-muted-foreground">Code</dt>
              <dd><code className="select-all text-lg tracking-wide text-foreground">{props.providerAuthDetails.userCode}</code></dd>
            </dl>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const details = props.providerAuthDetails;
                if (!details) return;
                window.open(
                  details.method === "browser_oauth" ? details.authorizationUri : details.verificationUri,
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
            >
              {props.providerAuthDetails.method === "browser_oauth" ? "Open secure sign-in" : "Open link"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const details = props.providerAuthDetails;
                if (!details) return;
                void copyText(details.method === "browser_oauth" ? details.authorizationUri : details.verificationUri, "Link");
              }}
            >
              Copy link
            </Button>
            {props.providerAuthDetails.method === "device_code" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const details = props.providerAuthDetails;
                  if (details?.method === "device_code") void copyText(details.userCode, "Code");
                }}
              >
                Copy code
              </Button>
            ) : null}
          </div>
          {copyNotice ? <p className="text-xs text-muted-foreground" role="status">{copyNotice}</p> : null}
        </section>
      ) : null}

      <DialogFooter className="m-0 rounded-none">
        <Button type="button" variant="outline" disabled={busy} onClick={() => close()}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || (pane === "providers"
            ? !(selectedProvider?.available || providerCanAuthenticate(selectedProvider))
            : !selectedModelId)}
          onClick={() => {
            if (pane === "models") {
              void commitModelSelection();
              return;
            }
            if (providerCanAuthenticate(selectedProvider)) {
              void authenticateProvider(selectedProvider);
              return;
            }
            void openModelsOrCommit();
          }}
        >
          {pane === "models"
            ? (switchInFlight ? "Switching..." : "Switch")
            : providerCanAuthenticate(selectedProvider)
              ? (authInFlight || props.providerAuthenticating ? "Authenticating..." : "Authenticate")
              : "Next"}
        </Button>
      </DialogFooter>
    </ModelSelector>
  );
}
