import {
  admitOperatorExecutionIntent,
  defineExecutionCatalog,
  type ExecutionCatalog,
} from "@kilnai/core";
import type {
  ExecutionRouteCatalog,
  ExecutionRouteCatalogEntry,
  ExecutionRouteReasonCode,
  ExecutionRouteSelectionIntent,
} from "@kilnai/gateway-contracts";
import type { OperatorExecutionRouteSelectionPort } from "@kilnai/runtime";
import { readGlobalExecutionCatalog, type KilnGlobalConfig } from "../config/global-config.js";

export function createOperatorExecutionRouteSelectionPort(input: {
  readonly readConfigSnapshot: () => { readonly config: KilnGlobalConfig | null; readonly revision: string };
  readonly readExecutionCatalog?: (config: KilnGlobalConfig | null) => ExecutionCatalog | undefined;
  readonly resolveAccountAvailability: (input: {
    readonly admission: ReturnType<typeof admitOperatorExecutionIntent>;
  }) => Promise<readonly OperatorExecutionRouteAccountAvailability[]>;
}): OperatorExecutionRouteSelectionPort {
  const catalog = (config: KilnGlobalConfig | null): ExecutionCatalog => {
    const configured = (input.readExecutionCatalog ?? readGlobalExecutionCatalog)(config);
    if (!configured) return defineExecutionCatalog({ accounts: [], accountPolicies: [], routes: [] });
    return defineExecutionCatalog(configured);
  };
  const getCatalog = async (): Promise<ExecutionRouteCatalog> => {
    const snapshot = input.readConfigSnapshot();
    return projectCatalog(catalog(snapshot.config), input.resolveAccountAvailability, snapshot.revision);
  };
  return {
    getCatalog,
    admit: async (intent: ExecutionRouteSelectionIntent) => {
      const projected = await getCatalog();
      const rejected = rejectUnavailableExecutionRoute(projected, intent);
      if (rejected) return rejected;
      try {
        const admitted = admitOperatorExecutionIntent(catalog(input.readConfigSnapshot().config), intent);
        return {
          ok: true,
          admission: {
            routeId: admitted.routeId,
            providerId: admitted.providerId,
            providerModelId: admitted.providerModelId,
          },
        };
      } catch (error) {
        return {
          ok: false,
          reasonCode: "route-not-configured",
          reason: error instanceof Error ? error.message : "Execution target admission failed.",
          repairActions: ["review-route-configuration"],
        };
      }
    },
  };
}

/**
 * The session factory still needs derived provider evidence to establish its
 * first transport. The configured route remains the only selection input.
 */
export function resolveOperatorStartupExecutionRoute(
  config: KilnGlobalConfig,
  catalog: ExecutionCatalog = readGlobalExecutionCatalog(config)
    ?? defineExecutionCatalog({ accounts: [], accountPolicies: [], routes: [] }),
) {
  const routeId = config.ui?.targetSelection?.targetId
    ?? config.targetRouting?.defaultTargetId;
  const route = catalog.routes.find((candidate) => candidate.id === routeId);
  if (!route) {
    throw new Error("No configured execution target is available for the operator surface.");
  }
  return route;
}

