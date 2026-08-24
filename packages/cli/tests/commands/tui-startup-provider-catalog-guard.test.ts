import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../../src/config.js";
import type { ProviderDisplayInfo } from "../../src/wrapper/session-registry.js";
import type { TuiGateway, TuiGatewayOptions } from "@kilnai/runtime";
import { makeOperatorSurfaceGlobalConfig } from "./operator-surface-v4-fixture.js";

type TuiGatewayMockResult = Omit<TuiGateway, "providerDiscovery" | "providerModelDiscovery">
  & Partial<Pick<TuiGateway, "providerDiscovery" | "providerModelDiscovery">>;

const tuiMocks = vi.hoisted(() => ({
  startTui: vi.fn().mockResolvedValue(undefined),
  waitForGateway: vi.fn().mockResolvedValue(undefined),
}));

const actionClaimMocks = vi.hoisted(() => {
  const instances: Array<{ readonly close: () => void }> = [];
  class MockActionClaimStore {
    readonly close: () => void = vi.fn();

    constructor() {
      instances.push(this);
    }
  }
  return {
    modelRound: MockActionClaimStore,
    tool: MockActionClaimStore,
    instances,
  };
});

const operatorCompositionMocks = vi.hoisted(() => ({
  create: vi.fn(() => ({
    accountRuntime: {
      operatorSessionCandidates: {
        resolve: vi.fn(async ({ admission }: { admission: { accountSelection: { mode: "automatic" | "exact"; eligibleAccountIds?: readonly string[]; accountId?: string } } }) => {
          const accountIds = admission.accountSelection.mode === "automatic"
            ? admission.accountSelection.eligibleAccountIds ?? []
            : admission.accountSelection.accountId ? [admission.accountSelection.accountId] : [];
          return accountIds.map((accountId) => ({
            candidate: {
              accountId,
              safety: "eligible" as const,
              health: "healthy" as const,
              quota: "available" as const,
              capacity: "available" as const,
              economicCost: { atoms: "0", scale: 0, unit: "request", scheme: { kind: "unit" as const } },
              pressure: 0,
            },
            lease: {
              candidate: { route: { providerId: "codex-oauth", providerModelId: "gpt-5.6-codex", scope: "operator-session" } },
              credentialRevisionId: "a".repeat(64),
            },
          }));
        }),
      },
    },
    bridge: { bind: vi.fn(), dispatchCommittedTurn: vi.fn() },
    authorityAdmissionBridge: { bind: vi.fn() },
    dispatcher: { dispatchTurn: vi.fn() },
    close: vi.fn(),
  })),
  resolveContinuation: vi.fn(async () => undefined),
}));

