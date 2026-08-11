import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../../src/config.js";

const gatewayHarness = vi.hoisted(() => ({
  snapshot: null as {
    providers?: Array<{ id: string; available: boolean }>;
    operatorWorkspaceHome?: {
      sessions?: Array<{ sessionId: string; instanceId: string }>;
      configHealth?: {
        status: string;
        issueCount: number;
        items: Array<{ id: string; status: string; recommendation?: string }>;
      };
    };
    workingDirectory?: string;
  } | null,
  operatorModels: {} as Record<string, string[]>,
  lastOptions: null as {
    builtinToolOptions?: unknown;
    guiAssetMode?: "bundled" | "external";
    operatorTransport?: Record<string, unknown>;
    workingDirectory?: string;
  } | null,
  shutdown: vi.fn(),
  closeWindow: vi.fn(),
  startGuiGateway: vi.fn(async (options: {
    getSnapshot: (context?: { operatorModels?: Record<string, string[]> }) => Promise<unknown>;
    builtinToolOptions?: unknown;
    guiAssetMode?: "bundled" | "external";
    operatorTransport?: Record<string, unknown>;
    workingDirectory?: string;
  }) => {
    gatewayHarness.lastOptions = options;
    gatewayHarness.snapshot = await options.getSnapshot({
      operatorModels: gatewayHarness.operatorModels,
    }) as {
      providers?: Array<{ id: string; available: boolean }>;
      operatorWorkspaceHome?: {
        sessions?: Array<{ sessionId: string; instanceId: string }>;
        configHealth?: {
          status: string;
          issueCount: number;
          items: Array<{ id: string; status: string; recommendation?: string }>;
        };
      };
      workingDirectory?: string;
    };
    return {
      port: 4810,
      apiUrl: "http://localhost:4810/gui/api/dashboard",
      shutdown: gatewayHarness.shutdown,
    };
  }),
}));

const sessionManagerMocks = vi.hoisted(() => ({
  onClear: vi.fn(),
  setModel: vi.fn(),
  setProvider: vi.fn(),
  setContinuationSession: vi.fn(),
}));

const registryMocks = vi.hoisted(() => {
  const mock = {
    providers: [{
      id: "openai",
      group: "direct-api",
      models: ["gpt-5.4"],
      free: false,
      health: "healthy" as const,
      isAvailable: () => false,
    }],
    createDefaultRegistry: vi.fn(() => ({
      registry: {
        list: () => mock.providers.map((provider) => ({
          id: provider.id,
          health: provider.health,
          isAvailable: provider.isAvailable,
        })),
      },
    })),
    getProviderDisplayInfo: vi.fn(() => (
      mock.providers.map((provider) => ({
        id: provider.id,
        group: provider.group,
        models: provider.models,
        free: provider.free,
      }))
    )),
    getRuntimeProviderAvailability: vi.fn(() => (
      Object.fromEntries(mock.providers.map((provider) => {
        const available = provider.health !== "suppressed" && provider.isAvailable?.() === true;
        return [provider.id, available];
      }))
    )),
  };

  return mock;
});

const configMocks = vi.hoisted(() => ({
  globalConfig: null as {
    version?: "1";
    routing?: { defaultProvider?: string };
    managedAgents?: {
      enabled?: boolean;
      defaultProvider?: string;
      defaultProfile?: "foundation-readonly-plan";
      requireApproval?: boolean;
    };
    ui?: {
      theme?: string;
      providerSelection?: {
        provider: string;
        model?: string;
      };
    };
  } | null,
  defaultGlobalConfig: vi.fn(() => ({ version: "1" })),
  readGlobalConfig: vi.fn(() => configMocks.globalConfig),
  writeGlobalConfig: vi.fn(),
  resolveGlobalDefaultProvider: vi.fn((config: { routing?: { defaultProvider?: string } } | null) => {
    const provider = config?.routing?.defaultProvider?.trim() ?? "";
    return provider.length > 0 ? provider : undefined;
  }),
  resolveGlobalDefaultModel: vi.fn(() => undefined),
  resolveGlobalConfigPath: vi.fn(() => "C:/Users/ExampleUser/.kiln/config.yaml"),
  resolveGlobalUiTheme: vi.fn((config: { ui?: { theme?: string } } | null) => config?.ui?.theme),
  resolveEffectiveProvider: vi.fn((provider: string | undefined, globalProvider?: string) => {
    const normalize = (value?: string) => {
      const trimmed = value?.trim() ?? "";
      return trimmed.length > 0 ? trimmed : undefined;
    };
    return normalize(provider) ?? normalize(globalProvider);
  }),
}));

