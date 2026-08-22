import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";
import {
  readGlobalConfig,
  readGlobalConfigSnapshot,
  readGlobalExecutionTargetAuthority,
} from "../config/global-config.js";
import {
  createCurrentExecutionRoute,
  parseExecutionTargetWizardRevision,
} from "../application/current-execution-route-creation.js";
import { withGlobalIdentityContext } from "../config/operator-identity-context.js";
import { withContextCandidates } from "../application/agent-skill-context.js";
import { resolveInstructionProfileContextCandidates } from "../application/instruction-profile-context.js";
import { withWorkGovernanceContext } from "../application/work-governance-context.js";
import { readConfigStatusSnapshot } from "../application/config-status.js";
import { executeConfigSetupAction } from "../application/config-setup-actions.js";
import {
  applyConfigMutation,
  approveConfigMutation,
  proposeConfigMutation,
} from "../application/config-mutation-authority.js";
import { ConfigMutationStore } from "../application/config-mutation-store.js";
import { admitSettingsProposalRecord, readSettingsSnapshot } from "../application/config-settings.js";
import {
  applyConfigurationOnboarding,
  readConfigurationOnboarding,
} from "../application/configuration-onboarding.js";
import {
  createCliTranscriptSessionTokenUsageReader,
  createRuntimeSessionTurnBudgetFromGlobalConfig,
} from "../application/session-turn-budget.js";
import { readKilnYaml } from "../kiln-yaml.js";
import { loadKilnConfig, loadResolvedKilnMcpConfiguration } from "../config/config-merger.js";
import { resolveModelFacingPermissionPolicy } from "../config/model-facing-permission-policy.js";
import { configuredCommunicationCandidates, resolveConfiguredCommunication } from "../config/communication-policy.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { createKilnConfigTools } from "../application/config-tools.js";
import { createWorkGovernanceTools } from "../application/work-governance-tool.js";
import { createProjectBoundedWorkAuthority } from "../application/bounded-work-authority-composition.js";
import { createStagedManagedInvocationRouteCatalog } from "../config/managed-agent-route-catalog.js";
import {
  readProviderDiscoveryCache,
  writeProviderDiscoveryCache,
} from "../config/provider-discovery-cache.js";
import {
  loadConfiguredBuiltinToolSurfaceOptions,
  observeFormalVerificationCapability,
  withProgressiveRuntimeToolProjection,
} from "../config/builtin-tool-surface-config.js";
import { resolveProjectMemoryScope } from "../config/web-tools-config.js";
import { resolveOperatorVoiceRuntime } from "../config/operator-voice.js";
import { resolveEngineAvailabilityMap } from "../engines/engine-registry.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { createStartupProfiler } from "../application/startup-profiler.js";
import { loadContinuationSidebarInfo } from "../application/continuation-sidebar-info.js";
import { createTranscriptRuntimeSessionHydrator } from "../application/runtime-session-rehydration.js";
import { GoalControlService } from "../application/goal-control-service.js";
import { recoverStaleOpenTranscriptSessions } from "../application/transcript-session-recovery.js";
import {
  createKilnRuntimeManagedInvocationAttachment,
  createManagedInvocationExecutionProofResolverRef,
} from "../application/managed-invocation-attachment.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import type { KilnPermissionPolicy } from "../wrapper/session.js";
import { loadSessionDetail } from "./gui-session-detail.js";
import { toCanonicalSessionEventPersistedTranscriptEventDraft } from "../application/operator-transcript-projection.js";
import {
  createDefaultRegistry,
  getRuntimeProviderAvailability,
  getProviderDisplayInfo,
  type ProviderId,
} from "../wrapper/session-registry.js";
import { makeMultiProviderSessionFactory } from "./tui.js";
import {
  getProjectContextArtifactCache,
  type OperatorTurnDispatchResult,
  type OperatorTurnGuiDispatchPayload,
  type GuiGateway,
  withManagedInvocationService,
  type GuiDashboardSnapshot,
  type GuiProviderDescriptor,
  type ExecutionTargetWizardApplicationResult,
  executionTargetWizardDiscoveryEvidence,
  projectAvailableModelCatalogForExecutionRoutes,
  projectGuiProviderModelDiscovery,
  resolveGuiOperatorDiscoveryResults,
} from "@kilnai/runtime";
import {
  captureOperatorExecutionCatalogSnapshot,
  createOperatorTurnDispatchComposition,
  resolveOperatorContinuationBinding,
} from "../application/operator-turn-dispatch-composition.js";
import { readRuntimeConfigurationRevision } from "../application/runtime-configuration-revision.js";
import { GoalRunStore, WorkItemStore, createSessionBuiltinToolOptions, getFieldStore } from "@kilnai/core";
import { resolveGuiThemePreference } from "../application/operator-theme-preferences.js";
import { buildGuiAttachUrl, buildGuiUrl } from "./gui-options.js";
import { createLocalWorkspaceExplorer } from "./gui-workspace.js";
import { createManagedGuiWindowShutdownMonitor } from "./gui-shutdown-monitor.js";
import { launchGuiWindow, type GuiWindowSession } from "./gui-window.js";
import { loadOperatorSessionSummaries } from "../application/operator-session-history.js";
import { createGuiDevServerOutput } from "./gui-dev-server-output.js";
import { stopGuiChildProcess } from "./gui-child-process.js";
import { createOperatorSurfaceEconomicAuthority } from "../application/operator-surface-economic-authority.js";
import {
  createOperatorExecutionRouteSelectionPort,
  resolveOperatorStartupExecutionRoute,
} from "../application/operator-execution-route-selection.js";
import {
  createGuiCommandOutput,
  type GuiCommandOutput,
} from "./gui-command-output.js";
import {
  createOperatorCockpitReadOnlyViewState,
  createOperatorWorkspaceConfigHealthSummary,
  createOperatorWorkspaceHomeProjection,
  getGuiProviderMetadata,
  isGuiProviderModeless,
  projectOperatorCockpitReadOnlyView,
  projectKilnSettingsMutationResult,
  projectKilnSettingsProposal,
  type GuiProviderDiscoveryResult,
  type OperatorSessionEvent,
  type OperatorSessionSummary,
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
  readonly theme?: string;
  readonly plan?: boolean;
}

