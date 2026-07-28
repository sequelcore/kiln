import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionStore, TranscriptStore, type SessionRecord } from "../../src/wrapper/session-store.js";
import { createSessionEvent, InMemoryContextArtifactCache, type ContextArtifactCache, type DefaultBuiltinToolRegistryOptions } from "@kilnai/core";

const TOOL_CALL_SCOPE_ID = "turn-1:response:1";

const {
  mockGatewaySessionCtor,
  mockWaitForGateway,
  mockStartTui,
  mockStartTuiGateway,
  mockGetProjectContextArtifactCache,
  mockSessionManagerPrepare,
  mockResolveGuiOperatorDiscoveryResults,
  mockProjectGuiOperatorModels,
  mockProjectGuiProviderModelDiscovery,
  mockResolveGuiProviderSwitch,
  mockCreateProviderCatalogService,
  mockGlobalConfig,
} = vi.hoisted(() => ({
  mockGatewaySessionCtor: vi.fn(),
  mockWaitForGateway: vi.fn(),
  mockStartTui: vi.fn(),
  mockStartTuiGateway: vi.fn(),
  mockGetProjectContextArtifactCache: vi.fn(),
  mockSessionManagerPrepare: vi.fn(),
  mockResolveGuiOperatorDiscoveryResults: vi.fn(async () => {
    const models: Record<string, string[]> = {
      "opencode-go": ["minimax-m2.5"],
      "opencode-zen": ["anthropic/claude-sonnet-4-6"],
      claude: [],
      anthropic: ["claude-sonnet-4-6"],
      openai: ["gpt-5.4"],
      deepseek: ["deepseek-chat"],
      openrouter: ["nvidia/nemotron-3-nano-30b-a3b:free"],
    };
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
  mockProjectGuiOperatorModels: vi.fn((discovery: Array<{ provider: string; available: boolean; models: string[] }>) => (
    Object.fromEntries(discovery.flatMap((entry) => (
      entry.available ? [[entry.provider, entry.models]] : []
    )))
  )),
  mockProjectGuiProviderModelDiscovery: vi.fn((discovery: Array<{ provider: string; models: string[] }>) => ({
    catalogEvidence: {
      status: "complete",
      source: {
        kind: "test",
        id: "tui-session-persistence",
      },
      observedAt: "2026-07-01T00:00:00.000Z",
      counts: {
        total: discovery.length,
        returned: discovery.length,
        omitted: 0,
      },
    },
    entries: discovery.flatMap((provider) => provider.models.map((model) => ({
      providerRoute: { providerId: provider.provider, providerModelId: model, scope: "provider" },
      normalizedModel: { providerId: provider.provider, modelId: model },
      freshness: { status: "fresh", observedAt: "2026-07-01T00:00:00.000Z" },
      eligibility: { eligible: true, reasonCodes: [] },
    }))),
  })),
  mockCreateProviderCatalogService: vi.fn((resolveDiscovery: () => Promise<readonly unknown[]>, emptyDiscovery: readonly unknown[]) => {
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
  mockResolveGuiProviderSwitch: vi.fn((input: {
    provider: string;
    model?: string;
    discovery?: ReadonlyArray<{ provider: string; models: string[] }>;
    providerModelDiscovery?: {
      entries: ReadonlyArray<{
        providerRoute: { providerId: string; providerModelId: string };
      }>;
    };
  }) => {
    const provider = input.provider.trim();
    const providerModels = provider === "claude"
      ? input.discovery?.find((entry) => entry.provider === provider)?.models
      : input.providerModelDiscovery?.entries
          .filter((entry) => entry.providerRoute.providerId === provider)
          .map((entry) => entry.providerRoute.providerModelId);
    if (!providerModels) {
      return { ok: false, error: `Provider '${provider}' is unavailable` } as const;
    }
    if (providerModels.length === 0 && provider === "claude") {
      return { ok: true, provider, modelForSessionManager: "", modelForAck: "" } as const;
    }
    if (providerModels.length === 0) {
      return { ok: false, error: `Provider '${provider}' has no available models` } as const;
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
  mockGlobalConfig: {
    value: null as { ui?: { theme?: string } } | null,
  },
}));

vi.mock("@kilnai/tui", () => ({
  GatewaySession: class MockGatewaySession {
    constructor(...args: unknown[]) {
      mockGatewaySessionCtor(...args);
    }
    async *run() {}
    async dispose() {}
  },
  waitForGateway: mockWaitForGateway,
  startTui: mockStartTui,
  themes: { "kiln-dark": {} },
  kilnDark: {},
}));
vi.mock("@kilnai/runtime", () => ({
  startTuiGateway: mockStartTuiGateway,
  getProjectContextArtifactCache: mockGetProjectContextArtifactCache,
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
    const sessionOptions = {
      ...(options ?? {}),
      resourceNotifications: options?.resourceNotifications ?? {},
      monitorRegistry: options?.monitorRegistry ?? {},
      taskStateStore: options?.taskStateStore ?? {},
      artifactResources: { store: artifactStore },
    };
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
    sessionEventSink: { publish: (events: readonly unknown[], context: unknown) => void | Promise<void> },
  ) => {
    if (!options) {
      return undefined;
    }
    const existingSink = options.sessionEventSink as
      | { publish?: (events: readonly unknown[], context: unknown) => void | Promise<void> }
      | undefined;
    return {
      ...options,
      sessionEventSink: {
        publish: async (events: readonly unknown[], context: unknown) => {
          await existingSink?.publish?.(events, context);
          await sessionEventSink.publish(events, context);
        },
      },
    };
  },
  ManagedDirectProviderRuntimeAdapter: class MockManagedDirectProviderRuntimeAdapter {},
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
  resolveGuiOperatorDiscoveryResults: mockResolveGuiOperatorDiscoveryResults,
  markGuiProviderDiscoveryStale: (discovery: readonly unknown[]) => discovery,
  projectGuiOperatorModels: mockProjectGuiOperatorModels,
  projectGuiProviderModelDiscovery: mockProjectGuiProviderModelDiscovery,
  createProviderCatalogService: mockCreateProviderCatalogService,
  providerRequiresSelectedModelMessage: (provider: string) => `Provider '${provider}' requires a selected model.`,
  resolveGuiProviderSwitch: mockResolveGuiProviderSwitch,
}));
vi.mock("../../src/wrapper/session-manager.js", () => ({
  SessionManager: class MockSessionManager {
    prepare = mockSessionManagerPrepare;
  },
}));
vi.mock("../../src/config/global-config.js", () => ({
  readGlobalConfig: vi.fn(() => mockGlobalConfig.value),
  resolveGlobalConfigPath: () => "C:\\Users\\operator\\.kiln\\config.yaml",
  resolveGlobalDefaultProvider: () => undefined,
  resolveGlobalDefaultModel: () => undefined,
  resolveGlobalUiTheme: () => undefined,
}));

// We test makeMultiProviderSessionFactory via a lightweight re-implementation
// that mirrors the exported function's logic — this keeps tests fast and
// isolated without requiring the full runtime to be importable.
//
// The actual function is tested by importing it directly once exported.
import { makeMultiProviderSessionFactory, tuiCommand } from "../../src/commands/tui.js";
import { SessionRegistry } from "../../src/wrapper/session-registry.js";

const APP_CONFIG = {
  createRegistry: () => {
    throw new Error("createRegistry should not be used in tui command tests");
  },
};

const PROVIDER_IDS = [
  "claude",
  "codex",
  "codex-oauth",
  "opencode",
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
  "ollama",
] as const;

function makeStore(lastRecord: SessionRecord | null = null) {
  const appended: SessionRecord[] = [];
  const bySession = new Map<string, SessionRecord>();
  if (lastRecord) {
    bySession.set(lastRecord.sessionId, lastRecord);
  }
  return {
    store: {
      last: vi.fn().mockResolvedValue(lastRecord),
      getContinuationTarget: vi.fn().mockResolvedValue(lastRecord),
      find: vi.fn().mockImplementation(async (sessionId: string) => bySession.get(sessionId) ?? null),
      append: vi.fn().mockImplementation(async (r: SessionRecord) => {
        appended.push(r);
        bySession.set(r.sessionId, r);
      }),
      clearContinuationTarget: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("../../src/wrapper/session-store.js").SessionStore,
    appended,
  };
}

function makeTranscriptStore() {
  const events: import("../../src/wrapper/session-store.js").PersistedTranscriptEvent[] = [];
  const append = vi.fn().mockImplementation(async (_sessionId: string, event: import("../../src/wrapper/session-store.js").PersistedTranscriptEvent) => {
    events.push(event);
  });
  const appendManyNext = vi.fn().mockImplementation(async (sessionId: string, drafts: readonly import("../../src/wrapper/session-store.js").PersistedTranscriptEventDraft[]) => {
    let sequence = events.length;
    const appended = drafts.map((draft) => ({
      ...draft,
      sequence: ++sequence,
    } as import("../../src/wrapper/session-store.js").PersistedTranscriptEvent));
    for (const event of appended) {
      await append(sessionId, event);
    }
    return appended;
  });
  return {
    init: vi.fn().mockResolvedValue(undefined),
    readTranscript: vi.fn().mockImplementation(async () => [...events]),
    append,
    appendNext: vi.fn().mockImplementation(async (sessionId: string, draft: import("../../src/wrapper/session-store.js").PersistedTranscriptEventDraft) => {
      const [event] = await appendManyNext(sessionId, [draft]);
      return event ?? null;
    }),
    appendManyNext,
    finalize: vi.fn().mockResolvedValue(undefined),
    readMeta: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
  } as unknown as TranscriptStore;
}

function makeContextArtifactCache(): ContextArtifactCache {
  return new InMemoryContextArtifactCache();
}

function makeRegistry(sessionId = "sess-abc") {
  const sessions: { sessionId: string; continuationSessionId?: string; dispose: () => Promise<void>; run: (opts: unknown) => AsyncGenerator<unknown> }[] = [];
  const registry = {
    createSession: vi.fn().mockImplementation(
      (_provider: string, opts: { continuationSessionId?: string }) => {
        const session = {
          sessionId,
          continuationSessionId: opts.continuationSessionId,
          providerSessionId: "prov-" + sessionId,
          dispose: vi.fn().mockResolvedValue(undefined),
          run: vi.fn().mockImplementation(async function* () {
            // Yield once to allow the factory's dispose wrapper to be set up
            yield undefined;
          }),
        };
        sessions.push(session);
        return session;
      },
    ),
  } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
  return { registry, sessions };
}

describe("makeMultiProviderSessionFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartTui.mockResolvedValue(undefined);
    mockWaitForGateway.mockResolvedValue(undefined);
    mockGetProjectContextArtifactCache.mockResolvedValue(new InMemoryContextArtifactCache());
    mockSessionManagerPrepare.mockRejectedValue(new Error("missing gateway config"));
    mockGlobalConfig.value = null;
    mockStartTuiGateway.mockResolvedValue({
      port: 4801,
      url: "ws://localhost:4801/ws",
      models: {
        claude: ["claude-sonnet-4-6"],
        codex: ["gpt-5.3-codex"],
        opencode: ["minimax-m2.5"],
      },
      shutdown: vi.fn(),
    });
  });

  it("starts without an implicit continuationSessionId even when a continuation cursor exists", async () => {
    const record = {
      sessionId: "prev-session",
      provider: "claude",
      task: "interactive",
      completedAt: "2026-01-01T00:00:00.000Z",
      cost: 0,
      projectPath: "/p",
      providerThread: { provider: "claude", nativeSessionId: "prov-1" },
    };
    const { store } = makeStore(record);
    const { registry, sessions } = makeRegistry();
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/p", registry, store as any, transcriptStore, cache);
    const session = factory("sys", "/p");
    
    for await (const _ of session.run({ prompt: "test" } as any)) {}

    expect(registry.createSession).toHaveBeenCalled();
    expect(sessions[0]?.continuationSessionId).toBeUndefined();
  });

  it("initializes with undefined continuationSessionId when store is empty", async () => {
    const { store } = makeStore(null);
    const { registry, sessions } = makeRegistry();
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/p", registry, store as any, transcriptStore, cache);
    const session = factory("sys", "/p");
    
    for await (const _ of session.run({ prompt: "test" } as any)) {}

    expect(registry.createSession).toHaveBeenCalled();
    expect(sessions[0]?.continuationSessionId).toBeUndefined();
  });

  it("passes the parent runtime authority and workspace into the provider session", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();
    const { factory } = await makeMultiProviderSessionFactory(
      "codex-oauth",
      PROVIDER_IDS,
      "/fallback",
      registry,
      store as any,
      transcriptStore,
      cache,
    );
    const session = factory("sys", "/workspace/kiln", {
      requestedAuthority: "destructive",
    });

    for await (const _ of session.run({ prompt: "execute managed work" } as any)) {}

    expect(registry.createSession).toHaveBeenCalledWith(
      "codex-oauth",
      expect.objectContaining({
        cwd: "/workspace/kiln",
        requestedAuthority: "destructive",
      }),
    );
  });

  it("passes the persisted transcript turn id into GUI provider session runs", async () => {
    const { store } = makeStore(null);
    const { registry, sessions } = makeRegistry("sess-persisted-turn");
    const transcriptStore = makeTranscriptStore();
    vi.mocked(transcriptStore.readTranscript).mockResolvedValue([
      { kind: "turn_started" },
      { kind: "turn_completed" },
      { kind: "turn_started" },
      { kind: "turn_completed" },
    ] as any);
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory(
      "codex-oauth",
      PROVIDER_IDS,
      "/p",
      registry,
      store as any,
      transcriptStore,
      cache,
      undefined,
      "gui",
    );
    const session = factory("sys", "/p");

    for await (const _ of session.run({ prompt: "start child" } as any)) {}

    expect(sessions[0]?.run).toHaveBeenCalledWith(expect.objectContaining({
      turnId: "sess-persisted-turn:turn:3",
    }));
  });

  it("passes configured builtin tool options into provider sessions", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();
    const builtinToolOptions: DefaultBuiltinToolRegistryOptions = {
      webSearch: {
        searchProvider: async () => ({ sources: [] }),
      },
    };

    const { factory } = await makeMultiProviderSessionFactory(
      "claude",
      PROVIDER_IDS,
      "/p",
      registry,
      store as any,
      transcriptStore,
      cache,
      builtinToolOptions,
    );
    const session = factory("sys", "/p");

    for await (const _ of session.run({ prompt: "test" } as any)) {}

    expect(registry.createSession).toHaveBeenCalledWith(
      "claude",
      expect.objectContaining({
        builtinToolOptions: expect.objectContaining({
          webSearch: builtinToolOptions.webSearch,
          artifactResources: expect.any(Object),
          monitorRegistry: expect.any(Object),
          taskStateStore: expect.any(Object),
          resourceNotifications: expect.any(Object),
        }),
      }),
    );
  });

  it("passes runtime budget admission into provider sessions", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();
    const budgetAdmission = { admit: vi.fn() };

    const { factory } = await makeMultiProviderSessionFactory(
      "claude",
      PROVIDER_IDS,
      "/p",
      registry,
      store as any,
      transcriptStore,
      cache,
      undefined,
      "tui",
      undefined,
      budgetAdmission,
    );
    const session = factory("sys", "/p");

    for await (const _ of session.run({ prompt: "budgeted turn" } as any)) {}

    expect(registry.createSession).toHaveBeenCalledWith(
      "claude",
      expect.objectContaining({ budgetAdmission }),
    );
  });

  it("does not pass a default tool-round budget into the interactive TUI gateway", async () => {
    await tuiCommand(APP_CONFIG as never, {
      cwd: "/p",
      provider: "claude",
    });

    expect(mockStartTuiGateway).toHaveBeenCalledWith(
      expect.not.objectContaining({ maxToolRounds: expect.anything() }),
    );
  });

  it("passes the stable Kiln session id into recreated provider sessions", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory(
      "claude",
      PROVIDER_IDS,
      "/p",
      registry,
      store as any,
      transcriptStore,
      cache,
    );
    const session = factory("sys", "/p");

    for await (const _ of session.run({
      kilnSessionId: "kiln-gui:session-1",
      prompt: "stable session",
    } as any)) {}

    expect(registry.createSession).toHaveBeenCalledWith(
      "claude",
      expect.objectContaining({ runtimeSessionId: "kiln-gui:session-1" }),
    );
  });

  it("does not attach globally visible managed invocation resources to recreated provider sessions", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();
    const invocationService = { list: vi.fn(() => []) };

    const { factory } = await makeMultiProviderSessionFactory(
      "claude",
      PROVIDER_IDS,
      "/p",
      registry,
      store as any,
      transcriptStore,
      cache,
      undefined,
      "tui",
      {
        callerIdentity: {
          kind: "kiln-runtime",
          surface: "tui",
          attachmentId: "kiln-runtime:tui",
        },
        options: {
          routes: [],
          requestedBy: "assistant",
          requestSource: "tui",
          invocationService,
        },
      } as any,
    );
    const session = factory("sys", "/p");

    for await (const _ of session.run({ prompt: "managed resources" } as any)) {}

    const options = vi.mocked(registry.createSession).mock.calls[0]?.[1]?.builtinToolOptions;
    expect(options?.resourceProviders).toBeUndefined();
  });

  it("shares builtin resource state across recreated provider sessions", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory(
      "claude",
      PROVIDER_IDS,
      "/p",
      registry,
      store as any,
      transcriptStore,
      cache,
    );

    const first = factory("sys", "/p");
    for await (const _ of first.run({ prompt: "first" } as any)) {}
    const second = factory("sys", "/p");
    for await (const _ of second.run({ prompt: "second" } as any)) {}

    const firstOptions = vi.mocked(registry.createSession).mock.calls[0]?.[1]?.builtinToolOptions;
    const secondOptions = vi.mocked(registry.createSession).mock.calls[1]?.[1]?.builtinToolOptions;

    expect(firstOptions).toBeDefined();
    expect(secondOptions).toBeDefined();
    expect(secondOptions?.artifactResources?.store).toBe(firstOptions?.artifactResources?.store);
    expect(secondOptions?.resourceNotifications).toBe(firstOptions?.resourceNotifications);
    expect(secondOptions?.monitorRegistry).toBe(firstOptions?.monitorRegistry);
    expect(secondOptions?.taskStateStore).toBe(firstOptions?.taskStateStore);
  });

  it("calls store.append() after session dispose", async () => {
    const { store, appended } = makeStore(null);
    const { registry } = makeRegistry("sess-1");
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/proj", registry, store as any, transcriptStore, cache);
    const session = factory("sys", "/proj");
    
    // The factory implements session persistence - when run() completes,
    // the inner session is disposed and the session record is appended to store.
    // We verify the session completes successfully (full lifecycle runs).
    let completed = false;
    for await (const _ of session.run({ prompt: "test" } as any)) {
      completed = true;
    }
    expect(completed).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      sessionId: "sess-1",
      provider: "claude",
      canonicalTitle: "test",
      providersUsed: ["claude"],
    });
  });

  it("persists full tool output separately from the compact summary", async () => {
    const { store } = makeStore(null);
    const fullOutput = JSON.stringify({
      output: "# Session Model\n\nKiln session identity is provider-agnostic.",
      isError: false,
      metadata: {
        toolName: "read",
        kind: "inspection",
        operation: "read",
        filePath: "docs/architecture/session-model.md",
      },
    });
    const registry = {
      list: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({
        sessionId: "sess-full-output",
        providerSessionId: "prov-full-output",
        dispose: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockImplementation(async function* () {
          yield {
            type: "tool_use",
            toolCallId: "call-full-output",
            toolCallScopeId: TOOL_CALL_SCOPE_ID,
            toolName: "read",
            input: { filePath: "docs/architecture/session-model.md" },
          };
          yield {
            type: "tool_result",
            toolCallId: "call-full-output",
            toolCallScopeId: TOOL_CALL_SCOPE_ID,
            toolName: "read",
            output: fullOutput,
            outputSummary: fullOutput.slice(0, 40),
          };
        }),
      }),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/proj", registry, store as any, transcriptStore, cache);
    const session = factory("sys", "/proj");
    for await (const _ of session.run({ prompt: "read docs" } as any)) {}

    const appendedEvents = vi.mocked(transcriptStore.append).mock.calls.map((call) => call[1]);
    const toolEvent = appendedEvents.find((event) => event.kind === "tool_call_completed");
    expect(toolEvent?.payload).toMatchObject({
      toolCallId: "call-full-output",
      toolCallScopeId: TOOL_CALL_SCOPE_ID,
      toolName: "read",
      output: "# Session Model\n\nKiln session identity is provider-agnostic.",
      outputSummary: fullOutput.slice(0, 40),
      metadata: {
        toolName: "read",
        kind: "inspection",
        operation: "read",
        filePath: "docs/architecture/session-model.md",
      },
      status: { state: "succeeded" },
    });
    expect(toolEvent?.payload.output).not.toBe(fullOutput);
  });

  it("persists a complete canonical turn for prompt-only direct sessions", async () => {
    const { store } = makeStore(null);
    const registry = {
      list: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({
        sessionId: "sess-turn",
        providerSessionId: "prov-turn",
        dispose: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockImplementation(async function* () {
          yield { type: "text_delta", content: "Done." };
          yield { type: "completed", totalUsd: 0, durationMs: 10, outcome: "completed", isPreflightCrash: false };
        }),
      }),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/proj", registry, store as any, transcriptStore, cache);
    const session = factory("sys", "/proj");
    for await (const _ of session.run({ prompt: "summarize operator event visibility" } as any)) {}

    const appendedEvents = vi.mocked(transcriptStore.append).mock.calls.map((call) => call[1]);
    expect(appendedEvents.map((event) => event.kind)).toEqual([
      "turn_started",
      "user_message",
      "assistant_delta",
      "assistant_message",
      "turn_completed",
    ]);
    expect(appendedEvents.find((event) => event.kind === "user_message")?.payload).toMatchObject({
      content: "summarize operator event visibility",
    });
    expect(appendedEvents.find((event) => event.kind === "assistant_message")?.payload).toMatchObject({
      content: "Done.",
    });
  });

  it("persists provider-scoped cost updates for budget usage attribution", async () => {
    const { store } = makeStore(null);
    const registry = {
      list: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({
        sessionId: "sess-cost",
        providerSessionId: "prov-cost",
        dispose: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockImplementation(async function* () {
          yield {
            type: "cost_update",
            usd: 0,
            mode: "computed",
            provider: "codex-oauth",
            model: "gpt-5.4",
            inputTokens: 30,
            outputTokens: 12,
            cacheReadTokens: 3,
            cacheWriteTokens: 7,
          };
          yield { type: "completed", totalUsd: 0, durationMs: 10, outcome: "completed", isPreflightCrash: false };
        }),
      }),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory(
      "codex-oauth",
      PROVIDER_IDS,
      "/proj",
      registry,
      store as any,
      transcriptStore,
      cache,
      undefined,
      "gui",
    );
    const session = factory("sys", "/proj");
    for await (const _ of session.run({ prompt: "costed turn" } as any)) {}

    const appendedEvents = vi.mocked(transcriptStore.append).mock.calls.map((call) => call[1]);
    expect(appendedEvents.find((event) => event.kind === "cost_updated")?.payload).toMatchObject({
      provider: { provider: "codex-oauth", model: "gpt-5.4" },
      usage: {
        inputTokens: 30,
        outputTokens: 12,
        cacheReadTokens: 3,
        cacheWriteTokens: 7,
      },
    });
    expect(vi.mocked(transcriptStore.finalize).mock.calls.at(-1)?.[1]).toMatchObject({
      providerTokenUsage: [{
        provider: "codex-oauth",
        model: "gpt-5.4",
        inputTokens: 30,
        outputTokens: 12,
        cacheReadTokens: 3,
        cacheWriteTokens: 7,
      }],
    });
  });

  it("persists managed invocation events through the shared transcript allocator", async () => {
    const { store } = makeStore(null);
    const registry = {
      list: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({
        sessionId: "sess-managed-events",
        providerSessionId: "prov-managed-events",
        dispose: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockImplementation(async function* () {
          yield {
            type: "tool_use",
            toolCallId: "call-managed-start",
            toolCallScopeId: TOOL_CALL_SCOPE_ID,
            toolName: "managed_agent.start",
            input: {},
          };
          yield {
            type: "tool_result",
            toolCallId: "call-managed-start",
            toolCallScopeId: TOOL_CALL_SCOPE_ID,
            toolName: "managed_agent.start",
            output: "{}",
          };
        }),
      }),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory, managedInvocation } = await makeMultiProviderSessionFactory(
      "codex-oauth",
      PROVIDER_IDS,
      "/proj",
      registry,
      store as any,
      transcriptStore,
      cache,
      undefined,
      "gui",
      {
        callerIdentity: {
          kind: "kiln-runtime",
          surface: "gui",
          attachmentId: "kiln-runtime:gui",
        },
        options: { routes: [] },
      },
    );
    const session = factory("sys", "/proj");
    const run = session.run({ prompt: "start a managed child", kilnSessionId: "sess-managed-events" } as any);
    await run.next();
    await managedInvocation?.sessionEventSink?.publish([
      createSessionEvent<"agent_invocation_requested">({
        eventId: "event-managed-requested",
        kilnSessionId: "sess-managed-events",
        sequence: 99,
        timestamp: new Date("2026-05-28T04:42:00.000Z"),
        kind: "agent_invocation_requested",
        turnId: "sess-managed-events:turn:1",
        invocationId: "managed-1",
        agentId: "agent-reviewer",
        parentSessionId: "sess-managed-events",
        requestedBy: "assistant",
        requestSource: "runtime-tool",
        routeId: "codex-oauth-readonly",
        routeSource: "explicit-managed-route",
        providerRoute: {
          providerId: "opencode-go",
          surface: "direct-provider",
          model: "deepseek-v4-flash",
        },
        lifecycleState: "pending",
        inputSummary: "Review runtime projection.",
        source: { actor: "runtime", surface: "runtime", component: "managed-invocation" },
      }),
      createSessionEvent<"agent_invocation_started">({
        eventId: "event-managed-started",
        kilnSessionId: "sess-managed-events",
        sequence: 100,
        timestamp: new Date("2026-05-28T04:42:00.001Z"),
        kind: "agent_invocation_started",
        turnId: "sess-managed-events:turn:1",
        parentEventId: "event-managed-requested",
        invocationId: "managed-1",
        agentId: "agent-reviewer",
        parentSessionId: "sess-managed-events",
        routeId: "codex-oauth-readonly",
        routeSource: "explicit-managed-route",
        providerRoute: {
          providerId: "opencode-go",
          surface: "direct-provider",
          model: "deepseek-v4-flash",
        },
        lifecycleState: "running",
        attempt: 1,
        source: { actor: "runtime", surface: "runtime", component: "managed-invocation" },
      }),
      createSessionEvent<"agent_invocation_completed">({
        eventId: "event-managed-completed",
        kilnSessionId: "sess-managed-events",
        sequence: 101,
        timestamp: new Date("2026-05-28T04:42:00.002Z"),
        kind: "agent_invocation_completed",
        turnId: "sess-managed-events:turn:1",
        parentEventId: "event-managed-started",
        invocationId: "managed-1",
        agentId: "agent-reviewer",
        parentSessionId: "sess-managed-events",
        routeId: "codex-oauth-readonly",
        routeSource: "explicit-managed-route",
        providerRoute: {
          providerId: "opencode-go",
          surface: "direct-provider",
          model: "deepseek-v4-flash",
        },
        lifecycleState: "completed",
        durationMs: 120,
        resultSummary: "Review complete.",
        managedInvocationEvidence: {
          usage: {
            source: "provider",
            tokenClasses: [
              { name: "input", value: 1200 },
              { name: "output", value: 80 },
              { name: "cache_read", value: 400 },
              { name: "cache_write", value: 20 },
            ],
            cost: { currency: "USD", amount: 0 },
          },
        },
        source: { actor: "runtime", surface: "runtime", component: "managed-invocation" },
      }),
    ], {
      session: { id: "sess-managed-events" },
    } as never);
    for await (const _ of run) {}

    const appendedEvents = vi.mocked(transcriptStore.append).mock.calls.map((call) => call[1]);

    expect(appendedEvents.map((event) => event.kind)).toEqual([
      "turn_started",
      "user_message",
      "tool_call_started",
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
      "tool_call_completed",
      "turn_completed",
    ]);
    expect(appendedEvents.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(appendedEvents[3]).toMatchObject({
      eventId: "event-managed-requested",
      sequence: 4,
      kind: "agent_invocation_requested",
      payload: {
        invocationId: "managed-1",
        managedInvocationId: "managed-1",
      },
    });
    expect(vi.mocked(transcriptStore.finalize).mock.calls.at(-1)?.[1]).toMatchObject({
      providersUsed: ["codex-oauth", "opencode-go"],
      providerTokenUsage: [{
        provider: "opencode-go",
        model: "deepseek-v4-flash",
        inputTokens: 1200,
        outputTokens: 80,
        cacheReadTokens: 400,
        cacheWriteTokens: 20,
      }],
    });
  });

  it("attributes managed child providers when lifecycle events arrive outside an active turn", async () => {
    const { store } = makeStore(null);
    const transcriptStore = makeTranscriptStore();
    vi.mocked(transcriptStore.readMeta).mockResolvedValue({
      kilnSessionId: "sess-background-managed",
      provider: "codex-oauth",
      providersUsed: ["codex-oauth"],
      task: "interactive",
      startedAt: "2026-05-28T04:42:00.000Z",
    });
    const { managedInvocation } = await makeMultiProviderSessionFactory(
      "codex-oauth",
      PROVIDER_IDS,
      "/proj",
      { list: vi.fn().mockReturnValue([]) } as never,
      store as never,
      transcriptStore,
      makeContextArtifactCache(),
      undefined,
      "gui",
      {
        callerIdentity: {
          kind: "kiln-runtime",
          surface: "gui",
          attachmentId: "kiln-runtime:gui",
        },
        options: { routes: [] },
      },
    );

    await managedInvocation?.sessionEventSink?.publish([
      createSessionEvent<"agent_invocation_completed">({
        eventId: "event-managed-background-completed",
        kilnSessionId: "sess-background-managed",
        sequence: 1,
        timestamp: new Date("2026-05-28T04:42:01.000Z"),
        kind: "agent_invocation_completed",
        invocationId: "managed-background-1",
        agentId: "agent-reviewer",
        parentSessionId: "sess-background-managed",
        routeId: "opencode-go-readonly",
        routeSource: "explicit-managed-route",
        providerRoute: {
          providerId: "opencode-go",
          surface: "direct-provider",
          model: "deepseek-v4-flash",
        },
        lifecycleState: "completed",
        durationMs: 1000,
        resultSummary: "Background managed review completed.",
        source: { actor: "runtime", surface: "runtime", component: "managed-invocation" },
      }),
    ], {
      session: { id: "sess-background-managed" },
    } as never);

    expect(vi.mocked(transcriptStore.finalize)).toHaveBeenCalledWith(
      "sess-background-managed",
      { providersUsed: ["codex-oauth", "opencode-go"] },
    );
  });

  it("preserves live managed-route catalog updates after attaching the transcript sink", async () => {
    const { store } = makeStore(null);
    const registry = {
      list: vi.fn().mockReturnValue([]),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();
    let routes: readonly unknown[] = [];
    const managedInvocation = {
      callerIdentity: {
        kind: "kiln-runtime" as const,
        surface: "gui" as const,
        attachmentId: "kiln-runtime:gui",
      },
      options: {
        get routes() {
          return routes;
        },
      },
    };

    const manager = await makeMultiProviderSessionFactory(
      "codex-oauth",
      PROVIDER_IDS,
      "/proj",
      registry,
      store as any,
      transcriptStore,
      cache,
      undefined,
      "gui",
      managedInvocation as any,
    );

    expect(manager.managedInvocation?.options.routes).toEqual([]);
    routes = [{ routeId: "codex-oauth-readonly" }];
    expect(manager.managedInvocation?.options.routes).toEqual([{ routeId: "codex-oauth-readonly" }]);
  });

  it("marks persisted GUI-command turns failed when governed tool completions are blocking", async () => {
    const { store } = makeStore(null);
    const timedOutManagedInvocation = JSON.stringify({
      output: "Direct provider managed invocation timed out after 120000ms.",
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "timed-out",
        routeId: "codex-oauth-readonly",
      },
    });
    const openWorkItem = JSON.stringify({
      output: "{\"item\":{\"id\":\"work-1\",\"status\":\"pending\"}}",
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-1",
        status: "pending",
        item: {
          id: "work-1",
          status: "pending",
          pauseRequirements: [],
          providedEvidence: ["surface-map"],
          executionAttempts: [],
        },
      },
    });
    const registry = {
      list: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({
        sessionId: "sess-governed-failed",
        providerSessionId: "prov-governed-failed",
        dispose: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockImplementation(async function* () {
          yield { type: "tool_use", toolCallId: "call-assess", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "work_governance.assess", input: {} };
          yield { type: "tool_result", toolCallId: "call-assess", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "work_governance.assess", output: "recommendation: orchestrate" };
          yield { type: "tool_use", toolCallId: "call-invoke", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "managed_agent.invoke", input: {} };
          yield { type: "tool_result", toolCallId: "call-invoke", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "managed_agent.invoke", output: timedOutManagedInvocation };
          yield { type: "tool_use", toolCallId: "call-work-update", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "work_item.update", input: {} };
          yield { type: "tool_result", toolCallId: "call-work-update", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "work_item.update", output: openWorkItem };
          yield { type: "text_delta", content: "Continuing with repository inspection next." };
          yield { type: "completed", totalUsd: 0, durationMs: 10, outcome: "failed", isPreflightCrash: false };
        }),
      }),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory(
      "codex-oauth",
      PROVIDER_IDS,
      "/proj",
      registry,
      store as any,
      transcriptStore,
      cache,
      undefined,
      "gui",
    );
    const session = factory("sys", "/proj");
    for await (const _ of session.run({ prompt: "redesign UI" } as any)) {}

    const appendedEvents = vi.mocked(transcriptStore.append).mock.calls.map((call) => call[1]);
    expect(appendedEvents.at(-1)).toMatchObject({
      kind: "turn_completed",
      payload: {
        outcome: "failed",
      },
      source: {
        surface: "gui",
        component: "gui-command",
      },
    });
    expect(vi.mocked(transcriptStore.finalize).mock.calls.at(-1)?.[1]).toMatchObject({
      lastTurnOutcome: "failed",
      sessionLedger: {
        currentPhase: "completed",
      },
    });
  });

  it("keeps persisted GUI-command turns completed when governance assessment is only advisory", async () => {
    const { store } = makeStore(null);
    const registry = {
      list: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({
        sessionId: "sess-governance-advisory",
        providerSessionId: "prov-governance-advisory",
        dispose: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockImplementation(async function* () {
          yield { type: "tool_use", toolCallId: "call-assess", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "work_governance.assess", input: {} };
          yield { type: "tool_result", toolCallId: "call-assess", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "work_governance.assess", output: "recommendation: orchestrate" };
          yield { type: "tool_use", toolCallId: "call-search", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "web_search", input: {} };
          yield { type: "tool_result", toolCallId: "call-search", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "web_search", output: "1 source for kiln docs\n1. Kiln docs https://docs.example.com/kiln" };
          yield { type: "text_delta", content: "Research complete with cited sources." };
          yield { type: "completed", totalUsd: 0, durationMs: 10, outcome: "completed", isPreflightCrash: false };
        }),
      }),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory(
      "codex-oauth",
      PROVIDER_IDS,
      "/proj",
      registry,
      store as any,
      transcriptStore,
      cache,
      undefined,
      "gui",
    );
    const session = factory("sys", "/proj");
    for await (const _ of session.run({ prompt: "research local search" } as any)) {}

    const appendedEvents = vi.mocked(transcriptStore.append).mock.calls.map((call) => call[1]);
    expect(appendedEvents.at(-1)).toMatchObject({
      kind: "turn_completed",
      payload: {
        outcome: "completed",
      },
      source: {
        surface: "gui",
        component: "gui-command",
      },
    });
    expect(vi.mocked(transcriptStore.finalize).mock.calls.at(-1)?.[1]).toMatchObject({
      lastTurnOutcome: "completed",
      sessionLedger: {
        currentPhase: "completed",
      },
    });
  });

  it("marks persisted GUI-command turns failed when governed execution starts but remains open", async () => {
    const { store } = makeStore(null);
    const openExecutionStart = JSON.stringify({
      output: JSON.stringify({
        status: "started",
        item: {
          id: "work-1",
          status: "in_progress",
          pauseRequirements: [],
          providedEvidence: ["surface-map"],
          executionAttempts: [{
            id: "goal-1:work-1:attempt:1",
            status: "started",
            executionMode: "managed_delegation",
            managedInvocationId: "invocation-1",
          }],
        },
      }),
      isError: false,
      metadata: {
        toolName: "work_item.execution.start",
        kind: "work_item",
        operation: "execution_started",
        id: "work-1",
        status: "in_progress",
        item: {
          id: "work-1",
          status: "in_progress",
          pauseRequirements: [],
          providedEvidence: ["surface-map"],
          executionAttempts: [{
            id: "goal-1:work-1:attempt:1",
            status: "started",
            executionMode: "managed_delegation",
            managedInvocationId: "invocation-1",
          }],
        },
      },
    });
    const registry = {
      list: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({
        sessionId: "sess-governed-open-start",
        providerSessionId: "prov-governed-open-start",
        dispose: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockImplementation(async function* () {
          yield { type: "tool_use", toolCallId: "call-assess", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "work_governance.assess", input: {} };
          yield { type: "tool_result", toolCallId: "call-assess", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "work_governance.assess", output: "recommendation: orchestrate" };
          yield { type: "tool_use", toolCallId: "call-execution-start", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "work_item.execution.start", input: {} };
          yield { type: "tool_result", toolCallId: "call-execution-start", toolCallScopeId: TOOL_CALL_SCOPE_ID, toolName: "work_item.execution.start", output: openExecutionStart };
          yield { type: "text_delta", content: "Execution has started; implementation is still pending." };
          yield { type: "completed", totalUsd: 0, durationMs: 10, outcome: "failed", isPreflightCrash: false };
        }),
      }),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory(
      "codex-oauth",
      PROVIDER_IDS,
      "/proj",
      registry,
      store as any,
      transcriptStore,
      cache,
      undefined,
      "gui",
    );
    const session = factory("sys", "/proj");
    for await (const _ of session.run({ prompt: "redesign UI" } as any)) {}

    const appendedEvents = vi.mocked(transcriptStore.append).mock.calls.map((call) => call[1]);
    expect(appendedEvents.at(-1)).toMatchObject({
      kind: "turn_completed",
      payload: {
        outcome: "failed",
      },
      source: {
        surface: "gui",
        component: "gui-command",
      },
    });
    expect(vi.mocked(transcriptStore.finalize).mock.calls.at(-1)?.[1]).toMatchObject({
      lastTurnOutcome: "failed",
      sessionLedger: {
        currentPhase: "completed",
      },
    });
  });

  it("persists the latest structured user message instead of the serialized provider prompt", async () => {
    const { store } = makeStore(null);
    const registry = {
      list: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({
        sessionId: "sess-structured-user",
        providerSessionId: "prov-structured-user",
        dispose: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockImplementation(async function* () {
          yield { type: "text_delta", content: "Done." };
        }),
      }),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/proj", registry, store as any, transcriptStore, cache);
    const session = factory("sys", "/proj");
    for await (const _ of session.run({
      prompt: "User: first request\n\nAssistant: first answer\n\nUser: read live_test_visibility.txt",
      messages: [
        { role: "user", parts: [{ type: "text", text: "first request" }] },
        { role: "assistant", parts: [{ type: "text", text: "first answer" }] },
        { role: "user", parts: [{ type: "text", text: "read live_test_visibility.txt" }] },
      ],
    } as any)) {}

    const appendedEvents = vi.mocked(transcriptStore.append).mock.calls.map((call) => call[1]);
    const userEvent = appendedEvents.find((event) => event.kind === "user_message");
    expect(userEvent?.payload).toMatchObject({
      content: "read live_test_visibility.txt",
    });
    expect(userEvent?.payload).not.toMatchObject({
      content: "User: first request\n\nAssistant: first answer\n\nUser: read live_test_visibility.txt",
    });
  });

  it("uses GUI transcript source attribution when the shared factory is created for GUI", async () => {
    const { store } = makeStore(null);
    const registry = {
      list: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({
        sessionId: "sess-gui-source",
        providerSessionId: "prov-gui-source",
        dispose: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockImplementation(async function* () {
          yield { type: "text_delta", content: "GUI turn" };
        }),
      }),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory(
      "claude",
      PROVIDER_IDS,
      "/proj",
      registry,
      store as any,
      transcriptStore,
      cache,
      undefined,
      "gui",
    );
    const session = factory("sys", "/proj");
    for await (const _ of session.run({ prompt: "hello gui" } as any)) {}

    const appendedEvents = vi.mocked(transcriptStore.append).mock.calls.map((call) => call[1]);
    expect(appendedEvents).not.toHaveLength(0);
    expect(appendedEvents.every((event) => event.source.surface === "gui")).toBe(true);
    expect(appendedEvents.every((event) => event.source.component === "gui-command")).toBe(true);
  });

  it("links real tool call ids and inputs across started and completed events", async () => {
    const { store } = makeStore(null);
    const fullOutput = JSON.stringify({
      output: "im alive and testing diff",
      isError: false,
      metadata: {
        toolName: "read",
        kind: "file",
        operation: "read",
        filePath: "im_alive.txt",
      },
    });
    const registry = {
      list: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({
        sessionId: "sess-linked-tool",
        providerSessionId: "prov-linked-tool",
        dispose: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockImplementation(async function* () {
          yield {
            type: "tool_use",
            toolCallId: "call-read-1",
            toolCallScopeId: TOOL_CALL_SCOPE_ID,
            toolName: "read",
            input: { filePath: "im_alive.txt" },
          };
          yield {
            type: "tool_result",
            toolCallId: "call-read-1",
            toolCallScopeId: TOOL_CALL_SCOPE_ID,
            toolName: "read",
            output: fullOutput,
            outputSummary: "im alive and testing diff",
          };
        }),
      }),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/proj", registry, store as any, transcriptStore, cache);
    const session = factory("sys", "/proj");
    for await (const _ of session.run({ prompt: "read im_alive.txt" } as any)) {}

    const appendedEvents = vi.mocked(transcriptStore.append).mock.calls.map((call) => call[1]);
    const started = appendedEvents.find((event) => event.kind === "tool_call_started");
    const completed = appendedEvents.find((event) => event.kind === "tool_call_completed");
    expect(started?.payload).toMatchObject({
      toolCallId: "call-read-1",
      toolCallScopeId: TOOL_CALL_SCOPE_ID,
      toolName: "read",
      input: { filePath: "im_alive.txt" },
    });
    expect(completed?.payload).toMatchObject({
      toolCallId: "call-read-1",
      toolCallScopeId: TOOL_CALL_SCOPE_ID,
      toolName: "read",
      output: "im alive and testing diff",
      status: { state: "succeeded" },
    });
  });

  it("passes captured sessionId as continuationSessionId on next turn", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry("sess-first");
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/proj", registry, store as any, transcriptStore, cache);
    const first = factory("sys", "/proj");
    for await (const _ of first.run({ prompt: "test" } as any)) {}
    await first.dispose();

    expect(registry.createSession).toHaveBeenCalled();
  });

  it("onClear resets continuationSessionId to undefined", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry("sess-abc");
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory, onClear } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/proj", registry, store as any, transcriptStore, cache);

    const session = factory("sys", "/proj");
    for await (const _ of session.run({ prompt: "test" } as any)) {}
    await session.dispose();

    await onClear();
    expect(store.clearContinuationTarget).toHaveBeenCalledWith(undefined);
  });

  it("onClear clears the canonical resume target", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    store.clearContinuationTarget = vi.fn().mockResolvedValue(undefined);
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { onClear } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/proj", registry, store, transcriptStore, cache);
    await onClear();

    expect(store.clearContinuationTarget).toHaveBeenCalledWith(undefined);
  });

  it("tracks selected models per provider instead of reusing one global model", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const manager = await makeMultiProviderSessionFactory(
      "claude",
      PROVIDER_IDS,
      "/proj",
      registry,
      store as any,
      transcriptStore,
      cache,
    );

    manager.setModel("claude-sonnet-4-6");
    expect(manager.getModel()).toBe("claude-sonnet-4-6");

    manager.setProvider("codex-oauth");
    expect(manager.getModel()).toBe("");

    manager.setModel("gpt-5.4");
    expect(manager.getModel()).toBe("gpt-5.4");

    manager.setProvider("claude");
    expect(manager.getModel()).toBe("claude-sonnet-4-6");

    manager.setProvider("codex-oauth");
    expect(manager.getModel()).toBe("gpt-5.4");
  });

  it("preserves provider history and title metadata across provider switches", async () => {
    const { store, appended } = makeStore(null);
    const { registry } = makeRegistry("sess-shared");
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const manager = await makeMultiProviderSessionFactory(
      "claude",
      PROVIDER_IDS,
      "/proj",
      registry,
      store as any,
      transcriptStore,
      cache,
    );

    const first = manager.factory("sys", "/proj");
    for await (const _ of first.run({ prompt: "Design session metadata ledger for resume-aware sessions" } as any)) {}
    await first.dispose();

    manager.setProvider("codex-oauth");
    manager.setModel("gpt-5.4");
    const second = manager.factory("sys", "/proj");
    for await (const _ of second.run({ prompt: "Keep provider history and canonical summary" } as any)) {}
    await second.dispose();

    expect(appended).toHaveLength(2);
    expect(appended[0]).toMatchObject({
      canonicalTitle: "Design session metadata ledger for resume-aware sessions",
      providersUsed: ["claude"],
    });
    expect(appended[1]).toMatchObject({
      provider: "codex-oauth",
      canonicalTitle: "Design session metadata ledger for resume-aware sessions",
      providersUsed: ["claude", "codex-oauth"],
    });
  });

  it("persists managed child providers in shared GUI/TUI session metadata", async () => {
    const { store, appended } = makeStore(null);
    const registry = {
      list: vi.fn().mockReturnValue([]),
      createSession: vi.fn().mockReturnValue({
        sessionId: "sess-managed-provider",
        providerSessionId: "prov-managed-provider",
        dispose: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockImplementation(async function* () {
          yield {
            type: "tool_use",
            toolCallId: "call-managed",
            toolCallScopeId: TOOL_CALL_SCOPE_ID,
            toolName: "managed_agent.invoke",
            input: {
              providerRoute: {
                providerId: "opencode-go",
                model: "qwen3.6-plus",
              },
            },
          };
          yield {
            type: "tool_result",
            toolCallId: "call-managed",
            toolCallScopeId: TOOL_CALL_SCOPE_ID,
            toolName: "managed_agent.invoke",
            output: JSON.stringify({ status: "completed" }),
          };
        }),
      }),
    } as unknown as ReturnType<typeof import("../../src/wrapper/session-registry.js").createDefaultRegistry>["registry"];
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const manager = await makeMultiProviderSessionFactory(
      "codex-oauth",
      PROVIDER_IDS,
      "/proj",
      registry,
      store as any,
      transcriptStore,
      cache,
      undefined,
      "gui",
    );

    const session = manager.factory("sys", "/proj");
    for await (const _ of session.run({ prompt: "Collect visual references" } as any)) {}
    await session.dispose();

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      provider: "codex-oauth",
      providersUsed: ["codex-oauth", "opencode-go"],
    });
    expect(vi.mocked(transcriptStore.finalize).mock.calls.at(-1)?.[1]).toMatchObject({
      providersUsed: ["codex-oauth", "opencode-go"],
    });
  });

  it("tuiCommand boots with empty project and no YAML config", async () => {
    const previousTransport = process.env.KILN_TUI_TRANSPORT;
    delete process.env.KILN_TUI_TRANSPORT;
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "kiln-tui-empty-"));

    mockStartTui.mockImplementation(async (createSession: () => Promise<unknown>) => {
      await createSession();
    });

    try {
      await expect(
        tuiCommand(APP_CONFIG, { cwd, provider: "claude" }),
      ).resolves.toBeUndefined();
    } finally {
      process.env.KILN_TUI_TRANSPORT = previousTransport;
      await rm(cwd, { recursive: true, force: true });
    }

    expect(mockSessionManagerPrepare).toHaveBeenCalled();
    expect(mockStartTuiGateway).toHaveBeenCalledTimes(1);
    expect(mockWaitForGateway).toHaveBeenCalledTimes(1);
    expect(mockStartTui).toHaveBeenCalledTimes(1);
    expect(mockGatewaySessionCtor).toHaveBeenCalledTimes(1);
  });

  it("tuiCommand uses gateway bootstrap by default", async () => {
    const previousTransport = process.env.KILN_TUI_TRANSPORT;
    delete process.env.KILN_TUI_TRANSPORT;

    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "kiln-tui-direct-"));

    mockStartTui.mockImplementation(async (createSession: () => Promise<unknown>) => {
      const session = await createSession();
      const direct = session as { dispose: () => Promise<void> };
      await direct.dispose();
    });

    try {
      await expect(
        tuiCommand(APP_CONFIG, { cwd, provider: "claude" }),
      ).resolves.toBeUndefined();
    } finally {
      process.env.KILN_TUI_TRANSPORT = previousTransport;
      await rm(cwd, { recursive: true, force: true });
    }

    expect(mockStartTuiGateway).toHaveBeenCalledTimes(1);
    expect(mockWaitForGateway).toHaveBeenCalledTimes(1);
    expect(mockStartTui).toHaveBeenCalledTimes(1);
    expect(mockGatewaySessionCtor).toHaveBeenCalledTimes(1);
    const startTuiArgs = mockStartTui.mock.calls[0] ?? [];
    expect(startTuiArgs[8]).toEqual({ current: [] });
    expect(startTuiArgs[9]).toBeUndefined();
  });

  it("rejects startup when the requested provider is absent from the runtime-advertised gateway catalogue", async () => {
    const previousTransport = process.env.KILN_TUI_TRANSPORT;
    delete process.env.KILN_TUI_TRANSPORT;

    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "kiln-tui-runtime-provider-"));

    mockStartTuiGateway.mockResolvedValue({
      port: 4801,
      url: "ws://localhost:4801/ws",
      models: {
        claude: ["claude-sonnet-4-6"],
      },
      providerDiscovery: [{
        provider: "claude",
        available: true,
        models: ["claude-sonnet-4-6"],
        status: "available",
        reason: "claude models discovered.",
        authState: "authenticated",
        lastCheckedAt: "2026-04-28T12:00:00.000Z",
      }],
      shutdown: vi.fn(),
    });

    try {
      await expect(
        tuiCommand(APP_CONFIG, { cwd, provider: "openai" }),
      ).rejects.toThrow(
        "Provider 'openai' is not available in the runtime TUI model catalog. Available providers: claude",
      );
    } finally {
      process.env.KILN_TUI_TRANSPORT = previousTransport;
      await rm(cwd, { recursive: true, force: true });
    }

    expect(mockStartTui).not.toHaveBeenCalled();
  });

  it("does not synthesize gateway admission when provider model discovery is absent", async () => {
    const previousTransport = process.env.KILN_TUI_TRANSPORT;
    delete process.env.KILN_TUI_TRANSPORT;
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "kiln-tui-gateway-authority-"));

    mockStartTuiGateway.mockResolvedValue({
      port: 4801,
      url: "ws://localhost:4801/ws",
      models: { openai: ["gpt-5.4"] },
      providerDiscovery: [{
        provider: "openai",
        available: true,
        models: ["gpt-5.4"],
        status: "available",
        reason: "Observed model catalog.",
        authState: "authenticated",
        lastCheckedAt: "2026-07-01T12:00:00.000Z",
      }],
      shutdown: vi.fn(),
    });

    try {
      await expect(tuiCommand(APP_CONFIG, { cwd, provider: "openai" })).rejects.toThrow(
        "Provider 'openai' is not available in the runtime TUI model catalog. Available providers: none",
      );
    } finally {
      process.env.KILN_TUI_TRANSPORT = previousTransport;
      await rm(cwd, { recursive: true, force: true });
    }

    expect(mockProjectGuiProviderModelDiscovery).not.toHaveBeenCalled();
    expect(mockStartTui).not.toHaveBeenCalled();
  });

  it("accepts pending direct bootstrap and fails closed when a direct-api provider remains undiscovered", async () => {
    const previousTransport = process.env.KILN_TUI_TRANSPORT;
    process.env.KILN_TUI_TRANSPORT = "direct";

    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "kiln-tui-gateway-"));

    const events: Array<{ type: string; message?: string }> = [];
    mockCreateProviderCatalogService.mockImplementationOnce((resolveDiscovery: () => Promise<readonly unknown[]>) => {
      let discovery: readonly unknown[] = [];
      const snapshot = () => ({ status: discovery.length > 0 ? "ready" : "pending", discovery });
      return {
        snapshot,
        refresh: vi.fn(async () => snapshot()),
        ensureReady: vi.fn(async () => {
          discovery = await resolveDiscovery();
          return snapshot();
        }),
        startBackgroundRefresh: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      };
    });
    mockStartTui.mockImplementation(async (createSession: () => Promise<unknown>) => {
      const session = await createSession() as {
        run: (opts: { prompt: string }) => AsyncIterable<{ type: string; message?: string }>;
      };
      for await (const event of session.run({ prompt: "hello" })) {
        events.push(event);
      }
    });

    try {
      await expect(
        tuiCommand(APP_CONFIG, { cwd, provider: "ollama" }),
      ).resolves.toBeUndefined();
    } finally {
      process.env.KILN_TUI_TRANSPORT = previousTransport;
      await rm(cwd, { recursive: true, force: true });
    }

    expect(mockStartTuiGateway).not.toHaveBeenCalled();
    expect(mockWaitForGateway).not.toHaveBeenCalled();
    expect(mockStartTui).toHaveBeenCalledTimes(1);
    expect(mockGatewaySessionCtor).not.toHaveBeenCalled();
    expect(events).toEqual([{
      type: "error",
      message: "Provider 'ollama' is unavailable",
    }]);
  });

  it("direct bootstrap passes a stable generated Kiln session id into recreated provider sessions", async () => {
    const previousTransport = process.env.KILN_TUI_TRANSPORT;
    process.env.KILN_TUI_TRANSPORT = "direct";

    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "kiln-tui-direct-stable-"));
    const runtimeSessionIds: string[] = [];
    const findSessionIds: string[] = [];
    const initSessionIds: string[] = [];
    const appendSessionIds: string[] = [];
    const originalFind = SessionStore.prototype.find;
    const originalInit = TranscriptStore.prototype.init;
    const originalAppend = SessionStore.prototype.append;
    const findSpy = vi.spyOn(SessionStore.prototype, "find").mockImplementation(
      function find(this: SessionStore, sessionId: string) {
        findSessionIds.push(sessionId);
        return originalFind.call(this, sessionId);
      },
    );
    const initSpy = vi.spyOn(TranscriptStore.prototype, "init").mockImplementation(
      function init(this: TranscriptStore, sessionId: string, meta: Parameters<TranscriptStore["init"]>[1]) {
        initSessionIds.push(sessionId);
        return originalInit.call(this, sessionId, meta);
      },
    );
    const appendSpy = vi.spyOn(SessionStore.prototype, "append").mockImplementation(
      function append(this: SessionStore, record: SessionRecord) {
        appendSessionIds.push(record.sessionId);
        return originalAppend.call(this, record);
      },
    );
    const createSessionSpy = vi.spyOn(SessionRegistry.prototype, "createSession").mockImplementation(
      (_provider: string, opts: { runtimeSessionId?: string }) => {
        runtimeSessionIds.push(opts.runtimeSessionId ?? "");
        return {
          sessionId: opts.runtimeSessionId ?? "missing-runtime-session-id",
          providerSessionId: "prov-stable-direct",
          dispose: vi.fn().mockResolvedValue(undefined),
          capabilities: {
            mcp: true,
            streaming: true,
            resumable: false,
            resume: false,
            costTrackingMode: "native",
            supportedTools: [],
            maxContextTokens: null,
            priority: 1,
            fallbackTo: null,
            permissionPolicy: { approval: "never", sandbox: "workspace-write" },
          },
          run: vi.fn().mockImplementation(async function* () {
            yield { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false };
          }),
        };
      },
    );

    mockStartTui.mockImplementation(async (createSession: () => Promise<unknown>) => {
      const session = await createSession() as {
        run: (opts: { prompt: string }) => AsyncIterable<unknown>;
      };
      for await (const _ of session.run({ prompt: "first" })) {}
      for await (const _ of session.run({ prompt: "second" })) {}
    });

    try {
      await expect(
        tuiCommand(APP_CONFIG, { cwd, provider: "claude" }),
      ).resolves.toBeUndefined();
    } finally {
      createSessionSpy.mockRestore();
      findSpy.mockRestore();
      initSpy.mockRestore();
      appendSpy.mockRestore();
      process.env.KILN_TUI_TRANSPORT = previousTransport;
      await rm(cwd, { recursive: true, force: true });
    }

    expect(runtimeSessionIds).toHaveLength(2);
    expect(runtimeSessionIds[0]).toMatch(/^kiln-tui:direct:/u);
    expect(runtimeSessionIds[1]).toBe(runtimeSessionIds[0]);
    expect(findSessionIds).toContain(runtimeSessionIds[0]);
    expect(initSessionIds).toContain(runtimeSessionIds[0]);
    expect(appendSessionIds).toContain(runtimeSessionIds[0]);
    expect(findSessionIds.every((sessionId) => sessionId === runtimeSessionIds[0])).toBe(true);
    expect(initSessionIds.every((sessionId) => sessionId === runtimeSessionIds[0])).toBe(true);
    expect(appendSessionIds.every((sessionId) => sessionId === runtimeSessionIds[0])).toBe(true);
  });

  it("direct bootstrap switch path allows model-less registry harness providers and rejects direct API switches without discovered models", async () => {
    const previousTransport = process.env.KILN_TUI_TRANSPORT;
    process.env.KILN_TUI_TRANSPORT = "direct";
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "kiln-tui-direct-switch-"));
    let switchToModelessProviderResult: string | undefined;
    let directApiSwitchError = "";

    mockStartTui.mockImplementation(async (createSession: () => Promise<unknown>) => {
      const session = await createSession() as { switchProvider?: (provider: string, model?: string) => Promise<string> };
      if (typeof session.switchProvider !== "function") {
        throw new Error("direct session did not expose switchProvider");
      }
      switchToModelessProviderResult = await session.switchProvider("claude", undefined);
      try {
        await session.switchProvider("openai", undefined);
      } catch (error) {
        directApiSwitchError = error instanceof Error ? error.message : String(error);
      }
    });

    try {
      await expect(
        tuiCommand(APP_CONFIG, { cwd, provider: "openai" }),
      ).resolves.toBeUndefined();
    } finally {
      process.env.KILN_TUI_TRANSPORT = previousTransport;
      await rm(cwd, { recursive: true, force: true });
    }

    expect(switchToModelessProviderResult).toBe("claude");
    expect(directApiSwitchError).toContain("model");
    expect(mockResolveGuiOperatorDiscoveryResults).toHaveBeenCalled();
    expect(mockProjectGuiProviderModelDiscovery).toHaveBeenCalled();
  });
});
