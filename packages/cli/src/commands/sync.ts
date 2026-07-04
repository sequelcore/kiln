import { join } from "node:path";
import readline from "node:readline";
import { loadKilnConfig } from "../config/config-merger.js";
import { syncNativePermissionProjections } from "../config/native-permission-projection.js";
import { syncNativeHookProjections } from "../config/native-hook-projection.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { writeRepoShimProjections } from "../application/repo-shim-projection.js";
import { syncGlobalInstructionShimProjections } from "../application/global-instruction-shim-projection.js";
import { syncNativeAgentProjections } from "../config/native-agent-projection.js";
import { syncNativeSkillProjections } from "../config/native-skill-projection.js";
import { listHarnessIntegrationCapabilities } from "../config/harness-integration-capabilities.js";
import type { KilnAppConfig } from "../config.js";

export const SYNC_TARGETS = ["permissions", "hooks", "agents", "repo-shims", "global-instructions", "skills"] as const;
export type SyncTargetId = typeof SYNC_TARGETS[number];

const LEGACY_SYNC_FLAGS: Readonly<Record<string, SyncTargetId>> = {
  "--permissions": "permissions",
  "--hooks": "hooks",
  "--agents": "agents",
  "--repo-shims": "repo-shims",
  "--global-instructions": "global-instructions",
  "--skills": "skills",
};

export interface SyncFlags {
  readonly targets: readonly SyncTargetId[];
  readonly force: boolean;
  readonly syncAll: boolean;
  readonly projectPath?: string;
}

export function parseSyncFlags(args: readonly string[]): SyncFlags {
  const explicitTargets = readFlagValues(args, "--target").flatMap((value) =>
    value.split(",").map((target) => target.trim()).filter(Boolean)
  );
  const legacyFlagTargets = Object.entries(LEGACY_SYNC_FLAGS)
    .filter(([flag]) => args.includes(flag))
    .map(([, target]) => target);

  const requestedTargets = [...explicitTargets, ...legacyFlagTargets].map(parseSyncTargetId);
  const targets = [...new Set(requestedTargets)];
  const syncAll = targets.length === 0;
  return {
    targets,
    force: args.includes("--force"),
    syncAll,
    projectPath: readOptionalSingleFlagValue(args, ["--project", "--cwd"]),
  };
}

export function requiresForceSyncConfirmation(flags: SyncFlags): boolean {
  return flags.force && (
    isSyncTargetSelected(flags, "permissions")
    || isSyncTargetSelected(flags, "hooks")
    || isSyncTargetSelected(flags, "agents")
    || isSyncTargetSelected(flags, "repo-shims")
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

function readFlagValues(args: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === flag) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      values.push(value);
      index += 1;
    } else if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    }
  }
  return values;
}

