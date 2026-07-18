import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWsRoutes } from "../../src/gateway/ws-routes.js";
import { WebChannel } from "../../src/channels/web-channel.js";
import type { WebSocketLike } from "../../src/channels/web-channel.js";
import type { UpgradeWebSocket } from "hono/ws";
import { MemoryArtifactResourceStore, textParts } from "@kilnai/core";

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


async function sendWsRequest(
  app: ReturnType<typeof createWsRoutes>,
  queryParams: Record<string, string> = {},
): Promise<Response> {
  const url = new URL("http://localhost/ws");
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, v);
  }
  return app.request(url.toString());
}

describe("createWsRoutes", () => {
  let channel: WebChannel;

  beforeEach(() => {
    channel = new WebChannel();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    it("forwards non-message frames to channel", async () => {
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

    it("falls back to webChannel.receive when processMessage is not provided", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      createWsRoutes({ webChannel: channel, upgradeWebSocket });

      const handler = vi.fn();
      channel.onMessage(handler);

      const { handlers, wsCtx } = simulateConnection({ userId: "u1" });
      const frame = { type: "message", content: "hello" };
      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify(frame) }),
        wsCtx,
      );

      // Without processMessage, should fall through to webChannel.receive
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("processMessage (chat frames)", () => {
    it("calls processMessage with userId and text parts on message frame", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const processMessage = vi.fn().mockResolvedValue({
        parts: textParts("response"),
        outcome: "completed",
        inputTokens: 10,
        outputTokens: 20,
      });

      createWsRoutes({ webChannel: channel, upgradeWebSocket, processMessage });

      const { handlers, mockWs, wsCtx } = simulateConnection({ userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hello" }) }),
        wsCtx,
      );

      expect(processMessage).toHaveBeenCalledWith("user-1", textParts("hello"), {
        requestedAuthority: undefined,
      });
    });

    it("passes requestedAuthority through message-frame options", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const processMessage = vi.fn().mockResolvedValue({
        parts: textParts("response"),
        outcome: "completed",
        inputTokens: 10,
        outputTokens: 20,
      });

      createWsRoutes({ webChannel: channel, upgradeWebSocket, processMessage });

      const { handlers, wsCtx } = simulateConnection({ userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hello", requestedAuthority: "audited" }) }),
        wsCtx,
      );

      expect(processMessage).toHaveBeenCalledWith("user-1", textParts("hello"), {
        requestedAuthority: "audited",
      });
    });

    it("passes destructive requestedAuthority through message-frame options", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const processMessage = vi.fn().mockResolvedValue({
        parts: textParts("response"),
        outcome: "completed",
        inputTokens: 10,
        outputTokens: 20,
      });

      createWsRoutes({ webChannel: channel, upgradeWebSocket, processMessage });

      const { handlers, mockWs, wsCtx } = simulateConnection({ userId: "user-1" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hello", requestedAuthority: "destructive" }) }),
        wsCtx,
      );

      expect(processMessage).toHaveBeenCalledWith("user-1", textParts("hello"), {
        requestedAuthority: "destructive",
      });
      expect(JSON.parse(mockWs.send.mock.calls[0]?.[0] as string)).toEqual(expect.objectContaining({ type: "done" }));
    });

    it("sends done frame with response content", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const responseParts = textParts("world");
      const processMessage = vi.fn().mockResolvedValue({
        parts: responseParts,
        outcome: "completed",
        inputTokens: 5,
        outputTokens: 15,
      });

      createWsRoutes({ webChannel: channel, upgradeWebSocket, processMessage });

      const { handlers, mockWs, wsCtx } = simulateConnection({ userId: "user-2" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "hi" }) }),
        wsCtx,
      );

      expect(mockWs.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent).toEqual({
        type: "done",
        content: "world",
        parts: responseParts,
        outcome: "completed",
        inputTokens: 5,
        outputTokens: 15,
      });
    });

    it("uses provided parts when available instead of content", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const userParts = textParts("explicit parts");
      const processMessage = vi.fn().mockResolvedValue({
        parts: textParts("response"),
        outcome: "completed",
        inputTokens: 1,
        outputTokens: 2,
      });

      createWsRoutes({ webChannel: channel, upgradeWebSocket, processMessage });

      const { handlers, wsCtx } = simulateConnection({ userId: "user-3" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "ignored", parts: userParts }) }),
        wsCtx,
      );

      expect(processMessage).toHaveBeenCalledWith("user-3", userParts, {
        requestedAuthority: undefined,
      });
    });

    it("captures provided multimodal parts as replay artifacts before processMessage", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-13T12:00:00.000Z" });
      const processMessage = vi.fn().mockResolvedValue({
        parts: textParts("response"),
        outcome: "completed",
        inputTokens: 1,
        outputTokens: 2,
      });
      const userParts = [{ type: "image", mimeType: "image/png", data: "AQID" }];

      createWsRoutes({
        webChannel: channel,
        upgradeWebSocket,
        processMessage,
        appName: "kilvo",
        tenantId: "tenant-1",
        artifactStore,
      });

      const { handlers, wsCtx } = simulateConnection({ userId: "user-3" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "ignored", parts: userParts }) }),
        wsCtx,
      );

      expect(processMessage).toHaveBeenCalledWith("user-3", [{
        type: "image",
        mimeType: "image/png",
        data: "AQID",
        artifactUri: "kiln://artifacts/inbound-multimodal/artifact_1/content",
      }], {
        requestedAuthority: undefined,
      });
      expect(artifactStore.get("inbound-multimodal", "artifact_1")).toMatchObject({
        title: "Inbound image 0",
        multimodal: {
          modality: "image",
          source: { kind: "uploaded-file", id: "kilvo:tenant-1:user-3:web:part:0" },
        },
      });
    });

    it("sends error frame when multimodal artifact capture fails", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const artifactStore = new MemoryArtifactResourceStore();
      const processMessage = vi.fn().mockResolvedValue({
        parts: textParts("response"),
        outcome: "completed",
        inputTokens: 1,
        outputTokens: 2,
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 500 })));

      createWsRoutes({
        webChannel: channel,
        upgradeWebSocket,
        processMessage,
        artifactStore,
      });

      const { handlers, mockWs, wsCtx } = simulateConnection({ userId: "user-3" });
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

      expect(processMessage).not.toHaveBeenCalled();
      expect(JSON.parse(mockWs.send.mock.calls[0]?.[0] as string)).toEqual({
        type: "error",
        message: "Media download failed: 500",
      });
    });

    it("sends error frame when processMessage throws", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const processMessage = vi.fn().mockRejectedValue(new Error("Processing failed"));

      createWsRoutes({ webChannel: channel, upgradeWebSocket, processMessage });

      const { handlers, mockWs, wsCtx } = simulateConnection({ userId: "user-4" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "test" }) }),
        wsCtx,
      );

      expect(mockWs.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent).toEqual({
        type: "error",
        message: "Processing failed",
      });
    });

    it("does not call webChannel.receive for message frames when processMessage exists", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const processMessage = vi.fn().mockResolvedValue({
        parts: textParts("ok"),
        outcome: "completed",
        inputTokens: 1,
        outputTokens: 1,
      });

      createWsRoutes({ webChannel: channel, upgradeWebSocket, processMessage });

      const handler = vi.fn();
      channel.onMessage(handler);

      const { handlers, wsCtx } = simulateConnection({ userId: "user-5" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify({ type: "message", content: "test" }) }),
        wsCtx,
      );

      expect(handler).not.toHaveBeenCalled();
    });

    it("falls through to webChannel.receive for non-message type frames even with processMessage", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const processMessage = vi.fn();

      createWsRoutes({ webChannel: channel, upgradeWebSocket, processMessage });

      const handler = vi.fn();
      channel.onMessage(handler);

      const { handlers, wsCtx } = simulateConnection({ userId: "user-6" });
      const incoming = { type: "ping", data: {} };

      await handlers.onMessage!(
        new MessageEvent("message", { data: JSON.stringify(incoming) }),
        wsCtx,
      );

      expect(processMessage).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(incoming);
    });
  });

  describe("validateToken", () => {
    it("allows connection when no validateToken configured", async () => {
      const { upgradeWebSocket } = makeUpgradeWebSocket();
      const app = createWsRoutes({ webChannel: channel, upgradeWebSocket });

      const res = await sendWsRequest(app);
      expect(res.status).not.toBe(401);
    });

    it("returns 401 when token is missing and validateToken is configured", async () => {
      const { upgradeWebSocket } = makeUpgradeWebSocket();
      const validateToken = vi.fn().mockReturnValue({ valid: true, userId: "u1" });
      const app = createWsRoutes({ webChannel: channel, upgradeWebSocket, validateToken });

      const res = await sendWsRequest(app, {});
      expect(res.status).toBe(401);
      expect(validateToken).not.toHaveBeenCalled();
    });

    it("returns 401 when token is invalid", async () => {
      const { upgradeWebSocket } = makeUpgradeWebSocket();
      const validateToken = vi.fn().mockReturnValue({ valid: false });
      const app = createWsRoutes({ webChannel: channel, upgradeWebSocket, validateToken });

      const res = await sendWsRequest(app, { token: "bad-token" });
      expect(res.status).toBe(401);
      expect(validateToken).toHaveBeenCalledWith("bad-token");
    });

    it("allows connection when token is valid", async () => {
      const { upgradeWebSocket } = makeUpgradeWebSocket();
      const validateToken = vi.fn().mockReturnValue({ valid: true, userId: "validated-user" });
      const app = createWsRoutes({ webChannel: channel, upgradeWebSocket, validateToken });

      const res = await sendWsRequest(app, { token: "good-token" });
      expect(res.status).not.toBe(401);
      expect(validateToken).toHaveBeenCalledWith("good-token");
    });

    it("uses userId from validateToken result as sessionId", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const validateToken = vi.fn().mockImplementation((token: string) => {
        if (token === "valid-token") return { valid: true, userId: "token-user-id" };
        return { valid: false };
      });

      const app = createWsRoutes({ webChannel: channel, upgradeWebSocket, validateToken });

      // Run auth middleware: sets the closure validatedUserId to "token-user-id"
      await app.request("http://localhost/ws?token=valid-token");

      // Simulate upgrade factory called immediately after (closure var is set)
      const { handlers, mockWs, wsCtx } = simulateConnection({ token: "valid-token" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await channel.send({ parts: textParts("hello"), userId: "token-user-id" });
      expect(mockWs.send).toHaveBeenCalledOnce();
    });

    it("falls back to query params when validateToken returns no userId", async () => {
      const { upgradeWebSocket, simulateConnection } = makeUpgradeWebSocket();
      const validateToken = vi.fn().mockReturnValue({ valid: true }); // no userId

      const app = createWsRoutes({ webChannel: channel, upgradeWebSocket, validateToken });

      // Run auth middleware to pass validation (userId will be undefined)
      await app.request("http://localhost/ws?token=valid-token");

      // Simulate connection with sessionId param -- should use it as fallback
      const { handlers, mockWs, wsCtx } = simulateConnection({ sessionId: "fallback-sess" });
      handlers.onOpen!(new Event("open"), wsCtx);

      await channel.send({ parts: textParts("hi"), userId: "fallback-sess" });
      expect(mockWs.send).toHaveBeenCalledOnce();
    });
  });
});
