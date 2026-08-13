import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { KilnAppConfig } from "../config.js";
import { digestSkillPackage, inspectSkillPackage, loadSkillMd, loadSkillMdIndex } from "@kilnai/core";
import { formatSkillList } from "../formatters.js";
import { skillCaptureCommand, parseSkillCaptureFlags } from "./skill-capture.js";
import { loadKilnConfig } from "../config/config-merger.js";
import { createConfiguredSkillRegistry } from "../config/skill-registry.js";

interface SkillInstallState {
  readonly version: 1;
  readonly packages: Readonly<Record<string, {
    readonly sourcePath: string;
    readonly packageDigest: string;
    readonly installedAt: string;
  }>>;
}

export async function skillCommand(config: KilnAppConfig, subcommand: string, args: readonly string[]): Promise<void> {
  switch (subcommand) {
    case "list": return listSkills(config);
    case "install": return installSkill(args[0]);
    case "update": return updateSkill(args[0], args.slice(1).find((arg) => arg !== "--force"), args.includes("--force"));
    case "remove": return removeSkill(args[0], args.includes("--force"));
    case "publish": return publishSkill(config);
    case "capture": return skillCaptureCommand(config, args[0], parseSkillCaptureFlags(args.slice(1)));
    default:
      console.log("Usage: kiln skill <list|install|update|remove|publish|capture>");
      console.log("");
      console.log("Subcommands:");
      console.log("  list                       List all available skills");
      console.log("  install <path>             Install a complete local skill package");
      console.log("  update <name> [path]       Replace an owned package after drift checks");
      console.log("  remove <name> [--force]    Remove an owned package with recoverable backup");
      console.log("  publish                    Validate SKILL.md for publishing");
      console.log("  capture [sessionId]        Capture session output as a reusable skill (--last, --scope, --yes, --dry-run)");
  }
}

async function listSkills(_config: KilnAppConfig): Promise<void> {
  const cwd = process.cwd(); const userHome = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const kilnYaml = await loadKilnConfig(cwd);
  console.log(formatSkillList(createConfiguredSkillRegistry({ projectPath: cwd, userHome, skillConfig: kilnYaml?.skills }).all()));
}

function installSkill(packagePath: string | undefined): void {
  if (!packagePath) return fail("Usage: kiln skill install <path-to-skill-package>");
  const state = readState();
  if (!state) return;
  const prepared = prepareSource(packagePath);
  if (!prepared) return;
  const destination = skillDestination(prepared.name);
  if (existsSync(destination)) { cleanupPrepared(prepared); return fail(`Skill "${prepared.name}" already exists; use kiln skill update after reviewing the package diff.`); }
  try {
    applyPackage(prepared.root, destination, prepared.digest);
    try {
      writeState({ version: 1, packages: { ...state.packages, [prepared.name]: ownership(prepared) } });
    } catch (error) {
      rmSync(destination, { recursive: true, force: true });
      throw error;
    }
    console.log(`Installed skill package "${prepared.name}" to ${destination} (${prepared.digest}).`);
  } finally { cleanupPrepared(prepared); }
}

function updateSkill(name: string | undefined, packagePath: string | undefined, force: boolean): void {
  if (!name) return fail("Usage: kiln skill update <name> [path] [--force]");
  if (!isPortableSkillName(name)) return fail(`Invalid skill name "${name}".`);
  const state = readState(); if (!state) return; const owned = state.packages[name];
  if (!owned) return fail(`Skill "${name}" is not owned by the governed package lifecycle.`);
  const destination = skillDestination(name);
  if (!existsSync(destination)) return fail(`Owned skill "${name}" is missing from ${destination}.`);
  const currentDigest = packageDigest(destination);
  if (currentDigest !== owned.packageDigest && !force) return fail(`Skill "${name}" has local modifications; review them or rerun update with --force.`);
  const prepared = prepareSource(packagePath ?? owned.sourcePath);
  if (!prepared) return;
  if (prepared.name !== name) { cleanupPrepared(prepared); return fail(`Update source declares skill "${prepared.name}", expected "${name}".`); }
  try {
    backupPackage(name, destination);
    const previous = replacePackage(prepared.root, destination, prepared.digest);
    try {
      writeState({ version: 1, packages: { ...state.packages, [name]: ownership(prepared) } });
    } catch (error) {
      rmSync(destination, { recursive: true, force: true });
      renameSync(previous, destination);
      throw error;
    }
    try { rmSync(previous, { recursive: true, force: true }); }
    catch { console.warn(`Updated skill package "${name}", but obsolete staging cleanup remains at ${previous}.`); }
    console.log(`Updated skill package "${name}" (${prepared.digest}).`);
  } finally { cleanupPrepared(prepared); }
}

function removeSkill(name: string | undefined, force: boolean): void {
  if (!name) return fail("Usage: kiln skill remove <name> [--force]");
  if (!isPortableSkillName(name)) return fail(`Invalid skill name "${name}".`);
  const state = readState(); if (!state) return; const owned = state.packages[name];
  if (!owned) return fail(`Skill "${name}" is not owned by the governed package lifecycle.`);
  const destination = skillDestination(name);
  let pendingRemoval: string | undefined;
  if (existsSync(destination)) {
    const currentDigest = packageDigest(destination);
    if (currentDigest !== owned.packageDigest && !force) return fail(`Skill "${name}" has local modifications; removal requires --force after review.`);
    backupPackage(name, destination);
    pendingRemoval = `${destination}.removing-${process.pid}-${Date.now()}`;
    renameSync(destination, pendingRemoval);
  }
  const packages = { ...state.packages }; delete packages[name];
  try { writeState({ version: 1, packages }); }
  catch (error) {
    if (pendingRemoval) renameSync(pendingRemoval, destination);
    throw error;
  }
  if (pendingRemoval) rmSync(pendingRemoval, { recursive: true, force: true });
  console.log(`Removed skill package "${name}". A recoverable backup is retained under .kiln/backups/skills/${name}.`);
}

