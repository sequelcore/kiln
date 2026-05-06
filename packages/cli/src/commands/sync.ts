import { join } from "node:path";
import readline from "node:readline";
import { loadKilnConfig } from "../config/config-merger.js";
import { syncPermissions } from "../sync/security-sync.js";
import { syncHooks } from "../sync/hook-sync.js";
import { syncAgentsMd } from "../sync/agents-md-sync.js";
import { syncAgents } from "../sync/agent-sync.js";
import { syncSkills } from "../sync/skill-sync.js";
import type { KilnAppConfig } from "../config.js";

export const SYNC_TARGETS = ["permissions", "hooks", "agents", "agents-md", "skills"] as const;
export type SyncTargetId = typeof SYNC_TARGETS[number];

export interface SyncFlags {
  readonly targets: readonly SyncTargetId[];
  readonly force: boolean;
  readonly syncAll: boolean;
}

export interface SyncFailureStates {
  readonly permissions: boolean;
  readonly hooks: boolean;
  readonly agents: boolean;
  readonly agentsMd: boolean;
  readonly skills: boolean;
}

export function parseSyncFlags(args: readonly string[]): SyncFlags {
  const explicitTargets = readFlagValues(args, "--target").flatMap((value) =>
    value.split(",").map((target) => target.trim()).filter(Boolean)
  );
  const legacyFlagTargets: SyncTargetId[] = [
    args.includes("--permissions") ? "permissions" : undefined,
    args.includes("--hooks") ? "hooks" : undefined,
    args.includes("--agents") ? "agents" : undefined,
    args.includes("--agents-md") ? "agents-md" : undefined,
    args.includes("--skills") ? "skills" : undefined,
  ].filter((target): target is SyncTargetId => target !== undefined);

  const requestedTargets = [...explicitTargets, ...legacyFlagTargets].map(parseSyncTargetId);
  const targets = [...new Set(requestedTargets)];
  const syncAll = targets.length === 0;
  return {
    targets,
    force: args.includes("--force"),
    syncAll,
  };
}

export function allSelectedSyncTargetsFailed(flags: SyncFlags, failures: SyncFailureStates): boolean {
  const selectedFailures = [
    isSyncTargetSelected(flags, "permissions") ? failures.permissions : undefined,
    isSyncTargetSelected(flags, "hooks") ? failures.hooks : undefined,
    isSyncTargetSelected(flags, "agents") ? failures.agents : undefined,
    isSyncTargetSelected(flags, "agents-md") ? failures.agentsMd : undefined,
    isSyncTargetSelected(flags, "skills") ? failures.skills : undefined,
  ].filter((failure): failure is boolean => failure !== undefined);

  return selectedFailures.length > 0 && selectedFailures.every((failure) => failure);
}

function isSyncTargetSelected(flags: SyncFlags, target: SyncTargetId): boolean {
  return flags.syncAll || flags.targets.includes(target);
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

async function confirmForcePermissionSync(): Promise<boolean> {
  process.stdout.write("Force overwrite managed native permission fields? [y/N]: ");

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
  const forcePermissionSync = flags.force && isSyncTargetSelected(flags, "permissions");

  const root = process.cwd();
  const kilnDir = join(root, ".kiln");

  const kilnYaml = await loadKilnConfig(root);
  if (!kilnYaml) {
    console.error("Error: No kiln.yaml found in .kiln directory");
    process.exit(1);
  }

  if (forcePermissionSync) {
    const approved = await confirmForcePermissionSync();
    if (!approved) {
      console.error("Error: permission sync force override cancelled");
      process.exit(1);
    }
  }

  let permResult: Awaited<ReturnType<typeof syncPermissions>> | null = null;
  let hookResult: Awaited<ReturnType<typeof syncHooks>> | null = null;
  let agentResult: Awaited<ReturnType<typeof syncAgents>> | null = null;
  let agentsMdResult: Awaited<ReturnType<typeof syncAgentsMd>> | null = null;
  let skillsResult: Awaited<ReturnType<typeof syncSkills>> | null = null;

  const allErrors: string[] = [];

  if (isSyncTargetSelected(flags, "permissions")) {
    permResult = await syncPermissions(kilnYaml, root, { force: forcePermissionSync });
    allErrors.push(...permResult.errors);
  }

  if (isSyncTargetSelected(flags, "hooks")) {
    hookResult = await syncHooks(root, kilnDir);
    allErrors.push(...hookResult.errors);
  }

  if (isSyncTargetSelected(flags, "agents")) {
    agentResult = await syncAgents(root);
    allErrors.push(...agentResult.errors);
  }

  if (isSyncTargetSelected(flags, "agents-md")) {
    agentsMdResult = await syncAgentsMd(root);
    allErrors.push(...agentsMdResult.errors);
  }

  if (isSyncTargetSelected(flags, "skills")) {
    skillsResult = await syncSkills(root);
    allErrors.push(...skillsResult.errors);
  }

  const platformNote = process.platform === "win32"
    ? " (Windows: Codex hooks skipped)"
    : "";

  if (permResult || hookResult || agentResult || agentsMdResult || skillsResult) {
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

    if (agentsMdResult) {
      console.log(`AGENTS.md:              ${agentsMdResult.path} ${agentsMdResult.written ? "OK" : "FAIL"}`);
    }

    if (skillsResult) {
      console.log(`Skills (Claude Code):   ${skillsResult.claude ? "OK" : "FAIL"} (${skillsResult.synced} skills)`);
      console.log(`Skills (Codex):         ${skillsResult.codex ? "OK" : "FAIL"} (${skillsResult.synced} skills)`);
      console.log(`Skills (OpenCode):      ${skillsResult.opencode ? "OK" : "FAIL"} (${skillsResult.synced} skills)`);
    }

    console.log("─".repeat(40));
  }

  if (allErrors.length > 0) {
    console.log("\nErrors:");
    for (const err of allErrors) {
      console.log(`  - ${err}`);
    }
    console.log("");
  }

  const permAllFailed = permResult
    ? !permResult.claude && !permResult.codex && !permResult.opencode
    : false;
  const hookAllFailed = hookResult
    ? !hookResult.claudeHook && (!hookResult.codexHook || hookResult.skippedWindows)
    : false;
  const agentAllFailed = agentResult
    ? !agentResult.claude && !agentResult.codex && !agentResult.opencode
    : false;
  const agentsMdAllFailed = agentsMdResult
    ? !agentsMdResult.written
    : false;
  const skillsAllFailed = skillsResult
    ? !skillsResult.claude && !skillsResult.codex && !skillsResult.opencode
    : false;

  const allFailed = allSelectedSyncTargetsFailed(flags, {
    permissions: permAllFailed,
    hooks: hookAllFailed,
    agents: agentAllFailed,
    agentsMd: agentsMdAllFailed,
    skills: skillsAllFailed,
  });

  if (allFailed) {
    process.exit(1);
  }
}
