import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import {
  KILN_CORE_BUILTIN_SKILLS,
  loadSkillMdIndex,
  renderSkillMarkdown,
  resolveKilnCoreBuiltinSkills,
  type SkillIndex,
} from "@kilnai/core";
import type {
  KilnSkillCatalogProjectionStatus,
  KilnSkillCatalogSnapshot,
  KilnSkillCatalogSnapshotEntry,
  KilnSkillOriginKind,
  KilnSkillProjectionTargetSnapshot,
} from "@kilnai/gateway-contracts";
import type { KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import {
  adoptLegacyNativeProjectionFile,
  detectNativeProjectionFileDrift,
  isFullyOwnedNativeProjectionFile,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
  nativeProjectionFileMatchesDesired,
  readNativeProjectionInstallState,
} from "./native-projection-state.js";
import { NATIVE_SKILL_TARGETS } from "./native-skill-targets.js";
import {
  canonicalSkillKey,
  isSafeProjectionPathComponent,
  isSafeProjectionRelativePath,
  resolveProjectionPathWithin,
} from "./native-projection-paths.js";

export interface ReadSkillCatalogStatusOptions {
  readonly projectPath: string;
  readonly userHome?: string;
  readonly skillConfig?: KilnYamlSkillsConfig | null;
}

interface SkillSourceEntry {
  readonly index: SkillIndex;
  readonly origin: KilnSkillOriginKind;
  readonly sourcePath: string;
}

export function readSkillCatalogStatus(
  options: ReadSkillCatalogStatusOptions,
): KilnSkillCatalogSnapshot {
  const userHome = options.userHome ?? homedir();
  const configured = discoverConfiguredSkills({
    projectPath: options.projectPath,
    userHome,
    skillConfig: options.skillConfig,
  });
  const configuredNames = new Set(configured.map((entry) => canonicalSkillKey(entry.index.name)));
  const installState = readNativeProjectionInstallState(join(options.projectPath, ".kiln"));
  const entries: KilnSkillCatalogSnapshotEntry[] = [
    ...configured.map((entry) => projectConfiguredSkill(entry, userHome, installState)),
    ...discoverUnmanagedNativeSkills(userHome, configuredNames),
  ];

  return {
    entries: entries.sort((left, right) =>
      left.name.localeCompare(right.name) || left.origin.localeCompare(right.origin)
    ),
  };
}

function discoverConfiguredSkills(input: {
  readonly projectPath: string;
  readonly userHome: string;
  readonly skillConfig?: KilnYamlSkillsConfig | null;
}): readonly SkillSourceEntry[] {
  const discovered = new Map<string, SkillSourceEntry>();
  addSkillDirectory(discovered, join(input.userHome, ".kiln", "skills"), "user");
  addSkillDirectory(discovered, join(input.projectPath, ".kiln", "skills"), "project");

  for (const skill of resolveKilnCoreBuiltinSkills(input.skillConfig?.builtin)) {
    if (!isSafeProjectionPathComponent(skill.name)) continue;
    const key = canonicalSkillKey(skill.name);
    if (!discovered.has(key)) {
      discovered.set(key, {
        index: skill,
        origin: "builtin",
        sourcePath: skill.filePath,
      });
    }
  }

  return [...discovered.values()];
}

function addSkillDirectory(
  discovered: Map<string, SkillSourceEntry>,
  dirPath: string,
  origin: "user" | "project",
): void {
  for (const skillPath of readSkillMarkdownPaths(dirPath)) {
    try {
      const index = loadSkillMdIndex(skillPath);
      if (!isSafeProjectionPathComponent(index.name)) continue;
      const skillDirectory = dirname(skillPath);
      if (skillDirectory !== dirPath
        && (!isSafeProjectionPathComponent(basename(skillDirectory))
          || canonicalSkillKey(basename(skillDirectory)) !== canonicalSkillKey(index.name))) {
        continue;
      }
      discovered.set(canonicalSkillKey(index.name), {
        index,
        origin,
        sourcePath: skillPath,
      });
    } catch {
      // Invalid skill files are outside the admitted catalog.
    }
  }
}

function readSkillMarkdownPaths(dirPath: string): readonly string[] {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((entry) => {
      if (entry.isDirectory()) {
        if (!isSafeProjectionPathComponent(entry.name)) return [];
        const skillMd = readDirectorySkillMarkdownPath(join(dirPath, entry.name));
        return skillMd ? [skillMd] : [];
      }
      return entry.name.toLowerCase().endsWith(".md") && isSafeProjectionPathComponent(entry.name)
        ? [join(dirPath, entry.name)]
        : [];
    });
  } catch {
    return [];
  }
}

