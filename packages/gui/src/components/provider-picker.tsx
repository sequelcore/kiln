import type { GuiProviderModelDiscoveryProjection } from "@kilnai/gateway-contracts";
import { type RefObject, useCallback, useMemo, useReducer } from "react";
import { ModelSelector, ModelSelectorCommand } from "@/components/ai-elements/model-selector";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CommandInput } from "@/components/ui/command";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ProviderAuthDetails, ProviderDescriptor } from "../lib/session-store/index.js";
import { ProviderAuthenticationEvidence } from "./provider-authentication-evidence.js";
import { ProviderBrandRail } from "./provider-brand-rail.js";
import { ProviderRouteTypeFilter } from "./provider-route-type-filter.js";
import { ProviderRouteList } from "./provider-route-list.js";
import {
  filterProviderRoutes,
  normalizeProviderRoutes,
  type ProviderRouteAccessFilter,
  type ProviderRouteOption,
  type ProviderRouteProvider,
  providerRouteKey,
} from "./provider-route-picker-model.js";

interface ProviderPickerProps {
  readonly open: boolean;
  readonly providers: readonly ProviderDescriptor[];
  readonly providerModelDiscovery: GuiProviderModelDiscoveryProjection | null;
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly onSwitchProvider: (provider: string, model?: string) => Promise<void>;
  readonly onAuthenticateProvider?: (
    provider: string,
    options?: { apiKey?: string; tier?: "go" | "zen" },
  ) => Promise<void>;
  readonly onRefreshProviders?: () => void | Promise<void>;
  readonly onOpenChange: (open: boolean) => void;
  readonly providerAuthenticating?: boolean;
  readonly providerAuthProvider?: string | null;
  readonly providerAuthMessage?: string | null;
  readonly providerAuthDetails?: ProviderAuthDetails | null;
  readonly finalFocus?: RefObject<HTMLElement | null>;
}

function shouldAutoFocusSearch(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: fine)").matches
  );
}

interface PickerState {
  readonly selectedRouteKey: string | null;
  readonly routeQuery: string;
  readonly selectedBrandId: string | null;
  readonly accessFilter: ProviderRouteAccessFilter;
  readonly credential: { readonly providerId: string; readonly value: string } | null;
  readonly switchInFlight: boolean;
  readonly refreshInFlight: boolean;
  readonly authInFlight: boolean;
  readonly switchError: string | null;
  readonly copyNotice: string | null;
}

type PickerAction =
  | { readonly type: "patch"; readonly patch: Partial<PickerState> }
  | { readonly type: "select-route"; readonly routeKey: string | null };

function pickerReducer(state: PickerState, action: PickerAction): PickerState {
  if (action.type === "select-route") {
    return { ...state, selectedRouteKey: action.routeKey, switchError: null };
  }
  return { ...state, ...action.patch };
}

export function ProviderPicker(props: ProviderPickerProps) {
  return <ProviderPickerSession key={props.open ? "open" : "closed"} {...props} />;
}

