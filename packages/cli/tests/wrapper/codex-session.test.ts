import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../../src/wrapper/session-store.js";
import { CodexSession, requiresCodexCliProcessTransport } from "../../src/wrapper/codex-session.js";
import type { CodexSessionConfig } from "../../src/wrapper/codex-session.js";
import type { CodexSdkPort } from "../../src/wrapper/codex-sdk-session.js";
import type { IKilnSession } from "../../src/wrapper/session.js";
import { defineDeliberationLevelId, type ExecutionSessionEvent } from "@kilnai/core";

function permissionWriter(onRequest: (profile: string) => void | Promise<void>) {
  return {
    recordRequested: async (draft: any) => {
      await onRequest(draft.profile);
      return { schema: "kiln.runtime-permission-evidence", version: 2, kind: "requested", harness: draft.harness, sessionDigest: "a".repeat(64), targetId: `${draft.harness}-target`, projectionDigest: "b".repeat(64), effectivePolicyDigest: "c".repeat(64), profile: draft.profile, source: "runtime-request", proof: "inferred", requestedAt: draft.requestedAt.toISOString() } as const;
    },
    recordObserved: async (requested: any, input: any) => ({ ...requested, kind: "observed", requestDigest: "d".repeat(64), source: "runtime-observation", proof: input.proof, observedAt: input.observedAt.toISOString(), verifiedAt: input.observedAt.toISOString() }),
  } as any;
}

vi.mock("@kilnai/core", () => ({
  CODEX_DEFAULT_MODEL: "gpt-5.4",
  defineDeliberationLevelId: (value: string) => value,
  admitDeliberationForExecution: (resolution: { selectedLevel?: string } | undefined) => resolution?.selectedLevel,
  admitCommunicationForExecution: (resolution: {
    responseDetail?: { mechanism?: string; nativeValue?: string };
    interactionProfile?: { mechanism?: string; nativeValue?: string };
  } | undefined) => ({
    ...(resolution?.responseDetail?.mechanism === "native" && resolution.responseDetail.nativeValue
      ? { responseDetail: resolution.responseDetail.nativeValue }
      : {}),
    ...(resolution?.interactionProfile?.mechanism === "native" && resolution.interactionProfile.nativeValue
      ? { interactionProfile: resolution.interactionProfile.nativeValue }
      : {}),
  }),
  renderCommunicationPromptProjection: (resolution: unknown) => resolution
    ? "\n\n--- Kiln Communication Contract ---\nRespond using locale 'es-MX'.\nDo not omit verification."
    : undefined,
  observeStandaloneEffectivePrompt: (input: {
    providerId: string;
    modelId: string;
    communicationResolution?: unknown;
  }) => ({
    providerId: input.providerId,
    modelId: input.modelId,
    communicationResolution: input.communicationResolution,
    evidenceIdentity: "sha256:observation",
  }),
  resolveExecutionIdentity: ({
    configuredProvider,
    configuredModel,
    routedProvider,
    routedModel,
  }: {
    configuredProvider?: string;
    configuredModel?: string;
    routedProvider?: string;
    routedModel?: string;
  }) => {
    const provider = routedProvider ?? configuredProvider;
    const model = routedModel ?? configuredModel;
    if (!provider && !model) return undefined;
    return {
      source: routedProvider || routedModel ? "runtime-routed" : "configured",
      provider,
      model,
    };
  },
  appendExecutionIdentity: (
    basePrompt: string,
    identity?: { source: string; provider?: string; model?: string },
  ) => {
    if (!identity) return basePrompt;
    const lines = ["[KILN EXECUTION IDENTITY]"];
    if (identity.provider) lines.push(`provider: ${identity.provider}`);
    if (identity.model) lines.push(`model: ${identity.model}`);
    lines.push(`source: ${identity.source}`);
    lines.push("If asked about provider/model, use this identity for this turn.");
    const section = lines.join("\n");
    return basePrompt.trim().length > 0 ? `${basePrompt}\n\n${section}` : section;
  },
}));

vi.mock("../../src/config/native-communication-capabilities.js", () => ({
  resolveNativeCommunication: () => ({
    version: "v1",
    requested: { intent: { locale: "es-MX", requiredContent: ["verification"], onUnsupported: "deny" } },
    execution: { provider: "codex", model: "gpt-5.4", surface: "cli" },
    responseDetail: { status: "exact", mechanism: "native", nativeValue: "high" },
    interactionProfile: { status: "translated", mechanism: "native", nativeValue: "pragmatic" },
    semanticLoss: ["translated"],
    identity: "sha256:test",
  }),
}));

const mockSpawn = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const mockResolveNativeCliExecutable = vi.hoisted(() => vi.fn(() => "C:\\Program Files\\Codex\\codex.exe"));
const mockCodexConstructor = vi.hoisted(() => vi.fn());

vi.mock("@openai/codex-sdk", () => ({
  Codex: mockCodexConstructor,
}));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("../../src/wrapper/native-cli-executable.js", () => ({
  resolveNativeCliExecutable: mockResolveNativeCliExecutable,
}));

