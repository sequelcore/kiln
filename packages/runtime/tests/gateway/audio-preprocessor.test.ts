import { describe, it, expect, vi } from "vitest";
import type { ContentPart, SttAdapter, SttResult } from "@kilnai/core/engine";
import { EventBus } from "@kilnai/core/events";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import {
  AudioTransformError,
  createGenericMediaDownloader,
  createWhatsAppMediaDownloader,
  emitAudioTransformRoutingEvents,
  transformAudioParts,
} from "../../src/gateway/audio-preprocessor.js";
import type { MediaDownloader } from "../../src/gateway/audio-preprocessor.js";
import { createMediaActionTestContext } from "./media-action-test-fixture.js";

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

function mockTransformOptions() {
  const media = createMediaActionTestContext();
  return {
    artifactStore: new MemoryArtifactResourceStore({
      now: () => "2026-05-13T12:00:00.000Z",
    }),
    sourceIdPrefix: "test-app:tenant-1:user-1",
    ...media,
    attemptId: "media-attempt",
    callerId: "test:audio",
    idempotencyKey: "test-message",
    logicalSendSlotPrefix: "inbound-stt",
  };
}

describe("transformAudioParts", () => {
  it("does not call STT when the active turn is already cancelled", async () => {
    const stt = mockStt();
    const downloader = mockDownloader();
    const abort = new AbortController();
    abort.abort();
    await expect(transformAudioParts(
      [{ type: "audio", mimeType: "audio/ogg", url: "https://example.com/audio.ogg" }],
      stt,
      downloader,
      { ...mockTransformOptions(), abortSignal: abort.signal },
    )).rejects.toBeInstanceOf(AudioTransformError);
    expect(downloader.download).not.toHaveBeenCalled();
    expect(stt.transcribe).not.toHaveBeenCalled();
  });

  it("passes through non-audio parts unchanged", async () => {
    const parts: ContentPart[] = [
      { type: "text", text: "hello" },
      { type: "image", mimeType: "image/png", url: "https://example.com/img.png" },
    ];
    const result = await transformAudioParts(parts, mockStt(), mockDownloader(), mockTransformOptions());
    expect(result.parts).toEqual(parts);
    expect(result.transforms).toEqual([]);
  });

  it("transcribes audio part with url and records transform evidence", async () => {
    const stt = mockStt("transcribed text");
    const dl = mockDownloader();
    const parts: ContentPart[] = [
      { type: "audio", mimeType: "audio/ogg", url: "https://example.com/audio.ogg" },
    ];

    const options = mockTransformOptions();
    const result = await transformAudioParts(parts, stt, dl, options);

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toEqual({ type: "text", text: "[Voice note transcription]: transcribed text" });
    expect(result.transforms).toEqual([
      expect.objectContaining({
        transform: "transcription",
        status: "succeeded",
        requestedCapability: "transcription",
        sourceModality: "audio",
        outputModality: "text",
        sourceArtifactUri: "kiln://artifacts/audio-transforms/artifact_1/content",
        sourceMimeType: "audio/ogg",
        sourceBytes: 3,
        provider: "mock",
        provenance: "stt:mock",
        outputText: "transcribed text",
        confidence: 0.95,
        durationMs: 2000,
      }),
    ]);
    expect(options.artifactStore.get("audio-transforms", "artifact_1")).toMatchObject({
      id: "artifact_1",
      namespace: "audio-transforms",
      title: "Gateway audio source 0",
      mimeType: "audio/ogg",
      content: { type: "blob", blob: Buffer.from(new Uint8Array([1, 2, 3])).toString("base64") },
      multimodal: {
        modality: "audio",
        source: { kind: "webhook-attachment", id: "test-app:tenant-1:user-1:part:0" },
      },
    });
    expect(dl.download).toHaveBeenCalledWith("https://example.com/audio.ogg", undefined);
    expect(stt.transcribe).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "audio/ogg", { signal: undefined });
  });

  it("transcribes audio part with base64 data", async () => {
    const stt = mockStt("from base64");
    const dl = mockDownloader();
    const raw = new Uint8Array([10, 20, 30]);
    const base64 = btoa(String.fromCharCode(...raw));
    const parts: ContentPart[] = [
      { type: "audio", mimeType: "audio/mp3", data: base64 },
    ];

    const result = await transformAudioParts(parts, stt, dl, mockTransformOptions());

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toEqual({ type: "text", text: "[Voice note transcription]: from base64" });
    expect(result.transforms[0]).toEqual(expect.objectContaining({
      sourceMimeType: "audio/mp3",
      sourceBytes: 3,
      outputText: "from base64",
    }));
    expect(dl.download).not.toHaveBeenCalled();
    expect(stt.transcribe).toHaveBeenCalledWith(raw, "audio/mp3", { signal: undefined });
  });

  it("uses an existing audio artifact URI as transform source evidence without storing a duplicate source artifact", async () => {
    const stt = mockStt("from captured artifact");
    const dl = mockDownloader();
    const options = mockTransformOptions();
    const artifactUri = "kiln://artifacts/inbound-multimodal/artifact_7/content";

    const result = await transformAudioParts([
      { type: "audio", mimeType: "audio/ogg", data: "AQID", artifactUri },
    ], stt, dl, options);

    expect(result.transforms[0]).toMatchObject({
      status: "succeeded",
      sourceArtifactUri: artifactUri,
      sourceMimeType: "audio/ogg",
      sourceBytes: 3,
    });
    expect(options.artifactStore.list("audio-transforms")).toEqual([]);
    expect(stt.transcribe).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "audio/ogg", { signal: undefined });
  });

  it("handles mixed parts preserving order", async () => {
    const stt = mockStt("voice");
    const dl = mockDownloader();
    const parts: ContentPart[] = [
      { type: "text", text: "before" },
      { type: "audio", mimeType: "audio/ogg", url: "https://example.com/a.ogg" },
      { type: "text", text: "after" },
    ];

    const result = await transformAudioParts(parts, stt, dl, mockTransformOptions());

    expect(result.parts).toHaveLength(3);
    expect(result.parts[0]).toEqual({ type: "text", text: "before" });
    expect(result.parts[1]).toEqual({ type: "text", text: "[Voice note transcription]: voice" });
    expect(result.parts[2]).toEqual({ type: "text", text: "after" });
    expect(result.transforms).toHaveLength(1);
  });

  it("fails closed with evidence on transcription failure", async () => {
    const stt: SttAdapter = {
      name: "mock",
      transcribe: vi.fn().mockRejectedValue(new Error("STT down")),
    };
    const dl = mockDownloader();
    const parts: ContentPart[] = [
      { type: "audio", mimeType: "audio/ogg", url: "https://example.com/a.ogg" },
    ];

    const options = mockTransformOptions();
    try {
      await transformAudioParts(parts, stt, dl, options);
    } catch (err) {
      expect(err).toBeInstanceOf(AudioTransformError);
      expect((err as AudioTransformError).transforms).toEqual([
        expect.objectContaining({
          transform: "transcription",
          status: "failed",
          sourceArtifactUri: "kiln://gateway/audio-transforms/source/0",
          errorMessage: "STT down",
        }),
      ]);
    }
  });

  it("fails closed with evidence on download failure", async () => {
    const stt = mockStt();
    const dl: MediaDownloader = {
      download: vi.fn().mockRejectedValue(new Error("network error")),
    };
    const parts: ContentPart[] = [
      { type: "audio", mimeType: "audio/ogg", url: "https://example.com/a.ogg" },
    ];

    await expect(transformAudioParts(parts, stt, dl, mockTransformOptions())).rejects.toThrow(AudioTransformError);
  });

  it("fails closed when an audio part has neither url nor data", async () => {
    const stt = mockStt();
    const dl = mockDownloader();
    const parts: ContentPart[] = [
      { type: "audio", mimeType: "audio/ogg" } as ContentPart,
    ];

    await expect(transformAudioParts(parts, stt, dl, mockTransformOptions())).rejects.toThrow(AudioTransformError);
  });
});

