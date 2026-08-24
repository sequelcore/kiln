import {
  cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { KilnAppConfig } from "../config.js";
import { digestSkillPackage, inspectSkillPackage, loadSkillMd, loadSkillMdIndex } from "@kilnai/core";
import { formatSkillList } from "../formatters.js";
import { loadKilnConfig } from "../config/config-merger.js";
import { createConfiguredSkillRegistry } from "../config/skill-registry.js";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "../application/private-project-state-filesystem.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../application/project-state-root.js";

interface SkillInstallState {
  readonly version: 1;
  readonly packages: Readonly<Record<string, {
    readonly sourcePath: string;
    readonly packageDigest: string;
    readonly installedAt: string;
  }>>;
}

interface SkillCommandContext {
  readonly projectPath: string;
  readonly projectStateBinding: ProjectStateBinding;
}

export async function skillCommand(config: KilnAppConfig, subcommand: string, args: readonly string[]): Promise<void> {
  const projectPath = resolveProjectRoot({ cwd: process.cwd() }).rootPath;
  const projectStateBinding = resolveProjectStateBinding(projectPath);
  const context: SkillCommandContext = { projectPath, projectStateBinding };
  switch (subcommand) {
    case "list": return listSkills(config, context);
    case "install": return installSkill(args[0], context);
    case "update": return updateSkill(args[0], args.slice(1).find((arg) => arg !== "--force"), args.includes("--force"), context);
    case "remove": return removeSkill(args[0], args.includes("--force"), context);
    case "publish": return publishSkill(config, context);
    default:
      console.log("Usage: kiln skill <list|install|update|remove|publish>");
      console.log("");
      console.log("Subcommands:");
      console.log("  list                       List all available skills");
      console.log("  install <path>             Install a complete local skill package");
      console.log("  update <name> [path]       Replace an owned package after drift checks");
      console.log("  remove <name> [--force]    Remove an owned package with recoverable backup");
      console.log("  publish                    Validate SKILL.md for publishing");
  }
}

async function listSkills(_config: KilnAppConfig, context: SkillCommandContext): Promise<void> {
  const kilnYaml = await loadKilnConfig(context.projectPath, { projectStateBinding: context.projectStateBinding });
  console.log(formatSkillList(createConfiguredSkillRegistry({
    projectPath: context.projectPath,
    projectStateBinding: context.projectStateBinding,
    skillConfig: kilnYaml?.skills,
  }).all()));
}

function installSkill(packagePath: string | undefined, context: SkillCommandContext): void {
  if (!packagePath) return fail("Usage: kiln skill install <path-to-skill-package>");
  const state = readState(context.projectStateBinding);
  if (!state) return;
  const prepared = prepareSource(packagePath, context);
  if (!prepared) return;
  const destination = skillDestination(prepared.name, context.projectStateBinding);
  if (existsSync(destination)) {
    cleanupPrepared(prepared, context.projectStateBinding);
    return fail(`Skill "${prepared.name}" already exists; use kiln skill update after reviewing the package diff.`);
  }
  try {
    applyPackage(prepared.root, destination, prepared.digest, context.projectStateBinding);
    try {
      writeState(context.projectStateBinding, { version: 1, packages: { ...state.packages, [prepared.name]: ownership(prepared) } });
    } catch (error) {
      removePrivateDirectory(context.projectStateBinding, destination);
      throw error;
    }
    console.log(`Installed skill package "${prepared.name}" to ${destination} (${prepared.digest}).`);
  } finally { cleanupPrepared(prepared, context.projectStateBinding); }
}

function updateSkill(name: string | undefined, packagePath: string | undefined, force: boolean, context: SkillCommandContext): void {
  if (!name) return fail("Usage: kiln skill update <name> [path] [--force]");
  if (!isPortableSkillName(name)) return fail(`Invalid skill name "${name}".`);
  const state = readState(context.projectStateBinding); if (!state) return; const owned = state.packages[name];
  if (!owned) return fail(`Skill "${name}" is not owned by the governed package lifecycle.`);
  const destination = skillDestination(name, context.projectStateBinding);
  if (!existsSync(destination)) return fail(`Owned skill "${name}" is missing from ${destination}.`);
  const currentDigest = packageDigest(destination);
  if (currentDigest !== owned.packageDigest && !force) return fail(`Skill "${name}" has local modifications; review them or rerun update with --force.`);
  const prepared = prepareSource(packagePath ?? owned.sourcePath, context);
  if (!prepared) return;
  if (prepared.name !== name) {
    cleanupPrepared(prepared, context.projectStateBinding);
    return fail(`Update source declares skill "${prepared.name}", expected "${name}".`);
  }
  try {
    backupPackage(name, destination, context.projectStateBinding);
    const previous = replacePackage(prepared.root, destination, prepared.digest, context.projectStateBinding);
    try {
      writeState(context.projectStateBinding, { version: 1, packages: { ...state.packages, [name]: ownership(prepared) } });
    } catch (error) {
      removePrivateDirectory(context.projectStateBinding, destination);
      assertPrivateStateFileTargetSync(context.projectStateBinding.projectStateRoot, destination);
      ensurePrivateStateDirectorySync(context.projectStateBinding.projectStateRoot, previous);
      renameSync(previous, destination);
      throw error;
    }
    try { removePrivateDirectory(context.projectStateBinding, previous); }
    catch { console.warn(`Updated skill package "${name}", but obsolete staging cleanup remains at ${previous}.`); }
    console.log(`Updated skill package "${name}" (${prepared.digest}).`);
  } finally { cleanupPrepared(prepared, context.projectStateBinding); }
}

function removeSkill(name: string | undefined, force: boolean, context: SkillCommandContext): void {
  if (!name) return fail("Usage: kiln skill remove <name> [--force]");
  if (!isPortableSkillName(name)) return fail(`Invalid skill name "${name}".`);
  const state = readState(context.projectStateBinding); if (!state) return; const owned = state.packages[name];
  if (!owned) return fail(`Skill "${name}" is not owned by the governed package lifecycle.`);
  const destination = skillDestination(name, context.projectStateBinding);
  let pendingRemoval: string | undefined;
  if (existsSync(destination)) {
    const currentDigest = packageDigest(destination);
    if (currentDigest !== owned.packageDigest && !force) return fail(`Skill "${name}" has local modifications; removal requires --force after review.`);
    backupPackage(name, destination, context.projectStateBinding);
    pendingRemoval = `${destination}.removing-${process.pid}-${Date.now()}`;
    ensurePrivateStateDirectorySync(context.projectStateBinding.projectStateRoot, destination);
    assertPrivateStateFileTargetSync(context.projectStateBinding.projectStateRoot, pendingRemoval);
    renameSync(destination, pendingRemoval);
  }
  const packages = { ...state.packages }; delete packages[name];
  try { writeState(context.projectStateBinding, { version: 1, packages }); }
  catch (error) {
    if (pendingRemoval) {
      ensurePrivateStateDirectorySync(context.projectStateBinding.projectStateRoot, pendingRemoval);
      assertPrivateStateFileTargetSync(context.projectStateBinding.projectStateRoot, destination);
      renameSync(pendingRemoval, destination);
    }
    throw error;
  }
  if (pendingRemoval) removePrivateDirectory(context.projectStateBinding, pendingRemoval);
  console.log(`Removed skill package "${name}". A recoverable backup is retained under ${backupRoot(name, context.projectStateBinding)}.`);
}

function prepareSource(inputPath: string, context: SkillCommandContext): { name: string; root: string; sourcePath: string; digest: string; temporary: boolean } | undefined {
  const sourcePath = resolve(inputPath);
  if (!existsSync(sourcePath)) return fail(`Not found: ${sourcePath}`);
  const stat = lstatSync(sourcePath);
  const skillFile = stat.isDirectory() ? join(sourcePath, "SKILL.md") : sourcePath;
  if (!stat.isDirectory() && !sourcePath.toLowerCase().endsWith(".md")) return fail("Skill source must be a package directory or SKILL.md file.");
  if (!existsSync(skillFile)) return fail(`No SKILL.md found at ${skillFile}.`);
  let name: string;
  try { name = loadSkillMdIndex(skillFile).name; } catch (error) { return fail(`Invalid SKILL.md: ${error instanceof Error ? error.message : String(error)}`); }
  let root = stat.isDirectory() ? sourcePath : "";
  if (!stat.isDirectory()) {
    ensurePrivateStateDirectorySync(context.projectStateBinding.projectStateRoot, context.projectStateBinding.tmpPath);
    root = mkdtempSync(join(context.projectStateBinding.tmpPath, "skill-stage-"));
    ensurePrivateStateDirectorySync(context.projectStateBinding.projectStateRoot, root);
    assertPrivateStateFileTargetSync(context.projectStateBinding.projectStateRoot, join(root, "SKILL.md"));
    cpSync(sourcePath, join(root, "SKILL.md"));
  }
  const health = inspectSkillPackage(root);
  if (health.status === "blocked") {
    if (!stat.isDirectory()) removePrivateDirectory(context.projectStateBinding, root);
    return fail(`Skill package "${name}" is blocked: ${[...health.diagnostics.map((entry) => entry.code), ...health.brokenResources.map((entry) => `${entry.reason}:${entry.target}`)].join(", ")}`);
  }
  return { name, root, sourcePath, digest: packageDigest(root), temporary: !stat.isDirectory() };
}

function applyPackage(source: string, destination: string, expectedDigest: string, binding: ProjectStateBinding): void {
  const projectStateRoot = binding.projectStateRoot;
  ensurePrivateStateDirectorySync(projectStateRoot, dirname(destination));
  const stage = mkdtempSync(join(dirname(destination), ".skill-install-"));
  ensurePrivateStateDirectorySync(projectStateRoot, stage);
  assertPrivateStateFileTargetSync(projectStateRoot, destination);
  try {
    cpSync(source, stage, { recursive: true });
    if (packageDigest(stage) !== expectedDigest) throw new Error("Staged skill package digest does not match the validated source.");
    ensurePrivateStateDirectorySync(projectStateRoot, stage);
    assertPrivateStateFileTargetSync(projectStateRoot, destination);
    renameSync(stage, destination);
  }
  catch (error) {
    removePrivateDirectory(binding, stage);
    throw error;
  }
}

function replacePackage(source: string, destination: string, expectedDigest: string, binding: ProjectStateBinding): string {
  const parent = dirname(destination);
  const projectStateRoot = binding.projectStateRoot;
  ensurePrivateStateDirectorySync(projectStateRoot, parent);
  const stage = mkdtempSync(join(parent, ".skill-update-"));
  const previous = `${destination}.previous-${process.pid}-${Date.now()}`;
  ensurePrivateStateDirectorySync(projectStateRoot, stage);
  ensurePrivateStateDirectorySync(projectStateRoot, destination);
  assertPrivateStateFileTargetSync(projectStateRoot, previous);
  try {
    cpSync(source, stage, { recursive: true });
    if (packageDigest(stage) !== expectedDigest) throw new Error("Staged skill package digest does not match the validated source.");
    ensurePrivateStateDirectorySync(projectStateRoot, stage);
    ensurePrivateStateDirectorySync(projectStateRoot, destination);
    assertPrivateStateFileTargetSync(projectStateRoot, previous);
    renameSync(destination, previous);
    try {
      ensurePrivateStateDirectorySync(projectStateRoot, stage);
      assertPrivateStateFileTargetSync(projectStateRoot, destination);
      renameSync(stage, destination);
    }
    catch (error) {
      ensurePrivateStateDirectorySync(projectStateRoot, previous);
      assertPrivateStateFileTargetSync(projectStateRoot, destination);
      renameSync(previous, destination);
      throw error;
    }
    return previous;
  } catch (error) {
    removePrivateDirectory(binding, stage);
    if (privatePathExists(previous) && !privatePathExists(destination)) {
      ensurePrivateStateDirectorySync(projectStateRoot, previous);
      assertPrivateStateFileTargetSync(projectStateRoot, destination);
      renameSync(previous, destination);
    }
    throw error;
  }
}

function cleanupPrepared(
  prepared: { readonly root: string; readonly temporary: boolean },
  binding: ProjectStateBinding,
): void {
  if (prepared.temporary) removePrivateDirectory(binding, prepared.root);
}

function packageDigest(root: string): string {
  const files: { path: string; content: Uint8Array }[] = [];
  const walk = (path: string, prefix = ""): void => {
    for (const entry of requireDirectory(path)) {
      const child = join(path, entry.name); const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Skill package contains unsupported symbolic link: ${relativePath}`);
      if (entry.isDirectory()) walk(child, relativePath);
      else if (entry.isFile()) files.push({ path: relativePath, content: readFileSync(child) });
    }
  };
  walk(root); return digestSkillPackage(files);
}

function requireDirectory(path: string) { return readdirSync(path, { withFileTypes: true }); }

function backupPackage(name: string, source: string, binding: ProjectStateBinding): void {
  const root = backupRoot(name, binding);
  ensurePrivateStateDirectorySync(binding.projectStateRoot, root);
  const target = join(root, new Date().toISOString().replace(/[:.]/g, "-"));
  assertPrivateStateFileTargetSync(binding.projectStateRoot, target);
  cpSync(source, target, { recursive: true });
}

function statePath(binding: ProjectStateBinding): string { return join(binding.projectStateRoot, "skill-install-state.json"); }
function readState(binding: ProjectStateBinding): SkillInstallState | undefined {
  const path = statePath(binding);
  if (!existsSync(path)) return { version: 1, packages: {} };
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!validState(state)) return fail("Skill install state is invalid; refusing lifecycle mutation.");
    return state;
  } catch { return fail("Skill install state is unreadable; refusing lifecycle mutation."); }
}
function writeState(binding: ProjectStateBinding, state: SkillInstallState): void {
  const target = statePath(binding); const parent = dirname(target);
  ensurePrivateStateDirectorySync(binding.projectStateRoot, parent);
  const stage = `${target}.writing-${process.pid}-${Date.now()}`;
  const previous = `${target}.previous-${process.pid}-${Date.now()}`;
  assertPrivateStateFileTargetSync(binding.projectStateRoot, target);
  assertPrivateStateFileTargetSync(binding.projectStateRoot, stage);
  assertPrivateStateFileTargetSync(binding.projectStateRoot, previous);
  writeFileSync(stage, JSON.stringify(state, null, 2) + "\n", "utf8");
  try {
    if (existsSync(target)) {
      assertPrivateStateFileTargetSync(binding.projectStateRoot, target);
      assertPrivateStateFileTargetSync(binding.projectStateRoot, previous);
      renameSync(target, previous);
    }
    try {
      assertPrivateStateFileTargetSync(binding.projectStateRoot, stage);
      assertPrivateStateFileTargetSync(binding.projectStateRoot, target);
      renameSync(stage, target);
    }
    catch (error) {
      if (existsSync(previous)) {
        assertPrivateStateFileTargetSync(binding.projectStateRoot, previous);
        assertPrivateStateFileTargetSync(binding.projectStateRoot, target);
        renameSync(previous, target);
      }
      throw error;
    }
  } catch (error) {
    if (existsSync(stage)) {
      assertPrivateStateFileTargetSync(binding.projectStateRoot, stage);
      rmSync(stage, { force: true });
    }
    throw error;
  }
  if (existsSync(previous)) {
    try {
      assertPrivateStateFileTargetSync(binding.projectStateRoot, previous);
      rmSync(previous, { force: true });
    }
    catch { console.warn(`Skill ownership state committed, but obsolete state cleanup remains at ${previous}.`); }
  }
}

function ownership(prepared: { readonly sourcePath: string; readonly digest: string }): SkillInstallState["packages"][string] {
  return { sourcePath: prepared.sourcePath, packageDigest: prepared.digest, installedAt: new Date().toISOString() };
}

function validState(value: unknown): value is SkillInstallState {
  if (typeof value !== "object" || value === null || (value as { version?: unknown }).version !== 1) return false;
  const packages = (value as { packages?: unknown }).packages;
  if (typeof packages !== "object" || packages === null || Array.isArray(packages)) return false;
  return Object.entries(packages).every(([name, entry]) => {
    if (!isPortableSkillName(name) || typeof entry !== "object" || entry === null) return false;
    const record = entry as Record<string, unknown>;
    return typeof record.sourcePath === "string" && resolve(record.sourcePath) === record.sourcePath
      && typeof record.packageDigest === "string" && /^sha256:[a-f0-9]{64}$/.test(record.packageDigest)
      && typeof record.installedAt === "string" && !Number.isNaN(Date.parse(record.installedAt));
  });
}

function isPortableSkillName(name: string): boolean { return name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name); }
function skillDestination(name: string, binding: ProjectStateBinding): string { return directChild(binding.skillsPath, name); }
function backupRoot(name: string, binding: ProjectStateBinding): string { return directChild(join(binding.backupsPath, "skills"), name); }
function directChild(root: string, name: string): string {
  if (!isPortableSkillName(name)) throw new Error(`Invalid portable skill name: ${name}`);
  const absoluteRoot = resolve(root); const child = resolve(absoluteRoot, name);
  if (dirname(child) !== absoluteRoot) throw new Error(`Skill path escapes governed root: ${name}`);
  return child;
}

function removePrivateDirectory(binding: ProjectStateBinding, path: string): void {
  ensurePrivateStateDirectorySync(binding.projectStateRoot, dirname(path));
  if (!privatePathExists(path)) return;
  ensurePrivateStateDirectorySync(binding.projectStateRoot, path);
  rmSync(path, { recursive: true, force: true });
}

function privatePathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function publishSkill(_config: KilnAppConfig, context: SkillCommandContext): void {
  const filePath = join(context.projectPath, "SKILL.md");
  if (!existsSync(filePath)) return fail("No SKILL.md found in current directory.");
  try {
    const skill = loadSkillMd(filePath); const health = inspectSkillPackage(context.projectPath);
    if (health.status === "blocked") return fail(`Skill package is blocked: ${health.diagnostics.map((entry) => entry.code).join(", ")}`);
    console.log(`Skill "${skill.name}" validated successfully.`); console.log(""); console.log("Ready for publishing. Skill details:");
    console.log(`  Name: ${skill.name}`); console.log(`  Description: ${skill.description}`);
    if (skill.tools.length > 0) console.log(`  Tools: ${skill.tools.join(", ")}`); if (skill.tags.length > 0) console.log(`  Tags: ${skill.tags.join(", ")}`);
  } catch (error) { fail(`Invalid SKILL.md: ${error instanceof Error ? error.message : String(error)}`); }
}

function fail(message: string): undefined { console.error(message); process.exit(1); return undefined; }
