import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { KILN_STATUS_EVIDENCE_VERSION } from "@kilnai/gateway-contracts";
import type {
  KilnConfigReadResult,
  KilnConfigReadView,
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnConfigSourceSnapshot,
  KilnConfigStatusSnapshot,
  KilnGlobalInstructionShimSetupSnapshot,
  KilnHarnessCapabilitySnapshot,
  KilnMcpStatusSnapshot,
  KilnProjectionTargetSnapshot,
  KilnRepoShimProjectionSnapshot,
} from "@kilnai/gateway-contracts";
import { KILN_CONFIG_READ_VIEWS } from "@kilnai/gateway-contracts";
import { mergeKilnYaml, readKilnYaml } from "../kiln-yaml.js";
import type { KilnYaml } from "../kiln-yaml-types.js";
import {
  globalToKilnYaml,
  resolveKilnMcpConfiguration,
} from "../config/config-merger.js";
import {
  readGlobalConfig,
  resolveGlobalConfigPath,
  type KilnGlobalConfig,
} from "../config/global-config.js";
import {
  listHarnessIntegrationCapabilities,
  HARNESSES_WITH_NATIVE_PROJECTION,
  type HarnessIntegrationId,
} from "../config/harness-integration-capabilities.js";
import {
  detectNativeProjectionDrift,
  detectNativeProjectionFileDrift,
  readNativeProjectionInstallState,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
} from "../config/native-projection-state.js";
import { resolveNativeHarnessDir } from "../config/native-harness-home.js";
import { resolveProjectionPathWithin } from "../config/native-projection-paths.js";
import { stripJsonComments } from "../config/json-comments.js";
import {
  classifyNativeRouteIntegrity,
  type NativeRoute,
  type NativeRouteCatalogEvidence,
  type NativeRouteProbeEvidence,
} from "../config/native-route-integrity.js";
import { loadAgentDefinitions, type KilnAgentDefinition } from "./agent-loader.js";
import { decideNativeAgentProjection } from "../config/native-agent-projection-decision.js";
import {
  createNativeAgentRouteAdmissionResolver,
  type NativeAgentRouteAdmissionResolver,
} from "../config/native-agent-route-admission.js";
import { projectContextPath } from "./project-context.js";
import { resolveProjectRoot } from "./project-root-resolver.js";
import {
  readRepoShimProjectionStatuses,
  readWorkflowSnapshotManifestStatus,
} from "./repo-shim-projection.js";
import { readGlobalInstructionShimProjectionSnapshots } from "./global-instruction-shim-projection.js";
import { readSkillCatalogStatus } from "../config/skill-catalog-status.js";
import { resolveCliMemoryStorage } from "./cli-memory-storage.js";
import { projectMcpServer, type NativeMcpHarness } from "../config/native-mcp-projection.js";
import { readMcpRuntimeState } from "../config/mcp-runtime-state.js";
import { createMcpCredentialAccess } from "../config/mcp-credentials.js";
import type { RouteAdmissionDecision } from "@kilnai/core";

export interface ReadConfigStatusOptions {
  readonly projectPath?: string;
  readonly now?: Date;
  readonly userHome?: string;
}

export interface ReadConfigStatusViewOptions {
  readonly userHome?: string;
  readonly createNativeAgentRouteAdmissionResolver?:
    (projectPath: string) => Promise<NativeAgentRouteAdmissionResolver>;
}

interface ConfigLoadState {
  readonly source: KilnConfigSourceSnapshot;
  readonly config: KilnGlobalConfig | KilnYaml | null;
}

interface NativeAgentProjectionSummary {
  readonly target: string;
  readonly status: "projected" | "unavailable" | "unresolved";
  readonly nativeModel?: string;
  readonly reason?: unknown;
  readonly admission?: RouteAdmissionDecision;
}

interface AgentInvocationCapabilitySummary {
  readonly target: HarnessIntegrationId;
  readonly status: "admitted" | "unavailable" | "unresolved";
  readonly nativeModel?: string;
  readonly reasons?: unknown;
  readonly decision?: RouteAdmissionDecision;
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
  const mcp = buildMcpStatus(globalState, projectState, rootPath, options.userHome ?? homedir());

  errors.push(
    ...sourceErrors("global config", globalState.source),
    ...sourceErrors("project config", projectState.source),
    ...sourceErrors("project context", projectContext),
  );

