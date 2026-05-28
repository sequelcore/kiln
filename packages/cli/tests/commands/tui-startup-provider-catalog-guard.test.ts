import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../../src/config.js";

const tuiMocks = vi.hoisted(() => ({
  startTui: vi.fn().mockResolvedValue(undefined),
  waitForGateway: vi.fn().mockResolvedValue(undefined),
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
  resolveGuiProviderSwitch: vi.fn((input: {
    provider: string;
    model?: string;
    models: Record<string, string[]>;
  }) => {
    const provider = input.provider.trim();
    const providerModels = input.models[provider];
    if (!providerModels || providerModels.length === 0) {
      return { ok: false, error: `Provider '${provider}' is unavailable` } as const;
    }
    const model = input.model?.trim() ?? "";
    if (!model) {
      return { ok: false, error: `Provider '${provider}' requires a selected model.` } as const;
    }
    if (!providerModels.includes(model)) {
      return { ok: false, error: `Provider '${provider}' does not advertise model '${model}'` } as const;
    }
    return {
      ok: true,
      provider,
      modelForSessionManager: model,
      modelForAck: model,
    } as const;
  }),
  startTuiGateway: vi.fn(async () => ({
    port: 4801,
    url: "ws://localhost:4801/ws",
    models: {
      openai: ["gpt-5.4"],
    },
    shutdown: vi.fn(),
  })),
}));