function prepareSource(inputPath: string): { name: string; root: string; sourcePath: string; digest: string; temporary: boolean } | undefined {
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
    root = mkdtempSync(join(process.cwd(), ".kiln-skill-stage-"));
    cpSync(sourcePath, join(root, "SKILL.md"));
  }
  const health = inspectSkillPackage(root);
  if (health.status === "blocked") {
    if (!stat.isDirectory()) rmSync(root, { recursive: true, force: true });
    return fail(`Skill package "${name}" is blocked: ${[...health.diagnostics.map((entry) => entry.code), ...health.brokenResources.map((entry) => `${entry.reason}:${entry.target}`)].join(", ")}`);
  }
  return { name, root, sourcePath, digest: packageDigest(root), temporary: !stat.isDirectory() };
}

function applyPackage(source: string, destination: string, expectedDigest: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  const stage = mkdtempSync(join(dirname(destination), ".skill-install-"));
  try {
    cpSync(source, stage, { recursive: true });
    if (packageDigest(stage) !== expectedDigest) throw new Error("Staged skill package digest does not match the validated source.");
    renameSync(stage, destination);
  }
  catch (error) { rmSync(stage, { recursive: true, force: true }); throw error; }
}

function replacePackage(source: string, destination: string, expectedDigest: string): string {
  const parent = dirname(destination);
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(join(parent, ".skill-update-"));
  const previous = `${destination}.previous-${process.pid}-${Date.now()}`;
  try {
    cpSync(source, stage, { recursive: true });
    if (packageDigest(stage) !== expectedDigest) throw new Error("Staged skill package digest does not match the validated source.");
    renameSync(destination, previous);
    try { renameSync(stage, destination); }
    catch (error) { renameSync(previous, destination); throw error; }
    return previous;
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    if (existsSync(previous) && !existsSync(destination)) renameSync(previous, destination);
    throw error;
  }
}

function cleanupPrepared(prepared: { readonly root: string; readonly temporary: boolean }): void {
  if (prepared.temporary) rmSync(prepared.root, { recursive: true, force: true });
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

function backupPackage(name: string, source: string): void {
  const root = backupRoot(name);
  mkdirSync(root, { recursive: true });
  const target = join(root, new Date().toISOString().replace(/[:.]/g, "-")); cpSync(source, target, { recursive: true });
}

function statePath(): string { return join(process.cwd(), ".kiln", "skill-install-state.json"); }
function readState(): SkillInstallState | undefined {
  if (!existsSync(statePath())) return { version: 1, packages: {} };
  try {
    const state = JSON.parse(readFileSync(statePath(), "utf8")) as unknown;
    if (!validState(state)) return fail("Skill install state is invalid; refusing lifecycle mutation.");
    return state;
  } catch { return fail("Skill install state is unreadable; refusing lifecycle mutation."); }
}
function writeState(state: SkillInstallState): void {
  const target = statePath(); const parent = dirname(target); mkdirSync(parent, { recursive: true });
  const stage = `${target}.writing-${process.pid}-${Date.now()}`;
  const previous = `${target}.previous-${process.pid}-${Date.now()}`;
  writeFileSync(stage, JSON.stringify(state, null, 2) + "\n", "utf8");
  try {
    if (existsSync(target)) renameSync(target, previous);
    try { renameSync(stage, target); }
    catch (error) { if (existsSync(previous)) renameSync(previous, target); throw error; }
  } catch (error) { rmSync(stage, { force: true }); throw error; }
  if (existsSync(previous)) {
    try { rmSync(previous, { force: true }); }
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
function skillDestination(name: string): string { return directChild(join(process.cwd(), ".kiln", "skills"), name); }
function backupRoot(name: string): string { return directChild(join(process.cwd(), ".kiln", "backups", "skills"), name); }
function directChild(root: string, name: string): string {
  if (!isPortableSkillName(name)) throw new Error(`Invalid portable skill name: ${name}`);
  const absoluteRoot = resolve(root); const child = resolve(absoluteRoot, name);
  if (dirname(child) !== absoluteRoot) throw new Error(`Skill path escapes governed root: ${name}`);
  return child;
}

function publishSkill(_config: KilnAppConfig): void {
  const filePath = join(process.cwd(), "SKILL.md");
  if (!existsSync(filePath)) return fail("No SKILL.md found in current directory.");
  try {
    const skill = loadSkillMd(filePath); const health = inspectSkillPackage(process.cwd());
    if (health.status === "blocked") return fail(`Skill package is blocked: ${health.diagnostics.map((entry) => entry.code).join(", ")}`);
    console.log(`Skill "${skill.name}" validated successfully.`); console.log(""); console.log("Ready for publishing. Skill details:");
    console.log(`  Name: ${skill.name}`); console.log(`  Description: ${skill.description}`);
    if (skill.tools.length > 0) console.log(`  Tools: ${skill.tools.join(", ")}`); if (skill.tags.length > 0) console.log(`  Tags: ${skill.tags.join(", ")}`);
  } catch (error) { fail(`Invalid SKILL.md: ${error instanceof Error ? error.message : String(error)}`); }
}

function fail(message: string): undefined { console.error(message); process.exit(1); return undefined; }
