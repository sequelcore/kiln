import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  AdmittedExecutionRoute,
  ExecutionCatalog,
  ExecutionSessionBindingEvidence,
} from "@kilnai/core";
import type { ExecutionRouteReasonCode } from "@kilnai/gateway-contracts";
import { admitOperatorExecutionIntent, defineExecutionCatalog } from "@kilnai/core";
import {
  ConfiguredExecutionAccountRuntime,
  createOperatorSessionAccountCapacityAuthority,
  OperatorSessionAuthorityAdmissionBridge,
  OperatorSessionExecutionBridge,
  OperatorSessionExecutionRoutingService,
  OperatorTurnDispatcher,
  type ConfiguredExecutionCredential,
  type OperatorSessionExecutionCatalogSnapshot,
  type SqliteManagedAccountLeaseAuthority,
  type OperatorTurnDispatchPort,
  type RuntimeConfigurationRevisionSnapshot,
} from "@kilnai/runtime";
import type { OperatorExecutionRouteAccountAvailability } from "./operator-execution-route-selection.js";
import {
  readGlobalExecutionCatalog,
  type KilnGlobalConfig,
} from "../config/global-config.js";
import { SqliteRuntimeModelRoundActionClaimStore } from "./runtime-model-round-action-claim-store.js";
import { SqliteRuntimeToolActionClaimStore } from "./runtime-tool-action-claim-store.js";
import { SqliteRuntimeMediaActionClaimStore } from "./runtime-media-action-claim-store.js";
import {
  resolveProjectStateBinding,
  type ProjectStateBinding,
} from "./project-state-root.js";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "./private-project-state-filesystem.js";

export interface OperatorTurnDispatchComposition<Payload, Result> {
  readonly accountRuntime: ConfiguredExecutionAccountRuntime;
  readonly accountCapacityAuthority: SqliteManagedAccountLeaseAuthority;
  readonly modelRoundActionClaims: SqliteRuntimeModelRoundActionClaimStore;
  readonly toolActionClaims: SqliteRuntimeToolActionClaimStore;
  readonly mediaActionClaims: SqliteRuntimeMediaActionClaimStore;
  readonly bridge: OperatorSessionExecutionBridge<ConfiguredExecutionCredential, any, Result>;
  readonly authorityAdmissionBridge: OperatorSessionAuthorityAdmissionBridge<Payload>;
  readonly dispatcher: OperatorTurnDispatchPort<Payload, Result>;
  readonly resolveExecutionRouteAccountAvailability: (input: {
    readonly admission: AdmittedExecutionRoute;
    readonly catalog: ExecutionCatalog;
    readonly configurationRevision: RuntimeConfigurationRevisionSnapshot;
  }) => Promise<readonly OperatorExecutionRouteAccountAvailability[]>;
  readonly close: () => void;
}