  const projectionState = await readProjectionSnapshots(
    rootPath,
    errors,
    effectiveConfig ?? undefined,
    options.userHome ?? homedir(),
  );
  const permissionIntegrity = aggregatePermissionIntegrity(projectionState.projections);
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
    globalInstructionShims: projectionState.globalInstructionShims,
    projections: projectionState.projections,
    permissionIntegrity,
    skillCatalog,
    mcp,
  });

  return {
    evidenceVersion: KILN_STATUS_EVIDENCE_VERSION,
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
    mcp,
    projections: projectionState.projections,
    permissionIntegrity,
    ...(skillCatalog ? { skills: skillCatalog } : {}),
    setup,
    harnessCapabilities: listHarnessIntegrationCapabilities().map(projectHarnessCapability),
  };
}

function buildMcpStatus(
  globalState: ConfigLoadState,
  projectState: ConfigLoadState,
  rootPath: string,
  userHome: string,
): KilnMcpStatusSnapshot {
  if (globalState.source.status === "invalid" || projectState.source.status === "invalid") {
    return { servers: [], diagnostics: [] };
  }
  const credentials = createMcpCredentialAccess(process.env, userHome);
  const resolution = resolveKilnMcpConfiguration({
    globalConfig: globalState.config as KilnGlobalConfig | null,
    globalPath: globalState.source.path,
    projectConfig: projectState.config as KilnYaml | null,
    projectPath: projectState.source.path,
    credentialExists: credentials.exists,
  });
  const installState = readNativeProjectionInstallState(join(rootPath, ".kiln"));
  const runtimeState = readMcpRuntimeState(rootPath);
  return {
    servers: Object.values(resolution.servers).map((server) => {
      const observed = runtimeState.servers[server.id];
      const projectionCompatibility = (["codex", "claude", "opencode"] as const).map((harness) => {
        const projection = projectMcpServer(harness, server);
        return {
          harness,
          status: projection.status === "compatible" ? "compatible" as const : "incompatible" as const,
          ...(projection.status === "compatible" ? {} : { reason: projection.reason }),
        };
      });
      return ({
      id: server.id,
      enabled: server.enabled,
      source: server.source,
      transport: server.transport,
      admission: server.admission?.state ?? "denied",
      trust: server.trust ?? "untrusted",
      provenance: server.provenance,
      runtimeCompatibility: { status: "compatible" as const },
      projectionCompatibility,
      health: server.enabled
        ? { state: observed?.health ?? "not-tested" as const, ...(observed?.lastFailure ? { lastFailure: observed.lastFailure } : {}) }
        : { state: "disabled" as const },
      discovery: {
        state: server.enabled ? observed?.discovery ?? "not-tested" as const : "disabled" as const,
        tools: observed?.tools ?? 0,
        resources: observed?.resources ?? 0,
        prompts: observed?.prompts ?? 0,
        admitted: observed?.admitted ?? 0,
        capabilities: observed?.capabilities ?? [],
      },
      projection: {
        state: resolveMcpProjectionState(
          server.id,
          server.enabled,
          projectionCompatibility.some((entry) => entry.status === "compatible"),
          installState,
        ),
      },
    }); }),
    diagnostics: resolution.diagnostics,
  };
}

function resolveMcpProjectionState(
  serverId: string,
  enabled: boolean,
  hasCompatibleHarness: boolean,
  installState: NativeProjectionInstallState,
): "not-synchronized" | "current" | "drifted" | "incompatible" | "disabled" {
  if (!enabled) return "disabled";
  if (!hasCompatibleHarness) return "incompatible";
  let hasCurrent = false;
  for (const harness of ["codex", "claude", "opencode"] as const) {
    const targetId = `mcp:${harness}`;
    const target = installState.targets[targetId];
    if (!target || !target.managedFields.includes(mcpProjectionPointer(harness, serverId))) continue;
    try {
      const document = readNativeDocument(target.filePath);
      if (detectNativeProjectionDrift({ targetId, state: installState, currentDocument: document })) return "drifted";
      hasCurrent = true;
    } catch {
      return "drifted";
    }
  }
  return hasCurrent ? "current" : "not-synchronized";
}