const runtimeMocks = vi.hoisted(() => ({
  contextArtifactCache: {},
  getProjectContextArtifactCache: vi.fn(async () => runtimeMocks.contextArtifactCache),
  resolveGuiOperatorDiscoveryResults: vi.fn(async (providerAvailability: Record<string, boolean>) => {
    const models: Record<string, string[]> = {};
    if (providerAvailability.openai === true) {
      models.openai = ["gpt-5.4"];
    }
    if (providerAvailability.claude === true) {
      models.claude = [];
    }
    return Object.entries(models).map(([provider, providerModels]) => ({
      provider,
      available: true,
      models: providerModels,
      status: provider === "claude" ? "model_selection_not_required" : "available",
      reason: provider === "claude"
        ? "Claude CLI is available. Model selection is not required."
        : `${provider} models discovered.`,
      authState: provider === "claude" ? "not_required" : "authenticated",
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    }));
  }),
  projectGuiOperatorModels: vi.fn((discovery: Array<{ provider: string; available: boolean; models: string[] }>) => (
    Object.fromEntries(discovery.flatMap((entry) => (
      entry.available ? [[entry.provider, entry.models]] : []
    )))
  )),
  projectGuiProviderModelDiscovery: vi.fn((discovery: Array<{ provider: string; models: string[] }>) => ({
    catalogEvidence: {
      status: "complete",
      source: { kind: "test", id: "tui-startup-provider-catalog-guard" },
      observedAt: "2026-07-01T00:00:00.000Z",
      counts: { total: discovery.length, returned: discovery.length, omitted: 0 },
    },
    entries: discovery.flatMap((provider) => provider.models.map((model) => ({
      providerRoute: { providerId: provider.provider, providerModelId: model, scope: "provider" },
      normalizedModel: { providerId: provider.provider, modelId: model },
      freshness: { status: "fresh", observedAt: "2026-07-01T00:00:00.000Z" },
      eligibility: { eligible: true, reasonCodes: [] },
    }))),
  })),
  createProviderCatalogService: vi.fn((resolveDiscovery: () => Promise<readonly unknown[]>, emptyDiscovery: readonly unknown[]) => {
    let discovery = emptyDiscovery;
    const listeners = new Set<(snapshot: { status: string; discovery: readonly unknown[] }) => void>();
    const snapshot = () => ({ status: discovery.length > 0 ? "ready" : "pending", discovery });
    const refresh = vi.fn(async () => {
      discovery = await resolveDiscovery();
      const nextSnapshot = snapshot();
      for (const listener of listeners) {
        listener(nextSnapshot);
      }
      return nextSnapshot;
    });
    return {
      snapshot,
      refresh,
      ensureReady: refresh,
      startBackgroundRefresh: vi.fn(() => {
        void refresh();
      }),
      subscribe: vi.fn((listener: (snapshot: { status: string; discovery: readonly unknown[] }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    };
  }),
  startTuiGateway: vi.fn<(options: TuiGatewayOptions) => Promise<TuiGatewayMockResult>>(async (_options) => ({
    port: 4801,
    url: "ws://localhost:4801/ws",
    models: {
      openai: ["gpt-5.4"],
    },
    providerDiscovery: gatewayDiscovery("openai", ["gpt-5.4"]),
    providerModelDiscovery: gatewayProjection("openai", "gpt-5.4", true),
    shutdown: vi.fn(),
  })),
}));

function gatewayDiscovery(provider: string, models: readonly string[]): TuiGateway["providerDiscovery"] {
  return [{
    provider,
    available: true,
    models: [...models],
    status: models.length > 0 ? "available" : "model_selection_not_required",
    reason: `${provider} models discovered.`,
    authState: models.length > 0 ? "authenticated" : "not_required",
    lastCheckedAt: "2026-04-28T12:00:00.000Z",
  }];
}

function gatewayProjection(provider: string, model: string, eligible: boolean): TuiGateway["providerModelDiscovery"] {
  return {
    catalogEvidence: {
      status: "complete",
      source: { kind: "test", id: "gateway-bootstrap" },
      observedAt: "2026-07-01T00:00:00.000Z",
      counts: { total: 1, returned: 1, omitted: 0 },
    },
    entries: [{
      providerRoute: { providerId: provider, providerModelId: model, scope: "provider" },
      normalizedModel: { family: model },
      rawEvidence: { rawId: model, provenance: "test" },
      credentialEvidence: { state: "authenticated", source: "test" },
      entitlementEvidence: { state: "confirmed", source: "test" },
      freshness: { status: "fresh", observedAt: "2026-07-01T00:00:00.000Z" },
      routeHealth: { status: "healthy" },
      policyAdmission: { use: "interactive", status: eligible ? "admitted" : "unknown" },
      eligibility: { eligible, reasonCodes: eligible ? [] : ["missing-entitlement-evidence"] },
    }],
  };
}

const configMocks = vi.hoisted(() => ({
  globalConfig: null as {
    targetRouting?: { defaultTargetId?: string };
    targetCatalog?: { targets?: readonly { id: string; providerId: string; providerModelId?: string }[] };
    engines?: Record<string, { enabled?: boolean }>;
    managedAgents?: {
      enabled?: boolean;
      defaultProvider?: string;
      defaultProfile?: "foundation-readonly-plan";
      requireApproval?: boolean;
    };
    ui?: { theme?: string };
  } | null,
  readGlobalConfig: vi.fn(() => configMocks.globalConfig),
}));

const registryMocks = vi.hoisted(() => {
  const mock = {
    providerDisplayInfo: [] as ProviderDisplayInfo[],
    createDefaultRegistry: vi.fn(() => ({
      registry: {
        list: () =>
          mock.providerDisplayInfo.map((provider) => ({
            id: provider.id,
            capabilities: {
              mcp: false,
              streaming: true,
              resumable: false,
              resume: false,
              costTrackingMode: "computed" as const,
              supportedTools: [],
              maxContextTokens: null,
              priority: 0,
              fallbackTo: null,
              permissionPolicy: { approval: "never" as const, sandbox: "workspace-write" as const },
            },
            health: "healthy" as const,
          })),
        createSession: vi.fn(),
      },
    })),
    getProviderDisplayInfo: vi.fn(() => mock.providerDisplayInfo),
    getRuntimeProviderAvailability: vi.fn(() => (
      Object.fromEntries(mock.providerDisplayInfo.map((provider) => [provider.id, true]))
    )),
    isDirectApiProvider: vi.fn((provider: string | undefined) => (
      provider === "codex-oauth"
      || provider === "opencode-go"
      || provider === "opencode-zen"
      || provider === "anthropic"
      || provider === "openai"
      || provider === "deepseek"
      || provider === "openrouter"
      || provider === "ollama"
    )),
  };

  return mock;
});

const managedProviderModelMocks = vi.hoisted(() => ({
  eligibleModels: null as unknown as (models: Record<string, string[]>) => Record<string, unknown>,
  discoverManagedAgentProviderModels: vi.fn(),
}));

const resumeMocks = vi.hoisted(() => ({
  loadContinuationSidebarInfo: vi.fn().mockResolvedValue({}),
}));

const sessionManagerMocks = vi.hoisted(() => ({
  prepare: vi.fn().mockResolvedValue({
    systemPrompt: "You are a helpful assistant.",
    domain: { displayName: "kiln" },
  }),
}));

const sessionStoreMocks = vi.hoisted(() => ({
  last: vi.fn().mockResolvedValue(null),
  getContinuationTarget: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  clearContinuationTarget: vi.fn().mockResolvedValue(undefined),
  find: vi.fn().mockResolvedValue(null),
  findProviderThread: vi.fn().mockResolvedValue(null),
}));

const transcriptStoreMocks = vi.hoisted(() => ({
  readMeta: vi.fn().mockResolvedValue(null),
  readTranscript: vi.fn().mockResolvedValue([]),
  append: vi.fn().mockResolvedValue(undefined),
  appendNext: vi.fn().mockResolvedValue(null),
  appendManyNext: vi.fn().mockResolvedValue([]),
  init: vi.fn().mockResolvedValue(undefined),
  finalize: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock("@kilnai/tui", () => ({
  startTui: tuiMocks.startTui,
  waitForGateway: tuiMocks.waitForGateway,
  themes: { "phosphor": {} },
  kilnDark: {},
  GatewaySession: class {},
}));

vi.mock("@kilnai/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/runtime")>();
  return {
  ...actual,
  getProjectContextArtifactCache: runtimeMocks.getProjectContextArtifactCache,
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
    const sessionOptions: Record<string, unknown> = { ...(options ?? {}), artifactResources: { store: artifactStore } };
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
  attachManagedInvocationSessionEventSink: (
    options: Record<string, unknown> | undefined,
    sessionEventSink: unknown,
  ) => options ? { ...options, sessionEventSink } : undefined,
  ManagedDirectProviderRuntimeAdapter: class MockManagedDirectProviderRuntimeAdapter {},
  ManagedRuntimeCredentialRouteLeaseManager: class MockManagedRuntimeCredentialRouteLeaseManager {},
  ManagedGitWorktreeLeaseManager: class MockManagedGitWorktreeLeaseManager {},
  RuntimeManagedAgentInvocationService: class MockRuntimeManagedAgentInvocationService {
    close = vi.fn();

    async recoverPersistedInvocations() {
      return { recovered: [], accountLeases: [] };
    }
  },
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
  resolveGuiOperatorDiscoveryResults: runtimeMocks.resolveGuiOperatorDiscoveryResults,
  markGuiProviderDiscoveryStale: (discovery: readonly unknown[]) => discovery,
  projectGuiOperatorModels: runtimeMocks.projectGuiOperatorModels,
  projectGuiProviderModelDiscovery: runtimeMocks.projectGuiProviderModelDiscovery,
  createProviderCatalogService: runtimeMocks.createProviderCatalogService,
  providerRequiresSelectedModelMessage: (provider: string) => `Provider '${provider}' requires a selected model.`,
  startTuiGateway: runtimeMocks.startTuiGateway,
  };
});

vi.mock("../../src/application/operator-turn-dispatch-composition.js", () => ({
  createOperatorTurnDispatchComposition: operatorCompositionMocks.create,
  resolveOperatorContinuationBinding: operatorCompositionMocks.resolveContinuation,
}));

vi.mock("../../src/config/global-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/global-config.js")>();
  const fixtures = await import("../config/execution-target-evidence-fixture.js");
  return {
    ...actual,
    readGlobalConfig: configMocks.readGlobalConfig,
    readGlobalConfigSnapshot: vi.fn(() => ({ config: configMocks.globalConfig, revision: `sha256:${"a".repeat(64)}` })),
    readGlobalExecutionCatalog: (config: Parameters<typeof fixtures.syntheticExecutionCatalog>[0] | undefined) =>
      config ? fixtures.syntheticExecutionCatalog(config) ?? undefined : undefined,
    readGlobalExecutionTargetAuthority: (config: Parameters<typeof fixtures.syntheticExecutionTargetAuthority>[0] | undefined) =>
      config ? fixtures.syntheticExecutionTargetAuthority(config) : undefined,
    resolveGlobalConfigPath: () => "C:\\Users\\operator\\.kiln\\config.yaml",
    resolveGlobalDefaultProvider: (config: typeof configMocks.globalConfig) => {
      if (!config) return undefined;
      return config.targetCatalog?.targets?.find((target) => target.id === config.targetRouting?.defaultTargetId)?.providerId
        ?? Object.entries(config.engines ?? {}).find(([, engine]) => engine.enabled)?.[0];
    },
    resolveGlobalDefaultModel: () => undefined,
    resolveGlobalUiTheme: (config: typeof configMocks.globalConfig) => config?.ui?.theme,
  };
});

// Startup-provider guard tests exercise catalog admission, not SQLite owner
// lifecycles. Keep each invocation's private runtime resources synthetic so a
// rejected bootstrap cannot leave a live action-claim owner for the next test.
vi.mock("../../src/application/runtime-model-round-action-claim-store.js", () => ({
  SqliteRuntimeModelRoundActionClaimStore: actionClaimMocks.modelRound,
}));
vi.mock("../../src/application/runtime-tool-action-claim-store.js", () => ({
  SqliteRuntimeToolActionClaimStore: actionClaimMocks.tool,
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
  loadContinuationSidebarInfo: resumeMocks.loadContinuationSidebarInfo,
}));

vi.mock("../../src/wrapper/session-manager.js", () => ({
  SessionManager: class MockSessionManager {
    prepare = sessionManagerMocks.prepare;
  },
}));

vi.mock("../../src/wrapper/session-registry.js", () => ({
  createDefaultRegistry: registryMocks.createDefaultRegistry,
  getProviderDisplayInfo: registryMocks.getProviderDisplayInfo,
  getRuntimeProviderAvailability: registryMocks.getRuntimeProviderAvailability,
  isDirectApiProvider: registryMocks.isDirectApiProvider,
}));

vi.mock("../../src/wrapper/session-store.js", () => ({
  SessionStore: class MockSessionStore {
    last = sessionStoreMocks.last;
    getContinuationTarget = sessionStoreMocks.getContinuationTarget;
    list = sessionStoreMocks.list;
    clearContinuationTarget = sessionStoreMocks.clearContinuationTarget;
    find = sessionStoreMocks.find;
    findProviderThread = sessionStoreMocks.findProviderThread;
  },
  TranscriptStore: class MockTranscriptStore {
    readMeta = transcriptStoreMocks.readMeta;
    readTranscript = transcriptStoreMocks.readTranscript;
    append = transcriptStoreMocks.append;
    appendNext = transcriptStoreMocks.appendNext;
    appendManyNext = transcriptStoreMocks.appendManyNext;
    init = transcriptStoreMocks.init;
    finalize = transcriptStoreMocks.finalize;
    listSessions = transcriptStoreMocks.listSessions;
  },
}));

import { tuiCommand } from "../../src/commands/tui.js";

const APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry should not be used in TUI startup provider guard tests");
  },
};