const managedProviderModelMocks = vi.hoisted(() => ({
  eligibleModels: null as unknown as (models: Record<string, string[]>) => Record<string, unknown>,
  discoverManagedAgentProviderModels: vi.fn(),
}));

const guiSessionMocks = vi.hoisted(() => ({
  summaries: [] as Array<{
    sessionId: string;
    title: string;
    tags: string[];
    providersUsed: string[];
    updatedAt: string;
    costUsd: number;
  }>,
  detail: null as {
    events: Array<{
      eventId: string;
      kilnSessionId: string;
      sequence: number;
      timestamp: string;
      kind: "turn_started";
      payload: Record<string, unknown>;
    }>;
  } | null,
  loadSessionDetail: vi.fn(async () => guiSessionMocks.detail),
}));

vi.mock("@kilnai/runtime", () => ({
  getProjectContextArtifactCache: vi.fn().mockResolvedValue({}),
  createAttachedRuntimeBuiltinToolSurface: vi.fn(() => ({
    toolDefinitions: [],
    callBuiltinTools: new Map(),
    capabilities: new Map(),
    toolAuthority: new Map(),
  })),
  createManagedAgentInvocationResourceProvider: vi.fn((input: unknown) => ({
    kind: "managed-invocation-resource-provider",
    input,
  })),
  withManagedAgentInvocationResourceProvider: (options: Record<string, unknown> | undefined, input: Record<string, unknown> | undefined) => {
    const artifactStore = (options?.artifactResources as { store?: unknown } | undefined)?.store ?? {};
    const sessionOptions = { ...(options ?? {}), artifactResources: { store: artifactStore } };
    if (!input) {
      return sessionOptions;
    }
    const providers = (sessionOptions.resourceProviders as readonly unknown[] | undefined) ?? [];
    if (providers.some((provider) => (
      typeof provider === "object"
      && provider !== null
      && (provider as { kind?: unknown }).kind === "managed-invocation-resource-provider"
    ))) {
      return sessionOptions;
    }
    return {
      ...sessionOptions,
      resourceProviders: [
        ...providers,
        {
          kind: "managed-invocation-resource-provider",
          input: {
            ...input,
            artifactStore,
          },
        },
      ],
    };
  },
  withManagedInvocationService: (options: Record<string, unknown>) => ({
    ...options,
    invocationService: options.invocationService ?? {},
  }),
  ManagedDirectProviderRuntimeAdapter: class MockManagedDirectProviderRuntimeAdapter {},
  ManagedRuntimeCredentialRouteLeaseManager: class MockManagedRuntimeCredentialRouteLeaseManager {},
  ManagedGitWorktreeLeaseManager: class MockManagedGitWorktreeLeaseManager {},
  RuntimeManagedAgentInvocationService: class MockRuntimeManagedAgentInvocationService {},
  ManagedCliHarnessAdapter: class MockManagedCliHarnessAdapter {
    descriptor = {
      adapterKind: "harness",
      providerId: "codex",
      supportedExecutionModes: ["cli-harness"],
    };
  },
  discoverCodexCliModelDiscovery: vi.fn().mockResolvedValue({
    models: ["gpt-5.3-codex-spark", "gpt-5.4-mini"],
    status: "available",
    reason: "Codex models discovered.",
    authState: "authenticated",
  }),
  discoverOpencodeCliModelDiscovery: vi.fn().mockResolvedValue({
    models: ["opencode/minimax-m2.5-free"],
    status: "available",
    reason: "OpenCode models discovered.",
    authState: "authenticated",
  }),
  startGuiGateway: gatewayHarness.startGuiGateway,
}));

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  return {
    ...actual,
    getFieldStore: vi.fn(() => ({
      snapshot: vi.fn().mockResolvedValue({
        regions: new Map(),
        dominantRegions: [],
        entropy: 0,
      }),
    })),
  };
});

vi.mock("../../src/config/global-config.js", () => ({
  defaultGlobalConfig: configMocks.defaultGlobalConfig,
  readGlobalConfig: configMocks.readGlobalConfig,
  resolveGlobalConfigPath: configMocks.resolveGlobalConfigPath,
  resolveGlobalDefaultProvider: configMocks.resolveGlobalDefaultProvider,
  resolveGlobalDefaultModel: configMocks.resolveGlobalDefaultModel,
  resolveGlobalUiTheme: configMocks.resolveGlobalUiTheme,
  writeGlobalConfig: configMocks.writeGlobalConfig,
}));