export async function guiCommand(
  appConfig: KilnAppConfig,
  flags: GuiFlags = {},
  output: GuiCommandOutput = createGuiCommandOutput({
    stdout: process.stdout,
    stderr: process.stderr,
  }),
): Promise<void> {
  const startupProfiler = createStartupProfiler("gui");
  startupProfiler.mark("command-entered");
  const cwd = resolveProjectRoot({ explicitPath: flags.cwd }).rootPath;
  const globalConfig = readGlobalConfig();
  const projectConfig = readKilnYaml(join(cwd, ".kiln"));
  const resolvedKilnConfig = await loadKilnConfig(cwd);
  const permissionPolicy = resolveModelFacingPermissionPolicy(resolvedKilnConfig?.permissions);
  const mcpResolution = loadResolvedKilnMcpConfiguration(cwd);
  const admittedMcpServers = mcpResolution.diagnostics.length === 0
    ? Object.values(mcpResolution.servers).filter((server) => server.enabled && server.admission?.state === "admitted")
    : [];
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
    await guiAttachCommand(flags.connect, themePreference, flags, output);
    return;
  }

  const mode = resolveGuiMode(cwd, flags.mode);
  const port = flags.port ?? 4810;
  const guiPort = flags.guiPort ?? 5183;
  const sessionStore = new SessionStore(cwd);
  const { registry } = createDefaultRegistry({
    canonicalMcpServers: admittedMcpServers,
    canonicalMcpProjectPath: cwd,
    runtimePermissionObservationProjectPath: cwd,
  });
  const providerDisplay = getProviderDisplayInfo(registry);
  const providerIds = providerDisplay.map((provider) => provider.id);
  if (!globalConfig) throw new Error("An execution-route global configuration is required to start the GUI.");
  const executionTargetAuthority = readGlobalExecutionTargetAuthority(globalConfig);
  if (!executionTargetAuthority) throw new Error("A direct target catalog is required to start the GUI.");
  const operatorExecutionCatalog = executionTargetAuthority.executionCatalog;
  const startupRoute = resolveOperatorStartupExecutionRoute(globalConfig, operatorExecutionCatalog);
  const provider = parseStartupProvider(startupRoute.providerId, providerIds);
  const startupModel = startupRoute.providerModelId;
  const transcriptStore = new TranscriptStore(cwd);
  await recoverStaleOpenTranscriptSessions({
    transcriptStore,
    sessionStore,
    projectPath: cwd,
  });
  const sessionTurnBudget = createRuntimeSessionTurnBudgetFromGlobalConfig(
    globalConfig,
    createCliTranscriptSessionTokenUsageReader(transcriptStore),
  );
  const workItemStore = new WorkItemStore();
  const goalRunStore = new GoalRunStore();
  const goalControlService = new GoalControlService(goalRunStore, transcriptStore);
  const managedInvocationProofs = createManagedInvocationExecutionProofResolverRef();
  const resumeSessionHydrator = createTranscriptRuntimeSessionHydrator({
    transcriptStore,
    workItemStore,
    goalRunStore,
  });
  const contextArtifactCache = await getProjectContextArtifactCache(cwd);
  startupProfiler.mark("context-cache-ready");
  const configuredBuiltinToolOptions = await loadConfiguredBuiltinToolSurfaceOptions(runtimeAppConfig, cwd, {
    globalConfig,
    memoryAuthority: {
      modelFacingSession: true,
      permissionAgent: "gui",
      caller: { kind: "operator_surface", id: "gui" },
    },
  });
  startupProfiler.mark("builtin-tool-options-loaded");
  const boundedWork = createProjectBoundedWorkAuthority(cwd, {
    formalVerificationCapability: observeFormalVerificationCapability(configuredBuiltinToolOptions),
  });
  let builtinToolOptions = createSessionBuiltinToolOptions(withProgressiveRuntimeToolProjection({
    ...configuredBuiltinToolOptions,
    workItemStore,
    goalRunStore,
    additionalTools: [
      ...(configuredBuiltinToolOptions.additionalTools ?? []),
      ...createKilnConfigTools(cwd),
      ...createWorkGovernanceTools(resolvedKilnConfig?.workGovernance, {
        workItemStore,
        goalRunStore,
        managedInvocationProofResolver: managedInvocationProofs.resolve,
        boundedWorkExecutionAttemptAdmission: boundedWork.admitExecutionAttempt,
        boundedWorkCandidateCloseout: boundedWork.closeoutCandidate,
        boundedWorkGoalCloseout: boundedWork.closeoutGoal,
      }),
    ],
  }, "execute"));
  startupProfiler.mark("builtin-tool-options-created");
  let managedRouteGlobalConfig = {
    ...globalConfig,
    executionCatalog: operatorExecutionCatalog,
    executionTargetEvidence: executionTargetAuthority.evidence,
  };
  let managedRouteEngineAvailability = resolveEngineAvailabilityMap(managedRouteGlobalConfig);
  const operatorEconomicAuthority = appConfig.managedInvocation
    ? undefined
    : createOperatorSurfaceEconomicAuthority("gui", cwd);
  const stagedManagedInvocation = appConfig.managedInvocation
    ? undefined
    : await createStagedManagedInvocationRouteCatalog(managedRouteGlobalConfig, {
      cwd,
      registry,
      surface: "gui",
      maxParallelChildren: resolvedKilnConfig?.parallelWorkers ?? 1,
      isProviderAvailable: (providerId) => managedRouteEngineAvailability.get(providerId),
      directAdapterFactory: createManagedDirectProviderAdapterFactory({
        builtinToolOptions: () => builtinToolOptions,
        canonicalMcpServers: admittedMcpServers,
      }),
      builtinToolOptions: () => builtinToolOptions,
      artifactStore: builtinToolOptions.artifactResources?.store,
      managedEconomicAuthority: operatorEconomicAuthority?.authority,
    }, {
      reloadConfig: () => {
        const refreshedGlobalConfig = readGlobalConfig() ?? globalConfig;
        const refreshedAuthority = readGlobalExecutionTargetAuthority(refreshedGlobalConfig);
        if (!refreshedAuthority) throw new Error("A direct target catalog is required to refresh GUI routes.");
        managedRouteGlobalConfig = {
          ...refreshedGlobalConfig,
          executionCatalog: refreshedAuthority.executionCatalog,
          executionTargetEvidence: refreshedAuthority.evidence,
        };
        managedRouteEngineAvailability = resolveEngineAvailabilityMap(refreshedGlobalConfig);
        return managedRouteGlobalConfig;
      },
      onRefreshError: (error) => {
        output.warn(`Managed invocation provider discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      },
    });
  startupProfiler.mark("managed-invocation-staged", {
    hasManagedInvocation: Boolean(stagedManagedInvocation?.managedInvocation ?? appConfig.managedInvocation),
  });
  const managedInvocation = appConfig.managedInvocation ?? stagedManagedInvocation?.managedInvocation;
  const managedInvocationWithService = managedInvocation
    ? withManagedInvocationService(managedInvocation)
    : undefined;
  managedInvocationProofs.bind(managedInvocationWithService);
  const managedInvocationAttachment = managedInvocationWithService
    ? createKilnRuntimeManagedInvocationAttachment("gui", managedInvocationWithService)
    : undefined;
  const operatorVoice = await resolveOperatorVoiceRuntime(globalConfig);
  startupProfiler.mark("voice-runtime-ready");
  for (const warning of operatorVoice.warnings) {
    output.warn(warning);
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
    sessionTurnBudget,
    resolveConfiguredCommunication({
      global: globalConfig.communication,
      project: projectConfig?.communication,
    }),
    permissionPolicy,
  );
  startupProfiler.mark("session-manager-ready");
  const managedInvocationForGateway = sessionManager.managedInvocation ?? managedInvocationAttachment;
  if (startupModel) {
    sessionManager.setModel(startupModel);
  }
  const bootstrapContext = await resolveGuiBootstrapContext(
    runtimeAppConfig,
    cwd,
    contextArtifactCache,
    permissionPolicy,
  );
  startupProfiler.mark("bootstrap-context-ready");
  const managedWindowShutdownMonitor = createManagedGuiWindowShutdownMonitor();
  const workspaceExplorer = createLocalWorkspaceExplorer(cwd);
  const initialOperatorDiscovery = readProviderDiscoveryCache(cwd);
  const { startGuiGateway } = await import("@kilnai/runtime");
  const operatorTurnComposition = createOperatorTurnDispatchComposition<OperatorTurnGuiDispatchPayload, OperatorTurnDispatchResult>({
    initialCatalog: operatorExecutionCatalog,
    captureCatalogSnapshot: () => captureOperatorExecutionCatalogSnapshot({
      projectPath: cwd,
      readConfigSnapshot: readGlobalConfigSnapshot,
      readConfigurationRevision: readRuntimeConfigurationRevision,
    }),
    cwd,
  });
  const executionRouteSelection = createOperatorExecutionRouteSelectionPort({
    readConfigSnapshot: () => {
      const snapshot = readGlobalConfigSnapshot();
      return { config: snapshot.config ?? globalConfig, revision: snapshot.revision };
    },
    resolveAccountAvailability: operatorTurnComposition.resolveExecutionRouteAccountAvailability,
  });
  let gateway: GuiGateway | undefined;
  let viteDevServer: GuiDevServerSession | undefined;
  let guiWindow: GuiWindowSession | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= closeGuiRuntimeResources([
      () => managedWindowShutdownMonitor.dispose(),
      () => guiWindow?.close(),
      async () => {
        if (viteDevServer) await stopChildProcess(viteDevServer.child, "gui-dev", output);
      },
      () => gateway?.shutdown(),
      () => operatorTurnComposition.close(),
      () => stagedManagedInvocation?.dispose(),
      () => operatorEconomicAuthority?.close(),
      () => boundedWork.close(),
    ]);
    return cleanupPromise;
  };

  startupProfiler.mark("gateway-start-requested");
  gateway = await startGuiGateway({
    port,
    guiAssetMode: mode === "dev" ? "external" : "bundled",
    runtimeConfigurationRevisionProvider: () => readRuntimeConfigurationRevision(cwd),
    getProviderAvailability: () => getRuntimeProviderAvailability(registry),
    getSnapshot: async (context) => ({
      ...await buildDashboardSnapshot(
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
      executionRouteCatalog: await executionRouteSelection.getCatalog(),
    }),
    getSetupSnapshot: async () => {
      const snapshot = await readConfigStatusSnapshot({ projectPath: cwd });
      return { ...snapshot.setup, ...(snapshot.effectiveConfig ? { effectiveConfig: snapshot.effectiveConfig } : {}) };
    },
    executeSetupAction: async (action) => executeConfigSetupAction({ projectPath: cwd, action }),
    getConfigurationOnboarding: async () => readConfigurationOnboarding({ projectPath: cwd }),
    applyConfigurationOnboarding: async (request) => applyConfigurationOnboarding({
      projectPath: cwd,
      request,
      approve: true,
      approvedBy: process.env.USERNAME ?? process.env.USER ?? "operator",
      approvalSurface: "gui",
    }),
    getSettingsSnapshot: async () => readSettingsSnapshot(
      await readConfigStatusSnapshot({ projectPath: cwd, view: "settings" }),
    ),
    proposeSettingsMutation: async (request) => {
      const record = proposeConfigMutation({
        projectPath: cwd,
        operation: request.operation,
        payload: request,
      });
      new ConfigMutationStore(cwd).saveProposal(record);
      return projectKilnSettingsProposal(record.proposal);
    },
    applySettingsMutation: async (request) => {
      const store = new ConfigMutationStore(cwd);
      const record = admitSettingsProposalRecord(store.readProposal(request.proposalId), request.proposalId);
      let approvalId = request.approvalId;
      if (!approvalId && record?.proposal.approvalRequired) {
        approvalId = approveConfigMutation({
          projectPath: cwd,
          proposalId: request.proposalId,
          approvedBy: process.env.USERNAME ?? process.env.USER ?? "operator",
          surface: "gui",
        }).approvalId;
      }
      return projectKilnSettingsMutationResult(await applyConfigMutation({
        projectPath: cwd,
        proposalId: request.proposalId,
        ...(approvalId ? { approvalId } : {}),
        requester: "operator",
        readEffectiveState: async (projectPath) => (
          await readConfigStatusSnapshot({ projectPath, view: "effective" })
        ).effectiveConfig,
      }));
    },
    loadOperatorSessionHistory: () => loadOperatorSessionSummaries(sessionStore, transcriptStore),
    getSessionDetail: (sessionId) => loadSessionDetail(transcriptStore, sessionId),
    workingDirectory: cwd,
    domainLabel: bootstrapContext.domainLabel,
    workspaceExplorer,
    executionRouteSelection,
    runExecutionTargetWizard: async (request, admittedEvidence): Promise<ExecutionTargetWizardApplicationResult> => {
      const result = await createCurrentExecutionRoute({
        request,
        admittedEvidence,
        projectPath: cwd,
        approvalSurface: "gui",
        resolveCurrentEvidence: async () => {
          const snapshot = readGlobalConfigSnapshot();
          const targetAuthority = readGlobalExecutionTargetAuthority(snapshot.config);
          const targetIntent = snapshot.config?.targetCatalog;
          if (!targetAuthority || !targetIntent) throw new Error("Direct target catalog is unavailable.");
          const discovery = projectGuiProviderModelDiscovery(await resolveGuiOperatorDiscoveryResults(getRuntimeProviderAvailability(registry)));
          const executionRouteCatalog = await executionRouteSelection.getCatalog();
          const catalog = projectAvailableModelCatalogForExecutionRoutes({ discovery, executionRouteCatalog });
          const currentEntry = catalog.entries.find((entry) => entry.providerId === request.discoveryIdentity.providerId
            && entry.providerRouteId === request.discoveryIdentity.providerRouteId
            && entry.providerModelId === request.discoveryIdentity.providerModelId);
          if (!currentEntry) throw new Error("The selected Available Models identity is no longer current.");
          return {
            catalog,
            executionCatalog: targetAuthority.executionCatalog,
            targetIntent,
            targetEvidence: targetAuthority.evidence,
            revision: snapshot.revision,
            discoveryEvidence: executionTargetWizardDiscoveryEvidence(discovery, currentEntry),
          };
        },
      });
      if (result.status === "previewed") {
        return {
          status: "previewed",
          proposal: result.proposal,
          message: result.message,
        };
      }
      if (result.status === "rejected") {
        return {
          status: "rejected",
          code: result.code,
          action: result.action,
          message: result.message,
          ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
          ...(result.proposal ? { proposal: result.proposal } : {}),
        };
      }
      return {
        status: result.status,
        proposal: result.proposal,
        revision: parseExecutionTargetWizardRevision(result.revision),
      };
    },
    onConnectionCountChange: managedWindowShutdownMonitor.onConnectionCountChange,
    onManagedWindowClose: managedWindowShutdownMonitor.onManagedWindowClose,
    initialOperatorDiscovery,
    onOperatorDiscoveryResolved: (discovery) => writeProviderDiscoveryCache(cwd, discovery),
    builtinToolOptions,
    managedInvocation: managedInvocationForGateway,
    boundedWork: boundedWork.surface,
    communicationIntentCandidates: configuredCommunicationCandidates({
      global: globalConfig.communication,
      project: projectConfig?.communication,
    }),
    memoryLatticeDefaultScope: resolveProjectMemoryScope(cwd),
    operatorTransport: {
      sessionManager,
      operatorTurnDispatcher: operatorTurnComposition.dispatcher,
      operatorTurnExecutionBridge: operatorTurnComposition.bridge,
      systemPrompt: bootstrapContext.systemPrompt,
      onClear: sessionManager.onClear,
      persistCanonicalSessionEvent: async (event) => {
        await transcriptStore.appendManyNext(
          event.kilnSessionId,
          [toCanonicalSessionEventPersistedTranscriptEventDraft(event)],
        );
      },
      onContinueSession: async (sessionId, requestedRouteId) => {
        const meta = await transcriptStore.readMeta(sessionId);
        const binding = [...(meta?.executionBindings ?? [])].reverse().find((entry) => entry.status === "bound");
        const routeId = requestedRouteId ?? binding?.routeId;
        const route = routeId
          ? operatorExecutionCatalog.routes.find((candidate) => candidate.id === routeId)
          : undefined;
        if (!binding || !route) throw new Error("Continuation account binding is unavailable.");
        const continuation = await resolveOperatorContinuationBinding({
          catalog: operatorExecutionCatalog,
          accountRuntime: operatorTurnComposition.accountRuntime,
          binding,
          requestedRouteId: route.id,
        });
        if (!continuation || !sessionManager.setProvider(route.providerId)) {
          throw new Error("Continuation route/account binding is no longer executable.");
        }
        sessionManager.setModel(route.providerModelId);
        if (!sessionManager.setContinuationSession(sessionId, route.providerId)) {
          throw new Error("Continuation session is unavailable for the committed provider.");
        }
      },
      resumeSessionHydrator,
      contextArtifactCache,
      artifactStore: builtinToolOptions.artifactResources?.store,
      voiceConfig: operatorVoice.voiceConfig,
      sttAdapter: operatorVoice.sttAdapter,
      ttsAdapter: operatorVoice.ttsAdapter,
      executionMode: flags.plan ? "plan" : "execute",
      managedInvocation: managedInvocationForGateway,
      operatorTimeZone: runtimeAppConfig.operatorTimeZone,
      sessionTurnBudget,
      workingDirectory: cwd,
      domainLabel: bootstrapContext.domainLabel,
    },
    goalController: {
      control: (input) => goalControlService.control({ ...input, sourceSurface: "gui" }),
    },
  }).catch((startupError) => rollbackGuiStartup(startupError, cleanup));
  startupProfiler.mark("gateway-started", { port: gateway.port });

  try {
    stagedManagedInvocation?.startBackgroundRefresh();

    if (mode === "dev") {
      startupProfiler.mark("gui-vite-start-requested", { port: guiPort });
      viteDevServer = spawnGuiDevServer(cwd, guiPort, gateway.port, output);
    }

    const gatewayUrl = `http://localhost:${gateway.port}/gui/`;
    const devGuiUrl = `http://localhost:${guiPort}/gui/`;
    const guiUrl = buildGuiUrl(
      mode === "dev" ? devGuiUrl : gatewayUrl,
      themePreference,
      gateway.operatorTerminalCapability,
    );
    printStartupBanner({ mode, gatewayUrl, guiUrl, apiUrl: gateway.apiUrl }, output);
    startupProfiler.mark("startup-banner-printed", { mode });

    if (viteDevServer) {
      await viteDevServer.whenReady;
      startupProfiler.mark("gui-vite-ready", { port: guiPort });
    }
    if (flags.open ?? true) {
      startupProfiler.mark("browser-launch-requested");
      guiWindow = launchGuiWindow(guiUrl);
      startupProfiler.mark("browser-launched");
      output.info(`GUI window host: ${guiWindow.browserLabel}`);
    }
  } catch (startupError) {
    return rollbackGuiStartup(startupError, cleanup);
  }

  await waitForShutdown(
    cleanup,
    output,
    guiWindow,
    guiWindow ? managedWindowShutdownMonitor.waitForDisconnect() : undefined,
  );
}

async function guiAttachCommand(
  connectUrl: string,
  themePreference: ReturnType<typeof resolveGuiThemePreference>,
  flags: GuiFlags,
  output: GuiCommandOutput,
): Promise<void> {
  const guiUrl = buildGuiAttachUrl(connectUrl, themePreference);
  const gatewayUrl = new URL(guiUrl).origin;
  printStartupBanner({
    mode: "attach",
    gatewayUrl: `${gatewayUrl}/gui/`,
    guiUrl,
    apiUrl: `${gatewayUrl}/gui/api/dashboard`,
  }, output);

  let guiWindow: GuiWindowSession | undefined;
  if (flags.open ?? true) {
    guiWindow = launchGuiWindow(guiUrl);
    output.info(`GUI window host: ${guiWindow.browserLabel}`);
    await waitForShutdown(() => guiWindow?.close(), output, guiWindow);
  }
}

function parseStartupProvider(p: string | undefined, providerIds: readonly ProviderId[]): ProviderId {
  const provider = typeof p === "string" ? p.trim() : "";
  if (provider.length === 0) {
    throw new Error("The configured execution target does not specify a provider.");
  }
  if (providerIds.includes(provider as ProviderId)) {
    return provider as ProviderId;
  }
  throw new Error(
    `The configured GUI execution target uses unsupported provider '${provider}'. Configure one of: ${providerIds.join(", ")}`,
  );
}

async function resolveGuiBootstrapContext(
  appConfig: KilnAppConfig,
  cwd: string,
  contextArtifactCache: Awaited<ReturnType<typeof getProjectContextArtifactCache>>,
  permissionPolicy: KilnPermissionPolicy,
): Promise<{ systemPrompt: string; domainLabel: string }> {
  try {
    const { SessionManager } = await import("../wrapper/session-manager.js");
    const wrapperConfig = {
      mode: "cli-wrapper" as const,
      permissionPolicy,
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
  const sessions = await loadOperatorSessionSummaries(sessionStore, transcriptStore);

  const providerHealth = new Map(
    Object.entries(getRuntimeProviderAvailability(registry)),
  );

  const discoveryByProvider = new Map(runtimeProviderDiscovery.map((entry) => [entry.provider, entry] as const));
  const providerDescriptors: GuiProviderDescriptor[] = providers.map((provider) => {
    const discovery = discoveryByProvider.get(provider.id);
    if (discovery) {
      return {
        id: provider.id,
        label: getGuiProviderMetadata(provider.id)?.label ?? provider.id,
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
      label: getGuiProviderMetadata(provider.id)?.label ?? provider.id,
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
    executionRouteCatalog: { routes: [] },
    providers: providerDescriptors,
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
  readonly sessions: readonly OperatorSessionSummary[];
  readonly transcriptStore: TranscriptStore;
  readonly configHealth: OperatorWorkspaceConfigHealthSummary;
}): Promise<NonNullable<GuiDashboardSnapshot["operatorWorkspaceHome"]>> {
  const eventGroups = await Promise.all(input.sessions.map(async (session) => {
    const detail = await loadSessionDetail(input.transcriptStore, session.sessionId).catch(() => null);
    return detail?.events.length
      ? detail.events.map((event) => localGuiOperatorEvent(event, session.sessionId))
      : [operatorWorkspaceSessionSummaryEvent({
        instanceId: LOCAL_GUI_COCKPIT_INSTANCE_ID,
        sessionId: session.sessionId,
        sequence: 0,
        timestamp: session.updatedAt,
        title: session.title,
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

interface GuiDevServerSession {
  readonly child: ChildProcess;
  readonly whenReady: Promise<void>;
}

function spawnGuiDevServer(
  cwd: string,
  guiPort: number,
  gatewayPort: number,
  output: GuiCommandOutput,
): GuiDevServerSession {
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

  let ready = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const whenReady = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const devOutput = createGuiDevServerOutput({
    stdout: process.stdout,
    stderr: process.stderr,
    onReady: () => {
      if (!ready) {
        ready = true;
        resolveReady();
      }
    },
  });

  child.stdout.on("data", devOutput.writeStdout);
  child.stderr.on("data", devOutput.writeStderr);
  child.on("error", (error) => {
    output.error(`Dev server failed to start: ${error.message}`);
    if (!ready) {
      rejectReady(error);
    }
  });
  child.on("exit", (code) => {
    if (!ready) {
      rejectReady(new Error(`GUI dev server exited before readiness with code ${code ?? "unknown"}.`));
    }
  });

  return { child, whenReady };
}

async function stopChildProcess(
  child: ChildProcess,
  label: string,
  output: GuiCommandOutput,
): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  await stopGuiChildProcess(child);
  output.info(`[${label}] stopped`);
}

function printStartupBanner(
  input: { mode: "dev" | "prod" | "attach"; gatewayUrl: string; guiUrl: string; apiUrl: string },
  output: GuiCommandOutput,
): void {
  output.info("Kiln GUI");
  output.info(`Mode: ${input.mode}`);
  output.info(`Gateway URL: ${input.gatewayUrl}`);
  output.info(`GUI URL: ${input.guiUrl}`);
  output.info(`Dashboard API: ${input.apiUrl}`);
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
  output: GuiCommandOutput,
  guiWindow?: GuiWindowSession,
  managedWindowDisconnect?: Promise<void>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      guiWindow?.whenClosed.catch((error) => {
        output.error(`GUI window exited unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
      });
      void Promise.resolve(onShutdown()).then(resolve, reject);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    void managedWindowDisconnect?.then(shutdown);
    void guiWindow?.whenClosed.then(shutdown, (error) => {
      output.error(`Could not launch GUI window: ${error instanceof Error ? error.message : String(error)}`);
      shutdown();
    });
  });
}

async function closeGuiRuntimeResources(
  closeSteps: readonly (() => void | Promise<void> | undefined)[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const close of closeSteps) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Multiple GUI resources failed to close.");
  }
}

async function rollbackGuiStartup(startupError: unknown, cleanup: () => Promise<void>): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupError) {
    throw new AggregateError(
      [startupError, cleanupError],
      "GUI startup failed and acquired resources could not be fully released.",
    );
  }
  throw startupError;
}
