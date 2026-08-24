import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { loadSkillMdIndex, resolveKilnCoreBuiltinSkills } from "@kilnai/core";
import type { KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import { NATIVE_SKILL_TARGETS } from "./native-skill-targets.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../application/project-state-root.js";
import { resolveKilnHomePath } from "./global-config/path.js";

export interface AdoptNativeHarnessSkillsOptions {
  readonly projectPath: string;
  readonly userHome?: string;
  readonly skillConfig?: KilnYamlSkillsConfig | null;
  /** Explicit private project skills directory supplied by composition. */
  readonly projectSkillsDirectory?: string;
  /** Already-established private project binding. */
  readonly projectStateBinding?: ProjectStateBinding;
}

export interface AdoptNativeHarnessSkillsResult {
  readonly adopted: readonly string[];
  readonly skipped: readonly string[];
  readonly errors: readonly string[];
}

interface NativeSkillCandidate {
  readonly name: string;
  readonly sourcePath: string;
  readonly contentHash: string;
}

export function adoptNativeHarnessSkills(
  options: AdoptNativeHarnessSkillsOptions,
): AdoptNativeHarnessSkillsResult {
  const userHome = options.userHome;
  const harnessHome = userHome ?? homedir();
  const projectSkillsDirectory = options.projectSkillsDirectory
    ?? options.projectStateBinding?.skillsPath
    ?? resolvePrivateProjectSkillsDirectory(options.projectPath, userHome);
  const configuredNames = readConfiguredSkillNames(projectSkillsDirectory, userHome, options.skillConfig);
  const candidatesByName = new Map<string, NativeSkillCandidate[]>();

  for (const target of NATIVE_SKILL_TARGETS) {
    for (const candidate of discoverNativeSkillCandidates(target.dir(harnessHome))) {
      if (configuredNames.has(candidate.name)) {
        continue;
      }
      const candidates = candidatesByName.get(candidate.name) ?? [];
      candidates.push(candidate);
      candidatesByName.set(candidate.name, candidates);
    }
  }

  const adopted: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const destinationRoot = join(resolveConfiguredKilnHome(userHome), "skills");
  const adoptable: NativeSkillCandidate[] = [];

  for (const [name, candidates] of [...candidatesByName.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const hashes = new Set(candidates.map((candidate) => candidate.contentHash));
    if (hashes.size > 1) {
      skipped.push(name);
      errors.push(`native skill "${name}" has conflicting content across harnesses; adoption requires manual reconciliation`);
      continue;
    }

    const destination = join(destinationRoot, name);
    if (existsSync(destination)) {
      skipped.push(name);
      errors.push(`user skill destination already exists for "${name}" but is not admitted; fix or remove ${destination}`);
      continue;
    }

    adoptable.push(candidates[0]!);
  }

  if (errors.length > 0) {
    return { adopted, skipped, errors };
  }

  mkdirSync(destinationRoot, { recursive: true });
  const stagingRoot = mkdtempSync(join(destinationRoot, ".native-adoption-"));
  try {
    for (const candidate of adoptable) {
      cpSync(candidate.sourcePath, join(stagingRoot, candidate.name), { recursive: true, errorOnExist: true });
    }
    for (const candidate of adoptable) {
      renameSync(join(stagingRoot, candidate.name), join(destinationRoot, candidate.name));
      adopted.push(candidate.name);
    }
  } catch (error) {
    for (const name of adopted) {
      rmSync(join(destinationRoot, name), { recursive: true, force: true });
    }
    adopted.length = 0;
    errors.push(`native skill adoption failed atomically: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }

  return { adopted, skipped, errors };
}

function readConfiguredSkillNames(
  projectSkillsDirectory: string,
  userHome: string | undefined,
  skillConfig?: KilnYamlSkillsConfig | null,
): ReadonlySet<string> {
  const names = new Set<string>();
  addSkillNames(names, join(resolveConfiguredKilnHome(userHome), "skills"));
  addSkillNames(names, projectSkillsDirectory);
  for (const skill of resolveKilnCoreBuiltinSkills(skillConfig?.builtin)) {
    names.add(skill.name);
  }
  return names;
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

function addSkillNames(names: Set<string>, root: string): void {
  for (const candidate of discoverNativeSkillCandidates(root)) {
    names.add(candidate.name);
  }
}

function discoverNativeSkillCandidates(root: string): readonly NativeSkillCandidate[] {
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory()) {
        return [];
      }
      const sourcePath = join(root, entry.name);
      const skillPath = readDirectorySkillMarkdownPath(sourcePath);
      if (!skillPath) {
        return [];
      }
      try {
        const index = loadSkillMdIndex(skillPath);
        if (!isSafeSkillName(index.name) || index.name !== entry.name) {
          return [];
        }
        return [{ name: index.name, sourcePath, contentHash: hashDirectory(sourcePath) }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function isSafeSkillName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(name);
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

function hashDirectory(root: string): string {
  const hash = createHash("sha256");
  for (const filePath of readFilesRecursive(root).sort((left, right) => left.localeCompare(right))) {
    hash.update(relative(root, filePath).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readFilesRecursive(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...readFilesRecursive(path));
      continue;
    }
    if (entry.isFile() || statSync(path).isFile()) {
      files.push(path);
    }
  }
  return files;
}