describe("tuiCommand startup provider catalog guard", () => {
  const originalTransport = process.env.KILN_TUI_TRANSPORT;
  const originalStartupProfile = process.env.KILN_STARTUP_PROFILE;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  let cwd: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    configMocks.globalConfig = makeOperatorSurfaceGlobalConfig("codex", "gpt-5.3-codex");
    cwd = mkdtempSync(join(tmpdir(), "kiln-tui-startup-guard-"));
    process.env.XDG_CONFIG_HOME = join(cwd, "xdg-config");
    registryMocks.providerDisplayInfo = [
      { id: "codex", group: "harness", models: [], free: false },
      { id: "opencode", group: "subscription", models: [], free: true },
    ];
    runtimeMocks.startTuiGateway.mockResolvedValue({
      port: 4801,
      url: "ws://localhost:4801/ws",
      models: {
        openai: ["gpt-5.4"],
      },
      providerDiscovery: gatewayDiscovery("openai", ["gpt-5.4"]),
      providerModelDiscovery: gatewayProjection("openai", "gpt-5.4", true),
      shutdown: vi.fn(),
    });
    managedProviderModelMocks.discoverManagedAgentProviderModels.mockResolvedValue(managedProviderModelMocks.eligibleModels({
      codex: ["gpt-5.3-codex-spark"],
      opencode: ["opencode/minimax-m2.5-free"],
    }));
  });

  afterEach(() => {
    if (originalTransport === undefined) delete process.env.KILN_TUI_TRANSPORT;
    else process.env.KILN_TUI_TRANSPORT = originalTransport;
    if (originalStartupProfile === undefined) delete process.env.KILN_STARTUP_PROFILE;
    else process.env.KILN_STARTUP_PROFILE = originalStartupProfile;
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    for (const instance of actionClaimMocks.instances) instance.close();
    actionClaimMocks.instances.length = 0;
    if (cwd) {
      rmSync(cwd, { recursive: true, force: true });
      cwd = undefined;
    }
  });

  it("rejects gateway startup providers absent from the local registry", async () => {
    delete process.env.KILN_TUI_TRANSPORT;
    configMocks.globalConfig = makeOperatorSurfaceGlobalConfig("openai", "gpt-5.4");

    await expect(
      tuiCommand(APP_CONFIG, { cwd }),
    ).rejects.toThrow("configured TUI execution target uses unsupported provider 'openai'");

    expect(runtimeMocks.startTuiGateway).not.toHaveBeenCalled();
    expect(tuiMocks.waitForGateway).not.toHaveBeenCalled();
    expect(tuiMocks.startTui).not.toHaveBeenCalled();
  });

  it("accepts direct startup when the runtime model builder advertises the registry-available provider", async () => {
    process.env.KILN_TUI_TRANSPORT = "direct";
    registryMocks.providerDisplayInfo = [
      { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
      { id: "codex", group: "harness", models: [], free: false },
      { id: "opencode", group: "subscription", models: [], free: true },
    ];
    configMocks.globalConfig = makeOperatorSurfaceGlobalConfig("openai", "gpt-5.4");

    await expect(
      tuiCommand(APP_CONFIG, { cwd }),
    ).resolves.toBeUndefined();

    expect(runtimeMocks.startTuiGateway).not.toHaveBeenCalled();
    expect(runtimeMocks.resolveGuiOperatorDiscoveryResults).toHaveBeenCalledWith(
      expect.objectContaining({ openai: true }),
      undefined,
      join(cwd!, "xdg-config", "kiln"),
    );
    expect(runtimeMocks.projectGuiProviderModelDiscovery).toHaveBeenCalled();
    expect(tuiMocks.waitForGateway).not.toHaveBeenCalled();
    expect(tuiMocks.startTui).toHaveBeenCalledTimes(1);
  });

  it("rejects direct execution when catalog observation has no eligible projection entry", async () => {
    process.env.KILN_TUI_TRANSPORT = "direct";
    registryMocks.providerDisplayInfo = [
      { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
    ];
    configMocks.globalConfig = makeOperatorSurfaceGlobalConfig("openai", "gpt-5.4");
    runtimeMocks.projectGuiProviderModelDiscovery.mockImplementation(() => ({
      catalogEvidence: {
        status: "complete",
        source: { kind: "test", id: "catalog-observation-only" },
        observedAt: "2026-07-01T12:00:00.000Z",
        counts: { total: 1, returned: 1, omitted: 0 },
      },
      entries: [{
        providerRoute: { providerId: "openai", providerModelId: "gpt-5.4", scope: "provider" },
        normalizedModel: { providerId: "openai", modelId: "gpt-5.4" },
        freshness: { status: "fresh", observedAt: "2026-07-01T12:00:00.000Z" },
        eligibility: { eligible: false, reasonCodes: ["policy-not-admitted"] },
      }],
    }) as never);
    try {
      await expect(tuiCommand(APP_CONFIG, { cwd })).rejects.toThrow(
        "Provider 'openai' is not available in the runtime TUI model catalog. Available providers: none",
      );
      expect(tuiMocks.startTui).not.toHaveBeenCalled();
    } finally {
      runtimeMocks.projectGuiProviderModelDiscovery.mockRestore();
    }
  });

  it("uses the canonical execution-route catalog to reject unavailable direct selections", async () => {
    process.env.KILN_TUI_TRANSPORT = "direct";
    registryMocks.providerDisplayInfo = [
      { id: "claude", group: "harness", models: [], free: false },
      { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
    ];
    configMocks.globalConfig = makeOperatorSurfaceGlobalConfig("claude", "claude-sonnet-4-6");
    runtimeMocks.projectGuiProviderModelDiscovery.mockImplementation(() => ({
      catalogEvidence: {
        status: "complete",
        source: { kind: "test", id: "stale-catalog" },
        observedAt: "2026-06-01T12:00:00.000Z",
        counts: { total: 1, returned: 1, omitted: 0 },
      },
      entries: [{
        providerRoute: { providerId: "openai", providerModelId: "gpt-5.4", scope: "provider" },
        normalizedModel: { providerId: "openai", modelId: "gpt-5.4" },
        freshness: { status: "stale", observedAt: "2026-06-01T12:00:00.000Z" },
        eligibility: { eligible: false, reasonCodes: ["stale-evidence"] },
      }],
    }) as never);
    let switchError = "";
    tuiMocks.startTui.mockImplementationOnce(async (createSession: () => Promise<unknown>) => {
      const session = await createSession() as {
        switchExecutionRoute: (routeId: string, accountOverrideId?: string) => Promise<string>;
      };
      try {
        await session.switchExecutionRoute("openai-gpt-5");
      } catch (error) {
        switchError = error instanceof Error ? error.message : String(error);
      }
    });

    try {
      await expect(tuiCommand(APP_CONFIG, { cwd })).resolves.toBeUndefined();
      expect(switchError).toContain("Execution target");
    } finally {
      runtimeMocks.projectGuiProviderModelDiscovery.mockRestore();
    }
  });

  it("accepts direct startup for registry-owned harness providers without inventing model lists", async () => {
    process.env.KILN_TUI_TRANSPORT = "direct";
    registryMocks.providerDisplayInfo = [
      { id: "claude", group: "harness", models: [], free: false },
      { id: "codex", group: "harness", models: [], free: false },
      { id: "opencode", group: "subscription", models: [], free: true },
    ];
    configMocks.globalConfig = makeOperatorSurfaceGlobalConfig("claude", "claude-sonnet-4-6");

    await expect(
      tuiCommand(APP_CONFIG, { cwd }),
    ).resolves.toBeUndefined();

    expect(runtimeMocks.startTuiGateway).not.toHaveBeenCalled();
    expect(tuiMocks.startTui).toHaveBeenCalledTimes(1);
    const startTuiArgs = tuiMocks.startTui.mock.calls[0] ?? [];
    expect(startTuiArgs[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "claude", models: [] }),
    ]));
    expect(startTuiArgs[2]).toBe("claude");
    expect(startTuiArgs[7]).toEqual(expect.objectContaining({ current: { claude: [] } }));
    expect(startTuiArgs[8]).toEqual(expect.objectContaining({
      current: expect.arrayContaining([
        expect.objectContaining({
          provider: "claude",
          models: [],
          status: "model_selection_not_required",
        }),
      ]),
    }));
    expect(startTuiArgs[9]).toEqual(expect.any(Function));
    expect(startTuiArgs[10]).toEqual(expect.any(Function));
  });

  it("accepts gateway startup for runtime-advertised model-less providers", async () => {
    delete process.env.KILN_TUI_TRANSPORT;
    registryMocks.providerDisplayInfo = [
      { id: "claude", group: "harness", models: [], free: false },
      { id: "codex", group: "harness", models: [], free: false },
      { id: "opencode", group: "subscription", models: [], free: true },
    ];
    configMocks.globalConfig = makeOperatorSurfaceGlobalConfig("claude", "claude-sonnet-4-6");
    runtimeMocks.startTuiGateway.mockResolvedValue({
      port: 4801,
      url: "ws://localhost:4801/ws",
      models: {
        claude: [],
      },
      shutdown: vi.fn(),
    });

    await expect(
      tuiCommand(APP_CONFIG, { cwd }),
    ).resolves.toBeUndefined();

    expect(runtimeMocks.startTuiGateway).toHaveBeenCalledTimes(1);
    expect(tuiMocks.waitForGateway).toHaveBeenCalledTimes(1);
    expect(tuiMocks.startTui).toHaveBeenCalledTimes(1);
    const gatewayOptions = runtimeMocks.startTuiGateway.mock.calls[0]?.[0];
    expect(gatewayOptions?.builtinToolOptions).toMatchObject({
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
      memoryResources: {
        authority: {
          kind: "governed",
          policy: { caller: { kind: "operator_surface", id: "tui" } },
        },
      },
      memoryMutations: {
        callerContext: {
          actorType: "operator_surface",
          actorId: "tui",
        },
      },
    });
    const startTuiArgs = tuiMocks.startTui.mock.calls[0] ?? [];
    expect(startTuiArgs[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "claude", models: [] }),
    ]));
    expect(startTuiArgs[2]).toBe("claude");
    expect(startTuiArgs[7]).toEqual(expect.objectContaining({ current: { claude: [] } }));
    expect(startTuiArgs[8]).toEqual(expect.objectContaining({ current: [] }));
    expect(startTuiArgs[9]).toBeUndefined();
    expect(startTuiArgs[10]).toBeUndefined();
  });

  it("accepts gateway startup for modeled providers only through the canonical projection", async () => {
    delete process.env.KILN_TUI_TRANSPORT;
    registryMocks.providerDisplayInfo = [
      { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
    ];
    configMocks.globalConfig = makeOperatorSurfaceGlobalConfig("openai", "gpt-5.4");
    runtimeMocks.startTuiGateway.mockResolvedValue({
      port: 4801,
      url: "ws://localhost:4801/ws",
      models: {
        openai: ["gpt-5.4"],
      },
      providerDiscovery: gatewayDiscovery("openai", ["gpt-5.4"]),
      providerModelDiscovery: gatewayProjection("openai", "gpt-5.4", true),
      shutdown: vi.fn(),
    });

    await expect(
      tuiCommand(APP_CONFIG, { cwd }),
    ).resolves.toBeUndefined();

    expect(tuiMocks.startTui).toHaveBeenCalledTimes(1);
    const startTuiArgs = tuiMocks.startTui.mock.calls[0] ?? [];
    expect(startTuiArgs[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "openai", models: ["gpt-5.4"] }),
    ]));
    expect(startTuiArgs[7]).toEqual(expect.objectContaining({ current: { openai: ["gpt-5.4"] } }));
    expect(startTuiArgs[9]).toBeUndefined();
    expect(startTuiArgs[10]).toBeUndefined();
  });

  it("starts the TUI gateway before managed-agent provider model discovery resolves", async () => {
    delete process.env.KILN_TUI_TRANSPORT;
    registryMocks.providerDisplayInfo = [
      { id: "codex", group: "harness", models: [], free: false },
      { id: "opencode", group: "subscription", models: [], free: true },
    ];
    configMocks.globalConfig = {
      ...makeOperatorSurfaceGlobalConfig("codex", "gpt-5.3-codex-spark"),
      managedAgents: {
        enabled: true,
        defaultProvider: "codex",
        defaultProfile: "foundation-readonly-plan",
        requireApproval: true,
      },
    };
    runtimeMocks.startTuiGateway.mockResolvedValue({
      port: 4801,
      url: "ws://localhost:4801/ws",
      models: {},
      shutdown: vi.fn(),
    });
    let resolveDiscovery: ((models: ReturnType<typeof managedProviderModelMocks.eligibleModels>) => void) | undefined;
    managedProviderModelMocks.discoverManagedAgentProviderModels.mockImplementationOnce(() =>
      new Promise((resolve) => {
        resolveDiscovery = resolve;
      }));

    const command = tuiCommand(APP_CONFIG, { cwd });

    try {
      for (let attempt = 0; attempt < 20 && runtimeMocks.startTuiGateway.mock.calls.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(runtimeMocks.startTuiGateway).toHaveBeenCalledTimes(1);
    } finally {
      resolveDiscovery?.(managedProviderModelMocks.eligibleModels({ codex: ["gpt-5.3-codex-spark"], opencode: [] }));
      await command;
    }
    expect(tuiMocks.startTui).toHaveBeenCalledTimes(1);
  });

  it("emits startup profile markers through first TUI frame when profiling is enabled", async () => {
    delete process.env.KILN_TUI_TRANSPORT;
    process.env.KILN_STARTUP_PROFILE = "1";
    configMocks.globalConfig = makeOperatorSurfaceGlobalConfig("codex", "gpt-5.3-codex");
    const stderrWrites: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk));
      return true;
    });
    tuiMocks.startTui.mockImplementationOnce(async (...args: unknown[]) => {
      const onFirstFrame = args[14] as (() => void) | undefined;
      onFirstFrame?.();
    });
    runtimeMocks.startTuiGateway.mockResolvedValue({
      port: 4801,
      url: "ws://localhost:4801/ws",
      models: {},
      providerDiscovery: [],
      providerModelDiscovery: {
        catalogEvidence: {
          status: "failed",
          source: { kind: "test", id: "pending-profile" },
          observedAt: "2026-07-01T00:00:00.000Z",
          counts: { total: 0, returned: 0, omitted: 0 },
        },
        entries: [],
      },
      shutdown: vi.fn(),
    });

    try {
      await expect(
        tuiCommand(APP_CONFIG, { cwd }),
      ).resolves.toBeUndefined();
    } finally {
      stderrSpy.mockRestore();
    }

    const markerLines = stderrWrites.filter((line) => line.startsWith("KILN_STARTUP_PROFILE "));
    const phases = markerLines.map((line) => (
      JSON.parse(line.slice("KILN_STARTUP_PROFILE ".length)) as { phase: string; surface: string }
    ));
    expect(phases).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: "tui", phase: "command-entered" }),
      expect.objectContaining({ surface: "tui", phase: "gateway-started" }),
      expect.objectContaining({ surface: "tui", phase: "tui-first-frame-rendered" }),
    ]));
    const firstFrameIndex = phases.findIndex((marker) => (
      marker.surface === "tui" && marker.phase === "tui-first-frame-rendered"
    ));
    const managedRefreshIndex = phases.findIndex((marker) => (
      marker.surface === "managed-agent-route-catalog"
      && marker.phase === "route-catalog-background-refresh-started"
    ));
    expect(firstFrameIndex).toBeGreaterThanOrEqual(0);
    expect(managedRefreshIndex).toBeGreaterThan(firstFrameIndex);
  });

  it("accepts pending direct startup for non-model-less harness providers and fails closed on execution", async () => {
    process.env.KILN_TUI_TRANSPORT = "direct";
    registryMocks.providerDisplayInfo = [
      { id: "codex", group: "harness", models: [], free: false },
      { id: "opencode", group: "subscription", models: [], free: true },
    ];
    configMocks.globalConfig = makeOperatorSurfaceGlobalConfig("codex", "gpt-5.3-codex");

    await expect(
      tuiCommand(APP_CONFIG, { cwd }),
    ).resolves.toBeUndefined();

    expect(runtimeMocks.startTuiGateway).not.toHaveBeenCalled();
    expect(tuiMocks.startTui).toHaveBeenCalledTimes(1);
    const startTuiArgs = tuiMocks.startTui.mock.calls[0] ?? [];
    expect(startTuiArgs[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "codex", models: [] }),
    ]));
    const createSession = startTuiArgs[0] as () => Promise<{
      run: (opts: { prompt: string }) => AsyncIterable<{ type: string; message?: string }>;
    }>;
    const session = await createSession();
    const events: Array<{ type: string; message?: string }> = [];
    for await (const event of session.run({ prompt: "hello" })) {
      events.push(event);
    }
    expect(events).toEqual([{
      type: "error",
      message: "Provider 'codex' is unavailable",
    }]);
  });

  it("rejects direct startup providers that are only known through shared metadata and absent from the local registry", async () => {
    process.env.KILN_TUI_TRANSPORT = "direct";
    configMocks.globalConfig = makeOperatorSurfaceGlobalConfig("openai", "gpt-5.4");

    await expect(
      tuiCommand(APP_CONFIG, { cwd }),
    ).rejects.toThrow("configured TUI execution target uses unsupported provider 'openai'");

    expect(runtimeMocks.startTuiGateway).not.toHaveBeenCalled();
    expect(tuiMocks.waitForGateway).not.toHaveBeenCalled();
    expect(tuiMocks.startTui).not.toHaveBeenCalled();
  });
});
