import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";
import {
  readGlobalConfig,
  resolveGlobalDefaultModel,
  resolveGlobalDefaultProvider,
} from "../config/global-config.js";
import { withGlobalIdentityContext } from "../config/operator-identity-context.js";
import { withContextCandidates } from "../application/agent-skill-context.js";
import { resolveInstructionProfileContextCandidates } from "../application/instruction-profile-context.js";
import { withWorkGovernanceContext } from "../application/work-governance-context.js";
import { readConfigStatusSnapshot } from "../application/config-status.js";
import { executeConfigSetupAction } from "../application/config-setup-actions.js";
import {
  createCliTranscriptBudgetUsageReader,
  createRuntimeBudgetAdmissionFromGlobalConfig,
} from "../application/runtime-budget-admission.js";
import { readKilnYaml } from "../kiln-yaml.js";
import { loadKilnConfig } from "../config/config-merger.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { createKilnConfigTools } from "../application/config-tools.js";
import { createWorkGovernanceTools } from "../application/work-governance-tool.js";
import { createStagedManagedInvocationRouteCatalog } from "../config/managed-agent-route-catalog.js";
import {
  readProviderDiscoveryCache,
  writeProviderDiscoveryCache,
} from "../config/provider-discovery-cache.js";
import { loadConfiguredBuiltinToolSurfaceOptions } from "../config/builtin-tool-surface-config.js";
import { resolveProjectMemoryScope } from "../config/web-tools-config.js";
import { resolveEffectiveProvider } from "../config/env-config.js";
import { resolveOperatorVoiceRuntime } from "../config/operator-voice.js";
import { resolveEngineAvailabilityMap } from "../engines/engine-registry.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { createStartupProfiler } from "../application/startup-profiler.js";
import { loadContinuationSidebarInfo } from "../application/continuation-sidebar-info.js";
import { createTranscriptRuntimeSessionHydrator } from "../application/runtime-session-rehydration.js";
import { recoverStaleOpenTranscriptSessions } from "../application/transcript-session-recovery.js";
import { createKilnRuntimeManagedInvocationAttachment } from "../application/managed-invocation-attachment.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import { loadSessionDetail } from "./gui-session-detail.js";
import {
  createDefaultRegistry,
  getRuntimeProviderAvailability,
  getProviderDisplayInfo,
  type ProviderId,
} from "../wrapper/session-registry.js";
import { makeMultiProviderSessionFactory } from "./tui.js";
import {
  getProjectContextArtifactCache,
  withManagedAgentInvocationResourceProvider,
  withManagedInvocationService,
  type GuiDashboardSnapshot,
  type GuiProviderDescriptor,
} from "@kilnai/runtime";
import { GoalRunStore, WorkItemStore, createSessionBuiltinToolOptions, getFieldStore } from "@kilnai/core";
import { persistGuiThemePreference, resolveGuiThemePreference } from "../application/operator-theme-preferences.js";
import { buildGuiAttachUrl, buildGuiUrl } from "./gui-options.js";
import { createLocalWorkspaceExplorer } from "./gui-workspace.js";
import { createManagedGuiWindowShutdownMonitor } from "./gui-shutdown-monitor.js";
import { launchGuiWindow, type GuiWindowSession } from "./gui-window.js";
import { loadSessionSummaries, toProviderLabel } from "./gui-session-summaries.js";
import { createGuiDevServerOutput } from "./gui-dev-server-output.js";
import {
  persistGuiProviderSelectionPreference,
  resolveGuiProviderSelectionPreference,
} from "../application/operator-provider-preferences.js";
import {
  createOperatorCockpitReadOnlyViewState,
  createOperatorWorkspaceConfigHealthSummary,
  createOperatorWorkspaceHomeProjection,
  isGuiProviderModeless,
  projectOperatorCockpitReadOnlyView,
  type GuiProviderDiscoveryResult,
  type OperatorSessionEvent,
  type OperatorWorkspaceConfigHealthSummary,
  type OperatorWorkspaceExplorer,
} from "@kilnai/gateway-contracts";

