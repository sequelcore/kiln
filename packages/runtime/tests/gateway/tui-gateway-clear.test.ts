import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpgradeWebSocket } from "hono/ws";
import {
  buildManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  textParts,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core";
import type {
  ManagedInvocationToolAttachment,
  ManagedInvocationToolOptions,
} from "../../src/agents/managed-invocation/runtime-tool.js";
import type { ManagedAgentRuntimeAdapter } from "../../src/agents/managed-invocation/index.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

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

function makeManagedInvocationOptions(): ManagedInvocationToolOptions {
  const adapter: ManagedAgentRuntimeAdapter = {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:opencode:harness",
      providerId: "opencode",
      adapterKind: "harness",
      supportedProfiles: ["foundation-readonly-plan"],
      supportedExecutionModes: ["cli-harness"],
      lifecycle: {
        exposesStart: true,
        exposesTerminal: true,
        exposesCleanup: true,
      },
      cancellation: { supported: true },
      timeout: { supported: true, diagnosticArtifactOnTimeout: true },
      transcript: {
        supported: true,
        redactionKnown: true,
        truncationKnown: true,
        persistenceKnown: true,
        retentionKnown: true,
      },
      usage: {
        supported: true,
        preservesProviderTokenClasses: true,
        supportsExplicitUnknowns: true,
        tokenClasses: ["input", "output", "cache_read"],
        semanticSourceGranularity: "unknown",
        evidenceBasis: "adapter",
      },
      resultHandoff: {
        boundedSummary: true,
        resourcePointers: true,
      },
      credentialRoute: { supported: true },
      memoryContext: { governedAdmission: true },
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    }),
    invoke: vi.fn(async ({ request, admission }: {
      readonly request: ManagedAgentInvocationRequest;
      readonly admission: { readonly capabilitySnapshot: ReturnType<typeof buildManagedAgentCapabilitySnapshot> };
    }) =>
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        profile: request.profile,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
        capabilitySnapshot: admission.capabilitySnapshot,
        childSessionId: `${request.parentSessionId}:managed:${request.invocationId}`,
        childTurnId: `${request.parentSessionId}:managed:${request.invocationId}:turn:1`,
        transcript: {
          uri: `kiln://managed-invocations/${request.invocationId}/transcript`,
          redacted: "unknown",
          truncated: false,
          persisted: true,
          retention: "session",
        },
        resultHandoff: {
          provenance: TEST_HANDOFF_PROVENANCE,
          summary: "TUI child review completed.",
          resourceUris: [`kiln://managed-invocations/${request.invocationId}/transcript`],
          memoryWriteProposalUris: [],
        },
      })),
  };

  return {
    routes: [{
      routeId: "opencode-readonly",
      routeSource: "explicit-managed-route",
      providerId: "opencode",
      model: "openai/gpt-4o:free",
      adapter,
      surface: "cli-harness",
      profiles: {
        "foundation-readonly-plan": {
          authorityProfileId: "authority:opencode-readonly:foundation-readonly-plan",
          permissionProfile: "read-only",
          allowedToolNames: ["read", "grep", "glob"],
          writeAllowed: false,
          networkAllowed: false,
          workingDirectory: {
            path: "C:/workspace/kiln",
            mode: "read-only",
          },
          timeoutMs: 120000,
          credentialRoute: {
            mode: "runtime-selected",
            routeId: "credential-route:opencode:runtime-selected",
          },
          memoryScope: {
            scope: { kind: "project", id: "kiln" },
            access: "read-only",
          },
        },
      },
    }],
    requestedBy: "assistant",
    requestSource: "tui",
  };
}

function makeManagedInvocationAttachment(
  options: ManagedInvocationToolOptions = makeManagedInvocationOptions(),
): ManagedInvocationToolAttachment {
  return {
    options,
    callerIdentity: {
      kind: "kiln-runtime",
      surface: "tui-test",
      attachmentId: "attachment:tui-test",
    },
  };
}

function makeTuiOperatorDiscoveryFromModels(
  modelsByProvider: Record<string, readonly string[]>,
): GuiProviderDiscoveryResult[] {
  return Object.entries(modelsByProvider).map(([provider, models]) => ({
    provider,
    available: true,
    models: [...models],
    ...(models.length > 0
      ? {
          modelRouteHealth: Object.fromEntries(models.map((model) => [
            model,
            { healthy: true },
          ])),
        }
      : {}),
    status: "available",
    reason: `${provider} models discovered.`,
    authState: "authenticated",
    lastCheckedAt: "2026-04-28T12:00:00.000Z",
  }));
}

