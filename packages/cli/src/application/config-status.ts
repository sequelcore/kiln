import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
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
import {
  listHarnessIntegrationCapabilities,
  HARNESSES_WITH_NATIVE_PROJECTION,
  resolveHarnessRouteCapability,
  type HarnessIntegrationId,
} from "../config/harness-integration-capabilities.js";
import {
  detectNativeProjectionDrift,
  detectNativeProjectionFileDrift,
  readNativeProjectionInstallState,
  type NativeProjectionTargetState,
} from "../config/native-projection-state.js";
import { stripJsonComments } from "../config/json-comments.js";
import {
  classifyNativeRouteIntegrity,
  type NativeRoute,
  type NativeRouteCatalogEvidence,
  type NativeRouteProbeEvidence,
} from "../config/native-route-integrity.js";
import { loadAgentDefinitions, type KilnAgentDefinition } from "./agent-loader.js";
import { decideNativeAgentProjection } from "../config/native-agent-projection-decision.js";
import { projectContextPath } from "./project-context.js";
import { resolveProjectRoot } from "./project-root-resolver.js";
import {
  readRepoShimProjectionStatuses,
  readWorkflowSnapshotManifestStatus,
} from "./repo-shim-projection.js";
import { readSkillCatalogStatus } from "../config/skill-catalog-status.js";
import { resolveCliMemoryStorage } from "./cli-memory-storage.js";

export interface ReadConfigStatusOptions {
  readonly projectPath?: string;
  readonly now?: Date;
  readonly userHome?: string;
}

interface ConfigLoadState {
  readonly source: KilnConfigSourceSnapshot;
  readonly config: KilnGlobalConfig | KilnYaml | null;
}

interface NativeAgentProjectionSummary {
  readonly target: string;
  readonly status: "projected" | "omitted";
  readonly nativeModel?: string;
  readonly reason?: string;
}

interface AgentInvocationCapabilitySummary {
  readonly target: HarnessIntegrationId;
  readonly status: "native-supported" | "adapter-supported" | "unsupported";
  readonly nativeModel?: string;
  readonly adapterId?: "kiln-managed-invocation";
  readonly reason?: string;
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

