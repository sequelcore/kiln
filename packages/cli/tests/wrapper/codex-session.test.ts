import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { CodexSession } from "../../src/wrapper/codex-session.js";
import type { CodexSessionConfig } from "../../src/wrapper/codex-session.js";
import type { IKilnSession } from "../../src/wrapper/session.js";
import type { SessionEvent } from "../../src/wrapper/session.js";

vi.mock("@kilnai/core", () => ({
  CODEX_DEFAULT_MODEL: "gpt-5.4",
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

  it("run() deterministically appends constraintInstructions to the prompt sent to codex", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    const promptArg = spawnArgs?.[spawnArgs.length - 1] ?? "";
    expect(promptArg).toContain("Implement feature X");
    expect(promptArg).toContain("[KILN EXECUTION IDENTITY]");
    expect(promptArg).toContain("provider: codex");
    expect(promptArg).toContain("model: gpt-5.4");
    expect(promptArg).toContain("Kiln policy constraints for codex:");
    expect(promptArg).toContain("[data-firewall] DENY logs");
  });

  it("run() appends prepared system context after the governed turn prompt", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    const promptArg = spawnArgs?.[spawnArgs.length - 1] ?? "";
    expect(promptArg.indexOf("<kiln-preamble>")).toBeLessThan(promptArg.indexOf("## Operator Identity"));
    expect(promptArg).toContain("## Operator Identity");
    expect(promptArg).toContain("- Operator name: Alex");
    expect(promptArg).toContain("--- Kiln Prepared System Context ---");
    expect(promptArg).toContain("<kiln-preamble>");
    expect(promptArg).toContain("--- Kiln Task To Execute Now ---");
    expect(promptArg).toContain("inspect");
    expect(promptArg).toContain("Execute the task above in this turn.");
  });

  it("run() passes reasoning effort as a Codex config override", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig({ reasoningEffort: "high" }));
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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    expect(spawnArgs).toContain('approval_policy="untrusted"');
    expect(spawnArgs).toContain("--sandbox");
    expect(spawnArgs).toContain("read-only");
  });

  it("run() passes configured model to codex CLI via -m", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    const promptArg = spawnArgs?.[spawnArgs.length - 1] ?? "";
    expect(promptArg).toContain("model: experimental-model-alpha");
    expect(spawnOptions?.env?.CODEX_MODEL).toBeUndefined();
    expect(spawnOptions?.env?.FOO).toBe("bar");
  });

  it("run() appends --ephemeral when configured", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig({
      ephemeral: true,
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
    expect(spawnArgs).toContain("--ephemeral");
  });

  it("run() appends --profile with the configured profile name", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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

  it("run() maps completed Codex file_change items to provider-neutral file_changed events", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.128.0"));

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

    expect(events).toContainEqual({
      type: "file_changed",
      path: expect.stringContaining("added.txt"),
      changeType: "created",
      diffTruncated: true,
    });
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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.128.0"));

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
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "item.completed", item: { id: "i3", type: "mcp_tool_call", tool: "memory_store", arguments: { key: "test", value: "42" } } });
    emitLine({ type: "turn.completed", usage: { input_tokens: 200, cached_input_tokens: 0, output_tokens: 50 } });
    resolveExit(0);

    const events = await collectPromise;
    expect(events).toContainEqual({
      type: "tool_use",
      toolName: "memory_store",
      input: { key: "test", value: "42" },
      source: "mcp",
      mcpSelector: "memory_store",
    });
  });

  it("run() emits reasoning items as text_delta with isThinking flag", async () => {
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
    expect(events).toContainEqual(expect.objectContaining({ type: "text_delta", content: "Let me think...", isThinking: true }));
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

  it("cost_update usd defaults to 0 without static catalog pricing", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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

  it("run() does not emit UNKNOWN_MODEL error for unknown model", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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

  it("run() waits for process close before completing", async () => {
    const { proc, emitLine, emitExit, resolveClose } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

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
    expect(events).toContainEqual(expect.objectContaining({ type: "completed", isError: false }));
  });

  it("run() drains stderr from the Codex subprocess", async () => {
    const { proc, emitLine, resolveExit } = makeMockProc();
    vi.mocked(mockSpawn).mockReturnValueOnce(proc as unknown);
    vi.mocked(mockExecSync).mockReturnValueOnce(Buffer.from("codex-cli 0.117.0"));

    const session = new CodexSession(baseConfig());
    const collectPromise = collectEvents(session.run({ prompt: "test" }));

    expect(proc.stderr.listenerCount("data")).toBeGreaterThan(0);

    proc.stderr.emit("data", Buffer.from("diagnostic noise"));
    emitLine({ type: "thread.started", thread_id: "t1" });
    emitLine({ type: "turn.started" });
    emitLine({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
    resolveExit(0);

    await expect(collectPromise).resolves.toContainEqual(expect.objectContaining({ type: "completed", isError: false }));
  });

  it("dispose() calls kill() on a running subprocess", async () => {
    const { proc, emitLine, flushExit } = makeMockProc();
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

    await new Promise((r) => setTimeout(r, 5));
    await session.dispose();
    flushExit(1);
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
