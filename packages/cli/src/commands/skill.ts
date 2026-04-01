import { existsSync, mkdirSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import type { KilnAppConfig } from "../config.js";
import { DomainRegistry, SkillRegistry, loadSkillMdIndex, loadSkillMd } from "@kilnai/core";
import { formatSkillList } from "../formatters.js";
import { skillCaptureCommand, parseSkillCaptureFlags } from "./skill-capture.js";

export async function skillCommand(
  config: KilnAppConfig,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  switch (subcommand) {
    case "list":
      return listSkills(config);
    case "install":
      return installSkill(config, args[0]);
    case "publish":
      return publishSkill(config);
    case "capture":
      return skillCaptureCommand(config, args[0], parseSkillCaptureFlags(args.slice(1)));
    default:
      console.log(`Usage: kiln skill <list|install|publish|capture>`);
      console.log("");
      console.log("Subcommands:");
      console.log("  list                 List all available skills");
      console.log("  install <path>       Install a SKILL.md file");
      console.log("  publish              Validate SKILL.md for publishing");
      console.log("  capture [sessionId]  Capture session output as a reusable skill (--last, --scope, --yes, --dry-run)");
  }
}

function listSkills(_config: KilnAppConfig): void {
  const cwd = process.cwd();
  const userHome = process.env.HOME ?? process.env.USERPROFILE ?? "";

  // Load domain registry and discover domain package skills
  const builtinDomains = DomainRegistry.loadBuiltinDomains();
  const domainRegistry = new DomainRegistry({ builtinConfigs: builtinDomains });
  domainRegistry.loadInstalledDomains(cwd);

  // Load skill registry with 3-tier discovery
  const skillRegistry = new SkillRegistry();
  skillRegistry.discoverAll(cwd, userHome);

  const skills = skillRegistry.all();
  console.log(formatSkillList(skills));
}

async function installSkill(_config: KilnAppConfig, packagePath: string | undefined): Promise<void> {
  if (!packagePath) {
    console.error("Usage: kiln skill install <path-to-SKILL.md>");
    process.exit(1);
    return;
  }

  const cwd = process.cwd();
  const skillsDir = join(cwd, ".kiln", "skills");

  const sourcePath = resolve(packagePath);
  if (!existsSync(sourcePath)) {
    console.error(`Not found: ${sourcePath}`);
    process.exit(1);
    return;
  }

  if (!sourcePath.endsWith(".md")) {
    console.error("Skill files must be .md files (SKILL.md format with YAML frontmatter).");
    process.exit(1);
    return;
  }

  // Validate the SKILL.md
  try {
    loadSkillMdIndex(sourcePath);
  } catch (err) {
    console.error(`Invalid SKILL.md: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  // Ensure skills directory exists
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }

  const fileName = sourcePath.split(/[\\/]/).pop()!;
  const destPath = join(skillsDir, fileName);
  cpSync(sourcePath, destPath);

  console.log(`Installed skill to ${destPath}`);
}

function publishSkill(_config: KilnAppConfig): void {
  const cwd = process.cwd();
  const filePath = join(cwd, "SKILL.md");

  if (!existsSync(filePath)) {
    console.error("No SKILL.md found in current directory.");
    console.error("Create a SKILL.md with YAML frontmatter (name, description) and markdown body.");
    process.exit(1);
    return;
  }

  try {
    const skill = loadSkillMd(filePath);
    console.log(`Skill "${skill.name}" validated successfully.`);
    console.log("");
    console.log("Ready for publishing. Skill details:");
    console.log(`  Name: ${skill.name}`);
    console.log(`  Description: ${skill.description}`);
    if (skill.tools.length > 0) console.log(`  Tools: ${skill.tools.join(", ")}`);
    if (skill.tags.length > 0) console.log(`  Tags: ${skill.tags.join(", ")}`);
  } catch (err) {
    console.error(`Invalid SKILL.md: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
