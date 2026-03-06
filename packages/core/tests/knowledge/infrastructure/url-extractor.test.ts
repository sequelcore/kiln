import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UrlExtractor } from "../../../src/knowledge/infrastructure/url-extractor.js";
import { KilnError } from "../../../src/engine/errors.js";

describe("UrlExtractor", () => {
  const extractor = new UrlExtractor();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("supportedTypes includes url", () => {
    expect(extractor.supportedTypes).toContain("url");
  });

  it("extracts via Jina Reader on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# Extracted Markdown"),
    }) as unknown as typeof fetch;

    const result = await extractor.extract("https://example.com", "url");

    expect(result.content).toBe("# Extracted Markdown");
    expect(result.metadata.source).toBe("https://example.com");
    expect(result.metadata.extractedAt).toBeDefined();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain("r.jina.ai");
  });

  it("falls back to raw fetch on Jina failure", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("r.jina.ai")) {
        return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("") });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve("<html><body><p>Hello World</p></body></html>"),
      });
    }) as unknown as typeof fetch;

    const result = await extractor.extract("https://example.com", "url");

    expect(result.content).toContain("Hello World");
    expect(result.metadata.fallback).toBe(true);
  });

  it("strips script and style tags in fallback", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
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
    }) as unknown as typeof fetch;

    const result = await extractor.extract("https://example.com", "url");

    expect(result.content).not.toContain("<script");
    expect(result.content).not.toContain("<style");
    expect(result.content).toContain("Clean text");
  });

  it("throws SOURCE_EXTRACTION_FAILED when both Jina and fallback fail", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    }) as unknown as typeof fetch;

    await expect(extractor.extract("https://example.com", "url")).rejects.toThrow(KilnError);

    try {
      await extractor.extract("https://example.com", "url");
    } catch (err) {
      expect(err).toBeInstanceOf(KilnError);
      expect((err as KilnError).code).toBe("SOURCE_EXTRACTION_FAILED");
    }
  });
});
