import { join } from "node:path";
import type {
  KilnConfigSetupAction,
  KilnConfigSetupActionResult,
} from "@kilnai/gateway-contracts";
import { loadKilnConfig } from "../config/config-merger.js";
import { syncNativeAgentProjections } from "../config/native-agent-projection.js";
import { syncNativeHookProjections } from "../config/native-hook-projection.js";
import { syncNativePermissionProjections } from "../config/native-permission-projection.js";
import { syncNativeSkillProjections } from "../config/native-skill-projection.js";
import { writeProjectContextAdoption } from "./project-context.js";
import { resolveProjectRoot } from "./project-root-resolver.js";
import { writeRepoShimProjections } from "./repo-shim-projection.js";
import { readConfigStatusSnapshot } from "./config-status.js";

export interface ExecuteConfigSetupActionInput {
  readonly projectPath: string;
  readonly action: KilnConfigSetupAction;
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
        return await syncNativeProjections(projectPath, input.action);
      case "review-project-context":
        return await result(input.action, "blocked", "Review the project context before replacing it.", [], projectPath);
      case "review-and-force-sync-repo-shims":
        return await result(input.action, "blocked", "Review repo-shim drift before running a force sync.", [], projectPath);
      case "adopt-or-back-up-native-guidance":
        return await result(input.action, "blocked", "Review unmanaged native guidance before adopting or backing it up.", [], projectPath);
      case "review-native-projection-drift":
        return await result(input.action, "blocked", "Review native projection drift before overwriting managed fields.", [], projectPath);
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

async function syncNativeProjections(
  projectPath: string,
  action: KilnConfigSetupAction,
): Promise<KilnConfigSetupActionResult> {
  const kilnYaml = await loadKilnConfig(projectPath);
  if (!kilnYaml) {
    return result(action, "failed", "No kiln.yaml found in the project .kiln directory.", ["No kiln.yaml found."], projectPath);
  }

  const disabledHarnesses = [] as const;
  const permissionResult = await syncNativePermissionProjections(kilnYaml, projectPath, { disabledHarnesses });
  const hookResult = await syncNativeHookProjections(projectPath, join(projectPath, ".kiln"), { disabledHarnesses });
  const agentResult = await syncNativeAgentProjections(projectPath, { disabledHarnesses });
  const skillResult = await syncNativeSkillProjections(projectPath, {
    disabledHarnesses,
    skillConfig: kilnYaml.skills,
  });
  const errors = [
    ...permissionResult.errors,
    ...hookResult.errors,
    ...agentResult.errors,
    ...skillResult.errors,
  ];
  if (errors.length > 0) {
    return result(action, "failed", "Native projection sync failed.", errors, projectPath);
  }

  return result(action, "applied", "Native projections synced.", [], projectPath);
}

async function result(
  action: KilnConfigSetupAction,
  status: KilnConfigSetupActionResult["status"],
  message: string,
  errors: readonly string[],
  projectPath: string,
): Promise<KilnConfigSetupActionResult> {
  return {
    action,
    status,
    message,
    errors,
    setup: (await readConfigStatusSnapshot({ projectPath })).setup,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
