import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { OcrImageTool } from "../../../src/tools/infrastructure/ocr-image-tool.js";
import { ViewImageTool } from "../../../src/tools/infrastructure/view-image-tool.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

describe("ViewImageTool", () => {
  it("returns model-consumable image content with media metadata", async () => {
    const tempDir = await makeTempDir();
    try {
      const imagePath = join(tempDir, "evidence.png");
      await writeFile(imagePath, PNG_BYTES);

      const tool = new ViewImageTool();
      const result = await tool.execute(
        { name: "view_image", input: { path: "evidence.png", detail: "original" } },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.output)).toMatchObject({
        path: imagePath,
        mimeType: "image/png",
        size: PNG_BYTES.byteLength,
        width: 1,
        height: 1,
        detail: "original",
      });
      expect(result.content).toEqual([
        {
          type: "image",
          data: PNG_BASE64,
          mimeType: "image/png",
        },
      ]);
      expect(result.metadata).toMatchObject({
        toolName: "view_image",
        kind: "media",
        operation: "view_image",
        path: imagePath,
        mimeType: "image/png",
        size: PNG_BYTES.byteLength,
        width: 1,
        height: 1,
        detail: "original",
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("rejects unsupported image content", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "note.txt"), "not an image", "utf8");

      const tool = new ViewImageTool();
      const result = await tool.execute(
        { name: "view_image", input: { path: "note.txt" } },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Unsupported image type");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("respects sandbox read validation", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "evidence.png"), PNG_BYTES);

      const tool = new ViewImageTool();
      const result = await tool.execute(
        { name: "view_image", input: { path: "evidence.png" } },
        makeSandbox(tempDir, { fsPolicy: "none" }),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Read access denied");
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

describe("OcrImageTool", () => {
  it("extracts text through the configured OCR runner", async () => {
    const tempDir = await makeTempDir();
    try {
      const imagePath = join(tempDir, "phone.png");
      await writeFile(imagePath, PNG_BYTES);
      const ocrRunner = vi.fn(async () => ({
        text: "HELLO",
        confidence: 0.91,
        source: "test-ocr",
      }));

      const tool = new OcrImageTool({ ocrRunner });
      const result = await tool.execute(
        { name: "ocr_image", input: { path: "phone.png", language: "eng" } },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(ocrRunner).toHaveBeenCalledWith({
        path: imagePath,
        mimeType: "image/png",
        language: "eng",
      });
      expect(JSON.parse(result.output)).toEqual({
        path: imagePath,
        mimeType: "image/png",
        language: "eng",
        text: "HELLO",
        confidence: 0.91,
        source: "test-ocr",
      });
      expect(result.metadata).toMatchObject({
        toolName: "ocr_image",
        kind: "media",
        operation: "ocr",
        path: imagePath,
        mimeType: "image/png",
        language: "eng",
        textLength: 5,
        confidence: 0.91,
        source: "test-ocr",
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("reports an explicit tool error when OCR is unavailable", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "phone.png"), PNG_BYTES);
      const tool = new OcrImageTool({
        ocrRunner: async () => {
          throw new Error("OCR backend unavailable");
        },
      });

      const result = await tool.execute(
        { name: "ocr_image", input: { path: "phone.png" } },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("OCR backend unavailable");
      expect(result.metadata).toMatchObject({
        toolName: "ocr_image",
        kind: "media",
        operation: "ocr",
        mimeType: "image/png",
        language: "eng",
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });
});