  const projectionState = await readProjectionSnapshots(rootPath, errors, effectiveConfig ?? undefined);
  const skillCatalog = effectiveConfig
    ? readSkillCatalogStatus({
      projectPath: rootPath,
      userHome: options.userHome ?? homedir(),
      skillConfig: effectiveConfig.skills,
    })
    : undefined;
  const setup = buildSetupSnapshot({
    rootPath,
    projectContext,
    repoShims: projectionState.repoShims,
    projections: projectionState.projections,
    skillCatalog,
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
    ...(skillCatalog ? { skills: skillCatalog } : {}),
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
  effectiveConfig?: KilnYaml,
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
    const workflowSnapshot = await readWorkflowSnapshotManifestStatus(projectPath);
    projections.push({
      targetId: "workflow-snapshot:manifest",
      path: workflowSnapshot.path,
      kind: "workflow-snapshot" as const,
      status: workflowSnapshot.status,
      ...(workflowSnapshot.details ? { details: workflowSnapshot.details } : {}),
    });
  } catch (error) {
    errors.push(`workflow-snapshot: ${errorMessage(error)}`);
  }

  try {
    const installState = readNativeProjectionInstallState(join(projectPath, ".kiln"));
    for (const target of Object.values(installState.targets)) {
      const routeIntegrity = readNativeRouteIntegrity(target, effectiveConfig);
      const status = readNativeProjectionStatus(target);
      projections.push({
        targetId: target.targetId,
        path: target.filePath,
        kind: "native",
        status,
        ...(target.permissionIntegrity ? { permissionIntegrity: permissionIntegrityForProjectionStatus(target.permissionIntegrity, status) } : {}),
        ...(routeIntegrity ? { routeIntegrity } : {}),
        managedFieldCount: target.managedFields.length,
        updatedAt: target.updatedAt,
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
  const document = readNativeDocument(target.filePath);
  const drift = detectNativeProjectionDrift({
    targetId: target.targetId,
    state: {
      version: 1,
      targets: {
        [target.targetId]: target,
      },
    },
    currentDocument: document,
  });
  if (drift) {
    return "drifted";
  }
  return "managed";
}

function permissionIntegrityForProjectionStatus(
  integrity: NonNullable<NativeProjectionTargetState["permissionIntegrity"]>,
  status: KilnProjectionTargetSnapshot["status"],
): NonNullable<KilnProjectionTargetSnapshot["permissionIntegrity"]> {
  if (status === "managed" || status === "current") {
    return integrity;
  }

  const persistedNative = integrity.persistedNative
    ? {
      ...integrity.persistedNative,
      freshness: "stale" as const,
      proof: status === "missing" ? "unavailable" as const : "contradictory" as const,
    }
    : undefined;
  return {
    ...integrity,
    ...(persistedNative ? { persistedNative } : {}),
    classification: status === "drifted" ? "native-projection-drift" : "stale-evidence",
    recommendation: status === "missing"
      ? "Re-run governed native projection sync before trusting persisted native permission evidence."
      : "Review native permission projection drift before trusting persisted native permission evidence.",
    remediationRequiresApproval: true,
  };
}

function readNativeRouteIntegrity(
  target: NativeProjectionTargetState,
  effectiveConfig: KilnYaml | undefined,
): KilnProjectionTargetSnapshot["routeIntegrity"] | undefined {
  if (!target.managedFields.includes("model") || !existsSync(target.filePath) || target.projectionKind === "file") {
    return undefined;
  }
  const document = readNativeDocument(target.filePath);
  const model = typeof document.model === "string" ? document.model.trim() : undefined;
  const canonicalRoute = canonicalRouteFromConfig(effectiveConfig);
  const harness = target.targetId.startsWith("opencode-") ? "opencode" : target.targetId.startsWith("codex-") ? "codex" : "claude";
  const nativeRoute = nativeRouteFromTarget(target.targetId, model, canonicalRoute);
  const drift = detectNativeProjectionDrift({
    targetId: target.targetId,
    state: {
      version: 1,
      targets: {
        [target.targetId]: target,
      },
    },
    currentDocument: document,
  });
  const explicitProbe: NativeRouteProbeEvidence = { status: "not-run", credentialSource: "none" };
  const catalogStatus: NativeRouteCatalogEvidence = model
    ? { status: "not-observable", providerId: nativeRoute?.providerId, model: nativeRoute?.model }
    : { status: "missing-default", providerId: canonicalRoute?.providerId, model: canonicalRoute?.model };
  const diagnostic = classifyNativeRouteIntegrity({
    harness,
    canonicalRoute,
    nativeConfiguredDefault: nativeRoute,
    selectedRuntimeRoute: nativeRoute,
    explicitProbe,
    catalogStatus,
    projectionDrift: drift !== undefined,
    bareProofSupported: false,
  });
  return {
    ...(diagnostic.canonicalRoute ? { canonicalRoute: diagnostic.canonicalRoute } : {}),
    ...(diagnostic.nativeConfiguredDefault ? { nativeConfiguredDefault: diagnostic.nativeConfiguredDefault } : {}),
    ...(diagnostic.selectedRuntimeRoute ? { selectedRuntimeRoute: diagnostic.selectedRuntimeRoute } : {}),
    catalogStatus: diagnostic.catalogStatus,
    explicitProbeStatus: diagnostic.explicitProbeStatus,
    credentialSource: diagnostic.credentialSource,
    bareProofSupported: diagnostic.bareProofSupported,
    routeStatus: diagnostic.routeStatus,
    credentialStatus: diagnostic.credentialStatus,
    classification: diagnostic.classification,
  };
}

function readNativeDocument(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, "utf-8");
  if (extname(filePath) === ".toml") {
    return parseToml(raw) as Record<string, unknown>;
  }
  return JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
}

function canonicalRouteFromConfig(config: KilnYaml | undefined): NativeRoute | undefined {
  const providerId = config?.provider?.trim();
  const model = config?.model?.default?.trim();
  return providerId && model ? { providerId, model } : undefined;
}

function nativeRouteFromTarget(
  targetId: string,
  model: string | undefined,
  canonicalRoute: NativeRoute | undefined,
): NativeRoute | undefined {
  if (!model) {
    return undefined;
  }
  if (targetId.startsWith("opencode-") && model.includes("/")) {
    const [providerId, ...rest] = model.split("/");
    return providerId && rest.length > 0 ? { providerId, model: rest.join("/") } : undefined;
  }
  if (targetId.startsWith("opencode-")) {
    return { providerId: "opencode", model };
  }
  if (targetId.startsWith("codex-")) {
    const providerId = canonicalRoute?.providerId === "codex" || canonicalRoute?.providerId === "codex-oauth"
      ? canonicalRoute.providerId
      : "codex";
    return { providerId, model };
  }
  return undefined;
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
        reasoningPolicy: config?.reasoningPolicy,
      };
    case "agents":
      return readAgentIndexes(snapshot.project.rootPath);
    case "skills":
      return snapshot.skills ?? { entries: [] };
    case "permissions":
      return config?.permissions ?? null;
    case "memory": {
      const memoryStorage = resolveCliMemoryStorage(snapshot.project.rootPath);
      return {
        permissions: config?.permissions?.memory ?? null,
        memoryDbPath: memoryStorage.memoryDbPath,
        memoryDbPresent: existsSync(memoryStorage.memoryDbPath),
      };
    }
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
  readonly skillCatalog?: ReturnType<typeof readSkillCatalogStatus>;
}): KilnConfigSetupSnapshot {
  const nativeProjections = input.projections.filter((projection) => projection.kind === "native");
  const projectContextRecommendation = projectContextRecommendationFor(input.projectContext);
  const actions = uniqueSetupActions([
    projectContextRecommendation,
    ...input.repoShims.map((shim) => shim.recommendation),
    ...nativeProjections.map(nativeProjectionRecommendation),
    ...skillProjectionRecommendations(input.skillCatalog),
  ]);
  return {
    projectRoot: input.rootPath,
    projectContext: {
      ...input.projectContext,
      recommendation: projectContextRecommendation,
    },
    repoShims: input.repoShims,
    nativeProjections,
    ...(input.skillCatalog ? { skills: input.skillCatalog } : {}),
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
      providerRoute: agent.providerRoute,
      tools: agent.tools,
      skills: agent.skills,
      taskAffinity: agent.taskAffinity,
      routeId: agent.routeId,
      nativeProjections: nativeAgentProjectionSummaries(agent),
      invocationCapabilities: agentInvocationCapabilitySummaries(agent),
    })),
  };
}

