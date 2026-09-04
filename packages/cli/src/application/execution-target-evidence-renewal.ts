import { createHash } from "node:crypto";
import type { ExecutionTargetWizardDiscoveryEvidence } from "./execution-target-wizard-admission.js";
import {
  assertExecutionTargetEvidenceRenewal,
  defineExecutionTargetEvidenceSnapshot,
  type ExecutionTargetCatalogIntent,
  type ExecutionTargetEvidenceSnapshot,
} from "../config/execution-target-evidence-store.js";

export interface ExecutionTargetEvidenceRenewalInput {
  readonly intent: ExecutionTargetCatalogIntent;
  readonly currentEvidence: ExecutionTargetEvidenceSnapshot;
  readonly configurationRevision: string;
  readonly discoveryByTargetId: ReadonlyMap<string, ExecutionTargetWizardDiscoveryEvidence>;
}

/**
 * Renews freshness provenance for the exact configured target set. Semantic
 * policy/economic material is carried forward byte-for-byte and checked by the
 * evidence owner before the replacement snapshot can be published.
 */
export function renewExecutionTargetEvidence(
  input: ExecutionTargetEvidenceRenewalInput,
): ExecutionTargetEvidenceSnapshot {
  const currentById = new Map(input.currentEvidence.targets.map((target) => [target.targetId, target]));
  const targets = input.intent.targets.map((target) => {
    const current = currentById.get(target.id);
    if (!current) throw new Error(`Configured target '${target.id}' has no current managed evidence.`);
    const discovered = input.discoveryByTargetId.get(target.id);
    if (!discovered) throw new Error(`Configured target '${target.id}' has no fresh discovery evidence.`);
    if (discovered.entry.providerId !== target.providerId
      || discovered.entry.providerModelId !== target.providerModelId) {
      throw new Error(`Fresh discovery identity differs for configured target '${target.id}'.`);
    }
    const source = renewalSource({
      targetId: target.id,
      configurationRevision: input.configurationRevision,
      discovery: discovered,
    });
    const common = {
      targetId: current.targetId,
      kind: current.kind,
      discovery: {
        providerId: discovered.entry.providerId,
        providerRouteId: discovered.entry.providerRouteId,
        providerModelId: discovered.entry.providerModelId,
        evidenceIdentity: discovered.evidenceIdentity,
        evidenceRevision: discovered.evidenceRevision,
        observedAt: discovered.sourceObservedAt,
        expiresAt: discovered.expiresAt,
      },
      dataPolicyEvidence: {
        ...current.dataPolicyEvidence,
        ...source,
        expiresAt: discovered.expiresAt,
      },
    } as const;
    if (current.kind === "harness") {
      return {
        ...common,
        kind: "harness" as const,
        ...(current.limitations ? { limitations: current.limitations } : {}),
      };
    }
    return {
      ...common,
      kind: "direct" as const,
      economics: {
        ...current.economics,
        priceEvidence: {
          ...current.economics.priceEvidence,
          evidence: {
            ...current.economics.priceEvidence.evidence,
            ...source,
            validUntil: discovered.expiresAt,
          },
        },
      },
    };
  });
  const renewed = defineExecutionTargetEvidenceSnapshot({
    version: input.currentEvidence.version,
    accounts: input.currentEvidence.accounts,
    targets,
  });
  assertExecutionTargetEvidenceRenewal(input.currentEvidence, renewed);
  return renewed;
}

function renewalSource(input: {
  readonly targetId: string;
  readonly configurationRevision: string;
  readonly discovery: ExecutionTargetWizardDiscoveryEvidence;
}): {
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly sourceDigest: `sha256:${string}`;
  readonly observedAt: string;
} {
  const sourceDigest = `sha256:${createHash("sha256").update(JSON.stringify({
    targetId: input.targetId,
    configurationRevision: input.configurationRevision,
    discoveryIdentity: {
      providerId: input.discovery.entry.providerId,
      providerRouteId: input.discovery.entry.providerRouteId,
      providerModelId: input.discovery.entry.providerModelId,
    },
    evidenceIdentity: input.discovery.evidenceIdentity,
    evidenceRevision: input.discovery.evidenceRevision,
    materialRevision: input.discovery.materialRevision,
    observedAt: input.discovery.catalogObservedAt,
    expiresAt: input.discovery.expiresAt,
  })).digest("hex")}` as const;
  return {
    sourceIdentity: `target-renewal-${sourceDigest.slice(7, 23)}`,
    sourceRevision: `config-${input.configurationRevision.replace(/^sha256:/u, "").slice(0, 16)}`,
    sourceDigest,
    observedAt: input.discovery.catalogObservedAt,
  };
}
