import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import {
  parseDomainYaml,
  parseDomainPackageYaml,
  validatePackageSecurity,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function spawnCommand(cmd: string, args: string[], cwd?: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd }, (error, stdout, stderr) => {
      resolve({
        exitCode: error?.code ? (typeof error.code === "number" ? error.code : 1) : 0,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
      });
    });
  });
}

export async function domainCommand(
  appConfig: KilnAppConfig,
  subcommand: string,
  args: string[],
  projectPath?: string,
): Promise<void> {
  const root = projectPath ?? process.cwd();

  switch (subcommand) {
    case "install":
      await installDomain(appConfig, args[0], root);
      break;
    case "list":
      listDomains(appConfig, root);
      break;
    case "search":
      await searchDomains(args[0]);
      break;
    case "info":
      infoDomain(appConfig, args[0], root);
      break;
    case "remove":
      await removeDomain(appConfig, args[0], root);
      break;
    default:
      printDomainHelp(appConfig);
  }
}

function printDomainHelp(appConfig: KilnAppConfig): void {
  console.log(`\nUsage: ${appConfig.appName} domain <subcommand>\n`);
  console.log("Subcommands:");
  console.log("  install <package>   Install a domain package");
  console.log("  list                List installed domains");
  console.log("  search <query>      Search for domain packages");
  console.log("  info <package>      Show domain package details");
  console.log("  remove <package>    Remove a domain package");
  console.log("");
}

/** Validate scoped npm package name: @scope/name with valid npm characters */
function isValidPackageName(name: string): boolean {
  return /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name);
}

async function installDomain(appConfig: KilnAppConfig, pkg: string | undefined, root: string): Promise<void> {
  if (!pkg) {
    console.log(`Usage: ${appConfig.appName} domain install <package>`);
    return;
  }

  if (!isValidPackageName(pkg)) {
    console.error(`Invalid package name: ${pkg}`);
    console.error("Package must be a scoped npm package (e.g. @kilnai/domain-name).");
    return;
  }

  const result = await spawnCommand("bun", ["add", pkg], root);
  if (result.exitCode !== 0) {
    console.error(`Failed to install ${pkg}: ${result.stderr.trim()}`);
    return;
  }

  // Find domain.yaml in installed package
  const pkgDir = join(root, "node_modules", pkg);
  const yamlPath = join(pkgDir, "domain.yaml");
  if (!existsSync(yamlPath)) {
    console.error(`No domain.yaml found in ${pkg}`);
    return;
  }

  // Validate domain YAML
  const yamlContent = readFileSync(yamlPath, "utf-8");
  let manifest;
  try {
    manifest = parseDomainPackageYaml(yamlContent, pkgDir, yamlPath);
  } catch (err) {
    console.error(`Invalid domain.yaml in ${pkg}: ${(err as Error).message}`);
    return;
  }

  // Security validation
  const pkgJsonPath = join(pkgDir, "package.json");
  const pkgJsonContent = existsSync(pkgJsonPath) ? readFileSync(pkgJsonPath, "utf-8") : null;
  const fileList = readdirSync(pkgDir);
  const security = validatePackageSecurity(pkgJsonContent, fileList);
  if (!security.valid) {
    console.error(`Security validation failed for ${pkg}:`);
    for (const err of security.errors) {
      console.error(`  - ${err}`);
    }
    return;
  }
  for (const warn of security.warnings) {
    console.log(`Warning: ${warn}`);
  }

  // Copy to <dirName>/domains/
  const domainsDir = join(root, appConfig.dirName, "domains");
  mkdirSync(domainsDir, { recursive: true });
  const destPath = join(domainsDir, `${manifest.config.name}.yaml`);
  copyFileSync(yamlPath, destPath);

  console.log(`Installed ${manifest.config.displayName} v${manifest.version}`);
}

