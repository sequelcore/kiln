import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WhatsAppChannel } from "../../src/channels/whatsapp-channel.js";
import {
  type EngineEvent,
  type IncomingMessage,
  type OutgoingMessage,
  textParts,
} from "@kilnai/core/engine";

const CONFIG = {
  phoneNumberId: "123456789",
  accessToken: "test-access-token",
  verifyToken: "my-verify-token",
};

describe("WhatsAppChannel", () => {
  let channel: WhatsAppChannel;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    channel = new WhatsAppChannel(CONFIG);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has correct name and default format", () => {
    expect(channel.name).toBe("whatsapp");
    expect(channel.defaultFormat).toBe("short");
  });

  describe("receive()", () => {
    it("invokes registered message handler", async () => {
      const handler = vi.fn();
      channel.onMessage(handler);

      const msg: IncomingMessage = {
        parts: textParts("Hello from WhatsApp"),
        source: "whatsapp",
        userId: "+521234567890",
      };
      await channel.receive(msg);

      expect(handler).toHaveBeenCalledWith(msg);
    });

    it("does nothing without a handler", async () => {
      const msg: IncomingMessage = { parts: textParts("hello"), source: "whatsapp" };
      await expect(channel.receive(msg)).resolves.not.toThrow();
    });
  });

  describe("send()", () => {
    it("calls fetch with correct URL, headers, and body", async () => {
      const msg: OutgoingMessage = {
        parts: textParts("Task is complete"),
        target: "+521234567890",
      };
      await channel.send(msg);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`https://graph.facebook.com/v21.0/${CONFIG.phoneNumberId}/messages`);
      expect(options.method).toBe("POST");

      const headers = options.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${CONFIG.accessToken}`);
      expect(headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(options.body as string);
      expect(body).toEqual({
        messaging_product: "whatsapp",
        to: "+521234567890",
        type: "text",
        text: { body: "Task is complete" },
      });
    });

    it("strips markdown for short format", async () => {
      const msg: OutgoingMessage = {
        parts: textParts("**Bold** and `code`"),
        target: "+521234567890",
        format: "short",
      };
      await channel.send(msg);

      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(body.text.body).not.toContain("**");
      expect(body.text.body).toContain("Bold");
    });
  });

  describe("verifyWebhook()", () => {
    it("returns challenge when mode is subscribe and token matches", () => {
      const result = channel.verifyWebhook("subscribe", CONFIG.verifyToken, "abc123");
      expect(result).toBe("abc123");
    });

    it("returns null when token does not match", () => {
      const result = channel.verifyWebhook("subscribe", "wrong-token", "abc123");
      expect(result).toBeNull();
    });

    it("returns null when mode is not subscribe", () => {
      const result = channel.verifyWebhook("unsubscribe", CONFIG.verifyToken, "abc123");
      expect(result).toBeNull();
    });

    it("returns null when both mode and token are wrong", () => {
      const result = channel.verifyWebhook("other", "wrong", "abc123");
      expect(result).toBeNull();
    });
  });

  describe("stream()", () => {
    it("sends each event as a text message", async () => {
      async function* events(): AsyncGenerator<EngineEvent> {
        yield { type: "phase_changed", timestamp: new Date(), payload: { phase: "analyze" } };
        yield { type: "task_started", timestamp: new Date(), payload: { taskId: "t1" } };
      }

      await channel.stream(events());

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const firstBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(firstBody.text.body).toContain("[phase_changed]");
      expect(firstBody.text.body).toContain("analyze");

      const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
      expect(secondBody.text.body).toContain("[task_started]");
      expect(secondBody.text.body).toContain("t1");
    });
  });
});
