import { Badge } from "@/components/ui/badge";
import { CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { ProviderGlyph } from "./provider-glyph.js";
import {
  conciseProviderUnavailableReason,
  PROVIDER_ROUTE_ACCESS_LABEL,
  type ProviderRouteOption,
  type ProviderRouteProvider,
} from "./provider-route-picker-model.js";

interface ProviderRouteListProps {
  readonly routes: readonly ProviderRouteOption[];
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly busy: boolean;
  readonly providerAuthProvider?: string | null;
  readonly providerAuthMessage?: string | null;
  readonly providerCanAuthenticate: (provider: ProviderRouteProvider) => boolean;
  readonly onCommitRoute: (route: ProviderRouteOption) => void;
}

function routeIsActive(route: ProviderRouteOption, activeProvider: string | null, activeModel: string | null): boolean {
  return route.provider.id === activeProvider && route.modelId === activeModel;
}

function routeEvidenceLabel(provider: ProviderRouteProvider): string | null {
  if (provider.diagnosticModelCount <= provider.models.length) return null;
  return `${provider.models.length} eligible / ${provider.diagnosticModelCount} observed`;
}

export function ProviderRouteList(props: ProviderRouteListProps) {
  return (
    <CommandList label="Provider routes" className="max-h-[21rem] flex-1 overscroll-contain p-1.5">
      <CommandEmpty>No governed routes match these filters.</CommandEmpty>
      <CommandGroup aria-label="Routes" className="p-0">
        {props.routes.map((route) => {
          const authenticatable = props.providerCanAuthenticate(route.provider);
          const disabled = (!route.provider.available && !authenticatable) || props.busy;
          const active = routeIsActive(route, props.activeProvider, props.activeModel);
          const evidence = routeEvidenceLabel(route.provider);
          const busyAuthenticating = props.busy && props.providerAuthProvider === route.provider.id;
          return (
            <CommandItem
                  key={route.key}
                  value={route.key}
                  disabled={disabled}
                  aria-disabled={disabled}
                  aria-label={`${route.provider.label}, ${route.modelId ?? "No model selection"}${active ? ", Current" : ""}`}
                  onSelect={() => props.onCommitRoute(route)}
                  className="items-start rounded-lg px-2.5 py-2.5"
                >
                  <ProviderGlyph providerId={route.provider.id} className="mt-0.5" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{route.modelId ?? route.provider.label}</span>
                      {route.provider.free ? <Badge variant="secondary">Free</Badge> : null}
                      {active ? <span className="text-xs text-muted-foreground">Current</span> : null}
                      {!route.provider.available ? (
                        <span className="text-xs text-muted-foreground">
                          {authenticatable ? (busyAuthenticating ? "Authenticating" : "Sign in") : "Unavailable"}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      {route.modelId ? (
                        <span className="truncate">
                          {route.provider.label} · {PROVIDER_ROUTE_ACCESS_LABEL[route.provider.access]}
                        </span>
                      ) : null}
                      {route.modelId === null && route.provider.available ? <span>No model selection</span> : null}
                      {evidence ? <span>{evidence}</span> : null}
                    </span>
                    {busyAuthenticating && props.providerAuthMessage ? (
                      <span className="text-xs text-muted-foreground">{props.providerAuthMessage}</span>
                    ) : null}
                    {!route.provider.available && route.provider.reason ? (
                      <span className="text-xs text-muted-foreground">
                        {conciseProviderUnavailableReason(route.provider.reason)}
                      </span>
                    ) : null}
                  </span>
            </CommandItem>
          );
        })}
      </CommandGroup>
    </CommandList>
  );
}
