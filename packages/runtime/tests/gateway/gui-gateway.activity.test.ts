import "./gui-gateway-test-fixture.js";
import * as guiFixture from "./gui-gateway-test-fixture.js";
import {
  rmSync,
} from "node:fs";
import {
  GPT4O,
} from "@kilnai/core/agents";
import {
  textParts,
} from "@kilnai/core/engine";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  processAdmittedTurn,
} from "../../src/gateway/message-pipeline/index.js";
import {
} from "../../src/gateway/gui-provider-models.js";

const {guiOperatorTransportDefaults, createGuiDist, waitForCondition, selectGuiTestExecutionRoute, makeGuiOperatorDiscoveryFromModels} = guiFixture;
const guiSocketHarness = guiFixture.getGuiSocketHarness();

describe("GUI gateway activity", () => {
  it("forwards browser session stream updates from the configured provider", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    let browserSessionUpdateHandler: ((state: {
      readonly target: "browser";
      readonly status: "running" | "succeeded" | "failed";
      readonly updatedAt: string;
      readonly provider: "playwright";
      readonly sessionId: string;
      readonly ownership: "agent" | "operator" | "released";
      readonly viewMode: "snapshot" | "live";
      readonly stream: { readonly status: "starting" | "live" | "ended" | "failed" };
      readonly latestCapture?: {
        readonly uri: string;
        readonly relation: "snapshot";
        readonly mimeType: "image/png";
        readonly width?: number;
        readonly height?: number;
      };
    }) => void) | undefined;
    const browserProvider = {
      execute: vi.fn(),
      setBrowserSessionUpdateHandler: vi.fn((handler) => {
        browserSessionUpdateHandler = handler;
      }),
    };
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      await input.turnCapture?.start?.("gui-browser-session", 10);
      browserSessionUpdateHandler?.({
        target: "browser",
        status: "running",
        updatedAt: "2026-05-12T12:00:00.000Z",
        provider: "playwright" as const,
        sessionId: "browser-live",
        ownership: "agent",
        viewMode: "live",
        stream: { status: "live" },
        latestCapture: {
          uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
          relation: "snapshot",
          mimeType: "image/png",
          width: 1280,
          height: 720,
        },
      });
      await input.turnCapture?.finish?.("gui-browser-session");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Browser stream observed." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outcome: "completed",
          queued: false,
          sessionId: "gui-browser-session",
          sessionMode: "ai_active",
          traceId: "trace-browser-stream",
        },
      };
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        builtinToolOptions: {
          browserUse: {
            provider: browserProvider,
          },
       } as never,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionRoute(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "open the browser" }),
        }),
        wsCtx,
      );

      const browserFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string; browserSession?: Record<string, unknown> })
        .find((frame) => frame.type === "browser_session_updated");
      const liveFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string; [key: string]: unknown })
        .find((frame) => frame.type === "browser_live_viewport_frame");

      expect(browserProvider.setBrowserSessionUpdateHandler).toHaveBeenCalledWith(expect.any(Function));
      expect(browserFrame).toEqual({
        type: "browser_session_updated",
        browserSession: {
          target: "browser",
          status: "running",
          updatedAt: "2026-05-12T12:00:00.000Z",
          provider: "playwright",
          kilnSessionId: "gui-browser-session",
          sessionId: "browser-live",
          ownership: "agent",
          viewMode: "live",
          stream: { status: "live" },
          latestCapture: {
            uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
            relation: "snapshot",
            mimeType: "image/png",
            width: 1280,
            height: 720,
          },
        },
      });
      expect(liveFrame).toEqual({
        type: "browser_live_viewport_frame",
        sessionId: "browser-live",
        kilnSessionId: "gui-browser-session",
        frameId: "browser-live:2026-05-12T12:00:00.000Z",
        transport: "snapshot-polling",
        format: "png",
        artifactUri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
        width: 1280,
        height: 720,
        capturedAt: "2026-05-12T12:00:00.000Z",
      });
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("preserves CDP screencast transport in forwarded browser live viewport frames", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    let browserSessionUpdateHandler: ((state: {
      readonly target: "browser";
      readonly status: "running";
      readonly updatedAt: string;
      readonly provider: "playwright";
      readonly sessionId: string;
      readonly ownership: "operator";
      readonly viewMode: "live";
      readonly stream: { readonly status: "live" };
      readonly latestCapture: {
        readonly uri: string;
        readonly relation: "snapshot";
        readonly mimeType: "image/png";
        readonly width: number;
        readonly height: number;
        readonly transport: "cdp-screencast";
      };
    }) => void) | undefined;
    const browserProvider = {
      execute: vi.fn(),
      setBrowserSessionUpdateHandler: vi.fn((handler) => {
        browserSessionUpdateHandler = handler;
      }),
    };
    vi.mocked(processAdmittedTurn).mockImplementationOnce(async (input) => {
      await input.turnCapture?.start?.("gui-browser-session", 1);
      await input.turnCapture?.finish?.("gui-browser-session");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "watching" }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outcome: "completed",
          queued: false,
          sessionId: "gui-browser-session",
          sessionMode: "ai_active",
          traceId: "trace-browser-watch",
        },
      };
    });
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop,
      })),
    });

    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");

    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        builtinToolOptions: {
          browserUse: {
            provider: browserProvider,
          },
        } as never,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionRoute(handlers, wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "open the browser" }),
        }),
        wsCtx,
      );

      browserSessionUpdateHandler?.({
        target: "browser",
        status: "running",
        updatedAt: "2026-05-13T12:00:00.000Z",
        provider: "playwright",
        sessionId: "browser-live",
        ownership: "operator",
        viewMode: "live",
        stream: { status: "live" },
        latestCapture: {
          uri: "kiln://artifacts/interactive-screenshots/artifact_2/content",
          relation: "snapshot",
          mimeType: "image/png",
          width: 1440,
          height: 900,
          transport: "cdp-screencast",
        },
      });

      const liveFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as { type: string; [key: string]: unknown })
        .find((frame) => frame.type === "browser_live_viewport_frame" && frame.frameId === "browser-live:2026-05-13T12:00:00.000Z");

      expect(liveFrame).toMatchObject({
        type: "browser_live_viewport_frame",
        sessionId: "browser-live",
        kilnSessionId: "gui-browser-session",
        transport: "cdp-screencast",
        artifactUri: "kiln://artifacts/interactive-screenshots/artifact_2/content",
        width: 1440,
        height: 900,
      });
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});