const configMocks = vi.hoisted(() => ({
  globalConfig: null as {
    routing?: { defaultWorker?: string };
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
  resolveEffectiveProvider: vi.fn((provider: string | undefined, globalProvider?: string) => {
    const value = provider?.trim() || globalProvider?.trim();
    return value && value.length > 0 ? value : undefined;
  }),
}));

const registryMocks = vi.hoisted(() => {
  const mock = {
    providerDisplayInfo: [
      { id: "codex", group: "harness", models: [], free: false },
      { id: "opencode", group: "subscription", models: [], free: true },
    ],
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
  discoverManagedAgentProviderModels: vi.fn(async () => ({
    codex: ["gpt-5.3-codex-spark"],
    opencode: ["opencode/minimax-m2.5-free"],
  })),
}));

const resumeMocks = vi.hoisted(() => ({
  loadResumeSidebarInfo: vi.fn().mockResolvedValue({}),
}));

const sessionManagerMocks = vi.hoisted(() => ({
  prepare: vi.fn().mockResolvedValue({
    systemPrompt: "You are a helpful assistant.",
    domain: { displayName: "kiln" },
  }),
}));

const sessionStoreMocks = vi.hoisted(() => ({
  last: vi.fn().mockResolvedValue(null),
  getResumeTarget: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  clearResumeTarget: vi.fn().mockResolvedValue(undefined),
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
  themes: { "kiln-dark": {} },
  kilnDark: {},
  GatewaySession: class {},
}));

vi.mock("@kilnai/runtime", () => ({
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
  attachManagedInvocationSessionEventSink: (
    options: Record<string, unknown> | undefined,
    sessionEventSink: unknown,
  ) => options ? { ...options, sessionEventSink } : undefined,
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
  resolveGuiOperatorDiscoveryResults: runtimeMocks.resolveGuiOperatorDiscoveryResults,
  markGuiProviderDiscoveryStale: (discovery: readonly unknown[]) => discovery,
  projectGuiOperatorModels: runtimeMocks.projectGuiOperatorModels,
  createProviderCatalogService: runtimeMocks.createProviderCatalogService,
  providerRequiresSelectedModelMessage: (provider: string) => `Provider '${provider}' requires a selected model.`,
  resolveGuiProviderSwitch: runtimeMocks.resolveGuiProviderSwitch,
  startTuiGateway: runtimeMocks.startTuiGateway,
}));

vi.mock("../../src/config/global-config.js", () => ({
  readGlobalConfig: configMocks.readGlobalConfig,
  resolveGlobalDefaultProvider: (config: typeof configMocks.globalConfig) => {
    if (!config) return undefined;
    return config.routing?.defaultWorker
      ?? Object.entries(config.engines ?? {}).find(([, engine]) => engine.enabled)?.[0];
  },
  resolveGlobalDefaultModel: () => undefined,
  resolveGlobalUiTheme: (config: typeof configMocks.globalConfig) => config?.ui?.theme,
}));

vi.mock("../../src/config/env-config.js", () => ({
  resolveEffectiveProvider: configMocks.resolveEffectiveProvider,
}));

vi.mock("../../src/config/managed-agent-provider-models.js", () => ({
  PENDING_MANAGED_AGENT_PROVIDER_MODELS: {},
  discoverManagedAgentProviderModels: managedProviderModelMocks.discoverManagedAgentProviderModels,
}));

vi.mock("../../src/application/resume-sidebar-info.js", () => ({
  loadResumeSidebarInfo: resumeMocks.loadResumeSidebarInfo,
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
    getResumeTarget = sessionStoreMocks.getResumeTarget;
    list = sessionStoreMocks.list;
    clearResumeTarget = sessionStoreMocks.clearResumeTarget;
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
  let cwd: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    configMocks.globalConfig = null;
    cwd = mkdtempSync(join(tmpdir(), "kiln-tui-startup-guard-"));
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
      shutdown: vi.fn(),
    });
    managedProviderModelMocks.discoverManagedAgentProviderModels.mockResolvedValue({
      codex: ["gpt-5.3-codex-spark"],
      opencode: ["opencode/minimax-m2.5-free"],
    });
  });

  afterEach(() => {
    process.env.KILN_TUI_TRANSPORT = originalTransport;
    if (cwd) {
      rmSync(cwd, { recursive: true, force: true });
      cwd = undefined;
    }
  });

  it("rejects gateway startup providers absent from the local registry", async () => {
    delete process.env.KILN_TUI_TRANSPORT;

    await expect(
      tuiCommand(APP_CONFIG, { cwd, provider: "openai" }),
    ).rejects.toThrow("Unknown provider: openai");

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

    await expect(
      tuiCommand(APP_CONFIG, { cwd, provider: "openai" }),
    ).resolves.toBeUndefined();

    expect(runtimeMocks.startTuiGateway).not.toHaveBeenCalled();
    expect(runtimeMocks.resolveGuiOperatorDiscoveryResults).toHaveBeenCalledWith(expect.objectContaining({ openai: true }));
    expect(runtimeMocks.projectGuiOperatorModels).toHaveBeenCalled();
    expect(tuiMocks.waitForGateway).not.toHaveBeenCalled();
    expect(tuiMocks.startTui).toHaveBeenCalledTimes(1);
  });

  it("accepts direct startup for registry-owned harness providers without inventing model lists", async () => {
    process.env.KILN_TUI_TRANSPORT = "direct";
    registryMocks.providerDisplayInfo = [
      { id: "claude", group: "harness", models: [], free: false },
      { id: "codex", group: "harness", models: [], free: false },
      { id: "opencode", group: "subscription", models: [], free: true },
    ];

    await expect(
      tuiCommand(APP_CONFIG, { cwd, provider: "claude" }),
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
    runtimeMocks.startTuiGateway.mockResolvedValue({
      port: 4801,
      url: "ws://localhost:4801/ws",
      models: {
        claude: [],
      },
      shutdown: vi.fn(),
    });

    await expect(
      tuiCommand(APP_CONFIG, { cwd, provider: "claude" }),
    ).resolves.toBeUndefined();

    expect(runtimeMocks.startTuiGateway).toHaveBeenCalledTimes(1);
    expect(tuiMocks.waitForGateway).toHaveBeenCalledTimes(1);
    expect(tuiMocks.startTui).toHaveBeenCalledTimes(1);
    const gatewayOptions = runtimeMocks.startTuiGateway.mock.calls[0]?.[0];
    expect(gatewayOptions?.builtinToolOptions).toMatchObject({
      memoryResources: {
        authority: {
          caller: { kind: "operator_surface", id: "tui" },
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

  it("starts the TUI gateway before managed-agent provider model discovery resolves", async () => {
    delete process.env.KILN_TUI_TRANSPORT;
    registryMocks.providerDisplayInfo = [
      { id: "codex", group: "harness", models: [], free: false },
      { id: "opencode", group: "subscription", models: [], free: true },
    ];
    configMocks.globalConfig = {
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
    let resolveDiscovery: ((models: { codex: string[]; opencode: string[] }) => void) | undefined;
    managedProviderModelMocks.discoverManagedAgentProviderModels.mockImplementationOnce(() =>
      new Promise((resolve) => {
        resolveDiscovery = resolve;
      }));

    const command = tuiCommand(APP_CONFIG, { cwd, provider: "codex" });

    try {
      for (let attempt = 0; attempt < 20 && runtimeMocks.startTuiGateway.mock.calls.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(runtimeMocks.startTuiGateway).toHaveBeenCalledTimes(1);
    } finally {
      resolveDiscovery?.({ codex: ["gpt-5.3-codex-spark"], opencode: [] });
      await command;
    }
    expect(tuiMocks.startTui).toHaveBeenCalledTimes(1);
  });

  it("accepts pending direct startup for non-model-less harness providers and fails closed on execution", async () => {
    process.env.KILN_TUI_TRANSPORT = "direct";
    registryMocks.providerDisplayInfo = [
      { id: "codex", group: "harness", models: [], free: false },
      { id: "opencode", group: "subscription", models: [], free: true },
    ];

    await expect(
      tuiCommand(APP_CONFIG, { cwd, provider: "codex" }),
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

    await expect(
      tuiCommand(APP_CONFIG, { cwd, provider: "openai" }),
    ).rejects.toThrow("Unknown provider: openai");

    expect(runtimeMocks.startTuiGateway).not.toHaveBeenCalled();
    expect(tuiMocks.waitForGateway).not.toHaveBeenCalled();
    expect(tuiMocks.startTui).not.toHaveBeenCalled();
  });
});
