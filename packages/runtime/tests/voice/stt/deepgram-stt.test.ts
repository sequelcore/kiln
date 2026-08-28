import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DeepgramSttAdapter } from "../../../src/voice/stt/deepgram-stt.js";
import { KilnError } from "@kilnai/core";

function makeDeepgramResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: "Hello world",
              confidence: 0.98,
            },
          ],
        },
      ],
    },
    metadata: {
      duration: 3.5,
    },
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe("DeepgramSttAdapter", () => {
  let adapter: DeepgramSttAdapter;
  const audio = new Uint8Array([1, 2, 3, 4]);

  beforeEach(() => {
    adapter = new DeepgramSttAdapter({ apiKey: "test-key" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("transcribes audio successfully", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(makeDeepgramResponse()));

    const result = await adapter.transcribe(audio, "audio/ogg");

    expect(result.text).toBe("Hello world");
    expect(result.confidence).toBe(0.98);
    expect(result.durationMs).toBe(3500);
  });

  it("sends correct headers and raw body", async () => {
    const mockFetch = mockFetchResponse(makeDeepgramResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.transcribe(audio, "audio/ogg");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.deepgram.com/v1/listen?model=nova-3");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Token test-key",
      "Content-Type": "audio/ogg",
    });
    expect(init.body).toBe(audio.buffer);
  });

  it("forwards the active-turn cancellation signal to fetch", async () => {
    const mockFetch = mockFetchResponse(makeDeepgramResponse());
    vi.stubGlobal("fetch", mockFetch);
    const abort = new AbortController();

    await adapter.transcribe(audio, "audio/ogg", { signal: abort.signal });

    expect(mockFetch.mock.calls[0]![1].signal).toBe(abort.signal);
  });

  it("does not retry after a 429 response", async () => {
    const failResponse = {
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: "rate limited" }),
      text: () => Promise.resolve("rate limited"),
    };
    const successResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeDeepgramResponse()),
      text: () => Promise.resolve(JSON.stringify(makeDeepgramResponse())),
    };

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(successResponse);
    vi.stubGlobal("fetch", mockFetch);

    await expect(adapter.transcribe(audio, "audio/ogg")).rejects.toThrow(KilnError);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("throws KilnError on 401", async () => {
    vi.stubGlobal("fetch", mockFetchResponse({ error: "unauthorized" }, 401));

    await expect(adapter.transcribe(audio, "audio/ogg")).rejects.toThrow(KilnError);

    try {
      await adapter.transcribe(audio, "audio/ogg");
    } catch (e) {
      const err = e as KilnError;
      expect(err.code).toBe("STT_FAILED");
      expect(err.context.provider).toBe("deepgram");
      expect(err.context.status).toBe(401);
      expect(err.retryable).toBe(false);
    }
  });

  it("appends language to URL when configured", async () => {
    const adapterWithLang = new DeepgramSttAdapter({
      apiKey: "test-key",
      language: "es",
    });
    const mockFetch = mockFetchResponse(makeDeepgramResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapterWithLang.transcribe(audio, "audio/ogg");

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.deepgram.com/v1/listen?model=nova-3&language=es");
  });

  it("uses custom model when configured", async () => {
    const adapterCustom = new DeepgramSttAdapter({
      apiKey: "test-key",
      model: "nova-2",
    });
    const mockFetch = mockFetchResponse(makeDeepgramResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapterCustom.transcribe(audio, "audio/ogg");

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.deepgram.com/v1/listen?model=nova-2");
  });
});