function listDomains(appConfig: KilnAppConfig, root: string): void {
  const domainsDir = join(root, appConfig.dirName, "domains");
  if (!existsSync(domainsDir)) {
    console.log("No domains installed.");
    return;
  }

  const files = readdirSync(domainsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (files.length === 0) {
    console.log("No domains installed.");
    return;
  }

  console.log("\nInstalled Domains\n");
  console.log(`${"Name".padEnd(20)} ${"Version".padEnd(12)} Detect Patterns`);
  console.log(`${"─".repeat(20)} ${"─".repeat(12)} ${"─".repeat(30)}`);

  for (const file of files) {
    const filePath = join(domainsDir, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      const config = parseDomainYaml(content, filePath);
      const versionMatch = content.match(/^version:\s*(.+)$/m);
      const version = versionMatch ? versionMatch[1]!.trim() : "—";
      const patterns = config.detectPatterns.join(", ");
      console.log(`${config.displayName.padEnd(20)} ${version.padEnd(12)} ${patterns}`);
    } catch {
      console.log(`Warning: Could not parse ${file}, skipping.`);
    }
  }
  console.log("");
}

async function searchDomains(query: string | undefined): Promise<void> {
  if (!query) {
    console.log("Usage: domain search <query>");
    return;
  }

  // Use the npm registry API directly instead of shelling out to npm/bun,
  // since bun has no native `search` command and we want to avoid requiring npm.
  const url = `https://registry.npmjs.org/-/v1/search?text=@kilnai/${encodeURIComponent(query)}&size=20`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    console.error("Failed to reach npm registry.");
    return;
  }

  if (!response.ok) {
    console.error(`npm registry returned ${response.status}.`);
    return;
  }

  let body: { objects?: { package: { name: string; description?: string; version: string } }[] };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    console.error("Failed to parse search results.");
    return;
  }

  const results = body.objects ?? [];
  if (results.length === 0) {
    console.log("No packages found.");
    return;
  }

  console.log("\nSearch Results\n");
  console.log(`${"Name".padEnd(35)} ${"Version".padEnd(12)} Description`);
  console.log(`${"─".repeat(35)} ${"─".repeat(12)} ${"─".repeat(40)}`);

  for (const r of results) {
    const pkg = r.package;
    console.log(
      `${pkg.name.padEnd(35)} ${(pkg.version ?? "").padEnd(12)} ${pkg.description ?? ""}`,
    );
  }
  console.log("");
}

function infoDomain(appConfig: KilnAppConfig, pkg: string | undefined, root: string): void {
  if (!pkg) {
    console.log(`Usage: ${appConfig.appName} domain info <package>`);
    return;
  }

  // Try <dirName>/domains/ first (by name field match)
  const domainsDir = join(root, appConfig.dirName, "domains");
  if (existsSync(domainsDir)) {
    const files = readdirSync(domainsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of files) {
      const filePath = join(domainsDir, file);
      const content = readFileSync(filePath, "utf-8");
      try {
        const manifest = parseDomainPackageYaml(content, domainsDir, filePath);
        if (manifest.config.name === pkg || basename(file, ".yaml") === pkg) {
          printManifestInfo(manifest);
          return;
        }
      } catch {
        // skip invalid files
      }
    }
  }

  // Try node_modules
  const yamlPath = join(root, "node_modules", pkg, "domain.yaml");
  if (existsSync(yamlPath)) {
    const content = readFileSync(yamlPath, "utf-8");
    try {
      const manifest = parseDomainPackageYaml(content, join(root, "node_modules", pkg), yamlPath);
      printManifestInfo(manifest);
      return;
    } catch (err) {
      console.error(`Failed to parse ${yamlPath}: ${(err as Error).message}`);
      return;
    }
  }

  console.log(`Domain "${pkg}" not found.`);
}

function printManifestInfo(manifest: ReturnType<typeof parseDomainPackageYaml>): void {
  console.log(`\n${manifest.config.displayName}\n`);
  console.log(`  Name:     ${manifest.config.name}`);
  console.log(`  Version:  ${manifest.version}`);
  if (manifest.author) {
    console.log(`  Author:   ${manifest.author}`);
  }
  console.log(`  Detect:   ${manifest.config.detectPatterns.join(", ")}`);
  if (manifest.skills.length > 0) {
    console.log(`  Skills:   ${manifest.skills.join(", ")}`);
  }
  if (manifest.tools) {
    console.log(`  Tools:    ${manifest.tools.server}`);
  }
  console.log(`  Gates:    ${manifest.config.qualityGates.map((g) => g.name).join(", ")}`);
  console.log("");
}

async function removeDomain(appConfig: KilnAppConfig, pkg: string | undefined, root: string): Promise<void> {
  if (!pkg) {
    console.log(`Usage: ${appConfig.appName} domain remove <package>`);
    return;
  }

  // Find matching domain in <dirName>/domains/
  const domainsDir = join(root, appConfig.dirName, "domains");
  let removedName: string | null = null;

  if (existsSync(domainsDir)) {
    const files = readdirSync(domainsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of files) {
      const filePath = join(domainsDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const config = parseDomainYaml(content, filePath);
        if (config.name === pkg || basename(file, ".yaml") === pkg) {
          unlinkSync(filePath);
          removedName = config.displayName;
          break;
        }
      } catch {
        if (basename(file, ".yaml") === pkg) {
          unlinkSync(filePath);
          removedName = pkg;
          break;
        }
      }
    }
  }

  // Run bun remove (best effort)
  await spawnCommand("bun", ["remove", pkg], root);

  if (removedName) {
    console.log(`Removed ${removedName}`);
  } else {
    console.log(`Domain "${pkg}" not found.`);
  }
}
