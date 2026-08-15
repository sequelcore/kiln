import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProviderGlyph } from "./provider-glyph.js";
import {
  conciseExecutionRouteUnavailableReason,
  EXECUTION_ROUTE_ACCESS_LABEL,
  type ExecutionRoutePickerRow,
} from "./execution-route-picker-model.js";
import type { ExecutionRouteRepairRequest } from "./execution-route-picker.js";

function repairActionLabel(action: ExecutionRouteRepairRequest["action"], providerId: string): string | null {
  switch (action) {
    case "authenticate-provider":
      return `Authenticate ${providerId}`;
    case "refresh-route-catalog":
      return "Refresh execution targets";
    default:
      return null;
  }
}

export function ExecutionRouteList(props: {
  readonly routes: readonly ExecutionRoutePickerRow[];
  readonly activeRouteId: string | null | undefined;
  readonly activeAccountOverrideId: string | null | undefined;
  readonly onSelect: (selection: { routeId: string; accountOverrideId?: string }) => void;
  readonly onRepair: (request: ExecutionRouteRepairRequest) => void | Promise<void>;
}) {
  return (
    <CommandList label="Execution targets" className="max-h-[21rem] flex-1 overscroll-contain p-1.5">
      <CommandEmpty>No governed execution targets match these filters.</CommandEmpty>
      <CommandGroup aria-label="Routes" className="p-0">
        {props.routes.map((route) => {
          const current = props.activeRouteId === route.routeId;
          const unavailable = !route.available;
          const automatic = route.accountOptions.some((account) => account.mode === "automatic");
          const activeAccount = current && route.accountOptions.some(
            (account) => account.id === props.activeAccountOverrideId,
          ) ? (props.activeAccountOverrideId ?? "") : "";
          const accountLabel = automatic
            ? (activeAccount || "Automatic")
            : "Exact account";
          const detail = route.access ? EXECUTION_ROUTE_ACCESS_LABEL[route.access] : "Configured route";
          const name = `${route.label}, ${accountLabel}${current ? ", Current" : ""}${unavailable ? ", Unavailable" : ""}`;
          const accountOverrides = route.accountOptions.filter(
            (account): account is { readonly id: string; readonly mode: "exact" } => Boolean(account.id),
          );

          return (
            <div key={route.routeId}>
              <div className="relative">
                <CommandItem
                  value={route.routeId}
                  aria-label={name}
                  disabled={unavailable}
                  onSelect={() => props.onSelect({ routeId: route.routeId })}
                  className="items-start rounded-lg px-2.5 py-2.5"
                >
                  <ProviderGlyph providerId={route.providerId} className="mt-0.5" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{route.label}</span>
                      {route.free ? <Badge variant="secondary">Free</Badge> : null}
                      {current ? <span className="text-xs text-muted-foreground">Current</span> : null}
                      {unavailable ? <span className="text-xs text-muted-foreground">Unavailable</span> : null}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="truncate">{route.providerId} · {route.providerModelId} · {detail}</span>
                      {accountOverrides.length === 0 ? <span>{accountLabel}</span> : null}
                    </span>
                    {unavailable && route.reason ? (
                      <span className="text-xs text-muted-foreground">
                        {conciseExecutionRouteUnavailableReason(route.reason)}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>

                {!unavailable && automatic && accountOverrides.length > 0 ? (
                  <div
                    className="mt-1 flex justify-end px-2 pb-1 sm:absolute sm:right-8 sm:bottom-1.5 sm:mt-0 sm:p-0"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Select
                      value={activeAccount}
                      onValueChange={(accountOverrideId) => props.onSelect({
                        routeId: route.routeId,
                        ...(accountOverrideId ? { accountOverrideId } : {}),
                      })}
                    >
                      <SelectTrigger
                        size="sm"
                        variant="ghost"
                        aria-label={`${route.label} account`}
                        className="h-6 max-w-36 px-2 text-xs"
                      >
                        <SelectValue>{accountLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="end" alignItemWithTrigger={false}>
                        <SelectItem value="">Automatic</SelectItem>
                        {accountOverrides.map((account) => (
                          <SelectItem key={account.id} value={account.id}>{account.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>

              {unavailable && route.repairActions.length > 0 ? (
                <div
                  role="group"
                  className="-mt-2 flex flex-wrap gap-1 px-10 pb-2"
                  aria-label={`${route.label} repair actions`}
                >
                  {route.repairActions.map((action) => {
                    const label = repairActionLabel(action, route.providerId);
                    return label ? (
                      <Button
                        key={action}
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          void props.onRepair({ routeId: route.routeId, providerId: route.providerId, action });
                        }}
                      >
                        {label}
                      </Button>
                    ) : null;
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </CommandGroup>
    </CommandList>
  );
}