function ProviderPickerSession(props: ProviderPickerProps) {
  const normalized = useMemo(
    () => normalizeProviderRoutes(props.providers, props.providerModelDiscovery),
    [props.providerModelDiscovery, props.providers],
  );
  const routesByKey = useMemo(
    () => new Map(normalized.routes.map((route) => [route.key, route] as const)),
    [normalized.routes],
  );
  const activeRouteKey = props.activeProvider ? providerRouteKey(props.activeProvider, props.activeModel) : null;
  const initialRouteKey =
    activeRouteKey && routesByKey.has(activeRouteKey)
      ? activeRouteKey
      : (normalized.routes.find((route) => route.provider.available)?.key ?? normalized.routes[0]?.key ?? null);
  const [state, dispatch] = useReducer(pickerReducer, {
    selectedRouteKey: initialRouteKey,
    routeQuery: "",
    selectedBrandId: null,
    accessFilter: "all",
    credential: null,
    switchInFlight: false,
    refreshInFlight: false,
    authInFlight: false,
    switchError: null,
    copyNotice: null,
  });
  const filteredRoutes = useMemo(
    () =>
      filterProviderRoutes(normalized.routes, {
        query: state.routeQuery,
        brandId: state.selectedBrandId,
        access: state.accessFilter,
      }),
    [normalized.routes, state.accessFilter, state.routeQuery, state.selectedBrandId],
  );
  const selectedRoute =
    (state.selectedRouteKey ? filteredRoutes.find((route) => route.key === state.selectedRouteKey) : undefined) ??
    filteredRoutes[0] ??
    null;
  const selectedProvider = selectedRoute?.provider ?? null;
  const apiKey = selectedProvider && state.credential?.providerId === selectedProvider.id ? state.credential.value : "";
  const busy =
    state.switchInFlight || state.refreshInFlight || state.authInFlight || props.providerAuthenticating === true;

  const providerCanAuthenticate = useCallback(
    (provider: ProviderRouteProvider | null | undefined): provider is ProviderRouteProvider => {
      if (!provider || provider.available || !provider.authMethod || !props.onAuthenticateProvider) return false;
      return (
        provider.authState === "missing" ||
        provider.authState === "expired" ||
        /auth|api[_ -]?key|credential/i.test(provider.reason ?? "")
      );
    },
    [props.onAuthenticateProvider],
  );

  const selectRoute = useCallback((route: ProviderRouteOption | null) => {
    dispatch({ type: "select-route", routeKey: route?.key ?? null });
  }, []);

  const close = useCallback(
    (force = false) => {
      if (busy && !force) return;
      props.onOpenChange(false);
    },
    [busy, props.onOpenChange],
  );

  const refreshProviders = useCallback(async () => {
    if (!props.onRefreshProviders || busy) return;
    dispatch({ type: "patch", patch: { switchError: null, refreshInFlight: true } });
    try {
      await props.onRefreshProviders();
    } catch (error) {
      dispatch({
        type: "patch",
        patch: { switchError: error instanceof Error ? error.message : "Provider refresh failed. Please retry." },
      });
    } finally {
      dispatch({ type: "patch", patch: { refreshInFlight: false } });
    }
  }, [busy, props.onRefreshProviders]);

  const copyText = async (text: string, label: string): Promise<void> => {
    dispatch({ type: "patch", patch: { copyNotice: null } });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      dispatch({ type: "patch", patch: { copyNotice: `${label} copied.` } });
    } catch {
      dispatch({ type: "patch", patch: { copyNotice: "Copy failed. Select the text manually." } });
    }
  };

  const authenticateProvider = useCallback(
    async (provider: ProviderRouteProvider) => {
      if (!props.onAuthenticateProvider || busy) return;
      const credential = provider.authMethod === "api_key" ? apiKey.trim() : undefined;
      if (provider.authMethod === "api_key" && !credential) {
        dispatch({ type: "patch", patch: { switchError: `Enter the ${provider.label} API key.` } });
        return;
      }

      dispatch({ type: "patch", patch: { switchError: null, authInFlight: true } });
      try {
        await props.onAuthenticateProvider(provider.id, {
          ...(credential ? { apiKey: credential } : {}),
          ...(provider.authTier ? { tier: provider.authTier } : {}),
        });
        dispatch({ type: "patch", patch: { credential: null } });
        await props.onRefreshProviders?.();
      } catch (error) {
        dispatch({
          type: "patch",
          patch: {
            switchError: error instanceof Error ? error.message : "Provider authentication failed. Please retry.",
          },
        });
      } finally {
        dispatch({ type: "patch", patch: { authInFlight: false } });
      }
    },
    [apiKey, busy, props.onAuthenticateProvider, props.onRefreshProviders],
  );

  const commitRoute = useCallback(
    async (route: ProviderRouteOption) => {
      if (busy) return;
      selectRoute(route);
      if (!route.provider.available) {
        if (providerCanAuthenticate(route.provider)) {
          dispatch({
            type: "patch",
            patch: { switchError: "Press Authenticate to start provider sign-in." },
          });
        }
        return;
      }

      dispatch({ type: "patch", patch: { switchError: null, switchInFlight: true } });
      try {
        await props.onSwitchProvider(route.provider.id, route.modelId ?? undefined);
        close(true);
      } catch (error) {
        dispatch({
          type: "patch",
          patch: { switchError: error instanceof Error ? error.message : "Provider switch failed. Please retry." },
        });
      } finally {
        dispatch({ type: "patch", patch: { switchInFlight: false } });
      }
    },
    [busy, close, props.onSwitchProvider, providerCanAuthenticate, selectRoute],
  );

  return (
    <ModelSelector
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Switch provider route"
      description="Search governed provider and model routes."
      contentClassName="max-h-[min(31rem,calc(100dvh-1rem))]"
      anchor={props.finalFocus}
      finalFocus={props.finalFocus}
    >
      <ModelSelectorCommand
        id="provider-route-picker"
        label="Search provider routes"
        value={selectedRoute?.key ?? initialRouteKey ?? undefined}
        onValueChange={(value) => selectRoute(routesByKey.get(value) ?? null)}
      >
        <CommandInput
          aria-label="Search provider routes"
          placeholder="Search providers and models…"
          value={state.routeQuery}
          onValueChange={(routeQuery) =>
            dispatch({
              type: "patch",
              patch: { routeQuery, ...(routeQuery.trim() ? { selectedBrandId: null } : {}) },
            })
          }
          disabled={busy}
          autoFocus={shouldAutoFocusSearch()}
        />

        <div className="flex min-h-0 border-t border-border/70">
          <ProviderBrandRail
            brands={normalized.brands}
            selectedBrandId={state.selectedBrandId}
            onSelectBrand={(selectedBrandId) =>
              dispatch({ type: "patch", patch: { selectedBrandId, routeQuery: "", selectedRouteKey: null } })
            }
          />
          <div className="flex min-w-0 flex-1 flex-col border-l border-border/70">
            <div className="flex items-center gap-1 border-b border-border/70 p-1.5">
              <ProviderRouteTypeFilter
                value={state.accessFilter}
                onChange={(accessFilter) =>
                  dispatch({
                    type: "patch",
                    patch: { accessFilter, selectedRouteKey: null },
                  })
                }
              />
              {props.onRefreshProviders ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-label={state.refreshInFlight ? "Refreshing providers" : "Refresh providers"}
                  aria-busy={state.refreshInFlight || undefined}
                  disabled={busy}
                  onClick={() => void refreshProviders()}
                  className="ml-auto shrink-0"
                >
                  {state.refreshInFlight ? "Refreshing…" : "Refresh"}
                </Button>
              ) : null}
            </div>
            <ProviderRouteList
              routes={filteredRoutes}
              activeProvider={props.activeProvider}
              activeModel={props.activeModel}
              busy={busy}
              providerAuthProvider={props.providerAuthProvider}
              providerAuthMessage={props.providerAuthMessage}
              providerCanAuthenticate={providerCanAuthenticate}
              onCommitRoute={(route) => void commitRoute(route)}
            />
          </div>
        </div>
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
              aria-invalid={state.switchError?.startsWith("Enter the") || undefined}
              onChange={(event) =>
                dispatch({
                  type: "patch",
                  patch: { credential: { providerId: selectedProvider.id, value: event.currentTarget.value } },
                })
              }
            />
            <FieldDescription>
              Sent directly to the provider authentication boundary. This form does not retain it.
            </FieldDescription>
          </Field>
        </div>
      ) : null}

      {state.switchError ? (
        <div className="px-4 pb-3" aria-live="polite">
          <Alert variant="destructive">
            <AlertDescription>{state.switchError}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {props.providerAuthenticating && props.providerAuthDetails ? (
        <ProviderAuthenticationEvidence
          details={props.providerAuthDetails}
          message={props.providerAuthMessage}
          copyNotice={state.copyNotice}
          onCopy={(text, label) => void copyText(text, label)}
        />
      ) : null}

      {selectedProvider && providerCanAuthenticate(selectedProvider) ? (
        <div className="flex justify-end border-t border-border p-3">
          <Button type="button" disabled={busy} onClick={() => void authenticateProvider(selectedProvider)}>
            {state.authInFlight || props.providerAuthenticating ? "Authenticating…" : "Authenticate"}
          </Button>
        </div>
      ) : null}
    </ModelSelector>
  );
}
