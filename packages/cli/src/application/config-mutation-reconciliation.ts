import { join } from "node:path";
import type {
  KilnConfigReconciliationEffect,
  KilnConfigReconciliationTarget,
} from "@kilnai/gateway-contracts";
import { globalToKilnYaml, loadKilnConfig, loadKilnConfigWithGlobalAuthority } from "../config/config-merger.js";
import { configuredCommunicationCandidates } from "../config/communication-policy.js";
import { readGlobalConfig, readGlobalExecutionTargetAuthority } from "../config/global-config.js";
import { syncNativeAgentProjections } from "../config/native-agent-projection.js";
import { syncNativePermissionProjections } from "../config/native-permission-projection.js";
import { syncNativeSkillProjections } from "../config/native-skill-projection.js";
import { readKilnYaml } from "../kiln-yaml.js";
import { writeRepoShimProjections } from "./repo-shim-projection.js";
import { runConfigReconciliationTarget } from "./config-reconciliation-target.js";

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
    const result = await runConfigReconciliationTarget(projectPath, target, () =>
      reconcileTargetOnce(projectPath, target));
    if (result.status === "superseded") {
      return {
        target,
        status: "skipped",
        summary: `${target} reconciliation was superseded by a newer canonical revision.`,
        errors: [],
      };
    }
    return result.value;
  } catch (error) {
    return {
      target,
      status: "failed",
      summary: `${target} reconciliation threw before completing`,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function reconcileTargetOnce(
  projectPath: string,
  target: KilnConfigReconciliationTarget,
): Promise<KilnConfigReconciliationEffect> {
  switch (target) {
    case "native-agents":
      return await reconcileNativeAgents(projectPath);
    case "native-skills":
      return await reconcileNativeSkills(projectPath);
    case "repo-shims":
      return await reconcileRepoShims(projectPath);
    case "native-permissions":
      return await reconcileNativePermissions(projectPath);
    case "execution-routes":
      return reconcileExecutionRoutes();
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

async function reconcileNativePermissions(projectPath: string): Promise<KilnConfigReconciliationEffect> {
  const globalConfig = readGlobalConfig();
  if (!globalConfig) {
    return {
      target: "native-permissions",
      status: "failed",
      summary: "Native permission projection has no canonical global configuration.",
      errors: ["Canonical global configuration is unavailable after commit."],
    };
  }
  const result = await syncNativePermissionProjections(globalToKilnYaml(globalConfig), projectPath, {
    force: true,
    modelGateway: globalConfig.modelGateway,
  });
  return {
    target: "native-permissions",
    status: result.errors.length === 0 ? "ok" : "failed",
    summary: result.errors.length === 0
      ? "Native permission projections for the current project converged."
      : "Native permission projections for the current project did not fully converge.",
    errors: result.errors,
  };
}

function reconcileExecutionRoutes(): KilnConfigReconciliationEffect {
  const authority = readGlobalExecutionTargetAuthority(readGlobalConfig());
  if (!authority) {
    return {
      target: "execution-routes",
      status: "failed",
      summary: "Execution-route authority is unavailable after commit.",
      errors: ["Canonical target intent or its exact managed evidence revision is unavailable."],
    };
  }
  return {
    target: "execution-routes",
    status: "ok",
    summary: `${authority.executionCatalog.routes.length} execution routes verified from canonical intent and evidence.`,
    errors: [],
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