const LOCAL_GUI_COCKPIT_INSTANCE_ID = "local-gui";

export interface GuiFlags {
  readonly port?: number;
  readonly guiPort?: number;
  readonly mode?: "dev" | "prod";
  readonly cwd?: string;
  readonly connect?: string;
  readonly open?: boolean;
  readonly provider?: string;
  readonly theme?: string;
  readonly plan?: boolean;
}

export async function guiCommand(appConfig: KilnAppConfig, flags: GuiFlags = {}): Promise<void> {
  const startupProfiler = createStartupProfiler("gui");
  startupProfiler.mark("command-entered");
  const cwd = resolveProjectRoot({ explicitPath: flags.cwd }).rootPath;
  const globalConfig = readGlobalConfig();
  const projectConfig = readKilnYaml(join(cwd, ".kiln"));
  const resolvedKilnConfig = await loadKilnConfig(cwd);
  startupProfiler.mark("config-loaded", { projectPath: cwd });
  const runtimeAppConfig = withContextCandidates(
    withWorkGovernanceContext(withGlobalIdentityContext(appConfig, globalConfig), resolvedKilnConfig?.workGovernance),
    resolveInstructionProfileContextCandidates({
      projectPath: cwd,
      globalConfig,
      projectConfig,
    }),
  );
  const themePreference = resolveGuiThemePreference(flags.theme, globalConfig);
  if (flags.connect) {
    await guiAttachCommand(flags.connect, themePreference, flags);
    return;
  }

  const mode = resolveGuiMode(cwd, flags.mode);
  const port = flags.port ?? 4810;
  const guiPort = flags.guiPort ?? 5183;
  const sessionStore = new SessionStore(cwd);
  const { registry } = createDefaultRegistry();
  const providerDisplay = getProviderDisplayInfo(registry);
  const providerIds = providerDisplay.map((provider) => provider.id);
  const provider = parseProvider(resolveEffectiveProvider(flags.provider, resolveGlobalDefaultProvider(globalConfig)), providerIds);
  const startupModel = resolveGlobalDefaultModel(globalConfig);
  const transcriptStore = new TranscriptStore(cwd);
  await recoverStaleOpenTranscriptSessions({
    transcriptStore,
    sessionStore,
    projectPath: cwd,
  });
  const runtimeBudgetAdmission = createRuntimeBudgetAdmissionFromGlobalConfig(
    globalConfig,
    createCliTranscriptBudgetUsageReader(transcriptStore),
  );
  const workItemStore = new WorkItemStore();
  const goalRunStore = new GoalRunStore();
  const resumeSessionHydrator = createTranscriptRuntimeSessionHydrator({
    transcriptStore,
    workItemStore,
    goalRunStore,
  });
  const contextArtifactCache = await getProjectContextArtifactCache(cwd);
  startupProfiler.mark("context-cache-ready");
  const configuredBuiltinToolOptions = await loadConfiguredBuiltinToolSurfaceOptions(runtimeAppConfig, cwd, {
      memoryAuthority: {
        modelFacingSession: true,
        permissionAgent: "gui",
        caller: { kind: "operator_surface", id: "gui" },
      },
    });
  startupProfiler.mark("builtin-tool-options-loaded");
  let builtinToolOptions = createSessionBuiltinToolOptions({
    ...configuredBuiltinToolOptions,
    workItemStore,
    goalRunStore,
    additionalTools: [
      ...(configuredBuiltinToolOptions.additionalTools ?? []),
      ...createKilnConfigTools(cwd),
      ...createWorkGovernanceTools(resolvedKilnConfig?.workGovernance, { workItemStore, goalRunStore }),
    ],
  });
  startupProfiler.mark("builtin-tool-options-created");
  let managedRouteGlobalConfig = globalConfig;
  let managedRouteEngineAvailability = resolveEngineAvailabilityMap(managedRouteGlobalConfig);
  const stagedManagedInvocation = appConfig.managedInvocation
    ? undefined
    : await createStagedManagedInvocationRouteCatalog(globalConfig, {
      cwd,
      registry,
      surface: "gui",
      isProviderAvailable: (providerId) => managedRouteEngineAvailability.get(providerId),
      directAdapterFactory: createManagedDirectProviderAdapterFactory({
        builtinToolOptions: () => builtinToolOptions,
      }),
      builtinToolOptions: () => builtinToolOptions,
      artifactStore: builtinToolOptions.artifactResources?.store,
    }, {
      reloadConfig: () => {
        managedRouteGlobalConfig = readGlobalConfig() ?? globalConfig;
        managedRouteEngineAvailability = resolveEngineAvailabilityMap(managedRouteGlobalConfig);
        return managedRouteGlobalConfig;
      },
      onRefreshError: (error) => {
        console.warn(`Managed invocation provider discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      },
    });
  startupProfiler.mark("managed-invocation-staged", {
    hasManagedInvocation: Boolean(stagedManagedInvocation?.managedInvocation ?? appConfig.managedInvocation),
  });
  const managedInvocation = appConfig.managedInvocation ?? stagedManagedInvocation?.managedInvocation;
  const managedInvocationWithService = managedInvocation
    ? withManagedInvocationService(managedInvocation)
    : undefined;
  const managedInvocationAttachment = managedInvocationWithService
    ? createKilnRuntimeManagedInvocationAttachment("gui", managedInvocationWithService)
    : undefined;
  builtinToolOptions = withManagedAgentInvocationResourceProvider(
    builtinToolOptions,
    managedInvocationWithService ? { service: managedInvocationWithService.invocationService } : undefined,
  );
  const operatorVoice = await resolveOperatorVoiceRuntime(globalConfig);
  startupProfiler.mark("voice-runtime-ready");
  for (const warning of operatorVoice.warnings) {
    console.warn(warning);
  }
  const sessionManager = await makeMultiProviderSessionFactory(
    provider,
    providerIds,
    cwd,
    registry,
    sessionStore,
    transcriptStore,
    contextArtifactCache,
    builtinToolOptions,
    "gui",
    managedInvocationAttachment,
    runtimeBudgetAdmission,
  );
  startupProfiler.mark("session-manager-ready");
  const managedInvocationForGateway = sessionManager.managedInvocation ?? managedInvocationAttachment;
  if (startupModel) {
    sessionManager.setModel(startupModel);
  }
  const startupProviderSelection = resolveGuiProviderSelectionPreference(globalConfig);
  if (!flags.provider && startupProviderSelection) {
    sessionManager.setProvider(startupProviderSelection.provider);
    sessionManager.setModel(startupProviderSelection.model ?? "");
  }
  const bootstrapContext = await resolveGuiBootstrapContext(runtimeAppConfig, cwd, contextArtifactCache);
  startupProfiler.mark("bootstrap-context-ready");
  const managedWindowShutdownMonitor = createManagedGuiWindowShutdownMonitor();
  const workspaceExplorer = createLocalWorkspaceExplorer(cwd);
  const initialOperatorDiscovery = readProviderDiscoveryCache(cwd);
  const { startGuiGateway } = await import("@kilnai/runtime");
  startupProfiler.mark("gateway-start-requested");
  const gateway = await startGuiGateway({
    port,
    getProviderAvailability: () => getRuntimeProviderAvailability(registry),
    getSnapshot: async (context) => buildDashboardSnapshot(
      registry,
      sessionStore,
      transcriptStore,
      providerDisplay,
      context?.operatorModels ?? {},
      context?.operatorDiscovery ?? [],
      cwd,
      bootstrapContext.domainLabel,
      workspaceExplorer,
    ),
    getSetupSnapshot: async () => (await readConfigStatusSnapshot({ projectPath: cwd })).setup,
    executeSetupAction: async (action) => executeConfigSetupAction({ projectPath: cwd, action }),
    listSessions: () => loadSessionSummaries(sessionStore, transcriptStore),
    getSessionDetail: (sessionId) => loadSessionDetail(transcriptStore, sessionId),
    workingDirectory: cwd,
    domainLabel: bootstrapContext.domainLabel,
    workspaceExplorer,
    updateThemePreference: (theme) => persistGuiThemePreference(theme, globalConfig),
    resolveProviderPreference: () => resolveGuiProviderSelectionPreference(readGlobalConfig() ?? globalConfig),
    updateProviderPreference: (selection) => {
      persistGuiProviderSelectionPreference(selection.provider, selection.model ?? null);
    },
    onConnectionCountChange: managedWindowShutdownMonitor.onConnectionCountChange,
    onManagedWindowClose: managedWindowShutdownMonitor.onManagedWindowClose,
    initialOperatorDiscovery,
    onOperatorDiscoveryResolved: (discovery) => writeProviderDiscoveryCache(cwd, discovery),
    builtinToolOptions,
    managedInvocation: managedInvocationForGateway,
    memoryLatticeDefaultScope: resolveProjectMemoryScope(cwd),
    operatorTransport: {
      sessionManager,
      systemPrompt: bootstrapContext.systemPrompt,
      onClear: sessionManager.onClear,
      onContinueSession: (sessionId) => {
        sessionManager.setContinuationSession(sessionId);
      },
      resumeSessionHydrator,
      contextArtifactCache,
      artifactStore: builtinToolOptions.artifactResources?.store,
      voiceConfig: operatorVoice.voiceConfig,
      sttAdapter: operatorVoice.sttAdapter,
      ttsAdapter: operatorVoice.ttsAdapter,
      executionMode: flags.plan ? "plan" : "execute",
      managedInvocation: managedInvocationForGateway,
      budgetAdmission: runtimeBudgetAdmission,
      workingDirectory: cwd,
      domainLabel: bootstrapContext.domainLabel,
    },
  });
  startupProfiler.mark("gateway-started", { port: gateway.port });
  stagedManagedInvocation?.startBackgroundRefresh();

  let viteDevChild: ChildProcess | undefined;
  if (mode === "dev") {
    startupProfiler.mark("gui-vite-start-requested", { port: guiPort });
    viteDevChild = spawnGuiDevServer(cwd, guiPort, gateway.port);
  }

  const gatewayUrl = `http://localhost:${gateway.port}/gui/`;
  const devGuiUrl = `http://localhost:${guiPort}/gui/`;
  const guiUrl = buildGuiUrl(mode === "dev" ? devGuiUrl : gatewayUrl, themePreference);
  printStartupBanner({ mode, gatewayUrl, guiUrl, apiUrl: gateway.apiUrl });
  startupProfiler.mark("startup-banner-printed", { mode });

  let guiWindow: GuiWindowSession | undefined;
  try {
    if (flags.open ?? true) {
      startupProfiler.mark("browser-launch-requested");
      guiWindow = launchGuiWindow(guiUrl);
      startupProfiler.mark("browser-launched");
      console.log(`GUI window host: ${guiWindow.browserLabel}`);
    }
  } catch (error) {
    if (viteDevChild) {
      await stopChildProcess(viteDevChild, "gui-dev");
    }
    gateway.shutdown();
    throw error;
  }

  await waitForShutdown(async () => {
    managedWindowShutdownMonitor.dispose();
    guiWindow?.close();
    if (viteDevChild) {
      await stopChildProcess(viteDevChild, "gui-dev");
    }
    gateway.shutdown();
  }, guiWindow, guiWindow ? managedWindowShutdownMonitor.waitForDisconnect() : undefined);
}

async function guiAttachCommand(
  connectUrl: string,
  themePreference: ReturnType<typeof resolveGuiThemePreference>,
  flags: GuiFlags,
): Promise<void> {
  const guiUrl = buildGuiAttachUrl(connectUrl, themePreference);
  const gatewayUrl = new URL(guiUrl).origin;
  printStartupBanner({
    mode: "attach",
    gatewayUrl: `${gatewayUrl}/gui/`,
    guiUrl,
    apiUrl: `${gatewayUrl}/gui/api/dashboard`,
  });

  let guiWindow: GuiWindowSession | undefined;
  if (flags.open ?? true) {
    guiWindow = launchGuiWindow(guiUrl);
    console.log(`GUI window host: ${guiWindow.browserLabel}`);
    await waitForShutdown(() => {
      guiWindow?.close();
    }, guiWindow);
  }
}

function parseProvider(p: string | undefined, providerIds: readonly ProviderId[]): ProviderId | null {
  const provider = typeof p === "string" ? p.trim() : "";
  if (provider.length === 0) {
    return null;
  }
  if (providerIds.includes(provider as ProviderId)) {
    return provider as ProviderId;
  }
  throw new Error(
    `Unknown GUI provider '${provider}'. Configure one of: ${providerIds.join(", ")}`,
  );
}

async function resolveGuiBootstrapContext(
  appConfig: KilnAppConfig,
  cwd: string,
  contextArtifactCache: Awaited<ReturnType<typeof getProjectContextArtifactCache>>,
): Promise<{ systemPrompt: string; domainLabel: string }> {
  try {
    const { SessionManager } = await import("../wrapper/session-manager.js");
    const wrapperConfig = {
      mode: "cli-wrapper" as const,
      permissionPolicy: { approval: "never" as const, sandbox: "workspace-write" as const },
    };
    const manager = new SessionManager(wrapperConfig, appConfig, contextArtifactCache);
    const context = await manager.prepare("interactive", cwd, undefined, undefined, undefined);
    return {
      systemPrompt: context.systemPrompt,
      domainLabel: context.domain.displayName,
    };
  } catch {
    return {
      systemPrompt: "You are a helpful assistant.",
      domainLabel: "kiln",
    };
  }
}

async function buildDashboardSnapshot(
  registry: ReturnType<typeof createDefaultRegistry>["registry"],
  sessionStore: SessionStore,
  transcriptStore: TranscriptStore,
  providers: readonly ReturnType<typeof getProviderDisplayInfo>[number][],
  runtimeProviderModels: Record<string, string[]>,
  runtimeProviderDiscovery: readonly GuiProviderDiscoveryResult[],
  workingDirectory: string,
  domainLabel: string,
  workspaceExplorer: OperatorWorkspaceExplorer,
): Promise<GuiDashboardSnapshot> {
  const sessions = await loadSessionSummaries(sessionStore, transcriptStore);

  const providerHealth = new Map(
    Object.entries(getRuntimeProviderAvailability(registry)),
  );

  const discoveryByProvider = new Map(runtimeProviderDiscovery.map((entry) => [entry.provider, entry] as const));
  const providerDescriptors: GuiProviderDescriptor[] = providers.map((provider) => {
    const discovery = discoveryByProvider.get(provider.id);
    if (discovery) {
      return {
        id: provider.id,
        label: toProviderLabel(provider.id),
        group: provider.group,
        models: [...discovery.models],
        free: provider.free,
        available: discovery.available,
        status: discovery.status,
        reason: discovery.reason,
        authState: discovery.authState,
        lastCheckedAt: discovery.lastCheckedAt,
      };
    }
    const hasRuntimeModelEntry = Object.prototype.hasOwnProperty.call(runtimeProviderModels, provider.id);
    const models = runtimeProviderModels[provider.id] ?? [];
    const available = (providerHealth.get(provider.id) ?? false)
      && (models.length > 0 || (hasRuntimeModelEntry && isGuiProviderModeless(provider.id)));
    return {
      id: provider.id,
      label: toProviderLabel(provider.id),
      group: provider.group,
      models: available ? models : [],
      free: provider.free,
      available,
    };
  });

  const telemetry = await readTelemetrySnapshot();
  const continuationInfo = await loadContinuationSidebarInfo(
    sessionStore,
    transcriptStore,
    providers.map((provider) => provider.id),
  );
  const continuationInfoByProvider = Object.fromEntries(
    Object.entries(continuationInfo).flatMap(([provider, info]) => (
      info.strategy
        ? [[provider, { strategy: info.strategy, feedbackLabel: info.feedbackLabel }]]
        : []
    )),
  );
  const workspaceTree = await workspaceExplorer.listDirectory().catch(() => undefined);
  const configHealth = await readLocalGuiConfigHealth(workingDirectory);
  const operatorWorkspaceHome = await buildLocalGuiOperatorWorkspaceHome({
    projectedAt: new Date().toISOString(),
    sessions,
    transcriptStore,
    configHealth,
  });

  return {
    providers: providerDescriptors,
    sessions,
    telemetry,
    continuationInfoByProvider,
    operatorWorkspaceHome,
    workingDirectory,
    domainLabel,
    workspaceTree,
  };
}

async function buildLocalGuiOperatorWorkspaceHome(input: {
  readonly projectedAt: string;
  readonly sessions: GuiDashboardSnapshot["sessions"];
  readonly transcriptStore: TranscriptStore;
  readonly configHealth: OperatorWorkspaceConfigHealthSummary;
}): Promise<NonNullable<GuiDashboardSnapshot["operatorWorkspaceHome"]>> {
  const eventGroups = await Promise.all(input.sessions.map(async (session) => {
    const detail = await loadSessionDetail(input.transcriptStore, session.id).catch(() => null);
    return detail?.events.length
      ? detail.events.map((event) => localGuiOperatorEvent(event, session.id))
      : [operatorWorkspaceSessionSummaryEvent({
        instanceId: LOCAL_GUI_COCKPIT_INSTANCE_ID,
        sessionId: session.id,
        sequence: 0,
        timestamp: session.completedAt,
        title: session.title ?? session.taskSummary ?? session.id,
      })];
  }));
  const events = eventGroups.flat();
  const cockpitProjection = projectOperatorCockpitReadOnlyView({
    projectedAt: input.projectedAt,
    attachTargets: [{
      instanceId: LOCAL_GUI_COCKPIT_INSTANCE_ID,
      label: "Local GUI",
      kind: "local",
      gatewayUrl: "http://localhost",
    }],
    events,
  });
  const cockpitView = createOperatorCockpitReadOnlyViewState({
    projection: cockpitProjection,
    viewState: {},
  });
  return createOperatorWorkspaceHomeProjection({
    projectedAt: input.projectedAt,
    cockpitView,
    events,
    configHealth: input.configHealth,
  });
}

async function readLocalGuiConfigHealth(projectPath: string): Promise<OperatorWorkspaceConfigHealthSummary> {
  try {
    return createOperatorWorkspaceConfigHealthSummary((await readConfigStatusSnapshot({ projectPath })).setup);
  } catch (error) {
    return {
      status: "blocked",
      issueCount: 1,
      items: [{
        id: "config-status",
        status: "blocked",
        summary: error instanceof Error ? error.message : String(error),
        source: projectPath,
        recommendation: "review-project-context",
      }],
    };
  }
}

function localGuiOperatorEvent(event: OperatorSessionEvent, sessionId: string): OperatorSessionEvent {
  const payload = typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
  return {
    ...event,
    payload: {
      ...payload,
      instanceId: LOCAL_GUI_COCKPIT_INSTANCE_ID,
      sessionId: readNonEmptyString(payload.sessionId) ?? sessionId,
    },
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function operatorWorkspaceSessionSummaryEvent(input: {
  readonly instanceId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly title: string;
}): OperatorSessionEvent {
  return {
    eventId: `${input.sessionId}:operator-workspace-summary`,
    kilnSessionId: input.sessionId,
    sequence: input.sequence,
    timestamp: input.timestamp,
    kind: "turn_started",
    source: {
      actor: "runtime",
      surface: "gui",
      component: "operator-workspace-dashboard",
    },
    payload: {
      instanceId: input.instanceId,
      sessionId: input.sessionId,
      title: input.title,
    },
  };
}

function resolveGuiMode(_cwd: string, explicitMode: GuiFlags["mode"]): "dev" | "prod" {
  if (explicitMode) {
    return explicitMode;
  }
  return "prod";
}

function spawnGuiDevServer(cwd: string, guiPort: number, gatewayPort: number): ChildProcess {
  const guiWorkspacePath = join(cwd, "packages", "gui");
  if (!existsSync(join(guiWorkspacePath, "package.json"))) {
    throw new Error(`GUI workspace not found at ${guiWorkspacePath}`);
  }

  const child = spawn("bun", ["run", "--cwd", "packages/gui", "dev", "--", "--port", String(guiPort)], {
    cwd,
    env: {
      ...process.env,
      GUI_PORT: String(guiPort),
      GUI_GATEWAY_PORT: String(gatewayPort),
      VITE_GATEWAY_PORT: String(gatewayPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const devOutput = createGuiDevServerOutput({
    stdout: process.stdout,
    stderr: process.stderr,
  });

  child.stdout.on("data", devOutput.writeStdout);
  child.stderr.on("data", devOutput.writeStderr);
  child.on("error", (error) => {
    console.error(`Dev server: failed to start: ${error.message}`);
  });

  return child;
}

async function stopChildProcess(child: ChildProcess, label: string): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000);
    child.once("exit", finish);
    if (!child.kill("SIGINT")) {
      child.kill("SIGTERM");
    }
  });
  console.log(`[${label}] stopped`);
}

function printStartupBanner(input: { mode: "dev" | "prod" | "attach"; gatewayUrl: string; guiUrl: string; apiUrl: string }): void {
  console.log("Kiln GUI");
  console.log(`Mode: ${input.mode}`);
  console.log(`Gateway URL: ${input.gatewayUrl}`);
  console.log(`GUI URL: ${input.guiUrl}`);
  console.log(`Dashboard API: ${input.apiUrl}`);
}

async function readTelemetrySnapshot(): Promise<GuiDashboardSnapshot["telemetry"]> {
  try {
    const snapshot = await getFieldStore().snapshot();
    const regions = [...snapshot.regions.values()];
    const saturation = regions.length > 0
      ? regions.reduce((sum, region) => sum + region.value, 0) / regions.length
      : 0;

    return {
      status: regions.length === 0 ? "idle" : "stable",
      dominantRegions: snapshot.dominantRegions.slice(0, 3),
      saturation,
      entropy: snapshot.entropy,
    };
  } catch {
    return {
      status: "idle",
      dominantRegions: [],
      saturation: 0,
      entropy: 0,
    };
  }
}

async function waitForShutdown(
  onShutdown: () => Promise<void> | void,
  guiWindow?: GuiWindowSession,
  managedWindowDisconnect?: Promise<void>,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      guiWindow?.whenClosed.catch((error) => {
        console.error(`GUI window exited unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
      });
      Promise.resolve(onShutdown()).finally(resolve);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    void managedWindowDisconnect?.then(shutdown);
    void guiWindow?.whenClosed.then(shutdown, (error) => {
      console.error(`Could not launch GUI window: ${error instanceof Error ? error.message : String(error)}`);
      shutdown();
    });
  });
}