vi.mock("../../src/config/env-config.js", () => ({
  resolveEffectiveProvider: configMocks.resolveEffectiveProvider,
}));

vi.mock("../../src/config/managed-agent-provider-models.js", async () => {
  const core = await vi.importActual<typeof import("@kilnai/core")>("@kilnai/core");
  const runtime = await vi.importActual<typeof import("@kilnai/runtime")>("@kilnai/runtime");
  const observedAt = "2026-07-01T12:00:00.000Z";
  const requirements = {
    use: "managed-agent",
    evaluatedAt: observedAt,
    requiredStates: ["discovered", "configured", "authenticated", "capabilityCompatible", "policyAdmitted", "routeHealthy"],
    requiredCapabilities: [],
    minimumCapabilityAuthority: "harness-reported",
    minimumStateAuthority: "harness-reported",
    requireProbe: false,
  } as const;
  managedProviderModelMocks.eligibleModels = (models) =>
    Object.fromEntries(Object.entries(models).map(([providerId, providerModels]) => {
      const catalog = runtime.normalizeRuntimeProviderDiscoveryCatalog({
        providerId,
        family: providerId === "codex" ? "codex-harness" : "opencode-harness",
        discovery: { models: providerModels, status: "available", reason: "fixture catalog", authState: "authenticated" },
        observedAt,
        freshness: "fresh",
        harnessId: providerId,
        reportedProviderId: providerId,
      });
      return [providerId, Object.fromEntries(catalog.routes.map((route) => [
        route.identity.route.providerModelId,
        {
          catalogDiagnosticEvidence: route,
          catalogDiagnosticDecision: core.deriveProviderModelEligibility(route, requirements, []),
        },
      ]))];
    }));
  managedProviderModelMocks.discoverManagedAgentProviderModels.mockImplementation(async () =>
    managedProviderModelMocks.eligibleModels({
      codex: ["gpt-5.3-codex-spark"],
      opencode: ["opencode/minimax-m2.5-free"],
    }));
  return {
    PENDING_MANAGED_AGENT_PROVIDER_MODEL_CATALOG_DIAGNOSTICS: {},
    discoverManagedAgentProviderModels: managedProviderModelMocks.discoverManagedAgentProviderModels,
  };
});

vi.mock("../../src/application/continuation-sidebar-info.js", () => ({
  loadContinuationSidebarInfo: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/wrapper/session-registry.js", () => ({
  createDefaultRegistry: registryMocks.createDefaultRegistry,
  getProviderDisplayInfo: registryMocks.getProviderDisplayInfo,
  getRuntimeProviderAvailability: registryMocks.getRuntimeProviderAvailability,
}));

vi.mock("../../src/commands/tui.js", () => ({
  makeMultiProviderSessionFactory: vi.fn().mockResolvedValue(sessionManagerMocks),
}));

vi.mock("../../src/commands/gui-options.js", () => ({
  buildGuiAttachUrl: vi.fn((url: string) => `${url.replace(/\/$/, "")}/gui/`),
  buildGuiUrl: vi.fn((url: string) => url),
  persistGuiThemePreference: vi.fn(),
  resolveGuiThemePreference: vi.fn(() => "kiln-dark"),
}));

vi.mock("../../src/commands/gui-shutdown-monitor.js", () => ({
  createManagedGuiWindowShutdownMonitor: vi.fn(() => ({
    onConnectionCountChange: vi.fn(),
    onManagedWindowClose: vi.fn(),
    waitForDisconnect: () => Promise.resolve(),
    dispose: vi.fn(),
  })),
}));

vi.mock("../../src/commands/gui-window.js", () => ({
  launchGuiWindow: vi.fn(() => ({
    browserLabel: "Mock Browser",
    close: gatewayHarness.closeWindow,
    whenClosed: new Promise<void>(() => {}),
  })),
}));

vi.mock("../../src/application/operator-session-history.js", () => ({
  loadOperatorSessionSummaries: vi.fn(async () => guiSessionMocks.summaries),
}));

vi.mock("../../src/commands/gui-session-detail.js", () => ({
  loadSessionDetail: guiSessionMocks.loadSessionDetail,
}));

vi.mock("../../src/commands/gui-workspace.js", () => ({
  createLocalWorkspaceExplorer: vi.fn((rootPath: string) => ({
    listDirectory: vi.fn(async () => ({
      rootPath,
      directoryPath: rootPath,
      entries: [],
      source: "gateway",
    })),
    readFile: vi.fn(),
  })),
}));

