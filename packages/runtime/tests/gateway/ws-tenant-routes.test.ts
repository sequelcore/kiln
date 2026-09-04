import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWsTenantRoutes } from "../../src/gateway/ws-tenant-routes.js";
import type { WsTenantRoutesConfig } from "../../src/gateway/ws-tenant-routes.js";
import { WebChannel } from "../../src/channels/web-channel.js";
import type { UpgradeWebSocket } from "hono/ws";
import type { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import type { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import type { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import type { ToolDefinition } from "@kilnai/core/agents";
import { type Capability, type SttAdapter, type TenantConfig, textParts } from "@kilnai/core/engine";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { makeGatewayTestAdmission } from "./gateway-test-admission.js";
import type {
  GatewayAuthorityAdmissionCommit,
  GatewayAuthorityAdmissionPort,
  GatewayAuthorityAdmissionRequest,
} from "../../src/gateway/gateway-authority-admission.js";
import { canonicalTurnDisposition } from "../session/canonical-turn-fixture.js";

const completedDisposition = canonicalTurnDisposition("completed");
const noProgressDisposition = {
  outcome: "paused",
  dispositionReason: "no_progress",
  convergence: {
    ...completedDisposition.convergence,
    pause: {
      status: "pause",
      reason: "no_progress",
      metric: "consecutiveNoProgressSteps",
      observed: 3,
      limit: 3,
    },
  },
} as const;
const requiredProducerNotRunDisposition = {
  outcome: "paused",
  dispositionReason: "required_producer_not_run",
  completion: {
    obligations: [{
      kind: "required_producer",
      obligationId: "required-producer:formal_verify",
      canonicalToolId: "formal_verify",
      acceptedEquivalentToolIds: [],
      sourceAlias: "Dafny",
    }],
    producerEvidence: [],
    eligibility: {
      status: "ineligible",
      unmet: [{
        obligationId: "required-producer:formal_verify",
        canonicalToolId: "formal_verify",
        sourceAlias: "Dafny",
        status: "not_run",
      }],
    },
  },
  convergence: completedDisposition.convergence,
} as const;

const { mockedToolAuthority, mockedResolveAgentContextAsync } = vi.hoisted(() => {
  const toolAuthority = new Map([["mock_tool", {
    level: 2,
    allowed: true,
    requiresApproval: false,
    reason: "Audited execution",
  }]]);

  return {
    mockedToolAuthority: toolAuthority,
    mockedResolveAgentContextAsync: vi.fn(),
  };
});

vi.mock("../../src/tenant/agent-resolver.js", () => ({
  resolveAgentContextAsync: mockedResolveAgentContextAsync,
}));

const TEST_APP = "kilvo";
const WIDGET_ID = "widget-uuid-abc";
const hash = (character: string) => `sha256:${character.repeat(64)}`;

const providerRequestEvidence = {
  requestIndex: 0,
  providerId: "codex-oauth",
  modelId: "gpt-5.6-sol",
  inputTokens: 3,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cumulativeInputTokens: 3,
  cumulativeOutputTokens: 2,
  cumulativeCacheReadTokens: 0,
  cumulativeCacheWriteTokens: 0,
  systemBytes: 3,
  messageBytes: 2,
  toolSchemaBytes: 0,
  systemHash: hash("1"),
  messageHash: hash("2"),
  toolSchemaHash: hash("3"),
  stablePrefixHash: hash("4"),
  stablePrefixBytes: 3,
  stablePrefixRegionCount: 1,
  volatileRegionBytes: 2,
  cacheRegions: [],
  cachePartition: { hash: hash("9"), dimensions: [] },
  toolCount: 0,
  effectivePrompt: {
    version: "v1" as const,
    components: [{
      id: hash("5"),
      revision: hash("6"),
      scope: "dynamic" as const,
      estimatedTokens: 3,
      provenance: { source: hash("7") },
    }],
    finalPromptHash: hash("8"),
    estimatedTokens: 3,
  },
};

function makeToolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties: {},
    },
    tags: new Set(["test"]),
  };
}

function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "salon-test",
    appName: TEST_APP,
    name: "Test Salon",
    widgetId: WIDGET_ID,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Simulates the upgradeWebSocket middleware -- captures the factory for direct invocation.
 */
