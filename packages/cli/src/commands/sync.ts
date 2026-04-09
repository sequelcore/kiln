import { join } from "node:path";
import { loadKilnConfig } from "../config/config-merger.js";
import { syncPermissions } from "../sync/security-sync.js";
import { syncHooks } from "../sync/hook-sync.js";
import { syncAgentsMd } from "../sync/agents-md-sync.js";
import type { KilnAppConfig } from "../config.js";

export interface SyncFlags {
  readonly permissions?: boolean;
  readonly hooks?: boolean;
  readonly agentsMd?: boolean;
  readonly all?: boolean;
}

export async function syncCommand(
  _appConfig: KilnAppConfig,
  _subcommand: string | undefined,
  args: readonly string[],
): Promise<void> {
  const syncPermissions_ = args.includes("--permissions");
  const syncHooks_ = args.includes("--hooks");
  const syncAgentsMd_ = args.includes("--agents-md");
  const syncAll = !syncPermissions_ && !syncHooks_ && !syncAgentsMd_;

  const root = process.cwd();
  const kilnDir = join(root, ".kiln");

  const kilnYaml = await loadKilnConfig(root);
  if (!kilnYaml) {
    console.error("Error: No kiln.yaml found in .kiln directory");
    process.exit(1);
  }

  let permResult: Awaited<ReturnType<typeof syncPermissions>> | null = null;
  let hookResult: Awaited<ReturnType<typeof syncHooks>> | null = null;
  let agentsMdResult: Awaited<ReturnType<typeof syncAgentsMd>> | null = null;

  const allErrors: string[] = [];

  if (syncAll || syncPermissions_) {
    permResult = await syncPermissions(kilnYaml, root);
    allErrors.push(...permResult.errors);
  }

  if (syncAll || syncHooks_) {
    hookResult = await syncHooks(root, kilnDir);
    allErrors.push(...hookResult.errors);
  }

  if (syncAll || syncAgentsMd_) {
    agentsMdResult = await syncAgentsMd(root);
    allErrors.push(...agentsMdResult.errors);
  }

  const platformNote = process.platform === "win32"
    ? " (Windows: Codex hooks skipped)"
    : "";

  if (permResult || hookResult || agentsMdResult) {
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

    if (agentsMdResult) {
      console.log(`AGENTS.md:              ${agentsMdResult.path} ${agentsMdResult.written ? "OK" : "FAIL"}`);
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
  const agentsMdAllFailed = agentsMdResult
    ? !agentsMdResult.written
    : false;

  const allFailed = (syncAll || syncPermissions_) && permAllFailed
    && (syncAll || syncHooks_) && hookAllFailed
    && (syncAll || syncAgentsMd_) && agentsMdAllFailed;

  if (allFailed) {
    process.exit(1);
  }
}
