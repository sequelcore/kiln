import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { KilnYamlError } from "./kiln-yaml-types.js";
import { readMcpConfigurationSource } from "./config/mcp-config.js";
import type {
  KilnYaml,
  KilnModelTaskSuitabilityOverride,
  KilnYamlMcp,
  KilnYamlMcpServer,
  KilnYamlWebConfig,
  KilnYamlInteractiveUseConfig,
  KilnYamlSkillsConfig,
  KilnYamlBuiltinSkillsConfig,
  KilnYamlSkillSelectionConfig,
  KilnWorkGovernanceConfig,
  KilnWorkGovernanceTrigger,
  KilnWorkGovernanceEvidence,
  KilnDeliberationPolicyConfig,
  KilnDeliberationRouteRuleConfig,
} from "./kiln-yaml-types.js";
export { KilnYamlError } from "./kiln-yaml-types.js";
export { validateKilnHooks } from "./kiln-yaml-types.js";
export type {
  KilnYaml,
  KilnYamlMcp,
  KilnYamlMcpServer,
  KilnYamlModel,
  KilnContextGovernanceConfig,
  KilnContextGovernanceSource,
  KilnContextGovernanceAggressiveness,
  KilnContextGovernanceCachePolicy,
  KilnYamlPermissions,
  KilnYamlToolRule,
  KilnYamlCommandRule,
  KilnYamlFileGovernance,
  KilnYamlDataFirewallRule,
  KilnYamlAgentScope,
  KilnYamlProvider,
  KilnYamlSkillGeneration,
  KilnYamlSkillsConfig,
  KilnYamlBuiltinSkillsConfig,
  KilnYamlSkillSelectionConfig,
  KilnYamlSkillSelectionMode,
  KilnWorkGovernanceConfig,
  KilnWorkGovernancePosture,
  KilnWorkGovernanceRisk,
  KilnWorkGovernanceTrigger,
  KilnWorkGovernanceEvidence,
  KilnDeliberationMode,
  KilnDeliberationTarget,
  KilnUnsupportedDeliberationPolicy,
  KilnDeliberationBoundsConfig,
  KilnDeliberationRuleConfig,
  KilnDeliberationRouteRuleConfig,
  KilnDeliberationPolicyConfig,
  KilnModelTaskSuitabilityOverride,
  KilnModelTaskSuitabilityLevel,
  KilnModelTaskSuitabilityTask,
  KilnYamlWebConfig,
  KilnYamlInteractiveUseConfig,
  KilnManagedAgentsConfig,
  KilnHooksConfig,
} from "./kiln-yaml-types.js";