/** Composes one fenced account/credential routing service for an operator surface. */
export function createOperatorTurnDispatchComposition<Payload, Result>(input: {
  /** Bootstrap-only catalog; every execution activates a freshly captured snapshot before admission. */
  readonly initialCatalog: ExecutionCatalog;
  readonly captureCatalogSnapshot: () => OperatorSessionExecutionCatalogSnapshot | Promise<OperatorSessionExecutionCatalogSnapshot>;
  readonly cwd: string;
  readonly credentialRootDir?: string;
  /** Test/embedding seam for the verified operator-private project state. */
  readonly projectStateBinding?: ProjectStateBinding;
  readonly readDispatchOutcome?: (result: Result) => "completed" | "unknown";
}): OperatorTurnDispatchComposition<Payload, Result> {
  const binding = input.projectStateBinding ?? resolveProjectStateBinding(input.cwd);
  ensurePrivateStateDirectorySync(binding.projectStateRoot, binding.runtimePath);
  for (const fileName of [
    "operator-session-account-capacity.sqlite",
    "operator-session-model-round-claims.sqlite",
    "operator-session-tool-action-claims.sqlite",
    "operator-session-media-action-claims.sqlite",
  ]) {
    assertPrivateStateFileTargetSync(binding.projectStateRoot, join(binding.runtimePath, fileName));
  }
  const authority = createOperatorSessionAccountCapacityAuthority({
    path: join(binding.runtimePath, "operator-session-account-capacity.sqlite"),
  });
  const modelRoundActionClaims = new SqliteRuntimeModelRoundActionClaimStore({
    path: join(binding.runtimePath, "operator-session-model-round-claims.sqlite"),
    privateStateRoot: binding.projectStateRoot,
  });
  const toolActionClaims = new SqliteRuntimeToolActionClaimStore({
    path: join(binding.runtimePath, "operator-session-tool-action-claims.sqlite"),
    privateStateRoot: binding.projectStateRoot,
  });
  const mediaActionClaims = new SqliteRuntimeMediaActionClaimStore({
    path: join(binding.runtimePath, "operator-session-media-action-claims.sqlite"),
    privateStateRoot: binding.projectStateRoot,
  });
  const accountRuntime = new ConfiguredExecutionAccountRuntime({
    catalog: input.initialCatalog,
    kilnHome: binding.kilnHome,
    ...(input.credentialRootDir ? { credentialRootDir: input.credentialRootDir } : {}),
    observeOperatorSessionCapacity: (candidates) => authority.observeCandidateCapacity(candidates),
  });
  const bridge = new OperatorSessionExecutionBridge<ConfiguredExecutionCredential, any, Result>();
  const authorityAdmissionBridge = new OperatorSessionAuthorityAdmissionBridge<Payload>();
  const routing = new OperatorSessionExecutionRoutingService<ConfiguredExecutionCredential, Payload, Result>({
    catalogSource: {
      capture: input.captureCatalogSnapshot,
      activate: ({ catalog }) => accountRuntime.updateCatalog(catalog),
    },
    candidates: accountRuntime.operatorSessionCandidates,
    accountCapacityAuthority: authority,
    credentials: accountRuntime.operatorSessionCredentials,
    authorityAdmission: authorityAdmissionBridge,
    dispatch: bridge,
    ...(input.readDispatchOutcome ? { readDispatchOutcome: input.readDispatchOutcome } : {}),
  });
  return {
    accountRuntime,
    accountCapacityAuthority: authority,
    modelRoundActionClaims,
    toolActionClaims,
    mediaActionClaims,
    bridge,
    authorityAdmissionBridge,
    dispatcher: new OperatorTurnDispatcher(routing),
    resolveExecutionRouteAccountAvailability: async ({ admission, catalog, configurationRevision }) => {
      const candidates = await accountRuntime.operatorSessionCandidates.resolve({ admission, catalog, configurationRevision });
      return candidates.map(({ candidate, lease }) => {
        const reasonCodes = candidateReasonCodes(candidate, lease.usageEvidence);
        return {
          accountId: candidate.accountId,
          available: reasonCodes.length === 0,
          reasonCodes,
        };
      });
    },
    close: () => {
      modelRoundActionClaims.close();
      toolActionClaims.close();
      mediaActionClaims.close();
      authority.close();
    },
  };
}

const MAX_CATALOG_CAPTURE_ATTEMPTS = 3;

/**
 * Captures catalog values only when the global bytes that produced them match
 * the canonical Runtime revision set captured for the same admission.
 */
export function captureOperatorExecutionCatalogSnapshot(input: {
  readonly projectPath: string;
  readonly readConfigSnapshot: () => { readonly config: KilnGlobalConfig | null; readonly revision: string };
  readonly readConfigurationRevision: (projectPath: string) => RuntimeConfigurationRevisionSnapshot;
  readonly readExecutionCatalog?: (config: KilnGlobalConfig | null) => ExecutionCatalog | undefined;
}): OperatorSessionExecutionCatalogSnapshot {
  for (let attempt = 0; attempt < MAX_CATALOG_CAPTURE_ATTEMPTS; attempt += 1) {
    const config = input.readConfigSnapshot();
    const configurationRevision = input.readConfigurationRevision(input.projectPath);
    if (configurationRevision.revisions.global !== config.revision) continue;
    const catalog = (input.readExecutionCatalog ?? readGlobalExecutionCatalog)(config.config)
      ?? defineEmptyExecutionCatalog();
    return Object.freeze({ catalog, configurationRevision });
  }
  throw new Error("Canonical configuration changed while the operator execution catalog was being admitted.");
}

function defineEmptyExecutionCatalog(): ExecutionCatalog {
  return defineExecutionCatalog({ accounts: [], accountPolicies: [], routes: [] });
}

function candidateReasonCodes(
  candidate: { readonly safety: "eligible" | "ineligible"; readonly health: "healthy" | "unhealthy"; readonly quota: "available" | "exhausted" | "unknown"; readonly capacity: "available" | "exhausted" },
  usage: { readonly freshness: "fresh" | "stale" | "missing"; readonly availability?: "available" | "exhausted" | "unknown" },
): readonly ExecutionRouteReasonCode[] {
  if (candidate.safety === "ineligible") return ["policy-denied"];
  if (usage.freshness === "stale") return ["quota-stale"];
  if (usage.freshness === "missing" || usage.availability === "unknown") return ["quota-unknown"];
  if (candidate.quota === "unknown") return ["quota-unknown"];
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
  const candidates = await input.accountRuntime.operatorSessionCandidates.resolve({
    admission,
    catalog: input.catalog,
    configurationRevision: catalogContentRevision(input.catalog),
  }).catch(() => []);
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

function catalogContentRevision(catalog: ExecutionCatalog): RuntimeConfigurationRevisionSnapshot {
  const revisionSetId = `sha256:${createHash("sha256").update(JSON.stringify(catalog), "utf8").digest("hex")}`;
  return Object.freeze({ revisionSetId, revisions: Object.freeze({ "execution-catalog": revisionSetId }) });
}
