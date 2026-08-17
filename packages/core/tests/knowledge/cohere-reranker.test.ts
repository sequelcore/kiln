import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CohereReranker } from "../../src/knowledge/infrastructure/cohere-reranker.js";
import { KilnError } from "../../src/engine/errors.js";
import type { VectorResult } from "../../src/engine/domain/vector-store.js";

const mockResults: VectorResult[] = [
  { id: "a", content: "First document about AI", score: 0.8, metadata: { source: "doc1" } },
  { id: "b", content: "Second document about ML", score: 0.7, metadata: { source: "doc2" } },
  { id: "c", content: "Third document about NLP", score: 0.6, metadata: { source: "doc3" } },
];

describe("CohereReranker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function stubFetch(implementation?: Parameters<typeof vi.fn>[0]): ReturnType<typeof vi.fn> {
    fetchMock = implementation ? vi.fn(implementation) : vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns results in new order with relevance scores", async () => {
    stubFetch().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { index: 2, relevance_score: 0.99 },
          { index: 0, relevance_score: 0.85 },
          { index: 1, relevance_score: 0.42 },
        ],
      }),
    });

    const reranker = new CohereReranker({ apiKey: "test-key" });
    const reranked = await reranker.rerank("AI query", mockResults);

    expect(reranked).toHaveLength(3);
    expect(reranked[0]).toEqual({ id: "c", content: "Third document about NLP", score: 0.99, metadata: { source: "doc3" } });
    expect(reranked[1]).toEqual({ id: "a", content: "First document about AI", score: 0.85, metadata: { source: "doc1" } });
    expect(reranked[2]).toEqual({ id: "b", content: "Second document about ML", score: 0.42, metadata: { source: "doc2" } });

    const fetchCall = fetchMock.mock.calls[0]!;
    expect(fetchCall[0]).toBe("https://api.cohere.com/v2/rerank");
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.model).toBe("rerank-v3.5");
    expect(body.query).toBe("AI query");
    expect(body.documents).toEqual([
      "First document about AI",
      "Second document about ML",
      "Third document about NLP",
    ]);
    expect(body.top_n).toBe(3);
  });

  it("returns empty array for empty input", async () => {
    stubFetch();

    const reranker = new CohereReranker({ apiKey: "test-key" });
    const reranked = await reranker.rerank("query", []);

    expect(reranked).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses custom model when provided", async () => {
    stubFetch().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ index: 0, relevance_score: 0.9 }] }),
    });

    const reranker = new CohereReranker({ apiKey: "test-key", model: "rerank-v2.0" });
    await reranker.rerank("query", [mockResults[0]!]);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.model).toBe("rerank-v2.0");
  });

  it("sends authorization header", async () => {
    stubFetch().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ index: 0, relevance_score: 0.9 }] }),
    });

    const reranker = new CohereReranker({ apiKey: "my-secret-key" });
    await reranker.rerank("query", [mockResults[0]!]);

    const headers = fetchMock.mock.calls[0]![1].headers;
    expect(headers.Authorization).toBe("Bearer my-secret-key");
  });

  it("throws KilnError on non-retryable API error", async () => {
    stubFetch().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const reranker = new CohereReranker({ apiKey: "bad-key" });

    await expect(reranker.rerank("query", mockResults)).rejects.toThrow(KilnError);
    await expect(reranker.rerank("query", mockResults)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("retries on 429 then succeeds", async () => {
    let callCount = 0;
    stubFetch().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 429, text: async () => "Rate limited" };
      }
      return {
        ok: true,
        json: async () => ({
          results: [{ index: 0, relevance_score: 0.95 }],
        }),
      };
    });

    const reranker = new CohereReranker({ apiKey: "test-key" });
    const promise = reranker.rerank("query", [mockResults[0]!]);

    // Advance past the retry delay (1000ms base * 2^0 = 1000ms)
    await vi.advanceTimersByTimeAsync(1500);

    const reranked = await promise;
    expect(reranked).toHaveLength(1);
    expect(reranked[0]!.score).toBe(0.95);
    expect(callCount).toBe(2);
  });

  it("retries on 500 errors", async () => {
    let callCount = 0;
    stubFetch().mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return { ok: false, status: 500, text: async () => "Server error" };
      }
      return {
        ok: true,
        json: async () => ({
          results: [{ index: 0, relevance_score: 0.8 }],
        }),
      };
    });

    const reranker = new CohereReranker({ apiKey: "test-key" });
    const promise = reranker.rerank("query", [mockResults[0]!]);

    // First retry: 1000ms, second retry: 2000ms
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(2500);

    const reranked = await promise;
    expect(reranked).toHaveLength(1);
    expect(callCount).toBe(3);
  });

  it("throws after exhausting retries on persistent 429", async () => {
    stubFetch().mockImplementation(async () => ({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    }));

    const reranker = new CohereReranker({ apiKey: "test-key" });
    const promise = reranker.rerank("query", [mockResults[0]!]);

    // Attach rejection handler immediately to prevent unhandled rejection
    const caught = promise.catch((e: unknown) => e);

    // Advance through all retry delays: 1000 + 2000 + 4000 = 7000ms
    await vi.advanceTimersByTimeAsync(8000);

    const error = await caught;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Cohere rerank returned 429");
  });

  it("throws on network error without retrying", async () => {
    stubFetch().mockRejectedValue(new TypeError("fetch failed"));

    const reranker = new CohereReranker({ apiKey: "test-key" });

    await expect(reranker.rerank("query", mockResults)).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
