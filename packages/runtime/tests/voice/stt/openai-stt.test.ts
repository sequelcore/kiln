import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAISttAdapter } from "../../../src/voice/stt/openai-stt.js";
import { KilnError } from "@kilnai/core/engine";

function makeTranscriptionResponse(overrides: Record<string, unknown> = {}) {
  return {
    text: "Hello world",
    duration: 3.5,
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

describe("OpenAISttAdapter", () => {
  let adapter: OpenAISttAdapter;
  const audio = new Uint8Array([1, 2, 3, 4]);

  beforeEach(() => {
    adapter = new OpenAISttAdapter({ apiKey: "test-key" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("transcribes audio successfully", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(makeTranscriptionResponse()));

    const result = await adapter.transcribe(audio, "audio/ogg");

    expect(result.text).toBe("Hello world");
    expect(result.confidence).toBeUndefined();
    expect(result.durationMs).toBe(3500);
  });

  it("sends correct headers and multipart body", async () => {
    const mockFetch = mockFetchResponse(makeTranscriptionResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.transcribe(audio, "audio/ogg");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer test-key" });
    expect(init.body).toBeInstanceOf(FormData);

    const formData = init.body as FormData;
    expect(formData.get("model")).toBe("gpt-4o-transcribe");
    expect(formData.get("response_format")).toBe("verbose_json");
  });

  it("forwards the active-turn cancellation signal to fetch", async () => {
    const mockFetch = mockFetchResponse(makeTranscriptionResponse());
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
      json: () => Promise.resolve(makeTranscriptionResponse()),
      text: () => Promise.resolve(JSON.stringify(makeTranscriptionResponse())),
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
      expect(err.context.provider).toBe("openai");
      expect(err.context.status).toBe(401);
      expect(err.retryable).toBe(false);
    }
  });

  it("includes language in form data when configured", async () => {
    const adapterWithLang = new OpenAISttAdapter({
      apiKey: "test-key",
      language: "es",
    });
    const mockFetch = mockFetchResponse(makeTranscriptionResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapterWithLang.transcribe(audio, "audio/ogg");

    const formData = mockFetch.mock.calls[0]![1].body as FormData;
    expect(formData.get("language")).toBe("es");
  });

  it("maps mimeType to filename extension", async () => {
    const mockFetch = mockFetchResponse(makeTranscriptionResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.transcribe(audio, "audio/mp3");

    const formData = mockFetch.mock.calls[0]![1].body as FormData;
    const file = formData.get("file") as File;
    expect(file.name).toBe("audio.mp3");
  });

  it("uses audio.bin for unknown mimeType", async () => {
    const mockFetch = mockFetchResponse(makeTranscriptionResponse());
    vi.stubGlobal("fetch", mockFetch);

    await adapter.transcribe(audio, "audio/unknown");

    const formData = mockFetch.mock.calls[0]![1].body as FormData;
    const file = formData.get("file") as File;
    expect(file.name).toBe("audio.bin");
  });

  it("handles response without duration", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse(makeTranscriptionResponse({ duration: undefined })),
    );

    const result = await adapter.transcribe(audio, "audio/ogg");

    expect(result.text).toBe("Hello world");
    expect(result.durationMs).toBeUndefined();
  });
});
