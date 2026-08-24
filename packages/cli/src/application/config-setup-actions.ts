import type {
  KilnConfigSetupAction,
  KilnConfigSetupActionResult,
} from "@kilnai/gateway-contracts";
import { loadKilnConfig, loadKilnConfigWithGlobalAuthority, loadResolvedKilnMcpConfiguration } from "../config/config-merger.js";
import { syncNativeAgentProjections } from "../config/native-agent-projection.js";
import { syncNativeHookProjections } from "../config/native-hook-projection.js";
import { syncNativePermissionProjections } from "../config/native-permission-projection.js";
import { syncNativeSkillProjections } from "../config/native-skill-projection.js";
import { syncNativeMcpProjections } from "../config/native-mcp-projection-sync.js";
import { adoptNativeHarnessSkills } from "../config/native-skill-adoption.js";
import { writeProjectContextAdoption } from "./project-context.js";
import { resolveProjectRoot } from "./project-root-resolver.js";
import { writeRepoShimProjections } from "./repo-shim-projection.js";
import { syncGlobalInstructionShimProjections } from "./global-instruction-shim-projection.js";
import { readConfigStatusSnapshot } from "./config-status.js";
import { syncGlobalControlPlaneMcpProjections } from "../config/global-control-plane-mcp-projection.js";
import { readKilnYamlFile } from "../kiln-yaml.js";
import { configuredCommunicationCandidates } from "../config/communication-policy.js";
import { resolveConfiguredCommunication } from "../config/communication-policy.js";
import { syncGlobalCommunicationProjection } from "../config/global-communication-projection.js";
import { runConfigReconciliationTarget } from "./config-reconciliation-target.js";
import {
  type ProjectStateBinding,
  resolveProjectStateBinding,
} from "./project-state-root.js";

export interface ExecuteConfigSetupActionInput {
  readonly projectPath: string;
  readonly action: KilnConfigSetupAction;
  readonly userHome?: string;
  readonly kilnHome?: string;
  readonly projectStateBinding?: ProjectStateBinding;
}

export async function executeConfigSetupAction(
  input: ExecuteConfigSetupActionInput,
): Promise<KilnConfigSetupActionResult> {
  const root = resolveProjectRoot({ explicitPath: input.projectPath });
  const projectPath = root.rootPath;
  const binding = input.projectStateBinding ?? resolveProjectStateBinding(projectPath, input);

  try {
    switch (input.action) {
      case "none":
        return await result(input.action, "noop", "No setup action is required.", [], projectPath);
      case "adopt-project-context":
        return await adoptProjectContext(projectPath, input.action, binding);
      case "sync-repo-shims":
        return await syncRepoShims(projectPath, input.action, binding);
      case "sync-native-projections":
        return await syncNativeProjections(projectPath, input.action, input.userHome, binding);
      case "sync-global-instruction-shims":
        return await syncGlobalInstructionShims(projectPath, input.action, input.userHome, binding);
      case "review-project-context":
        return await result(input.action, "blocked", "Review the project context before replacing it.", [], projectPath);
      case "review-and-force-sync-repo-shims":
        return await result(input.action, "blocked", "Review repo-shim drift before running a force sync.", [], projectPath);
      case "adopt-or-back-up-native-guidance":
        return await adoptNativeGuidance(projectPath, input.action, input.userHome, binding);
      case "adopt-or-back-up-global-instructions":
        return await adoptGlobalInstructions(projectPath, input.action, input.userHome, binding);
      case "review-native-projection-drift":
        return await result(input.action, "blocked", "Review native projection drift before overwriting managed fields.", [], projectPath);
      case "review-global-instruction-drift":
        return await result(input.action, "blocked", "Review global instruction shim drift before overwriting managed files.", [], projectPath);
    }
  } catch (error) {
    return result(input.action, "failed", errorMessage(error), [errorMessage(error)], projectPath);
  }
}

