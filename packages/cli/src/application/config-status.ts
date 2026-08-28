import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { KILN_STATUS_EVIDENCE_VERSION } from "@kilnai/gateway-contracts";
import type {
  KilnConfigReadResult,
  KilnConfigReadView,
  KilnEffectiveConfigFieldSnapshot,
  KilnEffectiveConfigHealth,
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnConfigSourceSnapshot,
  KilnConfigStatusSnapshot,
  KilnGlobalInstructionShimSetupSnapshot,
  KilnHarnessCapabilitySnapshot,
  KilnMcpStatusSnapshot,
  KilnProjectInstructionSnapshot,
  KilnProjectionTargetSnapshot,
  KilnWorkflowSnapshotSetupSnapshot,
  KilnConfigActivationStatusEntry,
  KilnSkillCatalogDiagnosticsSnapshot,
} from "@kilnai/gateway-contracts";
import { KILN_CONFIG_READ_VIEWS } from "@kilnai/gateway-contracts";
import { readKilnYamlFile, readKilnYamlFileSnapshot } from "../kiln-yaml.js";
import type { KilnProjectConfig, ResolvedKilnConfig } from "../kiln-yaml-types.js";
import {
  deriveEffectiveKilnYaml,
  readGlobalConfigSnapshotAtPath,
  resolveKilnMcpConfiguration,
} from "../config/config-merger.js";
import {
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
  resolveGlobalNativeProjectionStateDir,
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
import { resolveNativeAgentCommunication } from "../config/native-agent-projection.js";
import { configuredCommunicationCandidates, resolveConfiguredCommunication } from "../config/communication-policy.js";
import { readGlobalCommunicationProjectionSnapshot } from "../config/global-communication-projection.js";
import {
  createManagedAgentRouteAdmissionResolver,
  type ManagedAgentRouteAdmissionResolver,
} from "../config/managed-agent-route-admission.js";
import { projectContextPath, readProjectContextAdoption } from "./project-context.js";
import { resolveProjectRoot } from "./project-root-resolver.js";
import {
  type ProjectStateBinding,
  resolveProjectStateBinding,
} from "./project-state-root.js";
import { readProjectInstructionStatuses } from "./project-instruction-status.js";
import { readWorkflowSnapshotManifestStatus } from "./workflow-snapshot-projection.js";
import { readGlobalInstructionShimProjectionSnapshots } from "./global-instruction-shim-projection.js";
import { readSkillCatalogStatus } from "../config/skill-catalog-status.js";
import { readSkillCatalogDiagnostics, refreshSkillCatalogDiagnostics } from "../config/skill-catalog-diagnostics.js";
import type {
  SkillInventoryCommandRunner,
  SkillPluginProvider,
} from "../config/skill-source-inventory.js";
import { resolveCliMemoryStorage } from "./cli-memory-storage.js";
import { projectMcpServer, type NativeMcpHarness } from "../config/native-mcp-projection.js";
import { readMcpRuntimeState } from "../config/mcp-runtime-state.js";
import { createMcpCredentialAccess } from "../config/mcp-credentials.js";
import type { RouteAdmissionDecision } from "@kilnai/core";
import { assembleRuntimePermissionIntegrity } from "../config/permission-integrity-assembler.js";
import { createRuntimePermissionObservationStore } from "../wrapper/runtime-permission-observation.js";
import {
  effectiveConfigField,
  projectEffectiveConfig,
} from "./effective-config-projection.js";
import { readSettingsSnapshot } from "./config-settings.js";
import { ConfigMutationStore } from "./config-mutation-store.js";
import {
  createRuntimeConfigurationRevisionSetId,
  readRuntimeConfigurationRevision,
} from "./runtime-configuration-revision.js";
import {
  projectActivationStatus,
  readPersistedActivationAdmissionBoundaries,
} from "./activation-status-projector.js";

export interface ReadConfigStatusOptions {
  readonly projectPath?: string;
  readonly now?: Date;
  readonly userHome?: string;
  readonly kilnHome?: string;
  readonly projectStateBinding?: ProjectStateBinding;
  readonly cwd?: string;
  readonly pluginProvider?: SkillPluginProvider;
  readonly commandRunner?: SkillInventoryCommandRunner;
  readonly view?: KilnConfigReadView;
  /** Explicit operator retry; passive setup reads must leave this false. */
  readonly refreshSkillDiagnostics?: boolean;
}

export interface ReadConfigStatusViewOptions {
  readonly userHome?: string;
  readonly kilnHome?: string;
  readonly projectStateBinding?: ProjectStateBinding;
  readonly cwd?: string;
  readonly query?: string;
  readonly modified?: boolean;
  readonly pluginProvider?: SkillPluginProvider;
  readonly commandRunner?: SkillInventoryCommandRunner;
  readonly createManagedAgentRouteAdmissionResolver?:
    (projectPath: string) => Promise<ManagedAgentRouteAdmissionResolver>;
}

interface ConfigLoadState<T> {
  readonly source: KilnConfigSourceSnapshot;
  readonly config: T | null;
  readonly revision: `sha256:${string}` | "absent";
}

type GlobalConfigLoadState = ConfigLoadState<KilnGlobalConfig>;
type ProjectConfigLoadState = ConfigLoadState<KilnProjectConfig>;

interface NativeAgentProjectionSummary {
  readonly target: string;
  readonly status: "projected" | "unavailable" | "unresolved";
  readonly nativeModel?: string;
  readonly reason?: unknown;
  readonly admission?: RouteAdmissionDecision;
  readonly communicationResolution?: import("@kilnai/core").CommunicationResolution;
}

interface AgentInvocationCapabilitySummary {
  readonly target: HarnessIntegrationId;
  readonly status: "admitted" | "unavailable" | "unresolved";
  readonly reasons?: unknown;
  readonly decision?: RouteAdmissionDecision;
}

const skillCatalogDetails = new WeakMap<
  KilnConfigStatusSnapshot,
  ReturnType<typeof readSkillCatalogStatus>
>();
const resolvedConfigDetails = new WeakMap<KilnConfigStatusSnapshot, ResolvedKilnConfig>();
const configSourceDetails = new WeakMap<KilnConfigStatusSnapshot, {
  readonly global: GlobalConfigLoadState;
  readonly project: ProjectConfigLoadState;
}>();
const projectStateBindingDetails = new WeakMap<KilnConfigStatusSnapshot, ProjectStateBinding>();

export async function readConfigStatusSnapshot(
  options: ReadConfigStatusOptions = {},
): Promise<KilnConfigStatusSnapshot> {
  const root = resolveProjectRoot({ explicitPath: options.projectPath });
  const rootPath = root.rootPath;
  const projectStateBinding = options.projectStateBinding ?? resolveProjectStateBinding(rootPath, {
    ...(options.kilnHome ? { kilnHome: options.kilnHome } : {}),
  });
  const now = options.now ?? new Date();
  const errors: string[] = [];
  const globalState = readGlobalConfigState(projectStateBinding);
  const projectState = readProjectConfigState(rootPath, projectStateBinding);
  const projectContext = readProjectContextState(rootPath, projectStateBinding);
  const effectiveConfig = buildEffectiveConfig(globalState, projectState, errors);

  errors.push(
    ...sourceErrors("global config", globalState.source),
    ...sourceErrors("project config", projectState.source),
    ...sourceErrors("project context", projectContext),
  );

  // Settings and effective-config reads own canonical configuration only. Keep
  // them structurally ahead of native projection, MCP, skill/plugin inventory,
  // and setup diagnostics so an ordinary page read cannot accidentally grow
  // into an operator-home scan. Settings still carries activation evidence
  // because mutation previews expose that boundary to the operator.
  if (options.view === "effective" || options.view === "settings") {
    const permissionIntegrity: KilnConfigStatusSnapshot["permissionIntegrity"] = [];
    const effectiveConfigProjection = effectiveConfig
      ? projectEffectiveConfig({
        effectiveConfig,
        globalConfig: globalState.config,
        projectConfig: projectState.config,
        globalSource: globalState.source,
        projectSource: projectState.source,
        projections: [],
        permissionIntegrity,
      })
      : undefined;
    const activationStatus = options.view === "settings"
      ? await readActivationStatus(
        rootPath,
        globalState.source.path,
        globalState,
        projectState,
        errors,
        projectStateBinding,
      )
      : undefined;
    const mcp: KilnMcpStatusSnapshot = { servers: [], diagnostics: [] };
    const setup = buildSetupSnapshot({
      rootPath,
      projectContext,
      projectInstructions: [],
      globalInstructionShims: [],
      projections: [],
      permissionIntegrity,
      skillDiagnostics: {
        state: "not_collected",
        reason: "Skill diagnostics are not collected by narrow effective/settings reads.",
      },
      mcp,
    });
    const snapshot: KilnConfigStatusSnapshot = {
      evidenceVersion: KILN_STATUS_EVIDENCE_VERSION,
      generatedAt: now.toISOString(),
      project: {
        rootPath,
        projectName: root.projectName,
        hasGitRoot: root.hasGitRoot,
        kilnYaml: projectState.source,
        projectContext,
      },
      global: globalState.source,
      effectiveConfigStatus: effectiveConfig ? "valid" : errors.length > 0 ? "invalid" : "missing",
      ...(effectiveConfigProjection ? { effectiveConfig: effectiveConfigProjection } : {}),
      ...(activationStatus ? { activationStatus } : {}),
      errors,
      mcp,
      projections: [],
      permissionIntegrity,
      setup,
      harnessCapabilities: listHarnessIntegrationCapabilities().map(projectHarnessCapability),
    };
    if (effectiveConfig) resolvedConfigDetails.set(snapshot, effectiveConfig);
    configSourceDetails.set(snapshot, { global: globalState, project: projectState });
    projectStateBindingDetails.set(snapshot, projectStateBinding);
    return snapshot;
  }

  const mcp = buildMcpStatus(globalState, projectState, rootPath, projectStateBinding, projectStateBinding.kilnHome);

  const projectionState = await readProjectionSnapshots(
    rootPath,
    projectStateBinding,
    errors,
    effectiveConfig ?? undefined,
    options.userHome,
    globalState.config,
    now,
  );
  const permissionIntegrity = aggregatePermissionIntegrity(projectionState.projections);
  const effectiveConfigProjection = effectiveConfig
    ? projectEffectiveConfig({
      effectiveConfig,
      globalConfig: globalState.config,
      projectConfig: projectState.config,
      globalSource: globalState.source,
      projectSource: projectState.source,
      projections: projectionState.projections,
      permissionIntegrity,
    })
    : undefined;
  const shouldReadSkillCatalog = options.view === undefined || options.view === "skills" || options.view === "setup";
  let synchronousSkillCatalog: ReturnType<typeof readSkillCatalogStatus> | undefined;
  let diagnosticRead: ReturnType<typeof readSkillCatalogDiagnostics> | undefined;
  if (effectiveConfig && shouldReadSkillCatalog) {
    const skillOptions = {
      projectPath: rootPath,
      ...(options.userHome === undefined ? {} : { userHome: options.userHome }),
      projectStateBinding,
      cwd: options.cwd ?? rootPath,
      skillConfig: effectiveConfig.skills,
    };
    const readInjectedCatalog = options.pluginProvider !== undefined || options.commandRunner !== undefined;
    if (options.view === "skills" || readInjectedCatalog) {
      synchronousSkillCatalog = readSkillCatalogStatus({
        ...skillOptions,
        ...(options.pluginProvider ? { pluginProvider: options.pluginProvider } : {}),
        ...(options.commandRunner ? { commandRunner: options.commandRunner } : {}),
      });
    } else {
      diagnosticRead = options.refreshSkillDiagnostics
        ? await refreshSkillCatalogDiagnostics(skillOptions)
        : readSkillCatalogDiagnostics(skillOptions);
    }
  }
  const skillCatalog = synchronousSkillCatalog ?? diagnosticRead?.catalog;
  const skillDiagnostics: KilnSkillCatalogDiagnosticsSnapshot = synchronousSkillCatalog
    ? {
      state: (synchronousSkillCatalog.inventory?.candidates.length ?? 0) === 0
        && synchronousSkillCatalog.entries.length === 0 ? "empty" : "current",
      observedAt: now.toISOString(),
    }
    : diagnosticRead?.lifecycle ?? {
      state: "failed",
      reason: "Skill diagnostics require valid effective configuration.",
    };
  const setup = buildSetupSnapshot({
    rootPath,
    projectContext,
    projectInstructions: projectionState.projectInstructions,
    globalInstructionShims: projectionState.globalInstructionShims,
    projections: projectionState.projections,
    permissionIntegrity,
    skillCatalog,
    skillDiagnostics,
    mcp,
  });
  const activationStatus = await readActivationStatus(
    rootPath,
    globalState.source.path,
    globalState,
    projectState,
    errors,
    projectStateBinding,
  );

  const snapshot: KilnConfigStatusSnapshot = {
    evidenceVersion: KILN_STATUS_EVIDENCE_VERSION,
    generatedAt: now.toISOString(),
    project: {
      rootPath,
      projectName: root.projectName,
      hasGitRoot: root.hasGitRoot,
      kilnYaml: projectState.source,
      projectContext,
    },
    global: globalState.source,
    effectiveConfigStatus: effectiveConfig ? "valid" : errors.length > 0 ? "invalid" : "missing",
    ...(effectiveConfigProjection ? { effectiveConfig: effectiveConfigProjection } : {}),
    activationStatus,
    errors,
    mcp,
    projections: projectionState.projections,
    permissionIntegrity,
    setup,
    harnessCapabilities: listHarnessIntegrationCapabilities().map(projectHarnessCapability),
  };
  if (effectiveConfig) resolvedConfigDetails.set(snapshot, effectiveConfig);
  configSourceDetails.set(snapshot, { global: globalState, project: projectState });
  projectStateBindingDetails.set(snapshot, projectStateBinding);
  if (skillCatalog) skillCatalogDetails.set(snapshot, skillCatalog);
  return snapshot;
}

async function readActivationStatus(
  projectPath: string,
  globalConfigPath: string,
  globalState: GlobalConfigLoadState,
  projectState: ProjectConfigLoadState,
  errors: string[],
  projectStateBinding: ProjectStateBinding,
): Promise<NonNullable<KilnConfigStatusSnapshot["activationStatus"]>> {
  try {
    const desiredRevision = readRuntimeConfigurationRevision(projectPath, {
      globalConfigPath,
      projectStateBinding,
    });
    const store = new ConfigMutationStore(projectPath, {
      globalConfigPath,
      root: projectStateBinding.mutationsPath,
    });
    const admittedBundles = await readPersistedActivationAdmissionBoundaries(projectPath);
    const projected = projectActivationStatus({
      desiredRevision,
      settlements: store.readSettlements(),
      progress: store.readProgressMarkers(),
      proposals: store.readProposals(),
      admittedBundles,
    });
    const entries: KilnConfigActivationStatusEntry[] = projected.entries.map((entry): KilnConfigActivationStatusEntry => ({
      proposalId: entry.proposalId,
      scope: entry.scope,
      path: entry.path,
      committedRevision: entry.committedRevision,
      boundary: entry.boundary,
      state: entry.state,
      activeRevision: entry.activeRevision,
      evidence: entry.evidence,
      reconciliationGenerations: entry.reconciliationGenerations.map((generation) => ({
        target: generation.target,
        generation: generation.generation as `sha256:${string}`,
      })),
      ...(entry.settledAt === undefined ? {} : { settledAt: entry.settledAt }),
      summary: entry.summary,
    }));
    return {
      ...projected,
      entries,
    };
  } catch (error) {
    errors.push(`activation status: ${errorMessage(error)}`);
    return {
      desiredRevisionSetId: degradedActivationRevisionSetId(globalState, projectState),
      state: "unsupported",
      boundary: null,
      activeRevision: null,
      entries: [],
      summary: "Activation status could not be derived from canonical evidence.",
    };
  }
}

function degradedActivationRevisionSetId(
  globalState: GlobalConfigLoadState,
  projectState: ProjectConfigLoadState,
): `sha256:${string}` {
  const globalConfig = globalState.config;
  return createRuntimeConfigurationRevisionSetId({
    global: globalState.revision,
    project: projectState.revision,
    "execution-target-evidence": globalConfig?.targetCatalog?.evidenceRevision ?? "absent",
  });
}

/** Internal runtime detail retained request-locally; never serialized to operator surfaces. */
export function readResolvedConfigDetail(snapshot: KilnConfigStatusSnapshot): ResolvedKilnConfig | undefined {
  return resolvedConfigDetails.get(snapshot);
}

/** Request-local admitted source detail used to derive settings without reopening YAML. */
export function readConfigSourceDetail(snapshot: KilnConfigStatusSnapshot) {
  return configSourceDetails.get(snapshot);
}

function buildMcpStatus(
  globalState: GlobalConfigLoadState,
  projectState: ProjectConfigLoadState,
  rootPath: string,
  projectStateBinding: ProjectStateBinding,
  kilnHome: string,
): KilnMcpStatusSnapshot {
  if (globalState.source.status === "invalid" || projectState.source.status === "invalid") {
    return { servers: [], diagnostics: [] };
  }
  const credentials = createMcpCredentialAccess(process.env, kilnHome);
  const resolution = resolveKilnMcpConfiguration({
    globalConfig: globalState.config,
    globalPath: globalState.source.path,
    projectConfig: projectState.config as ResolvedKilnConfig | null,
    projectPath: projectState.source.path,
    credentialExists: credentials.exists,
  });
  const installState = readNativeProjectionInstallState(projectStateBinding.projectionsPath);
  const runtimeState = readMcpRuntimeState(rootPath, {
    statePath: join(projectStateBinding.runtimePath, "mcp-state.json"),
  });
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

function readGlobalConfigState(projectStateBinding: ProjectStateBinding): GlobalConfigLoadState {
  const path = join(projectStateBinding.kilnHome, "config.yaml");
  if (!existsSync(path)) {
    return {
      source: { path, status: "missing" },
      config: null,
      revision: "absent",
    };
  }

  try {
    const captured = readGlobalConfigSnapshotAtPath(path);
    return {
      source: { path, status: "valid" },
      config: captured.config,
      revision: captured.revision as `sha256:${string}` | "absent",
    };
  } catch (error) {
    return {
      source: { path, status: "invalid", error: errorMessage(error) },
      config: null,
      revision: "absent",
    };
  }
}

function readProjectConfigState(_projectPath: string, projectStateBinding: ProjectStateBinding): ProjectConfigLoadState {
  const path = projectStateBinding.configPath;
  if (!existsSync(path)) {
    return {
      source: { path, status: "missing" },
      config: null,
      revision: "absent",
    };
  }

  try {
    const captured = readKilnYamlFileSnapshot(path);
    return {
      source: { path, status: "valid" },
      config: captured.config,
      revision: captured.revision,
    };
  } catch (error) {
    return {
      source: { path, status: "invalid", error: errorMessage(error) },
      config: null,
      revision: "absent",
    };
  }
}

function buildEffectiveConfig(
  globalState: GlobalConfigLoadState,
  projectState: ProjectConfigLoadState,
  errors: string[],
): ResolvedKilnConfig | null {
  if (globalState.source.status === "invalid" || projectState.source.status === "invalid") {
    return null;
  }

  const globalConfig = globalState.config;
  const projectConfig = projectState.config;

  try {
    return deriveEffectiveKilnYaml(globalConfig, projectConfig);
  } catch (error) {
    errors.push(`effective config: ${errorMessage(error)}`);
    return null;
  }
}

function readProjectContextState(projectPath: string, projectStateBinding: ProjectStateBinding): KilnConfigSourceSnapshot {
  const path = projectContextPath(projectPath, { projectStateBinding });
  if (!existsSync(path)) {
    return { path, status: "missing" };
  }
  try {
    readProjectContextAdoption(projectPath, { projectStateBinding });
    return { path, status: "valid" };
  } catch (error) {
    return {
      path,
      status: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readProjectionSnapshots(
  projectPath: string,
  projectStateBinding: ProjectStateBinding,
  errors: string[],
  effectiveConfig?: ResolvedKilnConfig,
  userHome?: string,
  globalConfig: KilnGlobalConfig | null = null,
  now = new Date(),
): Promise<{
  readonly projections: readonly KilnProjectionTargetSnapshot[];
  readonly projectInstructions: readonly KilnProjectInstructionSnapshot[];
  readonly globalInstructionShims: readonly KilnGlobalInstructionShimSetupSnapshot[];
}> {
  const projections: KilnProjectionTargetSnapshot[] = [];
  const projectInstructionSnapshots: KilnProjectInstructionSnapshot[] = [];
  const globalInstructionShimSnapshots: KilnGlobalInstructionShimSetupSnapshot[] = [];
  const runtimeObservationStore = createRuntimePermissionObservationStore({ projectPath, projectStateBinding });
  const semanticLimitationBaseDir = join(projectStateBinding.kilnHome, "trust", "semantic-limitations");

  try {
    const projectInstructions = await readProjectInstructionStatuses(projectPath, { projectStateBinding });
    for (const instruction of projectInstructions) {
      const targetId = `project-instruction:${instruction.target}`;
      projectInstructionSnapshots.push({
        target: instruction.target,
        targetId,
        path: instruction.path,
        status: instruction.status,
        ...("details" in instruction && instruction.details ? { details: instruction.details } : {}),
        recommendation: projectInstructionRecommendation(instruction.status),
      });
    }
  } catch (error) {
    errors.push(`project-instructions: ${errorMessage(error)}`);
  }

  try {
    const workflowSnapshot = await readWorkflowSnapshotManifestStatus(projectPath, { projectStateBinding });
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
    const globalInstructionShims = await readGlobalInstructionShimProjectionSnapshots(projectPath, {
      userHome,
      projectStateBinding,
    });
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
    const globalCommunication = readGlobalCommunicationProjectionSnapshot({
      intent: resolveConfiguredCommunication({ global: globalConfig?.communication }),
      userHome,
    });
    if (globalCommunication) {
      projections.push({
        targetId: globalCommunication.targetId,
        path: globalCommunication.path,
        kind: "native",
        status: globalCommunication.status,
        ...(globalCommunication.details ? { details: globalCommunication.details } : {}),
        managedFieldCount: 1,
      });
    }
  } catch (error) {
    errors.push(`global communication projection: ${errorMessage(error)}`);
  }

  try {
    const installState = readNativeProjectionInstallState(projectStateBinding.projectionsPath);
    for (const target of Object.values(installState.targets)) {
      const safeHarnessPath = isNativeHarnessFileProjectionPath(target, userHome ?? homedir());
      const routeIntegrity = safeHarnessPath ? readNativeRouteIntegrity(target, effectiveConfig) : undefined;
      const status = safeHarnessPath ? readNativeProjectionStatus(target) : "drifted";
      const permissionIntegrity = target.permissionIntegrity
        ? assembleRuntimePermissionIntegrity({
            integrity: target.permissionIntegrity,
            evidence: await runtimeObservationStore.readLatestExact({
              harness: target.permissionIntegrity.harness,
              targetId: target.targetId,
              projectionDigest: target.contentHash,
            }),
            targetId: target.targetId,
            projectionDigest: target.contentHash,
            projectPath,
            limitationAcceptanceBaseDir: semanticLimitationBaseDir,
            now,
          })
        : undefined;
      projections.push({
        targetId: target.targetId,
        path: target.filePath,
        kind: "native",
        status,
        ...(permissionIntegrity ? { permissionIntegrity: permissionIntegrityForProjectionStatus(permissionIntegrity, status) } : {}),
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
    projectInstructions: projectInstructionSnapshots.sort((left, right) => left.targetId.localeCompare(right.targetId)),
    globalInstructionShims: globalInstructionShimSnapshots.sort((left, right) => left.targetId.localeCompare(right.targetId)),
  };
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
  effectiveConfig: ResolvedKilnConfig | undefined,
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

function canonicalRouteFromConfig(config: ResolvedKilnConfig | undefined): NativeRoute | undefined {
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
  const config = resolvedConfigDetails.get(snapshot);
  switch (view) {
    case "effective":
      return snapshot.effectiveConfig ?? null;
    case "providers":
      return selectEffectiveFields(snapshot, ["/provider", "/model", "/providers"]);
    case "routes":
      return selectEffectiveFields(snapshot, [
        "/provider", "/model", "/targetCatalog", "/authorityProfiles",
        "/managedAgents", "/modelTaskSuitability", "/deliberationPolicy",
      ]);
    case "agents": {
      const binding = projectStateBindingDetails.get(snapshot) ?? options.projectStateBinding;
      return readAgentIndexes(
        snapshot.project.rootPath,
        options,
        binding,
        configSourceDetails.get(snapshot)?.global.config,
      );
    }
    case "skills":
      return {
        ...(skillCatalogDetails.get(snapshot) ?? readSkillCatalogStatus({
          projectPath: snapshot.project.rootPath,
          userHome: options.userHome,
          ...(projectStateBindingDetails.get(snapshot) ? { projectStateBinding: projectStateBindingDetails.get(snapshot) } : {}),
          cwd: options.cwd ?? snapshot.project.rootPath,
          skillConfig: config?.skills,
          ...(options.pluginProvider ? { pluginProvider: options.pluginProvider } : {}),
          ...(options.commandRunner ? { commandRunner: options.commandRunner } : {}),
        })),
        configuration: effectiveConfigField(snapshot.effectiveConfig, "/skills") ?? null,
      };
    case "permissions":
      return {
        configuration: effectiveConfigField(snapshot.effectiveConfig, "/permissions") ?? null,
        permissionIntegrity: snapshot.permissionIntegrity,
      };
    case "mcp":
      return snapshot.mcp;
    case "memory": {
      const binding = projectStateBindingDetails.get(snapshot);
      const memoryStorage = binding
        ? { memoryDbPath: join(binding.memoryPath, "memory.db") }
        : resolveCliMemoryStorage(snapshot.project.rootPath);
      return {
        configuration: effectiveConfigField(snapshot.effectiveConfig, "/permissions") ?? null,
        memoryDbPath: memoryStorage.memoryDbPath,
        memoryDbPresent: existsSync(memoryStorage.memoryDbPath),
      };
    }
    case "projections":
      return snapshot.projections;
    case "setup":
      return {
        ...snapshot.setup,
        ...(snapshot.effectiveConfig ? { effectiveConfig: snapshot.effectiveConfig } : {}),
      };
    case "health":
      return {
        global: snapshot.global,
        project: snapshot.project,
        effectiveConfigStatus: snapshot.effectiveConfigStatus,
        effectiveConfig: snapshot.effectiveConfig
          ? { schemaRevision: snapshot.effectiveConfig.schemaRevision, health: snapshot.effectiveConfig.health }
          : null,
        errors: snapshot.errors,
        mcp: snapshot.mcp,
        harnessCapabilities: snapshot.harnessCapabilities,
      };
    case "settings":
      return readSettingsSnapshot(snapshot, {
        ...(options.query === undefined ? {} : { query: options.query }),
        ...(options.modified === undefined ? {} : { modified: options.modified }),
      });
  }
}

function selectEffectiveFields(
  snapshot: KilnConfigStatusSnapshot,
  identities: readonly string[],
): {
  readonly schemaRevision: number | null;
  readonly health: KilnEffectiveConfigHealth;
  readonly fields: readonly KilnEffectiveConfigFieldSnapshot[];
} {
  const fields = identities.flatMap((identity) => {
    const field = effectiveConfigField(snapshot.effectiveConfig, identity);
    return field ? [field] : [];
  });
  return {
    schemaRevision: snapshot.effectiveConfig?.schemaRevision ?? null,
    health: snapshot.effectiveConfig?.health ?? "unknown",
    fields,
  };
}

function buildSetupSnapshot(input: {
  readonly rootPath: string;
  readonly projectContext: KilnConfigSourceSnapshot;
  readonly projectInstructions: readonly KilnProjectInstructionSnapshot[];
  readonly globalInstructionShims: readonly KilnGlobalInstructionShimSetupSnapshot[];
  readonly projections: readonly KilnProjectionTargetSnapshot[];
  readonly permissionIntegrity: KilnConfigStatusSnapshot["permissionIntegrity"];
  readonly skillCatalog?: ReturnType<typeof readSkillCatalogStatus>;
  readonly skillDiagnostics: KilnSkillCatalogDiagnosticsSnapshot;
  readonly mcp: KilnMcpStatusSnapshot;
}): KilnConfigSetupSnapshot {
  const nativeProjections = input.projections.filter((projection) => projection.kind === "native");
  const workflowSnapshots = input.projections.filter(
    (projection): projection is KilnWorkflowSnapshotSetupSnapshot => projection.kind === "workflow-snapshot",
  );
  const globalInstructionShims = input.globalInstructionShims;
  const projectContextRecommendation = projectContextRecommendationFor(input.projectContext);
  const actions = uniqueSetupActions([
    projectContextRecommendation,
    ...input.projectInstructions.map((instruction) => instruction.recommendation),
    ...workflowSnapshots.map(workflowSnapshotRecommendation),
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
    projectInstructions: input.projectInstructions,
    workflowSnapshots,
    globalInstructionShims,
    nativeProjections,
    permissionIntegrity: input.permissionIntegrity,
    ...(input.skillCatalog ? { skills: summarizeSkillCatalog(input.skillCatalog) } : {}),
    skillDiagnostics: input.skillDiagnostics,
    mcp: input.mcp,
    recommendedActions: actions,
  };
}

function summarizeSkillCatalog(catalog: ReturnType<typeof readSkillCatalogStatus>) {
  const identities = catalog.inventory?.identities ?? [];
  const allIssues = [...catalog.entries].sort((left, right) => {
    const rank = (origin: typeof left.origin) => origin === "project" ? 0 : origin === "user" ? 1 : origin === "native-harness" ? 2 : 3;
    return rank(left.origin) - rank(right.origin) || left.name.localeCompare(right.name);
  }).flatMap((skill) => skill.projections.flatMap((projection) => {
    const kind = skill.desiredVisibility === "explicit-only" && projection.target === "opencode"
      && projection.visibilityCapability === "unsupported" ? "capability" as const
      : projection.status === "missing" ? "missing" as const
        : projection.status === "drifted" ? "drifted" as const
          : projection.status === "unmanaged-native" ? "unmanaged" as const
            : projection.visibilityCapability === "unsupported" ? "capability" as const : undefined;
    return kind ? [{
      skillName: skill.name, kind, harness: projection.target,
      projectionState: projection.status, path: projection.path,
    }] : [];
  }));
  return {
    complete: catalog.inventory?.complete ?? false,
    healthyPackages: catalog.inventory?.candidates.filter((candidate) => candidate.health.status === "healthy").length ?? 0,
    warningPackages: catalog.inventory?.candidates.filter((candidate) => candidate.health.status === "warning").length ?? 0,
    blockedPackages: catalog.inventory?.candidates.filter((candidate) => candidate.health.status === "blocked").length ?? 0,
    equivalentDuplicates: identities.filter((identity) => identity.classification === "equivalent-duplicate").length,
    divergentCollisions: identities.filter((identity) => identity.classification === "divergent-collision").length,
    caseCollisions: identities.filter((identity) => identity.classification === "case-collision").length,
    harnesses: catalog.inventory?.harnesses ?? [],
    externalExposure: catalog.inventory?.externalExposure ?? [],
    issueCount: allIssues.length,
    omittedIssueCount: Math.max(0, allIssues.length - 12),
    issues: allIssues.slice(0, 12),
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

function projectInstructionRecommendation(
  status: KilnProjectInstructionSnapshot["status"],
): KilnConfigSetupAction {
  return status === "project-owned" ? "none" : "review-project-instructions";
}

function workflowSnapshotRecommendation(projection: KilnProjectionTargetSnapshot): KilnConfigSetupAction {
  return projection.status === "current" ? "none" : "sync-workflow-snapshot";
}

function nativeProjectionRecommendation(projection: KilnProjectionTargetSnapshot): KilnConfigSetupAction {
  if (projection.status === "missing" || projection.status === "stale") {
    return "sync-native-projections";
  }
  if (projection.status === "drifted" || projection.status === "unmanaged") {
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

async function readAgentIndexes(
  projectPath: string,
  options: ReadConfigStatusViewOptions,
  projectStateBinding?: ProjectStateBinding,
  globalConfig?: KilnGlobalConfig | null,
): Promise<unknown> {
  const binding = projectStateBinding ?? options.projectStateBinding ?? resolveProjectStateBinding(projectPath, {
    ...(options.kilnHome === undefined ? {} : { kilnHome: options.kilnHome }),
  });
  const agents = await loadAgentDefinitions(projectPath, {
    ...(options.userHome === undefined ? {} : { userHome: options.userHome }),
    ...(options.kilnHome === undefined ? {} : { kilnHome: options.kilnHome }),
    projectStateBinding: binding,
  });
  const createRouteAdmissionResolver = options.createManagedAgentRouteAdmissionResolver
    ?? createManagedAgentRouteAdmissionResolver;
  const routeAdmissionResolver = await createRouteAdmissionResolver(projectPath);
  const installState = readNativeProjectionInstallState(resolveGlobalNativeProjectionStateDir(options.userHome));
  const communicationCandidates = configuredCommunicationCandidates({
    global: globalConfig?.communication,
    project: readKilnYamlFile(binding.configPath)?.communication,
  });
  return {
    agents: agents.map((agent) => ({
      id: agent.name,
      displayName: agent.displayName,
      role: agent.role,
      tools: agent.tools,
      skills: agent.skills,
      taskAffinity: agent.taskAffinity,
      targetId: agent.targetId,
      authorityProfileId: agent.authorityProfileId,
      nativeProjections: nativeAgentProjectionSummaries(agent, routeAdmissionResolver, installState, communicationCandidates),
      invocationCapabilities: agentInvocationCapabilitySummaries(agent, routeAdmissionResolver),
    })),
  };
}

function nativeAgentProjectionSummaries(
  agent: KilnAgentDefinition,
  routeAdmissionResolver: Awaited<ReturnType<typeof createManagedAgentRouteAdmissionResolver>>,
  installState: NativeProjectionInstallState,
  communicationCandidates: ReturnType<typeof configuredCommunicationCandidates>,
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
      communicationResolution: installState.targets[`${target}-agent:${agent.name}`]?.communicationResolution
        ?? resolveNativeAgentCommunication(agent, target, decision.nativeModel, communicationCandidates),
    };
  });
}

function agentInvocationCapabilitySummaries(
  agent: KilnAgentDefinition,
  routeAdmissionResolver: Awaited<ReturnType<typeof createManagedAgentRouteAdmissionResolver>>,
): readonly AgentInvocationCapabilitySummary[] {
  if (!agent.targetId) {
    return HARNESSES_WITH_NATIVE_PROJECTION.map((target) => ({
      target,
      status: "admitted",
    }));
  }

  return HARNESSES_WITH_NATIVE_PROJECTION.map((target) => {
    const decision = routeAdmissionResolver.resolve(agent) ?? unresolvedInvocationAdmission(agent);
    if (decision.status === "admitted") {
      return {
        target,
        status: "admitted",
        decision,
      };
    }
    return {
      target,
      status: decision.status,
      reasons: decision.reasons,
      decision,
    };
  });
}

function unresolvedInvocationAdmission(agent: KilnAgentDefinition): RouteAdmissionDecision {
  return {
    status: "unresolved",
    routeId: agent.targetId ?? "unresolved",
    reasons: [{ code: "proof-unknown" }],
  };
}

function skillProjectionRecommendations(
  skillCatalog: ReturnType<typeof readSkillCatalogStatus> | undefined,
): readonly KilnConfigSetupAction[] {
  if (!skillCatalog) {
    return [];
  }
  const actions: KilnConfigSetupAction[] = [];
  if (skillCatalog.inventory?.externalExposure?.some((entry) =>
    entry.harness === "codex" && (entry.status === "stale" || entry.status === "blocked"))) {
    actions.push("sync-native-projections");
  }
  for (const skill of skillCatalog.entries) {
    if (!skill.configured && skill.origin === "native-harness") {
      actions.push("adopt-or-back-up-native-guidance");
      continue;
    }
    if (skill.projections.some((projection) => projection.status === "missing"
      && !(skill.desiredVisibility === "explicit-only"
        && projection.target === "opencode"
        && projection.visibilityCapability === "unsupported"))) {
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
