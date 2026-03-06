import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KilnError } from "../../../src/engine/errors.js";

// Mock unpdf and node:fs/promises before importing PdfExtractor
const mockExtractText = vi.fn();
vi.mock("unpdf", () => ({ extractText: mockExtractText }));

const mockReadFile = vi.fn();
vi.mock("node:fs/promises", () => ({ readFile: mockReadFile }));

// Must import after vi.mock
const { PdfExtractor } = await import("../../../src/knowledge/infrastructure/pdf-extractor.js");

describe("PdfExtractor", () => {
  const extractor = new PdfExtractor();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockExtractText.mockReset();
    mockReadFile.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("supportedTypes includes pdf", () => {
    expect(extractor.supportedTypes).toContain("pdf");
  });

  it("extracts text from a local file", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("fake-pdf-bytes"));
    mockExtractText.mockResolvedValue({ text: "Extracted PDF text", totalPages: 3 });

    const result = await extractor.extract("/tmp/doc.pdf", "pdf");

    expect(result.content).toBe("Extracted PDF text");
    expect(result.metadata.source).toBe("/tmp/doc.pdf");
    expect(result.metadata.pages).toBe(3);
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/doc.pdf");
  });

  it("extracts text from a URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }) as unknown as typeof fetch;

    mockExtractText.mockResolvedValue({ text: "PDF from URL", totalPages: 1 });

    const result = await extractor.extract("https://example.com/doc.pdf", "pdf");

    expect(result.content).toBe("PDF from URL");
    expect(result.metadata.source).toBe("https://example.com/doc.pdf");
    expect(result.metadata.pages).toBe(1);
  });

  it("throws SOURCE_EXTRACTION_FAILED on fetch error for URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    await expect(extractor.extract("https://example.com/missing.pdf", "pdf")).rejects.toThrow(KilnError);

    try {
      await extractor.extract("https://example.com/missing.pdf", "pdf");
    } catch (err) {
      expect(err).toBeInstanceOf(KilnError);
      expect((err as KilnError).code).toBe("SOURCE_EXTRACTION_FAILED");
    }
  });

  it("throws SOURCE_EXTRACTION_FAILED on extraction error", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("bad-pdf"));
    mockExtractText.mockRejectedValue(new Error("Invalid PDF"));

    await expect(extractor.extract("/tmp/bad.pdf", "pdf")).rejects.toThrow(KilnError);

    try {
      await extractor.extract("/tmp/bad.pdf", "pdf");
    } catch (err) {
      expect(err).toBeInstanceOf(KilnError);
      expect((err as KilnError).code).toBe("SOURCE_EXTRACTION_FAILED");
    }
  });
});
