import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaEmbeddingAdapter } from "../../../src/knowledge/infrastructure/ollama-embedding.js";

describe("OllamaEmbeddingAdapter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchOk(data: unknown) {
    fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(data),
      });
    vi.stubGlobal("fetch", fetchMock);
  }

  it("sends correct URL and payload to Ollama", async () => {
    const adapter = new OllamaEmbeddingAdapter();

    mockFetchOk({
      embeddings: [[0.1, 0.2, 0.3]],
      model: "nomic-embed-text",
    });

    await adapter.embed(["hello"]);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "nomic-embed-text",
          input: ["hello"],
        }),
      }),
    );
  });

  it("uses custom baseUrl when provided", async () => {
    const adapter = new OllamaEmbeddingAdapter({
      baseUrl: "http://gpu-server:11434",
    });

    mockFetchOk({
      embeddings: [[0.1]],
      model: "nomic-embed-text",
    });

    await adapter.embed(["test"]);

    const url = fetchMock.mock.calls[0]![0];
    expect(url).toBe("http://gpu-server:11434/api/embed");
  });

  it("uses custom model when provided", async () => {
    const adapter = new OllamaEmbeddingAdapter({ model: "mxbai-embed-large" });

    mockFetchOk({
      embeddings: [[0.5]],
      model: "mxbai-embed-large",
    });

    await adapter.embed(["test"]);

    const body = JSON.parse(
      fetchMock.mock.calls[0]![1].body as string,
    );
    expect(body.model).toBe("mxbai-embed-large");
  });

  it("returns embeddings from response", async () => {
    const adapter = new OllamaEmbeddingAdapter();

    mockFetchOk({
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
      model: "nomic-embed-text",
    });

    const result = await adapter.embed(["first", "second"]);

    expect(result).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
  });

  it("returns empty array for empty input", async () => {
    const adapter = new OllamaEmbeddingAdapter();
    const result = await adapter.embed([]);
    expect(result).toEqual([]);
  });

  it("throws when response length does not match input length", async () => {
    const adapter = new OllamaEmbeddingAdapter();

    // Send 3 texts but only get 2 embeddings back
    mockFetchOk({
      embeddings: [[0.1], [0.2]],
      model: "nomic-embed-text",
    });

    await expect(adapter.embed(["a", "b", "c"])).rejects.toThrow(
      "Ollama returned 2 embeddings, expected 3",
    );
  });

  it("throws when response has no embeddings field", async () => {
    const adapter = new OllamaEmbeddingAdapter();

    mockFetchOk({
      model: "nomic-embed-text",
    });

    await expect(adapter.embed(["a"])).rejects.toThrow(
      "Ollama returned 0 embeddings, expected 1",
    );
  });

  it("throws on non-OK response with status and error text", async () => {
    const adapter = new OllamaEmbeddingAdapter();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("model not found: nomic-embed-text"),
      }),
    );

    await expect(adapter.embed(["test"])).rejects.toThrow(
      "Ollama embedding request failed: 404 Not Found - model not found: nomic-embed-text",
    );
  });

  it("throws on non-OK response with 500 status", async () => {
    const adapter = new OllamaEmbeddingAdapter();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("gpu out of memory"),
      }),
    );

    await expect(adapter.embed(["test"])).rejects.toThrow(
      "Ollama embedding request failed: 500 Internal Server Error - gpu out of memory",
    );
  });

  it("adapter name is 'ollama'", () => {
    const adapter = new OllamaEmbeddingAdapter();
    expect(adapter.name).toBe("ollama");
  });

  it("dimensions default to 768", () => {
    const adapter = new OllamaEmbeddingAdapter();
    expect(adapter.dimensions).toBe(768);
  });

  it("defaults to nomic-embed-text model and localhost:11434", async () => {
    const adapter = new OllamaEmbeddingAdapter();

    mockFetchOk({
      embeddings: [[0.1]],
      model: "nomic-embed-text",
    });

    await adapter.embed(["test"]);

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/api/embed");
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("nomic-embed-text");
  });

  it("accepts empty config object", () => {
    const adapter = new OllamaEmbeddingAdapter({});
    expect(adapter.name).toBe("ollama");
    expect(adapter.dimensions).toBe(768);
  });
});
