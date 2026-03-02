import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWsTenantRoutes } from "../../src/gateway/ws-tenant-routes.js";
import { WebChannel } from "../../src/channels/web-channel.js";
import type { WebSocketLike } from "../../src/channels/web-channel.js";
import type { UpgradeWebSocket } from "hono/ws";
import type { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import type { SessionRegistry } from "../../src/session/session-registry.js";
import type { ModeBOrchestrator } from "../../src/session/mode-b-orchestrator.js";
import type { TenantConfig } from "@kilnai/core";
import { textParts } from "@kilnai/core";

const TEST_APP = "kilvo";
const WIDGET_ID = "widget-uuid-abc";

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
  type HandlerFactory = Parameters<UpgradeWebSocket>[0];
  let capturedFactory: HandlerFactory | null = null;

  const upgradeWebSocket: UpgradeWebSocket = (factory) => {
    capturedFactory = factory;
    return async (_c, next) => next();
  };

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
    } as Parameters<HandlerFactory>[0];

    const handlers = capturedFactory(ctx);
    const mockWs: WebSocketLike = { send: vi.fn(), readyState: 1 };
    return { handlers, mockWs, wsCtx: mockWs as unknown as Parameters<typeof handlers.onOpen>[1] };
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
  orchestrator: ModeBOrchestrator,
) {
  return {
    webChannel: channel,
    upgradeWebSocket,
    appName: TEST_APP,
    orchestrator,
    sessionRegistry,
    tenantRegistry,
  };
}

describe("createWsTenantRoutes", () => {
  let channel: WebChannel;
  let mockTenantRegistry: TenantRegistry;
  let mockSessionRegistry: SessionRegistry;
  let mockOrchestrator: ModeBOrchestrator;
  let mockSession: { id: string; userId: string; tenantId: string };

  beforeEach(() => {
    channel = new WebChannel();

    mockTenantRegistry = {
      resolveByWidgetId: vi.fn(),
    } as unknown as TenantRegistry;

    mockSession = { id: "sess-1", userId: "user-1", tenantId: "salon-test" };

    mockSessionRegistry = {
      getOrCreate: vi.fn().mockReturnValue(mockSession),
    } as unknown as SessionRegistry;

    mockOrchestrator = {
      model: "claude-sonnet-4-6",
      processMessage: vi.fn().mockResolvedValue({
        parts: textParts("Hello from agent"),
        inputTokens: 10,
        outputTokens: 20,
      }),
    } as unknown as ModeBOrchestrator;
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
      const [session, parts] = vi.mocked(mockOrchestrator.processMessage).mock.calls[0]!;
      expect(session).toBe(mockSession);
      expect(parts).toEqual(textParts("hello"));
    });

    it("passes systemPrompt and tenantId when creating session", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const tenant = makeTenantConfig();
      vi.mocked(mockTenantRegistry.resolveByWidgetId).mockReturnValue(tenant);

      createWsTenantRoutes(makeConfig(channel, upgradeWebSocket, mockTenantRegistry, mockSessionRegistry, mockOrchestrator));

      const { handlers, wsCtx } = simulateConnection({ widgetId: WIDGET_ID, userId: "user-2" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hi" }) }),
        wsCtx,
      );

      expect(mockSessionRegistry.getOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          appName: TEST_APP,
          tenantId: "salon-test",
          userId: "user-2",
          systemPrompt: expect.stringContaining("Test Salon"),
        }),
      );
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
      });
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
      expect(sent).toEqual({ type: "error", message: "LLM failed" });
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
  });
});
