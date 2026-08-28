import readline from "node:readline";
import { loadKilnConfigWithGlobalAuthority } from "../config/config-merger.js";
import { syncNativePermissionProjections, syncOpenCodeSkillVisibilityProjection } from "../config/native-permission-projection.js";
import { syncNativeHookProjections } from "../config/native-hook-projection.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { syncWorkflowSnapshotProjection } from "../application/workflow-snapshot-projection.js";
import { syncGlobalInstructionShimProjections } from "../application/global-instruction-shim-projection.js";
import { syncNativeAgentProjections } from "../config/native-agent-projection.js";
import { syncNativeSkillProjections } from "../config/native-skill-projection.js";
import { runConfigReconciliationTarget } from "../application/config-reconciliation-target.js";
import { syncCodexExternalSkillExposure } from "../config/codex-external-skill-exposure-projection.js";
import type { ProjectionOutcome } from "../config/native-projection-policy.js";
import type { KilnAppConfig } from "../config.js";
import { readKilnYamlFile } from "../kiln-yaml.js";
import { configuredCommunicationCandidates, resolveConfiguredCommunication } from "../config/communication-policy.js";
import { syncGlobalCommunicationProjection } from "../config/global-communication-projection.js";
import { resolveProjectStateBinding } from "../application/project-state-root.js";

export const SYNC_TARGETS = ["permissions", "hooks", "agents", "workflow-snapshot", "global-instructions", "skills"] as const;
export type SyncTargetId = typeof SYNC_TARGETS[number];

const SYNC_TARGET_FLAGS: Readonly<Record<string, SyncTargetId>> = {
  "--permissions": "permissions",
  "--hooks": "hooks",
  "--agents": "agents",
  "--workflow-snapshot": "workflow-snapshot",
  "--global-instructions": "global-instructions",
  "--skills": "skills",
};

export interface SyncFlags {
  readonly targets: readonly SyncTargetId[];
  readonly force: boolean;
  readonly syncAll: boolean;
  readonly dryRun: boolean;
  readonly projectPath?: string;
}

export function parseSyncFlags(args: readonly string[]): SyncFlags {
  const requestedTargets: SyncTargetId[] = [];
  let force = false;
  let dryRun = false;
  let syncAll = false;
  let projectPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const targetFlag = SYNC_TARGET_FLAGS[arg];
    if (targetFlag) {
      requestedTargets.push(targetFlag);
      continue;
    }
    if (arg === "--all") {
      syncAll = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--target" || arg.startsWith("--target=")) {
      const value = readInlineOrFollowingValue(args, index, "--target");
      requestedTargets.push(...value.value.split(",").map((target) => target.trim()).filter(Boolean).map(parseSyncTargetId));
      index += value.consumedNext ? 1 : 0;
      continue;
    }
    if (arg === "--project" || arg.startsWith("--project=") || arg === "--cwd" || arg.startsWith("--cwd=")) {
      if (projectPath !== undefined) throw new Error("--project or --cwd may be specified only once");
      const flag = arg.startsWith("--cwd") ? "--cwd" : "--project";
      const value = readInlineOrFollowingValue(args, index, flag);
      projectPath = value.value;
      index += value.consumedNext ? 1 : 0;
      continue;
    }
    throw new Error(`Unknown sync argument "${arg}"`);
  }

  const targets = [...new Set(requestedTargets)];
  if (syncAll && targets.length > 0) throw new Error("--all cannot be combined with target selection");
  if (!syncAll && targets.length === 0) throw new Error("Select at least one sync target or pass --all");
  return {
    targets,
    force,
    syncAll,
    dryRun,
    projectPath,
  };
}

export function printSyncHelp(appName: string): void {
  console.log(`${appName} sync (--all | --target <targets> | <target flags>) [options]`);
  console.log("");
  console.log("Targets:");
  console.log(`  --all                    Sync every target: ${SYNC_TARGETS.join(", ")}`);
  console.log("  --target <targets>       Sync a comma-separated target list; repeatable");
  for (const [flag, target] of Object.entries(SYNC_TARGET_FLAGS)) {
    console.log(`  ${flag.padEnd(24)}Sync ${target}`);
  }
  console.log("");
  console.log("Options:");
  console.log("  --project, --cwd <path>  Resolve project-aware targets from this path");
  console.log("  --dry-run                Report paths, outcomes, and refusal reasons without writing");
  console.log("  --force                  Overwrite reviewed managed drift after confirmation");
  console.log("  --help, -h               Show this help");
  console.log("");
  console.log("Protected drift is reported as BLOCKED and does not fail the command; operational errors exit non-zero.");
}

