import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionBuiltinToolOptions } from "@kilnai/core";
import type { KilnYaml } from "../kiln-yaml-types.js";
import { readKilnYaml } from "../kiln-yaml.js";
import { readConfigStatusSnapshot } from "../application/config-status.js";
import { describeWebToolConfiguration } from "../config/web-tools-config.js";
import { describeInteractiveUseConfiguration } from "../config/interactive-use-config.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { discoverManagedAgentProviderModels } from "../config/managed-agent-provider-models.js";
import {
  closeManagedAccountRuntimeComposition,
  resolveManagedInvocationToolOptions,
} from "../config/managed-agent-routes.js";
import { readGlobalConfig } from "../config/global-config.js";
import type { KilnSkillCatalogSnapshot } from "@kilnai/gateway-contracts";
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
  const snapshot = await readConfigStatusSnapshot({ projectPath: projectPath ?? process.cwd() });
  const root = snapshot.project.rootPath;
  const kilnDir = join(root, ".kiln");

  if (!snapshot.effectiveConfig) {
    console.log(`Not initialized. Run 'kiln init' first.`);
    return;
  }
  const config = snapshot.effectiveConfig as unknown as KilnYaml;

  console.log(`\nKiln Project Status\n`);
  console.log(`  Domain:           ${config.domain ?? "—"}`);
  console.log(`  Require Approval: ${config.requireApproval ?? true}`);
  console.log(`  Max Depth:        ${config.maxDepth ?? 3}`);
  console.log(`  Parallel Workers: ${config.parallelWorkers ?? 2}`);
  console.log(`  Provider:         ${config.provider ?? "—"}`);
  console.log(`  Mode:             ${config.mode ?? "—"}`);

  const globalConfig = readGlobalConfig();
  const projectConfig = snapshot.project.kilnYaml.status === "valid"
    ? readKilnYaml(kilnDir)
    : null;
  printWebStatus(config, {
    globalWeb: globalConfig?.web,
    projectWeb: projectConfig?.web,
  });
  printInteractiveUseStatus(config);
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
  const managedInvocationResolution = await (async () => {
    try {
      return await resolveManagedInvocationToolOptions(managedInvocationConfig, {
        cwd: root,
        registry,
        surface: "operator",
        isProviderAvailable: (provider) => engineAvailability.get(provider),
        providerModelEligibility: managedAgentProviderModels,
        directAdapterFactory: createManagedDirectProviderAdapterFactory({ builtinToolOptions }),
        builtinToolOptions,
      });
    } finally {
      closeManagedAccountRuntimeComposition(root);
    }
  })();
  if (managedInvocationResolution.routeHealth.length > 0) {
    console.log(`\n  Managed agent routes:`);
    for (const route of managedInvocationResolution.routeHealth) {
      const status = route.available ? "admission-ready" : `admission-unavailable - ${route.reason}`;
      const economicBoundary = route.kind === "harness"
        ? "; provider consumption is not bounded by Kiln's managed economic ceiling"
        : "";
      console.log(`    - ${route.routeId}: ${route.kind}/${route.provider}${route.model ? ` ${route.model}` : ""} [${route.profiles.join(", ")}] ${status}${economicBoundary}`);
    }
  }
  if (managedInvocationResolution.agentHealth?.length) {
    console.log(`\n  Managed agent profile issues:`);
    for (const agent of managedInvocationResolution.agentHealth) {
      console.log(`    - ${agent.agentName}${agent.routeId ? ` (${agent.routeId})` : ""}: ${agent.reason ?? "unavailable"}`);
    }
  }

  if (snapshot.projections.length > 0) {
    console.log(`\n  Config projections:`);
    for (const projection of snapshot.projections) {
      console.log(`    - ${projection.targetId}: ${projection.status}`);
    }
  }

  printSkillCatalogStatus(snapshot.skills, config.skills?.selection?.mode ?? "advisory");

  const setupActions = snapshot.setup.recommendedActions.filter((action) => action !== "none");
  if (setupActions.length > 0) {
    console.log(`\n  Setup actions:`);
    for (const action of setupActions) {
      console.log(`    - ${action}`);
    }
  }

  const memoryDir = join(kilnDir, "memory");
  if (existsSync(memoryDir)) {
    const files = readdirSync(memoryDir);
    console.log(`\n  Memory files:     ${files.length}`);
  }

  console.log("");
}

function printInteractiveUseStatus(config: KilnYaml): void {
  const diagnostics = describeInteractiveUseConfiguration(config);
  if (
    !diagnostics.enabled
    && diagnostics.browserProviderType === "none"
    && diagnostics.computerProviderType === "none"
  ) {
    return;
  }

  console.log(`\n  Interactive use:`);
  console.log(`    Enabled: ${diagnostics.enabled}`);
  console.log(`    Browser provider: ${formatInteractiveUseProviderStatus(
    diagnostics.browserProviderType,
    diagnostics.browserProviderConfigured,
  )}`);
  console.log(`    Computer provider: ${formatInteractiveUseProviderStatus(
    diagnostics.computerProviderType,
    diagnostics.computerProviderConfigured,
  )}`);
  console.log(`    Browser environment: ${diagnostics.browserEnvironment}`);
  console.log(`    Computer environment: ${diagnostics.computerEnvironment}`);
  console.log(`    Allowed domains: ${diagnostics.allowedDomains.length > 0 ? diagnostics.allowedDomains.join(", ") : "—"}`);
  console.log(`    External browser: ${diagnostics.allowExternalBrowser}`);
  console.log(`    Computer control: ${diagnostics.allowComputer}`);
  console.log(`    Allowed applications: ${diagnostics.allowedApplications.length > 0 ? diagnostics.allowedApplications.join(", ") : "—"}`);
  const applicationAliases = Object.entries(diagnostics.applicationAliases)
    .map(([name, aliases]) => `${name}=[${aliases.join(", ")}]`);
  console.log(`    Application aliases: ${applicationAliases.length > 0 ? applicationAliases.join("; ") : "—"}`);
  if (diagnostics.issues.length > 0) {
    console.log(`    Issues: ${diagnostics.issues.join(", ")}`);
  }
}