describe("GUI active turn lifecycle", () => {
  it("aborts the active turn and acknowledges operator cancellation", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({ port: port ?? 4810, stop })),
    });
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      const signal = input.perCallConfig?.abortSignal;
      if (!signal) throw new Error("Expected active turn abort signal.");
      if (!signal.aborted) {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      }
      throw new Error("turn aborted");
    });
    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({}) as never,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.openai?.includes(GPT4O) ?? false,
        "Expected GUI provider models before cancellation test.",
      );
      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await selectGuiTestExecutionRoute(handlers, wsCtx);
      const activeMessage = handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "long task" }) }),
        wsCtx,
      );
      await waitForCondition(() => vi.mocked(processAdmittedTurn).mock.calls.length === 1, "Expected active GUI turn.");

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "turn_cancel", requestId: "cancel-1" }) }),
        wsCtx,
      );
      await activeMessage;

      const frames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string));
      expect(frames).toContainEqual({
        type: "turn_cancel_result",
        requestId: "cancel-1",
        status: "accepted",
      });
      expect(frames).not.toContainEqual(expect.objectContaining({ type: "error", message: "turn aborted" }));
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("keeps runtime execution alive when the replaceable GUI operator surface disconnects", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({ port: port ?? 4810, stop })),
    });
    let completeTurn!: () => void;
    const turnCompletion = new Promise<void>((resolve) => {
      completeTurn = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    vi.mocked(processAdmittedTurn).mockImplementation(async (input) => {
      observedSignal = input.perCallConfig?.abortSignal;
      await turnCompletion;
      return {
        ok: true,
        result: {
          parts: textParts("Completed while the operator surface was detached."),
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: "session-detached",
          sessionMode: "mode-a",
          traceId: "trace-detached",
          outcome: "completed",
        },
      } as never;
    });
    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({}) as never,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.openai?.includes(GPT4O) ?? false,
        "Expected GUI provider models before disconnect test.",
      );
      const { handlers, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      await selectGuiTestExecutionRoute(handlers, wsCtx);
      const activeMessage = handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "long task" }) }),
        wsCtx,
      );
      await waitForCondition(() => observedSignal !== undefined, "Expected active GUI turn.");

      handlers.onClose!(new Event("close") as unknown as CloseEvent, wsCtx);

      expect(observedSignal?.aborted).toBe(false);
      const reconnect = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await reconnect.handlers.onOpen!(new Event("open"), reconnect.wsCtx);
      await selectGuiTestExecutionRoute(reconnect.handlers, reconnect.wsCtx);
      await reconnect.handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "duplicate task" }) }),
        reconnect.wsCtx,
      );
      expect(reconnect.mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string))).toContainEqual({
        type: "error",
        message: "A GUI turn is already active. Cancel it before starting another turn.",
      });
      expect(processAdmittedTurn).toHaveBeenCalledTimes(1);
      completeTurn();
      await activeMessage;
      expect(observedSignal?.aborted).toBe(false);
    } finally {
      vi.mocked(processAdmittedTurn).mockReset();
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("routes goal controls through the canonical controller and streams the resulting event", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({ port: port ?? 4810, stop })),
    });
    const control = vi.fn().mockResolvedValue({
      eventId: "goal-event-1",
      kilnSessionId: "session-1",
      sequence: 3,
      timestamp: new Date("2026-07-18T20:00:00.000Z"),
      kind: "goal.updated",
      source: { actor: "user", surface: "gui", component: "goal-control" },
      goal: {
        id: "goal-1",
        objective: "Repair lifecycle.",
        ownerSessionId: "session-1",
        source: { kind: "operator_direct", turnId: "turn-1" },
        status: "paused",
        workItemIds: [],
        authorityEnvelope: { maximumAuthority: "audited", escalationPolicy: "approval_required", reason: "Test." },
        routePolicy: { workflowProfile: "small-fix" },
        evidenceRequirements: [],
        evidence: [],
        currentPhase: "operator_paused",
        activeDurationMs: 5_000,
        createdAt: "2026-07-18T19:59:55.000Z",
        updatedAt: "2026-07-18T20:00:00.000Z",
        sequence: 2,
      },
      changedFields: ["status"],
    });
    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({}) as never,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai",
            setProvider: vi.fn(),
            getModel: () => GPT4O,
            setModel: vi.fn(),
          },
        },
        goalController: { control },
      });
      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "goal_control",
            requestId: "goal-control-1",
            goalRunId: "goal-1",
            action: "pause",
          }),
        }),
        wsCtx,
      );

      expect(control).toHaveBeenCalledWith({
        goalRunId: "goal-1",
        action: "pause",
        requestedBy: "operator-1",
      });
      const frames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string));
      expect(frames).toContainEqual({
        type: "goal_control_result",
        requestId: "goal-control-1",
        goalRunId: "goal-1",
        action: "pause",
        status: "accepted",
      });
      expect(frames).toContainEqual(expect.objectContaining({
        type: "session_event",
        event: expect.objectContaining({ eventId: "goal-event-1", kind: "goal.updated" }),
      }));

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "goal_control",
            requestId: "goal-control-invalid",
            goalRunId: "goal-1",
            action: "restart",
          }),
        }),
        wsCtx,
      );

      expect(control).toHaveBeenCalledTimes(1);
      expect(mockWs.send).not.toHaveBeenCalledWith(expect.stringContaining('"action":"restart"'));
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});
