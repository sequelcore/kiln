import { MemoryArtifactResourceStore, type DefaultBuiltinToolRegistryOptions } from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import {
  loadConfiguredWebToolSurfaceOptions,
  type LoadConfiguredWebToolSurfaceOptionsInput,
} from "./web-tools-config.js";
import { loadConfiguredInteractiveUseToolSurfaceOptions } from "./interactive-use-config.js";
import { ExternalEngagementResourceProvider } from "./external-engagement-resource-provider.js";

export const PROGRESSIVE_RUNTIME_READ_ONLY_TOOLS = [
  "read",
  "read_many",
  "grep",
  "glob",
  "tree",
  "stat",
  "git",
  "json_query",
  "code_intelligence",
  "web_search",
  "web_fetch",
  "web_extract",
  "kiln_config.read",
  "work_governance.assess",
  "work_profile.list",
  "work_item.list",
] as const;

export const PROGRESSIVE_RUNTIME_EXECUTION_TOOLS = [
  ...PROGRESSIVE_RUNTIME_READ_ONLY_TOOLS,
  "bash",
  "write",
  "edit",
  "patch",
  "kiln_config.propose_change",
  "kiln_config.apply_change",
  "work_item.update",
  "work_item.complete",
  "work_item.execution.start",
  "work_item.execution.finish",
  "work_item.execution.fail",
  "goal.create",
] as const;

export type ProgressiveRuntimeToolProfile = "read-only" | "execute";

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
  const resourceProviders = [
    ...(merged.resourceProviders ?? []),
    new ExternalEngagementResourceProvider(projectPath),
  ];
  return {
    ...merged,
    artifactResources: merged.artifactResources ?? { store: artifactStore },
    resourceProviders,
  };
}

export function withProgressiveRuntimeToolProjection(
  options: DefaultBuiltinToolRegistryOptions,
  profile: ProgressiveRuntimeToolProfile,
  additionalAlwaysOnTools: readonly string[] = [],
): DefaultBuiltinToolRegistryOptions {
  const profileTools = profile === "read-only"
    ? PROGRESSIVE_RUNTIME_READ_ONLY_TOOLS
    : PROGRESSIVE_RUNTIME_EXECUTION_TOOLS;
  return {
    ...options,
    toolProjection: {
      mode: "deferred",
      alwaysOnTools: [
        ...(options.toolProjection?.alwaysOnTools ?? []),
        ...profileTools,
        ...additionalAlwaysOnTools,
      ],
    },
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
  const resourceProviders = [
    ...(left.resourceProviders ?? []),
    ...(right.resourceProviders ?? []),
  ];

  return {
    ...left,
    ...right,
    ...(additionalTools.length > 0 ? { additionalTools } : {}),
    ...(resourceProviders.length > 0 ? { resourceProviders } : {}),
  };
}
