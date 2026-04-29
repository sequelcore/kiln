import { join } from "node:path";
import { readGlobalConfig } from "./global-config.js";
import { mergeKilnYaml, readKilnYaml } from "../kiln-yaml.js";
import type { KilnYaml } from "../kiln-yaml-types.js";
import type { KilnGlobalConfig } from "./global-config.js";

export function globalToKilnYaml(global: KilnGlobalConfig): KilnYaml {
  return {
    version: global.version ?? "1",
    provider: global.provider,
    model: global.model ? { default: global.model } : undefined,
    permissions: global.permissions,
    mcp: global.mcp,
    web: global.web,
    hooks: global.hooks,
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