async function adoptProjectContext(
  projectPath: string,
  action: KilnConfigSetupAction,
  binding: ProjectStateBinding,
): Promise<KilnConfigSetupActionResult> {
  const adoption = writeProjectContextAdoption(projectPath, { projectStateBinding: binding });
  if (adoption.errors.length > 0) {
    return result(action, "blocked", adoption.errors[0] ?? "Project context adoption was blocked.", adoption.errors, projectPath);
  }
  return result(
    action,
    adoption.written ? "applied" : "noop",
    adoption.written ? "Project context adopted." : "Project context is already current.",
    [],
    projectPath,
  );
}

async function syncRepoShims(
  projectPath: string,
  action: KilnConfigSetupAction,
  _binding: ProjectStateBinding,
): Promise<KilnConfigSetupActionResult> {
  const sync = await requireCurrentProjection(projectPath, "repo-shims", () => writeRepoShimProjections(projectPath));
  if (sync.errors.length > 0) {
    return result(action, "failed", "Repo-shim sync failed.", sync.errors, projectPath);
  }
  return result(
    action,
    sync.written ? "applied" : "noop",
    sync.written ? "Repo shims synced." : "Repo shims are already current.",
    [],
    projectPath,
  );
}

async function syncGlobalInstructionShims(
  projectPath: string,
  action: KilnConfigSetupAction,
  userHome?: string,
  binding?: ProjectStateBinding,
): Promise<KilnConfigSetupActionResult> {
  const sync = await syncGlobalInstructionShimProjections(projectPath, {
    userHome,
    projectStateBinding: binding,
    disabledHarnesses: [],
  });
  if (sync.errors.length > 0) {
    return result(action, "failed", "Global instruction shim sync failed.", sync.errors, projectPath, userHome);
  }
  return result(
    action,
    sync.synced > 0 ? "applied" : "noop",
    sync.synced > 0 ? "Global instruction shims synced." : "Global instruction shims are already current.",
    [],
    projectPath,
    userHome,
  );
}

async function syncNativeProjections(
  projectPath: string,
  action: KilnConfigSetupAction,
  userHome?: string,
  binding?: ProjectStateBinding,
): Promise<KilnConfigSetupActionResult> {
  const state = binding ?? resolveProjectStateBinding(projectPath);
  const { kilnYaml, globalConfig } = await loadKilnConfigWithGlobalAuthority(projectPath, { projectStateBinding: state });
  if (!kilnYaml) {
    return result(action, "failed", "No private project configuration found.", ["No project configuration found."], projectPath, userHome);
  }

  const disabledHarnesses = [] as const;
  const permissionResult = await requireCurrentProjection(projectPath, "native-permissions", () => syncNativePermissionProjections(kilnYaml, projectPath, {
    disabledHarnesses,
    userHome,
    modelGateway: globalConfig?.modelGateway,
    projectStateBinding: state,
  }));
  const hookResult = await syncNativeHookProjections(projectPath, state.projectStateRoot, {
    disabledHarnesses,
    privateStateRoot: state.projectStateRoot,
  });
  const agentResult = await requireCurrentProjection(projectPath, "native-agents", () => syncNativeAgentProjections(projectPath, {
    disabledHarnesses,
    projectStateBinding: state,
    userHome,
    communicationCandidates: configuredCommunicationCandidates({
      global: globalConfig?.communication,
      project: readKilnYamlFile(state.configPath)?.communication,
    }),
  }));
  const communicationResult = syncGlobalCommunicationProjection({
    intent: resolveConfiguredCommunication({ global: globalConfig?.communication }),
    userHome,
  });
  const skillResult = await requireCurrentProjection(projectPath, "native-skills", () => syncNativeSkillProjections(projectPath, {
    disabledHarnesses,
    projectStateBinding: state,
    skillConfig: kilnYaml.skills,
    userHome,
  }));
  const globalMcpResult = await syncGlobalControlPlaneMcpProjections({
    operation: "install",
    projectPath,
    userHome,
  });
  const mcpResult = await syncNativeMcpProjections(
    loadResolvedKilnMcpConfiguration(projectPath, { projectStateBinding: state }),
    projectPath,
    { projectStateBinding: state },
  );
  const mcpErrors = mcpResult.targets.flatMap((target) =>
    target.status === "current"
      ? []
      : [`${target.harness} MCP projection ${target.status}${target.reason ? `: ${target.reason}` : ""}`]);
  const errors = [
    ...permissionResult.errors,
    ...hookResult.errors,
    ...agentResult.errors,
    ...communicationResult.errors,
    ...skillResult.errors,
    ...mcpErrors,
    ...globalMcpResult.targets.flatMap((target) => target.status === "current"
      ? []
      : [`${target.harness} global control-plane MCP projection ${target.status}${target.reason ? `: ${target.reason}` : ""}`]),
  ];
  if (errors.length > 0) {
    return result(action, "failed", "Native projection sync failed.", errors, projectPath, userHome);
  }

  return result(action, "applied", "Native projections synced.", [], projectPath, userHome);
}

