import { describe, expect, it, vi, beforeEach } from "vitest";
import { OpenCodeSession } from "../../src/wrapper/opencode-session.js";
import type { OpenCodeSessionConfig } from "../../src/wrapper/opencode-session.js";
import type { IKilnSession } from "../../src/wrapper/session.js";

const { createOpencodeClient } = vi.hoisted(() => ({ createOpencodeClient: vi.fn() }));

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient,
}));

function baseConfig(overrides: Partial<OpenCodeSessionConfig> = {}): OpenCodeSessionConfig {
  return {
    cwd: process.cwd(),
    baseUrl: "http://127.0.0.1:9999",
    ...overrides,
  };
}

describe("OpenCodeSession implements IKilnSession", () => {
  it("declares implements IKilnSession", () => {
    const session: IKilnSession = new OpenCodeSession(baseConfig());
    expect(session).toBeDefined();
  });

  it("sessionId is a non-empty UUID string", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("sessionId is unique per instance", () => {
    const a = new OpenCodeSession(baseConfig());
    const b = new OpenCodeSession(baseConfig());
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("capabilities.mcp is true", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.mcp).toBe(true);
  });

  it("capabilities.streaming is true", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.streaming).toBe(true);
  });

  it("capabilities.resume is false", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.resume).toBe(false);
  });

  it("capabilities.costTrackingMode is native", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.costTrackingMode).toBe("native");
  });

  it("capabilities.maxContextTokens is null", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.maxContextTokens).toBeNull();
  });

  it("capabilities.priority is 2", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.priority).toBe(2);
  });

  it("capabilities.fallbackTo is null", () => {
    const session = new OpenCodeSession(baseConfig());
    expect(session.capabilities.fallbackTo).toBeNull();
  });

  it("dispose resolves without error", async () => {
    const session = new OpenCodeSession(baseConfig());
    await expect(session.dispose()).resolves.toBeUndefined();
  });

  it("dispose can be called multiple times without error", async () => {
    const session = new OpenCodeSession(baseConfig());
    await session.dispose();
    await expect(session.dispose()).resolves.toBeUndefined();
  });
});

type MockEvent = { directory: string; payload: { type: string; properties?: Record<string, unknown> } };

function makeStream(...events: MockEvent[]) {
  return {
    stream: (function* () {
      for (const e of events) {
        yield e;
      }
    })(),
  };
}

