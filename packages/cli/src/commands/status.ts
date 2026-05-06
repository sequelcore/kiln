import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionBuiltinToolOptions } from "@kilnai/core";
import { loadKilnConfig } from "../config/config-merger.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { resolveManagedInvocationToolOptions } from "../config/managed-agent-routes.js";
import type { KilnAppConfig } from "../config.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";

export async function statusCommand(_appConfig: KilnAppConfig, projectPath?: string): Promise<void> {
  const root = projectPath ?? process.cwd();
  const kilnDir = join(root, ".kiln");
  const projectConfigPath = join(kilnDir, "kiln.yaml");

  if (!existsSync(projectConfigPath)) {
    console.log(`Not initialized. Run 'kiln init' first.`);
    return;
  }

  const config = await loadKilnConfig(root);
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

  const { registry } = createDefaultRegistry();
  const builtinToolOptions = createSessionBuiltinToolOptions();
  const managedInvocationResolution = await resolveManagedInvocationToolOptions(config, {
    cwd: root,
    registry,
    surface: "operator",
    directAdapterFactory: createManagedDirectProviderAdapterFactory({ builtinToolOptions }),
  });
  if (managedInvocationResolution.routeHealth.length > 0) {
    console.log(`\n  Managed agent routes:`);
    for (const route of managedInvocationResolution.routeHealth) {
      const status = route.available ? "available" : `unavailable - ${route.reason}`;
      console.log(`    - ${route.routeId}: ${route.kind}/${route.provider}${route.model ? ` ${route.model}` : ""} [${route.profiles.join(", ")}] ${status}`);
    }
  }

  const memoryDir = join(kilnDir, "memory");
  if (existsSync(memoryDir)) {
    const files = readdirSync(memoryDir);
    console.log(`\n  Memory files:     ${files.length}`);
  }

  console.log("");
}
