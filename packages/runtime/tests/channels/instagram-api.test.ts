import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendInstagramMessage,
  sendInstagramMediaMessage,
  instagramMessagesUrl,
  INSTAGRAM_GRAPH_API_VERSION,
} from "../../src/channels/instagram-api.js";

describe("instagram-api", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("instagramMessagesUrl", () => {
    it("builds correct URL", () => {
      expect(instagramMessagesUrl("page-123")).toBe(
        `https://graph.facebook.com/${INSTAGRAM_GRAPH_API_VERSION}/page-123/messages`,
      );
    });
  });

  describe("sendInstagramMessage", () => {
    it("sends text with correct headers and body", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recipient_id: "user-1", message_id: "mid-1" }),
      });

      const result = await sendInstagramMessage("page-1", "token-1", "user-1", "Hello");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain("/page-1/messages");
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe("Bearer token-1");

      const body = JSON.parse(opts.body);
      expect(body.recipient.id).toBe("user-1");
      expect(body.message.text).toBe("Hello");
      expect(result.recipientId).toBe("user-1");
      expect(result.messageId).toBe("mid-1");
    });

    it("throws on non-OK response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request"),
      });

      await expect(
        sendInstagramMessage("page-1", "token-1", "user-1", "Hello"),
      ).rejects.toThrow("Instagram API error 400");
    });

    it("falls back to recipientId when API omits it", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await sendInstagramMessage("page-1", "token-1", "user-1", "Hi");
      expect(result.recipientId).toBe("user-1");
      expect(result.messageId).toBe("");
    });
  });

  describe("sendInstagramMediaMessage", () => {
    it("sends image with correct body structure", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recipient_id: "user-2", message_id: "mid-2" }),
      });

      const result = await sendInstagramMediaMessage(
        "page-1",
        "token-1",
        "user-2",
        "https://cdn.example.com/img.jpg",
        "image",
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.recipient.id).toBe("user-2");
      expect(body.message.attachment.type).toBe("image");
      expect(body.message.attachment.payload.url).toBe("https://cdn.example.com/img.jpg");
      expect(result.messageId).toBe("mid-2");
    });

    it("throws on non-OK response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });

      await expect(
        sendInstagramMediaMessage("page-1", "token-1", "user-1", "https://img.jpg", "image"),
      ).rejects.toThrow("Instagram API error 403");
    });
  });
});
