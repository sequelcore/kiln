import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionBuiltinToolOptions } from "@kilnai/core";
import { loadKilnConfig } from "../config/config-merger.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { discoverManagedAgentProviderModels } from "../config/managed-agent-provider-models.js";
import { resolveManagedInvocationToolOptions } from "../config/managed-agent-routes.js";
import { readGlobalConfig } from "../config/global-config.js";
import {
  EngineRegistry,
  resolveEngineRoute,
  type EngineProbeResult,
  type EngineRouteContext,
} from "../engines/engine-registry.js";
import type { KilnAppConfig } from "../config.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";

export interface StatusCommandOptions extends EngineRouteContext {
  readonly engineRegistry?: Pick<EngineRegistry, "probeAll">;
}

export async function statusCommand(
  _appConfig: KilnAppConfig,
  projectPath?: string,
  options: StatusCommandOptions = {},
): Promise<void> {
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

  const globalConfig = readGlobalConfig();
  let engineAvailability: ReadonlyMap<string, boolean> = new Map();

  if (globalConfig) {
    const engineRegistry = options.engineRegistry ?? new EngineRegistry();
    const engineHealth = engineRegistry.probeAll(globalConfig);
    engineAvailability = new Map(engineHealth.map((engine) => [engine.engineId, engine.available]));
    const route = resolveEngineRoute(globalConfig, {
      ...options,
      isEngineAvailable: (engineId) => engineAvailability.get(engineId) ?? options.isEngineAvailable?.(engineId) ?? true,
    });
    printEngineStatus(engineHealth, route.worker, route.reason);
  }

  const { registry } = createDefaultRegistry();
  const builtinToolOptions = createSessionBuiltinToolOptions();
  const managedAgentProviderModels = await discoverManagedAgentProviderModels();
  const managedInvocationConfig = globalConfig
    ? {
      ...globalConfig,
      managedAgents: config.managedAgents ?? globalConfig.managedAgents,
    }
    : config;
  const managedInvocationResolution = await resolveManagedInvocationToolOptions(managedInvocationConfig, {
    cwd: root,
    registry,
    surface: "operator",
    isProviderAvailable: (provider) => engineAvailability.get(provider),
    providerModels: managedAgentProviderModels,
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

function printEngineStatus(
  engineHealth: readonly EngineProbeResult[],
  resolvedWorker: string | undefined,
  routeReason: string,
): void {
  if (engineHealth.length === 0 && !resolvedWorker) {
    return;
  }

  console.log(`\n  Engine routes:`);
  for (const engine of engineHealth) {
    const status = engine.available ? "available" : `unavailable - ${engine.reason ?? "unknown"}`;
    console.log(`    - ${engine.engineId}: ${status}`);
  }
  console.log(`    Resolved worker: ${resolvedWorker ?? "—"}`);
  console.log(`    Route reason:    ${routeReason}`);
}