function mcpProjectionPointer(harness: NativeMcpHarness, serverId: string): string {
  const root = harness === "codex" ? "mcp_servers" : harness === "claude" ? "mcpServers" : "mcp";
  const encode = (value: string) => value.replace(/~/g, "~0").replace(/\//g, "~1");
  return `/${encode(root)}/${encode(serverId)}`;
}

export async function readConfigStatusView(
  snapshot: KilnConfigStatusSnapshot,
  view: KilnConfigReadView,
  options: ReadConfigStatusViewOptions = {},
): Promise<KilnConfigReadResult> {
  return {
    view,
    snapshot,
    value: await projectConfigView(snapshot, view, options),
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
  userHome?: string,
): Promise<{
  readonly projections: readonly KilnProjectionTargetSnapshot[];
  readonly repoShims: readonly KilnRepoShimProjectionSnapshot[];
  readonly globalInstructionShims: readonly KilnGlobalInstructionShimSetupSnapshot[];
}> {
  const projections: KilnProjectionTargetSnapshot[] = [];
  const repoShimSnapshots: KilnRepoShimProjectionSnapshot[] = [];
  const globalInstructionShimSnapshots: KilnGlobalInstructionShimSetupSnapshot[] = [];

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
    const globalInstructionShims = await readGlobalInstructionShimProjectionSnapshots(projectPath, { userHome });
    for (const shim of globalInstructionShims) {
      globalInstructionShimSnapshots.push({
        targetId: shim.targetId,
        harness: shim.harness === "claude" ? "claude-code" : shim.harness,
        path: shim.filePath,
        kind: "global-instruction-shim",
        status: shim.status,
        ...(shim.details ? { details: shim.details } : {}),
        recommendation: globalInstructionShimRecommendationForStatus(shim.status),
      });
      projections.push({
        targetId: shim.targetId,
        path: shim.filePath,
        kind: "global-instruction-shim" as const,
        status: shim.status,
        ...(shim.details ? { details: shim.details } : {}),
      });
    }
  } catch (error) {
    errors.push(`global-instruction-shims: ${errorMessage(error)}`);
  }

  try {
    const installState = readNativeProjectionInstallState(join(projectPath, ".kiln"));
    for (const target of Object.values(installState.targets)) {
      if (isGlobalInstructionShimTargetId(target.targetId)) {
        continue;
      }
      const safeHarnessPath = isNativeHarnessFileProjectionPath(target, userHome ?? homedir());
      const routeIntegrity = safeHarnessPath ? readNativeRouteIntegrity(target, effectiveConfig) : undefined;
      const status = safeHarnessPath ? readNativeProjectionStatus(target) : "drifted";
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
    globalInstructionShims: globalInstructionShimSnapshots.sort((left, right) => left.targetId.localeCompare(right.targetId)),
  };
}

function isGlobalInstructionShimTargetId(targetId: string): boolean {
  return targetId === "codex-global-instructions"
    || targetId === "claude-global-instructions"
    || targetId === "opencode-global-instructions";
}

function isNativeHarnessFileProjectionPath(
  target: NativeProjectionTargetState,
  userHome: string,
): boolean {
  const harness = (["claude", "codex", "opencode"] as const)
    .find((candidate) => target.targetId.startsWith(`${candidate}-skill:`)
      || target.targetId.startsWith(`${candidate}-agent:`));
  return harness === undefined
    || resolveProjectionPathWithin(resolveNativeHarnessDir(harness, userHome), target.filePath) !== undefined;
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
      // Read bytes, not text.  File projections are written and hashed as
      // bytes by sync, so decoding here produces a different hash and reports
      // drift for a file that is byte-identical to its projection.
      currentContent: readFileSync(target.filePath),
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

async function projectConfigView(
  snapshot: KilnConfigStatusSnapshot,
  view: KilnConfigReadView,
  options: ReadConfigStatusViewOptions,
): Promise<unknown> {
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
        deliberationPolicy: config?.deliberationPolicy,
      };
    case "agents":
      return readAgentIndexes(snapshot.project.rootPath, options);
    case "skills":
      return snapshot.skills ?? { entries: [] };
    case "permissions":
      return {
        policy: config?.permissions ?? null,
        permissionIntegrity: snapshot.permissionIntegrity,
      };
    case "mcp":
      return snapshot.mcp;
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
        mcp: snapshot.mcp,
        harnessCapabilities: snapshot.harnessCapabilities,
      };
  }
}

