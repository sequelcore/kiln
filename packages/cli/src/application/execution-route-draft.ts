import {
  defineExecutionCatalog,
  type ExecutionCatalogInput,
  type ExecutionDataClassification,
  type ExecutionRoute,
  type ExecutionRouteAccountSelection,
  type ExecutionRouteDataPolicyEvidence,
  type ExecutionRouteEconomicsConfig,
} from "@kilnai/core";
import type { AvailableModelCatalogEntry } from "@kilnai/gateway-contracts";
import type {
  DirectExecutionTargetEvidence,
  DirectExecutionTargetIntent,
} from "../config/execution-target-evidence-store.js";
import { defineExecutionTargetEvidenceSnapshot } from "../config/execution-target-evidence-store.js";

const MATERIAL_FIELDS = ["routeId", "label", "accountSelection", "dataClassification", "dataPolicyEvidence", "economics"] as const;
const FORBIDDEN_KEY = /(secret|token|password|api.?key|credential)/iu;

export interface ExecutionRouteDraftIdentity {
  readonly providerId: string;
  readonly providerRouteId: string;
  readonly providerModelId: string;
}

export interface IncompleteExecutionRouteDraft {
  readonly status: "incomplete";
  readonly discoveryIdentity: ExecutionRouteDraftIdentity;
  readonly missingFields: typeof MATERIAL_FIELDS;
}

export interface CompleteExecutionRouteDraft {
  readonly status: "complete";
  readonly discoveryIdentity: ExecutionRouteDraftIdentity;
  readonly route: ExecutionRoute;
  readonly intent: DirectExecutionTargetIntent;
  readonly evidence: DirectExecutionTargetEvidence;
}

export interface ExecutionRouteDraftDiscoveryEvidence {
  readonly evidenceIdentity: string;
  readonly evidenceRevision: `sha256:${string}`;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface ExecutionRouteDraftMaterial {
  readonly routeId: string;
  readonly label: string;
  readonly accountSelection: ExecutionRouteAccountSelection;
  readonly dataClassification: ExecutionDataClassification;
  readonly dataPolicyEvidence: ExecutionRouteDataPolicyEvidence;
  readonly economics: ExecutionRouteEconomicsConfig;
}

export function startExecutionRouteDraft(discovery: AvailableModelCatalogEntry): IncompleteExecutionRouteDraft {
  if (discovery.discoveryState !== "observed" || discovery.eligibilityState !== "eligible") {
    throw new Error("Execution target drafts require currently observed, eligible discovery evidence.");
  }
  return {
    status: "incomplete",
    discoveryIdentity: {
      providerId: discovery.providerId,
      providerRouteId: discovery.providerRouteId,
      providerModelId: discovery.providerModelId,
    },
    missingFields: MATERIAL_FIELDS,
  };
}

export function completeExecutionRouteDraft(input: {
  readonly draft: IncompleteExecutionRouteDraft;
  readonly material: ExecutionRouteDraftMaterial;
  readonly discoveryEvidence: ExecutionRouteDraftDiscoveryEvidence;
  readonly catalog: ExecutionCatalogInput;
}): CompleteExecutionRouteDraft {
  rejectSecretLikeKeys(input.material);
  const route: ExecutionRoute = {
    id: input.material.routeId,
    label: input.material.label,
    providerId: input.draft.discoveryIdentity.providerId,
    providerModelId: input.draft.discoveryIdentity.providerModelId,
    accountSelection: input.material.accountSelection,
    dataClassification: input.material.dataClassification,
    dataPolicyEvidence: input.material.dataPolicyEvidence,
    economics: input.material.economics,
  };
  const admitted = defineExecutionCatalog({ ...input.catalog, routes: [...input.catalog.routes, route] });
  const admittedRoute = admitted.routes[admitted.routes.length - 1]!;
  const intent: DirectExecutionTargetIntent = {
    id: admittedRoute.id,
    kind: "direct",
    label: admittedRoute.label,
    providerId: admittedRoute.providerId,
    providerModelId: admittedRoute.providerModelId,
    accountSelection: admittedRoute.accountSelection,
    dataClassification: admittedRoute.dataClassification,
    economics: {
      authBillingChannel: admittedRoute.economics.authBillingChannel,
      executionMode: admittedRoute.economics.executionMode,
      serviceTier: admittedRoute.economics.serviceTier,
      fallbackPosture: admittedRoute.economics.fallbackPosture,
      overagePosture: admittedRoute.economics.overagePosture,
      executionEnvelope: admittedRoute.economics.executionEnvelope,
    },
  };
  const parsedEvidence = defineExecutionTargetEvidenceSnapshot({
    version: 1,
    accounts: [],
    targets: [{
      targetId: admittedRoute.id,
      kind: "direct",
      discovery: {
        providerId: input.draft.discoveryIdentity.providerId,
        providerRouteId: input.draft.discoveryIdentity.providerRouteId,
        providerModelId: input.draft.discoveryIdentity.providerModelId,
        evidenceIdentity: input.discoveryEvidence.evidenceIdentity,
        evidenceRevision: input.discoveryEvidence.evidenceRevision,
        observedAt: input.discoveryEvidence.observedAt,
        expiresAt: input.discoveryEvidence.expiresAt,
      },
      dataPolicyEvidence: admittedRoute.dataPolicyEvidence,
      economics: {
        adapterCapabilityId: admittedRoute.economics.adapterCapabilityId,
        adapterCapabilityVersion: admittedRoute.economics.adapterCapabilityVersion,
        rateCardBasis: admittedRoute.economics.rateCardBasis,
        envelopeSemantics: admittedRoute.economics.envelopeSemantics,
        contextClass: admittedRoute.economics.contextClass,
        cacheClass: admittedRoute.economics.cacheClass,
        priceEvidence: admittedRoute.economics.priceEvidence,
        auxiliaryCharges: admittedRoute.economics.auxiliaryCharges,
      },
    }],
  }).targets[0];
  if (!parsedEvidence || parsedEvidence.kind !== "direct") {
    throw new Error("Execution target draft did not produce direct managed evidence.");
  }
  const evidence: DirectExecutionTargetEvidence = parsedEvidence;
  return {
    status: "complete",
    discoveryIdentity: input.draft.discoveryIdentity,
    route: admittedRoute,
    intent,
    evidence,
  };
}

function rejectSecretLikeKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(rejectSecretLikeKeys);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`Execution target draft contains forbidden secret or credential field: ${key}`);
    rejectSecretLikeKeys(child);
  }
}
