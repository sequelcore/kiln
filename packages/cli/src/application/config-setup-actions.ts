import { join } from "node:path";
import type {
  KilnConfigSetupAction,
  KilnConfigSetupActionResult,
} from "@kilnai/gateway-contracts";
import { loadKilnConfig, loadResolvedKilnMcpConfiguration } from "../config/config-merger.js";
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

export interface ExecuteConfigSetupActionInput {
  readonly projectPath: string;
  readonly action: KilnConfigSetupAction;
  readonly userHome?: string;
}

export async function executeConfigSetupAction(
  input: ExecuteConfigSetupActionInput,
): Promise<KilnConfigSetupActionResult> {
  const root = resolveProjectRoot({ explicitPath: input.projectPath });
  const projectPath = root.rootPath;

  try {
    switch (input.action) {
      case "none":
        return await result(input.action, "noop", "No setup action is required.", [], projectPath);
      case "adopt-project-context":
        return await adoptProjectContext(projectPath, input.action);
      case "sync-repo-shims":
        return await syncRepoShims(projectPath, input.action);
      case "sync-native-projections":
        return await syncNativeProjections(projectPath, input.action, input.userHome);
      case "sync-global-instruction-shims":
        return await syncGlobalInstructionShims(projectPath, input.action, input.userHome);
      case "review-project-context":
        return await result(input.action, "blocked", "Review the project context before replacing it.", [], projectPath);
      case "review-and-force-sync-repo-shims":
        return await result(input.action, "blocked", "Review repo-shim drift before running a force sync.", [], projectPath);
      case "adopt-or-back-up-native-guidance":
        return await adoptNativeGuidance(projectPath, input.action, input.userHome);
      case "adopt-or-back-up-global-instructions":
        return await adoptGlobalInstructions(projectPath, input.action, input.userHome);
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
): Promise<KilnConfigSetupActionResult> {
  const adoption = writeProjectContextAdoption(projectPath);
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
): Promise<KilnConfigSetupActionResult> {
  const sync = await writeRepoShimProjections(projectPath);
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
): Promise<KilnConfigSetupActionResult> {
  const sync = await syncGlobalInstructionShimProjections(projectPath, {
    userHome,
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
): Promise<KilnConfigSetupActionResult> {
  const kilnYaml = await loadKilnConfig(projectPath);
  if (!kilnYaml) {
    return result(action, "failed", "No kiln.yaml found in the project .kiln directory.", ["No kiln.yaml found."], projectPath, userHome);
  }

  const disabledHarnesses = [] as const;
  const permissionResult = await syncNativePermissionProjections(kilnYaml, projectPath, { disabledHarnesses, userHome });
  const hookResult = await syncNativeHookProjections(projectPath, join(projectPath, ".kiln"), { disabledHarnesses });
  const agentResult = await syncNativeAgentProjections(projectPath, { disabledHarnesses, userHome });
  const skillResult = await syncNativeSkillProjections(projectPath, {
    disabledHarnesses,
    skillConfig: kilnYaml.skills,
    userHome,
  });
  const globalMcpResult = await syncGlobalControlPlaneMcpProjections({
    operation: "install",
    projectPath,
    userHome,
  });
  const mcpResult = await syncNativeMcpProjections(
    loadResolvedKilnMcpConfiguration(projectPath),
    projectPath,
  );
  const mcpErrors = mcpResult.targets.flatMap((target) =>
    target.status === "current"
      ? []
      : [`${target.harness} MCP projection ${target.status}${target.reason ? `: ${target.reason}` : ""}`]);
  const errors = [
    ...permissionResult.errors,
    ...hookResult.errors,
    ...agentResult.errors,
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

async function adoptGlobalInstructions(
  projectPath: string,
  action: KilnConfigSetupAction,
  userHome?: string,
): Promise<KilnConfigSetupActionResult> {
  const sync = await syncGlobalInstructionShimProjections(projectPath, {
    userHome,
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
): Promise<KilnConfigSetupActionResult> {
  const kilnYaml = await loadKilnConfig(projectPath);
  if (!kilnYaml) {
    return result(action, "failed", "No kiln.yaml found in the project .kiln directory.", ["No kiln.yaml found."], projectPath, userHome);
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

  const sync = await syncNativeProjections(projectPath, action, userHome);
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
