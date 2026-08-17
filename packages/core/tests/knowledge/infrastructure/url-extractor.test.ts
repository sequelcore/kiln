import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UrlExtractor } from "../../../src/knowledge/infrastructure/url-extractor.js";
import { KilnError } from "../../../src/engine/errors.js";

describe("UrlExtractor", () => {
  const extractor = new UrlExtractor();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("supportedTypes includes url", () => {
    expect(extractor.supportedTypes).toContain("url");
  });

  it("extracts via Jina Reader on success", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# Extracted Markdown"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractor.extract("https://example.com", "url");

    expect(result.content).toBe("# Extracted Markdown");
    expect(result.metadata.source).toBe("https://example.com");
    expect(result.metadata.extractedAt).toBeDefined();
    expect(fetchMock.mock.calls[0]![0]).toContain("r.jina.ai");
  });

  it("falls back to raw fetch on Jina failure", async () => {
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("r.jina.ai")) {
        return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("") });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve("<html><body><p>Hello World</p></body></html>"),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractor.extract("https://example.com", "url");

    expect(result.content).toContain("Hello World");
    expect(result.metadata.fallback).toBe(true);
  });

  it("strips script and style tags in fallback", async () => {
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("r.jina.ai")) {
        return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("") });
      }
      return Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(
            '<html><head><style>body{color:red}</style></head><body><script>alert("x")</script><p>Clean text</p></body></html>',
          ),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractor.extract("https://example.com", "url");

    expect(result.content).not.toContain("<script");
    expect(result.content).not.toContain("<style");
    expect(result.content).toContain("Clean text");
  });

  it("throws SOURCE_EXTRACTION_FAILED when both Jina and fallback fail", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractor.extract("https://example.com", "url")).rejects.toThrow(KilnError);

    try {
      await extractor.extract("https://example.com", "url");
    } catch (err) {
      expect(err).toBeInstanceOf(KilnError);
      expect((err as KilnError).code).toBe("SOURCE_EXTRACTION_FAILED");
    }
  });

  it("passes custom headers to Jina fetch", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# Content"),
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractor.extract("https://example.com", "url", {
      headers: { Authorization: "Bearer tok-123" },
    });

    const call = fetchMock.mock.calls[0]!;
    expect(call[1].headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer tok-123", Accept: "text/markdown" }),
    );
  });

  it("passes custom headers to fallback fetch", async () => {
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("r.jina.ai")) {
        return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("") });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve("<html><body><p>OK</p></body></html>"),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractor.extract("https://example.com", "url", {
      headers: { "X-Custom": "value" },
    });

    const fallbackCall = fetchMock.mock.calls[1]!;
    expect(fallbackCall[1].headers).toEqual(
      expect.objectContaining({ "X-Custom": "value" }),
    );
  });

  it("works without options (backward compat)", async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# No Headers"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractor.extract("https://example.com", "url");

    expect(result.content).toBe("# No Headers");
    const call = fetchMock.mock.calls[0]!;
    expect(call[1].headers).toEqual({ Accept: "text/markdown" });
  });
});
