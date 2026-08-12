import type { KilnGlobalConfig } from "../../src/config/global-config.js";

/**
 * Canonical schema-v2 global config: a runtime-selected `codex-standard`
 * managed route covered by a matching `executionCatalog.routes` economic
 * route. Shared by `managed-economic-policy-config.test.ts` (schema/runtime
 * validation of this shape) and `operator-project-managed-jobs-runtime-config.test.ts`
 * (the real native-harness composition boundary), so both exercise the exact
 * same valid fixture rather than two independently drifting copies.
 */
export function economicConfig(): KilnGlobalConfig {
  return {
    version: "2",
    managedAgents: {
      schemaVersion: 2,
      routes: [{
        id: "codex-standard",
        kind: "direct",
        executionRouteId: "codex-standard",
      }],
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
          routeId: "codex-standard",
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
    executionCatalog: {
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
      routes: [{
        id: "codex-standard",
        label: "Codex Standard",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-codex",
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
  };
}
