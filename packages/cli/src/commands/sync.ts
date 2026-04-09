import { join } from "node:path";
import { loadKilnConfig } from "../config/config-merger.js";
import { syncPermissions } from "../sync/security-sync.js";
import { syncHooks } from "../sync/hook-sync.js";
import { syncAgentsMd } from "../sync/agents-md-sync.js";
import { syncAgents } from "../sync/agent-sync.js";
import { syncSkills } from "../sync/skill-sync.js";
import type { KilnAppConfig } from "../config.js";

export interface SyncFlags {
  readonly permissions?: boolean;
  readonly hooks?: boolean;
  readonly agents?: boolean;
  readonly agentsMd?: boolean;
  readonly skills?: boolean;
  readonly all?: boolean;
}

export async function syncCommand(
  _appConfig: KilnAppConfig,
  _subcommand: string | undefined,
  args: readonly string[],
): Promise<void> {
  const syncPermissions_ = args.includes("--permissions");
  const syncHooks_ = args.includes("--hooks");
  const syncAgents_ = args.includes("--agents");
  const syncAgentsMd_ = args.includes("--agents-md");
  const syncSkills_ = args.includes("--skills");
  const syncAll = !syncPermissions_ && !syncHooks_ && !syncAgents_ && !syncAgentsMd_ && !syncSkills_;

  const root = process.cwd();
  const kilnDir = join(root, ".kiln");

  const kilnYaml = await loadKilnConfig(root);
  if (!kilnYaml) {
    console.error("Error: No kiln.yaml found in .kiln directory");
    process.exit(1);
  }

  let permResult: Awaited<ReturnType<typeof syncPermissions>> | null = null;
  let hookResult: Awaited<ReturnType<typeof syncHooks>> | null = null;
  let agentResult: Awaited<ReturnType<typeof syncAgents>> | null = null;
  let agentsMdResult: Awaited<ReturnType<typeof syncAgentsMd>> | null = null;
  let skillsResult: Awaited<ReturnType<typeof syncSkills>> | null = null;

  const allErrors: string[] = [];

  if (syncAll || syncPermissions_) {
    permResult = await syncPermissions(kilnYaml, root);
    allErrors.push(...permResult.errors);
  }

  if (syncAll || syncHooks_) {
    hookResult = await syncHooks(root, kilnDir);
    allErrors.push(...hookResult.errors);
  }

  if (syncAll || syncAgents_) {
    agentResult = await syncAgents(root);
    allErrors.push(...agentResult.errors);
  }

  if (syncAll || syncAgentsMd_) {
    agentsMdResult = await syncAgentsMd(root);
    allErrors.push(...agentsMdResult.errors);
  }

  if (syncAll || syncSkills_) {
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

  const allFailed = (syncAll || syncPermissions_) && permAllFailed
    && (syncAll || syncHooks_) && hookAllFailed
    && (syncAll || syncAgents_) && agentAllFailed
    && (syncAll || syncAgentsMd_) && agentsMdAllFailed
    && (syncAll || syncSkills_) && skillsAllFailed;

  if (allFailed) {
    process.exit(1);
  }
}