function readOptionalSingleFlagValue(args: readonly string[], flags: readonly string[]): string | undefined {
  const values = flags.flatMap((flag) => readFlagValues(args, flag));
  if (values.length > 1) {
    throw new Error(`${flags.join(" or ")} may be specified only once`);
  }
  return values[0];
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
    process.exit(1);
  }
  const forceNativeProjectionSync = requiresForceSyncConfirmation(flags);
  const forcePermissionSync = isForceSyncTargetSelected(flags, "permissions");
  const forceHookSync = isForceSyncTargetSelected(flags, "hooks");
  const forceAgentSync = isForceSyncTargetSelected(flags, "agents");
  const forceRepoShimSync = isForceSyncTargetSelected(flags, "repo-shims");
  const forceGlobalInstructionSync = isForceSyncTargetSelected(flags, "global-instructions");
  const forceSkillSync = isForceSyncTargetSelected(flags, "skills");

  const projectRoot = resolveProjectRoot({ explicitPath: flags.projectPath });
  const root = projectRoot.rootPath;
  const kilnDir = join(root, ".kiln");
  const disabledHarnesses = [] as const;

  const kilnYaml = await loadKilnConfig(root);
  if (!kilnYaml) {
    console.error("Error: No kiln.yaml found in .kiln directory");
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
  let repoShimResult: Awaited<ReturnType<typeof writeRepoShimProjections>> | null = null;
  let globalInstructionResult: Awaited<ReturnType<typeof syncGlobalInstructionShimProjections>> | null = null;
  let skillsResult: Awaited<ReturnType<typeof syncNativeSkillProjections>> | null = null;

  const allErrors: string[] = [];

  if (isSyncTargetSelected(flags, "permissions")) {
    permResult = await syncNativePermissionProjections(kilnYaml, root, {
      force: forcePermissionSync,
      disabledHarnesses,
    });
    allErrors.push(...permResult.errors);
  }

  if (isSyncTargetSelected(flags, "hooks")) {
    hookResult = await syncNativeHookProjections(root, kilnDir, {
      force: forceHookSync,
      disabledHarnesses,
    });
    allErrors.push(...hookResult.errors);
  }

  if (isSyncTargetSelected(flags, "agents")) {
    agentResult = await syncNativeAgentProjections(root, {
      force: forceAgentSync,
      disabledHarnesses,
    });
    allErrors.push(...agentResult.errors);
  }

  if (isSyncTargetSelected(flags, "repo-shims")) {
    if (!projectRoot.hasKilnYaml && !projectRoot.hasGitRoot) {
      repoShimResult = {
        written: false,
        targets: [],
        errors: [`repo-shims: unable to resolve a Kiln project root from ${root}`],
      };
    } else {
      repoShimResult = await writeRepoShimProjections(root, { force: forceRepoShimSync });
    }
    allErrors.push(...repoShimResult.errors);
  }

  if (isSyncTargetSelected(flags, "global-instructions")) {
    globalInstructionResult = await syncGlobalInstructionShimProjections(root, {
      force: forceGlobalInstructionSync,
      disabledHarnesses,
    });
    allErrors.push(...globalInstructionResult.errors);
  }

  if (isSyncTargetSelected(flags, "skills")) {
    skillsResult = await syncNativeSkillProjections(root, {
      force: forceSkillSync,
      disabledHarnesses,
      skillConfig: kilnYaml.skills,
    });
    allErrors.push(...skillsResult.errors);
  }

  const platformNote = process.platform === "win32"
    ? " (Windows: Codex hooks skipped)"
    : "";

  if (permResult || hookResult || agentResult || repoShimResult || globalInstructionResult || skillsResult) {
    console.log("\nSync Results:");
    console.log("─".repeat(40));

    if (permResult) {
      console.log(`Claude Code permissions: ${permResult.claude ? "OK" : "FAIL"}`);
      console.log(`Codex permissions:       ${permResult.codex ? "OK" : "FAIL"}`);
      console.log(`OpenCode permissions:    ${permResult.opencode ? "OK" : "FAIL"}`);
    }

    if (hookResult) {
      console.log(`Claude Code hook:       ${hookResult.claudeHook ? "OK" : "FAIL"}`);
      if (hookResult.skippedWindows) {
        console.log(`Codex hook:              SKIPPED (Windows)${platformNote}`);
      } else {
        console.log(`Codex hook:              ${hookResult.codexHook ? "OK" : "FAIL"}`);
      }
    }

    if (agentResult) {
      console.log(`Agent sync (Claude Code): ${agentResult.claude ? "OK" : "FAIL"}`);
      console.log(`Agent sync (Codex):       ${agentResult.codex ? "OK" : "FAIL"}`);
      console.log(`Agent sync (OpenCode):    ${agentResult.opencode ? "OK" : "FAIL"}`);
    }

    if (repoShimResult) {
      if (repoShimResult.targets.length === 0) {
        console.log(`Repo shims:            ${repoShimResult.written ? "OK" : "FAIL"}`);
      }
      for (const target of repoShimResult.targets) {
        console.log(`${target.path}: ${target.status === "blocked" ? "FAIL" : "OK"} (${target.status})`);
      }
    }

    if (globalInstructionResult) {
      console.log(`Global instruction shims: ${globalInstructionResult.synced}`);
      for (const target of globalInstructionResult.targets) {
        console.log(`${target.filePath}: ${target.status === "blocked" ? "FAIL" : "OK"} (${target.status})`);
      }
    }

    if (skillsResult) {
      console.log(`Skills (Claude Code):   ${skillsResult.claude ? "OK" : "FAIL"}`);
      console.log(`Skills (Codex):         ${skillsResult.codex ? "OK" : "FAIL"}`);
      console.log(`Skills (OpenCode):      ${skillsResult.opencode ? "OK" : "FAIL"}`);
      console.log(`Skill projections:       ${skillsResult.synced}`);
    }

    console.log("─".repeat(40));
  }

  if (permResult || hookResult || agentResult || repoShimResult || globalInstructionResult || skillsResult) {
    console.log("");
    console.log("Harness capabilities:");
    for (const capability of listHarnessIntegrationCapabilities()) {
      const runtimeInjection = capability.runtimeConfigInjection.supported
        ? `runtime injection: ${capability.runtimeConfigInjection.mechanism ?? "supported"}`
        : "runtime injection: not proven";
      const nativeProjection = capability.nativeProjection.supported
        ? "native projection: install-state"
        : "native projection: unsupported";
      const nativeImport = capability.nativeConfigImport ? "native import: supported" : "native import: unsupported";
      const mcp = capability.mcpRuntimeTools ? "MCP: supported" : "MCP: unsupported";
      const hooks = capability.hooks ? "hooks: supported" : "hooks: unsupported";
      console.log(`  ${capability.displayName}: ${runtimeInjection}; ${nativeProjection}; ${nativeImport}; ${mcp}; ${hooks}`);
    }
  }

  if (allErrors.length > 0) {
    console.log("\nErrors:");
    for (const err of allErrors) {
      console.log(`  - ${err}`);
    }
    console.log("");
  }

  if (allErrors.length > 0) {
    process.exit(1);
  }
}
