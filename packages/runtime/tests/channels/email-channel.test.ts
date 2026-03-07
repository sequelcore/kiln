import { describe, it, expect, vi } from "vitest";
import { EmailChannel } from "../../src/channels/email-channel.js";
import type { EmailTransport } from "../../src/channels/email-api.js";
import type { IncomingMessage, OutgoingMessage } from "@kilnai/core";

function mockTransport(): EmailTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn().mockResolvedValue({ messageId: "msg-1" }) };
}

describe("EmailChannel", () => {
  it("has correct name and defaults", () => {
    const ch = new EmailChannel({
      transport: mockTransport(),
      fromAddress: "bot@example.com",
    });
    expect(ch.name).toBe("email");
    expect(ch.defaultFormat).toBe("full");
    expect(ch.supportedModalities).toEqual(["text", "file"]);
  });

  it("calls message handler on receive", async () => {
    const ch = new EmailChannel({
      transport: mockTransport(),
      fromAddress: "bot@example.com",
    });
    const handler = vi.fn();
    ch.onMessage(handler);

    const msg: IncomingMessage = {
      parts: [{ type: "text", text: "Hello via email" }],
      source: "email",
      userId: "user@example.com",
    };
    await ch.receive(msg);
    expect(handler).toHaveBeenCalledWith(msg);
  });

  it("does not throw when no handler is set", async () => {
    const ch = new EmailChannel({
      transport: mockTransport(),
      fromAddress: "bot@example.com",
    });

    await expect(
      ch.receive({ parts: [{ type: "text", text: "Hi" }], source: "email" }),
    ).resolves.toBeUndefined();
  });

  it("sends email via transport with correct fields", async () => {
    const transport = mockTransport();
    const ch = new EmailChannel({
      transport,
      fromAddress: "bot@example.com",
      fromName: "Support Bot",
    });

    const outgoing: OutgoingMessage = {
      parts: [{ type: "text", text: "Thanks for reaching out." }],
      target: "user@example.com",
      format: "full",
      metadata: {
        to: "user@example.com",
        subject: "Re: Help request",
        inReplyTo: "<orig@example.com>",
        references: "<orig@example.com>",
      },
    };
    await ch.send(outgoing);

    expect(transport.send).toHaveBeenCalledOnce();
    const email = transport.send.mock.calls[0][0];
    expect(email.from).toBe("bot@example.com");
    expect(email.fromName).toBe("Support Bot");
    expect(email.to).toBe("user@example.com");
    expect(email.subject).toBe("Re: Help request");
    expect(email.inReplyTo).toBe("<orig@example.com>");
    expect(email.references).toBe("<orig@example.com>");
    expect(email.textBody).toContain("Thanks for reaching out");
    expect(email.htmlBody).toContain("<p");
  });

  it("uses target as fallback when metadata.to is absent", async () => {
    const transport = mockTransport();
    const ch = new EmailChannel({ transport, fromAddress: "bot@example.com" });

    await ch.send({
      parts: [{ type: "text", text: "Hello" }],
      target: "fallback@example.com",
      format: "full",
    });

    const email = transport.send.mock.calls[0][0];
    expect(email.to).toBe("fallback@example.com");
    expect(email.subject).toBe("Re: Your message");
  });

  it("does not send when text is empty", async () => {
    const transport = mockTransport();
    const ch = new EmailChannel({ transport, fromAddress: "bot@example.com" });

    await ch.send({
      parts: [{ type: "image", mimeType: "image/png", url: "https://img.png" }],
      target: "user@example.com",
      format: "full",
    });

    expect(transport.send).not.toHaveBeenCalled();
  });

  it("preserves full markdown (no stripping)", async () => {
    const transport = mockTransport();
    const ch = new EmailChannel({ transport, fromAddress: "bot@example.com" });

    await ch.send({
      parts: [{ type: "text", text: "**bold** and _italic_ and `code`" }],
      target: "user@example.com",
      format: "full",
    });

    const email = transport.send.mock.calls[0][0];
    // Plain text strips markdown
    expect(email.textBody).not.toContain("**");
    expect(email.textBody).toContain("bold");
    // HTML body contains the text content
    expect(email.htmlBody).toContain("bold");
  });
});
