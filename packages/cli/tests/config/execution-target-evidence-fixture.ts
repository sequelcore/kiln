import type { ExecutionTargetCatalog } from "@kilnai/core";
import type { KilnGlobalConfig } from "../../src/config/global-config.js";
import {
  executionTargetEvidenceRevision,
  projectExecutionTargetCatalogFromIntent,
  type ExecutionTargetCatalogIntent,
  type ExecutionTargetEvidenceSnapshot,
} from "../../src/config/execution-target-evidence-store.js";

const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
const FAR_FUTURE = "2099-12-31T00:00:00.000Z";

export function syntheticExecutionTargetEvidence(
  intent: ExecutionTargetCatalogIntent,
): ExecutionTargetEvidenceSnapshot {
  return {
    version: 1,
    accounts: intent.accounts.map((account) => ({
      accountId: account.id,
      providerId: account.providerId,
      economics: {
        capacityIdentity: account.id,
        subscriptionClass: "subscription",
        quotaClassId: `${account.id}-quota`,
      },
    })),
    targets: intent.targets.map((target) => {
      const dataPolicyEvidence = {
        providerId: target.providerId,
        providerModelId: target.providerModelId,
        dataUse: "not-used" as const,
        trainingPosture: "prohibited" as const,
        retention: { posture: "zero" as const, days: 0 },
        permittedMaximumClassification: target.dataClassification,
        permittedClassifications: CLASSIFICATIONS.slice(
          0,
          CLASSIFICATIONS.indexOf(target.dataClassification) + 1,
        ),
        sourceIdentity: "synthetic-test-policy",
        sourceRevision: "1",
        sourceDigest: `sha256:${"b".repeat(64)}` as const,
        observedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: FAR_FUTURE,
      };
      const discovery = {
        providerId: target.providerId,
        providerRouteId: target.providerModelId,
        providerModelId: target.providerModelId,
        evidenceIdentity: "synthetic-test-discovery",
        evidenceRevision: `sha256:${"c".repeat(64)}` as const,
        observedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: FAR_FUTURE,
      };
      if (target.kind === "harness") {
        return {
          targetId: target.id,
          kind: "harness" as const,
          discovery,
          dataPolicyEvidence,
          limitations: [],
        };
      }
      return {
        targetId: target.id,
        kind: "direct" as const,
        discovery,
        dataPolicyEvidence,
        economics: {
          adapterCapabilityId: target.providerId,
          adapterCapabilityVersion: "1",
          rateCardBasis: "public-rate-card",
          envelopeSemantics: "configured-upper-bound",
          contextClass: "standard-context",
          cacheClass: "provider-cache",
          priceEvidence: {
            kind: "metered" as const,
            rateCardId: `${target.id}-rate-card`,
            rateCardRevision: "1",
            unitPrices: [{
              usageUnit: "input-token",
              price: {
                atoms: "125",
                scale: 6,
                unit: "input-token",
                scheme: { kind: "currency" as const, currency: "USD" },
              },
            }],
            evidence: {
              sourceIdentity: "synthetic-test-price",
              sourceRevision: "1",
              sourceDigest: `sha256:${"a".repeat(64)}` as const,
              observedAt: "2026-01-01T00:00:00.000Z",
              validUntil: FAR_FUTURE,
              confidence: "high" as const,
              authority: "configured" as const,
            },
          },
          auxiliaryCharges: [],
        },
      };
    }),
  };
}

export function withSyntheticExecutionTargetEvidence(config: KilnGlobalConfig): {
  readonly config: KilnGlobalConfig;
  readonly evidence?: ExecutionTargetEvidenceSnapshot;
} {
  if (!config.targetCatalog) return { config };
  const evidence = syntheticExecutionTargetEvidence(config.targetCatalog);
  return {
    config: {
      ...config,
      targetCatalog: {
        ...config.targetCatalog,
        evidenceRevision: executionTargetEvidenceRevision(evidence),
      },
    },
    evidence,
  };
}

export function syntheticExecutionTargetCatalog(config: KilnGlobalConfig): ExecutionTargetCatalog | null {
  const admitted = withSyntheticExecutionTargetEvidence(config);
  if (!admitted.config.targetCatalog || !admitted.evidence) return null;
  return projectExecutionTargetCatalogFromIntent(
    admitted.config.targetCatalog,
    admitted.evidence,
    admitted.config.targetCatalog.evidenceRevision,
    { now: new Date("2026-08-20T00:00:00.000Z") },
  );
}

export function syntheticExecutionTargetAuthority(config: KilnGlobalConfig) {
  const admitted = withSyntheticExecutionTargetEvidence(config);
  const executionCatalog = syntheticExecutionTargetCatalog(config);
  if (!admitted.evidence || !executionCatalog) return undefined;
  return { evidence: admitted.evidence, executionCatalog };
}
