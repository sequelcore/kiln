import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MessengerChannel } from "../../src/channels/messenger-channel.js";
import type { IncomingMessage, OutgoingMessage } from "@kilnai/core/engine";

describe("MessengerChannel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ recipient_id: "psid-1", message_id: "mid-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has correct name and defaults", () => {
    const ch = new MessengerChannel({ accessToken: "t1" });
    expect(ch.name).toBe("messenger");
    expect(ch.defaultFormat).toBe("short");
    expect(ch.supportedModalities).toEqual(["text", "image", "audio"]);
  });

  it("calls message handler on receive", async () => {
    const ch = new MessengerChannel({ accessToken: "t1" });
    const handler = vi.fn();
    ch.onMessage(handler);

    const msg: IncomingMessage = {
      parts: [{ type: "text", text: "Hello" }],
      source: "messenger",
      userId: "psid-1",
    };
    await ch.receive(msg);
    expect(handler).toHaveBeenCalledWith(msg);
  });

  it("sends text messages via Messenger API", async () => {
    const ch = new MessengerChannel({ accessToken: "token-abc" });

    const outgoing: OutgoingMessage = {
      parts: [{ type: "text", text: "Hello world" }],
      target: "psid-1",
      format: "short",
    };
    await ch.send(outgoing);

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messaging_type).toBe("RESPONSE");
    expect(body.recipient.id).toBe("psid-1");
    expect(body.message.text).toBe("Hello world");
  });

  it("sends image before text", async () => {
    const ch = new MessengerChannel({ accessToken: "t1" });

    await ch.send({
      parts: [
        { type: "image", mimeType: "image/jpeg", url: "https://img.jpg" },
        { type: "text", text: "Caption" },
      ],
      target: "psid-1",
      format: "short",
    });

    // 2 calls: image + text
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const imageBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(imageBody.message.attachment.type).toBe("image");
    const textBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(textBody.message.text).toBe("Caption");
  });

  it("sends audio before text", async () => {
    const ch = new MessengerChannel({ accessToken: "t1" });

    await ch.send({
      parts: [
        { type: "audio", mimeType: "audio/mpeg", url: "https://media.example.com/reply.mp3" },
        { type: "text", text: "Transcript" },
      ],
      target: "psid-1",
      format: "short",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const audioBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(audioBody.message.attachment.type).toBe("audio");
    expect(audioBody.message.attachment.payload.url).toBe("https://media.example.com/reply.mp3");
    const textBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(textBody.message.text).toBe("Transcript");
  });

  it("strips markdown from text", async () => {
    const ch = new MessengerChannel({ accessToken: "t1" });

    await ch.send({
      parts: [{ type: "text", text: "**bold** and _italic_" }],
      target: "psid-1",
      format: "short",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.message.text).not.toContain("**");
    expect(body.message.text).toContain("bold");
  });
});
