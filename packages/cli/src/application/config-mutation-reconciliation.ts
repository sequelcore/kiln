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
import { readKilnYamlFile } from "../kiln-yaml.js";
import { writeRepoShimProjections } from "./repo-shim-projection.js";
import { runConfigReconciliationTarget } from "./config-reconciliation-target.js";
import {
  type ProjectStateBinding,
  type ProjectStateRootOptions,
  resolveProjectStateBinding,
} from "./project-state-root.js";

export interface ConfigMutationReconciliationOptions extends ProjectStateRootOptions {
  readonly projectStateBinding?: ProjectStateBinding;
}

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
  options: ConfigMutationReconciliationOptions = {},
): Promise<readonly ConfigMutationReconciliationOutcome[]> {
  const binding = options.projectStateBinding ?? resolveProjectStateBinding(projectPath, options);
  const effects: ConfigMutationReconciliationOutcome[] = [];
  for (const target of unique(targets)) {
    effects.push(await reconcileTarget(projectPath, target, binding));
  }
  return effects;
}

async function reconcileTarget(
  projectPath: string,
  target: KilnConfigReconciliationTarget,
  binding: ProjectStateBinding,
): Promise<ConfigMutationReconciliationOutcome> {
  try {
    const result = await runConfigReconciliationTarget(projectPath, target, () =>
      reconcileTargetOnce(projectPath, target, binding), { projectStateBinding: binding });
    if (result.status === "superseded") {
      return {
        target,
        status: "skipped",
        summary: `${target} reconciliation was superseded by a newer canonical revision.`,
        errors: [],
      };
    }
    return { ...result.value, generation: requireGeneration(result.generation) };
  } catch (error) {
    return {
      target,
      status: "failed",
      summary: `${target} reconciliation threw before completing`,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export interface ConfigMutationReconciliationOutcome extends KilnConfigReconciliationEffect {
  /** Exact generation proven while the reconciliation target fence was held. */
  readonly generation?: `sha256:${string}`;
}

function requireGeneration(value: string): `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Reconciliation target returned a malformed generation digest.");
  }
  return value as `sha256:${string}`;
}

async function reconcileTargetOnce(
  projectPath: string,
  target: KilnConfigReconciliationTarget,
  binding: ProjectStateBinding,
): Promise<KilnConfigReconciliationEffect> {
  switch (target) {
    case "native-agents":
      return await reconcileNativeAgents(projectPath, binding);
    case "native-skills":
      return await reconcileNativeSkills(projectPath, binding);
    case "repo-shims":
      return await reconcileRepoShims(projectPath);
    case "native-permissions":
      return await reconcileNativePermissions(projectPath, binding);
    case "execution-targets":
      return reconcileExecutionRoutes();
  }
}

async function reconcileNativeAgents(projectPath: string, binding: ProjectStateBinding): Promise<KilnConfigReconciliationEffect> {
  const { globalConfig } = await loadKilnConfigWithGlobalAuthority(projectPath, { projectStateBinding: binding });
  const result = await syncNativeAgentProjections(projectPath, {
    disabledHarnesses: [],
    projectStateBinding: binding,
    communicationCandidates: configuredCommunicationCandidates({
      global: globalConfig?.communication,
      project: readKilnYamlFile(binding.configPath)?.communication,
    }),
  });
  return {
    target: "native-agents",
    status: result.errors.length === 0 ? "ok" : "failed",
    summary: `${result.synced} native agent projections synced`,
    errors: result.errors,
  };
}

async function reconcileNativeSkills(projectPath: string, binding: ProjectStateBinding): Promise<KilnConfigReconciliationEffect> {
  const kilnConfig = await loadKilnConfig(projectPath, { projectStateBinding: binding });
  const result = await syncNativeSkillProjections(projectPath, {
    disabledHarnesses: [],
    projectStateBinding: binding,
    skillConfig: kilnConfig?.skills,
  });
  return {
    target: "native-skills",
    status: result.errors.length === 0 ? "ok" : "failed",
    summary: `${result.synced} native skill projections synced`,
    errors: result.errors,
  };
}

async function reconcileNativePermissions(projectPath: string, binding: ProjectStateBinding): Promise<KilnConfigReconciliationEffect> {
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
    projectStateBinding: binding,
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
      target: "execution-targets",
      status: "failed",
      summary: "Execution-target authority is unavailable after commit.",
      errors: ["Canonical target intent or its exact managed evidence revision is unavailable."],
    };
  }
  return {
    target: "execution-targets",
    status: "ok",
    summary: `${authority.executionCatalog.targets.length} execution targets verified from canonical intent and evidence.`,
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