export function requiresForceSyncConfirmation(flags: SyncFlags): boolean {
  return flags.force && !flags.dryRun && (
    isSyncTargetSelected(flags, "permissions")
    || isSyncTargetSelected(flags, "hooks")
    || isSyncTargetSelected(flags, "agents")
    || isSyncTargetSelected(flags, "global-instructions")
    || isSyncTargetSelected(flags, "skills")
  );
}

function isSyncTargetSelected(flags: SyncFlags, target: SyncTargetId): boolean {
  return flags.syncAll || flags.targets.includes(target);
}

function isForceSyncTargetSelected(flags: SyncFlags, target: SyncTargetId): boolean {
  return flags.force && isSyncTargetSelected(flags, target);
}

function parseSyncTargetId(target: string): SyncTargetId {
  if ((SYNC_TARGETS as readonly string[]).includes(target)) {
    return target as SyncTargetId;
  }
  throw new Error(`Unknown sync target "${target}". Valid targets: ${SYNC_TARGETS.join(", ")}`);
}

function readInlineOrFollowingValue(
  args: readonly string[],
  index: number,
  flag: string,
): { readonly value: string; readonly consumedNext: boolean } {
  const arg = args[index]!;
  const inlinePrefix = `${flag}=`;
  if (arg.startsWith(inlinePrefix)) {
    const value = arg.slice(inlinePrefix.length).trim();
    if (!value) throw new Error(`${flag} requires a value`);
    return { value, consumedNext: false };
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return { value, consumedNext: true };
}

async function confirmForceNativeProjectionSync(): Promise<boolean> {
  process.stdout.write("Force overwrite managed projection fields/files? [y/N]: ");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    let settled = false;
    rl.once("line", (line) => {
      settled = true;
      resolve(line);
    });
    rl.once("close", () => {
      if (!settled) {
        resolve("");
      }
    });
  });

  rl.close();
  return answer.trim().toLowerCase() === "y";
}

