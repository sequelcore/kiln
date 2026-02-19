import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebChannel } from "../../src/channels/web-channel.js";
import type { WebSocketLike } from "../../src/channels/web-channel.js";
import type { IncomingMessage, OutgoingMessage, EngineEvent } from "@kilnai/core";

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
    it("tracks client count", () => {
      expect(channel.clientCount).toBe(0);

      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      channel.addClient(ws1);
      expect(channel.clientCount).toBe(1);

      channel.addClient(ws2);
      expect(channel.clientCount).toBe(2);

      channel.removeClient(ws1);
      expect(channel.clientCount).toBe(1);
    });
  });

  describe("receive()", () => {
    it("invokes registered message handler", async () => {
      const handler = vi.fn();
      channel.onMessage(handler);

      const msg: IncomingMessage = {
        content: "start session",
        source: "web",
        userId: "u1",
        threadId: "t1",
      };
      await channel.receive(msg);

      expect(handler).toHaveBeenCalledWith(msg);
    });

    it("does nothing without a handler", async () => {
      await expect(
        channel.receive({ content: "hello", source: "web" }),
      ).resolves.not.toThrow();
    });
  });

  describe("send()", () => {
    it("broadcasts formatted JSON to all open clients", async () => {
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      channel.addClient(ws1);
      channel.addClient(ws2);

      const msg: OutgoingMessage = {
        content: "Result ready",
        target: "broadcast",
        userId: "u1",
      };
      await channel.send(msg);

      expect(ws1.send).toHaveBeenCalledOnce();
      expect(ws2.send).toHaveBeenCalledOnce();

      const payload = JSON.parse(vi.mocked(ws1.send).mock.calls[0]![0] as string);
      expect(payload.type).toBe("output");
      expect(payload.text).toBe("Result ready");
      expect(payload.userId).toBe("u1");
    });

    it("skips closed clients", async () => {
      const open = makeMockWs(true);
      const closed = makeMockWs(false);
      channel.addClient(open);
      channel.addClient(closed);

      await channel.send({ content: "test", target: "all" });

      expect(open.send).toHaveBeenCalledOnce();
      expect(closed.send).not.toHaveBeenCalled();
    });

    it("removes clients that throw on send", async () => {
      const good = makeMockWs();
      const bad = makeMockWs();
      vi.mocked(bad.send).mockImplementation(() => {
        throw new Error("closed");
      });
      channel.addClient(good);
      channel.addClient(bad);

      await channel.send({ content: "test", target: "all" });

      expect(channel.clientCount).toBe(1);
    });
  });

  describe("stream()", () => {
    it("broadcasts events as JSON to all clients", async () => {
      const ws = makeMockWs();
      channel.addClient(ws);

      async function* events(): AsyncGenerator<EngineEvent> {
        yield {
          type: "phase_changed",
          timestamp: new Date("2026-01-15T10:00:00Z"),
          payload: { phase: "analyze" },
        };
      }

      await channel.stream(events());

      expect(ws.send).toHaveBeenCalledOnce();
      const payload = JSON.parse(vi.mocked(ws.send).mock.calls[0]![0] as string);
      expect(payload.type).toBe("event");
      expect(payload.event).toBe("phase_changed");
      expect(payload.data).toEqual({ phase: "analyze" });
    });
  });
});
