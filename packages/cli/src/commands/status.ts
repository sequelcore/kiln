import { existsSync, readdirSync } from "node:fs";
import { createSessionBuiltinToolOptions } from "@kilnai/core";
import type { ResolvedKilnConfig } from "../kiln-yaml-types.js";
import { readKilnYamlFile } from "../kiln-yaml.js";
import { readConfigStatusSnapshot, readResolvedConfigDetail } from "../application/config-status.js";
import { effectiveConfigField } from "../application/effective-config-projection.js";
import type { SkillPluginProvider } from "../config/skill-source-inventory.js";
import { describeWebToolConfiguration } from "../config/web-tools-config.js";
import { describeInteractiveUseConfiguration } from "../config/interactive-use-config.js";
import { discoverManagedAgentProviderModels } from "../config/managed-agent-provider-models.js";
import {
  resolveManagedInvocationToolOptions,
} from "../config/managed-agent-routes.js";
import { readGlobalConfig, readGlobalExecutionTargetCatalog } from "../config/global-config.js";
import type { KilnSkillCatalogSummarySnapshot } from "@kilnai/gateway-contracts";
import {
  EngineRegistry,
  resolveEngineRoute,
  type EngineProbeResult,
  type EngineRouteContext,
} from "../engines/engine-registry.js";
import type { KilnAppConfig } from "../config.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import {
  type ProjectStateBinding,
  resolveProjectStateBinding,
} from "../application/project-state-root.js";

export interface StatusCommandOptions extends EngineRouteContext {
  readonly engineRegistry?: Pick<EngineRegistry, "probeAll">;
  readonly pluginProvider?: SkillPluginProvider;
  readonly kilnHome?: string;
  readonly projectStateBinding?: ProjectStateBinding;
}

export async function statusCommand(
  _appConfig: KilnAppConfig,
  projectPath?: string,
  options: StatusCommandOptions = {},
): Promise<void> {
  const snapshot = await readConfigStatusSnapshot({
    projectPath: projectPath ?? process.cwd(),
    view: "skills",
    ...(options.kilnHome === undefined ? {} : { kilnHome: options.kilnHome }),
    ...(options.projectStateBinding === undefined ? {} : { projectStateBinding: options.projectStateBinding }),
    ...(options.pluginProvider ? { pluginProvider: options.pluginProvider } : {}),
  });
  const root = snapshot.project.rootPath;
  const binding = options.projectStateBinding
    ?? resolveProjectStateBinding(root, options);

  if (!snapshot.effectiveConfig) {
    console.log(`Not initialized. Run 'kiln init' first.`);
    return;
  }
  const config = readResolvedConfigDetail(snapshot);
  if (!config) {
    console.log("Effective configuration details are unavailable.");
    return;
  }

  console.log(`\nKiln Project Status\n`);
  console.log(`  Effective Config: ${snapshot.effectiveConfig.health} (schema ${snapshot.effectiveConfig.schemaRevision})`);
  printEffectiveStatusField(snapshot, "/domain", "Domain", "—");
  printEffectiveStatusField(snapshot, "/requireApproval", "Require Approval", true);
  printEffectiveStatusField(snapshot, "/maxDepth", "Max Depth", 3);
  printEffectiveStatusField(snapshot, "/parallelWorkers", "Parallel Workers", 2);
  printEffectiveStatusField(snapshot, "/provider", "Provider", "—");

  const globalConfig = readGlobalConfig();
  const projectConfig = snapshot.project.kilnYaml.status === "valid"
    ? readKilnYamlFile(binding.configPath)
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

  const { registry } = createDefaultRegistry({ kilnHome: binding.kilnHome });
  const builtinToolOptions = createSessionBuiltinToolOptions();
  const managedAgentProviderModels = await discoverManagedAgentProviderModels();
  const managedInvocationConfig = globalConfig
    ? {
      ...globalConfig,
      executionCatalog: readGlobalExecutionTargetCatalog(globalConfig) ?? undefined,
      managedAgents: config.managedAgents ?? globalConfig.managedAgents,
    }
    : config;
  const managedInvocationResolution = await resolveManagedInvocationToolOptions(managedInvocationConfig, {
        cwd: root,
        registry,
        surface: "operator",
        isProviderAvailable: (provider) => engineAvailability.get(provider),
        providerModelEligibility: managedAgentProviderModels,
        builtinToolOptions,
        compositionMode: "candidate-admission",
      });
  if (managedInvocationResolution.routeHealth.length > 0) {
    console.log(`\n  Managed execution targets:`);
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

  printSkillCatalogStatus(snapshot.setup.skills, config.skills?.selection?.mode ?? "advisory");

  const setupActions = snapshot.setup.recommendedActions.filter((action) => action !== "none");
  if (setupActions.length > 0) {
    console.log(`\n  Setup actions:`);
    for (const action of setupActions) {
      console.log(`    - ${action}`);
    }
  }

  const memoryDir = binding.memoryPath;
  if (existsSync(memoryDir)) {
    const files = readdirSync(memoryDir);
    console.log(`\n  Memory files:     ${files.length}`);
  }

  console.log("");
}

function printEffectiveStatusField(
  snapshot: Awaited<ReturnType<typeof readConfigStatusSnapshot>>,
  identity: string,
  label: string,
  fallback: unknown,
): void {
  const field = effectiveConfigField(snapshot.effectiveConfig, identity);
  const value = field?.sensitivity === "public" ? field.value : fallback;
  console.log(`  ${`${label}:`.padEnd(18)} ${String(value ?? fallback)} [${field?.source ?? "unknown"}]`);
}

function printInteractiveUseStatus(config: ResolvedKilnConfig): void {
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
  config: ResolvedKilnConfig,
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
  skills: KilnSkillCatalogSummarySnapshot | undefined,
  selectionMode: string,
): void {
  if (!skills) {
    return;
  }
  console.log(`\n  Skill catalog:`);
  console.log(`    Selection mode: ${selectionMode}`);
  console.log(`    Inventory: ${skills.complete ? "complete" : "incomplete"}`);
  console.log(`    Duplicates: ${skills.equivalentDuplicates}`);
  console.log(`    Collisions: divergent=${skills.divergentCollisions}, case=${skills.caseCollisions}`);
  for (const exposure of (skills.externalExposure ?? []).filter((entry) => entry.status !== "not-configured")) {
    console.log(`    External ${exposure.harness}: ${exposure.status}, implicit=${exposure.realizedImplicit}, suppressed=${exposure.suppressed}, freshness=${exposure.freshness}`);
  }
  for (const harness of skills.harnesses) {
    console.log(`    ${harness.harness}: ${harness.candidateCount} implicit skills, ${harness.descriptionBytes} description bytes, budget=${harness.budget.status}`);
  }
  for (const issue of [...skills.issues].sort(compareSkillIssue)) {
    console.log(`    issue: skill=${issue.skillName}, harness=${issue.harness}, kind=${issue.kind}, status=${issue.projectionState}, path=${issue.path}`);
  }
  if (skills.omittedIssueCount > 0) console.log(`    ... ${skills.omittedIssueCount} more skill issues omitted (${skills.issueCount} total)`);
}

function compareSkillIssue(left: KilnSkillCatalogSummarySnapshot["issues"][number], right: KilnSkillCatalogSummarySnapshot["issues"][number]): number {
  return left.skillName.localeCompare(right.skillName) || left.harness.localeCompare(right.harness)
    || left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path);
}
