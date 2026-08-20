import { join } from "node:path";
import {
  readGlobalConfig,
  resolveGlobalConfigPath,
  resolveGlobalDefaultModel,
  resolveGlobalDefaultProvider,
} from "./global-config.js";
import { mergeKilnYaml, readKilnYaml } from "../kiln-yaml.js";
import { DEFAULT_WORK_GOVERNANCE_CONFIG, type KilnProjectConfig, type ResolvedKilnConfig, type KilnYamlWebConfig } from "../kiln-yaml-types.js";
import type { KilnGlobalConfig } from "./global-config.js";
import {
  resolveMcpConfiguration,
  type McpConfigurationResolution,
} from "@kilnai/core";
import { readMcpConfigurationSource } from "./mcp-config.js";
import { createMcpCredentialAccess } from "./mcp-credentials.js";

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

export function loadResolvedKilnMcpConfiguration(projectPath: string): McpConfigurationResolution {
  const credentials = createMcpCredentialAccess();
  return resolveKilnMcpConfiguration({
    globalConfig: readGlobalConfig(),
    globalPath: resolveGlobalConfigPath(),
    projectConfig: readKilnYaml(join(projectPath, ".kiln")),
    projectPath: join(projectPath, ".kiln", "kiln.yaml"),
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
    ...(global.skills ? { skills: global.skills } : {}),
    ...(global.hooks ? { hooks: global.hooks } : {}),
  };
}

function globalWebToKilnWeb(globalWeb: KilnGlobalConfig["web"]): KilnYamlWebConfig | undefined {
  if (!globalWeb) {
    return undefined;
  }
  return {
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

  if (!globalConfig) {
    return projectConfig;
  }

  if (!projectConfig) {
    return globalToKilnYaml(globalConfig);
  }

  assertProjectDoesNotBroadenGlobal(globalConfig, projectConfig);

  return mergeKilnYaml(globalToKilnYaml(globalConfig), projectConfig);
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
  const globalPermissions = globalConfig.permissions;
  const permissionCeiling = globalConfig.permissionCeiling;
  const projectPermissions = projectConfig.permissions;
  if (projectPermissions) {
    const sandboxRank = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 } as const;
    const approvalRank = { never: 0, "on-failure": 1, "on-request": 2, untrusted: 3 } as const;
    const scalarBounds = [
      { source: "global.permissions", permissions: globalPermissions },
      { source: "global.permissionCeiling", permissions: permissionCeiling },
    ] as const;
    for (const bound of scalarBounds) {
      if (
        projectPermissions.sandbox !== undefined
        && bound.permissions?.sandbox !== undefined
        && sandboxRank[projectPermissions.sandbox] > sandboxRank[bound.permissions.sandbox]
      ) {
        throw new Error(`Project permissions.sandbox cannot broaden ${bound.source}.`);
      }
      if (
        projectPermissions.approval !== undefined
        && bound.permissions?.approval !== undefined
        && approvalRank[projectPermissions.approval] < approvalRank[bound.permissions.approval]
      ) {
        throw new Error(`Project permissions.approval cannot broaden ${bound.source}.`);
      }
    }

    if (globalPermissions) {
      for (const field of [
        "tools",
        "commands",
        "fileGovernance",
        "memory",
        "dataFirewall",
        "agentScopes",
        "safeDefaults",
        "auditLog",
      ] as const) {
        if (Object.prototype.hasOwnProperty.call(projectPermissions, field)) {
          throw new Error(`Project permissions.${field} cannot be proven to narrow global.permissions.${field}.`);
        }
      }
    }
  }

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

export async function loadKilnConfig(projectPath: string): Promise<ResolvedKilnConfig | null> {
  return (await loadKilnConfigWithGlobalAuthority(projectPath)).kilnYaml;
}

export interface KilnConfigWithGlobalAuthority {
  readonly kilnYaml: ResolvedKilnConfig | null;
  readonly globalConfig: KilnGlobalConfig | null;
}

export async function loadKilnConfigWithGlobalAuthority(projectPath: string): Promise<KilnConfigWithGlobalAuthority> {
  const globalConfig = readGlobalConfig();
  const projectConfig = readKilnYaml(join(projectPath, ".kiln"));
  return {
    kilnYaml: deriveEffectiveKilnYaml(globalConfig, projectConfig),
    globalConfig,
  };
}