export async function syncCommand(
  _appConfig: KilnAppConfig,
  _subcommand: string | undefined,
  args: readonly string[],
): Promise<void> {
  let flags: SyncFlags;
  try {
    flags = parseSyncFlags(args);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    printSyncHelp("kiln");
    process.exit(1);
  }
  const forceNativeProjectionSync = requiresForceSyncConfirmation(flags);
  const forcePermissionSync = isForceSyncTargetSelected(flags, "permissions");
  const forceHookSync = isForceSyncTargetSelected(flags, "hooks");
  const forceAgentSync = isForceSyncTargetSelected(flags, "agents");
  const forceGlobalInstructionSync = isForceSyncTargetSelected(flags, "global-instructions");
  const forceSkillSync = isForceSyncTargetSelected(flags, "skills");

  const projectRoot = resolveProjectRoot({ explicitPath: flags.projectPath });
  const root = projectRoot.rootPath;
  const projectStateBinding = resolveProjectStateBinding(root);
  const kilnDir = projectStateBinding.projectionsPath;
  const disabledHarnesses = [] as const;

  const { kilnYaml, globalConfig } = await loadKilnConfigWithGlobalAuthority(root, { projectStateBinding });
  if (!kilnYaml) {
    console.error(`Error: No private project configuration found at ${projectStateBinding.configPath}`);
    process.exit(1);
  }

  if (forceNativeProjectionSync) {
    const approved = await confirmForceNativeProjectionSync();
    if (!approved) {
      console.error("Error: native projection force override cancelled");
      process.exit(1);
    }
  }

  let permResult: Awaited<ReturnType<typeof syncNativePermissionProjections>> | null = null;
  let hookResult: Awaited<ReturnType<typeof syncNativeHookProjections>> | null = null;
  let agentResult: Awaited<ReturnType<typeof syncNativeAgentProjections>> | null = null;
  let workflowSnapshotResult: Awaited<ReturnType<typeof syncWorkflowSnapshotProjection>> | null = null;
  let globalInstructionResult: Awaited<ReturnType<typeof syncGlobalInstructionShimProjections>> | null = null;
  let globalCommunicationResult: ReturnType<typeof syncGlobalCommunicationProjection> | null = null;
  let skillsResult: Awaited<ReturnType<typeof syncNativeSkillProjections>> | null = null;
  let exposureResult: Awaited<ReturnType<typeof syncCodexExternalSkillExposure>> | null = null;
  let openCodeSkillVisibilityResult: Awaited<ReturnType<typeof syncOpenCodeSkillVisibilityProjection>> | null = null;
  const unexpectedOutcomes: ProjectionOutcome[] = [];

  if (isSyncTargetSelected(flags, "permissions")) {
    permResult = await captureProjectionFailure(unexpectedOutcomes, "permissions", root, () =>
      requireCurrentProjection(root, "native-permissions", () => syncNativePermissionProjections(kilnYaml, root, {
        force: forcePermissionSync,
        dryRun: flags.dryRun,
        disabledHarnesses,
        modelGateway: globalConfig?.modelGateway,
        projectStateBinding,
      })));
  }

  if (isSyncTargetSelected(flags, "hooks")) {
    hookResult = await captureProjectionFailure(unexpectedOutcomes, "hooks", root, () =>
      syncNativeHookProjections(root, kilnDir, {
        force: forceHookSync,
        dryRun: flags.dryRun,
        disabledHarnesses,
        privateStateRoot: projectStateBinding.projectStateRoot,
      }));
  }

  if (isSyncTargetSelected(flags, "agents")) {
    agentResult = await captureProjectionFailure(unexpectedOutcomes, "agents", root, () =>
      requireCurrentProjection(root, "native-agents", () => syncNativeAgentProjections(root, {
        force: forceAgentSync,
        dryRun: flags.dryRun,
        disabledHarnesses,
        projectStateBinding,
        communicationCandidates: configuredCommunicationCandidates({
          global: globalConfig?.communication,
          project: readKilnYamlFile(projectStateBinding.configPath)?.communication,
        }),
      })));
  }

  if (isSyncTargetSelected(flags, "workflow-snapshot")) {
    workflowSnapshotResult = await captureProjectionFailure(unexpectedOutcomes, "workflow-snapshot", root, () =>
      requireCurrentProjection(root, "workflow-snapshot", () =>
        syncWorkflowSnapshotProjection(root, { dryRun: flags.dryRun, projectStateBinding })));
  }

  if (isSyncTargetSelected(flags, "global-instructions")) {
    globalInstructionResult = await captureProjectionFailure(unexpectedOutcomes, "global-instructions", root, () =>
      syncGlobalInstructionShimProjections(root, {
        force: forceGlobalInstructionSync,
        dryRun: flags.dryRun,
        disabledHarnesses,
        projectStateBinding,
      }));
    globalCommunicationResult = await captureProjectionFailure(
      unexpectedOutcomes,
      "global-instructions",
      root,
      async () => syncGlobalCommunicationProjection({
        intent: resolveConfiguredCommunication({ global: globalConfig?.communication }),
        force: forceGlobalInstructionSync,
        dryRun: flags.dryRun,
      }),
    );
  }

  if (isSyncTargetSelected(flags, "skills")) {
    exposureResult = await captureProjectionFailure(unexpectedOutcomes, "skills", root, () =>
      syncCodexExternalSkillExposure({
        skillConfig: kilnYaml.skills, force: forceSkillSync, dryRun: flags.dryRun,
      }));
    openCodeSkillVisibilityResult = await captureProjectionFailure(unexpectedOutcomes, "skills", root, () =>
      syncOpenCodeSkillVisibilityProjection(kilnYaml, root, {
        force: forceSkillSync, dryRun: flags.dryRun, disabledHarnesses, projectStateBinding,
      }));
    skillsResult = await captureProjectionFailure(unexpectedOutcomes, "skills", root, () =>
      requireCurrentProjection(root, "native-skills", () => syncNativeSkillProjections(root, {
        force: forceSkillSync,
        dryRun: flags.dryRun,
        disabledHarnesses,
        skillConfig: kilnYaml.skills,
        projectStateBinding,
        projectSkillsDirectory: projectStateBinding.skillsPath,
      })));
  }

  const outcomes = [
    ...unexpectedOutcomes,
    ...[permResult, hookResult, agentResult, workflowSnapshotResult, globalInstructionResult, exposureResult, openCodeSkillVisibilityResult, skillsResult]
      .flatMap((result) => result?.outcomes ?? []),
    ...(globalCommunicationResult ? [globalCommunicationResult.outcome] : []),
  ];
  console.log(flags.dryRun ? "\nSync Preview:" : "\nSync Results:");
  console.log("─".repeat(40));
  for (const outcome of outcomes) {
    const reason = outcome.reason ? ` - ${outcome.reason}` : "";
    console.log(`${outcome.path}: ${outcome.status.toUpperCase()}${reason}`);
  }
  console.log("─".repeat(40));

  if (outcomes.some((outcome) => outcome.status === "failed")) {
    process.exit(1);
  }
}

async function requireCurrentProjection<T>(
  projectPath: string,
  target: "native-agents" | "native-skills" | "native-permissions" | "workflow-snapshot",
  run: () => T | Promise<T>,
): Promise<T> {
  const result = await runConfigReconciliationTarget(projectPath, target, run);
  if (result.status === "superseded") {
    throw new Error(`${target} projection was superseded by a newer canonical revision; retry sync.`);
  }
  return result.value;
}

async function captureProjectionFailure<T>(
  outcomes: ProjectionOutcome[],
  targetId: SyncTargetId,
  path: string,
  operation: () => Promise<T>,
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    outcomes.push({
      targetId,
      path,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
