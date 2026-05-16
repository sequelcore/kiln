import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InstagramChannel } from "../../src/channels/instagram-channel.js";
import type { IncomingMessage, OutgoingMessage } from "@kilnai/core";

describe("InstagramChannel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ recipient_id: "user-1", message_id: "mid-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has correct name and defaults", () => {
    const ch = new InstagramChannel({ pageId: "p1", accessToken: "t1" });
    expect(ch.name).toBe("instagram");
    expect(ch.defaultFormat).toBe("short");
    expect(ch.supportedModalities).toEqual(["text", "image", "audio"]);
  });

  it("calls message handler on receive", async () => {
    const ch = new InstagramChannel({ pageId: "p1", accessToken: "t1" });
    const handler = vi.fn();
    ch.onMessage(handler);

    const msg: IncomingMessage = {
      parts: [{ type: "text", text: "Hello" }],
      source: "instagram",
      userId: "user-1",
    };
    await ch.receive(msg);
    expect(handler).toHaveBeenCalledWith(msg);
  });

  it("sends text messages via Instagram API", async () => {
    const ch = new InstagramChannel({ pageId: "page-123", accessToken: "token-abc" });

    const outgoing: OutgoingMessage = {
      parts: [{ type: "text", text: "Hello world" }],
      target: "user-1",
      format: "short",
    };
    await ch.send(outgoing);

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.recipient.id).toBe("user-1");
    expect(body.message.text).toBe("Hello world");
  });

  it("sends image before text", async () => {
    const ch = new InstagramChannel({ pageId: "p1", accessToken: "t1" });

    await ch.send({
      parts: [
        { type: "image", mimeType: "image/jpeg", url: "https://img.jpg" },
        { type: "text", text: "Caption" },
      ],
      target: "user-1",
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
    const ch = new InstagramChannel({ pageId: "p1", accessToken: "t1" });

    await ch.send({
      parts: [
        { type: "audio", mimeType: "audio/mpeg", url: "https://media.example.com/reply.mp3" },
        { type: "text", text: "Transcript" },
      ],
      target: "user-1",
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
    const ch = new InstagramChannel({ pageId: "p1", accessToken: "t1" });

    await ch.send({
      parts: [{ type: "text", text: "**bold** and _italic_" }],
      target: "user-1",
      format: "short",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // toInstagramFormat strips markdown
    expect(body.message.text).not.toContain("**");
    expect(body.message.text).toContain("bold");
  });
});