function nativeAgentProjectionSummaries(agent: KilnAgentDefinition): readonly NativeAgentProjectionSummary[] {
  return HARNESSES_WITH_NATIVE_PROJECTION.map((target) => {
    const decision = decideNativeAgentProjection({ agent, harness: target });
    if (decision.kind === "omit") {
      return {
        target,
        status: "omitted",
        reason: decision.reason,
      };
    }
    return {
      target,
      status: "projected",
      ...(decision.nativeModel ? { nativeModel: decision.nativeModel } : {}),
    };
  });
}

function agentInvocationCapabilitySummaries(agent: KilnAgentDefinition): readonly AgentInvocationCapabilitySummary[] {
  if (!agent.providerRoute) {
    return HARNESSES_WITH_NATIVE_PROJECTION.map((target) => ({
      target,
      status: "native-supported",
    }));
  }

  return HARNESSES_WITH_NATIVE_PROJECTION.map((target) => {
    const capability = resolveHarnessRouteCapability({
      harness: target,
      providerId: agent.providerRoute?.providerId ?? "",
      model: agent.providerRoute?.model,
    });
    if (capability.kind === "native-supported") {
      return {
        target,
        status: capability.kind,
        nativeModel: capability.nativeModel,
      };
    }
    if (capability.kind === "adapter-supported") {
      return {
        target,
        status: capability.kind,
        adapterId: capability.adapterId,
        reason: capability.reason,
      };
    }
    return {
      target,
      status: capability.kind,
      reason: capability.reason,
    };
  });
}

function skillProjectionRecommendations(
  skillCatalog: ReturnType<typeof readSkillCatalogStatus> | undefined,
): readonly KilnConfigSetupAction[] {
  if (!skillCatalog) {
    return [];
  }
  const actions: KilnConfigSetupAction[] = [];
  for (const skill of skillCatalog.entries) {
    if (!skill.configured && skill.origin === "native-harness") {
      actions.push("adopt-or-back-up-native-guidance");
      continue;
    }
    if (skill.projections.some((projection) => projection.status === "missing")) {
      actions.push("sync-native-projections");
    }
    if (skill.projections.some((projection) => projection.status === "drifted")) {
      actions.push("review-native-projection-drift");
    }
    if (skill.projections.some((projection) => projection.status === "unmanaged-native")) {
      actions.push("review-native-projection-drift");
    }
  }
  return actions;
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
    crossHarnessManagedInvocation: {
      adapterId: capability.crossHarnessManagedInvocation.adapterId,
      supportedProviderIds: capability.crossHarnessManagedInvocation.supportedProviderIds,
    },
  };
}

function sourceErrors(label: string, source: KilnConfigSourceSnapshot): readonly string[] {
  return source.status === "invalid" ? [`${label}: ${source.error ?? "invalid"}`] : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
