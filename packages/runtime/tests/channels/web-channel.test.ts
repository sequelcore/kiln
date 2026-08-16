import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebChannel } from "../../src/channels/web-channel.js";
import type { WebSocketLike } from "../../src/channels/web-channel.js";
import {
  type EngineEvent,
  type IncomingMessage,
  type OutgoingMessage,
  textParts,
} from "@kilnai/core/engine";

function makeMockWs(open = true): WebSocketLike {
  return {
    send: vi.fn(),
    readyState: open ? 1 : 3,
  };
}

describe("WebChannel", () => {
  let channel: WebChannel;

  beforeEach(() => {
    channel = new WebChannel();
  });

  it("has correct name and default format", () => {
    expect(channel.name).toBe("web");
    expect(channel.defaultFormat).toBe("full");
  });

  describe("client management", () => {
    it("tracks clientCount across sessions", () => {
      expect(channel.clientCount).toBe(0);

      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      channel.addClient(ws1, "session-a");
      expect(channel.clientCount).toBe(1);

      channel.addClient(ws2, "session-b");
      expect(channel.clientCount).toBe(2);

      channel.removeClient(ws1);
      expect(channel.clientCount).toBe(1);
    });

    it("allows multiple clients in the same session", () => {
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      channel.addClient(ws1, "session-a");
      channel.addClient(ws2, "session-a");
      expect(channel.clientCount).toBe(2);
    });

    it("removeClient cleans up empty session", () => {
      const ws = makeMockWs();
      channel.addClient(ws, "session-a");
      channel.removeClient(ws);
      // Adding a new client to same key should still work (map entry was deleted)
      const ws2 = makeMockWs();
      channel.addClient(ws2, "session-a");
      expect(channel.clientCount).toBe(1);
    });

    it("removeClient is a no-op when client is not tracked", () => {
      const ws = makeMockWs();
      expect(() => channel.removeClient(ws)).not.toThrow();
    });
  });

  describe("receive()", () => {
    it("invokes registered message handler", async () => {
      const handler = vi.fn();
      channel.onMessage(handler);

      const msg: IncomingMessage = {
        parts: textParts("start session"),
        source: "web",
        userId: "u1",
        threadId: "t1",
      };
      await channel.receive(msg);

      expect(handler).toHaveBeenCalledWith(msg);
    });

    it("does nothing without a handler", async () => {
      await expect(
        channel.receive({ parts: textParts("hello"), source: "web" }),
      ).resolves.not.toThrow();
    });
  });

  describe("send()", () => {
    it("delivers to the matching session when userId is set", async () => {
      const wsA = makeMockWs();
      const wsB = makeMockWs();
      channel.addClient(wsA, "session-a");
      channel.addClient(wsB, "session-b");

      const msg: OutgoingMessage = {
        parts: textParts("For A only"),
        userId: "session-a",
      };
      await channel.send(msg);

      expect(wsA.send).toHaveBeenCalledOnce();
      expect(wsB.send).not.toHaveBeenCalled();

      const payload = JSON.parse(vi.mocked(wsA.send).mock.calls[0]![0] as string);
      expect(payload.type).toBe("output");
      expect(payload.text).toBe("For A only");
      expect(payload.userId).toBe("session-a");
    });

    it("broadcasts to all sessions when userId is absent", async () => {
      const wsA = makeMockWs();
      const wsB = makeMockWs();
      channel.addClient(wsA, "session-a");
      channel.addClient(wsB, "session-b");

      const msg: OutgoingMessage = { parts: textParts("Broadcast") };
      await channel.send(msg);

      expect(wsA.send).toHaveBeenCalledOnce();
      expect(wsB.send).toHaveBeenCalledOnce();
    });

    it("is a no-op when userId targets an unknown session", async () => {
      const ws = makeMockWs();
      channel.addClient(ws, "session-a");

      await channel.send({ parts: textParts("lost"), userId: "unknown" });

      expect(ws.send).not.toHaveBeenCalled();
    });

    it("skips closed clients", async () => {
      const open = makeMockWs(true);
      const closed = makeMockWs(false);
      channel.addClient(open, "session-a");
      channel.addClient(closed, "session-a");

      await channel.send({ parts: textParts("test"), userId: "session-a" });

      expect(open.send).toHaveBeenCalledOnce();
      expect(closed.send).not.toHaveBeenCalled();
    });

    it("removes clients that throw on send", async () => {
      const good = makeMockWs();
      const bad = makeMockWs();
      vi.mocked(bad.send).mockImplementation(() => {
        throw new Error("closed");
      });
      channel.addClient(good, "session-a");
      channel.addClient(bad, "session-a");

      await channel.send({ parts: textParts("test"), userId: "session-a" });

      expect(channel.clientCount).toBe(1);
    });
  });

  describe("stream()", () => {
    it("broadcasts events to all sessions", async () => {
      const wsA = makeMockWs();
      const wsB = makeMockWs();
      channel.addClient(wsA, "session-a");
      channel.addClient(wsB, "session-b");

      async function* events(): AsyncGenerator<EngineEvent> {
        yield {
          type: "phase_changed",
          timestamp: new Date("2026-01-15T10:00:00Z"),
          payload: { phase: "analyze" },
        };
      }

      await channel.stream(events());

      expect(wsA.send).toHaveBeenCalledOnce();
      expect(wsB.send).toHaveBeenCalledOnce();

      const payload = JSON.parse(vi.mocked(wsA.send).mock.calls[0]![0] as string);
      expect(payload.type).toBe("event");
      expect(payload.event).toBe("phase_changed");
      expect(payload.data).toEqual({ phase: "analyze" });
    });
  });
});