async function requireCurrentProjection<T>(
  projectPath: string,
  target: "native-agents" | "native-skills" | "native-permissions" | "repo-shims",
  run: () => T | Promise<T>,
): Promise<T> {
  const result = await runConfigReconciliationTarget(projectPath, target, run);
  if (result.status === "superseded") {
    throw new Error(`${target} projection was superseded by a newer canonical revision; retry setup.`);
  }
  return result.value;
}

async function adoptGlobalInstructions(
  projectPath: string,
  action: KilnConfigSetupAction,
  userHome?: string,
  binding?: ProjectStateBinding,
): Promise<KilnConfigSetupActionResult> {
  const sync = await syncGlobalInstructionShimProjections(projectPath, {
    userHome,
    projectStateBinding: binding,
    disabledHarnesses: [],
    adoptUnmanaged: true,
  });
  if (sync.errors.length > 0) {
    return result(action, "failed", "Global instruction adoption failed.", sync.errors, projectPath, userHome);
  }
  return result(
    action,
    sync.synced > 0 ? "applied" : "noop",
    sync.synced > 0 ? "Global instructions adopted and projected." : "No unmanaged global instructions need adoption.",
    [],
    projectPath,
    userHome,
  );
}

async function adoptNativeGuidance(
  projectPath: string,
  action: KilnConfigSetupAction,
  userHome?: string,
  binding?: ProjectStateBinding,
): Promise<KilnConfigSetupActionResult> {
  const state = binding ?? resolveProjectStateBinding(projectPath);
  const kilnYaml = await loadKilnConfig(projectPath, { projectStateBinding: state });
  if (!kilnYaml) {
    return result(action, "failed", "No private project configuration found.", ["No project configuration found."], projectPath, userHome);
  }

  const adoption = adoptNativeHarnessSkills({
    projectPath,
    userHome,
    skillConfig: kilnYaml.skills,
  });
  if (adoption.errors.length > 0) {
    return result(
      action,
      adoption.adopted.length > 0 ? "failed" : "blocked",
      adoption.adopted.length > 0
        ? `Adopted ${adoption.adopted.length} native skill(s), but some native skills need manual reconciliation.`
        : "Native skill adoption requires manual reconciliation.",
      adoption.errors,
      projectPath,
      userHome,
    );
  }
  if (adoption.adopted.length === 0) {
    return result(action, "noop", "No unmanaged native skills need adoption.", [], projectPath, userHome);
  }

  const sync = await syncNativeProjections(projectPath, action, userHome, state);
  if (sync.status === "failed") {
    return sync;
  }
  return result(
    action,
    "applied",
    `Adopted and projected ${adoption.adopted.length} native skill(s): ${adoption.adopted.join(", ")}.`,
    [],
    projectPath,
    userHome,
  );
}

async function result(
  action: KilnConfigSetupAction,
  status: KilnConfigSetupActionResult["status"],
  message: string,
  errors: readonly string[],
  projectPath: string,
  userHome?: string,
): Promise<KilnConfigSetupActionResult> {
  return {
    action,
    status,
    message,
    errors,
    setup: (await readConfigStatusSnapshot({ projectPath, userHome })).setup,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
