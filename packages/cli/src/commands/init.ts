import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";

export interface ProjectConfig {
  domain: string;
  requireApproval: boolean;
  maxDepth: number;
  parallelWorkers: number;
  provider: string;
  mode: string;
}

export function initCommand(
  appConfig: KilnAppConfig,
  projectPath?: string,
  flags?: { force?: boolean },
): ProjectConfig | null {
  const root = projectPath ?? process.cwd();
  const appDir = join(root, appConfig.dirName);

  if (existsSync(appDir) && !flags?.force) {
    console.log("Already initialized.");
    return null;
  }

  // Create directories
  mkdirSync(appDir, { recursive: true });
  mkdirSync(join(appDir, "memory"), { recursive: true });

  // Detect domain (includes installed marketplace packages)
  const registry = appConfig.createRegistry();
  registry.loadInstalledDomains(root);
  const domain = registry.detectAndMerge(root);

  // Write config
  const config: ProjectConfig = {
    domain: domain.name,
    requireApproval: true,
    maxDepth: 3,
    parallelWorkers: 2,
    provider: "claude",
    mode: "api-key",
  };

  writeFileSync(join(appDir, "config.json"), JSON.stringify(config, null, 2) + "\n");

  // Update .gitignore
  const gitignorePath = join(root, ".gitignore");
  let existing = "";
  if (existsSync(gitignorePath)) {
    existing = readFileSync(gitignorePath, "utf-8");
  }

  const gitignoreEntries = [`${appConfig.dirName}/memory.db`, `${appConfig.dirName}/agents/`] as const;
  const toAppend: string[] = [];
  for (const entry of gitignoreEntries) {
    if (!existing.includes(entry)) {
      toAppend.push(entry);
    }
  }

  if (toAppend.length > 0) {
    const suffix = existing.endsWith("\n") || existing === "" ? "" : "\n";
    appendFileSync(gitignorePath, suffix + toAppend.join("\n") + "\n");
  }

  // Print results
  console.log(`Domain:  ${domain.displayName}`);
  if (domain.qualityGates.length > 0) {
    console.log("Gates:   " + domain.qualityGates.map((g) => g.name).join(", "));
  }
  const appLabel = appConfig.appName.charAt(0).toUpperCase() + appConfig.appName.slice(1);
  console.log(`${appLabel} initialized.`);

  return config;
}