interface MockProc {
  stdin: { end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  pid: number;
}

interface ProcController {
  proc: MockProc;
  emitLine: (obj: object) => void;
  emitExit: (code: number) => void;
  resolveClose: (code: number) => void;
  resolveExit: (code: number) => void;
  flushExit: (code: number) => void;
}

function makeMockProc(): ProcController {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  let exitHandler: ((code: number) => void) | null = null;
  let closeHandler: ((code: number) => void) | null = null;

  const proc: MockProc = {
    stdin: { end: vi.fn() },
    stdout,
    stderr,
    kill: vi.fn(),
    pid: 12345,
    on: vi.fn((event: string, handler: (code: number) => void) => {
      if (event === "exit") exitHandler = handler;
      if (event === "close") closeHandler = handler;
      return proc;
    }),
    once: vi.fn((event: string, handler: (code: number) => void) => {
      if (event === "exit") exitHandler = handler;
      if (event === "close") closeHandler = handler;
      return proc;
    }),
  };

  return {
    proc,
    emitLine: (obj: object) => {
      stdout.emit("data", Buffer.from(JSON.stringify(obj) + "\n"));
    },
    emitExit: (code: number) => {
      exitHandler?.(code);
    },
    resolveClose: (code: number) => {
      stdout.emit("end");
      stderr.emit("end");
      closeHandler?.(code);
    },
    resolveExit: (code: number) => {
      exitHandler?.(code);
      stdout.emit("end");
      stderr.emit("end");
      closeHandler?.(code);
    },
    flushExit: (code: number) => {
      exitHandler?.(code);
      closeHandler?.(code);
    },
  };
}

async function collectEvents(iter: AsyncIterable<ExecutionSessionEvent>): Promise<ExecutionSessionEvent[]> {
  const events: ExecutionSessionEvent[] = [];
  for await (const e of iter) events.push(e);
  return events;
}

function baseConfig(overrides: Partial<CodexSessionConfig> = {}): CodexSessionConfig {
  return {
    task: "Fix the login bug",
    cwd: process.cwd(),
    // Existing process-transport characterization tests name their required
    // capability explicitly. Normal SDK behavior has dedicated tests below.
    ephemeral: true,
    ...overrides,
  };
}

function sdkPort(events: readonly object[], calls: { readonly start: ReturnType<typeof vi.fn>; readonly resume: ReturnType<typeof vi.fn>; readonly run: ReturnType<typeof vi.fn> }): CodexSdkPort {
  const thread = {
    id: null,
    runStreamed: calls.run.mockResolvedValue({ events: (async function* () { for (const event of events) yield event; })() }),
  };
  calls.start.mockReturnValue(thread);
  calls.resume.mockReturnValue(thread);
  return { startThread: calls.start, resumeThread: calls.resume };
}

describe("CodexSession implements IKilnSession", () => {
  beforeEach(() => {
    mockCodexConstructor.mockReset();
  });

  it("uses the official SDK port for normal sessions and never spawns the CLI transport", async () => {
    const calls = { start: vi.fn(), resume: vi.fn(), run: vi.fn() };
    const events = await collectEvents(new CodexSession(baseConfig({
      ephemeral: false,
      sdkPort: sdkPort([
        { type: "thread.started", thread_id: "sdk-thread" },
        { type: "turn.started" },
        { type: "item.completed", item: { id: "message", type: "agent_message", text: "Done" } },
        { type: "turn.completed", usage: { input_tokens: 7, cached_input_tokens: 2, cache_write_input_tokens: 0, output_tokens: 3, reasoning_output_tokens: 0 } },
      ], calls),
    })).run({ prompt: "test" }));
    expect(calls.start).toHaveBeenCalledOnce();
    expect(calls.run).toHaveBeenCalledOnce();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: "text_delta", content: "Done" });
    expect(events).toContainEqual(expect.objectContaining({ type: "cost_update", inputTokens: 7, outputTokens: 3 }));
  });

  it("keeps SDK error items non-fatal when the turn completes", async () => {
    const calls = { start: vi.fn(), resume: vi.fn(), run: vi.fn() };
    const events = await collectEvents(new CodexSession(baseConfig({
      ephemeral: false,
      sdkPort: sdkPort([
        { type: "thread.started", thread_id: "sdk-thread" },
        { type: "turn.started" },
        { type: "item.completed", item: { id: "notice", type: "error", message: "Skills were shortened." } },
        { type: "item.completed", item: { id: "message", type: "agent_message", text: "Done" } },
        { type: "turn.completed", usage: { input_tokens: 7, cached_input_tokens: 2, cache_write_input_tokens: 0, output_tokens: 3, reasoning_output_tokens: 0 } },
      ], calls),
    })).run({ prompt: "test" }));

    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", outcome: "completed" }));
  });

