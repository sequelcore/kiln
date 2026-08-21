import type { KilnGlobalConfig } from "../../src/config/global-config.js";
import {
  executionTargetEvidenceRevision,
  projectExecutionCatalogFromIntent,
  type ExecutionTargetEvidenceSnapshot,
} from "../../src/config/execution-target-evidence-store.js";

/**
 * Canonical V4 global config: a runtime-selected `codex-standard` target
 * covered by a matching economic policy. Shared by
 * `managed-economic-policy-config.test.ts` (schema/runtime
 * validation of this shape) and `operator-project-agent-tasks-runtime-config.test.ts`
 * (the real native-harness composition boundary), so both exercise the exact
 * same valid fixture rather than two independently drifting copies.
 */
export function economicConfig(): KilnGlobalConfig {
  const evidence = economicTargetEvidence();
  return {
    version: "4",
    workGovernance: {
      defaultPosture: "direct",
      requireDelegationFor: ["managed-agents"],
      requiredEvidence: [],
    },
    managedAgents: {
      defaultAuthorityProfileId: "readonly-plan",
      economicPolicies: [{
        id: "default-economic-policy",
        revision: "rev-2026-07",
        evidenceRequirements: {
          quota: "required-for-account-bound",
          price: "required",
        },
        noRouteAction: "deny",
        comparisonDomains: [{
          id: "usd-worst-case",
          rank: 0,
          unit: "request",
          scheme: { kind: "currency", currency: "USD" },
          rateCardBasis: "public-rate-card",
          envelopeSemantics: "configured-upper-bound",
        }],
        candidates: [{
          targetId: "codex-standard",
          comparisonDomainId: "usd-worst-case",
          priorityRank: 0,
          ceiling: {
            kind: "finite",
            amount: {
              atoms: "25",
              scale: 0,
              unit: "request",
              scheme: { kind: "currency", currency: "USD" },
            },
          },
          worstCaseReservation: {
            kind: "exact",
            amount: {
              atoms: "25",
              scale: 0,
              unit: "request",
              scheme: { kind: "currency", currency: "USD" },
            },
          },
        }],
      }],
    },
    authorityProfiles: [{
      id: "readonly-plan",
      admissionProfile: "foundation-readonly-plan",
      workingDirectory: "project",
      tools: { allowed: ["read"], network: false, writes: false },
      memory: { access: "read-only" },
    }],
    targetCatalog: {
      evidenceRevision: executionTargetEvidenceRevision(evidence),
      accounts: [{
        id: "codex-account",
        providerId: "codex-oauth",
        credentialId: "codex-credential",
        maxConcurrency: 1,
        reservedAffinitySlots: 0,
        economics: {
          creditPosture: "disabled",
          overagePosture: "disabled",
        },
      }],
      accountPolicies: [{
        id: "codex-standard-policy",
        accountIds: ["codex-account"],
        strategy: "economic-least-pressure",
      }],
      targets: [{
        id: "codex-standard",
        kind: "direct",
        label: "Codex Standard",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-codex",
        dataClassification: "internal",
        accountSelection: { mode: "automatic", accountPolicyId: "codex-standard-policy" },
        economics: {
          authBillingChannel: "oauth-subscription",
          executionMode: "responses-api",
          serviceTier: "standard",
          fallbackPosture: "disabled",
          overagePosture: "disabled",
          executionEnvelope: {
            limits: [{
              atoms: "200000",
              scale: 0,
              unit: "input-token",
              scheme: { kind: "unit" },
            }],
          },
        },
      }],
    },
    targetRouting: { defaultTargetId: "codex-standard" },
  };
}

export function economicTargetEvidence(): ExecutionTargetEvidenceSnapshot {
  return {
    version: 1,
    accounts: [{
      accountId: "codex-account",
      providerId: "codex-oauth",
      economics: {
        capacityIdentity: "codex-capacity",
        subscriptionClass: "metered",
        quotaClassId: "codex-standard",
      },
    }],
    targets: [{
      targetId: "codex-standard",
      kind: "direct",
      discovery: {
        providerId: "codex-oauth",
        providerRouteId: "gpt-5.6-codex",
        providerModelId: "gpt-5.6-codex",
        evidenceIdentity: "fixture-model-catalog",
        evidenceRevision: `sha256:${"c".repeat(64)}`,
        observedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2099-08-31T00:00:00.000Z",
      },
      dataPolicyEvidence: {
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-codex",
        dataUse: "not-used",
        trainingPosture: "prohibited",
        retention: { posture: "zero", days: 0 },
        permittedMaximumClassification: "internal",
        permittedClassifications: ["public", "internal"],
        sourceIdentity: "fixture-privacy-policy",
        sourceRevision: "rev-2026-08",
        sourceDigest: `sha256:${"b".repeat(64)}`,
        observedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2099-08-31T00:00:00.000Z",
      },
      economics: {
        adapterCapabilityId: "codex-direct",
        adapterCapabilityVersion: "v1",
        rateCardBasis: "public-rate-card",
        envelopeSemantics: "configured-upper-bound",
        contextClass: "standard-context",
        cacheClass: "provider-cache",
        priceEvidence: {
          kind: "metered",
          rateCardId: "codex-public",
          rateCardRevision: "rev-2026-07",
          unitPrices: [{
            usageUnit: "input-token",
            price: {
              atoms: "125",
              scale: 6,
              unit: "input-token",
              scheme: { kind: "currency", currency: "USD" },
            },
          }],
          evidence: {
            sourceIdentity: "openai-pricing",
            sourceRevision: "rev-2026-07",
            sourceDigest: `sha256:${"a".repeat(64)}`,
            observedAt: "2026-07-29T00:00:00.000Z",
            validUntil: "2099-08-29T00:00:00.000Z",
            confidence: "high",
            authority: "provider-reported",
          },
        },
        auxiliaryCharges: [],
      },
    }],
  };
}

export function economicExecutionCatalog() {
  const config = economicConfig();
  return projectExecutionCatalogFromIntent(
    config.targetCatalog!,
    economicTargetEvidence(),
    config.targetCatalog!.evidenceRevision,
    { now: new Date("2026-08-20T00:00:00.000Z") },
  );
}