function readDirectorySkillMarkdownPath(skillDir: string): string | undefined {
  try {
    const file = readdirSync(skillDir, { withFileTypes: true })
      .find((entry) => entry.isFile() && entry.name.toLowerCase() === "skill.md");
    return file ? join(skillDir, file.name) : undefined;
  } catch {
    return undefined;
  }
}

function projectConfiguredSkill(
  source: SkillSourceEntry,
  userHome: string,
  installState: NativeProjectionInstallState,
): KilnSkillCatalogSnapshotEntry {
  const isBuiltin = source.origin === "builtin"
    || KILN_CORE_BUILTIN_SKILLS.some((skill) => skill.name === source.index.name);
  return {
    name: source.index.name,
    description: source.index.description,
    origin: source.origin,
    configured: true,
    builtIn: isBuiltin,
    sourcePath: source.sourcePath,
    tools: source.index.tools,
    tags: source.index.tags,
    projections: NATIVE_SKILL_TARGETS.map((target) =>
      readConfiguredProjectionStatus(
        target.target,
        target.displayName,
        target.dir(userHome),
        source,
        installState,
      )
    ),
    admission: {
      state: "available",
      reason: "Configured Kiln skill. Admission still depends on explicit request, agent profile defaults, or auto skill selection.",
    },
  };
}

function readConfiguredProjectionStatus(
  target: KilnSkillProjectionTargetSnapshot["target"],
  displayName: string,
  targetRoot: string,
  source: SkillSourceEntry,
  installState: NativeProjectionInstallState,
): KilnSkillProjectionTargetSnapshot {
  const skillName = source.index.name;
  const fileNames = projectionFileNames(source);
  const primaryFileName = fileNames.find((fileName) => fileName.toLowerCase() === "skill.md") ?? fileNames[0] ?? "SKILL.md";
  const statuses = fileNames.map((fileName) => {
    if (!isSafeProjectionPathComponent(skillName) || !isSafeProjectionRelativePath(fileName)) {
      return "missing" as const;
    }
    const path = resolveProjectionPathWithin(targetRoot, join(targetRoot, skillName, fileName));
    const targetId = `${target}-skill:${canonicalSkillKey(skillName)}/${fileName}`;
    if (!path) return "missing" as const;
    const targetState = findSkillProjectionState(installState, targetId);
    return readProjectionStatus(
      targetId,
      path,
      targetState ? { version: 1, targets: { [targetId]: targetState } } : installState,
      targetState !== undefined,
      canonicalSkillProjectionContent(source, fileName),
      {
        targetId,
        filePath: path,
        harness: target,
        sourceIdentity: `${source.origin}:${canonicalSkillKey(skillName)}/${fileName}`,
      },
      targetRoot,
    );
  });
  return {
    target,
    displayName,
    path: resolveProjectionPathWithin(targetRoot, join(targetRoot, skillName, primaryFileName))
      ?? join(targetRoot, skillName, primaryFileName),
    status: aggregateProjectionStatus(statuses),
  };
}

function canonicalSkillProjectionContent(
  source: SkillSourceEntry,
  fileName: string,
): string | Uint8Array | undefined {
  if (source.origin === "builtin") {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === source.index.name);
    return skill ? renderSkillMarkdown(skill) : undefined;
  }

  const sourcePath = canonicalSkillKey(basename(dirname(source.index.filePath))) === canonicalSkillKey(source.index.name)
    ? join(dirname(source.index.filePath), fileName)
    : fileName === basename(source.index.filePath)
      ? source.index.filePath
      : undefined;
  if (!sourcePath) return undefined;
  try {
    return readFileSync(sourcePath);
  } catch {
    return undefined;
  }
}

function projectionFileNames(source: SkillSourceEntry): readonly string[] {
  if (source.origin === "builtin") {
    return ["SKILL.md"];
  }
  if (!source.index.filePath) {
    return ["SKILL.md"];
  }
  if (canonicalSkillKey(basename(dirname(source.index.filePath))) !== canonicalSkillKey(source.index.name)) {
    return [basename(source.index.filePath)];
  }
  try {
    const sourceDir = dirname(source.index.filePath);
    return readSkillProjectionFileNames(sourceDir, sourceDir);
  } catch {
    return [basename(source.index.filePath)];
  }
}

function readSkillProjectionFileNames(sourceRoot: string, currentDir: string): readonly string[] {
  return readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (!isSafeProjectionPathComponent(entry.name)) return [];
      const sourcePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        return readSkillProjectionFileNames(sourceRoot, sourcePath);
      }
      return entry.isFile()
        ? [relative(sourceRoot, sourcePath).split(sep).join("/")]
        : [];
    });
}