  it("projects per-run communication through the official SDK config, prompt, and router evidence", async () => {
    const calls = { start: vi.fn(), resume: vi.fn(), run: vi.fn() };
    const port = sdkPort([
      { type: "thread.started", thread_id: "sdk-communication-thread" },
      { type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } },
    ], calls);
    let codexOptions: Record<string, unknown> | undefined;
    mockCodexConstructor.mockImplementationOnce(function (options: Record<string, unknown>) {
      codexOptions = options;
      return port;
    });
    const session = new CodexSession(baseConfig({ ephemeral: false }));

    await collectEvents(session.run({
      prompt: "test",
      communicationIntent: { version: "v1" } as CodexSessionConfig["communicationIntent"],
    }));

    expect(codexOptions).toMatchObject({
      config: { model_verbosity: "high", personality: "pragmatic" },
    });
    expect(codexOptions).not.toHaveProperty("codexPathOverride");
    expect(calls.run).toHaveBeenCalledWith(
      expect.stringContaining("Respond using locale 'es-MX'"),
      expect.any(Object),
    );
    expect(session.communicationResolution).toMatchObject({
      responseDetail: { mechanism: "native", nativeValue: "high" },
      interactionProfile: { mechanism: "native", nativeValue: "pragmatic" },
    });
    expect(session.effectivePromptObservation).toMatchObject({
      providerId: "codex",
      modelId: "gpt-5.4",
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("records runtime permission evidence before the first SDK effect and blocks it when evidence fails", async () => {
    const calls = { start: vi.fn(), resume: vi.fn(), run: vi.fn() };
    const order: string[] = [];
    calls.start.mockImplementation(() => { order.push("sdk"); return { id: null, runStreamed: calls.run }; });
    const port: CodexSdkPort = { startThread: calls.start, resumeThread: calls.resume };
    await collectEvents(new CodexSession(baseConfig({ ephemeral: false, sdkPort: port, runtimePermissionObservationSink: permissionWriter(() => { order.push("sink"); }) })).run({ prompt: "test" }));
    expect(order).toEqual(["sink", "sdk"]);
    const blocked = { start: vi.fn(), resume: vi.fn() };
    await expect(collectEvents(new CodexSession(baseConfig({ ephemeral: false, sdkPort: blocked as CodexSdkPort, runtimePermissionObservationSink: permissionWriter(() => { throw new Error("evidence unavailable"); }) })).run({ prompt: "test" }))).rejects.toThrow("evidence unavailable");
    expect(blocked.start).not.toHaveBeenCalled();
  });

  it("passes only official SDK thread and turn options for normal execution", async () => {
    const calls = { start: vi.fn(), resume: vi.fn(), run: vi.fn() };
    const directory = await mkdtemp(join(tmpdir(), "kiln-sdk-schema-"));
    const schema = join(directory, "result.json");
    await writeFile(schema, JSON.stringify({ type: "object", properties: { answer: { type: "string" } } }), "utf8");
    const port = sdkPort([{ type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } }], calls);
    const controller = new AbortController();
    await collectEvents(new CodexSession(baseConfig({ ephemeral: false, model: "gpt-5.6-sol", sandboxMode: "workspace-write", approvalMode: "never", addDir: "C:/shared", outputSchema: schema, deliberationResolution: { selectedLevel: defineDeliberationLevelId("high") }, sdkPort: port })).run({ prompt: "test", abortSignal: controller.signal }));
    expect(calls.start).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-sol", sandboxMode: "workspace-write", approvalPolicy: "never", workingDirectory: process.cwd(), additionalDirectories: ["C:/shared"], modelReasoningEffort: "high" }));
    expect(calls.run).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ outputSchema: { type: "object", properties: { answer: { type: "string" } } }, signal: expect.any(AbortSignal) }));
  });

  it("rejects malformed output schema before the SDK effect", async () => {
    const calls = { start: vi.fn(), resume: vi.fn(), run: vi.fn() };
    const directory = await mkdtemp(join(tmpdir(), "kiln-sdk-invalid-schema-"));
    const schema = join(directory, "invalid.json");
    await writeFile(schema, "not-json", "utf8");
    await collectEvents(new CodexSession(baseConfig({ ephemeral: false, outputSchema: schema, sdkPort: sdkPort([], calls) })).run({ prompt: "test" }));
    expect(calls.start).toHaveBeenCalledOnce();
    expect(calls.run).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("routes only SDK-unrepresentable public switches to explicit CLI transport", () => {
    expect(requiresCodexCliProcessTransport({ ephemeral: true })).toBe(true);
    expect(requiresCodexCliProcessTransport({ profile: "operator" })).toBe(true);
    expect(requiresCodexCliProcessTransport({ localProvider: "ollama" })).toBe(true);
    expect(requiresCodexCliProcessTransport({ outputSchema: "schema.json" })).toBe(false);
  });

  it("relays caller abort to the official SDK turn signal", async () => {
    let sdkSignal: AbortSignal | undefined;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const port: CodexSdkPort = {
      startThread: () => ({ id: null, runStreamed: async (_input, options) => { sdkSignal = options?.signal; return { events: (async function* () { await pending; yield { type: "turn.completed" as const, usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } }; })() }; } }),
      resumeThread: () => { throw new Error("unexpected resume"); },
    };
    const controller = new AbortController();
    const collecting = collectEvents(new CodexSession(baseConfig({ ephemeral: false, sdkPort: port })).run({ prompt: "test", abortSignal: controller.signal }));
    await vi.waitFor(() => expect(sdkSignal).toBeDefined());
    controller.abort();
    expect(sdkSignal?.aborted).toBe(true);
    release();
    await collecting;
  });

  it("starts a fresh official SDK thread when no stored provider thread exists", async () => {
    const calls = { start: vi.fn(), resume: vi.fn(), run: vi.fn() };
    const port = sdkPort([{ type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } }], calls);
    const session = new CodexSession(baseConfig({ ephemeral: false, sdkPort: port }));
    await collectEvents(session.run({ prompt: "test" }));
    expect(calls.start).toHaveBeenCalledOnce();
    expect(calls.resume).not.toHaveBeenCalled();
  });

  it("resumes the exact stored provider thread through the official SDK and exposes its started identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kiln-sdk-resume-"));
    await new SessionStore(directory).append({ sessionId: "prior-kiln-session", provider: "codex", task: "prior", completedAt: new Date().toISOString(), cost: 0, projectPath: directory, providerThread: { provider: "codex", nativeSessionId: "codex-thread-42" } });
    const calls = { start: vi.fn(), resume: vi.fn(), run: vi.fn() };
    const port = sdkPort([{ type: "thread.started", thread_id: "codex-thread-42" }, { type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } }], calls);
    const session = new CodexSession(baseConfig({ ephemeral: false, cwd: directory, continuationSessionId: "prior-kiln-session", sdkPort: port }));
    await collectEvents(session.run({ prompt: "continue" }));
    expect(calls.resume).toHaveBeenCalledWith("codex-thread-42", expect.any(Object));
    expect(calls.start).not.toHaveBeenCalled();
    expect(session.providerSessionId).toBe("codex-thread-42");
  });

  it("settles a successful SDK turn once so its provider thread can continue", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kiln-sdk-success-ledger-"));
    const firstCalls = { start: vi.fn(), resume: vi.fn(), run: vi.fn() };
    const firstPort = sdkPort([
      { type: "thread.started", thread_id: "codex-success-thread" },
      { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } },
    ], firstCalls);
    await collectEvents(new CodexSession(baseConfig({ ephemeral: false, runtimeSessionId: "successful-sdk-session", cwd: directory, sdkPort: firstPort })).run({ prompt: "start" }));
    expect(await new SessionStore(directory).findProviderThread("successful-sdk-session", "codex")).toEqual({ provider: "codex", nativeSessionId: "codex-success-thread" });

    const resumedCalls = { start: vi.fn(), resume: vi.fn(), run: vi.fn() };
    const resumedPort = sdkPort([{ type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } }], resumedCalls);
    await collectEvents(new CodexSession(baseConfig({ ephemeral: false, cwd: directory, continuationSessionId: "successful-sdk-session", sdkPort: resumedPort })).run({ prompt: "continue" }));
    expect(resumedCalls.resume).toHaveBeenCalledWith("codex-success-thread", expect.any(Object));
    expect(resumedCalls.start).not.toHaveBeenCalled();
  });

  it("does not write the successful SDK ledger when the host owns it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kiln-sdk-host-ledger-"));
    const calls = { start: vi.fn(), resume: vi.fn(), run: vi.fn() };
    await collectEvents(new CodexSession(baseConfig({ ephemeral: false, runtimeSessionId: "host-owned-sdk-session", cwd: directory, sessionLedgerOwner: "host", sdkPort: sdkPort([
      { type: "thread.started", thread_id: "host-owned-thread" },
      { type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } },
    ], calls) })).run({ prompt: "start" }));
    expect(await new SessionStore(directory).findProviderThread("host-owned-sdk-session", "codex")).toBeUndefined();
  });
  it("records exact spawn permission args immediately before spawn and blocks spawn on sink failure", async () => {
    const order: string[] = [];
    const { proc, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockImplementationOnce(() => {
      order.push("spawn");
      return proc;
    });
    const session = new CodexSession(baseConfig({
      approvalMode: "never",
      sandboxMode: "workspace-write",
      runtimePermissionObservationSink: permissionWriter((profile) => { order.push(`sink:${profile}`); }),
    }));
    const next = session.run({ prompt: "test" }).next();
    await vi.waitFor(() => expect(order).toEqual(["sink:workspace-write", "spawn"]));
    resolveExit(0);
    await next.catch(() => undefined);

    const spawnCount = mockSpawn.mock.calls.length;
    await expect(collectEvents(new CodexSession(baseConfig({
      runtimePermissionObservationSink: permissionWriter(() => { throw new Error("evidence unavailable"); }),
    })).run({ prompt: "test" }))).rejects.toThrow("evidence unavailable");
    expect(mockSpawn).toHaveBeenCalledTimes(spawnCount);
  });

  it("declares implements IKilnSession", () => {
    const session: IKilnSession = new CodexSession(baseConfig());
    expect(session).toBeDefined();
  });

  it("sessionId is a non-empty UUID string", () => {
    const session = new CodexSession(baseConfig());
    expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("sessionId is unique per instance", () => {
    const a = new CodexSession(baseConfig());
    const b = new CodexSession(baseConfig());
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("uses configured runtime session identity", () => {
    const session = new CodexSession(baseConfig({ runtimeSessionId: "kiln-tui:codex:session-1" }));
    expect(session.sessionId).toBe("kiln-tui:codex:session-1");
  });

  it("capabilities.mcp is false", () => {
    const session = new CodexSession(baseConfig());
    expect(session.capabilities.mcp).toBe(false);
  });

  it("capabilities.streaming is true", () => {
    const session = new CodexSession(baseConfig());
    expect(session.capabilities.streaming).toBe(true);
  });

  it("capabilities.resume is false", () => {
    const session = new CodexSession(baseConfig());
    expect(session.capabilities.resume).toBe(false);
  });

  it("capabilities.costTrackingMode is computed", () => {
    const session = new CodexSession(baseConfig());
    expect(session.capabilities.costTrackingMode).toBe("computed");
  });

  it("capabilities.maxContextTokens is null", () => {
    const session = new CodexSession(baseConfig());
    expect(session.capabilities.maxContextTokens).toBeNull();
  });

  it("capabilities.priority is 3", () => {
    const session = new CodexSession(baseConfig());
    expect(session.capabilities.priority).toBe(3);
  });

  it("capabilities.fallbackTo is null", () => {
    const session = new CodexSession(baseConfig());
    expect(session.capabilities.fallbackTo).toBeNull();
  });

  it("dispose resolves without error", async () => {
    const session = new CodexSession(baseConfig());
    await expect(session.dispose()).resolves.toBeUndefined();
  });

  it("dispose is idempotent", async () => {
    const session = new CodexSession(baseConfig());
    await session.dispose();
    await expect(session.dispose()).resolves.toBeUndefined();
  });

  it("launches the resolved native Codex executable", async () => {
    const { proc, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const run = session.run({ prompt: "test" });
    const next = run.next();

    expect(mockSpawn).toHaveBeenCalledWith(
      "C:\\Program Files\\Codex\\codex.exe",
      expect.arrayContaining(["exec"]),
      expect.objectContaining({ cwd: baseConfig().cwd }),
    );

    resolveExit(0);
    await next.catch(() => undefined);
    await session.dispose();
  });
});

describe("CodexSession.run() JSONL parsing", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("projects a resolved communication intent into invocation-scoped Codex controls", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    const session = new CodexSession(baseConfig({
      communicationIntent: { version: "v1" } as CodexSessionConfig["communicationIntent"],
    }));
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
    resolveExit(0);
    await collectPromise;

    const args = vi.mocked(mockSpawn).mock.calls[0]?.[1] as string[];
    expect(args).toContain("model_verbosity=\"high\"");
    expect(args).toContain("personality=\"pragmatic\"");
    expect(proc.stdin.end).toHaveBeenCalledWith(expect.stringContaining("Respond using locale 'es-MX'"));
    expect(proc.stdin.end).toHaveBeenCalledWith(expect.stringContaining("Do not omit verification"));
    expect(session.communicationResolution).toMatchObject({
      responseDetail: { status: "exact", mechanism: "native" },
      interactionProfile: { status: "translated", mechanism: "native" },
      semanticLoss: ["translated"],
    });
  });

  it("run() deterministically appends constraintInstructions to the prompt sent to codex", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({
      constraintInstructions: [
        "Kiln policy constraints for codex:",
        "[data-firewall] DENY logs",
      ],
    }));
    const collectPromise = collectEvents(session.run({ prompt: "Implement feature X" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await collectPromise;

    const spawnCall = vi.mocked(mockSpawn).mock.calls[0];
    const spawnArgs = spawnCall?.[1] as string[] | undefined;
    expect(spawnArgs).toBeDefined();
    expect(spawnArgs?.[spawnArgs.length - 1]).toBe("-");
    expect(proc.stdin.end).toHaveBeenCalledWith(expect.stringContaining("Implement feature X"));
    expect(proc.stdin.end).toHaveBeenCalledWith(expect.stringContaining("[KILN EXECUTION IDENTITY]"));
    expect(proc.stdin.end).toHaveBeenCalledWith(expect.stringContaining("provider: codex"));
    expect(proc.stdin.end).toHaveBeenCalledWith(expect.stringContaining("model: gpt-5.4"));
    expect(proc.stdin.end).toHaveBeenCalledWith(expect.stringContaining("Kiln policy constraints for codex:"));
    expect(proc.stdin.end).toHaveBeenCalledWith(expect.stringContaining("[data-firewall] DENY logs"));
  });

  it("run() appends prepared system context after the governed turn prompt", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({
      prompt: "<kiln-preamble><task>inspect</task></kiln-preamble>",
      system: "## Operator Identity\n- Operator name: Alex",
    }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
    resolveExit(0);

    await collectPromise;

    const spawnArgs = vi.mocked(mockSpawn).mock.calls[0]?.[1] as string[] | undefined;
    const prompt = vi.mocked(proc.stdin.end).mock.calls[0]?.[0] as string;
    expect(prompt.indexOf("<kiln-preamble>")).toBeLessThan(prompt.indexOf("## Operator Identity"));
    expect(prompt).toContain("## Operator Identity");
    expect(prompt).toContain("- Operator name: Alex");
    expect(prompt).toContain("--- Kiln Prepared System Context ---");
    expect(prompt).toContain("<kiln-preamble>");
    expect(prompt).toContain("--- Kiln Task To Execute Now ---");
    expect(prompt).toContain("inspect");
    expect(prompt).toContain("Execute the task above in this turn.");
  });

  // Regression for #59: application/run-session.ts used to forward a stale
  // prepared systemPrompt (built before the real per-turn permission policy
  // was known) as `options.system`. CodexSession concatenated it back onto
  // the governed turn prompt via appendPreparedSystemContext, reintroducing
  // content the current policy had already excluded. The CLI call site no
  // longer sets `system`; when absent, the governed prompt must reach codex
  // unmodified.
  it("run() does not reintroduce excluded content when the CLI turn omits an explicit system override", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const excludedMarker = "KILN_TEST_MARKER_STALE_MEMORY_7f3a1c";
    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({
      prompt: "<kiln-preamble><task>inspect</task></kiln-preamble>",
    }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
    resolveExit(0);

    await collectPromise;

    const prompt = vi.mocked(proc.stdin.end).mock.calls[0]?.[0] as string;
    expect(prompt).not.toContain(excludedMarker);
    expect(prompt).not.toContain("--- Kiln Prepared System Context ---");
    expect(prompt).toContain("<kiln-preamble>");
  });

  it("run() passes an admitted deliberation level as a Codex config override", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({
      deliberationResolution: {
        status: "exact",
        source: "operator",
        selectedLevel: defineDeliberationLevelId("high"),
      },
    }));
    const collectPromise = collectEvents(session.run({ prompt: "Implement feature X" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
    resolveExit(0);

    await collectPromise;

    const spawnArgs = vi.mocked(mockSpawn).mock.calls[0]?.[1] as string[] | undefined;
    expect(spawnArgs).toContain("-c");
    expect(spawnArgs).toContain("model_reasoning_effort=high");
  });

  it("run() passes explicit approval config and sandbox args instead of relying on full-auto", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({
      approvalMode: "untrusted",
      sandboxMode: "read-only",
    }));
    const collectPromise = collectEvents(session.run({ prompt: "Inspect the repo" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await collectPromise;

    const spawnCall = vi.mocked(mockSpawn).mock.calls[0];
    const spawnArgs = spawnCall?.[1] as string[] | undefined;
    expect(spawnArgs).toBeDefined();
    expect(spawnArgs).not.toContain("--full-auto");
    expect(spawnArgs).toContain("-c");
    expect(spawnArgs).toContain("approval_policy=untrusted");
    expect(spawnArgs).toContain("--sandbox");
    expect(spawnArgs).toContain("read-only");
    expect(spawnArgs).toContain("-C");
    expect(spawnArgs).not.toContain("--cd");
  });

  it("run() passes configured model to codex CLI via -m", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({
      model: "gpt-5.3-codex",
    }));
    const collectPromise = collectEvents(session.run({ prompt: "Inspect the repo" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await collectPromise;

    const spawnCall = vi.mocked(mockSpawn).mock.calls[0];
    const spawnArgs = spawnCall?.[1] as string[] | undefined;
    expect(spawnArgs).toBeDefined();
    const modelFlagIndex = spawnArgs?.indexOf("-m");
    expect(modelFlagIndex).toBeGreaterThanOrEqual(0);
    expect(spawnArgs?.[modelFlagIndex! + 1]).toBe("gpt-5.3-codex");
  });

  it("run() uses CODEX_MODEL env override for identity without forcing -m", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({
      prompt: "Inspect the repo",
      env: {
        CODEX_MODEL: "experimental-model-alpha",
        FOO: "bar",
      },
    }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await collectPromise;

    const spawnCall = vi.mocked(mockSpawn).mock.calls[0];
    const spawnArgs = spawnCall?.[1] as string[] | undefined;
    const spawnOptions = spawnCall?.[2] as { env?: Record<string, string> } | undefined;
    expect(spawnArgs).toBeDefined();
    expect(spawnArgs).not.toContain("-m");
    const prompt = vi.mocked(proc.stdin.end).mock.calls[0]?.[0] as string;
    expect(prompt).toContain("model: experimental-model-alpha");
    expect(spawnOptions?.env?.CODEX_MODEL).toBeUndefined();
    expect(spawnOptions?.env?.FOO).toBe("bar");
  });

  it("run() appends --ephemeral when configured", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({
      ephemeral: true,
    }));
    const collectPromise = collectEvents(session.run({ prompt: "Inspect the repo" }));

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce());

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await collectPromise;

    const spawnCall = vi.mocked(mockSpawn).mock.calls[0];
    const spawnArgs = spawnCall?.[1] as string[] | undefined;
    expect(spawnArgs).toBeDefined();
    expect(spawnArgs).toContain("--ephemeral");
  });

  it("bounds explicit CLI transport stderr in its terminal error", async () => {
    const { proc, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    const collectPromise = collectEvents(new CodexSession(baseConfig({ ephemeral: true })).run({ prompt: "test" }));
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce());
    proc.stderr.emit("data", Buffer.from("x".repeat(9000)));
    resolveExit(1);
    const events = await collectPromise;
    const error = events.find((event) => event.type === "error");
    expect(error).toMatchObject({ type: "error" });
    expect((error as { message: string }).message.length).toBeLessThanOrEqual(4099);
  });

  it("run() appends --profile with the configured profile name", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({
      profile: "fast-lane",
    }));
    const collectPromise = collectEvents(session.run({ prompt: "Inspect the repo" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await collectPromise;

    const spawnCall = vi.mocked(mockSpawn).mock.calls[0];
    const spawnArgs = spawnCall?.[1] as string[] | undefined;
    expect(spawnArgs).toBeDefined();
    const profileIndex = spawnArgs?.indexOf("--profile");
    expect(profileIndex).toBeGreaterThanOrEqual(0);
    expect(spawnArgs?.[profileIndex! + 1]).toBe("fast-lane");
  });

  it("run() appends --skip-git-repo-check when configured", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({
      skipGitRepoCheck: true,
    }));
    const collectPromise = collectEvents(session.run({ prompt: "Inspect the repo" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await collectPromise;

    const spawnCall = vi.mocked(mockSpawn).mock.calls[0];
    const spawnArgs = spawnCall?.[1] as string[] | undefined;
    expect(spawnArgs).toBeDefined();
    expect(spawnArgs).toContain("--skip-git-repo-check");
  });

  it("run() appends --output-schema with configured file path", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({
      outputSchema: ".kiln/schemas/result.json",
    }));
    const collectPromise = collectEvents(session.run({ prompt: "Inspect the repo" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await collectPromise;

    const spawnCall = vi.mocked(mockSpawn).mock.calls[0];
    const spawnArgs = spawnCall?.[1] as string[] | undefined;
    expect(spawnArgs).toBeDefined();
    const schemaFlagIndex = spawnArgs?.indexOf("--output-schema");
    expect(schemaFlagIndex).toBeGreaterThanOrEqual(0);
    expect(spawnArgs?.[schemaFlagIndex! + 1]).toBe(".kiln/schemas/result.json");
  });

  it("run() appends --add-dir with configured path", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({
      addDir: "C:/workspace/shared",
    }));
    const collectPromise = collectEvents(session.run({ prompt: "Inspect the repo" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await collectPromise;

    const spawnCall = vi.mocked(mockSpawn).mock.calls[0];
    const spawnArgs = spawnCall?.[1] as string[] | undefined;
    expect(spawnArgs).toBeDefined();
    const addDirIndex = spawnArgs?.indexOf("--add-dir");
    expect(addDirIndex).toBeGreaterThanOrEqual(0);
    expect(spawnArgs?.[addDirIndex! + 1]).toBe("C:/workspace/shared");
  });

  it("run() appends --local-provider with configured provider name", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({
      localProvider: "ollama",
    }));
    const collectPromise = collectEvents(session.run({ prompt: "Inspect the repo" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await collectPromise;

    const spawnCall = vi.mocked(mockSpawn).mock.calls[0];
    const spawnArgs = spawnCall?.[1] as string[] | undefined;
    expect(spawnArgs).toBeDefined();
    const localProviderIndex = spawnArgs?.indexOf("--local-provider");
    expect(localProviderIndex).toBeGreaterThanOrEqual(0);
    expect(spawnArgs?.[localProviderIndex! + 1]).toBe("ollama");
  });

  it("run() yields text_delta for agent_message item", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "Hello!" } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 500 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toContainEqual({ type: "text_delta", content: "Hello!" });
  });

  it("run() yields tool_use + tool_result for command_execution item", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i2", type: "command_execution", command: "echo hello", exit_code: 0, aggregated_output: "hello\n" } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 500, cached_input_tokens: 0, output_tokens: 100 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_use", toolName: "bash", input: { command: "echo hello" } }));
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_result", toolName: "bash", output: "hello\n" }));
  });

  it("run() maps completed Codex file_change items to provider-neutral file_changed events", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({ cwd: "C:\\tmp\\kiln-codex-live" }));
    const collectPromise = collectEvents(session.run({ prompt: "test", cwd: "C:\\tmp\\kiln-codex-live" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({
      type: "item.completed",
      item: {
        id: "patch-1",
        type: "file_change",
        changes: [
          { path: "added.txt", kind: "add" },
          { path: "deleted.txt", kind: "delete" },
          { path: "modified.txt", kind: "update" },
        ],
        status: "completed",
      },
    });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;

    expect(events).toContainEqual(expect.objectContaining({
      type: "file_changed",
      path: expect.stringContaining("added.txt"),
      changeType: "created",
      diffTruncated: true,
    }));
    expect(events).toContainEqual({
      type: "file_changed",
      path: expect.stringContaining("deleted.txt"),
      changeType: "deleted",
      diffTruncated: true,
    });
    expect(events).toContainEqual({
      type: "file_changed",
      path: expect.stringContaining("modified.txt"),
      changeType: "modified",
      diffTruncated: true,
    });
  });

  it("run() maps failed Codex file_change items to provider-neutral write denials without accepted file changes", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({
      type: "item.completed",
      item: {
        id: "patch-denied-1",
        type: "file_change",
        changes: [{ path: "proof.txt", kind: "update" }],
        status: "failed",
      },
    });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;

    expect(events).toContainEqual({
      type: "write_decision",
      status: "denied",
      providerRequestId: "patch-denied-1",
      actor: "codex-policy",
      reason: "Codex file change was not applied",
    });
    expect(events.some((event) => event.type === "file_changed")).toBe(false);
  });

  it("run() yields tool_use for mcp_tool_call item", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i3", type: "mcp_tool_call", tool: "memory_store", arguments: { key: "test", value: "42" } } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 200, cached_input_tokens: 0, output_tokens: 50 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool_use",
      toolName: "memory_store",
      input: { key: "test", value: "42" },
      source: "mcp",
      mcpSelector: "memory_store",
    }));
  });

  it("run() emits reasoning items as text_delta with isThinking flag", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i4", type: "reasoning", text: "Let me think..." } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toContainEqual(expect.objectContaining({ type: "text_delta", content: "Let me think...", isThinking: true }));
  });

  it("run() emits tool_use for item.started events", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.started", item: { id: "i5", type: "command_execution", command: "ls" } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 10 } });
    resolveExit(0);

    const events = await collectPromise;
    const toolUse = events.find((e) => e.type === "tool_use");
    expect(toolUse).toBeDefined();
    expect((toolUse as { toolName: string }).toolName).toBe("bash");
  });

  it.each([
    { type: "mcp_tool_call", tool: "memory_store", arguments: { key: "k" }, result: { stored: true }, expectedTool: "memory_store" },
    { type: "collab_tool_call", arguments: { task: "review" }, result: "reviewed", expectedTool: "collab_tool_call" },
    { type: "web_search", query: "Kiln docs", result: ["https://example.test/kiln"], expectedTool: "web_search" },
  ])("pairs started and completed $type items exactly once", async (fixture) => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test", kilnSessionId: "session-tools", turnId: "turn-1" }));
    const item = { id: `item-${fixture.type}`, ...fixture };

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.started", item });
    emitLine({ type: "item.completed", item });
    emitLine({ type: "turn.completed", usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 10 } });
    resolveExit(0);

    const events = (await collectPromise).filter((event) => event.type === "tool_use" || event.type === "tool_result");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "tool_use", toolCallId: `item-${fixture.type}`, toolName: fixture.expectedTool });
    expect(events[1]).toMatchObject({ type: "tool_result", toolCallId: `item-${fixture.type}`, toolName: fixture.expectedTool });
  });

  it("synthesizes a paired MCP start when item.completed is the first observation", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test", kilnSessionId: "session-tools", turnId: "turn-2" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "mcp-completed-only", type: "mcp_tool_call", tool: "memory_store", arguments: { key: "k" }, result: "ok" } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 10 } });
    resolveExit(0);

    const events = (await collectPromise).filter((event) => event.type === "tool_use" || event.type === "tool_result");
    expect(events).toEqual([
      expect.objectContaining({ type: "tool_use", toolCallId: "mcp-completed-only", toolName: "memory_store" }),
      expect.objectContaining({ type: "tool_result", toolCallId: "mcp-completed-only", toolName: "memory_store", output: "ok" }),
    ]);
  });

  it("de-duplicates started/completed command notifications and preserves the Codex item id", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({
      prompt: "test",
      kilnSessionId: "session-scope",
      turnId: "turn-2",
    }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.started", item: { id: "item-command-1", type: "command_execution", command: "pwd" } });
    emitLine({ type: "item.completed", item: { id: "item-command-1", type: "command_execution", command: "pwd", exit_code: 0, aggregated_output: "/workspace\n" } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 10 } });
    resolveExit(0);

    const events = (await collectPromise).filter((event) => event.type === "tool_use" || event.type === "tool_result");
    expect(events).toEqual([
      expect.objectContaining({
        type: "tool_use",
        toolCallId: "item-command-1",
        toolCallScopeId: "session-scope:turn-2:codex",
        toolName: "bash",
      }),
      expect.objectContaining({
        type: "tool_result",
        toolCallId: "item-command-1",
        toolCallScopeId: "session-scope:turn-2:codex",
        toolName: "bash",
      }),
    ]);
  });

  it("does not promote a non-fatal Codex error item to a terminal error", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i6", type: "error", message: "Tool failed" } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("run() yields a model-version error code for Codex model version gates", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({ model: "gpt-5.5" }));
    const collectPromise = collectEvents(session.run({ prompt: "test" }));
    const message = "The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.";

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({
      type: "error",
      status: 400,
      error: {
        type: "invalid_request_error",
        message,
      },
    });
    resolveExit(1);

    const events = await collectPromise;
    expect(events).toContainEqual({
      type: "error",
      code: "CODEX_MODEL_VERSION_UNSUPPORTED",
      message,
      isRetryable: false,
    });
  });

  it("ignores the skills context budget notice from Codex", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({
      type: "item.completed",
      item: {
        id: "i8",
        type: "error",
        message: "Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter.",
      },
    });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events.some((event) => event.type === "error")).toBe(false);
  });
});

