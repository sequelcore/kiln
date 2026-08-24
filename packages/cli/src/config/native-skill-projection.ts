import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { loadSkillMdIndex, renderSkillMarkdown, resolveKilnCoreBuiltinSkills } from "@kilnai/core";
import type { KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import {
  describeProjectionDrift,
  isNativeProjectionHarnessDisabled,
  type NativeProjectionSyncOptions,
  type ProjectionOutcome,
} from "./native-projection-policy.js";
import {
  createNativeProjectionFileSnapshot,
  detectNativeProjectionFileDrift,
  isFullyOwnedNativeProjectionFile,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
  nativeProjectionFileMatchesDesired,
  readNativeProjectionInstallState,
  resolveGlobalNativeProjectionStateDir,
  removeNativeProjectionTargetState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "./native-projection-state.js";
import { NATIVE_SKILL_TARGETS } from "./native-skill-targets.js";
import {
  canonicalSkillKey,
  isSafeProjectionPathComponent,
  isSafeProjectionRelativePath,
  resolveProjectionPathWithin,
} from "./native-projection-paths.js";
import { renderSkillVisibility, resolveSkillVisibility } from "./skill-visibility.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../application/project-state-root.js";
import { resolveKilnHomePath } from "./global-config/path.js";

export interface NativeSkillProjectionResult {
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  synced: number;
  errors: string[];
  outcomes: readonly ProjectionOutcome[];
}

export interface NativeSkillProjectionOptions extends NativeProjectionSyncOptions {
  readonly skillConfig?: KilnYamlSkillsConfig | null;
  /** Explicit private project skills directory supplied by composition. */
  readonly projectSkillsDirectory?: string;
  /** Already-established private project binding. */
  readonly projectStateBinding?: ProjectStateBinding;
}

export function discoverSkillDirs(
  projectPath: string,
  userHome: string | undefined = undefined,
  projectSkillsDirectory?: string,
): Map<string, string> {
  const discovered = new Map<string, string>();
  const globalSkillsDir = join(resolveConfiguredKilnHome(userHome), "skills");
  const projectSkillsDir = projectSkillsDirectory ?? resolvePrivateProjectSkillsDirectory(projectPath, userHome);

  try {
    for (const entry of readdirSync(globalSkillsDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const sourceDir = join(globalSkillsDir, entry.name);
      if (entry.isDirectory() && isCanonicalSkillDirectory(sourceDir, entry.name)) {
        discovered.set(canonicalSkillKey(entry.name), sourceDir);
      }
    }
  } catch {
    // Fail-open when the global skills directory is missing or unreadable.
  }

  try {
    for (const entry of readdirSync(projectSkillsDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const sourceDir = join(projectSkillsDir, entry.name);
      if (entry.isDirectory() && isCanonicalSkillDirectory(sourceDir, entry.name)) {
        discovered.set(canonicalSkillKey(entry.name), sourceDir);
      }
    }
  } catch {
    // Fail-open when the project skills directory is missing or unreadable.
  }

  return discovered;
}

function isCanonicalSkillDirectory(skillDir: string, directoryName: string): boolean {
  if (!isSafeProjectionPathComponent(directoryName)) return false;
  try {
    const skillFile = readdirSync(skillDir, { withFileTypes: true })
      .find((entry) => entry.isFile() && entry.name.toLowerCase() === "skill.md");
    if (!skillFile) {
      return false;
    }
    const skillName = loadSkillMdIndex(join(skillDir, skillFile.name)).name;
    return isSafeProjectionPathComponent(skillName)
      && canonicalSkillKey(skillName) === canonicalSkillKey(directoryName);
  } catch {
    return false;
  }
}

interface SkillProjectionSource {
  readonly skillName: string;
  readonly sourceIdentity: string;
  readonly visibility: "implicit" | "explicit-only";
  readonly origin: "project" | "user" | "builtin";
  readonly representation: "directory" | "flat" | "builtin";
  readonly sourceDir?: string;
  readonly files?: readonly {
    readonly fileName: string;
    readonly content: string | Uint8Array;
  }[];
}

export function discoverSkillProjectionSources(
  projectPath: string,
  skillConfig?: KilnYamlSkillsConfig | null,
  userHome: string | undefined = undefined,
  projectSkillsDirectory?: string,
): Map<string, SkillProjectionSource> {
  const discovered = new Map<string, SkillProjectionSource>();
  const roots = [
    { origin: "user" as const, dir: join(resolveConfiguredKilnHome(userHome), "skills") },
    { origin: "project" as const, dir: projectSkillsDirectory ?? resolvePrivateProjectSkillsDirectory(projectPath, userHome) },
  ];

  for (const { origin, dir } of roots) {
    for (const [directoryName, sourceDir] of discoverSkillDirsAt(dir)) {
      const skillName = readSkillDirectoryName(sourceDir) ?? directoryName;
      if (!isSafeProjectionPathComponent(skillName)) continue;
      const visibility = resolveSkillVisibility(skillName, skillConfig);
      if (visibility === "disabled") continue;
      resolveSkillProjectionCandidate(discovered, {
        skillName,
        visibility,
        origin,
        representation: "directory",
        sourceIdentity: `${origin}:${canonicalSkillKey(skillName)}`,
        sourceDir,
      });
    }
    for (const [fileName, sourceFile] of discoverFlatSkillFiles(dir)) {
      try {
        const skillName = loadSkillMdIndex(sourceFile).name;
        if (!isSafeProjectionPathComponent(skillName)) continue;
        const visibility = resolveSkillVisibility(skillName, skillConfig);
        if (visibility === "disabled") continue;
        resolveSkillProjectionCandidate(discovered, {
          skillName,
          visibility,
          origin,
          representation: "flat",
          sourceIdentity: `${origin}:${canonicalSkillKey(skillName)}`,
          files: [{ fileName, content: normalizeProjectedSkillFileContent(fileName, readFileSync(sourceFile)) }],
        });
      } catch {
        // Invalid flat skill files are outside the admitted projection set.
      }
    }
  }
  for (const skill of resolveKilnCoreBuiltinSkills(skillConfig?.builtin)) {
    if (!isSafeProjectionPathComponent(skill.name)) continue;
    const visibility = resolveSkillVisibility(skill.name, skillConfig);
    if (visibility === "disabled") continue;
    resolveSkillProjectionCandidate(discovered, {
      skillName: skill.name,
      visibility,
      origin: "builtin",
      representation: "builtin",
      sourceIdentity: `builtin:${canonicalSkillKey(skill.name)}`,
      files: [{ fileName: "SKILL.md", content: renderSkillMarkdown(skill) }],
    });
  }
  return discovered;
}

function resolveSkillProjectionCandidate(
  discovered: Map<string, SkillProjectionSource>,
  candidate: SkillProjectionSource,
): void {
  const key = canonicalSkillKey(candidate.skillName);
  const existing = discovered.get(key);
  if (!existing || isPreferredSkillProjectionCandidate(candidate, existing)) {
    discovered.set(key, candidate);
  }
}

function isPreferredSkillProjectionCandidate(
  candidate: SkillProjectionSource,
  existing: SkillProjectionSource,
): boolean {
  const originPrecedence = { builtin: 0, user: 1, project: 2 } as const;
  if (candidate.origin !== existing.origin) {
    return originPrecedence[candidate.origin] > originPrecedence[existing.origin];
  }
  // Within one origin, the canonical directory form is authoritative over a flat file.
  return candidate.representation === "directory" && existing.representation === "flat";
}

function discoverSkillDirsAt(root: string): readonly [string, string][] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((entry) => {
        const sourceDir = join(root, entry.name);
        return entry.isDirectory() && isCanonicalSkillDirectory(sourceDir, entry.name)
          ? [[entry.name, sourceDir] as [string, string]]
          : [];
      });
  } catch {
    return [];
  }
}

function discoverFlatSkillFiles(root: string): readonly [string, string][] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md")
        && isSafeProjectionPathComponent(entry.name)
        ? [[entry.name, join(root, entry.name)] as [string, string]]
        : []);
  } catch {
    return [];
  }
}