describe("emitAudioTransformRoutingEvents", () => {
  it("emits transform routing evidence for successful transcriptions", async () => {
    const eventBus = new EventBus();
    const transformed = await transformAudioParts(
      [{ type: "audio", mimeType: "audio/ogg", url: "https://example.com/audio.ogg" }],
      mockStt("hello"),
      mockDownloader(),
      mockTransformOptions(),
    );

    emitAudioTransformRoutingEvents({
      eventBus,
      sessionId: "session-1",
      tenantId: "tenant-1",
      model: "mock",
    }, transformed.transforms);

    expect(eventBus.history()).toEqual([
      expect.objectContaining({
        type: "multimodal_routed",
        sessionId: "session-1",
        tenantId: "tenant-1",
        provider: "gateway-transform",
        model: "mock",
        strategy: "transform",
        reasonCode: "audio_transcription_transform_succeeded",
        requestedCapability: "transcription",
        requiredModalities: ["audio"],
        artifactUris: ["kiln://artifacts/audio-transforms/artifact_1/content"],
      }),
    ]);
  });

  it("emits unsupported routing evidence for failed transcriptions", async () => {
    const eventBus = new EventBus();
    const stt: SttAdapter = {
      name: "mock",
      transcribe: vi.fn().mockRejectedValue(new Error("STT down")),
    };

    try {
      await transformAudioParts(
        [{ type: "audio", mimeType: "audio/ogg", url: "https://example.com/audio.ogg" }],
        stt,
        mockDownloader(),
        mockTransformOptions(),
      );
    } catch (err) {
      emitAudioTransformRoutingEvents({
        eventBus,
        sessionId: "session-1",
        model: "mock",
      }, (err as AudioTransformError).transforms);
    }

    expect(eventBus.history()[0]).toEqual(expect.objectContaining({
      type: "multimodal_routed",
      strategy: "unsupported",
      reasonCode: "audio_transcription_transform_failed",
      diagnostics: [
        expect.objectContaining({
          code: "audio_transcription_transform_failed",
          severity: "error",
          message: "STT down",
        }),
      ],
    }));
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
      const abort = new AbortController();
      const result = await dl.download("https://graph.facebook.com/v21.0/media123", abort.signal);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0]![0]).toBe("https://graph.facebook.com/v21.0/media123");
      expect(mockFetch.mock.calls[0]![1]).toEqual({
        headers: { Authorization: "Bearer test-token" },
        signal: abort.signal,
      });
      expect(mockFetch.mock.calls[1]![0]).toBe("https://cdn.whatsapp.net/media/123");
      expect(mockFetch.mock.calls[1]![1]).toEqual({
        headers: { Authorization: "Bearer test-token" },
        signal: abort.signal,
      });
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
      const abort = new AbortController();
      const result = await dl.download("https://example.com/audio.mp3", abort.signal);

      expect(result.mimeType).toBe("audio/mp3");
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(mockFetch).toHaveBeenCalledWith("https://example.com/audio.mp3", { signal: abort.signal });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