describe("OpenCodeSession.run() integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeMockClient(sessionId: string, events: MockEvent[], cost = 0, stopReason?: string) {
    return {
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: sessionId } }),
        prompt: vi.fn().mockResolvedValue({ data: { info: { cost, stopReason } } }),
        abort: vi.fn().mockResolvedValue(undefined),
      },
      global: {
        event: vi.fn().mockResolvedValue({ stream: makeStream(...events).stream }),
      },
      config: {
        update: vi.fn().mockResolvedValue({ data: undefined }),
      },
    };
  }

  it("run() yields text_delta for message.part.delta via SSE", async () => {
    const mock = makeMockClient("ses_123", [
      {
        directory: "/tmp",
        payload: { type: "message.part.delta", properties: { sessionID: "ses_123", field: "text", delta: "Hello, world!" } },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_123", status: { type: "idle" } } },
      },
    ], 0.001);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "text_delta", content: "Hello, world!" });
  });

  it("run() yields tool_use for pending/running tool via message.part.updated", async () => {
    const mock = makeMockClient("ses_456", [
      {
        directory: "/tmp",
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_456",
            part: {
              type: "tool",
              tool: "read",
              callID: "call_read_1",
              state: { status: "running", input: { filePath: "/tmp/test.txt" } },
            },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_456", status: { type: "idle" } } },
      },
    ], 0.002);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "tool_use", toolName: "read", input: { filePath: "/tmp/test.txt" } });
  });

  it("run() yields tool_result for completed tool via message.part.updated", async () => {
    const mock = makeMockClient("ses_789", [
      {
        directory: "/tmp",
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_789",
            part: {
              type: "tool",
              tool: "bash",
              callID: "call_bash_1",
              state: { status: "completed", input: { command: "echo hi" }, output: "hi\n", title: "bash" },
            },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_789", status: { type: "idle" } } },
      },
    ], 0.003);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "tool_result", toolName: "bash", output: "hi\n" });
  });

  it("run() yields completed with cost from session prompt response", async () => {
    const mock = makeMockClient("ses_cost", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_cost", status: { type: "idle" } } },
      },
    ], 0.0042);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { totalUsd: number }).totalUsd).toBe(0.0042);
  });

  it("run() yields completed with isPreflightCrash false", async () => {
    const mock = makeMockClient("ses_done", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_done", status: { type: "idle" } } },
      },
    ], 0.005);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { isPreflightCrash: boolean }).isPreflightCrash).toBe(false);
  });

  it("run() yields error event on SDK session.create throw", async () => {
    vi.mocked(createOpencodeClient).mockReturnValueOnce({
      session: {
        create: vi.fn().mockRejectedValue(new Error("SDK connection failed")),
        prompt: vi.fn().mockResolvedValue({ data: { info: { cost: 0 } } }),
        abort: vi.fn().mockResolvedValue(undefined),
      },
      global: {
        event: vi.fn().mockResolvedValue({ stream: (function* () {})() }),
      },
      config: {
        update: vi.fn().mockResolvedValue({ data: undefined }),
      },
    } as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "error",
      code: "OPENCODE_ERROR",
      message: "SDK connection failed",
      isRetryable: false,
    });
  });

  it("run() does not yield any events after dispose", async () => {
    const session = new OpenCodeSession(baseConfig());
    await session.dispose();

    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
  });

  it("run() yields cost_update for usage_update sessionUpdate", async () => {
    const mock = makeMockClient("ses_cost", [
      {
        directory: "/tmp",
        payload: {
          type: "sessionUpdate",
          properties: {
            sessionID: "ses_cost",
            type: "usage_update",
            cost: { amount: 0.05 },
          },
        },
      },
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_cost", status: { type: "idle" } } },
      },
    ], 0.05);
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "cost_update", usd: 0.05, mode: "native" });
    const costUpdateIndex = events.findIndex((e) => "type" in e && (e as { type: string }).type === "cost_update");
    const completedIndex = events.findIndex((e) => "type" in e && (e as { type: string }).type === "completed");
    expect(costUpdateIndex).toBeLessThan(completedIndex);
  });

  it("run() yields completed with isError false for end_turn", async () => {
    const mock = makeMockClient("ses_ok", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_ok", status: { type: "idle" } } },
      },
    ], 0.01, "end_turn");
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { isError: boolean }).isError).toBe(false);
  });

  it("run() yields completed with isError true for cancelled", async () => {
    const mock = makeMockClient("ses_cancel", [
      {
        directory: "/tmp",
        payload: { type: "session.status", properties: { sessionID: "ses_cancel", status: { type: "idle" } } },
      },
    ], 0.01, "cancelled");
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig());
    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    const completed = events.find((e) => "type" in e && (e as { type: string }).type === "completed");
    expect(completed).toBeDefined();
    expect((completed as { isError: boolean }).isError).toBe(true);
  });

  it("run() respects abortSignal and kills subprocess", async () => {
    const mock = makeMockClient("ses_abort", [
      {
        directory: "/tmp",
        payload: { type: "message.part.delta", properties: { sessionID: "ses_abort", field: "text", delta: "hello" } },
      },
    ]);
    let resolveEvent: (value: unknown) => void;
    const eventPromise = new Promise((resolve) => {
      resolveEvent = resolve;
    });
    mock.global.event = vi.fn().mockImplementation(() => ({
      stream: (async function* () {
        await eventPromise;
      })(),
    }));
    vi.mocked(createOpencodeClient).mockReturnValueOnce(mock as any);

    const session = new OpenCodeSession(baseConfig({ baseUrl: undefined }));
    const killFn = vi.fn();
    vi.spyOn(session, "spawnAndWaitForServe").mockImplementation(async () => {
      session.serveProcess = { kill: killFn, killed: false } as unknown as ReturnType<typeof import("node:child_process").spawn>;
      return 9876;
    });
    const abortController = new AbortController();

    const runPromise = (async () => {
      for await (const _ of await session.run({ prompt: "test", abortSignal: abortController.signal })) {
        abortController.abort();
      }
    })();

    await new Promise((r) => setTimeout(r, 10));
    resolveEvent!(undefined);

    await runPromise;
    expect(killFn).toHaveBeenCalledWith("SIGTERM");
  });

  it("dispose() calls kill() on subprocess", async () => {
    const session = new OpenCodeSession(baseConfig({ baseUrl: undefined }));
    vi.spyOn(session, "spawnAndWaitForServe").mockImplementation(async () => {
      session.serveProcess = { kill: vi.fn(), killed: false } as unknown as ReturnType<typeof import("node:child_process").spawn>;
      return 9876;
    });
    vi.mocked(createOpencodeClient).mockReturnValueOnce(makeMockClient("ses_disp2", [
      { directory: "/tmp", payload: { type: "session.status", properties: { sessionID: "ses_disp2", status: { type: "idle" } } } },
    ]) as any);

    const runPromise = (async () => {
      for await (const _ of await session.run({ prompt: "test" })) {
        // consume events
      }
    })();

    while (!session.serveProcess) {
      await new Promise((r) => setTimeout(r, 5));
    }

    const killFn = vi.spyOn(session.serveProcess!, "kill");
    await session.dispose();
    await runPromise;

    expect(killFn).toHaveBeenCalledWith("SIGTERM");
  });

  it("run() yields error event when spawnAndWaitForServe rejects", async () => {
    vi.mocked(createOpencodeClient).mockReturnValueOnce({
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: "ses_err" } }),
        prompt: vi.fn().mockResolvedValue({ data: { info: { cost: 0 } } }),
        abort: vi.fn().mockResolvedValue(undefined),
      },
      global: {
        event: vi.fn().mockResolvedValue({ stream: (function* () {})() }),
      },
    } as any);

    const session = new OpenCodeSession(baseConfig({ baseUrl: undefined }));
    vi.spyOn(session, "spawnAndWaitForServe").mockRejectedValue(new Error("opencode serve failed to start within 10 seconds"));

    const events: object[] = [];
    for await (const event of await session.run({ prompt: "test" })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "error",
      code: "OPENCODE_ERROR",
      message: "opencode serve failed to start within 10 seconds",
      isRetryable: false,
    });
  });
});