async function projectCatalog(
  catalog: ExecutionCatalog,
  resolveAccountAvailability: (input: {
    readonly admission: ReturnType<typeof admitOperatorExecutionIntent>;
  }) => Promise<readonly OperatorExecutionRouteAccountAvailability[]>,
  revision: string,
): Promise<ExecutionRouteCatalog> {
  const accountAvailabilityByRoute = new Map<string, readonly OperatorExecutionRouteAccountAvailability[]>();
  for (const route of catalog.routes) {
    try {
      const admission = admitOperatorExecutionIntent(catalog, { routeId: route.id });
      accountAvailabilityByRoute.set(route.id, await resolveAccountAvailability({ admission }));
    } catch {
      accountAvailabilityByRoute.set(route.id, []);
    }
  }
  return {
    observedAt: new Date().toISOString(),
    revision,
    routes: catalog.routes.map((route): ExecutionRouteCatalogEntry => {
      const selection = route.accountSelection;
      const configuredAccountIds = selection.mode === "automatic"
        ? catalog.accountPolicies.find((policy) => policy.id === selection.accountPolicyId)?.accountIds ?? []
        : [selection.accountId];
      const accountAvailability = accountAvailabilityByRoute.get(route.id) ?? [];
      const executableAccountIds = configuredAccountIds.filter((accountId) => accountAvailability.some((account) => (
        account.accountId === accountId && isExecutableAccountAvailability(account)
      )));
      const available = executableAccountIds.length > 0;
      const unavailableAccounts = configuredAccountIds.map((accountId) => accountAvailability.find((account) => account.accountId === accountId)
        ?? { accountId, available: false, reasonCodes: ["missing-credentials"] as const })
        .filter((account) => !isExecutableAccountAvailability(account));
      const reasonCodes = available ? [] : routeReasonCodes(unavailableAccounts);
      const base = {
        routeId: route.id,
        label: route.label,
        providerId: route.providerId,
        providerModelId: route.providerModelId,
        availability: available ? "available" as const : "unavailable" as const,
        reasonCodes,
        repairActions: available ? [] : repairActionsFor(reasonCodes),
      };
      if (selection.mode === "exact") {
        return {
          ...base,
          accountSelection: { mode: "exact", eligibleAccountCount: 1, allowOperatorOverride: false },
        };
      }
      return {
        ...base,
        accountSelection: { mode: "automatic", eligibleAccountCount: executableAccountIds.length, allowOperatorOverride: true },
        ...(executableAccountIds.length ? { accountOverrideIds: executableAccountIds } : {}),
      };
    }),
  };
}

function isExecutableAccountAvailability(account: OperatorExecutionRouteAccountAvailability): boolean {
  return account.available;
}

export interface OperatorExecutionRouteAccountAvailability {
  readonly accountId: string;
  readonly available: boolean;
  readonly reasonCodes: readonly ExecutionRouteReasonCode[];
}

function routeReasonCodes(accounts: readonly OperatorExecutionRouteAccountAvailability[]): readonly ExecutionRouteReasonCode[] {
  const codes = [...new Set(accounts.flatMap((account) => account.reasonCodes))];
  return codes.length > 0 ? codes : ["account-unavailable"];
}

function repairActionsFor(reasonCodes: readonly ExecutionRouteReasonCode[]) {
  if (reasonCodes.includes("missing-credentials") || reasonCodes.includes("credential-unavailable")) {
    return ["authenticate-provider", "check-account", "refresh-route-catalog"] as const;
  }
  if (reasonCodes.includes("provider-unavailable")) return ["check-provider", "retry-route", "refresh-route-catalog"] as const;
  if (reasonCodes.includes("quota-exhausted") || reasonCodes.includes("account-capacity-exhausted")) {
    return ["select-another-route", "retry-route", "refresh-route-catalog"] as const;
  }
  return ["check-account", "refresh-route-catalog"] as const;
}

function rejectUnavailableExecutionRoute(
  catalog: ExecutionRouteCatalog,
  intent: ExecutionRouteSelectionIntent,
) {
  const route = catalog.routes.find((candidate) => candidate.routeId === intent.routeId);
  if (!route) {
    return {
      ok: false as const,
      reasonCode: "route-not-configured" as const,
      reason: `Execution target '${intent.routeId}' is not configured.`,
      repairActions: ["review-route-configuration"] as const,
    };
  }
  if (intent.accountOverrideId && (route.accountSelection.mode !== "automatic" || !route.accountOverrideIds?.includes(intent.accountOverrideId))) {
    return {
      ok: false as const,
      reasonCode: "account-unavailable" as const,
      reason: `Account override '${intent.accountOverrideId}' is not executable for route '${intent.routeId}'.`,
      repairActions: ["check-account", "refresh-route-catalog"] as const,
    };
  }
  if (route.availability === "available") return undefined;
  return {
    ok: false as const,
    reasonCode: route.reasonCodes[0] ?? "route-evidence-pending" as const,
    reason: `Execution target '${intent.routeId}' is unavailable.`,
    repairActions: route.repairActions,
  };
}
