import {
  readGlobalConfig,
  resolveGlobalConfigPath,
  resolveGlobalDefaultModel,
  resolveGlobalDefaultProvider,
} from "./global-config.js";
import { mergeKilnYaml, readKilnYamlFile } from "../kiln-yaml.js";
import { parseProjectConfigStructure } from "./project-config-schema.js";
import { DEFAULT_WORK_GOVERNANCE_CONFIG, KilnYamlError, type KilnProjectConfig, type ResolvedKilnConfig, type KilnYamlWebConfig } from "../kiln-yaml-types.js";
import type { KilnGlobalConfig } from "./global-config.js";
import { validateGlobalConfig } from "./global-config/admission/index.js";
import {
  resolveMcpConfiguration,
  type McpConfigurationResolution,
} from "@kilnai/core";
import { readMcpConfigurationSource } from "./mcp-config.js";
import { createMcpCredentialAccess } from "./mcp-credentials.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  type ProjectStateBinding,
  type ProjectStateRootOptions,
  resolveProjectStateBinding,
} from "../application/project-state-root.js";

export interface ProjectConfigLoadOptions extends ProjectStateRootOptions {
  /** Pre-resolved binding seam for callers that already established identity. */
  readonly projectStateBinding?: ProjectStateBinding;
  /** Already-captured global authority; avoids reopening any ambient namespace. */
  readonly globalConfig?: KilnGlobalConfig | null;
}

export interface GlobalConfigSnapshot {
  readonly config: KilnGlobalConfig | null;
  readonly revision: `sha256:${string}` | "absent";
}

