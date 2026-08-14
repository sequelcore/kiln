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
    throw new Error("Execution route drafts require currently observed, eligible discovery evidence.");
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
  return {
    status: "complete",
    discoveryIdentity: input.draft.discoveryIdentity,
    route: admitted.routes[admitted.routes.length - 1]!,
  };
}

function rejectSecretLikeKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(rejectSecretLikeKeys);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`Execution route draft contains forbidden secret or credential field: ${key}`);
    rejectSecretLikeKeys(child);
  }
}
