import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { CodexSession } from "../../src/wrapper/codex-session.js";
import type { CodexSessionConfig } from "../../src/wrapper/codex-session.js";
import type { IKilnSession } from "../../src/wrapper/session.js";
import type { SessionEvent } from "../../src/wrapper/session.js";

const mockCatalog = vi.hoisted(() => [
  { model: "gpt-5.4", provider: "openai", inputPer1M: 2.50, outputPer1M: 15.00, qualityTier: "high", cachedInputRatePer1M: 0.25 },
  { model: "gpt-5.3-codex", provider: "openai", inputPer1M: 1.75, outputPer1M: 14.00, qualityTier: "high", cachedInputRatePer1M: 0.175 },
  { model: "gpt-5.3-codex-spark", provider: "openai", inputPer1M: 1.75, outputPer1M: 14.00, qualityTier: "high", cachedInputRatePer1M: 0.175 },
]);

vi.mock("@kilnai/core", () => ({
  MODEL_CATALOG: mockCatalog,
  CODEX_DEFAULT_MODEL: "gpt-5.4",
}));

const mockSpawn = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const mockExecSync = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
}));

interface MockProc {
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
  resolveExit: (code: number) => void;
  flushExit: (code: number) => void;
}

function makeMockProc(): ProcController {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  let exitHandler: ((code: number) => void) | null = null;

  const proc: MockProc = {
    stdout,
    stderr,
    kill: vi.fn(),
    pid: 12345,
    on: vi.fn((event: string, handler: (code: number) => void) => {
      if (event === "exit") exitHandler = handler;
      return proc;
    }),
    once: vi.fn((event: string, handler: (code: number) => void) => {
      if (event === "exit") exitHandler = handler;
      return proc;
    }),
  };

  return {
    proc,
    emitLine: (obj: object) => {
      stdout.emit("data", Buffer.from(JSON.stringify(obj) + "\n"));
    },
    resolveExit: (code: number) => {
      stdout.emit("end");
      exitHandler?.(code);
    },
    flushExit: (code: number) => {
      exitHandler?.(code);
    },
  };
}

async function collectEvents(iter: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const e of iter) events.push(e);
  return events;
}

function baseConfig(overrides: Partial<CodexSessionConfig> = {}): CodexSessionConfig {
  return {
    task: "Fix the login bug",
    cwd: process.cwd(),
    ...overrides,
  };
}

describe("CodexSession implements IKilnSession", () => {
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
});

describe("CodexSession.run() JSONL parsing", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockExecSync.mockReset();
  });

  it("run() yields text_delta for agent_message item", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i2", type: "command_execution", command: "echo hello", exit_code: 0, aggregated_output: "hello\n" } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 500, cached_input_tokens: 0, output_tokens: 100 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toContainEqual({ type: "tool_use", toolName: "bash", input: { command: "echo hello" } });
    expect(events).toContainEqual({ type: "tool_result", toolName: "bash", output: "hello\n" });
  });

  it("run() yields tool_use for mcp_tool_call item", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i3", type: "mcp_tool_call", tool: "memory_store", arguments: { key: "test", value: "42" } } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 200, cached_input_tokens: 0, output_tokens: 50 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toContainEqual({ type: "tool_use", toolName: "memory_store", input: { key: "test", value: "42" } });
  });

  it("run() skips reasoning items silently", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i4", type: "reasoning", text: "Let me think..." } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events).not.toContainEqual(expect.objectContaining({ type: "text_delta", content: "Let me think..." }));
  });

  it("run() emits tool_use for item.started events", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    expect((toolUse as { toolName: string }).toolName).toBe("command_execution");
  });

  it("run() yields error event for item.type error", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i6", type: "error", message: "Tool failed" } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toContainEqual({
      type: "error",
      code: "CODEX_ITEM_ERROR",
      message: "Tool failed",
      isRetryable: false,
    });
  });
});

describe("CodexSession.run() cost", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockExecSync.mockReset();
  });

  it("run() yields cost_update with mode computed after turn.completed", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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

  it("cost_update usd is computed correctly from token counts", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig({ model: "gpt-5.4" }));
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 500_000 } });
    resolveExit(0);

    const events = await collectPromise;
    const costUpdate = events.find((e) => "type" in e && (e as { type: string }).type === "cost_update") as { usd: number } | undefined;
    expect(costUpdate?.usd).toBeCloseTo(10.0, 4);
  });

  it("cost_update uses cached rate when cached_input_tokens is present", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig({ model: "gpt-5.4" }));
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 1_000_000, cached_input_tokens: 500_000, output_tokens: 200_000 } });
    resolveExit(0);

    const events = await collectPromise;
    const costUpdate = events.find((e) => "type" in e && (e as { type: string }).type === "cost_update") as { usd: number } | undefined;
    expect(costUpdate?.usd).toBeCloseTo(4.375, 3);
  });

  it("cost_update is yielded before completed event", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    mockExecSync.mockReset();
  });

  it("completed.isError is false when no error items received", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;
    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed") as { isError: boolean } | undefined;
    expect(completed?.isError).toBe(false);
  });

  it("completed.isError is true when error item received", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i7", type: "error", message: "Tool failed" } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 } });
    resolveExit(0);

    const events = await collectPromise;
    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed") as { isError: boolean } | undefined;
    expect(completed?.isError).toBe(true);
  });

  it("completed.isPreflightCrash is true when turn.failed before turn.started", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    mockExecSync.mockReset();
  });

  it("run() yields error event for top-level error type event", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    resolveExit(1);

    const events = await collectPromise;
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "CODEX_EXIT_ERROR" }));
    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed") as { isError: boolean } | undefined;
    expect(completed?.isError).toBe(true);
  });

  it("run() yields error with code UNKNOWN_MODEL for unknown model", async () => {
    const { proc, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig({ model: "unknown-model-xyz" }));
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    resolveExit(0);

    const events = await collectPromise;
    expect(events).toContainEqual({
      type: "error",
      code: "UNKNOWN_MODEL",
      message: "No pricing data for model: unknown-model-xyz",
      isRetryable: false,
    });
  });

  it("run() respects abortSignal and kills subprocess", async () => {
    const { proc, emitLine, flushExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    mockExecSync.mockReset();
  });

  it("dispose() calls kill() on subprocess", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig());
    const runPromise = (async () => {
      for await (const _ of session.run({ prompt: "test" })) {
        // consume
      }
    })();

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    resolveExit(0);

    await new Promise((r) => setTimeout(r, 5));
    await session.dispose();
    await runPromise;

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("run() does not yield any events after dispose", async () => {
    const { proc, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig());
    await session.dispose();

    const collectPromise = collectEvents(session.run({ prompt: "test" }));
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toHaveLength(0);
  });
});
