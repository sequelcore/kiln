import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import {
  KILN_CORE_BUILTIN_SKILLS,
  loadSkillMdIndex,
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
  detectNativeProjectionFileDrift,
  readNativeProjectionInstallState,
  type NativeProjectionInstallState,
} from "./native-projection-state.js";
import { NATIVE_SKILL_TARGETS } from "./native-skill-targets.js";

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
  const configuredNames = new Set(configured.map((entry) => entry.index.name));
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
    if (!discovered.has(skill.name)) {
      discovered.set(skill.name, {
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
      const skillDirectory = dirname(skillPath);
      if (skillDirectory !== dirPath && basename(skillDirectory) !== index.name) {
        continue;
      }
      discovered.set(index.name, {
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
    return readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) {
        const skillMd = readDirectorySkillMarkdownPath(join(dirPath, entry.name));
        return skillMd ? [skillMd] : [];
      }
      return entry.name.endsWith(".md") ? [join(dirPath, entry.name)] : [];
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
        source.index.name,
        projectionFileNames(source),
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
  skillName: string,
  fileNames: readonly string[],
  installState: NativeProjectionInstallState,
): KilnSkillProjectionTargetSnapshot {
  const primaryFileName = fileNames.find((fileName) => fileName.toLowerCase() === "skill.md") ?? fileNames[0] ?? "SKILL.md";
  const statuses = fileNames.map((fileName) => {
    const path = join(targetRoot, skillName, fileName);
    const targetId = `${target}-skill:${skillName}/${fileName}`;
    return readProjectionStatus(targetId, path, installState, installState.targets[targetId] !== undefined);
  });
  return {
    target,
    displayName,
    path: join(targetRoot, skillName, primaryFileName),
    status: aggregateProjectionStatus(statuses),
  };
}

function projectionFileNames(source: SkillSourceEntry): readonly string[] {
  if (source.origin === "builtin") {
    return ["SKILL.md"];
  }
  if (!source.index.filePath) {
    return ["SKILL.md"];
  }
  if (basename(dirname(source.index.filePath)) !== source.index.name) {
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
): KilnSkillCatalogProjectionStatus {
  if (!existsSync(path)) {
    return "missing";
  }
  if (!managed) {
    return "unmanaged-native";
  }
  const drift = detectNativeProjectionFileDrift({
    targetId,
    state: installState,
    currentContent: readFileSync(path),
  });
  return drift ? "drifted" : "projected";
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
      if (configuredNames.has(name)) {
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
      .filter((entry) => entry.isDirectory() && readDirectorySkillMarkdownPath(join(targetRoot, entry.name)))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
