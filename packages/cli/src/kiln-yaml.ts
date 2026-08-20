import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { KilnYamlError } from "./kiln-yaml-types.js";
import { readMcpConfigurationSource } from "./config/mcp-config.js";
import { resolveCommunicationIntent } from "@kilnai/core";
import type {
  ResolvedKilnConfig,
  KilnProjectConfig,
  KilnYamlMcp,
  KilnYamlMcpServer,
  KilnYamlWebConfig,
  KilnYamlInteractiveUseConfig,
  KilnYamlSkillsConfig,
  KilnYamlBuiltinSkillsConfig,
  KilnYamlSkillSelectionConfig,
  KilnYamlSkillVisibilityConfig,
  KilnWorkGovernanceConfig,
  KilnWorkGovernanceTrigger,
  KilnWorkGovernanceEvidence,
  KilnYamlQualityGate,
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

const PROJECT_ROOT_FIELDS = new Set([
  "version",
  "activeInstructionProfiles",
  "workGovernance",
  "domain",
  "channels",
  "teamMode",
  "requireApproval",
  "maxDepth",
  "parallelWorkers",
  "mcp",
  "permissions",
  "communication",
  "web",
  "interactiveUse",
  "skills",
  "qualityGates",
  "contextGovernance",
]);

export function readKilnYaml(kilnDir: string): KilnProjectConfig | null {
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
    const record = parsed as Record<string, unknown>;
    const unknownField = Object.keys(record).find((field) => !PROJECT_ROOT_FIELDS.has(field));
    if (unknownField) {
      throw new KilnYamlError(`${unknownField} is global-only or is not a supported project configuration field`);
    }
    validateQualityGates(record.qualityGates);
    const workGovernance = record.workGovernance;
    if (
      typeof workGovernance === "object"
      && workGovernance !== null
      && !Array.isArray(workGovernance)
      && Object.prototype.hasOwnProperty.call(workGovernance, "boundedWorkCeiling")
    ) {
      throw new KilnYamlError("workGovernance.boundedWorkCeiling is global-only");
    }
    readMcpConfigurationSource({
      value: record.mcp,
      scope: "project",
      sourcePath: path,
    });
    const skills = record.skills;
    if (skills !== undefined && (typeof skills !== "object" || skills === null || Array.isArray(skills))) {
      throw new KilnYamlError("skills must be an object");
    }
    if ((skills as Record<string, unknown> | undefined)?.visibility !== undefined) {
      throw new KilnYamlError(
        "skills.visibility is global-only because native skill targets are user-global; project-scoped visibility requires scoped harness projections",
      );
    }
    if ((skills as Record<string, unknown> | undefined)?.externalCatalog !== undefined) {
      throw new KilnYamlError("skills.externalCatalog is global-only because it governs user-global native harness exposure");
    }
    if ((parsed as Record<string, unknown>).communication !== undefined) {
      try {
        resolveCommunicationIntent([{
          source: "project",
          intent: (parsed as KilnProjectConfig).communication!,
        }]);
      } catch (error) {
        throw new KilnYamlError(`communication is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return parsed as KilnProjectConfig;
  } catch (err) {
    if (err instanceof KilnYamlError) {
      throw err;
    }
    throw new KilnYamlError(
      `Failed to parse kiln.yaml: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function validateQualityGates(value: unknown): asserts value is readonly KilnYamlQualityGate[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new KilnYamlError("qualityGates must be an array");
  }
  const allowedFields = new Set(["name", "command", "required"]);
  for (const [index, gate] of value.entries()) {
    if (typeof gate !== "object" || gate === null || Array.isArray(gate)) {
      throw new KilnYamlError(`qualityGates[${index}] must be an object`);
    }
    const record = gate as Record<string, unknown>;
    const unknownField = Object.keys(record).find((field) => !allowedFields.has(field));
    if (unknownField) {
      throw new KilnYamlError(`qualityGates[${index}].${unknownField} is an unknown field`);
    }
    if (typeof record.name !== "string" || record.name.trim() === "") {
      throw new KilnYamlError(`qualityGates[${index}].name must be a non-empty string`);
    }
    if (typeof record.command !== "string" || record.command.trim() === "") {
      throw new KilnYamlError(`qualityGates[${index}].command must be a non-empty string`);
    }
    if (record.required !== undefined && typeof record.required !== "boolean") {
      throw new KilnYamlError(`qualityGates[${index}].required must be a boolean`);
    }
  }
}

export function writeKilnYaml(kilnDir: string, config: KilnProjectConfig): void {
  if (!existsSync(kilnDir)) {
    mkdirSync(kilnDir, { recursive: true });
  }
  const path = join(kilnDir, "kiln.yaml");
  writeFileSync(path, stringify(config), "utf-8");
}

export function mergeKilnYaml(base: ResolvedKilnConfig, override: KilnProjectConfig): ResolvedKilnConfig {
  if (override.workGovernance && Object.prototype.hasOwnProperty.call(override.workGovernance, "boundedWorkCeiling")) {
    throw new Error("Project workGovernance.boundedWorkCeiling is global-only.");
  }
  return {
    version: override.version ?? base.version ?? "1",
    activeInstructionProfiles: mergeStringList(base.activeInstructionProfiles, override.activeInstructionProfiles),
    workGovernance: mergeWorkGovernance(base.workGovernance, override.workGovernance),
    domain: override.domain ?? base.domain,
    provider: base.provider,
    channels: override.channels ?? base.channels,
    teamMode: override.teamMode ?? base.teamMode,
    requireApproval: override.requireApproval ?? base.requireApproval,
    maxDepth: override.maxDepth ?? base.maxDepth,
    parallelWorkers: override.parallelWorkers ?? base.parallelWorkers,
    mcp: mergeMcp(base.mcp, override.mcp),
    model: base.model,
    permissions: override.permissions ?? base.permissions,
    qualityGates: override.qualityGates ?? base.qualityGates,
    providers: base.providers,
    managedAgents: base.managedAgents,
    modelTaskSuitability: base.modelTaskSuitability,
    deliberationPolicy: base.deliberationPolicy,
    communication: mergeCommunication(base.communication, override.communication),
    web: mergeWeb(base.web, override.web),
    interactiveUse: mergeInteractiveUse(base.interactiveUse, override.interactiveUse),
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
  const builtin = mergeBuiltinSkills(base?.builtin, override?.builtin);
  const selection = mergeSkillSelection(base?.selection, override?.selection);
  const visibility = mergeSkillVisibility(base?.visibility, override?.visibility);
  return {
    ...(builtin ? { builtin } : {}),
    ...(selection ? { selection } : {}),
    ...(visibility ? { visibility } : {}),
    ...(base?.externalCatalog ? { externalCatalog: base.externalCatalog } : {}),
  };
}

function mergeSkillVisibility(
  base: KilnYamlSkillVisibilityConfig | undefined,
  override: KilnYamlSkillVisibilityConfig | undefined,
): KilnYamlSkillVisibilityConfig | undefined {
  if (!base && !override) return undefined;
  const defaultVisibility = override?.default ?? base?.default;
  return {
    ...(defaultVisibility ? { default: defaultVisibility } : {}),
    ...((base?.overrides || override?.overrides) ? {
      overrides: { ...base?.overrides, ...override?.overrides },
    } : {}),
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