/** Read global authority from an explicit path selected by the caller. */
export function readGlobalConfigSnapshotAtPath(configPath: string): GlobalConfigSnapshot {
  const raw = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null;
  if (raw === null) return { config: null, revision: "absent" };
  try {
    const parsed: unknown = parse(raw);
    validateGlobalConfig(parsed);
    return {
      config: parsed,
      revision: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    };
  } catch (error) {
    if (error instanceof KilnYamlError) throw error;
    throw new KilnYamlError(
      `Failed to parse global config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function usesExplicitProjectBinding(options: ProjectConfigLoadOptions): boolean {
  return options.projectStateBinding !== undefined || options.kilnHome !== undefined;
}

export interface ResolveKilnMcpConfigurationInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly globalPath: string;
  readonly projectConfig?: KilnProjectConfig | null;
  readonly projectPath: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly credentialExists?: (credentialId: string) => boolean;
}

export function resolveKilnMcpConfiguration(
  input: ResolveKilnMcpConfigurationInput,
): McpConfigurationResolution {
  if (input.projectConfig !== undefined && input.projectConfig !== null) {
    parseProjectConfigStructure(input.projectConfig, input.projectPath);
  }
  assertProjectMcpServersAreGloballyDefined(input.globalConfig ?? null, input.projectConfig ?? null);
  const global = readMcpConfigurationSource({
    value: input.globalConfig?.mcp,
    scope: "global",
    sourcePath: input.globalPath,
  });
  const project = readMcpConfigurationSource({
    value: input.projectConfig?.mcp,
    scope: "project",
    sourcePath: input.projectPath,
  });
  return resolveMcpConfiguration({
    ...(global ? { global } : {}),
    ...(project ? { project } : {}),
    ...(input.environment ? { environment: input.environment } : {}),
    ...(input.credentialExists ? { credentialExists: input.credentialExists } : {}),
  });
}

export function loadResolvedKilnMcpConfiguration(
  projectPath: string,
  options: ProjectConfigLoadOptions = {},
): McpConfigurationResolution {
  const binding = resolveProjectBinding(projectPath, options);
  // The project binding is the authority selected by the caller. Credential
  // admission must inspect that same Kiln home rather than reopening the
  // ambient XDG namespace at effect time.
  const credentials = createMcpCredentialAccess(process.env, binding.kilnHome);
  const explicitBinding = usesExplicitProjectBinding(options);
  const globalPath = explicitBinding
    ? join(binding.kilnHome, "config.yaml")
    : resolveGlobalConfigPath();
  const globalConfig = options.globalConfig !== undefined
    ? options.globalConfig
    : explicitBinding
      ? readGlobalConfigSnapshotAtPath(globalPath).config
      : readGlobalConfig();
  return resolveKilnMcpConfiguration({
    globalConfig,
    globalPath,
    projectConfig: readKilnYamlFile(binding.configPath),
    projectPath: binding.configPath,
    environment: process.env,
    credentialExists: credentials.exists,
  });
}

export function globalToKilnYaml(global: KilnGlobalConfig): ResolvedKilnConfig {
  const model = resolveGlobalDefaultModel(global);
  return {
    version: "1",
    ...(global.activeInstructionProfiles ? { activeInstructionProfiles: global.activeInstructionProfiles } : {}),
    workGovernance: global.workGovernance ?? DEFAULT_WORK_GOVERNANCE_CONFIG,
    provider: resolveGlobalDefaultProvider(global),
    model: model ? { default: model } : undefined,
    ...(global.permissions ? { permissions: global.permissions } : {}),
    ...(global.targetCatalog ? { targetCatalog: global.targetCatalog } : {}),
    ...(global.authorityProfiles ? { authorityProfiles: global.authorityProfiles } : {}),
    ...(global.mcp ? { mcp: global.mcp } : {}),
    ...(global.managedAgents ? { managedAgents: global.managedAgents } : {}),
    ...(global.modelTaskSuitability ? { modelTaskSuitability: global.modelTaskSuitability } : {}),
    ...(global.deliberationPolicy ? { deliberationPolicy: global.deliberationPolicy } : {}),
    ...(global.communication ? { communication: global.communication } : {}),
    ...(global.web ? { web: globalWebToKilnWeb(global.web) } : {}),
    ...(global.interactiveUse ? { interactiveUse: global.interactiveUse } : {}),
    ...(global.skills ? { skills: global.skills } : {}),
    ...(global.hooks ? { hooks: global.hooks } : {}),
  };
}

function globalWebToKilnWeb(globalWeb: KilnGlobalConfig["web"]): KilnYamlWebConfig | undefined {
  if (!globalWeb) {
    return undefined;
  }
  return {
    enabled: globalWeb.enabled,
    netPolicy: globalWeb.netPolicy,
    allowedDomains: globalWeb.allowedDomains,
    searchProvider: globalWeb.searchProvider,
    searchFallbackProviders: globalWeb.searchFallbackProviders,
    extractProvider: globalWeb.extractProvider,
  };
}

/**
 * Pure projection: derives the effective project-authorized `ResolvedKilnConfig` from
 * exact already-read global/project config values, with no I/O of its own.
 * Callers that need global-only fields alongside this projection (e.g.
 * `modelGateway`, `engines`) must read `globalConfig` once and keep it,
 * since `globalToKilnYaml` intentionally omits authority that is not a
 * project `ResolvedKilnConfig` field.
 */
export function deriveEffectiveKilnYaml(
  globalConfig: KilnGlobalConfig | null,
  projectConfig: KilnProjectConfig | null,
): ResolvedKilnConfig | null {
  assertProjectDoesNotDeclareGlobalBoundedWorkCeiling(projectConfig);
  // This function is also a public pure boundary used by tests and callers
  // that may construct an object without going through readKilnYamlFile. Reuse the
  // canonical schema rather than maintaining a second root allowlist here.
  if (projectConfig !== null) {
    parseProjectConfigStructure(projectConfig, "<project-config>");
  }
  // A project cannot create a connection even when global authority is
  // absent; absence is the deny/bottom state, not a project-owned catalog.
  assertProjectMcpServersAreGloballyDefined(globalConfig, projectConfig);

  if (!globalConfig) {
    // A project document is intent, never an authority root. Keep project
    // facts/presentation available while dropping every attenuation field
    // whose ceiling is absent. The empty global authority is deny/bottom.
    return projectConfig ? projectFactsWithoutAuthority(projectConfig) : null;
  }

  if (!projectConfig) {
    return globalToKilnYaml(globalConfig);
  }

  assertProjectDoesNotBroadenGlobal(globalConfig, projectConfig);

  return mergeKilnYaml(globalToKilnYaml(globalConfig), admitProjectAgainstGlobal(globalConfig, projectConfig));
}

function projectFactsWithoutAuthority(projectConfig: KilnProjectConfig): ResolvedKilnConfig {
  return {
    version: projectConfig.version,
    ...(projectConfig.domain === undefined ? {} : { domain: projectConfig.domain }),
    ...(projectConfig.channels === undefined ? {} : { channels: projectConfig.channels }),
    ...(projectConfig.communication === undefined ? {} : { communication: projectConfig.communication }),
    ...(projectConfig.contextGovernance === undefined ? {} : { contextGovernance: projectConfig.contextGovernance }),
  };
}

function admitProjectAgainstGlobal(
  globalConfig: KilnGlobalConfig,
  projectConfig: KilnProjectConfig,
): KilnProjectConfig {
  const permissions = admitProjectPermissions(globalConfig, projectConfig.permissions);
  const bounded = globalConfig.workGovernance?.boundedWorkCeiling?.maximumLimits;
  const maxDepth = projectConfig.maxDepth;
  const parallelWorkers = projectConfig.parallelWorkers;
  if (maxDepth !== undefined && (bounded?.maxChildDepth === undefined || maxDepth > bounded.maxChildDepth)) {
    throw new Error("Project maxDepth cannot exceed global bounded-work ceiling.");
  }
  if (
    parallelWorkers !== undefined
    && (bounded?.maxConcurrentManagedInvocations === undefined || parallelWorkers > bounded.maxConcurrentManagedInvocations)
  ) {
    throw new Error("Project parallelWorkers cannot exceed global bounded-work ceiling.");
  }

  if (projectConfig.activeInstructionProfiles !== undefined) {
    const globalProfiles = globalConfig.activeInstructionProfiles;
    if (globalProfiles === undefined || !containsAll(globalProfiles, projectConfig.activeInstructionProfiles)) {
      throw new Error("Project activeInstructionProfiles must be a subset of global instruction profiles.");
    }
  }
  const skills = admitProjectSkills(globalConfig, projectConfig.skills);
  const web = admitProjectWeb(globalConfig.web, projectConfig.web);

  // Omit every project authority contribution without a concrete global
  // owner. This is intentionally a projection, not a second policy table.
  return {
    ...projectConfig,
    permissions,
    ...(bounded?.maxChildDepth === undefined ? { maxDepth: undefined } : {}),
    ...(bounded?.maxConcurrentManagedInvocations === undefined ? { parallelWorkers: undefined } : {}),
    ...(globalConfig.workGovernance === undefined ? { workGovernance: undefined } : {}),
    web,
    skills,
    ...(globalConfig.mcp === undefined ? { mcp: undefined } : {}),
    ...(globalConfig.activeInstructionProfiles === undefined ? { activeInstructionProfiles: undefined } : {}),
  };
}

function admitProjectWeb(
  globalWeb: KilnGlobalConfig["web"],
  projectWeb: KilnProjectConfig["web"],
): KilnProjectConfig["web"] {
  if (projectWeb === undefined) return undefined;
  if (globalWeb === undefined) throw new Error("Project web policy has no global capability ceiling.");
  if (projectWeb.enabled === true && globalWeb.enabled !== true) {
    throw new Error("Project web policy cannot enable a globally disabled capability.");
  }
  if (projectWeb.netPolicy !== undefined && !webPolicyNarrows(globalWeb.netPolicy, projectWeb.netPolicy)) {
    throw new Error("Project web.netPolicy cannot broaden the global network policy.");
  }
  if (projectWeb.allowedDomains !== undefined) {
    const globalDomains = globalWeb.allowedDomains;
    const globallyUnbounded = globalWeb.netPolicy === "full"
      && (globalDomains === undefined || globalDomains.includes("*"));
    if (!globallyUnbounded && (
      globalDomains === undefined
      || projectWeb.allowedDomains.some((domain) => !globalDomains.includes(domain))
    )) {
      throw new Error("Project web.allowedDomains must be a subset of the global domain ceiling.");
    }
  }
  return projectWeb;
}

function webPolicyNarrows(
  globalPolicy: NonNullable<KilnYamlWebConfig["netPolicy"]> | undefined,
  projectPolicy: NonNullable<KilnYamlWebConfig["netPolicy"]>,
): boolean {
  if (projectPolicy === "none") return true;
  if (globalPolicy === "full") return true;
  return globalPolicy === projectPolicy;
}

function admitProjectSkills(
  globalConfig: KilnGlobalConfig,
  projectSkills: KilnProjectConfig["skills"],
): KilnProjectConfig["skills"] {
  if (projectSkills === undefined) return undefined;
  const globalSkills = globalConfig.skills;
  if (projectSkills.builtin !== undefined) {
    if (globalSkills?.builtin === undefined) {
      throw new Error("Project builtin skill policy has no global catalog ceiling.");
    }
    if (projectSkills.builtin.enabled === true && globalSkills.builtin.enabled === false) {
      throw new Error("Project builtin skills cannot enable a globally disabled skill catalog.");
    }
    if (
      globalSkills.builtin.include
      && projectSkills.builtin.include?.some((skill) => !globalSkills.builtin?.include?.includes(skill))
    ) {
      throw new Error("Project builtin skill include list must be a subset of the global catalog.");
    }
  }
  if (projectSkills.selection !== undefined) {
    if (globalSkills?.selection === undefined) {
      throw new Error("Project skill selection has no global catalog ceiling.");
    }
    if (projectSkills.selection.mode === "auto" && globalSkills.selection.mode === "advisory") {
      throw new Error("Project skill selection cannot broaden the global advisory posture.");
    }
  }
  return {
    ...(projectSkills.builtin === undefined ? {} : { builtin: projectSkills.builtin }),
    ...(projectSkills.selection === undefined ? {} : { selection: projectSkills.selection }),
  };
}

const PROJECT_SANDBOX_RANK = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 } as const;
const PROJECT_APPROVAL_RANK = { never: 0, "on-failure": 1, "on-request": 2, untrusted: 3 } as const;

/**
 * Admits permission leaves independently. A partially specified global
 * permission object is not a ceiling for its omitted sibling, so that leaf
 * is denied instead of being carried through by an object-level merge.
 */
function admitProjectPermissions(
  globalConfig: KilnGlobalConfig,
  projectPermissions: KilnProjectConfig["permissions"],
): KilnProjectConfig["permissions"] {
  if (projectPermissions === undefined) return undefined;
  const admitted: { approval?: NonNullable<KilnProjectConfig["permissions"]>["approval"]; sandbox?: NonNullable<KilnProjectConfig["permissions"]>["sandbox"] } = {};

  if (projectPermissions.approval !== undefined) {
    const bounds = [globalConfig.permissions?.approval, globalConfig.permissionCeiling?.approval]
      .filter((value): value is NonNullable<typeof value> => value !== undefined);
    if (bounds.length === 0) {
      throw new Error("Project permissions.approval has no global permission ceiling.");
    }
    for (const bound of bounds) {
      if (PROJECT_APPROVAL_RANK[projectPermissions.approval] < PROJECT_APPROVAL_RANK[bound]) {
        const source = globalConfig.permissions?.approval === bound ? "global.permissions" : "global.permissionCeiling";
        throw new Error(`Project permissions.approval cannot broaden ${source}.`);
      }
    }
    admitted.approval = projectPermissions.approval;
  }

  if (projectPermissions.sandbox !== undefined) {
    const bounds = [globalConfig.permissions?.sandbox, globalConfig.permissionCeiling?.sandbox]
      .filter((value): value is NonNullable<typeof value> => value !== undefined);
    if (bounds.length === 0) {
      throw new Error("Project permissions.sandbox has no global permission ceiling.");
    }
    for (const bound of bounds) {
      if (PROJECT_SANDBOX_RANK[projectPermissions.sandbox] > PROJECT_SANDBOX_RANK[bound]) {
        const source = globalConfig.permissions?.sandbox === bound ? "global.permissions" : "global.permissionCeiling";
        throw new Error(`Project permissions.sandbox cannot broaden ${source}.`);
      }
    }
    admitted.sandbox = projectPermissions.sandbox;
  }

  return Object.keys(admitted).length === 0 ? undefined : admitted;
}

function assertProjectMcpServersAreGloballyDefined(
  globalConfig: KilnGlobalConfig | null,
  projectConfig: KilnProjectConfig | null,
): void {
  for (const serverId of Object.keys(projectConfig?.mcp?.servers ?? {})) {
    if (globalConfig?.mcp?.servers?.[serverId] === undefined) {
      throw new Error(`Project-only MCP server '${serverId}' is not admitted by global configuration.`);
    }
  }
}

function assertProjectDoesNotDeclareGlobalBoundedWorkCeiling(
  projectConfig: KilnProjectConfig | null,
): void {
  if (
    projectConfig?.workGovernance
    && Object.prototype.hasOwnProperty.call(projectConfig.workGovernance, "boundedWorkCeiling")
  ) {
    throw new Error("Project workGovernance.boundedWorkCeiling is global-only.");
  }
}

function assertProjectDoesNotBroadenGlobal(
  globalConfig: KilnGlobalConfig,
  projectConfig: KilnProjectConfig,
): void {
  const globalGovernance = globalConfig.workGovernance;
  const projectGovernance = projectConfig.workGovernance;
  if (!globalGovernance || !projectGovernance) return;
  const broadens = (
    globalGovernance.defaultPosture === "orchestrate" && projectGovernance.defaultPosture === "direct"
  ) || !containsAll(projectGovernance.requireDelegationFor, globalGovernance.requireDelegationFor)
    || !containsAll(projectGovernance.requiredEvidence, globalGovernance.requiredEvidence);
  if (broadens) {
    throw new Error("Project work governance cannot broaden or exceed global policy.");
  }
}

function containsAll<T>(candidate: readonly T[] | undefined, required: readonly T[] | undefined): boolean {
  if (!required || required.length === 0) return true;
  if (!candidate) return false;
  const values = new Set(candidate);
  return required.every((value) => values.has(value));
}

export async function loadKilnConfig(
  projectPath: string,
  options: ProjectConfigLoadOptions = {},
): Promise<ResolvedKilnConfig | null> {
  return (await loadKilnConfigWithGlobalAuthority(projectPath, options)).kilnYaml;
}

export interface KilnConfigWithGlobalAuthority {
  readonly kilnYaml: ResolvedKilnConfig | null;
  readonly globalConfig: KilnGlobalConfig | null;
}

export async function loadKilnConfigWithGlobalAuthority(
  projectPath: string,
  options: ProjectConfigLoadOptions = {},
): Promise<KilnConfigWithGlobalAuthority> {
  const binding = resolveProjectBinding(projectPath, options);
  const explicitBinding = usesExplicitProjectBinding(options);
  const globalPath = explicitBinding
    ? join(binding.kilnHome, "config.yaml")
    : resolveGlobalConfigPath();
  const globalConfig = options.globalConfig !== undefined
    ? options.globalConfig
    : explicitBinding
      ? readGlobalConfigSnapshotAtPath(globalPath).config
      : readGlobalConfig();
  const projectConfig = readKilnYamlFile(binding.configPath);
  return {
    kilnYaml: deriveEffectiveKilnYaml(globalConfig, projectConfig),
    globalConfig,
  };
}

function resolveProjectBinding(
  projectPath: string,
  options: ProjectConfigLoadOptions,
): ProjectStateBinding {
  return options.projectStateBinding ?? resolveProjectStateBinding(projectPath, options);
}
