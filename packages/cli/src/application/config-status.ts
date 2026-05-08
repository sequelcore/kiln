import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  KilnConfigReadResult,
  KilnConfigReadView,
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnConfigSourceSnapshot,
  KilnConfigStatusSnapshot,
  KilnHarnessCapabilitySnapshot,
  KilnProjectionTargetSnapshot,
  KilnRepoShimProjectionSnapshot,
} from "@kilnai/gateway-contracts";
import { KILN_CONFIG_READ_VIEWS } from "@kilnai/gateway-contracts";
import { mergeKilnYaml, readKilnYaml } from "../kiln-yaml.js";
import type { KilnYaml } from "../kiln-yaml-types.js";
import {
  globalToKilnYaml,
} from "../config/config-merger.js";
import {
  readGlobalConfig,
  resolveGlobalConfigPath,
  type KilnGlobalConfig,
} from "../config/global-config.js";
import { listHarnessIntegrationCapabilities } from "../config/harness-integration-capabilities.js";
import {
  detectNativeProjectionFileDrift,
  readNativeProjectionInstallState,
  type NativeProjectionTargetState,
} from "../config/native-projection-state.js";
import { loadAgentDefinitions } from "./agent-loader.js";
import { projectContextPath } from "./project-context.js";
import { resolveProjectRoot } from "./project-root-resolver.js";
import { readRepoShimProjectionStatuses } from "./repo-shim-projection.js";
import { createConfiguredSkillRegistry } from "../config/skill-registry.js";

export interface ReadConfigStatusOptions {
  readonly projectPath?: string;
  readonly now?: Date;
}

interface ConfigLoadState {
  readonly source: KilnConfigSourceSnapshot;
  readonly config: KilnGlobalConfig | KilnYaml | null;
}

export async function readConfigStatusSnapshot(
  options: ReadConfigStatusOptions = {},
): Promise<KilnConfigStatusSnapshot> {
  const root = resolveProjectRoot({ explicitPath: options.projectPath });
  const rootPath = root.rootPath;
  const errors: string[] = [];
  const globalState = readGlobalConfigState();
  const projectState = readProjectConfigState(rootPath);
  const projectContext = readProjectContextState(rootPath);
  const effectiveConfig = buildEffectiveConfig(globalState, projectState, errors);

  errors.push(
    ...sourceErrors("global config", globalState.source),
    ...sourceErrors("project config", projectState.source),
    ...sourceErrors("project context", projectContext),
  );

  const projectionState = await readProjectionSnapshots(rootPath, errors);
  const setup = buildSetupSnapshot({
    rootPath,
    projectContext,
    repoShims: projectionState.repoShims,
    projections: projectionState.projections,
  });

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    project: {
      rootPath,
      projectName: root.projectName,
      hasGitRoot: root.hasGitRoot,
      hasKilnYaml: root.hasKilnYaml,
      kilnYaml: projectState.source,
      projectContext,
    },
    global: globalState.source,
    effectiveConfigStatus: effectiveConfig ? "valid" : errors.length > 0 ? "invalid" : "missing",
    ...(effectiveConfig ? { effectiveConfig: effectiveConfig as unknown as Record<string, unknown> } : {}),
    errors,
    projections: projectionState.projections,
    setup,
    harnessCapabilities: listHarnessIntegrationCapabilities().map(projectHarnessCapability),
  };
}

export async function readConfigStatusView(
  snapshot: KilnConfigStatusSnapshot,
  view: KilnConfigReadView,
): Promise<KilnConfigReadResult> {
  return {
    view,
    snapshot,
    value: await projectConfigView(snapshot, view),
  };
}

export function isConfigReadView(value: string): value is KilnConfigReadView {
  return (KILN_CONFIG_READ_VIEWS as readonly string[]).includes(value);
}

function readGlobalConfigState(): ConfigLoadState {
  const path = resolveGlobalConfigPath();
  if (!existsSync(path)) {
    return {
      source: { path, status: "missing" },
      config: null,
    };
  }

  try {
    return {
      source: { path, status: "valid" },
      config: readGlobalConfig(),
    };
  } catch (error) {
    return {
      source: { path, status: "invalid", error: errorMessage(error) },
      config: null,
    };
  }
}

function readProjectConfigState(projectPath: string): ConfigLoadState {
  const kilnDir = join(projectPath, ".kiln");
  const path = join(kilnDir, "kiln.yaml");
  if (!existsSync(path)) {
    return {
      source: { path, status: "missing" },
      config: null,
    };
  }

  try {
    return {
      source: { path, status: "valid" },
      config: readKilnYaml(kilnDir),
    };
  } catch (error) {
    return {
      source: { path, status: "invalid", error: errorMessage(error) },
      config: null,
    };
  }
}

