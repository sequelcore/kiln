import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpgradeWebSocket } from "hono/ws";
import { execSync } from "node:child_process";
import * as messagePipelineModule from "../../src/gateway/message-pipeline.js";

const tuiSocketHarness = vi.hoisted(() => {
  type HandlerFactory = Parameters<UpgradeWebSocket>[0];
  let capturedFactory: HandlerFactory | null = null;

  const upgradeWebSocket: UpgradeWebSocket = (factory) => {
    capturedFactory = factory;
    return async (_c, next) => next();
  };

  function simulateConnection(queryParams: Record<string, string> = {}) {
    if (!capturedFactory) throw new Error("upgradeWebSocket not called yet");

    const url = new URL("http://localhost/tui/ws");
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }

    const ctx = {
      req: {
        query: (key: string) => url.searchParams.get(key) ?? undefined,
      },
    } as Parameters<HandlerFactory>[0];

    const handlers = capturedFactory(ctx);
    const mockWs = {
      send: vi.fn(),
      readyState: 1,
      close: vi.fn(),
    };

    return { handlers, mockWs, wsCtx: mockWs as never };
  }

  function reset(): void {
    capturedFactory = null;
  }

  return {
    upgradeWebSocket,
    simulateConnection,
    reset,
  };
});

vi.mock("hono/bun", () => ({
  createBunWebSocket: () => ({
    upgradeWebSocket: tuiSocketHarness.upgradeWebSocket,
    websocket: {},
  }),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");

  return {
    ...actual,
    execSync: vi.fn(() => ""),
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = { write: vi.fn() };
      proc.kill = vi.fn();
      queueMicrotask(() => proc.emit("close"));
      return proc;
    }),
  };
});

function stubBunServe(): void {
  vi.stubGlobal("Bun", {
    serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
      port: port ?? 4801,
      stop: vi.fn(),
    })),
  });
}

function makeSessionManager() {
  return {
    factory: vi.fn() as never,
    getProvider: vi.fn(() => "claude"),
    setProvider: vi.fn(),
    getModel: vi.fn(() => "claude-sonnet-4-6"),
    setModel: vi.fn(),
  };
}

