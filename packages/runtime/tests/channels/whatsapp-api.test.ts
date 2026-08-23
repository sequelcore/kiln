import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendWhatsAppAudioMessage,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  whatsappMessagesUrl,
  whatsappMediaUrl,
  WHATSAPP_GRAPH_API_VERSION,
} from "../../src/channels/whatsapp-api.js";
import type { WhatsAppTemplateComponent } from "../../src/channels/whatsapp-api.js";

describe("whatsapp-api", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("URL builders", () => {
    it("builds messages URL", () => {
      expect(whatsappMessagesUrl("12345")).toBe(
        `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/12345/messages`,
      );
    });

    it("builds media URL", () => {
      expect(whatsappMediaUrl("media-99")).toBe(
        `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/media-99`,
      );
    });
  });

  describe("sendWhatsAppMessage", () => {
    it("sends with correct headers and body", async () => {
      fetchMock.mockResolvedValue({ ok: true });

      await sendWhatsAppMessage("phone1", "token1", "+5551234", {
        type: "text",
        text: { body: "Hello" },
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const call = fetchMock.mock.calls.at(0);
      if (!call) throw new Error("Expected WhatsApp request");
      const [url, opts] = call;
      expect(url).toContain("/phone1/messages");
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe("Bearer token1");

      const body = JSON.parse(opts.body);
      expect(body.messaging_product).toBe("whatsapp");
      expect(body.to).toBe("+5551234");
      expect(body.type).toBe("text");
    });

    it("throws on non-OK response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request"),
      });

      await expect(
        sendWhatsAppMessage("phone1", "token1", "+5551234", { type: "text" }),
      ).rejects.toThrow("WhatsApp API error 400");
    });
  });

  describe("sendWhatsAppAudioMessage", () => {
    it("sends audio as a public media link", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: "wamid.audio" }] }),
      });

      const result = await sendWhatsAppAudioMessage(
        "phone1",
        "token1",
        "+5551234",
        "https://media.example.com/audio.mp3",
      );

      expect(result.whatsappMessageId).toBe("wamid.audio");
      const call = fetchMock.mock.calls.at(0);
      if (!call) throw new Error("Expected WhatsApp request");
      const opts = call[1];
      if (!opts) throw new Error("Expected WhatsApp request options");
      const body = JSON.parse(opts.body);
      expect(body.type).toBe("audio");
      expect(body.audio.link).toBe("https://media.example.com/audio.mp3");
    });
  });

  describe("sendWhatsAppTemplate", () => {
    it("sends template with name and language", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: "wamid.abc123" }] }),
      });

      const result = await sendWhatsAppTemplate(
        "phone1",
        "token1",
        "+5551234",
        "order_confirmation",
        "es_MX",
      );

      expect(result.whatsappMessageId).toBe("wamid.abc123");

      const call = fetchMock.mock.calls.at(0);
      if (!call) throw new Error("Expected WhatsApp request");
      const opts = call[1];
      if (!opts) throw new Error("Expected WhatsApp request options");
      const body = JSON.parse(opts.body);
      expect(body.type).toBe("template");
      expect(body.template.name).toBe("order_confirmation");
      expect(body.template.language.code).toBe("es_MX");
      expect(body.template.components).toBeUndefined();
    });

    it("sends template with components", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: "wamid.xyz789" }] }),
      });

      const components: WhatsAppTemplateComponent[] = [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Maria" },
            { type: "text", text: "3:00 PM" },
          ],
        },
        {
          type: "header",
          parameters: [
            { type: "image", image: { link: "https://example.com/img.jpg" } },
          ],
        },
      ];

      const result = await sendWhatsAppTemplate(
        "phone1",
        "token1",
        "+5551234",
        "appointment_reminder",
        "en_US",
        components,
      );

      expect(result.whatsappMessageId).toBe("wamid.xyz789");

      const call = fetchMock.mock.calls.at(0);
      if (!call) throw new Error("Expected WhatsApp request");
      const opts = call[1];
      if (!opts) throw new Error("Expected WhatsApp request options");
      const body = JSON.parse(opts.body);
      expect(body.template.components).toHaveLength(2);
      expect(body.template.components[0].type).toBe("body");
      expect(body.template.components[0].parameters[0].text).toBe("Maria");
    });

    it("omits components when empty array", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: "wamid.empty" }] }),
      });

      await sendWhatsAppTemplate("phone1", "token1", "+5551234", "hello_world", "en_US", []);

      const call = fetchMock.mock.calls.at(0);
      if (!call) throw new Error("Expected WhatsApp request");
      const opts = call[1];
      if (!opts) throw new Error("Expected WhatsApp request options");
      const body = JSON.parse(opts.body);
      expect(body.template.components).toBeUndefined();
    });

    it("throws when API returns no message ID", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      });

      await expect(
        sendWhatsAppTemplate("phone1", "token1", "+5551234", "test", "en_US"),
      ).rejects.toThrow("no message ID");
    });

    it("propagates API errors", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });

      await expect(
        sendWhatsAppTemplate("phone1", "token1", "+5551234", "test", "en_US"),
      ).rejects.toThrow("WhatsApp API error 401");
    });
  });
});