describe("CodexSession.run() cost", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("run() yields cost_update with mode computed after turn.completed", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 500_000 } });
    resolveExit(0);

    const events = await collectPromise;
    const costUpdate = events.find((e) => "type" in e && (e as { type: string }).type === "cost_update");
    expect(costUpdate).toBeDefined();
    expect((costUpdate as { mode: string }).mode).toBe("computed");
  });

  it("cost_update usd defaults to 0 without static catalog pricing", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({ model: "unknown-model-xyz" }));
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 500_000 } });
    resolveExit(0);

    const events = await collectPromise;
    const costUpdate = events.find((e) => "type" in e && (e as { type: string }).type === "cost_update") as
      | { usd: number; model?: string }
      | undefined;
    expect(costUpdate?.usd).toBe(0);
    expect(costUpdate?.model).toBe("unknown-model-xyz");
  });

  it("cost_update is yielded before completed event", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;
    const costUpdateIdx = events.findIndex((e) => "type" in e && (e as { type: string }).type === "cost_update");
    const completedIdx = events.findIndex((e) => "type" in e && (e as { type: string }).type === "completed");
    expect(costUpdateIdx).toBeLessThan(completedIdx);
  });
});

describe("CodexSession.run() completion", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("emits a completed outcome when no error items are received", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;
    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed") as { outcome: string } | undefined;
    expect(completed?.outcome).toBe("completed");
  });

  it("keeps a completed outcome when a non-fatal error item is received", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i7", type: "error", message: "Tool failed" } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;
    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed") as { outcome: string } | undefined;
    expect(completed?.outcome).toBe("completed");
  });

  it("completed.isPreflightCrash is true when turn.failed before turn.started", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.failed", error: { message: "usage limit" } });
    resolveExit(0);

    const events = await collectPromise;
    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed") as { isPreflightCrash: boolean } | undefined;
    expect(completed?.isPreflightCrash).toBe(true);
  });

  it("completed.isPreflightCrash is false for normal completion", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;
    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed") as { isPreflightCrash: boolean } | undefined;
    expect(completed?.isPreflightCrash).toBe(false);
  });
});

