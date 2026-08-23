import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEmailTransport } from "../../src/channels/email-api.js";
import type { OutboundEmail } from "../../src/channels/email-api.js";

const baseEmail: OutboundEmail = {
  from: "bot@example.com",
  fromName: "Support Bot",
  to: "user@example.com",
  subject: "Re: Help",
  htmlBody: "<p>Hello</p>",
  textBody: "Hello",
};

describe("email-api", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("PostmarkTransport", () => {
    it("sends with correct endpoint and headers", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MessageID: "pm-123" }),
      });

      const transport = createEmailTransport({ provider: "postmark", apiKey: "pk-test" });
      const result = await transport.send(baseEmail);

      expect(fetchMock).toHaveBeenCalledOnce();
      const call = fetchMock.mock.calls.at(0);
      if (!call) throw new Error("Expected Postmark request");
      const [url, opts] = call;
      expect(url).toBe("https://api.postmarkapp.com/email");
      expect(opts.method).toBe("POST");
      expect(opts.headers["X-Postmark-Server-Token"]).toBe("pk-test");
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(result.messageId).toBe("pm-123");
    });

    it("builds correct body shape with From name", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MessageID: "pm-456" }),
      });

      const transport = createEmailTransport({ provider: "postmark", apiKey: "pk-test" });
      await transport.send(baseEmail);

      const call = fetchMock.mock.calls.at(0);
      if (!call) throw new Error("Expected Postmark request");
      const opts = call[1];
      if (!opts) throw new Error("Expected Postmark request options");
      const body = JSON.parse(opts.body);
      expect(body.From).toBe("Support Bot <bot@example.com>");
      expect(body.To).toBe("user@example.com");
      expect(body.Subject).toBe("Re: Help");
      expect(body.HtmlBody).toBe("<p>Hello</p>");
      expect(body.TextBody).toBe("Hello");
    });

    it("includes In-Reply-To and References headers", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MessageID: "pm-789" }),
      });

      const transport = createEmailTransport({ provider: "postmark", apiKey: "pk-test" });
      await transport.send({ ...baseEmail, inReplyTo: "<msg-1@ex.com>", references: "<msg-0@ex.com>" });

      const call = fetchMock.mock.calls.at(0);
      if (!call) throw new Error("Expected Postmark request");
      const opts = call[1];
      if (!opts) throw new Error("Expected Postmark request options");
      const body = JSON.parse(opts.body);
      const headerNames = body.Headers.map((h: { Name: string }) => h.Name);
      expect(headerNames).toContain("In-Reply-To");
      expect(headerNames).toContain("References");
      expect(headerNames).toContain("Auto-Submitted");
    });

    it("throws on non-OK response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve("Invalid sender"),
      });

      const transport = createEmailTransport({ provider: "postmark", apiKey: "pk-test" });
      await expect(transport.send(baseEmail)).rejects.toThrow("Postmark API error 422");
    });

    it("falls back to empty messageId", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const transport = createEmailTransport({ provider: "postmark", apiKey: "pk-test" });
      const result = await transport.send(baseEmail);
      expect(result.messageId).toBe("");
    });
  });

  describe("ResendTransport", () => {
    it("sends with correct endpoint and Bearer auth", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "re-123" }),
      });

      const transport = createEmailTransport({ provider: "resend", apiKey: "re_test" });
      const result = await transport.send(baseEmail);

      const call = fetchMock.mock.calls.at(0);
      if (!call) throw new Error("Expected Resend request");
      const [url, opts] = call;
      expect(url).toBe("https://api.resend.com/emails");
      expect(opts.headers.Authorization).toBe("Bearer re_test");
      expect(result.messageId).toBe("re-123");
    });

    it("builds correct body shape", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "re-456" }),
      });

      const transport = createEmailTransport({ provider: "resend", apiKey: "re_test" });
      await transport.send(baseEmail);

      const call = fetchMock.mock.calls.at(0);
      if (!call) throw new Error("Expected Resend request");
      const opts = call[1];
      if (!opts) throw new Error("Expected Resend request options");
      const body = JSON.parse(opts.body);
      expect(body.from).toBe("Support Bot <bot@example.com>");
      expect(body.to).toBe("user@example.com");
      expect(body.subject).toBe("Re: Help");
      expect(body.html).toBe("<p>Hello</p>");
      expect(body.text).toBe("Hello");
    });

    it("throws on non-OK response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });

      const transport = createEmailTransport({ provider: "resend", apiKey: "re_test" });
      await expect(transport.send(baseEmail)).rejects.toThrow("Resend API error 403");
    });
  });

  describe("GenericApiTransport", () => {
    it("uses custom endpoint with Bearer auth", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messageId: "gen-123" }),
      });

      const transport = createEmailTransport({
        provider: "generic",
        apiKey: "key-1",
        endpoint: "https://mail.internal.io/send",
      });
      const result = await transport.send(baseEmail);

      const call = fetchMock.mock.calls.at(0);
      if (!call) throw new Error("Expected generic email request");
      const [url, opts] = call;
      expect(url).toBe("https://mail.internal.io/send");
      expect(opts.headers.Authorization).toBe("Bearer key-1");
      expect(result.messageId).toBe("gen-123");
    });

    it("throws on non-OK response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal error"),
      });

      const transport = createEmailTransport({
        provider: "generic",
        apiKey: "key-1",
        endpoint: "https://mail.internal.io/send",
      });
      await expect(transport.send(baseEmail)).rejects.toThrow("Email API error 500");
    });
  });

  describe("createEmailTransport", () => {
    it("creates postmark transport", () => {
      const t = createEmailTransport({ provider: "postmark", apiKey: "pk" });
      expect(t).toBeDefined();
      expect(t.send).toBeInstanceOf(Function);
    });

    it("creates resend transport", () => {
      const t = createEmailTransport({ provider: "resend", apiKey: "re" });
      expect(t).toBeDefined();
    });

    it("creates sendgrid transport", () => {
      const t = createEmailTransport({ provider: "sendgrid", apiKey: "sg" });
      expect(t).toBeDefined();
    });

    it("throws for generic without endpoint", () => {
      expect(() => createEmailTransport({ provider: "generic", apiKey: "k" })).toThrow(
        "Generic email transport requires an endpoint",
      );
    });
  });
});