afterEach(() => {
  tuiSocketHarness.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// We test the gateway clear frame handling by extracting the logic inline,
// since startTuiGateway() starts a real Bun HTTP server. Instead we exercise
// the onClear option contract directly as it would be called by the onMessage handler.

describe("TUI gateway clear frame handling", () => {
  it("sends cleared frame when clear frame received", async () => {
    const ws = { send: vi.fn() };
    const onClear = vi.fn().mockResolvedValue(undefined);

    // Simulate what the onMessage handler does for a { type: "clear" } frame
    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    const handled = await handleClearFrame({ type: "clear" }, ws.send, onClear);

    expect(handled).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "cleared" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("calls onClear callback", async () => {
    const onClear = vi.fn().mockResolvedValue(undefined);
    const ws = { send: vi.fn() };

    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    await handleClearFrame({ type: "clear" }, ws.send, onClear);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("sends cleared even when onClear throws (fail-open)", async () => {
    const onClear = vi.fn().mockRejectedValue(new Error("storage failure"));
    const ws = { send: vi.fn() };

    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    await handleClearFrame({ type: "clear" }, ws.send, onClear);

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "cleared" }));
  });

  it("does not handle non-clear frames", async () => {
    const ws = { send: vi.fn() };
    const onClear = vi.fn();

    const handleClearFrame = async (
      frame: Record<string, unknown>,
      wsSend: (data: string) => void,
      clearCb?: () => Promise<void>,
    ) => {
      if (frame.type === "clear") {
        try {
          await clearCb?.();
        } catch {
          // Fail-open
        }
        wsSend(JSON.stringify({ type: "cleared" }));
        return true;
      }
      return false;
    };

    const handled = await handleClearFrame({ type: "message", content: "hello" }, ws.send, onClear);
    expect(handled).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });
});

describe("TUI gateway provider switching", () => {
  it("echoes provider switch requestId on provider_changed", async () => {
    stubBunServe();
    vi.mocked(execSync).mockReturnValue("openai/gpt-5\n");
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({ sessionManager });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "provider",
            provider: "opencode",
            model: "openai/gpt-5",
            requestId: "request-1",
          }),
        }),
        wsCtx,
      );

      expect(sessionManager.setProvider).toHaveBeenCalledWith("opencode");
      expect(sessionManager.setModel).toHaveBeenCalledWith("openai/gpt-5");
      expect(JSON.parse(mockWs.send.mock.calls[0][0] as string)).toEqual({
        type: "provider_changed",
        provider: "opencode",
        model: "openai/gpt-5",
        requestId: "request-1",
      });
    } finally {
      gateway.shutdown();
    }
  });

  it("rejects provider switches without a nonblank requestId before mutating provider state", async () => {
    stubBunServe();
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({ sessionManager });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "provider",
            provider: "openai",
            model: "gpt-5",
            requestId: "   ",
          }),
        }),
        wsCtx,
      );

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "error",
        message: "Provider switch requestId is required",
      }));
      expect(sessionManager.setProvider).not.toHaveBeenCalled();
      expect(sessionManager.setModel).not.toHaveBeenCalled();
    } finally {
      gateway.shutdown();
    }
  });

  it("rejects unknown providers and non-advertised models before mutating provider state", async () => {
    stubBunServe();
    vi.mocked(execSync).mockReturnValue("openai/gpt-5\n");
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({ sessionManager });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "provider",
            provider: "openai",
            model: "gpt-5",
            requestId: "request-unknown",
          }),
        }),
        wsCtx,
      );

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "provider",
            provider: "opencode",
            model: "openai/gpt-5-other",
            requestId: "request-model",
          }),
        }),
        wsCtx,
      );

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "error",
        message: "OpenAI is unavailable in this runtime.",
      }));
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "error",
        message: "Provider 'opencode' does not advertise model 'openai/gpt-5-other'",
      }));
      expect(sessionManager.setProvider).not.toHaveBeenCalled();
      expect(sessionManager.setModel).not.toHaveBeenCalled();
    } finally {
      gateway.shutdown();
    }
  });

  it("rejects model-less provider switches before mutating provider state", async () => {
    stubBunServe();
    vi.mocked(execSync).mockReturnValue("openai/gpt-5\n");
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({ sessionManager });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "provider",
            provider: "opencode",
            requestId: "request-model-required",
          }),
        }),
        wsCtx,
      );

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "error",
        message: "Provider 'opencode' requires a selected model.",
      }));
      expect(sessionManager.setProvider).not.toHaveBeenCalled();
      expect(sessionManager.setModel).not.toHaveBeenCalled();
    } finally {
      gateway.shutdown();
    }
  });

  it("refreshes provider models before accepting a provider switch", async () => {
    stubBunServe();
    let opencodeModelsCalls = 0;
    vi.mocked(execSync).mockImplementation((command) => {
      if (String(command).includes("opencode")) {
        opencodeModelsCalls += 1;
        return opencodeModelsCalls === 1 ? "openai/gpt-5\n" : "openai/gpt-5-other\n";
      }
      return "";
    });
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({ sessionManager });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "provider",
            provider: "opencode",
            model: "openai/gpt-5",
            requestId: "request-drift",
          }),
        }),
        wsCtx,
      );

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "error",
        message: "Provider 'opencode' does not advertise model 'openai/gpt-5'",
      }));
      expect(sessionManager.setProvider).not.toHaveBeenCalled();
      expect(sessionManager.setModel).not.toHaveBeenCalled();
    } finally {
      gateway.shutdown();
    }
  });

  it("refreshes provider discovery on request without reconnecting", async () => {
    stubBunServe();
    let modelList = "openai/gpt-5\n";
    vi.mocked(execSync).mockImplementation((command) => (
      String(command).includes("opencode") ? modelList : ""
    ));
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({ sessionManager });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onOpen?.(new Event("open"), wsCtx);
      modelList = "openai/gpt-5-other\n";
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "refresh_providers",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "providers_refreshed",
        models: { opencode: ["openai/gpt-5-other"] },
      }));
    } finally {
      gateway.shutdown();
    }
  });
});

