import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { KilnYamlError, validateAgentScopeInheritance } from "./kiln-yaml-types.js";
import { readMcpConfigurationSource } from "./config/mcp-config.js";
import { parseProjectConfigStructure } from "./config/project-config-schema.js";
import { resolveCommunicationIntent } from "@kilnai/core";
import type {
  ResolvedKilnConfig,
  KilnProjectConfig,
  KilnYamlMcp,
  KilnYamlMcpServer,
  KilnYamlWebConfig,
  KilnYamlSkillsConfig,
  KilnYamlBuiltinSkillsConfig,
  KilnYamlSkillSelectionConfig,
  KilnWorkGovernanceConfig,
  KilnWorkGovernanceTrigger,
  KilnWorkGovernanceEvidence,
} from "./kiln-yaml-types.js";
export { KilnYamlError } from "./kiln-yaml-types.js";
export { validateKilnHooks } from "./kiln-yaml-types.js";
export type {
  ResolvedKilnConfig,
  KilnProjectConfig,
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
  KilnYamlSkillVisibility,
  KilnYamlSkillVisibilityConfig,
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

/** Reads the private canonical project config from its explicit file path. */
export function readKilnYamlFile(configPath: string): KilnProjectConfig | null {
  return readKilnYamlFileSnapshot(configPath).config;
}

/** Reads project bytes once from an explicit canonical config file path. */
export function readKilnYamlFileSnapshot(configPath: string): {
  readonly config: KilnProjectConfig | null;
  readonly revision: `sha256:${string}` | "absent";
} {
  const path = configPath;
  if (!existsSync(path)) {
    return { config: null, revision: "absent" };
  }
  const raw = readFileSync(path, "utf-8");
  return {
    config: parseKilnYamlRaw(raw, path),
    revision: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
  };
}

function parseKilnYamlRaw(raw: string, path: string): KilnProjectConfig {
  try {
    const parsed = parseProjectConfigStructure(parse(raw), path);
    validateAgentScopeInheritance(parsed.permissions);
    const workGovernance = parsed.workGovernance;
    if (
      typeof workGovernance === "object"
      && workGovernance !== null
      && !Array.isArray(workGovernance)
      && Object.prototype.hasOwnProperty.call(workGovernance, "boundedWorkCeiling")
    ) {
      throw new KilnYamlError("workGovernance.boundedWorkCeiling is global-only");
    }
    readMcpConfigurationSource({
      value: parsed.mcp,
      scope: "project",
      sourcePath: path,
    });
    for (const [serverId, server] of Object.entries(parsed.mcp?.servers ?? {})) {
      if (server.enabled === true) {
        throw new KilnYamlError(`Project MCP server '${serverId}' cannot enable a global connection.`);
      }
    }
    if (parsed.communication !== undefined) {
      try {
        resolveCommunicationIntent([{
          source: "project",
          intent: parsed.communication,
        }]);
      } catch (error) {
        throw new KilnYamlError(`communication is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return parsed;
  } catch (err) {
    if (err instanceof KilnYamlError) {
      throw err;
    }
    throw new KilnYamlError(
      `Failed to parse kiln.yaml: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function mergeKilnYaml(base: ResolvedKilnConfig, override: KilnProjectConfig): ResolvedKilnConfig {
  if (override.workGovernance && Object.prototype.hasOwnProperty.call(override.workGovernance, "boundedWorkCeiling")) {
    throw new Error("Project workGovernance.boundedWorkCeiling is global-only.");
  }
  return {
    version: override.version ?? base.version ?? "1",
    // Project profiles are an admitted subset of the global ceiling. An
    // explicit project list therefore narrows by replacement; unioning it
    // with the base would silently restore profiles the project removed.
    activeInstructionProfiles: override.activeInstructionProfiles ?? base.activeInstructionProfiles,
    workGovernance: mergeWorkGovernance(base.workGovernance, override.workGovernance),
    domain: override.domain ?? base.domain,
    provider: base.provider,
    channels: override.channels ?? base.channels,
    maxDepth: override.maxDepth ?? base.maxDepth,
    parallelWorkers: override.parallelWorkers ?? base.parallelWorkers,
    mcp: mergeMcp(base.mcp, override.mcp),
    model: base.model,
    permissions: mergePermissions(base.permissions, override.permissions),
    providers: base.providers,
    managedAgents: base.managedAgents,
    modelTaskSuitability: base.modelTaskSuitability,
    deliberationPolicy: base.deliberationPolicy,
    communication: mergeCommunication(base.communication, override.communication),
    web: mergeWeb(base.web, override.web),
    interactiveUse: base.interactiveUse,
    skills: mergeSkills(base.skills, override.skills),
    contextGovernance: override.contextGovernance ?? base.contextGovernance,
    hooks: base.hooks,
    targetCatalog: base.targetCatalog,
    authorityProfiles: base.authorityProfiles,
  };
}

function mergeWorkGovernance(
  base: KilnWorkGovernanceConfig | undefined,
  override: KilnWorkGovernanceConfig | undefined,
): KilnWorkGovernanceConfig | undefined {
  if (!base && !override) return undefined;
  return {
    defaultPosture: override?.defaultPosture ?? base?.defaultPosture,
    requireDelegationFor: mergeStringList(base?.requireDelegationFor, override?.requireDelegationFor) as
      | readonly KilnWorkGovernanceTrigger[]
      | undefined,
    requiredEvidence: mergeStringList(base?.requiredEvidence, override?.requiredEvidence) as
      | readonly KilnWorkGovernanceEvidence[]
      | undefined,
    boundedWorkCeiling: base?.boundedWorkCeiling,
  };
}

/**
 * Preserve the global permission dimensions when a project only supplies a
 * partial permissions object.  Admission of authority-bearing project
 * dimensions is handled by config-merger; this function is deliberately a
 * presence-preserving structural merge and never treats omission as removal.
 */
function mergePermissions(
  base: ResolvedKilnConfig["permissions"],
  override: KilnProjectConfig["permissions"],
): ResolvedKilnConfig["permissions"] {
  if (!base && !override) return undefined;
  if (!override) return base;

  const projectSafe = {
    ...(override.approval === undefined ? {} : { approval: override.approval }),
    ...(override.sandbox === undefined ? {} : { sandbox: override.sandbox }),
  };
  return {
    ...(base ?? {}),
    ...projectSafe,
  };
}

function mergeCommunication(
  base: ResolvedKilnConfig["communication"],
  override: ResolvedKilnConfig["communication"],
): ResolvedKilnConfig["communication"] {
  if (!base && !override) return undefined;
  return resolveCommunicationIntent([
    ...(override ? [{ source: "project" as const, intent: override }] : []),
    ...(base ? [{ source: "global" as const, intent: base }] : []),
  ]).intent;
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
  override: KilnProjectConfig["web"] | undefined,
): KilnYamlWebConfig | undefined {
  if (!base && !override) return undefined;
  return {
    // Provider identity and credentials are global-owned. Copying the whole
    // project object here would silently reintroduce those authority fields
    // for callers that bypass the YAML schema parser.
    ...(base ?? {}),
    enabled: override?.enabled ?? base?.enabled,
    netPolicy: override?.netPolicy ?? base?.netPolicy,
    allowedDomains: override?.allowedDomains
      ?? (override?.netPolicy === undefined ? base?.allowedDomains : undefined),
  };
}

function mergeSkills(
  base: KilnYamlSkillsConfig | undefined,
  override: KilnYamlSkillsConfig | undefined,
): KilnYamlSkillsConfig | undefined {
  if (!base && !override) return undefined;
  const builtin = mergeBuiltinSkills(base?.builtin, override?.builtin);
  const selection = mergeSkillSelection(base?.selection, override?.selection);
  return {
    ...(builtin ? { builtin } : {}),
    ...(selection ? { selection } : {}),
    // Visibility and external-catalog policy are global-only. Preserve the
    // global projection, but never accept either field from project input.
    ...(base?.visibility ? { visibility: base.visibility } : {}),
    ...(base?.externalCatalog ? { externalCatalog: base.externalCatalog } : {}),
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
    // A project include list is an admitted subset and therefore replaces the
    // global ceiling. Unioning it with the global list would erase narrowing.
    include: override?.include === undefined
      ? mergeStringList(undefined, base?.include)
      : mergeStringList(undefined, override.include),
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
    if (overrideServer !== undefined && baseServer === undefined) {
      throw new Error(`Project-only MCP server '${name}' is not admitted by global configuration.`);
    }
    if (overrideServer?.enabled === true) {
      throw new Error(`Project MCP server '${name}' cannot enable a global connection.`);
    }
    if (overrideServer?.maxCapabilities !== undefined) {
      if (baseServer?.maxCapabilities === undefined) {
        throw new Error(`Project MCP maxCapabilities for '${name}' has no global catalog limit.`);
      }
      if (overrideServer.maxCapabilities > baseServer.maxCapabilities) {
        throw new Error(`Project MCP maxCapabilities for '${name}' cannot exceed the global catalog limit.`);
      }
    }
    if (
      baseServer?.admission?.state === "denied"
      && overrideServer?.admission?.state === "admitted"
    ) {
      throw new Error(`Project MCP admission for '${name}' cannot enable a globally denied server.`);
    }
    if (overrideServer?.admission !== undefined) {
      const globalAdmission = baseServer?.admission;
      if (globalAdmission === undefined) {
        throw new Error(`Project MCP admission for '${name}' has no global capability ceiling.`);
      }
      for (const kind of ["tools", "resources", "prompts"] as const) {
        const globalAllow = globalAdmission[kind]?.allow;
        const projectAllow = overrideServer.admission[kind]?.allow;
        if (globalAllow && projectAllow?.some((entry) => !globalAllow.includes(entry))) {
          throw new Error(`Project MCP ${kind} admission for '${name}' must be equal to or narrower than global.`);
        }
        const globalDeny = new Set(globalAdmission[kind]?.deny ?? []);
        if (projectAllow?.some((entry) => globalDeny.has(entry))) {
          throw new Error(`Project MCP ${kind} admission for '${name}' cannot re-enable globally denied capabilities.`);
        }
      }
    }
    const admission = mergeMcpAdmission(baseServer?.admission, overrideServer?.admission);
    servers[name] = {
      // Only global-owned connection fields come from the base. Project input
      // can contribute disablement, a bounded catalog limit, and narrower
      // admission lists; it can never replace transport or credentials.
      ...baseServer,
      ...(overrideServer?.enabled !== undefined ? { enabled: overrideServer.enabled } : {}),
      ...(overrideServer?.maxCapabilities !== undefined ? { maxCapabilities: overrideServer.maxCapabilities } : {}),
      ...(admission !== undefined ? { admission } : {}),
    };
  }
  return { servers };
}

function mergeMcpAdmission(
  base: KilnYamlMcpServer["admission"],
  override: KilnYamlMcpServer["admission"],
): KilnYamlMcpServer["admission"] {
  if (!base && !override) return undefined;
  const state = override?.state ?? base?.state;
  if (state === undefined) return undefined;
  return {
    state,
    ...(["tools", "resources", "prompts"] as const).reduce((merged, kind) => {
      const policy = mergeMcpAdmissionList(base?.[kind], override?.[kind]);
      return policy === undefined ? merged : { ...merged, [kind]: policy };
    }, {} as Record<string, unknown>),
  } as KilnYamlMcpServer["admission"];
}

function mergeMcpAdmissionList(
  base: NonNullable<KilnYamlMcpServer["admission"]>["tools"],
  override: NonNullable<KilnYamlMcpServer["admission"]>["tools"],
): NonNullable<KilnYamlMcpServer["admission"]>["tools"] {
  if (!base && !override) return undefined;
  const allow = override?.allow ?? base?.allow;
  const deny = mergeStringList(base?.deny, override?.deny);
  return {
    ...(allow === undefined ? {} : { allow }),
    ...(deny === undefined ? {} : { deny }),
  };
}

export function defaultKilnYaml(domain: string): KilnProjectConfig {
  return {
    version: "1",
    domain,
    permissions: {
      approval: "on-request",
      sandbox: "read-only",
    },
  };
}
