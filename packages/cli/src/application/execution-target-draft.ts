import {
  defineExecutionTargetCatalog,
  type ExecutionTargetCatalogInput,
  type ExecutionDataClassification,
  type DirectExecutionTarget,
  type ExecutionTargetDataPolicyEvidence,
  type ExecutionTargetEconomicsConfig,
} from "@kilnai/core";
import type { ModelCatalogEntry } from "@kilnai/gateway-contracts";
import type {
  DirectExecutionTargetEvidence,
  DirectExecutionTargetIntent,
} from "../config/execution-target-evidence-store.js";
import { defineExecutionTargetEvidenceSnapshot } from "../config/execution-target-evidence-store.js";

const MATERIAL_FIELDS = ["targetId", "label", "accountPolicyId", "dataClassification", "dataPolicyEvidence", "economics"] as const;
const FORBIDDEN_KEY = /(secret|token|password|api.?key|credential)/iu;

export interface ExecutionTargetDraftIdentity {
  readonly providerId: string;
  readonly providerRouteId: string;
  readonly providerModelId: string;
}

export interface IncompleteExecutionTargetDraft {
  readonly status: "incomplete";
  readonly discoveryIdentity: ExecutionTargetDraftIdentity;
  readonly missingFields: typeof MATERIAL_FIELDS;
}

export interface CompleteExecutionTargetDraft {
  readonly status: "complete";
  readonly discoveryIdentity: ExecutionTargetDraftIdentity;
  readonly target: DirectExecutionTarget;
  readonly intent: DirectExecutionTargetIntent;
  readonly evidence: DirectExecutionTargetEvidence;
}

export interface ExecutionTargetDraftDiscoveryEvidence {
  readonly evidenceIdentity: string;
  readonly evidenceRevision: `sha256:${string}`;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface ExecutionTargetDraftMaterial {
  readonly targetId: string;
  readonly label: string;
  readonly accountPolicyId: string;
  readonly dataClassification: ExecutionDataClassification;
  readonly dataPolicyEvidence: ExecutionTargetDataPolicyEvidence;
  readonly economics: ExecutionTargetEconomicsConfig;
}

export function startExecutionTargetDraft(discovery: ModelCatalogEntry): IncompleteExecutionTargetDraft {
  if (discovery.discovery !== "observed" || discovery.eligibility !== "eligible") {
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

export function completeExecutionTargetDraft(input: {
  readonly draft: IncompleteExecutionTargetDraft;
  readonly material: ExecutionTargetDraftMaterial;
  readonly discoveryEvidence: ExecutionTargetDraftDiscoveryEvidence;
  readonly catalog: ExecutionTargetCatalogInput;
}): CompleteExecutionTargetDraft {
  rejectSecretLikeKeys(input.material);
  const target: DirectExecutionTarget = {
    id: input.material.targetId,
    label: input.material.label,
    providerId: input.draft.discoveryIdentity.providerId,
    providerModelId: input.draft.discoveryIdentity.providerModelId,
    accountPolicyId: input.material.accountPolicyId,
    dataClassification: input.material.dataClassification,
    dataPolicyEvidence: input.material.dataPolicyEvidence,
    economics: input.material.economics,
  };
  const admitted = defineExecutionTargetCatalog({ ...input.catalog, targets: [...input.catalog.targets, target] });
  const admittedTarget = admitted.targets[admitted.targets.length - 1]!;
  const intent: DirectExecutionTargetIntent = {
    id: admittedTarget.id,
    kind: "direct",
    label: admittedTarget.label,
    providerId: admittedTarget.providerId,
    providerModelId: admittedTarget.providerModelId,
    accountPolicyId: admittedTarget.accountPolicyId,
    dataClassification: admittedTarget.dataClassification,
    economics: {
      authBillingChannel: admittedTarget.economics.authBillingChannel,
      executionMode: admittedTarget.economics.executionMode,
      serviceTier: admittedTarget.economics.serviceTier,
      fallbackPosture: admittedTarget.economics.fallbackPosture,
      overagePosture: admittedTarget.economics.overagePosture,
      executionEnvelope: admittedTarget.economics.executionEnvelope,
    },
  };
  const parsedEvidence = defineExecutionTargetEvidenceSnapshot({
    version: 1,
    accounts: [],
    targets: [{
      targetId: admittedTarget.id,
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
      dataPolicyEvidence: admittedTarget.dataPolicyEvidence,
      economics: {
        adapterCapabilityId: admittedTarget.economics.adapterCapabilityId,
        adapterCapabilityVersion: admittedTarget.economics.adapterCapabilityVersion,
        rateCardBasis: admittedTarget.economics.rateCardBasis,
        envelopeSemantics: admittedTarget.economics.envelopeSemantics,
        contextClass: admittedTarget.economics.contextClass,
        cacheClass: admittedTarget.economics.cacheClass,
        priceEvidence: admittedTarget.economics.priceEvidence,
        auxiliaryCharges: admittedTarget.economics.auxiliaryCharges,
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
    target: admittedTarget,
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
