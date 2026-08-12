import { join } from "node:path";
import type {
  AdmittedExecutionRoute,
  ExecutionCatalog,
  ExecutionSessionBindingEvidence,
} from "@kilnai/core";
import type { ExecutionRouteReasonCode } from "@kilnai/gateway-contracts";
import { admitOperatorExecutionIntent } from "@kilnai/core";
import {
  ConfiguredExecutionAccountRuntime,
  createOperatorSessionAccountCapacityAuthority,
  OperatorSessionExecutionBridge,
  OperatorSessionExecutionRoutingService,
  OperatorTurnDispatcher,
  type ConfiguredExecutionCredential,
  type SqliteManagedAccountLeaseAuthority,
  type OperatorTurnDispatchPort,
} from "@kilnai/runtime";
import type { OperatorExecutionRouteAccountAvailability } from "./operator-execution-route-selection.js";

export interface OperatorTurnDispatchComposition<Payload, Result> {
  readonly accountRuntime: ConfiguredExecutionAccountRuntime;
  readonly accountCapacityAuthority: SqliteManagedAccountLeaseAuthority;
  readonly bridge: OperatorSessionExecutionBridge<ConfiguredExecutionCredential, any, Result>;
  readonly dispatcher: OperatorTurnDispatchPort<Payload, Result>;
  readonly resolveExecutionRouteAccountAvailability: (input: {
    readonly admission: AdmittedExecutionRoute;
  }) => Promise<readonly OperatorExecutionRouteAccountAvailability[]>;
  readonly close: () => void;
}

/** Composes one fenced account/credential routing service for an operator surface. */
export function createOperatorTurnDispatchComposition<Payload, Result>(input: {
  readonly catalog: ExecutionCatalog;
  readonly cwd: string;
  readonly credentialRootDir?: string;
}): OperatorTurnDispatchComposition<Payload, Result> {
  const authority = createOperatorSessionAccountCapacityAuthority({
    path: join(input.cwd, ".kiln", "runtime", "operator-session-account-capacity.sqlite"),
  });
  const accountRuntime = new ConfiguredExecutionAccountRuntime({
    catalog: input.catalog,
    ...(input.credentialRootDir ? { credentialRootDir: input.credentialRootDir } : {}),
    observeOperatorSessionCapacity: (candidates) => authority.observeCandidateCapacity(candidates),
  });
  const bridge = new OperatorSessionExecutionBridge<ConfiguredExecutionCredential, any, Result>();
  const routing = new OperatorSessionExecutionRoutingService<ConfiguredExecutionCredential, Payload, Result>({
    catalog: input.catalog,
    candidates: accountRuntime.operatorSessionCandidates,
    accountCapacityAuthority: authority,
    credentials: accountRuntime.operatorSessionCredentials,
    dispatch: bridge,
  });
  return {
    accountRuntime,
    accountCapacityAuthority: authority,
    bridge,
    dispatcher: new OperatorTurnDispatcher(routing),
    resolveExecutionRouteAccountAvailability: async ({ admission }) => {
      const candidates = await accountRuntime.operatorSessionCandidates.resolve({ admission });
      return candidates.map(({ candidate, lease }) => {
        const reasonCodes = candidateReasonCodes(candidate, lease.usageEvidence);
        return {
          accountId: candidate.accountId,
          available: reasonCodes.length === 0,
          reasonCodes,
        };
      });
    },
    close: () => authority.close(),
  };
}

function candidateReasonCodes(
  candidate: { readonly safety: "eligible" | "ineligible"; readonly health: "healthy" | "unhealthy"; readonly quota: "available" | "exhausted"; readonly capacity: "available" | "exhausted" },
  usage: { readonly freshness: "fresh" | "stale" | "missing"; readonly availability?: "available" | "exhausted" | "unknown" },
): readonly ExecutionRouteReasonCode[] {
  if (candidate.safety === "ineligible") return ["policy-denied"];
  if (usage.freshness === "stale") return ["quota-stale"];
  if (usage.freshness === "missing" || usage.availability === "unknown") return ["quota-unknown"];
  if (candidate.quota === "exhausted" || usage.availability === "exhausted") return ["quota-exhausted"];
  if (candidate.health === "unhealthy") return ["provider-unavailable"];
  if (candidate.capacity === "exhausted") return ["account-capacity-exhausted"];
  return [];
}

export function committedBindingToRouteSelection(binding: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>): {
  readonly routeId: string;
  readonly accountId: string;
  readonly credentialId: string;
  readonly credentialRevision: string;
} {
  return {
    routeId: binding.routeId,
    accountId: binding.accountId,
    credentialId: binding.credentialId,
    credentialRevision: binding.credentialRevision,
  };
}

/** Returns an admission only when a persisted continuation still owns the same account revision. */
export async function resolveOperatorContinuationBinding(input: {
  readonly catalog: ExecutionCatalog;
  readonly accountRuntime: ConfiguredExecutionAccountRuntime;
  readonly binding: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>;
  readonly requestedRouteId?: string;
}): Promise<{ readonly admission: AdmittedExecutionRoute } | undefined> {
  if (input.requestedRouteId && input.requestedRouteId !== input.binding.routeId) return undefined;
  let admission: AdmittedExecutionRoute;
  try {
    admission = admitOperatorExecutionIntent(input.catalog, {
      routeId: input.binding.routeId,
      accountOverrideId: input.binding.accountId,
    });
  } catch {
    return undefined;
  }
  const candidates = await input.accountRuntime.operatorSessionCandidates.resolve({ admission }).catch(() => []);
  const matching = candidates.find(({ candidate, lease }) => (
    candidate.accountId === input.binding.accountId
    && lease.credentialRevisionId === input.binding.credentialRevision
    && lease.candidate.route.providerId === admission.providerId
    && lease.candidate.route.providerModelId === admission.providerModelId
    && lease.candidate.route.scope === "operator-session"
    && candidate.safety === "eligible"
    && candidate.health === "healthy"
    && candidate.quota === "available"
    && candidate.capacity === "available"
  ));
  return matching ? { admission } : undefined;
}