export function discoverOpenCodeDeniedSkillNames(
  projectPath: string,
  skillConfig?: KilnYamlSkillsConfig | null,
  userHome: string | undefined = undefined,
  projectSkillsDirectory?: string,
): readonly string[] {
  return [...discoverSkillProjectionSources(projectPath, skillConfig, userHome, projectSkillsDirectory).values()]
    .filter((source) => source.visibility === "explicit-only")
    .map((source) => source.skillName)
    .sort((left, right) => left.localeCompare(right));
}

function readSkillDirectoryName(sourceDir: string): string | undefined {
  try {
    const skillFile = readdirSync(sourceDir, { withFileTypes: true })
      .find((entry) => entry.isFile() && entry.name.toLowerCase() === "skill.md");
    return skillFile ? loadSkillMdIndex(join(sourceDir, skillFile.name)).name : undefined;
  } catch {
    return undefined;
  }
}

function resolvePrivateProjectSkillsDirectory(projectPath: string, userHome: string | undefined): string {
  const projectRoot = resolveProjectRoot({
    explicitPath: projectPath,
    ...(userHome ? { userHome } : {}),
  }).rootPath;
  return resolveProjectStateBinding(projectRoot, userHome ? { kilnHome: join(userHome, ".kiln") } : {}).skillsPath;
}

