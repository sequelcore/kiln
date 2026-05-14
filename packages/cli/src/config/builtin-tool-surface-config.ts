import { MemoryArtifactResourceStore, type DefaultBuiltinToolRegistryOptions } from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import {
  loadConfiguredWebToolSurfaceOptions,
  type LoadConfiguredWebToolSurfaceOptionsInput,
} from "./web-tools-config.js";
import { loadConfiguredInteractiveUseToolSurfaceOptions } from "./interactive-use-config.js";

export async function loadConfiguredBuiltinToolSurfaceOptions(
  appConfig: KilnAppConfig,
  projectPath: string,
  options: LoadConfiguredWebToolSurfaceOptionsInput = {},
): Promise<DefaultBuiltinToolRegistryOptions> {
  const artifactStore = new MemoryArtifactResourceStore();
  const [webOptions, interactiveOptions] = await Promise.all([
    loadConfiguredWebToolSurfaceOptions(appConfig, projectPath, options),
    loadConfiguredInteractiveUseToolSurfaceOptions(appConfig, projectPath, { artifactStore }),
  ]);
  const merged = mergeBuiltinToolSurfaceOptions(webOptions, interactiveOptions);
  return {
    ...merged,
    artifactResources: merged.artifactResources ?? { store: artifactStore },
  };
}

export function mergeBuiltinToolSurfaceOptions(
  left: DefaultBuiltinToolRegistryOptions,
  right: DefaultBuiltinToolRegistryOptions,
): DefaultBuiltinToolRegistryOptions {
  const additionalTools = [
    ...(left.additionalTools ?? []),
    ...(right.additionalTools ?? []),
  ];

  return {
    ...left,
    ...right,
    ...(additionalTools.length > 0 ? { additionalTools } : {}),
  };
}
