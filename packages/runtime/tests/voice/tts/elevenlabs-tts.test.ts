import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ElevenLabsTtsAdapter } from "../../../src/voice/tts/elevenlabs-tts.js";
import { KilnError } from "@kilnai/core";

function mockAudioResponse(status = 200, contentType = "audio/mpeg") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    arrayBuffer: () => Promise.resolve(new Uint8Array([4, 5, 6]).buffer),
    text: () => Promise.resolve("provider error"),
  };
}

describe("ElevenLabsTtsAdapter", () => {
  let adapter: ElevenLabsTtsAdapter;

  beforeEach(() => {
    adapter = new ElevenLabsTtsAdapter({ apiKey: "test-key", voice: "voice-123" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("synthesizes text successfully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockAudioResponse()));

    const result = await adapter.synthesize("Hello world");

    expect(result.audio).toEqual(new Uint8Array([4, 5, 6]));
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("sends ElevenLabs speech request with configured model and voice", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockAudioResponse());
    vi.stubGlobal("fetch", mockFetch);
    const configured = new ElevenLabsTtsAdapter({
      apiKey: "test-key",
      model: "eleven_multilingual_v2",
      voice: "voice-123",
    });

    await configured.synthesize("Hola", { voice: "voice-override" });

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-override");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "xi-api-key": "test-key",
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      text: "Hola",
      model_id: "eleven_multilingual_v2",
    });
  });

  it("forwards cancellation and does not retry a 429 response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockAudioResponse(429));
    vi.stubGlobal("fetch", mockFetch);
    const abort = new AbortController();

    await expect(adapter.synthesize("Hello", { signal: abort.signal })).rejects.toThrow(KilnError);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0]![1].signal).toBe(abort.signal);
  });

  it("throws KilnError on non-retryable provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockAudioResponse(401)));

    await expect(adapter.synthesize("Hello")).rejects.toThrow(KilnError);

    try {
      await adapter.synthesize("Hello");
    } catch (e) {
      const err = e as KilnError;
      expect(err.code).toBe("TTS_FAILED");
      expect(err.context.provider).toBe("elevenlabs");
      expect(err.context.status).toBe(401);
      expect(err.retryable).toBe(false);
    }
  });
});
