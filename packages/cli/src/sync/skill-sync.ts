import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export interface SkillSyncResult {
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  synced: number;
  errors: string[];
}

export function discoverSkillDirs(projectPath: string): Map<string, string> {
  const discovered = new Map<string, string>();
  const globalSkillsDir = join(os.homedir(), ".kiln", "skills");
  const projectSkillsDir = join(projectPath, ".kiln", "skills");

  try {
    for (const entry of readdirSync(globalSkillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        discovered.set(entry.name, join(globalSkillsDir, entry.name));
      }
    }
  } catch {
    // Fail-open when the global skills directory is missing or unreadable.
  }

  try {
    for (const entry of readdirSync(projectSkillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        discovered.set(entry.name, join(projectSkillsDir, entry.name));
      }
    }
  } catch {
    // Fail-open when the project skills directory is missing or unreadable.
  }

  return discovered;
}

interface SkillTarget {
  key: "claude" | "codex" | "opencode";
  name: "Claude Code" | "Codex" | "OpenCode";
  dir: string;
}

export async function syncSkills(projectPath: string): Promise<SkillSyncResult> {
  const errors: string[] = [];
  let synced = 0;
  const skillDirs = discoverSkillDirs(projectPath);

  if (skillDirs.size === 0) {
    return { claude: true, codex: true, opencode: true, synced: 0, errors: [] };
  }

  const targets: SkillTarget[] = [
    { key: "claude", name: "Claude Code", dir: join(os.homedir(), ".claude", "skills") },
    { key: "codex", name: "Codex", dir: join(os.homedir(), ".codex", "skills") },
    { key: "opencode", name: "OpenCode", dir: join(os.homedir(), ".config", "opencode", "skills") },
  ];

  let claude = true;
  let codex = true;
  let opencode = true;

  const setTargetFailed = (targetKey: SkillTarget["key"]): void => {
    if (targetKey === "claude") {
      claude = false;
      return;
    }
    if (targetKey === "codex") {
      codex = false;
      return;
    }
    opencode = false;
  };

  for (const target of targets) {
    try {
      mkdirSync(target.dir, { recursive: true });
    } catch (error) {
      setTargetFailed(target.key);
      errors.push(`${target.name} skills mkdir failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    for (const [skillName, sourceDir] of skillDirs) {
      const targetSkillDir = join(target.dir, skillName);

      try {
        mkdirSync(targetSkillDir, { recursive: true });
        const sourceEntries = readdirSync(sourceDir, { withFileTypes: true });
        for (const sourceEntry of sourceEntries) {
          if (!sourceEntry.isFile()) {
            continue;
          }
          const sourceFile = join(sourceDir, sourceEntry.name);
          const targetFile = join(targetSkillDir, sourceEntry.name);
          copyFileSync(sourceFile, targetFile);
        }
        synced += 1;
      } catch (error) {
        setTargetFailed(target.key);
        errors.push(
          `${target.name} skill "${skillName}" failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return { claude, codex, opencode, synced, errors };
}