vi.mock("../../src/wrapper/session-manager.js", () => ({
  SessionManager: class {
    async prepare() {
      return {
        systemPrompt: "You are a helpful assistant.",
        domain: { displayName: "kiln" },
      };
    }
  },
}));

import { guiCommand } from "../../src/commands/gui.js";
import { getProjectContextArtifactCache } from "@kilnai/runtime";

const APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry should not be used in GUI dashboard availability tests");
  },
};

describe("GUI dashboard provider availability", () => {
  let tmpDir: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    gatewayHarness.snapshot = null;
    gatewayHarness.operatorModels = {};
    gatewayHarness.lastOptions = null;
    configMocks.globalConfig = null;
    guiSessionMocks.summaries = [];
    guiSessionMocks.detail = null;
    guiSessionMocks.loadSessionDetail.mockClear();
    managedProviderModelMocks.discoverManagedAgentProviderModels.mockResolvedValue(managedProviderModelMocks.eligibleModels({
      codex: ["gpt-5.3-codex-spark"],
      opencode: ["opencode/minimax-m2.5-free"],
    }));
    registryMocks.providers = [{
      id: "openai",
      group: "direct-api",
      models: ["gpt-5.4"],
      free: false,
      health: "healthy",
      isAvailable: () => false,
    }];
  });

  it("passes configured web tool options into GUI gateway startup", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand({
      ...APP_CONFIG,
      kilnYaml: {
        version: "1",
        web: {
          enabled: true,
          netPolicy: "documentation",
          allowedDomains: ["docs.example.com"],
        },
      },
    }, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.lastOptions?.builtinToolOptions).toMatchObject({
      toolProjection: {
        mode: "deferred",
        alwaysOnTools: expect.arrayContaining([
          "read",
          "write",
          "work_item.update",
          "goal.evidence.record",
          "goal.complete",
        ]),
      },
      webFetch: expect.any(Object),
      webSearch: expect.any(Object),
      webExtract: expect.any(Object),
      memoryResources: {
        authority: {
          caller: { kind: "operator_surface", id: "gui" },
        },
      },
      memoryMutations: {
        callerContext: {
          actorType: "operator_surface",
          actorId: "gui",
        },
      },
    });
    expect(gatewayHarness.lastOptions?.guiAssetMode).toBe("bundled");
  });

  it("resolves nested cwd to the canonical project root before opening GUI state", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));
    const packageCliPath = join(tmpDir, "packages", "cli");
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
    mkdirSync(join(tmpDir, ".kiln"), { recursive: true });
    mkdirSync(join(packageCliPath, ".kiln"), { recursive: true });
    writeFileSync(join(tmpDir, ".kiln", "kiln.yaml"), "version: \"1\"\n", "utf-8");
    writeFileSync(
      join(packageCliPath, ".kiln", "continuation-targets.json"),
      JSON.stringify({ defaultSessionId: "stale-nested-session" }),
      "utf-8",
    );

    await guiCommand(APP_CONFIG, {
      cwd: packageCliPath,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.lastOptions?.workingDirectory).toBe(tmpDir);
    expect(gatewayHarness.snapshot).toMatchObject({
      workingDirectory: tmpDir,
    });
    expect(getProjectContextArtifactCache).toHaveBeenCalledWith(tmpDir);
    expect(existsSync(join(packageCliPath, ".kiln", "continuation-targets.json"))).toBe(true);
  });

  it("publishes setup diagnostics through operator workspace config health", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.snapshot?.operatorWorkspaceHome?.configHealth).toMatchObject({
      status: "degraded",
      issueCount: 3,
      items: expect.arrayContaining([
        expect.objectContaining({
          id: "project-context",
          status: "degraded",
          recommendation: "adopt-project-context",
        }),
        expect.objectContaining({
          id: "repo-shim:agents",
          status: "degraded",
          recommendation: "sync-repo-shims",
        }),
        expect.objectContaining({
          id: "repo-shim:claude",
          status: "degraded",
          recommendation: "sync-repo-shims",
        }),
      ]),
    });
  });

  it("does not pass a default tool-round budget into the interactive GUI operator transport", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.startGuiGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorTransport: expect.not.objectContaining({ maxToolRounds: expect.anything() }),
      }),
    );
  });

  it("scopes local GUI transcript events to the local cockpit target before projection", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));
    guiSessionMocks.summaries = [{
      sessionId: "kiln-gui:_gui:user:session",
      title: "GUI live test",
      tags: [],
      providersUsed: ["codex-oauth"],
      updatedAt: "2026-06-27T11:23:00.000Z",
      costUsd: 0,
    }];
    guiSessionMocks.detail = {
      events: [{
        eventId: "event-without-instance",
        kilnSessionId: "kiln-gui:_gui:user:session",
        sequence: 1,
        timestamp: "2026-06-27T11:23:00.000Z",
        kind: "turn_started",
        payload: {
          instanceId: "stale-remote-instance",
          sessionId: "kiln-gui:_gui:user:session",
          title: "GUI live test",
        },
      }],
    };

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.snapshot?.operatorWorkspaceHome).toBeTruthy();
    expect(gatewayHarness.snapshot?.operatorWorkspaceHome?.sessions).toContainEqual(
      expect.objectContaining({
        sessionId: "kiln-gui:_gui:user:session",
        instanceId: "local-gui",
      }),
    );
    expect(guiSessionMocks.loadSessionDetail).toHaveBeenCalledWith(expect.anything(), "kiln-gui:_gui:user:session");
  });

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("marks a direct API provider unavailable without leaking static models when the registry descriptor is unavailable despite healthy health", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.startGuiGateway).toHaveBeenCalledTimes(1);
    expect(registryMocks.createDefaultRegistry).toHaveBeenCalledTimes(1);
    expect(gatewayHarness.snapshot?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "openai",
        available: false,
        models: [],
      }),
    ]));
  });

  it("uses the gateway supplied runtime model catalog when building the dashboard snapshot", async () => {
    registryMocks.providers = [{
      id: "openai",
      group: "direct-api",
      models: ["gpt-5.4"],
      free: false,
      health: "healthy",
      isAvailable: () => true,
    }];
    gatewayHarness.operatorModels = { openai: ["gpt-5.4"] };
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.snapshot?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "openai",
        available: true,
        models: ["gpt-5.4"],
      }),
    ]));
  });

  it("keeps model-less Claude available when the runtime model catalog advertises it", async () => {
    registryMocks.providers = [{
      id: "claude",
      group: "harness",
      models: [],
      free: false,
      health: "healthy",
      isAvailable: () => true,
    }];
    gatewayHarness.operatorModels = { claude: [] };
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.snapshot?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "claude",
        available: true,
        models: [],
      }),
    ]));
  });

  it("starts GUI without a configured provider so runtime discovery can populate the picker", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
    });

    expect(gatewayHarness.startGuiGateway).toHaveBeenCalledTimes(1);
  });

  it("starts the GUI gateway before managed-agent provider model discovery resolves", async () => {
    registryMocks.providers = [{
      id: "codex",
      group: "harness",
      models: [],
      free: false,
      health: "healthy",
      isAvailable: () => true,
    }];
    configMocks.globalConfig = {
      version: "1",
      managedAgents: {
        enabled: true,
        defaultProvider: "codex",
        defaultProfile: "foundation-readonly-plan",
        requireApproval: true,
      },
    };
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));
    let resolveDiscovery: ((models: ReturnType<typeof managedProviderModelMocks.eligibleModels>) => void) | undefined;
    managedProviderModelMocks.discoverManagedAgentProviderModels.mockImplementationOnce(() =>
      new Promise((resolve) => {
        resolveDiscovery = resolve;
      }));

    const command = guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: "codex",
    });

    try {
      for (let attempt = 0; attempt < 20 && gatewayHarness.startGuiGateway.mock.calls.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(gatewayHarness.startGuiGateway).toHaveBeenCalledTimes(1);
    } finally {
      resolveDiscovery?.(managedProviderModelMocks.eligibleModels({ codex: ["gpt-5.3-codex-spark"], opencode: [] }));
      await command;
    }
  });

  it("seeds the GUI session manager from the durable provider preference", async () => {
    configMocks.globalConfig = {
      version: "1",
      ui: {
        providerSelection: {
          provider: "codex-oauth",
          model: "gpt-5.4",
        },
      },
    };
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
    });

    expect(sessionManagerMocks.setProvider).toHaveBeenCalledWith("codex-oauth");
    expect(sessionManagerMocks.setModel).toHaveBeenCalledWith("gpt-5.4");
  });

  it("does not start the local GUI gateway in attach mode", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      connect: "http://localhost:3800",
      open: false,
    });

    expect(gatewayHarness.startGuiGateway).not.toHaveBeenCalled();
    expect(registryMocks.createDefaultRegistry).not.toHaveBeenCalled();
  });

  it("rejects an unknown configured provider instead of defaulting to the first advertised provider", async () => {
    configMocks.globalConfig = { routing: { defaultProvider: "claude" } };
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await expect(guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
    })).rejects.toThrow("Unknown GUI provider 'claude'. Configure one of: openai");

    expect(gatewayHarness.startGuiGateway).not.toHaveBeenCalled();
  });

  it("marks a healthy harness provider unavailable when static display metadata reports an empty model list despite registry availability", async () => {
    registryMocks.providers = [{
      id: "opencode",
      group: "harness",
      models: [],
      free: true,
      health: "healthy",
      isAvailable: () => true,
    }];
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.startGuiGateway).toHaveBeenCalledTimes(1);
    expect(registryMocks.createDefaultRegistry).toHaveBeenCalledTimes(1);
    expect(gatewayHarness.snapshot?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "opencode",
        available: false,
        models: [],
      }),
    ]));
  });

  it("does not advertise ollama as available from static catalog metadata without a validated availability predicate or live model discovery", async () => {
    registryMocks.providers = [{
      id: "ollama",
      group: "local",
      models: ["llama3"],
      free: true,
      health: "healthy",
      isAvailable: undefined,
    }];
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.startGuiGateway).toHaveBeenCalledTimes(1);
    expect(registryMocks.createDefaultRegistry).toHaveBeenCalledTimes(1);
    expect(gatewayHarness.snapshot?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "ollama",
        available: false,
        models: [],
      }),
    ]));
  });

  it("does not advertise unavailable harness or direct-api providers from static provider display metadata", async () => {
    registryMocks.providers = [
      {
        id: "codex",
        group: "harness",
        models: ["gpt-5.3-codex"],
        free: false,
        health: "healthy",
        isAvailable: () => false,
      },
      {
        id: "opencode",
        group: "harness",
        models: ["minimax-m2.5"],
        free: true,
        health: "healthy",
        isAvailable: () => false,
      },
      {
        id: "codex-oauth",
        group: "direct-api",
        models: ["gpt-5.4"],
        free: true,
        health: "healthy",
        isAvailable: () => false,
      },
      {
        id: "opencode-go",
        group: "subscription",
        models: ["minimax-m2.5"],
        free: true,
        health: "healthy",
        isAvailable: () => false,
      },
      {
        id: "openai",
        group: "direct-api",
        models: ["gpt-5.4"],
        free: false,
        health: "healthy",
        isAvailable: () => false,
      },
    ];
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.snapshot?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "codex",
        available: false,
      }),
      expect.objectContaining({
        id: "opencode",
        available: false,
      }),
      expect.objectContaining({
        id: "codex-oauth",
        available: false,
        models: [],
      }),
      expect.objectContaining({
        id: "opencode-go",
        available: false,
        models: [],
      }),
      expect.objectContaining({
        id: "openai",
        available: false,
        models: [],
      }),
    ]));
  });

  it("does not mark metadata-only direct providers available unless authoritative runtime model data includes them", async () => {
    registryMocks.providers = [
      {
        id: "openai",
        group: "direct-api",
        models: ["gpt-5.4"],
        free: false,
        health: "healthy",
        isAvailable: () => false,
      },
      {
        id: "anthropic",
        group: "direct-api",
        models: ["claude-sonnet-4-6"],
        free: false,
        health: "healthy",
        isAvailable: () => false,
      },
      {
        id: "opencode-go",
        group: "subscription",
        models: ["minimax-m2.5"],
        free: true,
        health: "healthy",
        isAvailable: () => false,
      },
      {
        id: "opencode-zen",
        group: "subscription",
        models: ["anthropic/claude-sonnet-4-6"],
        free: true,
        health: "healthy",
        isAvailable: () => false,
      },
    ];
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-dashboard-availability-"));

    await guiCommand(APP_CONFIG, {
      cwd: tmpDir,
      mode: "prod",
      open: true,
      provider: registryMocks.providers[0].id,
    });

    expect(gatewayHarness.snapshot?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "openai",
        available: false,
        models: [],
      }),
      expect.objectContaining({
        id: "anthropic",
        available: false,
        models: [],
      }),
      expect.objectContaining({
        id: "opencode-go",
        available: false,
        models: [],
      }),
      expect.objectContaining({
        id: "opencode-zen",
        available: false,
        models: [],
      }),
    ]));
  });
});
