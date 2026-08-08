import type { KilnGlobalConfig } from "../../src/config/global-config.js";

/**
 * Canonical schema-v2 global config: a runtime-selected `codex-standard`
 * managed route covered by a matching `modelGateway.virtualModels` economic
 * route. Shared by `managed-economic-policy-config.test.ts` (schema/runtime
 * validation of this shape) and `codex-app-managed-jobs-runtime-config.test.ts`
 * (the real native-harness composition boundary), so both exercise the exact
 * same valid fixture rather than two independently drifting copies.
 */
export function economicConfig(): KilnGlobalConfig {
  return {
    version: "1",
    managedAgents: {
      schemaVersion: 2,
      routes: [{
        id: "codex-standard",
        kind: "direct",
        provider: "codex-oauth",
        model: "gpt-5.6-codex",
        credentials: {
          mode: "runtime-selected",
          routeId: "codex-standard",
          accountPolicyId: "codex-standard-policy",
        },
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
    modelGateway: {
      port: 4819,
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
      replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
      surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
      principals: [{
        tokenEnv: "KILN_RESPONSES_TOKEN",
        ingress: "openai-responses",
        tenantId: "tenant",
        applicationId: "managed-agent",
        callerId: "caller",
        capabilityId: "model-invoke",
        scopes: ["model.invoke"],
        budgetEvidenceId: "budget",
        virtualModelIds: ["codex-standard-policy"],
      }],
      virtualModels: [{
        id: "codex-standard-policy",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-codex",
        accountIds: ["codex-account"],
        capabilities: ["text"],
        affinity: { continuity: "none" },
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