function buildEffectiveConfig(
  globalState: ConfigLoadState,
  projectState: ConfigLoadState,
  errors: string[],
): KilnYaml | null {
  if (globalState.source.status === "invalid" || projectState.source.status === "invalid") {
    return null;
  }

  const globalConfig = globalState.config as KilnGlobalConfig | null;
  const projectConfig = projectState.config as KilnYaml | null;

  try {
    if (globalConfig && projectConfig) {
      return mergeKilnYaml(globalToKilnYaml(globalConfig), projectConfig);
    }
    if (globalConfig) {
      return globalToKilnYaml(globalConfig);
    }
    return projectConfig;
  } catch (error) {
    errors.push(`effective config: ${errorMessage(error)}`);
    return null;
  }
}

function readProjectContextState(projectPath: string): KilnConfigSourceSnapshot {
  const path = projectContextPath(projectPath);
  if (!existsSync(path)) {
    return { path, status: "missing" };
  }

  const content = readFileSync(path, "utf-8");
  const valid = /^---\s*\r?\n[\s\S]*?version:\s*["']?1["']?[\s\S]*?source:\s*deterministic-repo-scout[\s\S]*?\r?\n---/u
    .test(content);
  return valid
    ? { path, status: "valid" }
    : { path, status: "invalid", error: "Project context must contain version 1 deterministic-repo-scout frontmatter." };
}

async function readProjectionSnapshots(
  projectPath: string,
  errors: string[],
): Promise<{
  readonly projections: readonly KilnProjectionTargetSnapshot[];
  readonly repoShims: readonly KilnRepoShimProjectionSnapshot[];
}> {
  const projections: KilnProjectionTargetSnapshot[] = [];
  const repoShimSnapshots: KilnRepoShimProjectionSnapshot[] = [];

  try {
    const repoShims = await readRepoShimProjectionStatuses(projectPath);
    for (const shim of repoShims) {
      const targetId = `repo-shim:${shim.target}`;
      repoShimSnapshots.push({
        target: shim.target,
        targetId,
        path: shim.path,
        status: shim.status,
        recommendation: repoShimRecommendation(shim.status),
      });
      projections.push({
        targetId,
        path: shim.path,
        kind: "repo-shim" as const,
        status: shim.status,
      });
    }
  } catch (error) {
    errors.push(`repo-shims: ${errorMessage(error)}`);
  }

  try {
    const installState = readNativeProjectionInstallState(join(projectPath, ".kiln"));
    for (const target of Object.values(installState.targets)) {
      projections.push({
        targetId: target.targetId,
        path: target.filePath,
        kind: "native",
        status: readNativeProjectionStatus(target),
        details: `${target.managedFields.length} managed field(s); updated ${target.updatedAt}`,
      });
    }
  } catch (error) {
    errors.push(`native projections: ${errorMessage(error)}`);
  }

  return {
    projections: projections.sort((left, right) => left.targetId.localeCompare(right.targetId)),
    repoShims: repoShimSnapshots.sort((left, right) => left.targetId.localeCompare(right.targetId)),
  };
}

function readNativeProjectionStatus(target: NativeProjectionTargetState): KilnProjectionTargetSnapshot["status"] {
  if (!existsSync(target.filePath)) {
    return "missing";
  }
  if (target.projectionKind === "file") {
    const drift = detectNativeProjectionFileDrift({
      targetId: target.targetId,
      state: {
        version: 1,
        targets: {
          [target.targetId]: target,
        },
      },
      currentContent: readFileSync(target.filePath, "utf-8"),
    });
    return drift ? "drifted" : "managed";
  }
  return "managed";
}

async function projectConfigView(snapshot: KilnConfigStatusSnapshot, view: KilnConfigReadView): Promise<unknown> {
  const config = snapshot.effectiveConfig as unknown as KilnYaml | undefined;
  switch (view) {
    case "effective":
      return config ?? null;
    case "providers":
      return {
        provider: config?.provider,
        model: config?.model,
        providers: config?.providers,
      };
    case "routes":
      return {
        defaultProvider: config?.provider,
        managedAgents: config?.managedAgents,
        modelTaskSuitability: config?.modelTaskSuitability,
      };
    case "agents":
      return readAgentIndexes(snapshot.project.rootPath);
    case "skills":
      return readSkillIndexes(snapshot.project.rootPath);
    case "permissions":
      return config?.permissions ?? null;
    case "memory":
      return {
        permissions: config?.permissions?.memory ?? null,
        memoryDbPath: join(snapshot.project.rootPath, ".kiln", "memory.db"),
        memoryDbPresent: existsSync(join(snapshot.project.rootPath, ".kiln", "memory.db")),
      };
    case "projections":
      return snapshot.projections;
    case "setup":
      return snapshot.setup;
    case "health":
      return {
        global: snapshot.global,
        project: snapshot.project,
        effectiveConfigStatus: snapshot.effectiveConfigStatus,
        errors: snapshot.errors,
        harnessCapabilities: snapshot.harnessCapabilities,
      };
  }
}

function buildSetupSnapshot(input: {
  readonly rootPath: string;
  readonly projectContext: KilnConfigSourceSnapshot;
  readonly repoShims: readonly KilnRepoShimProjectionSnapshot[];
  readonly projections: readonly KilnProjectionTargetSnapshot[];
}): KilnConfigSetupSnapshot {
  const nativeProjections = input.projections.filter((projection) => projection.kind === "native");
  const projectContextRecommendation = projectContextRecommendationFor(input.projectContext);
  const actions = uniqueSetupActions([
    projectContextRecommendation,
    ...input.repoShims.map((shim) => shim.recommendation),
    ...nativeProjections.map(nativeProjectionRecommendation),
  ]);
  return {
    projectRoot: input.rootPath,
    projectContext: {
      ...input.projectContext,
      recommendation: projectContextRecommendation,
    },
    repoShims: input.repoShims,
    nativeProjections,
    recommendedActions: actions,
  };
}

function projectContextRecommendationFor(source: KilnConfigSourceSnapshot): KilnConfigSetupAction {
  if (source.status === "missing") {
    return "adopt-project-context";
  }
  if (source.status === "invalid") {
    return "review-project-context";
  }
  return "none";
}

function repoShimRecommendation(status: KilnRepoShimProjectionSnapshot["status"]): KilnConfigSetupAction {
  if (status === "missing" || status === "stale") {
    return "sync-repo-shims";
  }
  if (status === "drifted") {
    return "review-and-force-sync-repo-shims";
  }
  if (status === "unmanaged") {
    return "adopt-or-back-up-native-guidance";
  }
  return "none";
}

function nativeProjectionRecommendation(projection: KilnProjectionTargetSnapshot): KilnConfigSetupAction {
  if (projection.status === "missing" || projection.status === "stale") {
    return "sync-native-projections";
  }
  if (projection.status === "drifted") {
    return "review-native-projection-drift";
  }
  return "none";
}

function uniqueSetupActions(actions: readonly KilnConfigSetupAction[]): readonly KilnConfigSetupAction[] {
  const filtered = actions.filter((action) => action !== "none");
  return filtered.length > 0 ? [...new Set(filtered)] : ["none"];
}

async function readAgentIndexes(projectPath: string): Promise<unknown> {
  const agents = await loadAgentDefinitions(projectPath);
  return {
    agents: agents.map((agent) => ({
      id: agent.name,
      displayName: agent.displayName,
      role: agent.role,
      model: agent.model,
      tools: agent.tools,
      skills: agent.skills,
      taskAffinity: agent.taskAffinity,
      routeId: agent.routeId,
    })),
  };
}

function readSkillIndexes(projectPath: string): unknown {
  const globalState = readGlobalConfigState();
  const projectState = readProjectConfigState(projectPath);
  const config = buildEffectiveConfig(globalState, projectState, []);
  const registry = createConfiguredSkillRegistry({
    projectPath,
    userHome: homedir(),
    skillConfig: config?.skills,
  });
  return {
    skills: registry.all().map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
      tags: skill.tags,
      tools: skill.tools,
    })),
  };
}

function projectHarnessCapability(capability: ReturnType<typeof listHarnessIntegrationCapabilities>[number]): KilnHarnessCapabilitySnapshot {
  return {
    harness: capability.harness,
    displayName: capability.displayName,
    runtimeConfigInjection: capability.runtimeConfigInjection.supported
      ? capability.runtimeConfigInjection.mechanism ?? "supported"
      : "not-proven",
    nativeProjection: capability.nativeProjection.supported ? "install-state" : "unsupported",
    nativeConfigImport: capability.nativeConfigImport ? "supported" : "unsupported",
    mcpRuntimeTools: capability.mcpRuntimeTools ? "supported" : "unsupported",
    hooks: capability.hooks ? "supported" : "unsupported",
  };
}

function sourceErrors(label: string, source: KilnConfigSourceSnapshot): readonly string[] {
  return source.status === "invalid" ? [`${label}: ${source.error ?? "invalid"}`] : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