function aggregateProjectionStatus(
  statuses: readonly KilnSkillCatalogProjectionStatus[],
): KilnSkillCatalogProjectionStatus {
  if (statuses.includes("drifted")) return "drifted";
  if (statuses.includes("unmanaged-native")) return "unmanaged-native";
  if (statuses.includes("missing")) return "missing";
  return "projected";
}

function readProjectionStatus(
  targetId: string,
  path: string,
  installState: NativeProjectionInstallState,
  managed: boolean,
  desiredContent?: string | Uint8Array,
  expected?: {
    readonly targetId: string;
    readonly filePath: string;
    readonly harness: "claude" | "codex" | "opencode";
    readonly sourceIdentity: string;
  },
  harnessRoot?: string,
): KilnSkillCatalogProjectionStatus {
  if (!existsSync(path)) {
    return "missing";
  }
  if (!managed) {
    return "unmanaged-native";
  }
  const currentContent = readFileSync(path);
  if (desiredContent !== undefined && expected
    && !isFullyOwnedNativeProjectionFile(installState.targets[targetId], expected)) {
    const adopted = harnessRoot
      ? adoptLegacyNativeProjectionFile({
        target: installState.targets[targetId],
        currentContent,
        expected,
        harnessRoot,
      })
      : undefined;
    if (adopted && nativeProjectionFileMatchesDesired({
      target: adopted,
      currentContent,
      desiredContent,
      expected,
    })) {
      return "projected";
    }
    return "drifted";
  }
  if (desiredContent !== undefined && nativeProjectionFileMatchesDesired({
    target: installState.targets[targetId],
    currentContent,
    desiredContent,
    expected,
  })) {
    return "projected";
  }
  const drift = detectNativeProjectionFileDrift({
    targetId,
    state: installState,
    currentContent,
  });
  return drift ? "drifted" : "projected";
}

function findSkillProjectionState(
  installState: NativeProjectionInstallState,
  targetId: string,
): NativeProjectionTargetState | undefined {
  const exact = installState.targets[targetId];
  if (exact) return exact;
  const marker = targetId.indexOf("-skill:");
  if (marker < 0) return undefined;
  const prefix = targetId.slice(0, marker + "-skill:".length);
  const suffix = targetId.slice(prefix.length);
  const separator = suffix.indexOf("/");
  if (separator <= 0) return undefined;
  const canonicalSkill = canonicalSkillKey(suffix.slice(0, separator));
  const fileName = suffix.slice(separator + 1);
  return Object.entries(installState.targets).find(([candidateId]) => {
    if (!candidateId.startsWith(prefix)) return false;
    const candidateSuffix = candidateId.slice(prefix.length);
    const candidateSeparator = candidateSuffix.indexOf("/");
    return candidateSeparator > 0
      && canonicalSkillKey(candidateSuffix.slice(0, candidateSeparator)) === canonicalSkill
      && candidateSuffix.slice(candidateSeparator + 1) === fileName;
  })?.[1];
}

function discoverUnmanagedNativeSkills(
  userHome: string,
  configuredNames: ReadonlySet<string>,
): readonly KilnSkillCatalogSnapshotEntry[] {
  const entries: KilnSkillCatalogSnapshotEntry[] = [];
  const seen = new Set<string>();
  for (const target of NATIVE_SKILL_TARGETS) {
    const targetRoot = target.dir(userHome);
    for (const name of readNativeSkillNames(targetRoot)) {
      if (!isSafeProjectionPathComponent(name)) continue;
      if (configuredNames.has(canonicalSkillKey(name))) {
        continue;
      }
      const key = `${target.target}:${name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({
        name,
        description: "Native harness-local skill outside the Kiln registry.",
        origin: "native-harness",
        configured: false,
        builtIn: false,
        sourcePath: join(targetRoot, name, "SKILL.md"),
        projections: [{
          target: target.target,
          displayName: target.displayName,
          path: join(targetRoot, name, "SKILL.md"),
          status: "unmanaged-native",
        }],
        admission: {
          state: "unavailable",
          reason: "Harness-local skill is not configured in Kiln, not governed, and not admitted into managed invocation context.",
        },
        omissionReason: "native-harness-local-only",
      });
    }
  }
  return entries;
}

function readNativeSkillNames(targetRoot: string): readonly string[] {
  try {
    return readdirSync(targetRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()
        && isSafeProjectionPathComponent(entry.name)
        && readDirectorySkillMarkdownPath(join(targetRoot, entry.name)))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