function formatInteractiveUseProviderStatus(
  providerType: string,
  configured: boolean,
): string {
  return `${providerType}${configured ? "" : " (missing)"}`;
}

function printWebStatus(
  config: KilnYaml,
  sources: Parameters<typeof describeWebToolConfiguration>[1],
): void {
  const diagnostics = describeWebToolConfiguration(config, sources);
  if (
    !diagnostics.enabled
    && diagnostics.searchProviderType === "none"
    && diagnostics.extractProviderType === "none"
    && diagnostics.netPolicy === "none"
  ) {
    return;
  }

  console.log(`\n  Web access:`);
  console.log(`    Enabled: ${diagnostics.enabled}`);
  console.log(`    Network policy: ${diagnostics.netPolicy}`);
  console.log(`    Allowed domains: ${diagnostics.allowedDomains.length > 0 ? diagnostics.allowedDomains.join(", ") : "—"}`);
  console.log(`    Search provider: ${formatWebProviderStatus(
    diagnostics.searchProviderType,
    diagnostics.searchProviderConfigured,
    diagnostics.searchProviderSource,
  )}`);
  if (diagnostics.searchFallbackProviderTypes.length > 0) {
    console.log(`    Search fallbacks: ${formatWebProviderStatus(
      diagnostics.searchFallbackProviderTypes.join(" -> "),
      diagnostics.searchFallbackProvidersConfigured,
      diagnostics.searchFallbackProviderSource,
    )}`);
  }
  console.log(`    Extract provider: ${formatWebProviderStatus(
    diagnostics.extractProviderType,
    diagnostics.extractProviderConfigured,
    diagnostics.extractProviderSource,
  )}`);
  if (diagnostics.issues.length > 0) {
    console.log(`    Issues: ${diagnostics.issues.join(", ")}`);
  }
}

function formatWebProviderStatus(
  providerType: string,
  configured: boolean,
  source: "none" | "effective" | "global" | "project",
): string {
  const sourceLabel = source === "global" || source === "project" ? ` (${source})` : "";
  return `${providerType}${configured ? sourceLabel : " (missing)"}`;
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

function printSkillCatalogStatus(
  skills: KilnSkillCatalogSnapshot | undefined,
  selectionMode: string,
): void {
  if (!skills || skills.entries.length === 0) {
    return;
  }

  const configured = skills.entries.filter((entry) => entry.configured);
  const nativeOnly = skills.entries.filter((entry) => entry.origin === "native-harness");
  const projectionIssues = skills.entries.filter((entry) =>
    entry.projections.some((projection) => projection.status !== "projected")
  ).sort(compareSkillCatalogIssuePriority);
  const byOrigin = countSkillsByOrigin(configured);
  console.log(`\n  Skill catalog:`);
  console.log(`    Selection mode: ${selectionMode}`);
  console.log(`    Configured: ${configured.length} (builtin=${byOrigin.builtin}, user=${byOrigin.user}, project=${byOrigin.project})`);
  console.log(`    Native-only: ${nativeOnly.length}`);
  console.log(`    Projection issues: ${projectionIssues.length}`);
  for (const entry of projectionIssues.slice(0, 8)) {
    const issueSummary = entry.projections
      .filter((projection) => projection.status !== "projected")
      .map((projection) => `${projection.target}:${projection.status}`)
      .join(", ");
    console.log(`    - ${entry.name}: ${issueSummary}`);
  }
  if (projectionIssues.length > 8) {
    console.log(`    ... ${projectionIssues.length - 8} more skill projection issues`);
  }
}

function compareSkillCatalogIssuePriority(
  left: KilnSkillCatalogSnapshot["entries"][number],
  right: KilnSkillCatalogSnapshot["entries"][number],
): number {
  const originDelta = skillOriginPriority(left.origin) - skillOriginPriority(right.origin);
  if (originDelta !== 0) {
    return originDelta;
  }
  return left.name.localeCompare(right.name);
}

function skillOriginPriority(origin: KilnSkillCatalogSnapshot["entries"][number]["origin"]): number {
  switch (origin) {
    case "project":
      return 0;
    case "user":
      return 1;
    case "builtin":
      return 2;
    case "native-harness":
      return 3;
  }
  return 4;
}

function countSkillsByOrigin(
  entries: readonly KilnSkillCatalogSnapshot["entries"][number][],
): { readonly builtin: number; readonly user: number; readonly project: number } {
  return {
    builtin: entries.filter((entry) => entry.origin === "builtin").length,
    user: entries.filter((entry) => entry.origin === "user").length,
    project: entries.filter((entry) => entry.origin === "project").length,
  };
}
