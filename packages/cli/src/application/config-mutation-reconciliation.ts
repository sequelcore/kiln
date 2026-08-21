import { join } from "node:path";
import type {
  KilnConfigReconciliationEffect,
  KilnConfigReconciliationTarget,
} from "@kilnai/gateway-contracts";
import { loadKilnConfig, loadKilnConfigWithGlobalAuthority } from "../config/config-merger.js";
import { configuredCommunicationCandidates } from "../config/communication-policy.js";
import { syncNativeAgentProjections } from "../config/native-agent-projection.js";
import { syncNativeSkillProjections } from "../config/native-skill-projection.js";
import { readKilnYaml } from "../kiln-yaml.js";
import { writeRepoShimProjections } from "./repo-shim-projection.js";

/**
 * The single reconciliation owner for committed configuration mutations.
 *
 * It converges exactly the targets a proposal declared. Reconciliation runs
 * after the canonical write has committed, so a failure here is reported as a
 * committed change with failed reconciliation, never as a rejected mutation.
 */
export async function reconcileConfigMutation(
  projectPath: string,
  targets: readonly KilnConfigReconciliationTarget[],
): Promise<readonly KilnConfigReconciliationEffect[]> {
  const effects: KilnConfigReconciliationEffect[] = [];
  for (const target of unique(targets)) {
    effects.push(await reconcileTarget(projectPath, target));
  }
  return effects;
}

async function reconcileTarget(
  projectPath: string,
  target: KilnConfigReconciliationTarget,
): Promise<KilnConfigReconciliationEffect> {
  try {
    switch (target) {
      case "native-agents":
        return await reconcileNativeAgents(projectPath);
      case "native-skills":
        return await reconcileNativeSkills(projectPath);
      case "repo-shims":
        return await reconcileRepoShims(projectPath);
      case "execution-routes":
        // Route material is reconciled by its own owner during target operations.
        return {
          target,
          status: "skipped",
          summary: "Execution routes are reconciled by the execution-route owner.",
          errors: [],
        };
    }
  } catch (error) {
    return {
      target,
      status: "failed",
      summary: `${target} reconciliation threw before completing`,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function reconcileNativeAgents(projectPath: string): Promise<KilnConfigReconciliationEffect> {
  const { globalConfig } = await loadKilnConfigWithGlobalAuthority(projectPath);
  const result = await syncNativeAgentProjections(projectPath, {
    disabledHarnesses: [],
    communicationCandidates: configuredCommunicationCandidates({
      global: globalConfig?.communication,
      project: readKilnYaml(join(projectPath, ".kiln"))?.communication,
    }),
  });
  return {
    target: "native-agents",
    status: result.errors.length === 0 ? "ok" : "failed",
    summary: `${result.synced} native agent projections synced`,
    errors: result.errors,
  };
}

async function reconcileNativeSkills(projectPath: string): Promise<KilnConfigReconciliationEffect> {
  const kilnConfig = await loadKilnConfig(projectPath);
  const result = await syncNativeSkillProjections(projectPath, {
    disabledHarnesses: [],
    skillConfig: kilnConfig?.skills,
  });
  return {
    target: "native-skills",
    status: result.errors.length === 0 ? "ok" : "failed",
    summary: `${result.synced} native skill projections synced`,
    errors: result.errors,
  };
}

async function reconcileRepoShims(projectPath: string): Promise<KilnConfigReconciliationEffect> {
  const result = await writeRepoShimProjections(projectPath);
  return {
    target: "repo-shims",
    status: result.errors.length === 0 ? "ok" : "failed",
    summary: `${result.targets.filter((entry) => entry.status === "written").length} repo shim projections written`,
    errors: result.errors,
  };
}

function unique(
  targets: readonly KilnConfigReconciliationTarget[],
): readonly KilnConfigReconciliationTarget[] {
  return [...new Set(targets)];
}
