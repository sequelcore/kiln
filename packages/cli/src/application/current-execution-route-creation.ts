import type { AvailableModelCatalog, AvailableModelCatalogEntry, ExecutionRouteCreationRequest } from "@kilnai/gateway-contracts";
import type { ExecutionCatalogInput } from "@kilnai/core";
import type { GlobalConfigMutationOptions, GlobalConfigMutationResult, KilnGlobalConfig } from "../config/global-config.js";
import type {
  ExecutionTargetCatalogIntent,
  ExecutionTargetEvidenceSnapshot,
} from "../config/execution-target-evidence-store.js";
import { completeExecutionRouteDraft, startExecutionRouteDraft } from "./execution-route-draft.js";
import { createExecutionRoute } from "./execution-route-creation.js";

export async function createCurrentExecutionRoute(input: {
  readonly request: ExecutionRouteCreationRequest;
  readonly admittedEvidence: {
    readonly entry: AvailableModelCatalogEntry;
    readonly catalogObservedAt: string;
    readonly expiresAt: string;
    readonly evidenceIdentity: string;
    readonly evidenceRevision: `sha256:${string}`;
  };
  readonly resolveCurrentEvidence: () => Promise<{
    readonly catalog: AvailableModelCatalog;
    readonly executionCatalog: ExecutionCatalogInput;
    readonly targetIntent: ExecutionTargetCatalogIntent;
    readonly targetEvidence: ExecutionTargetEvidenceSnapshot;
    readonly revision: string;
  }>;
  readonly mutateGlobalConfig: (mutation: (current: KilnGlobalConfig | null) => KilnGlobalConfig, options: GlobalConfigMutationOptions) => GlobalConfigMutationResult;
  readonly refreshExecutionRoutes: () => Promise<void>;
}) {
  const current = await input.resolveCurrentEvidence();
  const exact = current.catalog.entries.find((candidate) => sameIdentity(candidate, input.admittedEvidence.entry));
  if (!exact || exact.discoveryState !== "observed" || exact.eligibilityState !== "eligible"
    || exact.availabilityState !== input.admittedEvidence.entry.availabilityState
    || Date.parse(current.catalog.observedAt) < Date.parse(input.admittedEvidence.catalogObservedAt)
    || current.revision !== input.request.expectedRevision) {
    throw new Error("Current provider discovery or configuration evidence changed before mutation.");
  }
  const draft = startExecutionRouteDraft(exact);
  const complete = completeExecutionRouteDraft({
    draft,
    material: { ...input.request.material, dataPolicyEvidence: { ...input.request.material.dataPolicyEvidence, sourceDigest: input.request.material.dataPolicyEvidence.sourceDigest as `sha256:${string}` } },
    discoveryEvidence: {
      evidenceIdentity: input.admittedEvidence.evidenceIdentity,
      evidenceRevision: input.admittedEvidence.evidenceRevision,
      observedAt: input.admittedEvidence.catalogObservedAt,
      expiresAt: input.admittedEvidence.expiresAt,
    },
    catalog: current.executionCatalog,
  });
  return createExecutionRoute({
    draft: complete,
    expectedRevision: current.revision,
    currentIntent: current.targetIntent,
    currentEvidence: current.targetEvidence,
    mutateGlobalConfig: input.mutateGlobalConfig,
    refreshExecutionRoutes: input.refreshExecutionRoutes,
  });
}

function sameIdentity(left: AvailableModelCatalogEntry, right: AvailableModelCatalogEntry): boolean {
  return left.providerId === right.providerId && left.providerRouteId === right.providerRouteId
    && left.providerModelId === right.providerModelId;
}