function makeUpgradeWebSocket() {
  type MockWebSocket = {
    readonly send: ReturnType<typeof vi.fn>;
    readyState: number;
    readonly close: ReturnType<typeof vi.fn>;
  };
  type Handlers = {
    readonly onOpen?: (event: Event, ws: MockWebSocket) => void | Promise<void>;
    readonly onMessage?: (event: MessageEvent, ws: MockWebSocket) => void | Promise<void>;
    readonly onClose?: (event: CloseEvent, ws: MockWebSocket) => void | Promise<void>;
  };
  type HandlerFactory = (context: unknown) => Handlers;
  let capturedFactory: HandlerFactory | null = null;

  const upgradeWebSocket = ((factory: unknown) => {
    capturedFactory = factory as HandlerFactory;
    return async (_c: unknown, next: () => Promise<void>) => next();
  }) as UpgradeWebSocket;

  function simulateConnection(queryParams: Record<string, string> = {}) {
    if (!capturedFactory) throw new Error("upgradeWebSocket not called yet");

    const url = new URL("http://localhost/ws");
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }

    const ctx = {
      req: {
        query: (key: string) => url.searchParams.get(key) ?? undefined,
      },
    };

    const handlers = capturedFactory(ctx);
    const mockWs: MockWebSocket = { send: vi.fn(), readyState: 1, close: vi.fn() };
    return { handlers, mockWs, wsCtx: mockWs };
  }

  return { upgradeWebSocket, simulateConnection };
}

async function sendWsRequest(
  app: ReturnType<typeof createWsTenantRoutes>,
  queryParams: Record<string, string> = {},
): Promise<Response> {
  const url = new URL("http://localhost/ws");
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, v);
  }
  return app.request(url.toString());
}

function makeConfig(
  channel: WebChannel,
  upgradeWebSocket: UpgradeWebSocket,
  tenantRegistry: TenantRegistry,
  sessionRegistry: SessionRegistry,
  orchestrator: RuntimeSessionOrchestrator,
  overrides: Partial<WsTenantRoutesConfig> = {},
): WsTenantRoutesConfig {
  return {
    webChannel: channel,
    upgradeWebSocket,
    appName: TEST_APP,
    orchestrator,
    sessionRegistry,
    tenantRegistry,
    gatewayAdmission: makeGatewayTestAdmission(sessionRegistry),
    ...overrides,
  };
}

function observeAdmissionFence(
  config: WsTenantRoutesConfig,
  state: { active: boolean; outboundWhileActive: boolean },
): WsTenantRoutesConfig {
  const base = config.gatewayAdmission;
  return {
    ...config,
    gatewayAdmission: {
      channelEgressActionClaims: base.channelEgressActionClaims,
      async execute<Result>(
        request: GatewayAuthorityAdmissionRequest,
        dispatch: (commit: GatewayAuthorityAdmissionCommit) => Promise<Result>,
      ): Promise<Result> {
        return base.execute(request, async (commit) => {
          state.active = true;
          try {
            return await dispatch(commit);
          } finally {
            state.active = false;
          }
        });
      },
    } satisfies GatewayAuthorityAdmissionPort,
  };
}

