import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAITtsAdapter } from "../../../src/agents/infrastructure/openai-tts.js";
import { KilnError } from "../../../src/engine/errors.js";

function mockAudioResponse(status = 200, contentType = "audio/mpeg") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    text: () => Promise.resolve("provider error"),
  };
}

describe("OpenAITtsAdapter", () => {
  let adapter: OpenAITtsAdapter;

  beforeEach(() => {
    adapter = new OpenAITtsAdapter({ apiKey: "test-key" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("synthesizes text successfully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockAudioResponse()));

    const result = await adapter.synthesize("Hello world");

    expect(result.audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("sends OpenAI speech request with configured model and voice", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockAudioResponse());
    vi.stubGlobal("fetch", mockFetch);
    const configured = new OpenAITtsAdapter({
      apiKey: "test-key",
      model: "gpt-4o-mini-tts",
      voice: "alloy",
    });

    await configured.synthesize("Hola", { voice: "verse", speed: 1.1, format: "wav" });

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4o-mini-tts",
      input: "Hola",
      voice: "verse",
      response_format: "wav",
      speed: 1.1,
    });
  });

  it("uses format mime fallback when provider omits content type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ...mockAudioResponse(),
      headers: new Headers(),
    }));

    const result = await adapter.synthesize("Hello", { format: "wav" });

    expect(result.mimeType).toBe("audio/wav");
  });

  it("throws KilnError on non-retryable provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockAudioResponse(401)));

    await expect(adapter.synthesize("Hello")).rejects.toThrow(KilnError);

    try {
      await adapter.synthesize("Hello");
    } catch (e) {
      const err = e as KilnError;
      expect(err.code).toBe("TTS_FAILED");
      expect(err.context.provider).toBe("openai");
      expect(err.context.status).toBe(401);
      expect(err.retryable).toBe(false);
    }
  });
});
