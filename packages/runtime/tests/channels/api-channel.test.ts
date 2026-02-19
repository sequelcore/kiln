import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiChannel } from "../../src/channels/api-channel.js";
import type { SseWriter } from "../../src/channels/api-channel.js";
import type { IncomingMessage, OutgoingMessage, EngineEvent } from "@kiln/core";

function makeMockWriter(): SseWriter {
  return {
    write: vi.fn(),
    close: vi.fn(),
  };
}

describe("ApiChannel", () => {
  let channel: ApiChannel;

  beforeEach(() => {
    channel = new ApiChannel();
  });

  it("has correct name and default format", () => {
    expect(channel.name).toBe("api");
    expect(channel.defaultFormat).toBe("structured");
  });

  describe("receive()", () => {
    it("invokes registered message handler", async () => {
      const handler = vi.fn();
      channel.onMessage(handler);

      const msg: IncomingMessage = {
        content: "run task",
        source: "api",
        userId: "u1",
        threadId: "t1",
      };
      await channel.receive(msg);

      expect(handler).toHaveBeenCalledWith(msg);
    });

    it("does nothing without a handler", async () => {
      await expect(
        channel.receive({ content: "hello", source: "api" }),
      ).resolves.not.toThrow();
    });
  });

  describe("send()", () => {
    it("pushes message to the response queue", async () => {
      const msg: OutgoingMessage = {
        content: "done",
        target: "client",
        userId: "u1",
        threadId: "t1",
      };
      await channel.send(msg);

      const responses = channel.pollResponses();
      expect(responses).toHaveLength(1);
      expect(responses[0]).toBe(msg);
    });

    it("broadcasts to all connected SSE clients", async () => {
      const writer1 = makeMockWriter();
      const writer2 = makeMockWriter();
      channel.addSseClient(writer1);
      channel.addSseClient(writer2);

      const msg: OutgoingMessage = {
        content: "result",
        target: "broadcast",
        userId: "u1",
        threadId: "t2",
      };
      await channel.send(msg);

      expect(writer1.write).toHaveBeenCalledOnce();
      expect(writer2.write).toHaveBeenCalledOnce();

      const raw = vi.mocked(writer1.write).mock.calls[0]![0] as string;
      expect(raw.startsWith("data: ")).toBe(true);
      expect(raw.endsWith("\n\n")).toBe(true);

      const payload = JSON.parse(raw.slice(6));
      expect(payload.type).toBe("message");
      expect(payload.content).toBe("result");
      expect(payload.target).toBe("broadcast");
      expect(payload.userId).toBe("u1");
      expect(payload.threadId).toBe("t2");
    });

    it("removes SSE clients that throw on write", async () => {
      const good = makeMockWriter();
      const bad = makeMockWriter();
      vi.mocked(bad.write).mockImplementation(() => {
        throw new Error("disconnected");
      });
      channel.addSseClient(good);
      channel.addSseClient(bad);

      await channel.send({ content: "test", target: "all" });

      expect(channel.sseClientCount).toBe(1);
    });
  });

  describe("pollResponses()", () => {
    it("returns and clears the queue", async () => {
      await channel.send({ content: "a", target: "c1" });
      await channel.send({ content: "b", target: "c2" });

      const first = channel.pollResponses();
      expect(first).toHaveLength(2);

      const second = channel.pollResponses();
      expect(second).toHaveLength(0);
    });
  });

  describe("stream()", () => {
    it("sends engine events to all SSE clients", async () => {
      const writer = makeMockWriter();
      channel.addSseClient(writer);

      const ts = new Date("2026-02-18T10:00:00Z");

      async function* events(): AsyncGenerator<EngineEvent> {
        yield {
          type: "phase_started",
          timestamp: ts,
          payload: { phase: "analyze" },
        };
      }

      await channel.stream(events());

      expect(writer.write).toHaveBeenCalledOnce();
      const raw = vi.mocked(writer.write).mock.calls[0]![0] as string;
      expect(raw.startsWith("data: ")).toBe(true);
      expect(raw.endsWith("\n\n")).toBe(true);

      const payload = JSON.parse(raw.slice(6));
      expect(payload.type).toBe("event");
      expect(payload.event).toBe("phase_started");
      expect(payload.payload).toEqual({ phase: "analyze" });
    });
  });

  describe("SSE client management", () => {
    it("tracks client count correctly", () => {
      expect(channel.sseClientCount).toBe(0);

      const w1 = makeMockWriter();
      const w2 = makeMockWriter();
      channel.addSseClient(w1);
      expect(channel.sseClientCount).toBe(1);

      channel.addSseClient(w2);
      expect(channel.sseClientCount).toBe(2);

      channel.removeSseClient(w1);
      expect(channel.sseClientCount).toBe(1);
    });
  });

  describe("validateApiKey()", () => {
    it("returns true when no apiKey is configured", () => {
      expect(channel.validateApiKey("anything")).toBe(true);
      expect(channel.validateApiKey("")).toBe(true);
    });

    it("returns true when key matches configured apiKey", () => {
      const secured = new ApiChannel({ apiKey: "secret-key" });
      expect(secured.validateApiKey("secret-key")).toBe(true);
    });

    it("returns false when key does not match configured apiKey", () => {
      const secured = new ApiChannel({ apiKey: "secret-key" });
      expect(secured.validateApiKey("wrong-key")).toBe(false);
      expect(secured.validateApiKey("")).toBe(false);
    });
  });

  describe("Queue bounds (max 100)", () => {
    it("discards oldest entry when queue exceeds max size", async () => {
      // Fill queue with 100 items
      for (let i = 0; i < 100; i++) {
        await channel.send({ content: `msg-${i}`, target: "t" });
      }

      // Add one more: oldest (msg-0) should be dropped
      await channel.send({ content: "msg-100", target: "t" });

      const responses = channel.pollResponses();
      expect(responses).toHaveLength(100);
      expect(responses[0]!.content).toBe("msg-1");
      expect(responses[99]!.content).toBe("msg-100");
    });
  });
});
