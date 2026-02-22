import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { SlackChannel } from "../../src/channels/slack-channel.js";
import type { IncomingMessage, OutgoingMessage, EngineEvent } from "@kilnai/core";
import { textParts } from "@kilnai/core";

const CONFIG = {
  botToken: "xoxb-test-bot-token",
  signingSecret: "test-signing-secret",
};

function makeSignature(signingSecret: string, timestamp: string, body: string): string {
  const baseString = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", signingSecret).update(baseString).digest("hex")}`;
}

describe("SlackChannel", () => {
  let channel: SlackChannel;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    channel = new SlackChannel(CONFIG);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has correct name and default format", () => {
    expect(channel.name).toBe("slack");
    expect(channel.defaultFormat).toBe("full");
  });

  describe("receive()", () => {
    it("invokes registered message handler", async () => {
      const handler = vi.fn();
      channel.onMessage(handler);

      const msg: IncomingMessage = {
        parts: textParts("Help me refactor this"),
        source: "slack",
        userId: "U12345",
        threadId: "1234567890.123456",
      };
      await channel.receive(msg);

      expect(handler).toHaveBeenCalledWith(msg);
    });

    it("does nothing without a handler", async () => {
      const msg: IncomingMessage = { parts: textParts("hello"), source: "slack" };
      await expect(channel.receive(msg)).resolves.not.toThrow();
    });
  });

  describe("send()", () => {
    it("calls fetch with correct URL, headers, and body", async () => {
      const msg: OutgoingMessage = {
        parts: textParts("**Build passed** :white_check_mark:"),
        target: "C12345678",
      };
      await channel.send(msg);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(url).toBe("https://slack.com/api/chat.postMessage");
      expect(options.method).toBe("POST");

      const headers = options.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${CONFIG.botToken}`);
      expect(headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(options.body as string);
      expect(body.channel).toBe("C12345678");
      expect(body.text).toBe("**Build passed** :white_check_mark:");
      expect(body.thread_ts).toBeUndefined();
    });

    it("includes thread_ts when threadId is provided", async () => {
      const msg: OutgoingMessage = {
        parts: textParts("Reply in thread"),
        target: "C12345678",
        threadId: "1234567890.123456",
      };
      await channel.send(msg);

      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(body.thread_ts).toBe("1234567890.123456");
    });

    it("does not include thread_ts when threadId is absent", async () => {
      const msg: OutgoingMessage = {
        parts: textParts("Top-level message"),
        target: "C12345678",
      };
      await channel.send(msg);

      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(Object.prototype.hasOwnProperty.call(body, "thread_ts")).toBe(false);
    });

    it("keeps markdown for full format", async () => {
      const msg: OutgoingMessage = {
        parts: textParts("**Bold** and `code`"),
        target: "C12345678",
        format: "full",
      };
      await channel.send(msg);

      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(body.text).toBe("**Bold** and `code`");
    });
  });

  describe("verifyRequest()", () => {
    it("returns true for a valid HMAC signature", () => {
      const timestamp = "1609459200";
      const body = '{"event":{"type":"message"}}';
      const signature = makeSignature(CONFIG.signingSecret, timestamp, body);

      expect(channel.verifyRequest(timestamp, body, signature)).toBe(true);
    });

    it("returns false for an invalid signature", () => {
      const timestamp = "1609459200";
      const body = '{"event":{"type":"message"}}';

      expect(channel.verifyRequest(timestamp, body, "v0=invalidsignature1234567890abcdef")).toBe(false);
    });

    it("returns false when body has been tampered with", () => {
      const timestamp = "1609459200";
      const body = '{"event":{"type":"message"}}';
      const signature = makeSignature(CONFIG.signingSecret, timestamp, body);
      const tamperedBody = '{"event":{"type":"malicious"}}';

      expect(channel.verifyRequest(timestamp, tamperedBody, signature)).toBe(false);
    });

    it("returns false when timestamp has been changed", () => {
      const timestamp = "1609459200";
      const body = '{"event":{"type":"message"}}';
      const signature = makeSignature(CONFIG.signingSecret, timestamp, body);

      expect(channel.verifyRequest("9999999999", body, signature)).toBe(false);
    });
  });

  describe("stream()", () => {
    it("sends each event as a Slack message", async () => {
      async function* events(): AsyncGenerator<EngineEvent> {
        yield { type: "gate_result", timestamp: new Date(), payload: { gate: "lint", passed: true } };
        yield { type: "cost_update", timestamp: new Date(), payload: { total: 0.05 } };
      }

      await channel.stream(events());

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const firstBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(firstBody.text).toContain("[gate_result]");
      expect(firstBody.text).toContain("lint");

      const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
      expect(secondBody.text).toContain("[cost_update]");
      expect(secondBody.text).toContain("0.05");
    });
  });
});