function resolveConfiguredKilnHome(userHome: string | undefined): string {
  return userHome ? join(userHome, ".kiln") : resolveKilnHomePath();
}

interface SkillFileSyncResult {
  readonly ok: boolean;
  readonly snapshot?: NativeProjectionTargetState;
  readonly error?: string;
  readonly outcome: ProjectionOutcome;
}

export async function syncNativeSkillProjections(
  projectPath: string,
  options: NativeSkillProjectionOptions = {},
): Promise<NativeSkillProjectionResult> {
  const errors: string[] = [];
  const outcomes: ProjectionOutcome[] = [];
  let synced = 0;
  const userHome = options.userHome;
  const harnessHome = userHome ?? os.homedir();
  const projectSkillsDirectory = options.projectSkillsDirectory
    ?? options.projectStateBinding?.skillsPath
    ?? resolvePrivateProjectSkillsDirectory(projectPath, userHome);
  const kilnDir = resolveGlobalNativeProjectionStateDir(userHome);
  let installState = readNativeProjectionInstallState(kilnDir);
  const skillSources = discoverSkillProjectionSources(projectPath, options.skillConfig, userHome, projectSkillsDirectory);

  const hasManagedSkillProjection = Object.keys(installState.targets)
    .some((targetId) => targetId.includes("-skill:"));
  if (skillSources.size === 0 && !hasManagedSkillProjection) {
    return { claude: true, codex: true, opencode: true, synced: 0, errors: [], outcomes };
  }

  const targets = NATIVE_SKILL_TARGETS.map((target) => ({
    key: target.target,
    name: target.displayName,
    dir: target.dir(harnessHome),
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

  for (const target of targets) {
    if (isNativeProjectionHarnessDisabled(options, target.key)) {
      const skippedSkills = [...skillSources.keys()];
      outcomes.push(...(skippedSkills.length > 0 ? skippedSkills : ["managed-skills"]).map((skillName) => ({
        targetId: `${target.key}-skill:${canonicalSkillKey(skillName)}`,
        path: skillName === "managed-skills" ? target.dir : join(target.dir, skillName),
        status: "skipped" as const,
        reason: `${target.name} harness is disabled`,
      })));
      continue;
    }
    try {
      if (!options.dryRun) mkdirSync(target.dir, { recursive: true });
    } catch (error) {
      setTargetFailed(target.key);
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${target.name} skills mkdir failed: ${reason}`);
      outcomes.push({ targetId: `${target.key}-skill-directory`, path: target.dir, status: "failed", reason });
      continue;
    }

    const targetSkillSources = new Map([...skillSources].filter(([, source]) =>
      !(target.key === "opencode" && source.visibility === "explicit-only")
    ));
    const pruneResult = pruneStaleSkillProjections({
      target,
      skillSources: targetSkillSources,
      kilnDir,
      installState,
      options,
    });
    installState = pruneResult.installState;
    outcomes.push(...pruneResult.outcomes);
    if (pruneResult.errors.length > 0) {
      setTargetFailed(target.key);
      errors.push(...pruneResult.errors);
    }

    for (const source of skillSources.values()) {
      const skillName = source.skillName;
      if (target.key === "opencode" && source.visibility === "explicit-only") {
        outcomes.push({
          targetId: `opencode-skill:${canonicalSkillKey(skillName)}`,
          path: join(target.dir, skillName),
          status: "skipped",
          reason: "explicit-only visibility is unsupported by the current OpenCode projection; projection fails closed",
        });
        continue;
      }
      if (!isSafeProjectionPathComponent(skillName)) {
        setTargetFailed(target.key);
        const reason = `unsafe skill path component: ${skillName}`;
        errors.push(`${target.name} skill "${skillName}" failed: ${reason}`);
        outcomes.push({
          targetId: `${target.key}-skill:${canonicalSkillKey(skillName)}`,
          path: target.dir,
          status: "blocked",
          reason,
        });
        continue;
      }
      const targetSkillDir = resolveProjectionPathWithin(target.dir, join(target.dir, skillName));
      if (!targetSkillDir) {
        setTargetFailed(target.key);
        const reason = `skill target escapes harness root: ${skillName}`;
        errors.push(`${target.name} skill "${skillName}" failed: ${reason}`);
        outcomes.push({
          targetId: `${target.key}-skill:${canonicalSkillKey(skillName)}`,
          path: join(target.dir, skillName),
          status: "blocked",
          reason,
        });
        continue;
      }

      try {
        if (!options.dryRun) mkdirSync(targetSkillDir, { recursive: true });
        const sourceFiles = renderSkillVisibility(
          target.key,
          source.visibility,
          source.files ?? readSkillSourceFiles(source.sourceDir),
        );
        let skillFailed = false;
        for (const sourceFile of sourceFiles) {
          if (!isSafeProjectionRelativePath(sourceFile.fileName)) {
            throw new Error(`unsafe skill resource path: ${sourceFile.fileName}`);
          }
          const targetFile = resolveProjectionPathWithin(target.dir, join(targetSkillDir, sourceFile.fileName));
          if (!targetFile) {
            throw new Error(`skill resource escapes harness root: ${sourceFile.fileName}`);
          }
          const fileResult = syncSkillFile({
            target,
            skillName,
            fileName: sourceFile.fileName,
            sourceIdentity: source.sourceIdentity,
            content: sourceFile.content,
            targetFile,
            kilnDir,
            installState,
            options,
          });
          outcomes.push(fileResult.outcome);
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
        const reason = error instanceof Error ? error.message : String(error);
        errors.push(
          `${target.name} skill "${skillName}" failed: ${reason}`,
        );
        outcomes.push({
          targetId: `${target.key}-skill:${canonicalSkillKey(skillName)}`,
          path: targetSkillDir,
          status: "failed",
          reason,
        });
      }
    }
  }

  if (!options.dryRun) writeNativeProjectionInstallState(kilnDir, installState);

  return { claude, codex, opencode, synced, errors, outcomes };
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
}): {
  readonly installState: NativeProjectionInstallState;
  readonly errors: readonly string[];
  readonly outcomes: readonly ProjectionOutcome[];
} {
  const prefix = `${input.target.key}-skill:`;
  const errors: string[] = [];
  const outcomes: ProjectionOutcome[] = [];
  const currentFilesBySkill = new Map<string, readonly string[]>();
  let installState = input.installState;

  for (const [targetId, state] of Object.entries(input.installState.targets)) {
    if (!targetId.startsWith(prefix)) continue;
    const relativeTarget = targetId.slice(prefix.length);
    const separator = relativeTarget.indexOf("/");
    if (separator <= 0) continue;
    const skillName = relativeTarget.slice(0, separator);
    const fileName = relativeTarget.slice(separator + 1);
    if (!isSafeProjectionPathComponent(skillName) || !isSafeProjectionRelativePath(fileName)
      || !resolveProjectionPathWithin(input.target.dir, state.filePath)) {
      const reason = "unsafe managed skill projection path";
      errors.push(`${input.target.name} stale skill "${skillName}" file "${fileName}" failed: ${reason}`);
      outcomes.push({ targetId, path: state.filePath, status: "blocked", reason });
      continue;
    }
    const source = input.skillSources.get(canonicalSkillKey(skillName));
    if (source) {
      let currentFiles = currentFilesBySkill.get(canonicalSkillKey(skillName));
      if (!currentFiles) {
        try {
          currentFiles = renderSkillVisibility(
            input.target.key,
            source.visibility,
            source.files ?? readSkillSourceFiles(source.sourceDir),
          )
            .map((file) => file.fileName);
          currentFilesBySkill.set(canonicalSkillKey(skillName), currentFiles);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          errors.push(
            `${input.target.name} skill "${skillName}" stale-file check failed: ${reason}`,
          );
          outcomes.push({ targetId, path: state.filePath, status: "failed", reason });
          continue;
        }
      }
      const canonicalTargetId = `${prefix}${canonicalSkillKey(skillName)}/${fileName}`;
      if (targetId !== canonicalTargetId && currentFiles.includes(fileName)) {
        if (!input.options.dryRun) installState = removeNativeProjectionTargetState(installState, targetId);
        outcomes.push({
          targetId,
          path: state.filePath,
          status: input.options.dryRun ? "planned" : "removed",
          reason: "remove stale case-only install-state entry",
        });
        continue;
      }
      if (currentFiles.includes(fileName)) continue;
      if (currentFiles.some((currentFile) => currentFile.toLowerCase() === fileName.toLowerCase())) {
        if (!input.options.dryRun) installState = removeNativeProjectionTargetState(installState, targetId);
        outcomes.push({
          targetId,
          path: state.filePath,
          status: input.options.dryRun ? "planned" : "removed",
          reason: "remove stale case-only install-state entry",
        });
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
            `${input.target.name} stale skill "${skillName}" file "${fileName}" failed: managed file drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
          );
          outcomes.push({
            targetId,
            path: state.filePath,
            status: "blocked",
            reason: `managed drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
          });
          continue;
        }
        if (input.options.dryRun) {
          outcomes.push({ targetId, path: state.filePath, status: "planned", reason: "remove stale managed skill file content" });
          continue;
        }
        backupNativeProjectionFile({ kilnDir: input.kilnDir, targetId, filePath: state.filePath });
        rmSync(state.filePath, { force: true });
      }
      if (input.options.dryRun) {
        outcomes.push({ targetId, path: state.filePath, status: "planned", reason: "remove stale install-state entry" });
        continue;
      }
      installState = removeNativeProjectionTargetState(installState, targetId);
      outcomes.push({ targetId, path: state.filePath, status: "removed" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(
        `${input.target.name} stale skill "${skillName}" file "${fileName}" failed: ${reason}`,
      );
      outcomes.push({ targetId, path: state.filePath, status: "failed", reason });
    }
  }

  return { installState, errors, outcomes };
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
      if (!isSafeProjectionPathComponent(entry.name)) {
        throw new Error(`unsafe skill resource path: ${entry.name}`);
      }
      const sourcePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        return readSkillSourceFilesRecursive(sourceRoot, sourcePath);
      }
      if (!entry.isFile()) {
        return [];
      }
      const fileName = relative(sourceRoot, sourcePath).split(sep).join("/");
      const content = readFileSync(sourcePath);
      return [{
        fileName,
        content: normalizeProjectedSkillFileContent(fileName, content),
      }];
    });
}

export function normalizeProjectedSkillFileContent(fileName: string, content: Uint8Array): Uint8Array {
  return fileName.toLowerCase() === "skill.md" && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
    ? content.subarray(3)
    : content;
}

function syncSkillFile(input: {
  readonly target: {
    readonly key: "claude" | "codex" | "opencode";
    readonly name: string;
    readonly dir: string;
  };
  readonly skillName: string;
  readonly fileName: string;
  readonly sourceIdentity: string;
  readonly content: string | Uint8Array;
  readonly targetFile: string;
  readonly kilnDir: string;
  readonly installState: NativeProjectionInstallState;
  readonly options: NativeSkillProjectionOptions;
}): SkillFileSyncResult {
  const targetId = `${input.target.key}-skill:${canonicalSkillKey(input.skillName)}/${input.fileName}`;
  const expectedIdentity = {
    targetId,
    filePath: input.targetFile,
    harness: input.target.key,
    sourceIdentity: `${input.sourceIdentity}/${input.fileName}`,
  } as const;
  try {
    if (existsSync(input.targetFile)) {
      const currentContent = readFileSync(input.targetFile);
      const historicalTarget = input.installState.targets[targetId];
      if (!historicalTarget) {
        if (Buffer.from(currentContent).equals(Buffer.from(input.content))) {
          return {
            ok: true,
            ...(input.options.dryRun ? {} : {
              snapshot: createNativeProjectionFileSnapshot({
                targetId,
                filePath: input.targetFile,
                content: currentContent,
                harness: expectedIdentity.harness,
                sourceIdentity: expectedIdentity.sourceIdentity,
              }),
            }),
            outcome: {
              targetId,
              path: input.targetFile,
              status: input.options.dryRun ? "planned" : "unchanged",
              reason: "adopted byte-identical unmanaged skill file",
            },
          };
        }
        if (!input.options.force) {
          const reason = "unmanaged skill file exists; rerun with force after review";
          return {
            ok: false,
            error: reason,
            outcome: { targetId, path: input.targetFile, status: "blocked", reason },
          };
        }
      }
      if (historicalTarget
        && !isFullyOwnedNativeProjectionFile(historicalTarget, expectedIdentity)
        && !input.options.force) {
        const reason = "managed projection identity mismatch";
        return {
          ok: false,
          error: reason,
          outcome: { targetId, path: input.targetFile, status: "blocked", reason },
        };
      }
      const drift = detectNativeProjectionFileDrift({
        targetId,
        state: input.installState,
        currentContent,
      });
      if (!drift && nativeProjectionFileMatchesDesired({
        target: input.installState.targets[targetId],
        currentContent,
        desiredContent: input.content,
        expected: expectedIdentity,
      })) {
        return {
          ok: true,
          outcome: {
            targetId,
            path: input.targetFile,
            status: "unchanged",
            reason: "managed skill file is current",
          },
        };
      }
      if (drift && nativeProjectionFileMatchesDesired({
        target: input.installState.targets[targetId],
        currentContent,
        desiredContent: input.content,
        expected: expectedIdentity,
      })) {
        if (input.options.dryRun) {
          return {
            ok: true,
            outcome: {
              targetId,
              path: input.targetFile,
              status: "unchanged",
              reason: "reconciled managed skill file snapshot",
            },
          };
        }
        return {
          ok: true,
          snapshot: createNativeProjectionFileSnapshot({
            targetId,
            filePath: input.targetFile,
            content: input.content,
            harness: expectedIdentity.harness,
            sourceIdentity: expectedIdentity.sourceIdentity,
          }),
          outcome: {
            targetId,
            path: input.targetFile,
            status: "unchanged",
            reason: "reconciled managed skill file snapshot",
          },
        };
      }
      if (drift && !input.options.force) {
        return {
          ok: false,
          error: `managed file drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
          outcome: {
            targetId,
            path: input.targetFile,
            status: "blocked",
            reason: `managed drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
          },
        };
      }
    }

    if (input.options.dryRun) {
      return {
        ok: true,
        outcome: { targetId, path: input.targetFile, status: "planned", reason: "write projected skill file content" },
      };
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
        harness: expectedIdentity.harness,
        sourceIdentity: expectedIdentity.sourceIdentity,
      }),
      outcome: { targetId, path: input.targetFile, status: "written" },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: reason,
      outcome: { targetId, path: input.targetFile, status: "failed", reason },
    };
  }
}
