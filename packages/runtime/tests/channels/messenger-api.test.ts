import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendMessengerMessage,
  sendMessengerMediaMessage,
  messengerMessagesUrl,
  MESSENGER_GRAPH_API_VERSION,
} from "../../src/channels/messenger-api.js";

describe("messenger-api", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("messengerMessagesUrl", () => {
    it("builds correct URL using me/messages", () => {
      expect(messengerMessagesUrl()).toBe(
        `https://graph.facebook.com/${MESSENGER_GRAPH_API_VERSION}/me/messages`,
      );
    });
  });

  describe("sendMessengerMessage", () => {
    it("sends text with messaging_type RESPONSE", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recipient_id: "psid-1", message_id: "mid-1" }),
      });

      const result = await sendMessengerMessage("token-1", "psid-1", "Hello");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain("/me/messages");
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe("Bearer token-1");

      const body = JSON.parse(opts.body);
      expect(body.messaging_type).toBe("RESPONSE");
      expect(body.recipient.id).toBe("psid-1");
      expect(body.message.text).toBe("Hello");
      expect(result.recipientId).toBe("psid-1");
      expect(result.messageId).toBe("mid-1");
    });

    it("throws on non-OK response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request"),
      });

      await expect(
        sendMessengerMessage("token-1", "psid-1", "Hello"),
      ).rejects.toThrow("Messenger API error 400");
    });

    it("falls back to recipientId when API omits it", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await sendMessengerMessage("token-1", "psid-1", "Hi");
      expect(result.recipientId).toBe("psid-1");
      expect(result.messageId).toBe("");
    });
  });

  describe("sendMessengerMediaMessage", () => {
    it("sends image with messaging_type RESPONSE", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recipient_id: "psid-2", message_id: "mid-2" }),
      });

      const result = await sendMessengerMediaMessage(
        "token-1",
        "psid-2",
        "https://cdn.example.com/img.jpg",
        "image",
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.messaging_type).toBe("RESPONSE");
      expect(body.recipient.id).toBe("psid-2");
      expect(body.message.attachment.type).toBe("image");
      expect(body.message.attachment.payload.url).toBe("https://cdn.example.com/img.jpg");
      expect(result.messageId).toBe("mid-2");
    });

    it("sends audio with messaging_type RESPONSE", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recipient_id: "psid-2", message_id: "mid-audio" }),
      });

      await sendMessengerMediaMessage(
        "token-1",
        "psid-2",
        "https://cdn.example.com/audio.mp3",
        "audio",
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.messaging_type).toBe("RESPONSE");
      expect(body.recipient.id).toBe("psid-2");
      expect(body.message.attachment.type).toBe("audio");
      expect(body.message.attachment.payload.url).toBe("https://cdn.example.com/audio.mp3");
    });

    it("throws on non-OK response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });

      await expect(
        sendMessengerMediaMessage("token-1", "psid-1", "https://img.jpg", "image"),
      ).rejects.toThrow("Messenger API error 403");
    });
  });
});
