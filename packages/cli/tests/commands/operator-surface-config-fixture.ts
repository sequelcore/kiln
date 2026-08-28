import type { ExecutionTargetCatalog } from "@kilnai/core";
import type { KilnGlobalConfig } from "../../src/config/global-config.js";
import {
  executionTargetEvidenceRevision,
  projectExecutionTargetCatalogFromIntent,
  type ExecutionTargetEvidenceSnapshot,
} from "../../src/config/execution-target-evidence-store.js";
import {
  managedAgentIntentConfig,
  managedAgentTargetEvidence,
} from "../config/managed-agent-intent-config-fixture.js";

/** An operator fixture with separate target intent and managed evidence. */
export function makeOperatorSurfaceGlobalConfig(
  providerId = "codex-oauth",
  providerModelId = "gpt-5.6-codex",
  targetId = "operator-default",
): KilnGlobalConfig {
  const base = managedAgentIntentConfig();
  const accountId = `${targetId}-account`;
  const policyId = `${targetId}-policy`;
  const account = base.targetCatalog!.accounts[0]!;
  const target = base.targetCatalog!.targets[0]!;
  if (target.kind !== "direct") throw new Error("Operator surface fixture expects a direct target.");
  const evidence = makeOperatorSurfaceTargetEvidence(providerId, providerModelId, targetId);
  return {
    ...base,
    version: "6",
    managedAgents: {
      ...base.managedAgents,
      intents: base.managedAgents?.intents?.map((intent) => ({
        ...intent,
        target: { mode: "explicit" as const, targetId },
        model: { mode: "explicit" as const, modelId: providerModelId },
      })),
    },
    targetCatalog: {
      evidenceRevision: executionTargetEvidenceRevision(evidence),
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
        accountPolicyId: policyId,
      }],
    },
    targetRouting: { defaultTargetId: targetId },
    ui: { targetSelection: { targetId } },
  };
}

export function makeOperatorSurfaceTargetEvidence(
  providerId = "codex-oauth",
  providerModelId = "gpt-5.6-codex",
  targetId = "operator-default",
): ExecutionTargetEvidenceSnapshot {
  const base = managedAgentTargetEvidence();
  const account = base.accounts[0]!;
  const target = base.targets[0]!;
  if (target.kind !== "direct") throw new Error("Operator surface fixture expects direct target evidence.");
  return {
    version: 1,
    accounts: [{
      ...account,
      accountId: `${targetId}-account`,
      providerId,
    }],
    targets: [{
      ...target,
      targetId,
      discovery: {
        ...target.discovery,
        providerId,
        providerRouteId: providerModelId,
        providerModelId,
      },
      dataPolicyEvidence: {
        ...target.dataPolicyEvidence,
        providerId,
        providerModelId,
      },
    }],
  };
}

export function makeOperatorSurfaceExecutionTargetCatalog(
  providerId = "codex-oauth",
  providerModelId = "gpt-5.6-codex",
  targetId = "operator-default",
): ExecutionTargetCatalog {
  const config = makeOperatorSurfaceGlobalConfig(providerId, providerModelId, targetId);
  return projectExecutionTargetCatalogFromIntent(
    config.targetCatalog!,
    makeOperatorSurfaceTargetEvidence(providerId, providerModelId, targetId),
    config.targetCatalog!.evidenceRevision,
    { now: new Date("2026-08-20T00:00:00.000Z") },
  );
}