describe("CodexSession.run() error handling", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("run() yields error event for top-level error type event", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "error", message: "You hit your usage limit" });
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toContainEqual({
      type: "error",
      code: "CODEX_TURN_ERROR",
      message: "You hit your usage limit",
      isRetryable: false,
    });
  });

  it("run() yields error event for turn.failed event", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.failed", error: { message: "Turn failed" } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toContainEqual({
      type: "error",
      code: "CODEX_TURN_FAILED",
      message: "Turn failed",
      isRetryable: false,
    });
  });

  it("run() yields error + completed when process exits nonzero without turn.completed", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    resolveExit(1);

    const events = await collectPromise;
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "CODEX_EXIT_ERROR" }));
    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed") as { outcome: string } | undefined;
    expect(completed?.outcome).toBe("failed");
  });

  it("run() does not emit UNKNOWN_MODEL error for unknown model", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig({ model: "unknown-model-xyz" }));
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(vi.mocked(mockSpawn)).toHaveBeenCalledTimes(1);
    const unknownModelError = events.find(
      (event) =>
        "type" in event
        && (event as { type: string }).type === "error"
        && (event as { code?: string }).code === "UNKNOWN_MODEL",
    );
    expect(unknownModelError).toBeUndefined();
  });

  it("run() respects abortSignal and kills subprocess", async () => {
    const { proc, emitLine, flushExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const abortController = new AbortController();

    const runPromise = (async () => {
      for await (const _ of session.run({ prompt: "test", abortSignal: abortController.signal })) {
        abortController.abort();
      }
    })();

    emitLine({ type: "thread.started", thread_id: "t1" });
    abortController.abort();
    flushExit(1);

    await runPromise;
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("CodexSession lifecycle", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("run() waits for process close before completing", async () => {
    const { proc, emitLine, emitExit, resolveClose } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    let settled = false;
    const collectPromise = collectEvents(session.run({ prompt: "test" })).then((events) => {
      settled = true;
      return events;
    });

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    emitExit(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(settled).toBe(false);

    resolveClose(0);
    const events = await collectPromise;
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", outcome: "completed" }));
  });

  it("run() drains stderr from the Codex subprocess", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    expect(proc.stderr.listenerCount("data")).toBeGreaterThan(0);

    proc.stderr.emit("data", Buffer.from("diagnostic noise"));
    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await expect(collectPromise).resolves.toContainEqual(expect.objectContaining({ type: "completed", outcome: "completed" }));
  });

  it("dispose() calls kill() on a running subprocess", async () => {
    const { proc, emitLine, flushExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    const runPromise = (async () => {
      for await (const _ of session.run({ prompt: "test" })) {
        // consume
      }
    })();

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });

    await new Promise((r) => setTimeout(r, 5));
    await session.dispose();
    flushExit(1);
    await runPromise;

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("run() does not yield any events after dispose", async () => {
    const { proc, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);

    const session = new CodexSession(baseConfig());
    await session.dispose();

    const collectPromise = collectEvents(session.run({ prompt: "test" }));
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toHaveLength(0);
  });
});
