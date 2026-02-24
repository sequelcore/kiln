import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWsRoutes } from "../../src/gateway/ws-routes.js";
import { WebChannel } from "../../src/channels/web-channel.js";
import type { WebSocketLike } from "../../src/channels/web-channel.js";
import type { UpgradeWebSocket } from "hono/ws";
import { textParts } from "@kilnai/core";

/**
 * Simulates the upgradeWebSocket middleware by capturing the handler factory,
 * then invoking it directly with a mock request context and WSContext.
 */
function makeUpgradeWebSocket() {
  type HandlerFactory = Parameters<UpgradeWebSocket>[0];
  let capturedFactory: HandlerFactory | null = null;

  const upgradeWebSocket: UpgradeWebSocket = (factory) => {
    capturedFactory = factory;
    // Return a no-op Hono middleware -- we test the factory directly
    return async (_c, next) => next();
  };

  function simulateConnection(queryParams: Record<string, string> = {}) {
    if (!capturedFactory) throw new Error("upgradeWebSocket not called yet");

    const url = new URL("http://localhost/ws");
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }

    // Minimal Hono context with query() support
    const ctx = {
      req: {
        query: (key: string) => url.searchParams.get(key) ?? undefined,
      },
    } as Parameters<HandlerFactory>[0];

    const handlers = capturedFactory(ctx);

    const mockWs: WebSocketLike = { send: vi.fn(), readyState: 1 };
    // WSContext is compatible enough via cast for our tests
    return { handlers, mockWs, wsCtx: mockWs as unknown as Parameters<typeof handlers.onOpen>[1] };
  }

  return { upgradeWebSocket, simulateConnection };
}

describe("createWsRoutes", () => {
  let channel: WebChannel;

  beforeEach(() => {
    channel = new WebChannel();
  });

  it("mounts a /ws route", () => {
    const { upgradeWebSocket } = makeUpgradeWebSocket();
    const app = createWsRoutes({ webChannel: channel, upgradeWebSocket });
    const routes = app.routes.map((r) => r.path);
    expect(routes).toContain("/ws");
  });

  describe("session extraction from query params", () => {
    it("uses sessionId param when present", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      createWsRoutes({ webChannel: channel, upgradeWebSocket });

      const { handlers, mockWs, wsCtx } = simulateConnection({ sessionId: "sess-123" });
      handlers.onOpen!(new Event("open"), wsCtx);

      // Send to that session -- should reach the client
      await channel.send({ parts: textParts("hi"), userId: "sess-123" });
      expect(mockWs.send).toHaveBeenCalledOnce();
    });

    it("falls back to userId param when sessionId absent", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      createWsRoutes({ webChannel: channel, upgradeWebSocket });

      const { handlers, mockWs, wsCtx } = simulateConnection({ userId: "user-abc" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await channel.send({ parts: textParts("hi"), userId: "user-abc" });
      expect(mockWs.send).toHaveBeenCalledOnce();
    });

    it("generates a random sessionId when no params provided", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      createWsRoutes({ webChannel: channel, upgradeWebSocket });

      const { handlers, wsCtx } = simulateConnection();
      handlers.onOpen!(new Event("open"), wsCtx);

      // Client is registered under some generated ID -- count should be 1
      expect(channel.clientCount).toBe(1);
    });

    it("two connections with different sessionIds are isolated", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      createWsRoutes({ webChannel: channel, upgradeWebSocket });

      const connA = simulateConnection({ sessionId: "sess-a" });
      const connB = simulateConnection({ sessionId: "sess-b" });

      connA.handlers.onOpen!(new Event("open"), connA.wsCtx);
      connB.handlers.onOpen!(new Event("open"), connB.wsCtx);

      await channel.send({ parts: textParts("only A"), userId: "sess-a" });

      expect(connA.mockWs.send).toHaveBeenCalledOnce();
      expect(connB.mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe("onClose", () => {
    it("removes client from channel on close", () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      createWsRoutes({ webChannel: channel, upgradeWebSocket });

      const { handlers, wsCtx } = simulateConnection({ sessionId: "sess-x" });
      handlers.onOpen!(new Event("open"), wsCtx);
      expect(channel.clientCount).toBe(1);

      handlers.onClose!((new Event("close") as unknown as CloseEvent), wsCtx);
      expect(channel.clientCount).toBe(0);
    });
  });

  describe("onMessage", () => {
    it("forwards parsed IncomingMessage to channel", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      createWsRoutes({ webChannel: channel, upgradeWebSocket });

      const handler = vi.fn();
      channel.onMessage(handler);

      const { handlers, wsCtx } = simulateConnection({ sessionId: "sess-y" });
      const incoming = { parts: textParts("hello"), source: "web", userId: "u1" };
      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify(incoming) }),
        wsCtx,
      );

      expect(handler).toHaveBeenCalledWith(incoming);
    });

    it("silently discards malformed JSON", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      createWsRoutes({ webChannel: channel, upgradeWebSocket });

      const { handlers, wsCtx } = simulateConnection();
      await expect(
        handlers.onMessage!(new MessageEvent("message", { data: "not-json" }), wsCtx),
      ).resolves.not.toThrow();
    });
  });
});