describe("createWsTenantRoutes", () => {
  let channel: WebChannel;
  let mockTenantRegistry: TenantRegistry;
  let mockSessionRegistry: SessionRegistry;
  let mockOrchestrator: RuntimeSessionOrchestrator;
  let mockSession: RuntimeSession;

  beforeEach(() => {
    mockedResolveAgentContextAsync.mockReset();
    mockedResolveAgentContextAsync.mockResolvedValue({
      systemPrompt: "Mock system prompt",
      tenantToolContext: {
        callBuiltinTools: new Map(),
        toolDefinitions: [],
        capabilities: new Map(),
        toolAuthority: mockedToolAuthority,
        toolAllowlist: undefined,
        rateLimiter: undefined,
        executionEnvelope: undefined,
      },
      isHandoff: false,
    });

    channel = new WebChannel();

    mockTenantRegistry = {
      resolveByWidgetId: vi.fn(),
    } as unknown as TenantRegistry;

    mockSession = new RuntimeSession({ sessionId: "sess-1", appName: TEST_APP, userId: "user-1", tenantId: "salon-test", systemPrompt: "Mock system prompt" });
    vi.spyOn(mockSession, "setSystemPrompt");

    mockSessionRegistry = {
      getOrCreate: vi.fn().mockResolvedValue(mockSession),
      getById: vi.fn().mockResolvedValue(mockSession),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionRegistry;

    mockOrchestrator = {
      model: "claude-sonnet-4-6",
      registerTools: vi.fn(),
      bindProvider: vi.fn(),
      processMessage: vi.fn().mockResolvedValue({
        parts: textParts("Hello from agent"),
        ...completedDisposition,
        inputTokens: 10,
        outputTokens: 20,
      }),
    } as unknown as RuntimeSessionOrchestrator;
    vi.mocked(mockOrchestrator.bindProvider).mockReturnValue(mockOrchestrator);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("widgetId validation", () => {
    it("returns 400 when widgetId query param is missing", async () => {
      const { upgradeWebSocket } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(undefined);

      const app = createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const res = await sendWsRequest(app, {});
      expect(res.status).toBe(400);
    });

    it("returns 404 when widgetId doesn't resolve to a tenant", async () => {
      const { upgradeWebSocket } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(undefined);

      const app = createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const res = await sendWsRequest(app, { widgetId: "unknown-widget" });
      expect(res.status).toBe(404);
    });

    it("passes pre-upgrade middleware when widgetId resolves to a tenant", async () => {
      const { upgradeWebSocket } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      const app = createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const res = await sendWsRequest(app, { widgetId: WIDGET_ID });
      // Middleware passes through (no 400 for widgetId, no 404 for widget not found).
      // Hono returns 404 after the no-op upgradeWebSocket in test context -- that's expected.
      expect(res.status).not.toBe(400);
      // Verify resolveByWidgetId was called (meaning the middleware ran correctly)
      expect(mockTenantRegistry.resolveByWidgetId).toHaveBeenCalledWith(WIDGET_ID, TEST_APP);
    });
  });

  describe("connection lifecycle", () => {
    it("adds client to webChannel on open", () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      expect(channel.clientCount).toBe(1);
    });

    it("removes client from webChannel on close", () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);
      expect(channel.clientCount).toBe(1);

      handlers.onClose!((new Event("close") as unknown as CloseEvent), wsCtx);
      expect(channel.clientCount).toBe(0);
    });
  });

  describe("userId resolution", () => {
    it("uses userId from query param when provided", () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "explicit-user" });
      handlers.onOpen!(new Event("open"), wsCtx);

      expect(channel.clientCount).toBe(1);
      // Session should be created with the explicit userId
      // (we confirm via message processing below)
    });

    it("generates random userId when not provided", () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID });
      handlers.onOpen!(new Event("open"), wsCtx);

      expect(channel.clientCount).toBe(1);
    });
  });

  describe("message processing", () => {
    it("rejects consequential audio without a stable client message identity", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());
      const sttAdapter: SttAdapter = {
        name: "test-stt",
        transcribe: vi.fn(),
      };

      createWsTenantRoutes(makeConfig(
        channel,
        upgradeWebSocket,
        mockTenantRegistry,
        mockSessionRegistry,
        mockOrchestrator,
        { sttAdapter },
      ));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message",
            parts: [{ type: "audio", mimeType: "audio/wav", data: "AQID" }],
          }),
        }),
        wsCtx,
      );

      expect(sttAdapter.transcribe).not.toHaveBeenCalled();
      expect(mockOrchestrator.processMessage).not.toHaveBeenCalled();
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it("processes message frames via orchestrator with tenant's system prompt", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const tenant = makeTenantConfig();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(tenant);

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hello" }) }),
        wsCtx,
      );

      expect(mockOrchestrator.processMessage).toHaveBeenCalledOnce();
      const [session, parts, governedContext] = vi.mocked(mockOrchestrator.processMessage).mock.calls[0]!;
      expect(session).toBe(mockSession);
      expect(parts).toEqual(textParts("hello"));
      expect(governedContext).toEqual(expect.objectContaining({
        audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
      }));
    });

    it("claims one assistant frame for concurrent duplicate message identities", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(
        channel,
        upgradeWebSocket,
        mockTenantRegistry,
        mockSessionRegistry,
        mockOrchestrator,
      ));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);
      const message = new MessageEvent("message", {
        data: JSON.stringify({ type: "message", content: "hello", messageId: "duplicate-message" }),
      });

      await Promise.all([
        handlers.onMessage!(message, wsCtx),
        handlers.onMessage!(message, wsCtx),
      ]);

      expect(mockWs.send).toHaveBeenCalledOnce();
      expect(JSON.parse(mockWs.send.mock.calls[0]![0] as string)).toMatchObject({ type: "done" });
    });

    it("settles an ambiguous assistant transport as unknown without an error retry", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(
        channel,
        upgradeWebSocket,
        mockTenantRegistry,
        mockSessionRegistry,
        mockOrchestrator,
      ));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);
      mockWs.send.mockImplementation(() => { throw new Error("transport response lost"); });
      const message = new MessageEvent("message", {
        data: JSON.stringify({ type: "message", content: "hello", messageId: "ambiguous-message" }),
      });

      await handlers.onMessage!(message, wsCtx);
      await handlers.onMessage!(message, wsCtx);

      expect(mockWs.send).toHaveBeenCalledOnce();
    });

    it("does not redispatch a claimed frame after the socket disconnects", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(
        channel,
        upgradeWebSocket,
        mockTenantRegistry,
        mockSessionRegistry,
        mockOrchestrator,
      ));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);
      (mockWs as { readyState: number }).readyState = 3;
      const message = new MessageEvent("message", {
        data: JSON.stringify({ type: "message", content: "hello", messageId: "disconnected-message" }),
      });

      await handlers.onMessage!(message, wsCtx);
      (mockWs as { readyState: number }).readyState = 1;
      await handlers.onMessage!(message, wsCtx);

      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it("captures tenant WebSocket multimodal parts as replay artifacts before routing and orchestration", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const tenant = makeTenantConfig();
      const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-13T12:00:00.000Z" });
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(tenant);

      createWsTenantRoutes(makeConfig(
        channel,
        upgradeWebSocket,
        mockTenantRegistry,
        mockSessionRegistry,
        mockOrchestrator,
        { artifactStore },
      ));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message",
            parts: [{ type: "image", mimeType: "image/png", data: "AQID" }],
          }),
        }),
        wsCtx,
      );

      const expectedParts = [{
        type: "image",
        mimeType: "image/png",
        data: "AQID",
        artifactUri: "kiln://artifacts/inbound-multimodal/artifact_1/content",
      }];
      expect(mockedResolveAgentContextAsync).toHaveBeenCalledWith(
        tenant,
        expectedParts,
        mockSession,
        expect.any(Object),
        "web",
      );
      expect(vi.mocked(mockOrchestrator.processMessage).mock.calls[0]![1]).toEqual(expectedParts);
      expect(artifactStore.get("inbound-multimodal", "artifact_1")).toMatchObject({
        multimodal: {
          modality: "image",
          source: { kind: "uploaded-file", id: "kilvo:salon-test:user-1:web:part:0" },
        },
      });
    });

    it("sends error frame when tenant WebSocket artifact capture fails", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const tenant = makeTenantConfig();
      const artifactStore = new MemoryArtifactResourceStore();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(tenant);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 500 })));

      createWsTenantRoutes(makeConfig(
        channel,
        upgradeWebSocket,
        mockTenantRegistry,
        mockSessionRegistry,
        mockOrchestrator,
        { artifactStore },
      ));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "message",
            parts: [{ type: "image", mimeType: "image/png", url: "https://media.example.test/image.png" }],
          }),
        }),
        wsCtx,
      );

      expect(mockedResolveAgentContextAsync).not.toHaveBeenCalled();
      expect(mockOrchestrator.processMessage).not.toHaveBeenCalled();
      expect(JSON.parse(mockWs.send.mock.calls.at(-1)?.[0] as string)).toEqual({
        type: "error",
        message: "Media download failed: 500",
      });
    });

    it("passes systemPrompt and tenantId when creating session", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const tenant = makeTenantConfig();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(tenant);

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hi" }) }),
        wsCtx,
      );

      expect(mockSessionRegistry.getOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          appName: TEST_APP,
          tenantId: "salon-test",
          userId: "user-1",
          systemPrompt: "",
        }),
      );
      // System prompt is set after session creation via setSystemPrompt
      expect(mockSession.setSystemPrompt).toHaveBeenCalled();
    });

    it("sends done frame with response after processing", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hi" }) }),
        wsCtx,
      );

      expect(mockWs.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(mockWs.send.mock.calls[0]![0] as string);
      expect(sent).toEqual({
        type: "done",
        content: "Hello from agent",
        parts: textParts("Hello from agent"),
        inputTokens: 10,
        outputTokens: 20,
        ...completedDisposition,
      });
    });

    it.each([
      ["paused for no progress", noProgressDisposition],
      ["paused because a required producer did not run", requiredProducerNotRunDisposition],
    ] as const)("preserves the exact %s disposition and evidence", async (_label, disposition) => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());
      vi.mocked(mockOrchestrator.processMessage).mockResolvedValueOnce({
        parts: textParts("partial"),
        inputTokens: 5,
        outputTokens: 15,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        ...disposition,
      });

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "continue this" }) }),
        wsCtx,
      );
      const call = mockWs.send.mock.calls.at(0);
      if (!call || typeof call[0] !== "string") throw new Error("Expected WebSocket done frame");
      expect(JSON.parse(call[0])).toEqual({
        type: "done",
        content: "partial",
        parts: textParts("partial"),
        inputTokens: 5,
        outputTokens: 15,
        ...disposition,
      });
    });

    it("keeps the done frame inside admission and emits no fallback on rejection", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());
      const state = { active: false, outboundWhileActive: false };
       const config = observeAdmissionFence(
         makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator),
         state,
       );
      createWsTenantRoutes(config);
      const connection = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
       connection.mockWs.send.mockImplementation(() => {
        state.outboundWhileActive ||= state.active;
      });
      connection.handlers.onOpen!(new Event("open"), connection.wsCtx);
      await connection.handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "fenced" }) }),
        connection.wsCtx,
      );
      expect(state.outboundWhileActive).toBe(true);

       const rejected = makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator, {
         gatewayAdmission: {
           channelEgressActionClaims: config.gatewayAdmission.channelEgressActionClaims,
           async execute() {
             throw new Error("admission rejected");
           },
        } satisfies GatewayAuthorityAdmissionPort,
      });
      createWsTenantRoutes(rejected);
      const rejectedConnection = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      rejectedConnection.handlers.onOpen!(new Event("open"), rejectedConnection.wsCtx);
      await rejectedConnection.handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "rejected" }) }),
        rejectedConnection.wsCtx,
      );
      expect(rejectedConnection.mockWs.send).not.toHaveBeenCalled();
    });

    it("sends error frame when orchestrator throws", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());
      vi.mocked(mockOrchestrator.processMessage).mockRejectedValue(new Error("LLM failed"));

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hi" }) }),
        wsCtx,
      );

      expect(mockWs.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(mockWs.send.mock.calls[0]![0] as string);
      expect(sent).toEqual({ type: "error", message: "Something went wrong. Please try again." });
    });

    it("silently discards malformed JSON", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID });
      await expect(
        handlers.onMessage!(new MessageEvent("message", { data: "not-json" }), wsCtx),
      ).resolves.not.toThrow();
    });

    it("resolveByWidgetId filters disabled tenants (404 returned)", async () => {
      const { upgradeWebSocket } = makeUpgradeWebSocket();
      // Simulate resolveByWidgetId returning undefined (disabled tenant already excluded)
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(undefined);

      const app = createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const res = await sendWsRequest(app, { widgetId: "disabled-widget" });
      expect(res.status).toBe(404);
    });

    it("does not process pong frames as chat messages", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "pong" }) }),
        wsCtx,
      );

      expect(mockOrchestrator.processMessage).not.toHaveBeenCalled();
      // No response frames sent (pong is silently consumed)
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it("uses the model-only admitted tool authority instead of tenant hints", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "authority check" }) }),
        wsCtx,
      );

      expect(mockOrchestrator.processMessage).toHaveBeenCalledOnce();
      const governedContext = vi.mocked(mockOrchestrator.processMessage).mock.calls[0]![2];
      expect(governedContext).toEqual(expect.objectContaining({
        audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
      }));
      const perCallConfig = vi.mocked(mockOrchestrator.processMessage).mock.calls[0]![4];
      expect(perCallConfig?.authorityAdmission).toMatchObject({
        turn: { authority: { admittedAuthority: "fail_closed" } },
      });
    });

    it("propagates communication intent and returns raw-free final prompt evidence", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());
      vi.mocked(mockOrchestrator.processMessage).mockResolvedValueOnce({
        parts: textParts("Respuesta"),
        ...completedDisposition,
         inputTokens: 3,
         outputTokens: 2,
         cacheReadTokens: 0,
         cacheWriteTokens: 0,
         queued: false,
         providerRequests: [providerRequestEvidence],
      });

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(new MessageEvent("message", {
        data: JSON.stringify({
          type: "message",
          content: "private tenant request",
          communicationIntent: {
            locale: "es-MX",
            responseDetail: "detailed",
            requiredContent: ["residual-risk", "verification"],
          },
        }),
      }), wsCtx);

      const perCallConfig = vi.mocked(mockOrchestrator.processMessage).mock.calls[0]![4];
      expect(perCallConfig?.communicationIntent).toEqual(expect.objectContaining({
        intent: expect.objectContaining({
          locale: "es-MX",
          responseDetail: "detailed",
          requiredContent: ["residual-risk", "verification"],
        }),
        authority: expect.objectContaining({ locale: "user", responseDetail: "user" }),
      }));
      const done = JSON.parse(mockWs.send.mock.calls.at(-1)?.[0] as string);
      expect(done.effectivePromptObservation).toMatchObject({
        providerId: "codex-oauth",
        modelId: "gpt-5.6-sol",
        componentScopeCounts: { static: 0, dynamic: 1, deferred: 0 },
      });
      expect(JSON.stringify(done.effectivePromptObservation)).not.toContain("private tenant request");
    });

    it("rejects invalid communication intent before tenant runtime invocation", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());
      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);
      await handlers.onMessage!(new MessageEvent("message", {
        data: JSON.stringify({
          type: "message",
          content: "hello",
          communicationIntent: { responseDetail: "verbose" },
        }),
      }), wsCtx);

      expect(mockOrchestrator.processMessage).not.toHaveBeenCalled();
      expect(JSON.parse(mockWs.send.mock.calls.at(-1)?.[0] as string)).toEqual({
        type: "error",
        message: "communicationIntent is invalid",
      });
    });

    it("narrows tenant tools before provider invocation when read-only authority is requested", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());
      const toolDefinitions: ToolDefinition[] = [
        makeToolDefinition("read_tool"),
        makeToolDefinition("write_tool"),
      ];
      const capabilities = new Map<string, Capability>([
        ["read_tool", {
          name: "read_tool",
          description: "read",
          schema: {},
          tags: [],
          effectEnvelope: {
            operation: "observe",
            boundaries: ["process"],
            reversibility: "reversible",
            dataEgress: "metadata",
            identityUse: "none",
            consequences: [],
            idempotency: "conditionally-idempotent",
          },
        }],
        ["write_tool", {
          name: "write_tool",
          description: "write",
          schema: {},
          tags: [],
          effectEnvelope: {
            operation: "mutate",
            boundaries: ["workspace"],
            reversibility: "reversible",
            dataEgress: "project-data",
            identityUse: "none",
            consequences: ["local-state"],
            idempotency: "conditionally-idempotent",
          },
        }],
      ]);
      mockedResolveAgentContextAsync.mockResolvedValue({
        systemPrompt: "Mock system prompt",
        activeAgentId: undefined,
        tenantToolContext: {
          callBuiltinTools: new Map(),
          toolDefinitions,
          capabilities,
          toolAuthority: new Map(),
          toolAllowlist: new Set(["read_tool", "write_tool"]),
          rateLimiter: undefined,
          executionEnvelope: undefined,
        },
        isHandoff: false,
        pingPongBlocked: false,
      });

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "authority check", requestedAuthority: "read_only" }) }),
        wsCtx,
      );

      const perCallConfig = vi.mocked(mockOrchestrator.processMessage).mock.calls[0]![4];
      expect(perCallConfig?.authorityAdmission).toMatchObject({
        turn: {
          authority: {
            requestedAuthority: "read_only",
            admittedAuthority: "fail_closed",
            completeness: "authoritative",
            deniedToolCount: 0,
          },
          tools: { allowedToolPermissions: [] },
        },
      });
    });

    it("fails closed when audited authority is requested for tenant tools without authority metadata", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());
      const toolDefinitions: ToolDefinition[] = [
        makeToolDefinition("unknown_tool"),
      ];
      mockedResolveAgentContextAsync.mockResolvedValue({
        systemPrompt: "Mock system prompt",
        activeAgentId: undefined,
        tenantToolContext: {
          callBuiltinTools: new Map(),
          toolDefinitions,
          capabilities: new Map(),
          toolAuthority: new Map(),
          toolAllowlist: new Set(["unknown_tool"]),
          rateLimiter: undefined,
          executionEnvelope: undefined,
        },
        isHandoff: false,
        pingPongBlocked: false,
      });

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "authority check", requestedAuthority: "audited" }) }),
        wsCtx,
      );

      const perCallConfig = vi.mocked(mockOrchestrator.processMessage).mock.calls[0]![4];
      expect(perCallConfig?.authorityAdmission).toMatchObject({
        turn: {
          authority: {
            requestedAuthority: "read_only",
            admittedAuthority: "fail_closed",
            completeness: "authoritative",
            toolCount: 0,
            deniedToolCount: 0,
          },
          tools: { allowedToolPermissions: [] },
        },
      });
    });

    it("fails closed destructive requestedAuthority before tenant provider invocation", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "authority check", requestedAuthority: "destructive" }) }),
        wsCtx,
      );

      const perCallConfig = vi.mocked(mockOrchestrator.processMessage).mock.calls[0]![4];
      expect(perCallConfig?.authorityAdmission).toMatchObject({
        turn: {
          authority: {
            requestedAuthority: "read_only",
            admittedAuthority: "fail_closed",
            completeness: "authoritative",
          },
          tools: { allowedToolPermissions: [] },
        },
      });
      expect(JSON.parse(mockWs.send.mock.calls.at(-1)?.[0] as string)).toEqual(expect.objectContaining({
        type: "done",
      }));
    });

    it("projects coordination provider candidates into tenant WebSocket governed context", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());
      mockedResolveAgentContextAsync.mockResolvedValue({
        systemPrompt: "Mock system prompt",
        activeAgentId: "billing-specialist",
        tenantToolContext: {
          callBuiltinTools: new Map(),
          toolDefinitions: [],
          capabilities: new Map(),
          toolAuthority: mockedToolAuthority,
          toolAllowlist: undefined,
          rateLimiter: undefined,
          executionEnvelope: undefined,
        },
        isHandoff: false,
      });
      const coordinationContextProvider = vi.fn().mockResolvedValue([
        {
          kind: "coordination" as const,
          source: "runtime-cross-agent-memory:handoff-123",
          content: "Cross-agent memory\nsummary: Billing handoff stays active.",
          score: 0.8,
        },
      ]);

      createWsTenantRoutes(makeConfig(
        channel,
        upgradeWebSocket,
        mockTenantRegistry,
        mockSessionRegistry,
        mockOrchestrator,
        { coordinationContextProvider },
      ));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "handoff status" }) }),
        wsCtx,
      );

      expect(coordinationContextProvider).toHaveBeenCalledWith({
        appName: TEST_APP,
        tenantId: "salon-test",
        userId: "user-1",
        sessionId: "sess-1",
        channel: "web",
        activeAgentId: "billing-specialist",
      });
      const governedContext = vi.mocked(mockOrchestrator.processMessage).mock.calls[0]![2];
      expect(governedContext?.evidence?.some((block) => block.content.includes("Cross-agent memory"))).toBe(true);
      expect(governedContext?.evidence?.some((block) => block.content.includes("Billing handoff stays active."))).toBe(true);
      expect(governedContext?.audit?.blocks.find((block) => block.kind === "coordination")).toEqual(
        expect.objectContaining({
          decision: "admitted",
          source: expect.stringContaining("runtime-coordination-provider:0:handoff-123"),
        }),
      );
    });

    it("records sanitized coordination provider validation failures in tenant WebSocket audit", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());
      const rawFailureMarker = "raw-provider-marker";
      const coordinationContextProvider = vi.fn().mockResolvedValue([
        {
          kind: "coordination" as const,
          source: `runtime-cross-agent-memory:${rawFailureMarker}`,
          content: { summary: rawFailureMarker },
          score: 0.9,
        },
      ]);

      createWsTenantRoutes(makeConfig(
        channel,
        upgradeWebSocket,
        mockTenantRegistry,
        mockSessionRegistry,
        mockOrchestrator,
        { coordinationContextProvider },
      ));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "handoff status" }) }),
        wsCtx,
      );

      const governedContext = vi.mocked(mockOrchestrator.processMessage).mock.calls[0]![2];
      const projectedContext = JSON.stringify({
        directives: governedContext?.directives,
        guidance: governedContext?.guidance,
        evidence: governedContext?.evidence,
      });
      expect(projectedContext).not.toContain(rawFailureMarker);
      expect(governedContext?.audit?.blocks.some((block) => block.kind === "coordination")).toBe(false);
      expect(JSON.stringify(governedContext?.audit)).not.toContain(rawFailureMarker);
      expect((governedContext?.audit as { coordinationProviderFailures?: unknown[] })?.coordinationProviderFailures)
        .toContainEqual({
          source: "runtime-coordination-provider",
          reason: "provider-validation-error",
        });
    });

    it("records coordination provider exceptions in tenant WebSocket audit without leaking error text", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());
      const rawFailureMarker = "coordination-provider-exception-marker";
      const coordinationContextProvider = vi.fn().mockRejectedValue(new Error(rawFailureMarker));

      createWsTenantRoutes(makeConfig(
        channel,
        upgradeWebSocket,
        mockTenantRegistry,
        mockSessionRegistry,
        mockOrchestrator,
        { coordinationContextProvider },
      ));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "handoff status" }) }),
        wsCtx,
      );

      const governedContext = vi.mocked(mockOrchestrator.processMessage).mock.calls[0]![2];
      const projectedContext = JSON.stringify({
        directives: governedContext?.directives,
        guidance: governedContext?.guidance,
        evidence: governedContext?.evidence,
      });
      expect(projectedContext).not.toContain(rawFailureMarker);
      expect(JSON.stringify(governedContext?.audit)).not.toContain(rawFailureMarker);
      expect((governedContext?.audit as { coordinationProviderFailures?: unknown[] })?.coordinationProviderFailures)
        .toContainEqual({
          source: "runtime-coordination-provider",
          reason: "provider-error",
        });
    });
  });

  describe("heartbeat", () => {
    it("starts heartbeat interval on connection open", () => {
      vi.useFakeTimers();
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      // No ping sent immediately
      expect(mockWs.send).not.toHaveBeenCalled();

      // After 30s, a ping frame should be sent
      vi.advanceTimersByTime(30_000);
      expect(mockWs.send).toHaveBeenCalledOnce();
      expect(JSON.parse(mockWs.send.mock.calls[0]![0] as string)).toEqual({ type: "ping" });

      // Clean up
      handlers.onClose!(new Event("close") as unknown as CloseEvent, wsCtx);
    });

    it("sends ping every 30 seconds", () => {
      vi.useFakeTimers();
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      vi.advanceTimersByTime(30_000);
      expect(mockWs.send).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(30_000);
      expect(mockWs.send).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(30_000);
      expect(mockWs.send).toHaveBeenCalledTimes(3);

      // All pings
      for (const call of mockWs.send.mock.calls) {
        expect(JSON.parse(call[0] as string)).toEqual({ type: "ping" });
      }

      handlers.onClose!(new Event("close") as unknown as CloseEvent, wsCtx);
    });

    it("closes connection after 90s of inactivity", () => {
      vi.useFakeTimers();
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);
      expect(channel.clientCount).toBe(1);

      // Advance past the 90s timeout (4th tick at 120s exceeds 90s since lastPong at t=0)
      vi.advanceTimersByTime(120_000);

      expect(mockWs.close).toHaveBeenCalledWith(1001, "heartbeat timeout");
      expect(channel.clientCount).toBe(0);
    });

    it("resets liveness timer when client sends any message", () => {
      vi.useFakeTimers();
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      // Advance 60s (2 pings sent, still within 90s timeout)
      vi.advanceTimersByTime(60_000);
      expect(mockWs.close).not.toHaveBeenCalled();

      // Client sends a pong (resets lastPong to now=60s)
      handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "pong" }) }),
        wsCtx,
      );

      // Advance another 60s (now at t=120s, but lastPong was at t=60s, so only 60s of inactivity)
      vi.advanceTimersByTime(60_000);
      expect(mockWs.close).not.toHaveBeenCalled();

      // Advance another 60s (now at t=180s, lastPong at t=60s = 120s inactivity > 90s)
      vi.advanceTimersByTime(60_000);
      expect(mockWs.close).toHaveBeenCalledWith(1001, "heartbeat timeout");

      // Clean up already happened via timeout
    });

    it("clears heartbeat interval on connection close", () => {
      vi.useFakeTimers();
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      // Close the connection normally
      handlers.onClose!(new Event("close") as unknown as CloseEvent, wsCtx);

      // Advance past when pings would fire -- nothing should happen
      vi.advanceTimersByTime(120_000);
      expect(mockWs.send).not.toHaveBeenCalled();
      expect(mockWs.close).not.toHaveBeenCalled();
    });

    it("handles send throwing during ping gracefully", () => {
      vi.useFakeTimers();
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(makeTenantConfig());

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, mockWs, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      // Make send throw (simulating connection already closing)
      mockWs.send.mockImplementation(() => { throw new Error("WebSocket is not open"); });

      // Should not throw -- the error is caught
      expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();

      handlers.onClose!(new Event("close") as unknown as CloseEvent, wsCtx);
    });
  });
});
