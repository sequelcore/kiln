import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readKilnYaml } from "../kiln-yaml.js";
import type { KilnAppConfig } from "../config.js";

export function statusCommand(_appConfig: KilnAppConfig, projectPath?: string): void {
  const root = projectPath ?? process.cwd();
  const kilnDir = join(root, ".kiln");

  const config = readKilnYaml(kilnDir);
  if (!config) {
    console.log(`Not initialized. Run 'kiln init' first.`);
    return;
  }

  console.log(`\nKiln Project Status\n`);
  console.log(`  Domain:           ${config.domain ?? "—"}`);
  console.log(`  Require Approval: ${config.requireApproval ?? true}`);
  console.log(`  Max Depth:        ${config.maxDepth ?? 3}`);
  console.log(`  Parallel Workers: ${config.parallelWorkers ?? 2}`);
  console.log(`  Provider:         ${config.provider ?? "—"}`);
  console.log(`  Mode:             ${config.mode ?? "—"}`);

  const memoryDir = join(kilnDir, "memory");
  if (existsSync(memoryDir)) {
    const files = readdirSync(memoryDir);
    console.log(`\n  Memory files:     ${files.length}`);
  }

  console.log("");
}
