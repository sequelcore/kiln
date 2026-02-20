import { existsSync, mkdirSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import type { KilnAppConfig } from "../config.js";
import { DomainRegistry, SkillRegistry, loadSkillYaml } from "@kilnai/core";
import { formatSkillList } from "../formatters.js";

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
    default:
      console.log(`Usage: ${config.appName} skill <list|install|publish>`);
      console.log("");
      console.log("Subcommands:");
      console.log("  list                 List all available skills");
      console.log("  install <package>    Install a skill package");
      console.log("  publish              Validate and prepare skill for publishing");
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

async function installSkill(config: KilnAppConfig, packagePath: string | undefined): Promise<void> {
  if (!packagePath) {
    console.error("Usage: " + config.appName + " skill install <path-or-package>");
    process.exit(1);
    return;
  }

  const cwd = process.cwd();
  const skillsDir = join(cwd, ".kiln", "skills");

  // Resolve the source path
  const sourcePath = resolve(packagePath);
  if (!existsSync(sourcePath)) {
    console.error(`Not found: ${sourcePath}`);
    process.exit(1);
    return;
  }

  // Validate the skill YAML
  try {
    loadSkillYaml(sourcePath);
  } catch (err) {
    console.error(`Invalid skill file: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  // Ensure skills directory exists
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }

  // Copy the skill file
  const fileName = sourcePath.split(/[\\/]/).pop()!;
  const destPath = join(skillsDir, fileName);
  cpSync(sourcePath, destPath);

  console.log(`Installed skill to ${destPath}`);
}

function publishSkill(_config: KilnAppConfig): void {
  const cwd = process.cwd();

  // Look for SKILL.yaml in current directory
  const skillYamlPath = join(cwd, "SKILL.yaml");
  const skillYmlPath = join(cwd, "SKILL.yml");
  const filePath = existsSync(skillYamlPath) ? skillYamlPath : existsSync(skillYmlPath) ? skillYmlPath : null;

  if (!filePath) {
    console.error("No SKILL.yaml found in current directory.");
    console.error("Create a SKILL.yaml with name, description, and instructions fields.");
    process.exit(1);
    return;
  }

  // Validate
  try {
    const skill = loadSkillYaml(filePath);
    console.log(`Skill "${skill.name}" validated successfully.`);
    console.log("");
    console.log("To publish, create a kiln-package.yaml:");
    console.log("");
    console.log("  type: skill");
    console.log(`  version: "0.1.0"`);
    console.log(`  author: "Your Name"`);
    console.log(`  name: ${skill.name}`);
    console.log(`  description: ${skill.description}`);
    console.log(`  instructions: |`);
    console.log(`    ${skill.instructions.split("\n").join("\n    ")}`);
  } catch (err) {
    console.error(`Invalid SKILL.yaml: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
