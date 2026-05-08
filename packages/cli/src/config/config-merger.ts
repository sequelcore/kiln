import { join } from "node:path";
import {
  readGlobalConfig,
  resolveGlobalDefaultModel,
  resolveGlobalDefaultProvider,
} from "./global-config.js";
import { mergeKilnYaml, readKilnYaml } from "../kiln-yaml.js";
import type { KilnYaml, KilnYamlWebConfig } from "../kiln-yaml-types.js";
import type { KilnGlobalConfig } from "./global-config.js";

export function globalToKilnYaml(global: KilnGlobalConfig): KilnYaml {
  const model = resolveGlobalDefaultModel(global);
  return {
    version: "1",
    activeInstructionProfiles: global.activeInstructionProfiles,
    provider: resolveGlobalDefaultProvider(global),
    model: model ? { default: model } : undefined,
    permissions: global.permissions,
    mcp: global.mcp,
    managedAgents: global.managedAgents,
    modelTaskSuitability: global.modelTaskSuitability,
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