function buildSetupSnapshot(input: {
  readonly rootPath: string;
  readonly projectContext: KilnConfigSourceSnapshot;
  readonly repoShims: readonly KilnRepoShimProjectionSnapshot[];
  readonly globalInstructionShims: readonly KilnGlobalInstructionShimSetupSnapshot[];
  readonly projections: readonly KilnProjectionTargetSnapshot[];
  readonly permissionIntegrity: KilnConfigStatusSnapshot["permissionIntegrity"];
  readonly skillCatalog?: ReturnType<typeof readSkillCatalogStatus>;
  readonly mcp: KilnMcpStatusSnapshot;
}): KilnConfigSetupSnapshot {
  const nativeProjections = input.projections.filter((projection) => projection.kind === "native");
  const globalInstructionShims = input.globalInstructionShims;
  const projectContextRecommendation = projectContextRecommendationFor(input.projectContext);
  const actions = uniqueSetupActions([
    projectContextRecommendation,
    ...input.repoShims.map((shim) => shim.recommendation),
    ...nativeProjections.map(nativeProjectionRecommendation),
    ...globalInstructionShims.map((projection) => projection.recommendation),
    ...skillProjectionRecommendations(input.skillCatalog),
  ]);
  return {
    projectRoot: input.rootPath,
    projectContext: {
      ...input.projectContext,
      recommendation: projectContextRecommendation,
    },
    repoShims: input.repoShims,
    globalInstructionShims,
    nativeProjections,
    permissionIntegrity: input.permissionIntegrity,
    ...(input.skillCatalog ? { skills: input.skillCatalog } : {}),
    mcp: input.mcp,
    recommendedActions: actions,
  };
}

function aggregatePermissionIntegrity(
  projections: readonly KilnProjectionTargetSnapshot[],
): KilnConfigStatusSnapshot["permissionIntegrity"] {
  return projections
    .map((projection) => projection.permissionIntegrity)
    .filter((integrity): integrity is NonNullable<KilnProjectionTargetSnapshot["permissionIntegrity"]> => integrity !== undefined);
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

function globalInstructionShimRecommendationForStatus(
  status: KilnGlobalInstructionShimSetupSnapshot["status"],
): KilnConfigSetupAction {
  if (status === "missing" || status === "stale") {
    return "sync-global-instruction-shims";
  }
  if (status === "drifted") {
    return "review-global-instruction-drift";
  }
  if (status === "unmanaged") {
    return "adopt-or-back-up-global-instructions";
  }
  return "none";
}

function uniqueSetupActions(actions: readonly KilnConfigSetupAction[]): readonly KilnConfigSetupAction[] {
  const filtered = actions.filter((action) => action !== "none");
  return filtered.length > 0 ? [...new Set(filtered)] : ["none"];
}

async function readAgentIndexes(projectPath: string, options: ReadConfigStatusViewOptions): Promise<unknown> {
  const agents = await loadAgentDefinitions(projectPath, options.userHome === undefined ? undefined : { userHome: options.userHome });
  const createRouteAdmissionResolver = options.createNativeAgentRouteAdmissionResolver
    ?? createNativeAgentRouteAdmissionResolver;
  const routeAdmissionResolver = await createRouteAdmissionResolver(projectPath);
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
      nativeProjections: nativeAgentProjectionSummaries(agent, routeAdmissionResolver),
      invocationCapabilities: agentInvocationCapabilitySummaries(agent, routeAdmissionResolver),
    })),
  };
}

function nativeAgentProjectionSummaries(
  agent: KilnAgentDefinition,
  routeAdmissionResolver: Awaited<ReturnType<typeof createNativeAgentRouteAdmissionResolver>>,
): readonly NativeAgentProjectionSummary[] {
  return HARNESSES_WITH_NATIVE_PROJECTION.map((target) => {
    const decision = decideNativeAgentProjection({ agent, harness: target, admission: routeAdmissionResolver.resolve(agent) });
    if (decision.kind !== "project") {
      return {
        target,
        status: decision.kind,
        reason: decision.reason,
        admission: decision.admission,
      };
    }
    return {
      target,
      status: "projected",
      ...(decision.nativeModel ? { nativeModel: decision.nativeModel } : {}),
    };
  });
}

function agentInvocationCapabilitySummaries(
  agent: KilnAgentDefinition,
  routeAdmissionResolver: Awaited<ReturnType<typeof createNativeAgentRouteAdmissionResolver>>,
): readonly AgentInvocationCapabilitySummary[] {
  if (!agent.providerRoute) {
    return HARNESSES_WITH_NATIVE_PROJECTION.map((target) => ({
      target,
      status: "admitted",
    }));
  }

  return HARNESSES_WITH_NATIVE_PROJECTION.map((target) => {
    const decision = decideNativeAgentProjection({ agent, harness: target, admission: routeAdmissionResolver.resolve(agent) });
    if (decision.kind === "project") {
      return {
        target,
        status: "admitted",
        ...(decision.nativeModel ? { nativeModel: decision.nativeModel } : {}),
      };
    }
    return {
      target,
      status: decision.kind,
      reasons: decision.reason,
      decision: decision.admission,
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
  };
}

function sourceErrors(label: string, source: KilnConfigSourceSnapshot): readonly string[] {
  return source.status === "invalid" ? [`${label}: ${source.error ?? "invalid"}`] : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
