import type { KilnGlobalConfig } from "../../src/config/global-config.js";

/**
 * Canonical V3 global config: a runtime-selected `codex-standard` target
 * covered by a matching economic policy. Shared by
 * `managed-economic-policy-config.test.ts` (schema/runtime
 * validation of this shape) and `operator-project-agent-tasks-runtime-config.test.ts`
 * (the real native-harness composition boundary), so both exercise the exact
 * same valid fixture rather than two independently drifting copies.
 */
export function economicConfig(): KilnGlobalConfig {
  return {
    version: "3",
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
      accounts: [{
        id: "codex-account",
        providerId: "codex-oauth",
        credentialId: "codex-credential",
        maxConcurrency: 1,
        reservedAffinitySlots: 0,
        economics: {
          capacityIdentity: "codex-capacity",
          subscriptionClass: "metered",
          quotaClassId: "codex-standard",
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
          sourceDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          observedAt: "2026-08-01T00:00:00.000Z",
          expiresAt: "2027-08-31T00:00:00.000Z",
        },
        accountSelection: { mode: "automatic", accountPolicyId: "codex-standard-policy" },
        economics: {
          adapterCapabilityId: "codex-direct",
          adapterCapabilityVersion: "v1",
          authBillingChannel: "oauth-subscription",
          executionMode: "responses-api",
          serviceTier: "standard",
          rateCardBasis: "public-rate-card",
          envelopeSemantics: "configured-upper-bound",
          fallbackPosture: "disabled",
          overagePosture: "disabled",
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
              sourceDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              observedAt: "2026-07-29T00:00:00.000Z",
              validUntil: "2026-08-29T00:00:00.000Z",
              confidence: "high",
              authority: "provider-reported",
            },
          },
          auxiliaryCharges: [],
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