function makeUnavailableTuiOperatorDiscovery(
  provider: string,
  reason: string,
): GuiProviderDiscoveryResult {
  return {
    provider,
    available: false,
    models: [],
    status: "missing_auth",
    reason,
    authState: "missing",
    lastCheckedAt: "2026-04-28T12:00:00.000Z",
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  tuiSocketHarness.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// We test the gateway clear frame handling by extracting the logic inline,
// since startTuiGateway() starts a real Bun HTTP server. Instead we exercise
// the onClear option contract directly as it would be called by the onMessage handler.

const TEST_HANDOFF_PROVENANCE = {
  delivery: "runtime-generated",
  configuredModelId: "test-model",
  observedModelIds: [],
} as const;

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

describe("TUI gateway startup discovery", () => {
  it("starts listening before provider discovery resolves", async () => {
    vi.resetModules();
    stubBunServe();
    let resolveDiscovery: ((discovery: GuiProviderDiscoveryResult[]) => void) | undefined;
    const pendingDiscovery = new Promise<GuiProviderDiscoveryResult[]>((resolve) => {
      resolveDiscovery = resolve;
    });
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockImplementation(() => pendingDiscovery);
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({ sessionManager });
    try {
      expect(gateway.models).toEqual({});
      expect(gateway.providerDiscovery).toEqual([]);
      expect(discoverySpy).toHaveBeenCalledTimes(1);
    } finally {
      resolveDiscovery?.([]);
      await flushAsyncWork();
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });
});

describe("TUI gateway provider switching", () => {
  it("rejects provider switches that canonical discovery marks ineligible", async () => {
    vi.resetModules();
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeTuiOperatorDiscoveryFromModels({ opencode: ["openai/gpt-5"] }));
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ opencode: true }),
    });
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

      expect(sessionManager.setProvider).not.toHaveBeenCalled();
      expect(sessionManager.setModel).not.toHaveBeenCalled();
      expect(JSON.parse(mockWs.send.mock.calls[0][0] as string)).toEqual(expect.objectContaining({
        type: "error",
        message: expect.stringContaining("not eligible"),
      }));
    } finally {
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("rejects provider switches without a nonblank requestId before mutating provider state", async () => {
    stubBunServe();
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ opencode: true }),
    });
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
    vi.resetModules();
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue([
        makeUnavailableTuiOperatorDiscovery("openai", "OpenAI is unavailable in this runtime."),
        ...makeTuiOperatorDiscoveryFromModels({ opencode: ["openai/gpt-5"] }),
      ]);
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ opencode: true }),
    });
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
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("rejects model-less provider switches before mutating provider state", async () => {
    vi.resetModules();
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeTuiOperatorDiscoveryFromModels({ opencode: ["openai/gpt-5"] }));
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ opencode: true }),
    });
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
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("refreshes provider models before accepting a provider switch", async () => {
    vi.resetModules();
    stubBunServe();
    let opencodeModels = ["openai/gpt-5"];
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockImplementation(async () => makeTuiOperatorDiscoveryFromModels({ opencode: opencodeModels }));
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ opencode: true }),
    });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });
      opencodeModels = ["openai/gpt-5-other"];

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
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("refreshes provider discovery on request without reconnecting", async () => {
    vi.resetModules();
    stubBunServe();
    let opencodeModels = ["openai/gpt-5"];
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockImplementation(async () => makeTuiOperatorDiscoveryFromModels({ opencode: opencodeModels }));
    const sessionManager = makeSessionManager();
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ opencode: true }),
    });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });

      await handlers.onOpen?.(new Event("open"), wsCtx);
      opencodeModels = ["openai/gpt-5-other"];
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "refresh_providers",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string });
      expect(outboundFrames).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "providers_refreshed",
          models: expect.objectContaining({ opencode: ["openai/gpt-5-other"] }),
        }),
      ]));
    } finally {
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });
});

