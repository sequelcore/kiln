import { join } from "node:path";
import readline from "node:readline";
import { loadKilnConfig } from "../config/config-merger.js";
import { syncNativePermissionProjections } from "../config/native-permission-projection.js";
import { syncNativeHookProjections } from "../config/native-hook-projection.js";
import { writeAgentsMdProjection } from "../application/agents-md-projection.js";
import { syncNativeAgentProjections } from "../config/native-agent-projection.js";
import { syncNativeSkillProjections } from "../config/native-skill-projection.js";
import { listHarnessIntegrationCapabilities } from "../config/harness-integration-capabilities.js";
import type { KilnAppConfig } from "../config.js";

export const SYNC_TARGETS = ["permissions", "hooks", "agents", "agents-md", "skills"] as const;
export type SyncTargetId = typeof SYNC_TARGETS[number];

export interface SyncFlags {
  readonly targets: readonly SyncTargetId[];
  readonly force: boolean;
  readonly syncAll: boolean;
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

export function requiresForceSyncConfirmation(flags: SyncFlags): boolean {
  return flags.force && (
    isSyncTargetSelected(flags, "permissions")
    || isSyncTargetSelected(flags, "hooks")
    || isSyncTargetSelected(flags, "agents")
    || isSyncTargetSelected(flags, "skills")
  );
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

async function confirmForceNativeProjectionSync(): Promise<boolean> {
  process.stdout.write("Force overwrite managed native projection fields/files? [y/N]: ");

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
  const forcePermissionSync = flags.force && isSyncTargetSelected(flags, "permissions");
  const forceHookSync = flags.force && isSyncTargetSelected(flags, "hooks");
  const forceAgentSync = flags.force && isSyncTargetSelected(flags, "agents");
  const forceSkillSync = flags.force && isSyncTargetSelected(flags, "skills");

  const root = process.cwd();
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
  let agentsMdResult: Awaited<ReturnType<typeof writeAgentsMdProjection>> | null = null;
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

  if (isSyncTargetSelected(flags, "agents-md")) {
    agentsMdResult = await writeAgentsMdProjection(root);
    allErrors.push(...agentsMdResult.errors);
  }

  if (isSyncTargetSelected(flags, "skills")) {
    skillsResult = await syncNativeSkillProjections(root, {
      force: forceSkillSync,
      disabledHarnesses,
    });
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

  if (permResult || hookResult || agentResult || agentsMdResult || skillsResult) {
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
