import "./gui-gateway-test-fixture.js";
import * as guiFixture from "./gui-gateway-test-fixture.js";
import {
  rmSync,
} from "node:fs";
import {
  GPT4O,
} from "@kilnai/core/agents";
import type {
  OperatorExecutionTargetSelectionPort,
} from "../../src/gateway/operator-execution-target-selection.js";
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
  it("publishes fresh startup discovery to an already-open surface", async () => {
    const distDir = createGuiDist();
    let resolveDiscovery: ((discovery: ReturnType<typeof makeGuiOperatorDiscoveryFromModels>) => void) | undefined;
    let discoveryResolved = false;
    const pendingDiscovery = new Promise<ReturnType<typeof makeGuiOperatorDiscoveryFromModels>>((resolve) => {
      resolveDiscovery = resolve;
    });
    const executionTargetSelection: OperatorExecutionTargetSelectionPort = {
      getTargets: vi.fn<OperatorExecutionTargetSelectionPort["getTargets"]>(async () => (discoveryResolved ? [{
          targetId: "codex-auto",
          label: "Codex Auto Review",
          providerId: "codex-oauth",
          providerModelId: "gpt-5.6-sol",
          access: "harness" as const,
          availability: "available" as const,
          reasonCodes: [],
          repairActions: [],
          eligibleAccountCount: 1,
          accountOverrideIds: [],
          cost: { kind: "subscription" as const },
        }] : [])),
      admit: vi.fn(),
    };
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({
        port: port ?? 4810,
        stop: vi.fn(),
      })),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;
    try {
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({ } as never),
        discoverOperatorProviders: () => pendingDiscovery,
        executionTargetSelection,
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
      const { handlers, mockWs, wsCtx } = guiSocketHarness.simulateConnection({ userId: "operator-startup" });
      await handlers.onOpen!(new Event("open"), wsCtx);
      expect(mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string))).toContainEqual({
        type: "provider_catalog_state",
        status: "pending",
      });

      discoveryResolved = true;
      resolveDiscovery?.(makeGuiOperatorDiscoveryFromModels({ "codex-oauth": ["gpt-5.6-sol"] }));
      await waitForCondition(
        () => mockWs.send.mock.calls.some(([payload]) => {
          const frame = JSON.parse(payload as string) as { type?: string; status?: string };
          return frame.type === "provider_catalog_state" && frame.status === "ready";
        }),
        "Expected background provider discovery to publish a ready catalog frame.",
      );
      const readyFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as Record<string, unknown>)
        .find((frame) => frame.type === "provider_catalog_state" && frame.status === "ready");
      expect(readyFrame).toMatchObject({
        modelCatalog: { models: [expect.objectContaining({ targets: [expect.objectContaining({ targetId: "codex-auto" })] })] },
        models: { "codex-oauth": ["gpt-5.6-sol"] },
      });
    } finally {
      resolveDiscovery?.([]);
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("acknowledges admitted execution-target selections", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ claude: [] }));
    const executionTargetSelection: OperatorExecutionTargetSelectionPort = {
      getTargets: vi.fn<OperatorExecutionTargetSelectionPort["getTargets"]>(async () => ([{
          targetId: "claude-default",
          label: "Claude",
          providerId: "claude",
          providerModelId: "claude-sonnet-4-6",
          access: "harness" as const,
          availability: "available" as const,
          reasonCodes: [],
          repairActions: [],
          eligibleAccountCount: 1,
          accountOverrideIds: [],
          cost: { kind: "subscription" as const },
        }])),
      admit: vi.fn<OperatorExecutionTargetSelectionPort["admit"]>(async () => ({
        ok: true as const,
        admission: {
          targetId: "claude-default",
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
        executionTargetSelection,
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
          data: JSON.stringify({ type: "execution_target", targetId: "claude-default", requestId: "request-claude" }),
        }),
        wsCtx,
      );

      expect(executionTargetSelection.admit).toHaveBeenCalledWith({
        type: "execution_target",
        targetId: "claude-default",
        requestId: "request-claude",
      });
      expect(executionTargetSelection.getTargets).not.toHaveBeenCalled();
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: "execution_target_changed",
        targetId: "claude-default",
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
    const getTargets = vi.fn(async () => []);
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
       executionTargetSelection: { getTargets } as never,
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

      expect(getTargets).not.toHaveBeenCalled();
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
    const getTargets = vi.fn(async () => []);
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
         executionTargetSelection: { getTargets } as never,
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

      expect(getTargets).toHaveBeenCalledTimes(1);
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

  it("refreshes the model catalog on request without reconnecting", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let targetAvailable = false;
    const executionTargetSelection: OperatorExecutionTargetSelectionPort = {
      getTargets: vi.fn<OperatorExecutionTargetSelectionPort["getTargets"]>(async () => ([{
          targetId: "openai-gpt",
          label: "OpenAI GPT",
          providerId: "openai",
          providerModelId: GPT4O,
          access: "api" as const,
          availability: targetAvailable ? "available" as const : "unavailable" as const,
          reasonCodes: targetAvailable ? [] as const : ["missing-credentials"] as const,
          repairActions: targetAvailable ? [] as const : ["authenticate-provider"] as const,
          eligibleAccountCount: targetAvailable ? 1 : 0,
          accountOverrideIds: [],
          cost: { kind: "metered" as const, currency: "USD" },
        }])),
      admit: vi.fn<OperatorExecutionTargetSelectionPort["admit"]>(async () => ({
        ok: true as const,
        admission: { targetId: "openai-gpt", providerId: "openai", providerModelId: GPT4O },
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
       executionTargetSelection,
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

      targetAvailable = true;
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "refresh_model_catalog", requestId: "refresh-available" }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "model_catalog_refreshed",
        requestId: "refresh-available",
        modelCatalog: expect.objectContaining({ models: expect.any(Array) }),
      }));

      vi.mocked(executionTargetSelection.getTargets).mockRejectedValueOnce(new Error("Account evidence unavailable."));
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "refresh_model_catalog", requestId: "refresh-failed" }),
        }),
        wsCtx,
      );
      expect(mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string))).toContainEqual({
        type: "model_catalog_refresh_failed",
        requestId: "refresh-failed",
        message: "Account evidence unavailable.",
      });
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

  it("does not publish execution targets in the fallback websocket welcome frame without operator transport", async () => {
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

      expect(mockWs.send).toHaveBeenCalledTimes(2);

      const welcomeCall = mockWs.send.mock.calls[0]!;
      const welcomeFrame = JSON.parse(welcomeCall[0]) as {
        type: string;
        modelCatalog?: { models: unknown[] };
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.modelCatalog?.models ?? []).toEqual([]);
      expect(JSON.parse(mockWs.send.mock.calls[1]![0] as string)).toMatchObject({
        type: "provider_catalog_state",
        status: "ready",
        modelCatalog: { models: [] },
      });
    } finally {
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("publishes the current model catalog on welcome and refresh", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    let targetAvailable = true;
    const executionTargetSelection = {
      getTargets: vi.fn<OperatorExecutionTargetSelectionPort["getTargets"]>(async () => ([{
          targetId: "openai-gpt",
          label: "OpenAI GPT",
          providerId: "openai",
          providerModelId: GPT4O,
          access: "api" as const,
          availability: targetAvailable ? "available" as const : "unavailable" as const,
          reasonCodes: targetAvailable ? [] as const : ["missing-credentials"] as const,
          repairActions: targetAvailable ? [] as const : ["authenticate-provider"] as const,
          eligibleAccountCount: targetAvailable ? 1 : 0,
          accountOverrideIds: [],
          cost: { kind: "metered" as const, currency: "USD" },
        }])),
      admit: vi.fn<OperatorExecutionTargetSelectionPort["admit"]>(async () => ({
        ok: true as const,
        admission: { targetId: "openai-gpt", providerId: "openai", providerModelId: GPT4O },
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
        executionTargetSelection,
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
        modelCatalog: {
          models: Array<{ targets: Array<{ targetId: string; availability: string }> }>;
        };
      };

      expect(welcomeFrame.type).toBe("welcome");
      expect(welcomeFrame.modelCatalog.models.flatMap((model) => model.targets)).toEqual([
        expect.objectContaining({ targetId: "openai-gpt", availability: "available" }),
      ]);

      targetAvailable = false;
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "refresh_model_catalog", requestId: "refresh-unavailable" }),
        }),
        wsCtx,
      );
      const refreshFrame = mockWs.send.mock.calls
        .map(([payload]) => JSON.parse(payload as string) as {
          type: string;
          modelCatalog?: {
            models: Array<{ targets: Array<{ targetId: string; availability: string; reasonCodes: string[]; repairActions: string[] }> }>;
          };
        })
        .find((frame) => frame.type === "model_catalog_refreshed");

      expect(refreshFrame).toMatchObject({
        type: "model_catalog_refreshed",
        requestId: "refresh-unavailable",
        modelCatalog: expect.objectContaining({
          models: [expect.objectContaining({ targets: [expect.objectContaining({
            targetId: "openai-gpt",
            availability: "unavailable",
            reasonCodes: ["missing-credentials"],
            repairActions: ["authenticate-provider"],
          })] })],
        }),
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
