import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { FileExtractor } from "../../../src/knowledge/infrastructure/file-extractor.js";
import { KilnError } from "../../../src/engine/errors.js";

describe("FileExtractor", () => {
  const extractor = new FileExtractor();

  it("supportedTypes includes file", () => {
    expect(extractor.supportedTypes).toContain("file");
  });

  it("reads a text file", async () => {
    const dir = join(tmpdir(), `kiln-file-test-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "test.txt");
    await writeFile(filePath, "Hello, world!", "utf-8");

    const result = await extractor.extract(filePath, "file");

    expect(result.content).toBe("Hello, world!");
    expect(result.metadata.source).toBe(filePath);

    await rm(dir, { recursive: true, force: true });
  });

  it("reads a markdown file", async () => {
    const dir = join(tmpdir(), `kiln-file-test-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "doc.md");
    await writeFile(filePath, "# Title\n\nSome content", "utf-8");

    const result = await extractor.extract(filePath, "file");

    expect(result.content).toBe("# Title\n\nSome content");
    expect(result.metadata.source).toBe(filePath);

    await rm(dir, { recursive: true, force: true });
  });

  it("throws SOURCE_EXTRACTION_FAILED for missing file", async () => {
    const missingPath = join(tmpdir(), `kiln-file-test-${randomUUID()}`, "nonexistent.txt");

    await expect(extractor.extract(missingPath, "file")).rejects.toThrow(KilnError);

    try {
      await extractor.extract(missingPath, "file");
    } catch (err) {
      expect(err).toBeInstanceOf(KilnError);
      expect((err as KilnError).code).toBe("SOURCE_EXTRACTION_FAILED");
    }
  });
});
