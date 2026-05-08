import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { renderSkillMarkdown, resolveKilnCoreBuiltinSkills } from "@kilnai/core";
import {
  createNativeProjectionFileSnapshot,
  detectNativeProjectionFileDrift,
  readNativeProjectionInstallState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
} from "./native-projection-state.js";
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import {
  isNativeProjectionHarnessDisabled,
  type NativeProjectionSyncOptions,
} from "./native-projection-policy.js";
import type { KilnYamlSkillsConfig } from "../kiln-yaml-types.js";

export interface NativeSkillProjectionResult {
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  synced: number;
  errors: string[];
}

export interface NativeSkillProjectionOptions extends NativeProjectionSyncOptions {
  readonly skillConfig?: KilnYamlSkillsConfig | null;
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

interface SkillProjectionSource {
  readonly sourceDir?: string;
  readonly files?: readonly {
    readonly fileName: string;
    readonly content: string;
  }[];
}

export function discoverSkillProjectionSources(
  projectPath: string,
  skillConfig?: KilnYamlSkillsConfig | null,
): Map<string, SkillProjectionSource> {
  const discovered = new Map<string, SkillProjectionSource>();
  for (const [skillName, sourceDir] of discoverSkillDirs(projectPath)) {
    discovered.set(skillName, { sourceDir });
  }
  for (const skill of resolveKilnCoreBuiltinSkills(skillConfig?.builtin)) {
    if (!discovered.has(skill.name)) {
      discovered.set(skill.name, {
        files: [{ fileName: "SKILL.md", content: renderSkillMarkdown(skill) }],
      });
    }
  }
  return discovered;
}

interface SkillTarget {
  key: "claude" | "codex" | "opencode";
  name: "Claude Code" | "Codex" | "OpenCode";
  dir: string;
}

interface SkillFileSyncResult {
  readonly ok: boolean;
  readonly snapshot?: NativeProjectionTargetState;
  readonly error?: string;
}

export async function syncNativeSkillProjections(
  projectPath: string,
  options: NativeSkillProjectionOptions = {},
): Promise<NativeSkillProjectionResult> {
  const errors: string[] = [];
  let synced = 0;
  const kilnDir = join(projectPath, ".kiln");
  let installState = readNativeProjectionInstallState(kilnDir);
  const skillSources = discoverSkillProjectionSources(projectPath, options.skillConfig);

  if (skillSources.size === 0) {
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

  for (const target of targets.filter((target) => !isNativeProjectionHarnessDisabled(options, target.key))) {
    try {
      mkdirSync(target.dir, { recursive: true });
    } catch (error) {
      setTargetFailed(target.key);
      errors.push(`${target.name} skills mkdir failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    for (const [skillName, source] of skillSources) {
      const targetSkillDir = join(target.dir, skillName);

      try {
        mkdirSync(targetSkillDir, { recursive: true });
        const sourceFiles = source.files ?? readSkillSourceFiles(source.sourceDir);
        let skillFailed = false;
        for (const sourceFile of sourceFiles) {
          const targetFile = join(targetSkillDir, sourceFile.fileName);
          const fileResult = syncSkillFile({
            target,
            skillName,
            fileName: sourceFile.fileName,
            content: sourceFile.content,
            targetFile,
            kilnDir,
            installState,
            options,
          });
          if (!fileResult.ok) {
            skillFailed = true;
            setTargetFailed(target.key);
            errors.push(
              `${target.name} skill "${skillName}" file "${sourceFile.fileName}" failed: ${fileResult.error ?? "unknown error"}`,
            );
            continue;
          }
          if (fileResult.snapshot) {
            installState = upsertNativeProjectionTargetState(installState, fileResult.snapshot);
          }
        }
        if (!skillFailed) {
          synced += 1;
        }
      } catch (error) {
        setTargetFailed(target.key);
        errors.push(
          `${target.name} skill "${skillName}" failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  writeNativeProjectionInstallState(kilnDir, installState);

  return { claude, codex, opencode, synced, errors };
}

function readSkillSourceFiles(sourceDir: string | undefined): readonly {
  readonly fileName: string;
  readonly content: string;
}[] {
  if (!sourceDir) {
    return [];
  }
  return readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      fileName: entry.name,
      content: readFileSync(join(sourceDir, entry.name), "utf-8"),
    }));
}

function syncSkillFile(input: {
  readonly target: SkillTarget;
  readonly skillName: string;
  readonly fileName: string;
  readonly content: string;
  readonly targetFile: string;
  readonly kilnDir: string;
  readonly installState: NativeProjectionInstallState;
  readonly options: NativeSkillProjectionOptions;
}): SkillFileSyncResult {
  const targetId = `${input.target.key}-skill:${input.skillName}/${input.fileName}`;
  try {
    if (existsSync(input.targetFile)) {
      const drift = detectNativeProjectionFileDrift({
        targetId,
        state: input.installState,
        currentContent: readFileSync(input.targetFile, "utf-8"),
      });
      if (drift && !input.options.force) {
        return {
          ok: false,
          error: `managed file drift detected: ${drift.driftedFields.join(", ")}`,
        };
      }
    }

    backupNativeProjectionFile({ kilnDir: input.kilnDir, targetId, filePath: input.targetFile });
    writeFileSync(input.targetFile, input.content, "utf-8");
    return {
      ok: true,
      snapshot: createNativeProjectionFileSnapshot({
        targetId,
        filePath: input.targetFile,
        content: input.content,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
