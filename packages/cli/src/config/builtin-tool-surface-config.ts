import {
  MemoryArtifactResourceStore,
  type DefaultBuiltinToolRegistryOptions,
} from "@kilnai/core";
import type { BoundedWorkCapabilityObservation } from "@kilnai/core/work-governance";
import type { KilnAppConfig } from "../config.js";
import {
  loadConfiguredWebToolSurfaceOptions,
  type LoadConfiguredWebToolSurfaceOptionsInput,
} from "./web-tools-config.js";
import { loadConfiguredInteractiveUseToolSurfaceOptions } from "./interactive-use-config.js";
import { ExternalEngagementResourceProvider } from "./external-engagement-resource-provider.js";
import { readGlobalConfig, type KilnGlobalConfig } from "./global-config.js";
import { resolveFormalVerificationConfiguration } from "./formal-verification-config.js";

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
  "goal.evidence.record",
  "goal.complete",
] as const;

export type ProgressiveRuntimeToolProfile = "read-only" | "execute";

export function observeFormalVerificationCapability(
  options: Pick<DefaultBuiltinToolRegistryOptions, "formalVerify">,
): BoundedWorkCapabilityObservation {
  return {
    metric: "formal_verification",
    status: options.formalVerify === undefined ? "unavailable" : "available",
  };
}

export interface LoadConfiguredBuiltinToolSurfaceOptionsInput extends LoadConfiguredWebToolSurfaceOptionsInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly runDafnyVersion?: (executable: string) => string;
  readonly platform?: NodeJS.Platform;
  readonly discoveredPaths?: readonly string[];
}

export async function loadConfiguredBuiltinToolSurfaceOptions(
  appConfig: KilnAppConfig,
  projectPath: string,
  options: LoadConfiguredBuiltinToolSurfaceOptionsInput = {},
): Promise<DefaultBuiltinToolRegistryOptions> {
  const artifactStore = new MemoryArtifactResourceStore();
  const globalConfig = options.globalConfig === undefined ? readGlobalConfig() : options.globalConfig;
  const formalVerification = resolveFormalVerificationConfiguration({
    globalConfig,
    ...(options.runDafnyVersion === undefined ? {} : { runVersion: options.runDafnyVersion }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.discoveredPaths === undefined ? {} : { discoveredPaths: options.discoveredPaths }),
  });
  const [webOptions, interactiveOptions] = await Promise.all([
    loadConfiguredWebToolSurfaceOptions(appConfig, projectPath, {
      ...(options.memoryAuthority === undefined ? {} : { memoryAuthority: options.memoryAuthority }),
    }),
    loadConfiguredInteractiveUseToolSurfaceOptions(appConfig, projectPath, { artifactStore }),
  ]);
  const merged = mergeBuiltinToolSurfaceOptions(webOptions, interactiveOptions);
  const resourceProviders = [
    ...(merged.resourceProviders ?? []),
    new ExternalEngagementResourceProvider(projectPath),
  ];
  return {
    ...merged,
    ...(formalVerification.options === undefined ? {} : { formalVerify: formalVerification.options }),
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
