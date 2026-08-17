import type { KilnGlobalConfig } from "../../src/config/global-config.js";
import { economicConfig } from "../config/managed-economic-policy-config-fixture.js";

/**
 * Small V3 operator fixture. Surface tests must select a configured target;
 * provider/model flags are deliberately not part of this
 * fixture because they are not an operator authority.
 */
export function makeOperatorSurfaceGlobalConfig(
  providerId = "codex-oauth",
  providerModelId = "gpt-5.6-codex",
  targetId = "operator-default",
): KilnGlobalConfig {
  const base = economicConfig();
  const accountId = `${targetId}-account`;
  const policyId = `${targetId}-policy`;
  const account = base.targetCatalog!.accounts[0]!;
  const target = base.targetCatalog!.targets[0]!;
  if (target.kind !== "direct") throw new Error("Operator surface fixture expects a direct target.");
  return {
    ...base,
    version: "3",
    managedAgents: {
      ...base.managedAgents,
      economicPolicies: base.managedAgents?.economicPolicies?.map((economicPolicy) => ({
        ...economicPolicy,
        candidates: economicPolicy.candidates.map((candidate) => ({ ...candidate, targetId })),
      })),
    },
    targetCatalog: {
      accounts: [{
        ...account,
        id: accountId,
        providerId,
        credentialId: `${targetId}-credential`,
      }],
      accountPolicies: [{
        id: policyId,
        accountIds: [accountId],
        strategy: "economic-least-pressure",
      }],
      targets: [{
        ...target,
        id: targetId,
        label: `Operator ${providerId}`,
        providerId,
        providerModelId,
        dataPolicyEvidence: {
          ...target.dataPolicyEvidence,
          providerId,
          providerModelId,
        },
        accountSelection: { mode: "automatic", accountPolicyId: policyId },
      }],
    },
    targetRouting: { defaultTargetId: targetId },
    ui: { targetSelection: { targetId } },
  };
}
