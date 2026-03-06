import { describe, it, expect, vi } from "vitest";
import { CompositeExtractor } from "../../../src/knowledge/infrastructure/composite-extractor.js";
import { KilnError } from "../../../src/engine/errors.js";
import type { ContentExtractor, KnowledgeSourceType } from "../../../src/engine/domain/knowledge-source.js";

function mockExtractor(types: KnowledgeSourceType[], content: string): ContentExtractor {
  return {
    supportedTypes: types,
    extract: vi.fn().mockResolvedValue({ content, metadata: { source: "test" } }),
  };
}

describe("CompositeExtractor", () => {
  it("routes to the correct extractor by type", async () => {
    const fileExtractor = mockExtractor(["file"], "file content");
    const urlExtractor = mockExtractor(["url"], "url content");
    const composite = new CompositeExtractor([fileExtractor, urlExtractor]);

    const result = await composite.extract("/tmp/test.txt", "file");
    expect(result.content).toBe("file content");
    expect(fileExtractor.extract).toHaveBeenCalledWith("/tmp/test.txt", "file");

    const urlResult = await composite.extract("https://example.com", "url");
    expect(urlResult.content).toBe("url content");
    expect(urlExtractor.extract).toHaveBeenCalledWith("https://example.com", "url");
  });

  it("aggregates supportedTypes from all extractors", () => {
    const composite = new CompositeExtractor([
      mockExtractor(["file"], ""),
      mockExtractor(["url"], ""),
      mockExtractor(["pdf"], ""),
    ]);

    expect(composite.supportedTypes).toContain("file");
    expect(composite.supportedTypes).toContain("url");
    expect(composite.supportedTypes).toContain("pdf");
  });

  it("throws SOURCE_EXTRACTION_FAILED for unsupported type", async () => {
    const composite = new CompositeExtractor([mockExtractor(["file"], "")]);

    await expect(composite.extract("https://example.com", "url")).rejects.toThrow(KilnError);

    try {
      await composite.extract("https://example.com", "url");
    } catch (err) {
      expect(err).toBeInstanceOf(KilnError);
      expect((err as KilnError).code).toBe("SOURCE_EXTRACTION_FAILED");
    }
  });

  it("last extractor wins for duplicate types", () => {
    const first = mockExtractor(["file"], "first");
    const second = mockExtractor(["file"], "second");
    const composite = new CompositeExtractor([first, second]);

    composite.extract("/tmp/test.txt", "file");
    expect(second.extract).toHaveBeenCalled();
    expect(first.extract).not.toHaveBeenCalled();
  });
});
