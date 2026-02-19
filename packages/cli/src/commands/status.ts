import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "./init.js";
import type { KilnAppConfig } from "../config.js";

export function statusCommand(appConfig: KilnAppConfig, projectPath?: string): void {
  const root = projectPath ?? process.cwd();
  const configPath = join(root, appConfig.dirName, "config.json");

  if (!existsSync(configPath)) {
    console.log(`Not initialized. Run '${appConfig.appName} init' first.`);
    return;
  }

  const raw = readFileSync(configPath, "utf-8");
  const config: ProjectConfig = JSON.parse(raw) as ProjectConfig;

  const appLabel = appConfig.appName.charAt(0).toUpperCase() + appConfig.appName.slice(1);
  console.log(`\n${appLabel} Project Status\n`);
  console.log(`  Domain:           ${config.domain}`);
  console.log(`  Require Approval: ${config.requireApproval}`);
  console.log(`  Max Depth:        ${config.maxDepth}`);
  console.log(`  Parallel Workers: ${config.parallelWorkers}`);
  console.log(`  Provider:         ${config.provider}`);
  console.log(`  Mode:             ${config.mode}`);

  const memoryDir = join(root, appConfig.dirName, "memory");
  if (existsSync(memoryDir)) {
    const files = readdirSync(memoryDir);
    console.log(`\n  Memory files:     ${files.length}`);
  }

  console.log("");
}