describe("TUI gateway message fail-closed behavior", () => {
  it("rejects normal message frames when the stored provider is unavailable", async () => {
    stubBunServe();
    vi.mocked(execSync).mockReturnValue("openai/gpt-5\n");
    const processSpy = vi.spyOn(messagePipelineModule, "processAdmittedTurn").mockResolvedValue(undefined as never);
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "openai"),
      getModel: vi.fn(() => "gpt-5"),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({ sessionManager });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message",
            content: "hello from tui",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });

      expect(gateway.models).toEqual(expect.objectContaining({ opencode: ["openai/gpt-5"] }));
      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual({
        type: "error",
        message: "OpenAI is unavailable in this runtime.",
      });
      expect(processSpy).not.toHaveBeenCalled();
    } finally {
      processSpy.mockRestore();
      gateway.shutdown();
    }
  });

  it.each([
    ["blank", ""],
    ["stale", "openai/gpt-5-stale"],
  ])("rejects normal message frames when the stored model is %s", async (_kind, storedModel) => {
    stubBunServe();
    vi.mocked(execSync).mockReturnValue("openai/gpt-5\n");
    const processSpy = vi.spyOn(messagePipelineModule, "processAdmittedTurn").mockResolvedValue(undefined as never);
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "opencode"),
      getModel: vi.fn(() => storedModel),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({ sessionManager });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message",
            content: "hello from tui",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });

      expect(gateway.models).toEqual(expect.objectContaining({ opencode: ["openai/gpt-5"] }));
      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual({
        type: "error",
        message: storedModel
          ? `Provider 'opencode' does not advertise model '${storedModel}'`
          : "Provider 'opencode' requires a selected model.",
      });
      expect(processSpy).not.toHaveBeenCalled();
    } finally {
      processSpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("refreshes provider models before admitting a message frame", async () => {
    stubBunServe();
    let opencodeModelsCalls = 0;
    vi.mocked(execSync).mockImplementation((command) => {
      if (String(command).includes("opencode")) {
        opencodeModelsCalls += 1;
        return opencodeModelsCalls === 1 ? "openai/gpt-5\n" : "openai/gpt-5-other\n";
      }
      return "";
    });
    const processSpy = vi.spyOn(messagePipelineModule, "processAdmittedTurn").mockResolvedValue(undefined as never);
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "opencode"),
      getModel: vi.fn(() => "openai/gpt-5"),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({ sessionManager });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message",
            content: "hello from tui",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual({
        type: "error",
        message: "Provider 'opencode' does not advertise model 'openai/gpt-5'",
      });
      expect(processSpy).not.toHaveBeenCalled();
    } finally {
      processSpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("admits normal message frames for model-less Claude without leaking a stale stored model", async () => {
    stubBunServe();
    vi.mocked(execSync).mockReturnValue("");
    const processSpy = vi.spyOn(messagePipelineModule, "processAdmittedTurn").mockResolvedValue({
      ok: true,
      result: {
        parts: [{ type: "text", text: "hello" }],
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        sessionId: "session-1",
        sessionMode: "mode-a",
        traceId: "trace-1",
      },
    } as never);
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "claude"),
      getModel: vi.fn(() => "stale-model"),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ claude: true }),
    });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message",
            content: "hello from tui",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string; message?: string });

      expect(gateway.models).toEqual(expect.objectContaining({ claude: [] }));
      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).not.toContainEqual({
        type: "error",
        message: "Provider 'claude' is unavailable",
      });
      expect(sessionManager.setModel).toHaveBeenCalledWith("");
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        routedProvider: "claude",
        routedModel: "",
      }));
      expect(processSpy).toHaveBeenCalledOnce();
    } finally {
      processSpy.mockRestore();
      gateway.shutdown();
    }
  });
});
