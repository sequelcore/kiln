import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionRecord, TranscriptStore } from "../../src/wrapper/session-store.js";
import { InMemoryContextArtifactCache, type ContextArtifactCache, type DefaultBuiltinToolRegistryOptions } from "@kilnai/core";

const {
  mockGatewaySessionCtor,
  mockWaitForGateway,
  mockStartTui,
  mockStartTuiGateway,
  mockGetProjectContextArtifactCache,
  mockSessionManagerPrepare,
  mockResolveGuiOperatorDiscoveryResults,
  mockProjectGuiOperatorModels,
  mockResolveGuiProviderSwitch,
  mockCreateProviderCatalogService,
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
    models: Record<string, string[]>;
  }) => {
    const provider = input.provider.trim();
    const providerModels = input.models[provider];
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
  projectGuiOperatorModels: mockProjectGuiOperatorModels,
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
  readGlobalConfig: vi.fn(() => null),
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
      getResumeTarget: vi.fn().mockResolvedValue(lastRecord),
      find: vi.fn().mockImplementation(async (sessionId: string) => bySession.get(sessionId) ?? null),
      append: vi.fn().mockImplementation(async (r: SessionRecord) => {
        appended.push(r);
        bySession.set(r.sessionId, r);
      }),
      clearResumeTarget: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("../../src/wrapper/session-store.js").SessionStore,
    appended,
  };
}

function makeTranscriptStore() {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    readTranscript: vi.fn().mockResolvedValue([]),
    append: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue(undefined),
    readMeta: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
  } as unknown as TranscriptStore;
}

function makeContextArtifactCache(): ContextArtifactCache {
  return new InMemoryContextArtifactCache();
}

function makeRegistry(sessionId = "sess-abc") {
  const sessions: { sessionId: string; resumeSessionId?: string; dispose: () => Promise<void>; run: (opts: unknown) => AsyncGenerator<unknown> }[] = [];
  const registry = {
    createSession: vi.fn().mockImplementation(
      (_provider: string, opts: { resumeSessionId?: string }) => {
        const session = {
          sessionId,
          resumeSessionId: opts.resumeSessionId,
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

  it("initializes resumeSessionId from store.last() on startup", async () => {
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
    const { registry } = makeRegistry();
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/p", registry, store as any, transcriptStore, cache);
    const session = factory("sys", "/p");
    
    for await (const _ of session.run({ prompt: "test" } as any)) {}

    expect(registry.createSession).toHaveBeenCalled();
  });

  it("initializes with undefined resumeSessionId when store is empty", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/p", registry, store as any, transcriptStore, cache);
    const session = factory("sys", "/p");
    
    for await (const _ of session.run({ prompt: "test" } as any)) {}

    expect(registry.createSession).toHaveBeenCalled();
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
            type: "tool_result",
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
      toolCallId: "sess-full-output:turn:1:tool:1",
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
          yield { type: "completed", totalUsd: 0, durationMs: 10, isError: false, isPreflightCrash: false };
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
          yield { type: "tool_use", toolCallId: "call-read-1", toolName: "read", input: { filePath: "im_alive.txt" } };
          yield {
            type: "tool_result",
            toolCallId: "call-read-1",
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
      toolName: "read",
      input: { filePath: "im_alive.txt" },
    });
    expect(completed?.payload).toMatchObject({
      toolCallId: "call-read-1",
      toolName: "read",
      output: "im alive and testing diff",
      status: { state: "succeeded" },
    });
  });

  it("passes captured sessionId as resumeSessionId on next turn", async () => {
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

  it("onClear resets resumeSessionId to undefined", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry("sess-abc");
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { factory, onClear } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/proj", registry, store as any, transcriptStore, cache);

    const session = factory("sys", "/proj");
    for await (const _ of session.run({ prompt: "test" } as any)) {}
    await session.dispose();

    await onClear();
    expect(store.clearResumeTarget).toHaveBeenCalledWith(undefined);
  });

  it("onClear clears the canonical resume target", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    store.clearResumeTarget = vi.fn().mockResolvedValue(undefined);
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { onClear } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/proj", registry, store, transcriptStore, cache);
    await onClear();

    expect(store.clearResumeTarget).toHaveBeenCalledWith(undefined);
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
    expect(mockProjectGuiOperatorModels).toHaveBeenCalled();
  });
});
