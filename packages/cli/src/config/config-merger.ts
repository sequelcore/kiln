import { join } from "node:path";
import {
  readGlobalConfig,
  resolveGlobalConfigPath,
  resolveGlobalDefaultModel,
  resolveGlobalDefaultProvider,
} from "./global-config.js";
import { mergeKilnYaml, readKilnYaml } from "../kiln-yaml.js";
import { DEFAULT_WORK_GOVERNANCE_CONFIG, type KilnYaml, type KilnYamlWebConfig } from "../kiln-yaml-types.js";
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
  readonly projectConfig?: KilnYaml | null;
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

export function globalToKilnYaml(global: KilnGlobalConfig): KilnYaml {
  const model = resolveGlobalDefaultModel(global);
  return {
    version: "1",
    activeInstructionProfiles: global.activeInstructionProfiles,
    workGovernance: global.workGovernance ?? DEFAULT_WORK_GOVERNANCE_CONFIG,
    provider: resolveGlobalDefaultProvider(global),
    model: model ? { default: model } : undefined,
    permissions: global.permissions,
    mcp: global.mcp,
    managedAgents: global.managedAgents,
    modelTaskSuitability: global.modelTaskSuitability,
    reasoningPolicy: global.reasoningPolicy,
    web: globalWebToKilnWeb(global.web),
    skills: global.skills,
    hooks: global.hooks,
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

export async function loadKilnConfig(projectPath: string): Promise<KilnYaml | null> {
  const globalConfig = readGlobalConfig();
  const projectConfig = readKilnYaml(join(projectPath, ".kiln"));

  if (!globalConfig) {
    return projectConfig;
  }

  if (!projectConfig) {
    return globalToKilnYaml(globalConfig);
  }

  return mergeKilnYaml(globalToKilnYaml(globalConfig), projectConfig);
}
