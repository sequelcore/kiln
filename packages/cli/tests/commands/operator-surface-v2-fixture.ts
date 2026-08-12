import type { KilnGlobalConfig } from "../../src/config/global-config.js";
import { economicConfig } from "../config/managed-economic-policy-config-fixture.js";

/**
 * Small schema-v2 operator fixture. Surface tests must select a configured
 * execution route; provider/model flags are deliberately not part of this
 * fixture because they are not an operator authority.
 */
export function makeOperatorSurfaceGlobalConfig(
  providerId = "codex-oauth",
  providerModelId = "gpt-5.6-codex",
  routeId = "operator-default",
): KilnGlobalConfig {
  const base = economicConfig();
  const accountId = `${routeId}-account`;
  const policyId = `${routeId}-policy`;
  const account = base.executionCatalog!.accounts[0]!;
  const route = base.executionCatalog!.routes[0]!;
  return {
    version: "2",
    executionCatalog: {
      accounts: [{
        ...account,
        id: accountId,
        providerId,
        credentialId: `${routeId}-credential`,
      }],
      accountPolicies: [{
        id: policyId,
        accountIds: [accountId],
        strategy: "economic-least-pressure",
      }],
      routes: [{
        ...route,
        id: routeId,
        label: `Operator ${providerId}`,
        providerId,
        providerModelId,
        accountSelection: { mode: "automatic", accountPolicyId: policyId },
      }],
    },
    executionRouting: { defaultRouteId: routeId },
    ui: { executionRouteSelection: { routeId } },
  };
}
