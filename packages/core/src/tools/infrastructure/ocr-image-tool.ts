import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { mediaToolMetadata } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { optionalString, requireString, toErrorResult } from "./tool-helpers.js";
import {
  ORIGINAL_IMAGE_MAX_BYTES,
  readSupportedImageFile,
} from "./image-tool-helpers.js";

const execFile = promisify(execFileCallback);
const DEFAULT_OCR_LANGUAGE = "eng";

export interface OcrImageRequest {
  readonly path: string;
  readonly mimeType: string;
  readonly language: string;
}

export interface OcrImageResult {
  readonly text: string;
  readonly confidence?: number;
  readonly source?: string;
}

export type OcrImageRunner = (request: OcrImageRequest) => Promise<OcrImageResult>;

export interface OcrImageToolOptions {
  readonly ocrRunner?: OcrImageRunner;
}

export class OcrImageTool implements DevTool {
  readonly name = "ocr_image";
  readonly description = TOOL_SCHEMAS.ocr_image.description;
  readonly inputSchema = TOOL_SCHEMAS.ocr_image.inputSchema;
  readonly annotations = TOOL_SCHEMAS.ocr_image.annotations;
  private readonly ocrRunner: OcrImageRunner;

  constructor(options: OcrImageToolOptions = {}) {
    this.ocrRunner = options.ocrRunner ?? runTesseractOcr;
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const pathInput = requireString(input, "path");
    if (!pathInput.ok) {
      return pathInput.result;
    }

    const language = (optionalString(input, "language") ?? DEFAULT_OCR_LANGUAGE).trim();
    if (language.length === 0) {
      return toErrorResult('Invalid input: "language" must be a non-empty string');
    }

    const image = await readSupportedImageFile(
      pathInput.value,
      sandbox,
      ORIGINAL_IMAGE_MAX_BYTES,
      { toolName: "ocr_image", operation: "ocr" },
    );
    if (!image.ok) {
      return image.result;
    }

    try {
      const ocr = await this.ocrRunner({
        path: image.value.path,
        mimeType: image.value.mimeType,
        language,
      });
      const text = ocr.text;
      const metadata = mediaToolMetadata("ocr_image", {
        operation: "ocr",
        path: image.value.path,
        mimeType: image.value.mimeType,
        size: image.value.size,
        ...(image.value.width !== undefined ? { width: image.value.width } : {}),
        ...(image.value.height !== undefined ? { height: image.value.height } : {}),
        language,
        textLength: text.length,
        ...(ocr.confidence !== undefined ? { confidence: ocr.confidence } : {}),
        ...(ocr.source ? { source: ocr.source } : {}),
      });
      const output = {
        path: metadata.path,
        mimeType: metadata.mimeType,
        language,
        text,
        ...(ocr.confidence !== undefined ? { confidence: ocr.confidence } : {}),
        ...(ocr.source ? { source: ocr.source } : {}),
      };

      return {
        output: JSON.stringify(output, null, 2),
        isError: false,
        metadata,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return toErrorResult(formatOcrError(err), mediaToolMetadata("ocr_image", {
        operation: "ocr",
        path: image.value.path,
        mimeType: image.value.mimeType,
        size: image.value.size,
        ...(image.value.width !== undefined ? { width: image.value.width } : {}),
        ...(image.value.height !== undefined ? { height: image.value.height } : {}),
        language,
        code: err.code,
      }));
    }
  }
}

async function runTesseractOcr(request: OcrImageRequest): Promise<OcrImageResult> {
  const result = await execFile("tesseract", [
    request.path,
    "stdout",
    "-l",
    request.language,
  ], {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  });
  return {
    text: result.stdout.trim(),
    source: "tesseract",
  };
}

function formatOcrError(error: NodeJS.ErrnoException): string {
  if (error.code === "ENOENT") {
    return "OCR backend unavailable: tesseract executable was not found on PATH.";
  }
  return error.message;
}
