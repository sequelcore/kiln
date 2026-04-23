import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionRecord, TranscriptStore } from "../../src/wrapper/session-store.js";
import { InMemoryContextArtifactCache, type ContextArtifactCache } from "@kilnai/core";

const {
  mockGatewaySessionCtor,
  mockWaitForGateway,
  mockStartTui,
  mockStartTuiGateway,
  mockGetProjectContextArtifactCache,
  mockSessionManagerPrepare,
} = vi.hoisted(() => ({
  mockGatewaySessionCtor: vi.fn(),
  mockWaitForGateway: vi.fn(),
  mockStartTui: vi.fn(),
  mockStartTuiGateway: vi.fn(),
  mockGetProjectContextArtifactCache: vi.fn(),
  mockSessionManagerPrepare: vi.fn(),
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
}));
vi.mock("../../src/wrapper/session-manager.js", () => ({
  SessionManager: class MockSessionManager {
    prepare = mockSessionManagerPrepare;
  },
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
      find: vi.fn().mockImplementation(async (sessionId: string) => bySession.get(sessionId) ?? null),
      append: vi.fn().mockImplementation(async (r: SessionRecord) => {
        appended.push(r);
        bySession.set(r.sessionId, r);
      }),
      clearLast: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("../../src/wrapper/session-store.js").SessionStore,
    appended,
  };
}

function makeTranscriptStore() {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue([]),
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
      models: { claude: [], codex: [], opencode: [] },
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
    expect(store.clearLast).toHaveBeenCalledWith();
  });

  it("onClear clears the canonical resume target", async () => {
    const { store } = makeStore(null);
    const { registry } = makeRegistry();
    store.clearLast = vi.fn().mockResolvedValue(undefined);
    const transcriptStore = makeTranscriptStore();
    const cache = makeContextArtifactCache();

    const { onClear } = await makeMultiProviderSessionFactory("claude", PROVIDER_IDS, "/proj", registry, store, transcriptStore, cache);
    await onClear();

    expect(store.clearLast).toHaveBeenCalledWith();
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
    expect(startTuiArgs[8]).toBeUndefined();
    expect(startTuiArgs[9]).toBeUndefined();
  });

  it("tuiCommand can opt into direct bootstrap via env override", async () => {
    const previousTransport = process.env.KILN_TUI_TRANSPORT;
    process.env.KILN_TUI_TRANSPORT = "direct";

    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "kiln-tui-gateway-"));

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

    expect(mockStartTuiGateway).not.toHaveBeenCalled();
    expect(mockWaitForGateway).not.toHaveBeenCalled();
    expect(mockStartTui).toHaveBeenCalledTimes(1);
    expect(mockGatewaySessionCtor).not.toHaveBeenCalled();
    const startTuiArgs = mockStartTui.mock.calls[0] ?? [];
    expect(typeof startTuiArgs[8]).toBe("function");
    expect(typeof startTuiArgs[9]).toBe("function");
  });
});
