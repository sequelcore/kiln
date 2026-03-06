import { describe, it, expect, vi } from "vitest";
import { preprocessAudio, createWhatsAppMediaDownloader, createGenericMediaDownloader } from "../../src/gateway/audio-preprocessor.js";
import type { MediaDownloader } from "../../src/gateway/audio-preprocessor.js";
import type { SttAdapter, SttResult } from "@kilnai/core";
import type { ContentPart } from "@kilnai/core";

function mockStt(text = "hello world"): SttAdapter {
  return {
    name: "mock",
    transcribe: vi.fn().mockResolvedValue({ text, confidence: 0.95, durationMs: 2000 } satisfies SttResult),
  };
}

function mockDownloader(): MediaDownloader {
  return {
    download: vi.fn().mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "audio/ogg",
    }),
  };
}

describe("preprocessAudio", () => {
  it("passes through non-audio parts unchanged", async () => {
    const parts: ContentPart[] = [
      { type: "text", text: "hello" },
      { type: "image", mimeType: "image/png", url: "https://example.com/img.png" },
    ];
    const result = await preprocessAudio(parts, mockStt(), mockDownloader());
    expect(result).toEqual(parts);
  });

  it("transcribes audio part with url", async () => {
    const stt = mockStt("transcribed text");
    const dl = mockDownloader();
    const parts: ContentPart[] = [
      { type: "audio", mimeType: "audio/ogg", url: "https://example.com/audio.ogg" },
    ];

    const result = await preprocessAudio(parts, stt, dl);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "[Voice note transcription]: transcribed text" });
    expect(dl.download).toHaveBeenCalledWith("https://example.com/audio.ogg");
    expect(stt.transcribe).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "audio/ogg");
  });

  it("transcribes audio part with base64 data", async () => {
    const stt = mockStt("from base64");
    const dl = mockDownloader();
    const raw = new Uint8Array([10, 20, 30]);
    const base64 = btoa(String.fromCharCode(...raw));
    const parts: ContentPart[] = [
      { type: "audio", mimeType: "audio/mp3", data: base64 },
    ];

    const result = await preprocessAudio(parts, stt, dl);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "[Voice note transcription]: from base64" });
    expect(dl.download).not.toHaveBeenCalled();
    expect(stt.transcribe).toHaveBeenCalledWith(raw, "audio/mp3");
  });

  it("handles mixed parts preserving order", async () => {
    const stt = mockStt("voice");
    const dl = mockDownloader();
    const parts: ContentPart[] = [
      { type: "text", text: "before" },
      { type: "audio", mimeType: "audio/ogg", url: "https://example.com/a.ogg" },
      { type: "text", text: "after" },
    ];

    const result = await preprocessAudio(parts, stt, dl);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "text", text: "before" });
    expect(result[1]).toEqual({ type: "text", text: "[Voice note transcription]: voice" });
    expect(result[2]).toEqual({ type: "text", text: "after" });
  });

  it("falls back gracefully on transcription failure", async () => {
    const stt: SttAdapter = {
      name: "mock",
      transcribe: vi.fn().mockRejectedValue(new Error("STT down")),
    };
    const dl = mockDownloader();
    const parts: ContentPart[] = [
      { type: "audio", mimeType: "audio/ogg", url: "https://example.com/a.ogg" },
    ];

    const result = await preprocessAudio(parts, stt, dl);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "[Voice note: transcription unavailable]" });
  });

  it("falls back gracefully on download failure", async () => {
    const stt = mockStt();
    const dl: MediaDownloader = {
      download: vi.fn().mockRejectedValue(new Error("network error")),
    };
    const parts: ContentPart[] = [
      { type: "audio", mimeType: "audio/ogg", url: "https://example.com/a.ogg" },
    ];

    const result = await preprocessAudio(parts, stt, dl);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "[Voice note: transcription unavailable]" });
  });

  it("handles audio part with neither url nor data", async () => {
    const stt = mockStt();
    const dl = mockDownloader();
    const parts: ContentPart[] = [
      { type: "audio", mimeType: "audio/ogg" } as ContentPart,
    ];

    const result = await preprocessAudio(parts, stt, dl);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "[Voice note: transcription unavailable]" });
  });
});

describe("createWhatsAppMediaDownloader", () => {
  it("performs two-step download with auth header", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ url: "https://cdn.whatsapp.net/media/123", mime_type: "audio/ogg" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const dl = createWhatsAppMediaDownloader("test-token");
      const result = await dl.download("https://graph.facebook.com/v21.0/media123");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0]![0]).toBe("https://graph.facebook.com/v21.0/media123");
      expect(mockFetch.mock.calls[0]![1]).toEqual({ headers: { Authorization: "Bearer test-token" } });
      expect(mockFetch.mock.calls[1]![0]).toBe("https://cdn.whatsapp.net/media/123");
      expect(result.mimeType).toBe("audio/ogg");
      expect(result.data).toBeInstanceOf(Uint8Array);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("createGenericMediaDownloader", () => {
  it("downloads media with content-type detection", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      headers: new Headers({ "content-type": "audio/mp3" }),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const dl = createGenericMediaDownloader();
      const result = await dl.download("https://example.com/audio.mp3");

      expect(result.mimeType).toBe("audio/mp3");
      expect(result.data).toBeInstanceOf(Uint8Array);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
