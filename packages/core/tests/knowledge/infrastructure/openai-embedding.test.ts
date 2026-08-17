import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIEmbeddingAdapter } from "../../../src/knowledge/infrastructure/openai-embedding.js";

describe("OpenAIEmbeddingAdapter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockFetchOk(data: unknown) {
    fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(data),
      });
    vi.stubGlobal("fetch", fetchMock);
  }

  it("sends correct URL, headers, and body to OpenAI", async () => {
    vi.useRealTimers();
    const adapter = new OpenAIEmbeddingAdapter({ apiKey: "sk-test-key" });

    mockFetchOk({
      data: [{ embedding: [0.1, 0.2], index: 0 }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });

    await adapter.embed(["hello"]);

    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test-key",
        },
        body: JSON.stringify({
          input: ["hello"],
          model: "text-embedding-3-small",
        }),
      }),
    );
  });

  it("returns embeddings sorted by index (handles out-of-order response)", async () => {
    vi.useRealTimers();
    const adapter = new OpenAIEmbeddingAdapter({ apiKey: "sk-key" });

    mockFetchOk({
      data: [
        { embedding: [0.3, 0.4], index: 1 },
        { embedding: [0.1, 0.2], index: 0 },
        { embedding: [0.5, 0.6], index: 2 },
      ],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });

    const result = await adapter.embed(["a", "b", "c"]);

    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
      [0.5, 0.6],
    ]);
  });

  it("returns empty array for empty input", async () => {
    vi.useRealTimers();
    const adapter = new OpenAIEmbeddingAdapter({ apiKey: "sk-key" });
    const result = await adapter.embed([]);
    expect(result).toEqual([]);
  });

  it("retries on 429 (rate limit) and succeeds", async () => {
    vi.useRealTimers();
    const adapter = new OpenAIEmbeddingAdapter({ apiKey: "sk-key" });

    const rateLimitResponse = { ok: false, status: 429, statusText: "Too Many Requests", text: () => Promise.resolve("rate limited") };
    const successResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: [0.1], index: 0 }],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(successResponse);
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.embed(["test"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual([[0.1]]);
  });

  it("retries on 500+ server error", async () => {
    vi.useRealTimers();
    const adapter = new OpenAIEmbeddingAdapter({ apiKey: "sk-key" });

    const serverErrorResponse = { ok: false, status: 502, statusText: "Bad Gateway", text: () => Promise.resolve("bad gateway") };
    const successResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: [0.5], index: 0 }],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(serverErrorResponse)
      .mockResolvedValueOnce(successResponse);
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.embed(["test"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual([[0.5]]);
  });

  it("throws immediately on non-retryable error (e.g., 401)", async () => {
    vi.useRealTimers();
    const adapter = new OpenAIEmbeddingAdapter({ apiKey: "bad-key" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("invalid api key"),
      }),
    );

    await expect(adapter.embed(["test"])).rejects.toThrow(
      "OpenAI embedding request failed: 401 Unauthorized - invalid api key",
    );

    // Should NOT have retried
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all retries", async () => {
    vi.useRealTimers();
    const adapter = new OpenAIEmbeddingAdapter({ apiKey: "sk-key" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve("rate limited"),
      }),
    );

    await expect(adapter.embed(["test"])).rejects.toThrow(
      "OpenAI embedding request failed after 3 retries",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  }, 15_000);

  it("model-to-dimensions: text-embedding-3-small = 1536", () => {
    const adapter = new OpenAIEmbeddingAdapter({ apiKey: "sk-key" });
    expect(adapter.dimensions).toBe(1536);
  });

  it("model-to-dimensions: text-embedding-3-large = 3072", () => {
    const adapter = new OpenAIEmbeddingAdapter({
      apiKey: "sk-key",
      model: "text-embedding-3-large",
    });
    expect(adapter.dimensions).toBe(3072);
  });

  it("model-to-dimensions: defaults to 1536 for unknown models", () => {
    const adapter = new OpenAIEmbeddingAdapter({
      apiKey: "sk-key",
      model: "some-future-model",
    });
    expect(adapter.dimensions).toBe(1536);
  });

  it("defaults to text-embedding-3-small model when not specified", async () => {
    vi.useRealTimers();
    const adapter = new OpenAIEmbeddingAdapter({ apiKey: "sk-key" });

    mockFetchOk({
      data: [{ embedding: [0.1], index: 0 }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 1, total_tokens: 1 },
    });

    await adapter.embed(["test"]);

    const body = JSON.parse(
      fetchMock.mock.calls[0]![1].body as string,
    );
    expect(body.model).toBe("text-embedding-3-small");
  });

  it("uses custom model when specified", async () => {
    vi.useRealTimers();
    const adapter = new OpenAIEmbeddingAdapter({
      apiKey: "sk-key",
      model: "text-embedding-3-large",
    });

    mockFetchOk({
      data: [{ embedding: [0.1], index: 0 }],
      model: "text-embedding-3-large",
      usage: { prompt_tokens: 1, total_tokens: 1 },
    });

    await adapter.embed(["test"]);

    const body = JSON.parse(
      fetchMock.mock.calls[0]![1].body as string,
    );
    expect(body.model).toBe("text-embedding-3-large");
  });

  it("throws when response is missing an embedding for an index", async () => {
    vi.useRealTimers();
    const adapter = new OpenAIEmbeddingAdapter({ apiKey: "sk-key" });

    // Response only has index 0, but we sent 2 texts
    mockFetchOk({
      data: [{ embedding: [0.1], index: 0 }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 2, total_tokens: 2 },
    });

    await expect(adapter.embed(["a", "b"])).rejects.toThrow(
      "Missing embedding for index 1",
    );
  });

  it("adapter name is 'openai'", () => {
    const adapter = new OpenAIEmbeddingAdapter({ apiKey: "sk-key" });
    expect(adapter.name).toBe("openai");
  });
});
