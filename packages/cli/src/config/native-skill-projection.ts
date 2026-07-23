import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { loadSkillMdIndex, renderSkillMarkdown, resolveKilnCoreBuiltinSkills } from "@kilnai/core";
import {
  createNativeProjectionFileSnapshot,
  detectNativeProjectionFileDrift,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
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
import { NATIVE_SKILL_TARGETS } from "./native-skill-targets.js";

export interface NativeSkillProjectionResult {
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  synced: number;
  errors: string[];
}

export interface NativeSkillProjectionOptions extends NativeProjectionSyncOptions {
  readonly skillConfig?: KilnYamlSkillsConfig | null;
  readonly userHome?: string;
}

export function discoverSkillDirs(projectPath: string, userHome = os.homedir()): Map<string, string> {
  const discovered = new Map<string, string>();
  const globalSkillsDir = join(userHome, ".kiln", "skills");
  const projectSkillsDir = join(projectPath, ".kiln", "skills");

  try {
    for (const entry of readdirSync(globalSkillsDir, { withFileTypes: true })) {
      const sourceDir = join(globalSkillsDir, entry.name);
      if (entry.isDirectory() && isCanonicalSkillDirectory(sourceDir, entry.name)) {
        discovered.set(entry.name, sourceDir);
      }
    }
  } catch {
    // Fail-open when the global skills directory is missing or unreadable.
  }

  try {
    for (const entry of readdirSync(projectSkillsDir, { withFileTypes: true })) {
      const sourceDir = join(projectSkillsDir, entry.name);
      if (entry.isDirectory() && isCanonicalSkillDirectory(sourceDir, entry.name)) {
        discovered.set(entry.name, sourceDir);
      }
    }
  } catch {
    // Fail-open when the project skills directory is missing or unreadable.
  }

  return discovered;
}

function isCanonicalSkillDirectory(skillDir: string, directoryName: string): boolean {
  try {
    const skillFile = readdirSync(skillDir, { withFileTypes: true })
      .find((entry) => entry.isFile() && entry.name.toLowerCase() === "skill.md");
    if (!skillFile) {
      return false;
    }
    return loadSkillMdIndex(join(skillDir, skillFile.name)).name === directoryName;
  } catch {
    return false;
  }
}

interface SkillProjectionSource {
  readonly sourceDir?: string;
  readonly files?: readonly {
    readonly fileName: string;
    readonly content: string | Uint8Array;
  }[];
}

export function discoverSkillProjectionSources(
  projectPath: string,
  skillConfig?: KilnYamlSkillsConfig | null,
  userHome = os.homedir(),
): Map<string, SkillProjectionSource> {
  const discovered = new Map<string, SkillProjectionSource>();
  for (const [skillName, sourceDir] of discoverSkillDirs(projectPath, userHome)) {
    discovered.set(skillName, { sourceDir });
  }
  addFlatSkillProjectionSources(discovered, join(userHome, ".kiln", "skills"), false);
  addFlatSkillProjectionSources(discovered, join(projectPath, ".kiln", "skills"), true);
  for (const skill of resolveKilnCoreBuiltinSkills(skillConfig?.builtin)) {
    if (!discovered.has(skill.name)) {
      discovered.set(skill.name, {
        files: [{ fileName: "SKILL.md", content: renderSkillMarkdown(skill) }],
      });
    }
  }
  return discovered;
}

function addFlatSkillProjectionSources(
  discovered: Map<string, SkillProjectionSource>,
  root: string,
  override: boolean,
): void {
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const filePath = join(root, entry.name);
      try {
        const index = loadSkillMdIndex(filePath);
        if (override || !discovered.has(index.name)) {
          discovered.set(index.name, {
            files: [{ fileName: entry.name, content: readFileSync(filePath, "utf-8") }],
          });
        }
      } catch {
        // Invalid flat skill files are not projection sources.
      }
    }
  } catch {
    // Missing or unreadable registries contribute no flat skill sources.
  }
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
  const userHome = options.userHome ?? os.homedir();
  const skillSources = discoverSkillProjectionSources(projectPath, options.skillConfig, userHome);

  const hasManagedSkillProjection = Object.keys(installState.targets)
    .some((targetId) => targetId.includes("-skill:"));
  if (skillSources.size === 0 && !hasManagedSkillProjection) {
    return { claude: true, codex: true, opencode: true, synced: 0, errors: [] };
  }

  const targets = NATIVE_SKILL_TARGETS.map((target) => ({
    key: target.target,
    name: target.displayName,
    dir: target.dir(userHome),
  }));

  let claude = true;
  let codex = true;
  let opencode = true;

  const setTargetFailed = (targetKey: typeof targets[number]["key"]): void => {
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

    const pruneResult = pruneStaleSkillProjections({
      target,
      skillSources,
      kilnDir,
      installState,
      options,
    });
    installState = pruneResult.installState;
    if (pruneResult.errors.length > 0) {
      setTargetFailed(target.key);
      errors.push(...pruneResult.errors);
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

function pruneStaleSkillProjections(input: {
  readonly target: {
    readonly key: "claude" | "codex" | "opencode";
    readonly name: string;
    readonly dir: string;
  };
  readonly skillSources: ReadonlyMap<string, SkillProjectionSource>;
  readonly kilnDir: string;
  readonly installState: NativeProjectionInstallState;
  readonly options: NativeSkillProjectionOptions;
}): { readonly installState: NativeProjectionInstallState; readonly errors: readonly string[] } {
  const prefix = `${input.target.key}-skill:`;
  const errors: string[] = [];
  const currentFilesBySkill = new Map<string, readonly string[]>();
  let installState = input.installState;

  for (const [targetId, state] of Object.entries(input.installState.targets)) {
    if (!targetId.startsWith(prefix)) continue;
    const relativeTarget = targetId.slice(prefix.length);
    const separator = relativeTarget.indexOf("/");
    if (separator <= 0) continue;
    const skillName = relativeTarget.slice(0, separator);
    const fileName = relativeTarget.slice(separator + 1);
    const source = input.skillSources.get(skillName);
    if (source) {
      let currentFiles = currentFilesBySkill.get(skillName);
      if (!currentFiles) {
        try {
          currentFiles = (source.files ?? readSkillSourceFiles(source.sourceDir))
            .map((file) => file.fileName);
          currentFilesBySkill.set(skillName, currentFiles);
        } catch (error) {
          errors.push(
            `${input.target.name} skill "${skillName}" stale-file check failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
      }
      if (currentFiles.includes(fileName)) continue;
      if (currentFiles.some((currentFile) => currentFile.toLowerCase() === fileName.toLowerCase())) {
        installState = removeNativeProjectionTargetState(installState, targetId);
        continue;
      }
    }

    try {
      if (existsSync(state.filePath)) {
        const drift = detectNativeProjectionFileDrift({
          targetId,
          state: installState,
          currentContent: readFileSync(state.filePath),
        });
        if (drift && !input.options.force) {
          errors.push(
            `${input.target.name} stale skill "${skillName}" file "${fileName}" failed: managed file drift detected: ${drift.driftedFields.join(", ")}`,
          );
          continue;
        }
        backupNativeProjectionFile({ kilnDir: input.kilnDir, targetId, filePath: state.filePath });
        rmSync(state.filePath, { force: true });
      }
      installState = removeNativeProjectionTargetState(installState, targetId);
    } catch (error) {
      errors.push(
        `${input.target.name} stale skill "${skillName}" file "${fileName}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { installState, errors };
}

function readSkillSourceFiles(sourceDir: string | undefined): readonly {
  readonly fileName: string;
  readonly content: string | Uint8Array;
}[] {
  if (!sourceDir) {
    return [];
  }
  return readSkillSourceFilesRecursive(sourceDir, sourceDir);
}

function readSkillSourceFilesRecursive(sourceRoot: string, currentDir: string): readonly {
  readonly fileName: string;
  readonly content: string | Uint8Array;
}[] {
  return readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const sourcePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        return readSkillSourceFilesRecursive(sourceRoot, sourcePath);
      }
      if (!entry.isFile()) {
        return [];
      }
      return [{
        fileName: relative(sourceRoot, sourcePath).split(sep).join("/"),
        content: readFileSync(sourcePath),
      }];
    });
}

function syncSkillFile(input: {
  readonly target: {
    readonly key: "claude" | "codex" | "opencode";
    readonly name: string;
  };
  readonly skillName: string;
  readonly fileName: string;
  readonly content: string | Uint8Array;
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
        currentContent: readFileSync(input.targetFile),
      });
      if (drift && !input.options.force) {
        return {
          ok: false,
          error: `managed file drift detected: ${drift.driftedFields.join(", ")}`,
        };
      }
    }

    backupNativeProjectionFile({ kilnDir: input.kilnDir, targetId, filePath: input.targetFile });
    mkdirSync(dirname(input.targetFile), { recursive: true });
    if (typeof input.content === "string") {
      writeFileSync(input.targetFile, input.content, "utf-8");
    } else {
      writeFileSync(input.targetFile, input.content);
    }
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