export function readKilnYaml(kilnDir: string): KilnYaml | null {
  const path = join(kilnDir, "kiln.yaml");
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  try {
    const parsed = parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      throw new KilnYamlError("kiln.yaml must be an object");
    }
    readMcpConfigurationSource({
      value: (parsed as Record<string, unknown>).mcp,
      scope: "project",
      sourcePath: path,
    });
    return parsed as KilnYaml;
  } catch (err) {
    if (err instanceof KilnYamlError) {
      throw err;
    }
    throw new KilnYamlError(
      `Failed to parse kiln.yaml: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function writeKilnYaml(kilnDir: string, config: KilnYaml): void {
  if (!existsSync(kilnDir)) {
    mkdirSync(kilnDir, { recursive: true });
  }
  const path = join(kilnDir, "kiln.yaml");
  writeFileSync(path, stringify(config), "utf-8");
}

export function mergeKilnYaml(base: KilnYaml, override: Partial<KilnYaml>): KilnYaml {
  return {
    version: override.version ?? base.version ?? "1",
    activeInstructionProfiles: mergeStringList(base.activeInstructionProfiles, override.activeInstructionProfiles),
    workGovernance: mergeWorkGovernance(base.workGovernance, override.workGovernance),
    domain: override.domain ?? base.domain,
    provider: override.provider ?? base.provider,
    channels: override.channels ?? base.channels,
    teamMode: override.teamMode ?? base.teamMode,
    requireApproval: override.requireApproval ?? base.requireApproval,
    maxDepth: override.maxDepth ?? base.maxDepth,
    parallelWorkers: override.parallelWorkers ?? base.parallelWorkers,
    mode: override.mode ?? base.mode,
    mcp: mergeMcp(base.mcp, override.mcp),
    model: override.model ?? base.model,
    permissions: override.permissions ?? base.permissions,
    providers: override.providers ?? base.providers,
    managedAgents: override.managedAgents ?? base.managedAgents,
    modelTaskSuitability: mergeModelTaskSuitability(base.modelTaskSuitability, override.modelTaskSuitability),
    deliberationPolicy: mergeDeliberationPolicy(base.deliberationPolicy, override.deliberationPolicy),
    web: mergeWeb(base.web, override.web),
    interactiveUse: mergeInteractiveUse(base.interactiveUse, override.interactiveUse),
    skills: mergeSkills(base.skills, override.skills),
    contextGovernance: override.contextGovernance ?? base.contextGovernance,
    hooks: override.hooks ?? base.hooks,
  };
}

function mergeWorkGovernance(
  base: KilnWorkGovernanceConfig | undefined,
  override: KilnWorkGovernanceConfig | undefined,
): KilnWorkGovernanceConfig | undefined {
  if (!base && !override) return undefined;
  return {
    defaultPosture: override?.defaultPosture ?? base?.defaultPosture,
    directExecution: base?.directExecution || override?.directExecution
      ? {
        ...base?.directExecution,
        ...override?.directExecution,
      }
      : undefined,
    requireDelegationFor: mergeStringList(base?.requireDelegationFor, override?.requireDelegationFor) as
      | readonly KilnWorkGovernanceTrigger[]
      | undefined,
    requiredEvidence: mergeStringList(base?.requiredEvidence, override?.requiredEvidence) as
      | readonly KilnWorkGovernanceEvidence[]
      | undefined,
  };
}

function mergeDeliberationPolicy(
  base: KilnDeliberationPolicyConfig | undefined,
  override: KilnDeliberationPolicyConfig | undefined,
): KilnDeliberationPolicyConfig | undefined {
  if (!base && !override) return undefined;
  const routes = new Map<string, KilnDeliberationRouteRuleConfig>();
  for (const entry of [...(base?.byRoute ?? []), ...(override?.byRoute ?? [])]) {
    routes.set(`${entry.provider}/${entry.model}`, entry);
  }
  return {
    default: override?.default ?? base?.default,
    byTask: {
      ...(base?.byTask ?? {}),
      ...(override?.byTask ?? {}),
    },
    byRoute: [...routes.values()],
  };
}

function mergeModelTaskSuitability(
  base: readonly KilnModelTaskSuitabilityOverride[] | undefined,
  override: readonly KilnModelTaskSuitabilityOverride[] | undefined,
): readonly KilnModelTaskSuitabilityOverride[] | undefined {
  if (!base && !override) return undefined;
  const merged = new Map<string, KilnModelTaskSuitabilityOverride>();
  for (const entry of [...(base ?? []), ...(override ?? [])]) {
    merged.set(`${entry.provider}/${entry.model}/${entry.task}`, entry);
  }
  return [...merged.values()];
}

function mergeStringList(
  base: readonly string[] | undefined,
  override: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!base && !override) return undefined;
  const values = new Set<string>();
  for (const entry of [...(base ?? []), ...(override ?? [])]) {
    const normalized = entry.trim();
    if (normalized.length > 0) {
      values.add(normalized);
    }
  }
  return [...values];
}

function mergeWeb(
  base: KilnYamlWebConfig | undefined,
  override: KilnYamlWebConfig | undefined,
): KilnYamlWebConfig | undefined {
  if (!base && !override) return undefined;
  return {
    ...base,
    ...override,
    searchProvider: override?.searchProvider ?? base?.searchProvider,
    searchFallbackProviders: override?.searchFallbackProviders ?? base?.searchFallbackProviders,
    extractProvider: override?.extractProvider ?? base?.extractProvider,
    allowedDomains: override?.allowedDomains ?? base?.allowedDomains,
  };
}

function mergeInteractiveUse(
  base: KilnYamlInteractiveUseConfig | undefined,
  override: KilnYamlInteractiveUseConfig | undefined,
): KilnYamlInteractiveUseConfig | undefined {
  if (!base && !override) return undefined;
  const browserEnvironment = override?.browserEnvironment ?? base?.browserEnvironment;
  const computerEnvironment = override?.computerEnvironment ?? base?.computerEnvironment;
  return {
    ...base,
    ...override,
    allowedDomains: override?.allowedDomains ?? base?.allowedDomains,
    allowedApplications: override?.allowedApplications ?? base?.allowedApplications,
    applicationAliases: override?.applicationAliases ?? base?.applicationAliases,
    ...(browserEnvironment ? { browserEnvironment } : {}),
    ...(computerEnvironment ? { computerEnvironment } : {}),
  };
}

function mergeSkills(
  base: KilnYamlSkillsConfig | undefined,
  override: KilnYamlSkillsConfig | undefined,
): KilnYamlSkillsConfig | undefined {
  if (!base && !override) return undefined;
  return {
    builtin: mergeBuiltinSkills(base?.builtin, override?.builtin),
    selection: mergeSkillSelection(base?.selection, override?.selection),
  };
}

function mergeSkillSelection(
  base: KilnYamlSkillSelectionConfig | undefined,
  override: KilnYamlSkillSelectionConfig | undefined,
): KilnYamlSkillSelectionConfig | undefined {
  if (!base && !override) return undefined;
  return {
    mode: override?.mode ?? base?.mode,
  };
}

function mergeBuiltinSkills(
  base: KilnYamlBuiltinSkillsConfig | undefined,
  override: KilnYamlBuiltinSkillsConfig | undefined,
): KilnYamlBuiltinSkillsConfig | undefined {
  if (!base && !override) return undefined;
  return {
    enabled: override?.enabled ?? base?.enabled,
    include: mergeStringList(base?.include, override?.include),
    exclude: mergeStringList(base?.exclude, override?.exclude),
  };
}

function mergeMcp(
  base: KilnYamlMcp | undefined,
  override: KilnYamlMcp | undefined,
): KilnYamlMcp | undefined {
  if (!base && !override) return undefined;
  const allNames = new Set([
    ...Object.keys(base?.servers ?? {}),
    ...Object.keys(override?.servers ?? {}),
  ]);
  const servers: Record<string, KilnYamlMcpServer> = {};
  for (const name of allNames) {
    const baseServer = base?.servers?.[name];
    const overrideServer = override?.servers?.[name];
    servers[name] = {
      ...baseServer,
      ...overrideServer,
    };
  }
  return { servers };
}

export function migrateConfigJson(kilnDir: string): boolean {
  const configJsonPath = join(kilnDir, "config.json");
  if (!existsSync(configJsonPath)) {
    return false;
  }
  const raw = readFileSync(configJsonPath, "utf-8");
  const config = JSON.parse(raw) as {
    domain?: string;
    provider?: string;
    channels?: string[];
    teamMode?: string;
    requireApproval?: boolean;
    maxDepth?: number;
    parallelWorkers?: number;
    mode?: string;
  };
  const kilnYaml: KilnYaml = {
    version: "1",
    domain: config.domain,
    provider: config.provider,
    channels: config.channels,
    teamMode: config.teamMode,
    requireApproval: config.requireApproval,
    maxDepth: config.maxDepth,
    parallelWorkers: config.parallelWorkers,
    mode: config.mode,
    permissions: {
      approval: config.requireApproval ? "on-request" : "never",
      sandbox: "read-only",
    },
  };
  writeKilnYaml(kilnDir, kilnYaml);
  rmSync(configJsonPath);
  return true;
}

export function defaultKilnYaml(domain: string): KilnYaml {
  return {
    version: "1",
    domain,
    provider: "claude",
    mode: "api-key",
    permissions: {
      approval: "on-request",
      sandbox: "read-only",
    },
  };
}
