import "./gui-gateway-test-fixture.js";
import * as guiFixture from "./gui-gateway-test-fixture.js";
import {
  rmSync,
} from "node:fs";
import {
  GPT4O,
} from "@kilnai/core/agents";
import type {
  OperatorExecutionRouteSelectionPort,
} from "../../src/gateway/operator-execution-route-selection.js";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
} from "../../src/gateway/gui-provider-models.js";

const {guiOperatorTransportDefaults, createGuiDist, waitForCondition, makeGuiOperatorDiscoveryFromModels} = guiFixture;
const guiSocketHarness = guiFixture.getGuiSocketHarness();

describe("GUI gateway execution routing", () => {
  it("acknowledges admitted execution-route selections", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ claude: [] }));
    const executionRouteSelection: OperatorExecutionRouteSelectionPort = {
      getCatalog: vi.fn<OperatorExecutionRouteSelectionPort["getCatalog"]>(async () => ({
        routes: [{
          routeId: "claude-default",
          label: "Claude",
          providerId: "claude",
          providerModelId: "claude-sonnet-4-6",
          accountSelection: { mode: "automatic" as const, eligibleAccountCount: 1, allowOperatorOverride: true },
          availability: "available" as const,
          reasonCodes: [],
          repairActions: [],
        }],
      })),
      admit: vi.fn<OperatorExecutionRouteSelectionPort["admit"]>(async () => ({
        ok: true as const,
        admission: {
          routeId: "claude-default",
          providerId: "claude",
          providerModelId: "claude-sonnet-4-6",
        },
      })),
    };
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
        executionRouteSelection,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "execution_route", routeId: "claude-default", requestId: "request-claude" }),
        }),
        wsCtx,
      );

      expect(executionRouteSelection.admit).toHaveBeenCalledWith({
        type: "execution_route",
        routeId: "claude-default",
        requestId: "request-claude",
      });
      expect(executionRouteSelection.getCatalog).not.toHaveBeenCalled();
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "execution_route_changed",
        routeId: "claude-default",
        requestId: "request-claude",
        providerId: "claude",
        providerModelId: "claude-sonnet-4-6",
      }));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("rejects the execution target wizard before reading the catalog without the existing operator capability", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const getCatalog = vi.fn(async () => ({ routes: [] }));
    const runExecutionTargetWizard = vi.fn();
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
        workingDirectory: distDir,
        getSnapshot: async () => ({ } as never),
        discoverOperatorProviders: async () => [],
       executionRouteSelection: { getCatalog } as never,
       runExecutionTargetWizard,
      operatorTransport: {
        ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });
      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onMessage!(new MessageEvent("message", {
        data: JSON.stringify({ type: "execution_target_wizard", requestId: "request-unauthorized" }),
      }), wsCtx);

      expect(getCatalog).not.toHaveBeenCalled();
      expect(runExecutionTargetWizard).not.toHaveBeenCalled();
      expect(JSON.parse(mockWs.send.mock.calls[0]![0] as string)).toMatchObject({
        type: "execution_target_wizard_result",
        requestId: "request-unauthorized",
        status: "rejected",
        code: "TARGET_CREATE_REJECTED",
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("passes an authenticated execution target wizard request through the handler boundary", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const getCatalog = vi.fn(async () => ({ routes: [] }));
    const runExecutionTargetWizard = vi.fn();
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
        workingDirectory: distDir,
        getSnapshot: async () => ({ } as never),
        discoverOperatorProviders: async () => [],
        executionRouteSelection: { getCatalog } as never,
        runExecutionTargetWizard,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });
      const token = gateway.operatorCapability;
      expect(token).toEqual(expect.any(String));
      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1", operatorToken: token! });
      await handlers.onMessage!(new MessageEvent("message", {
        data: JSON.stringify({
          type: "execution_target_wizard",
          requestId: "request-authenticated",
          expectedRevision: `sha256:${"c".repeat(64)}`,
          discoveryIdentity: {
            providerId: "provider",
            providerRouteId: "provider:direct",
            providerModelId: "model",
          },
          dataClassification: "public",
          dataPolicyConfirmed: true,
          action: "preview",
        }),
      }), wsCtx);

      expect(getCatalog).toHaveBeenCalledTimes(1);
      expect(runExecutionTargetWizard).not.toHaveBeenCalled();
      expect(JSON.parse(mockWs.send.mock.calls[0]![0] as string)).toMatchObject({
        type: "execution_target_wizard_result",
        requestId: "request-authenticated",
        status: "rejected",
        code: "TARGET_IDENTITY_CHANGED",
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("refreshes the execution-route catalog on request without reconnecting", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let routeAvailable = false;
    const executionRouteSelection: OperatorExecutionRouteSelectionPort = {
      getCatalog: vi.fn<OperatorExecutionRouteSelectionPort["getCatalog"]>(async () => ({
        routes: [{
          routeId: "openai-gpt",
          label: "OpenAI GPT",
          providerId: "openai",
          providerModelId: GPT4O,
          accountSelection: { mode: "automatic" as const, eligibleAccountCount: 1, allowOperatorOverride: true },
          availability: routeAvailable ? "available" as const : "unavailable" as const,
          reasonCodes: routeAvailable ? [] as const : ["missing-credentials"] as const,
          repairActions: routeAvailable ? [] as const : ["authenticate-provider"] as const,
        }],
      })),
      admit: vi.fn<OperatorExecutionRouteSelectionPort["admit"]>(async () => ({
        ok: true as const,
        admission: { routeId: "openai-gpt", providerId: "openai", providerModelId: GPT4O },
      })),
    };
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
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
       getProviderAvailability: () => ({ openai: true }),
       executionRouteSelection,
      operatorTransport: {
        ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);

      routeAvailable = true;
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "refresh_execution_routes" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "execution_routes_refreshed",
        executionRouteCatalog: {
          routes: [expect.objectContaining({ routeId: "openai-gpt", availability: "available" })],
        },
      }));
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("preserves gateway target identity when selecting a continuation session", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const onContinueSession = vi.fn();
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
        operatorTransport: {
          onContinueSession,
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
      await handlers.onOpen?.(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "continue",
            sessionId: "session-123",
            gatewayTargetId: "gateway:local-app",
          }),
        }),
        wsCtx,
      );

      expect(onContinueSession).toHaveBeenCalledWith("session-123", undefined);
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "continuation_selected",
        sessionId: "session-123",
        gatewayTargetId: "gateway:local-app",
      }));
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("does not publish execution routes in the fallback websocket welcome frame without operator transport", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
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
      });

      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection();
      await handlers.onOpen!(new Event("open"), wsCtx);

      expect(mockWs.send).toHaveBeenCalledTimes(1);

      const welcomeCall = mockWs.send.mock.calls[0]!;
      const welcomeFrame = JSON.parse(welcomeCall[0]) as {
        type: string;
        executionRouteCatalog?: { routes: unknown[] };
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.executionRouteCatalog?.routes ?? []).toEqual([]);
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("publishes the current execution-route catalog on welcome and refresh", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let routeAvailable = true;
    const executionRouteSelection = {
      getCatalog: vi.fn<OperatorExecutionRouteSelectionPort["getCatalog"]>(async () => ({
        routes: [{
          routeId: "openai-gpt",
          label: "OpenAI GPT",
          providerId: "openai",
          providerModelId: GPT4O,
          accountSelection: { mode: "automatic" as const, eligibleAccountCount: 1, allowOperatorOverride: true },
          availability: routeAvailable ? "available" as const : "unavailable" as const,
          reasonCodes: routeAvailable ? [] as const : ["missing-credentials"] as const,
          repairActions: routeAvailable ? [] as const : ["authenticate-provider"] as const,
        }],
      })),
      admit: vi.fn<OperatorExecutionRouteSelectionPort["admit"]>(async () => ({
        ok: true as const,
        admission: { routeId: "openai-gpt", providerId: "openai", providerModelId: GPT4O },
      })),
    };
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: GPT4O }] }),
    })));
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
        getProviderAvailability: () => ({ openai: true }),
        executionRouteSelection,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });
      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen!(new Event("open"), wsCtx);

      const welcomeCall = mockWs.send.mock.calls[0]!;
      const welcomeFrame = JSON.parse(welcomeCall[0]) as {
        type: string;
        executionRouteCatalog: {
          routes: Array<{ routeId: string; availability: string }>;
        };
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.executionRouteCatalog.routes).toEqual([
        expect.objectContaining({ routeId: "openai-gpt", availability: "available" }),
      ]);

      routeAvailable = false;
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "refresh_execution_routes" }),
        }),
        wsCtx,
      );
      const refreshFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          executionRouteCatalog?: {
            routes: Array<{ routeId: string; availability: string; reasonCodes: string[]; repairActions: string[] }>;
          };
        })
        .find((frame) => frame.type === "execution_routes_refreshed");

      expect(refreshFrame).toMatchObject({
        type: "execution_routes_refreshed",
        executionRouteCatalog: {
          routes: [expect.objectContaining({
            routeId: "openai-gpt",
            availability: "unavailable",
            reasonCodes: ["missing-credentials"],
            repairActions: ["authenticate-provider"],
          })],
        },
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("uses the runtime operator model resolver to advertise codex-oauth models", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({
        "codex-oauth": ["gpt-5.4-mini"],
      }));
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
        getProviderAvailability: () => ({ "codex-oauth": true }),
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "",
            setProvider: vi.fn(),
            getModel: () => "",
            setModel: vi.fn(),
          },
        },
      });
      await waitForCondition(
        () => gateway?.operatorModels?.["codex-oauth"]?.includes("gpt-5.4-mini") ?? false,
        "Expected codex-oauth models to be advertised after background discovery.",
      );

      expect(resolveGuiOperatorDiscoverySpy).toHaveBeenCalledWith(
        { "codex-oauth": true },
        undefined,
        undefined,
      );
      expect(gateway.operatorModels?.["codex-oauth"]).toEqual(["gpt-5.4-mini"]);
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});