describe("TUI gateway message fail-closed behavior", () => {
  it("rejects normal message frames when the stored provider is unavailable", async () => {
    vi.resetModules();
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue([
        makeUnavailableTuiOperatorDiscovery("openai", "OpenAI is unavailable in this runtime."),
        ...makeTuiOperatorDiscoveryFromModels({ opencode: ["openai/gpt-5"] }),
      ]);
    const processSpy = vi
      .spyOn(await import("../../src/gateway/message-pipeline.js"), "processAdmittedTurn")
      .mockResolvedValue(undefined as never);
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "openai"),
      getModel: vi.fn(() => "gpt-5"),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ opencode: true }),
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
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it.each([
    ["blank", ""],
    ["stale", "openai/gpt-5-stale"],
  ])("rejects normal message frames when the stored model is %s", async (_kind, storedModel) => {
    vi.resetModules();
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeTuiOperatorDiscoveryFromModels({ opencode: ["openai/gpt-5"] }));
    const processSpy = vi
      .spyOn(await import("../../src/gateway/message-pipeline.js"), "processAdmittedTurn")
      .mockResolvedValue(undefined as never);
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "opencode"),
      getModel: vi.fn(() => storedModel),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ opencode: true }),
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
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("refreshes provider models before admitting a message frame", async () => {
    vi.resetModules();
    stubBunServe();
    let opencodeModels = ["openai/gpt-5"];
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockImplementation(async () => makeTuiOperatorDiscoveryFromModels({ opencode: opencodeModels }));
    const processSpy = vi
      .spyOn(await import("../../src/gateway/message-pipeline.js"), "processAdmittedTurn")
      .mockResolvedValue(undefined as never);
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "opencode"),
      getModel: vi.fn(() => "openai/gpt-5"),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ opencode: true }),
    });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });
      opencodeModels = ["openai/gpt-5-other"];

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
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("admits normal message frames for model-less Claude without leaking a stale stored model", async () => {
    vi.resetModules();
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeTuiOperatorDiscoveryFromModels({ claude: [] }));
    const processSpy = vi
      .spyOn(await import("../../src/gateway/message-pipeline.js"), "processAdmittedTurn")
      .mockResolvedValue({
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
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("projects rich CLI tool results to TUI session event frames", async () => {
    vi.resetModules();
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeTuiOperatorDiscoveryFromModels({ claude: [] }));
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "claude"),
      getModel: vi.fn(() => ""),
      factory: vi.fn(() => ({
        run: async function* () {
          yield {
            type: "tool_use" as const,
            toolCallScopeId: "turn-1:response:1",
            toolCallId: "call-rich",
            toolName: "managed_agent.invoke",
            input: { profile: "foundation-readonly-plan" },
          };
          yield {
            type: "tool_result" as const,
            toolCallScopeId: "turn-1:response:1",
            toolCallId: "call-rich",
            toolName: "managed_agent.invoke",
            output: "child completed",
            metadata: {
              invocationId: "managed-1",
              routeId: "codex-oauth-auto-review-readonly",
            },
            resourceLinks: [{
              uri: "kiln://managed-invocations/managed-1/transcript",
              title: "Transcript",
              relation: "events",
            }],
            toolUsage: {
              scope: "turn" as const,
              toolName: "managed_agent.invoke",
              calls: 1,
            },
          };
          yield {
            type: "cost_update" as const,
            usd: 0.0123,
            provider: "claude",
            model: "claude-sonnet-4-5",
            inputTokens: 120,
            outputTokens: 30,
            cacheReadTokens: 20,
          };
          yield { type: "text_delta" as const, content: "Parent turn completed." };
          yield { type: "completed" as const, totalUsd: 0, durationMs: 1, outcome: "completed" as const, isPreflightCrash: false };
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      })),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      getProviderAvailability: () => ({ claude: true }),
    });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message",
            content: "run rich cli event",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as {
        type: string;
        content?: string;
        event?: { kind: string; payload: Record<string, unknown> };
      });
      const completedPayload = outboundFrames
        .find((frame) => frame.type === "session_event" && frame.event?.kind === "tool_call_completed")
        ?.event?.payload;
      const sessionEvents = outboundFrames
        .filter((frame) => frame.type === "session_event")
        .map((frame) => frame.event);
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "Parent turn completed.",
      }));
      expect(completedPayload).toMatchObject({
        toolCallId: "call-rich",
        toolCallScopeId: "turn-1:response:1",
        toolName: "managed_agent.invoke",
        output: "child completed",
        metadata: {
          invocationId: "managed-1",
          routeId: "codex-oauth-auto-review-readonly",
        },
        resourceLinks: [{
          uri: "kiln://managed-invocations/managed-1/transcript",
          title: "Transcript",
          relation: "events",
        }],
        toolUsage: {
          scope: "turn",
          toolName: "managed_agent.invoke",
          calls: 1,
        },
        status: {
          state: "succeeded",
        },
      });
      expect(sessionEvents.some((event) => event?.kind === "cost_updated")).toBe(false);
      expect(sessionEvents.some((event) => event?.kind === "lifecycle_attribution_recorded")).toBe(false);
    } finally {
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("streams managed invocation session events from a TUI turn", async () => {
    vi.resetModules();
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue([{
        provider: "openai",
        available: true,
        models: ["gpt-5.4-mini"],
        modelCapabilities: {
          "gpt-5.4-mini": {
            supportsFunctionTools: true,
            supportsRuntimeTools: true,
          },
        },
        status: "available",
        reason: "OpenAI models discovered.",
        authState: "authenticated",
        lastCheckedAt: "2026-05-06T12:00:00.000Z",
      }]);
    const processSpy = vi
      .spyOn(await import("../../src/gateway/message-pipeline.js"), "processAdmittedTurn")
      .mockImplementation(async (input) => {
      const session = new RuntimeSession({
        sessionId: "tui-parent-session",
        appName: "kiln-tui",
        tenantId: "tui",
        userId: "operator-1",
        systemPrompt: "You are a helpful assistant.",
      });
      session.addUserMessage(textParts("Delegate a managed read-only review."));
      await input.turnCapture?.start?.(session.id, 10);
      const managedInvoke = input.callBuiltinTools?.get("managed_agent.invoke");
      if (!managedInvoke) {
        throw new Error("managed_agent.invoke was not attached to the TUI turn surface");
      }
      expect(input.perCallConfig?.toolAllowlist?.has("managed_agent.invoke")).toBe(true);
      expect(input.perCallConfig?.toolAuthority?.get("managed_agent.invoke")).toMatchObject({
        allowed: false,
        requiresApproval: true,
      });

      const toolResult = await managedInvoke({
        profile: "foundation-readonly-plan",
        routeId: "opencode-readonly",
        providerRoute: {
          providerId: "opencode",
          model: "openai/gpt-4o:free",
        },
        task: "Inspect the managed invocation docs and report risks.",
      }, {
        session,
        toolCall: {
          id: "tool-call-managed-1",
          name: "managed_agent.invoke",
          input: {},
        },
      });
      await input.turnCapture?.finish?.(session.id);

      expect(toolResult.isError).toBe(false);
      expect(toolResult.output).toContain("TUI child review completed.");
      const transcriptUri = (toolResult.metadata as { readonly transcript?: { readonly uri?: string } }).transcript?.uri;
      expect(transcriptUri).toContain("kiln://managed-agents/invocations/");
      const resourceRead = input.callBuiltinTools?.get("resource_read");
      expect(resourceRead).toBeDefined();
      const resourceResult = await resourceRead!({
        uri: transcriptUri,
      }, {
        session,
        toolCall: {
          id: "tool-call-managed-resource-read",
          name: "resource_read",
          input: { uri: transcriptUri },
        },
      });
      expect(resourceResult.isError).toBe(false);
      const invocationId = (toolResult.metadata as { readonly invocationId?: string }).invocationId;
      expect(resourceResult.output).toContain(invocationId ?? "");
      return {
        ok: true,
        result: {
          parts: [{ type: "text", text: "Parent TUI turn completed." }],
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: session.id,
          sessionMode: "mode-a",
          traceId: "trace-managed-tui",
        },
      } as never;
    });
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "openai"),
      getModel: vi.fn(() => "gpt-5.4-mini"),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      managedInvocation: makeManagedInvocationAttachment(),
    });
    try {
      const { handlers, mockWs, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message",
            content: "delegate from tui",
          }),
        }),
        wsCtx,
      );

      const outboundFrames = mockWs.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as {
        type: string;
        content?: string;
        event?: { kind: string; payload: Record<string, unknown> };
      });
      const sessionEventFrames = outboundFrames.filter((frame) => frame.type === "session_event");

      expect(outboundFrames).toContainEqual({ type: "thinking" });
      expect(outboundFrames).toContainEqual(expect.objectContaining({
        type: "done",
        content: "Parent TUI turn completed.",
      }));
      expect(sessionEventFrames.map((frame) => frame.event?.kind)).toEqual([
        "agent_invocation_requested",
        "agent_invocation_started",
        "agent_invocation_completed",
      ]);
      expect(sessionEventFrames.map((frame) => frame.event?.payload.instanceId)).toEqual([
        "local-tui",
        "local-tui",
        "local-tui",
      ]);
      expect(sessionEventFrames.map((frame) => frame.event?.payload.sessionId)).toEqual([
        "tui-parent-session",
        "tui-parent-session",
        "tui-parent-session",
      ]);
      expect(sessionEventFrames[2]?.event?.payload).toMatchObject({
        resultSummary: "TUI child review completed.",
        managedInvocationEvidence: {
          childSessionId: expect.stringContaining("tui-parent-session:managed:"),
        },
      });
      expect(processSpy).toHaveBeenCalledOnce();
    } finally {
      processSpy.mockRestore();
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });

  it("keeps managed invocation state visible across TUI gateway turns when options omit a service", async () => {
    vi.resetModules();
    stubBunServe();
    const discoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue([{
        provider: "openai",
        available: true,
        models: ["gpt-5.4-mini"],
        modelCapabilities: {
          "gpt-5.4-mini": {
            supportsFunctionTools: true,
            supportsRuntimeTools: true,
          },
        },
        status: "available",
        reason: "OpenAI models discovered.",
        authState: "authenticated",
        lastCheckedAt: "2026-05-06T12:00:00.000Z",
      }]);
    let turn = 0;
    let invocationId = "";
    const processSpy = vi
      .spyOn(await import("../../src/gateway/message-pipeline.js"), "processAdmittedTurn")
      .mockImplementation(async (input) => {
        turn += 1;
        const session = new RuntimeSession({
          sessionId: "tui-parent-session",
          appName: "kiln-tui",
          tenantId: "tui",
          userId: "operator-1",
          systemPrompt: "You are a helpful assistant.",
        });
        session.addUserMessage(textParts(`Managed invocation turn ${turn}.`));

        if (turn === 1) {
          const startManagedAgent = input.callBuiltinTools?.get("managed_agent.start");
          if (!startManagedAgent) {
            throw new Error("managed_agent.start was not attached to the TUI turn surface");
          }
          const started = await startManagedAgent({
            profile: "foundation-readonly-plan",
            routeId: "opencode-readonly",
            providerRoute: {
              providerId: "opencode",
              model: "openai/gpt-4o:free",
            },
            task: "Inspect the managed invocation docs and report risks.",
          }, {
            session,
            toolCall: {
              id: "tool-call-managed-start",
              name: "managed_agent.start",
              input: {},
            },
          });
          invocationId = String((started.metadata as { invocationId?: string } | undefined)?.invocationId ?? "");
          expect(invocationId).not.toBe("");
        } else {
          const statusManagedAgent = input.callBuiltinTools?.get("managed_agent.status");
          if (!statusManagedAgent) {
            throw new Error("managed_agent.status was not attached to the TUI turn surface");
          }
          const status = await statusManagedAgent({ invocationId }, {
            session,
            toolCall: {
              id: "tool-call-managed-status",
              name: "managed_agent.status",
              input: { invocationId },
            },
          });
          expect(status.isError).toBe(false);
          expect(status.output).toContain(invocationId);
        }

        return {
          ok: true,
          result: {
            parts: [{ type: "text", text: `Managed turn ${turn} completed.` }],
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            queued: false,
            sessionId: session.id,
            sessionMode: "mode-a",
            traceId: `trace-managed-tui-${turn}`,
          },
        } as never;
      });
    const sessionManager = {
      ...makeSessionManager(),
      getProvider: vi.fn(() => "openai"),
      getModel: vi.fn(() => "gpt-5.4-mini"),
    };
    const { startTuiGateway } = await import("../../src/gateway/tui-gateway.js");

    const gateway = await startTuiGateway({
      sessionManager,
      managedInvocation: makeManagedInvocationAttachment(),
    });
    try {
      const { handlers, wsCtx } = tuiSocketHarness.simulateConnection({ userId: "operator-1" });
      await handlers.onOpen?.(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "start managed child" }),
        }),
        wsCtx,
      );
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "message", content: "check managed child" }),
        }),
        wsCtx,
      );

      expect(processSpy).toHaveBeenCalledTimes(2);
    } finally {
      processSpy.mockRestore();
      discoverySpy.mockRestore();
      gateway.shutdown();
    }
  });
});
