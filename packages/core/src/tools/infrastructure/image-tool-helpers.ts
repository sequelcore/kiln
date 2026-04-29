import { lstat, readFile } from "node:fs/promises";
import { mediaToolMetadata, type ImageDetail, type MediaToolName, type MediaToolOperation } from "../domain/tool-result-metadata.js";
import type { ToolResult } from "../domain/tool.js";
import {
  resolvePath,
  toErrorResult,
  validateReadPath,
} from "./tool-helpers.js";

export const DEFAULT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ORIGINAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

type DetectedImage = {
  readonly mimeType: SupportedImageMimeType;
  readonly width?: number;
  readonly height?: number;
};

export interface ImageFileInfo {
  readonly path: string;
  readonly content: Buffer;
  readonly mimeType: SupportedImageMimeType;
  readonly size: number;
  readonly width?: number;
  readonly height?: number;
}

export type SupportedImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

export function parseImageDetail(value: string | undefined): ImageDetail | undefined {
  if (value === undefined || value === "default") return "default";
  if (value === "original") return "original";
  return undefined;
}

export async function readSupportedImageFile(
  pathInput: string,
  sandbox: unknown,
  maxBytes: number,
  metadata: { readonly toolName: MediaToolName; readonly operation: MediaToolOperation },
): Promise<{ ok: true; value: ImageFileInfo } | { ok: false; result: ToolResult }> {
  const absolutePath = resolvePath(pathInput, sandbox);
  const readError = validateReadPath(absolutePath, sandbox);
  if (readError) {
    return {
      ok: false,
      result: toErrorResult(readError, mediaToolMetadata(metadata.toolName, {
        operation: metadata.operation,
        path: absolutePath,
      })),
    };
  }

  try {
    const stat = await lstat(absolutePath);
    if (!stat.isFile()) {
      return {
        ok: false,
        result: toErrorResult(`${absolutePath} is not a file`, mediaToolMetadata(metadata.toolName, {
          operation: metadata.operation,
          path: absolutePath,
          size: stat.size,
        })),
      };
    }

    if (stat.size > maxBytes) {
      return {
        ok: false,
        result: toErrorResult(
          `Image is too large (${stat.size} bytes). Limit is ${maxBytes} bytes.`,
          mediaToolMetadata(metadata.toolName, {
            operation: metadata.operation,
            path: absolutePath,
            size: stat.size,
          }),
        ),
      };
    }

    const content = await readFile(absolutePath);
    const image = detectImage(content);
    if (!image) {
      return {
        ok: false,
        result: toErrorResult("Unsupported image type. Supported types: PNG, JPEG, GIF, WebP.", mediaToolMetadata(metadata.toolName, {
          operation: metadata.operation,
          path: absolutePath,
          size: stat.size,
        })),
      };
    }

    return {
      ok: true,
      value: {
        path: absolutePath,
        content,
        mimeType: image.mimeType,
        size: stat.size,
        ...(image.width !== undefined ? { width: image.width } : {}),
        ...(image.height !== undefined ? { height: image.height } : {}),
      },
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    return {
      ok: false,
      result: toErrorResult(err.message, mediaToolMetadata(metadata.toolName, {
        operation: metadata.operation,
        path: absolutePath,
        code: err.code,
      })),
    };
  }
}

function detectImage(content: Buffer): DetectedImage | undefined {
  return detectPng(content)
    ?? detectJpeg(content)
    ?? detectGif(content)
    ?? detectWebp(content);
}

function detectPng(content: Buffer): DetectedImage | undefined {
  if (
    content.length >= 24
    && content[0] === 0x89
    && content[1] === 0x50
    && content[2] === 0x4e
    && content[3] === 0x47
    && content[4] === 0x0d
    && content[5] === 0x0a
    && content[6] === 0x1a
    && content[7] === 0x0a
  ) {
    return {
      mimeType: "image/png",
      width: content.readUInt32BE(16),
      height: content.readUInt32BE(20),
    };
  }
  return undefined;
}

function detectJpeg(content: Buffer): DetectedImage | undefined {
  if (content.length < 4 || content[0] !== 0xff || content[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 9 < content.length) {
    if (content[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = content[offset + 1];
    if (marker === undefined) {
      break;
    }
    const segmentLength = content.readUInt16BE(offset + 2);
    if (segmentLength < 2) {
      break;
    }

    if (isJpegStartOfFrame(marker) && offset + 8 < content.length) {
      return {
        mimeType: "image/jpeg",
        height: content.readUInt16BE(offset + 5),
        width: content.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + segmentLength;
  }

  return { mimeType: "image/jpeg" };
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3)
    || (marker >= 0xc5 && marker <= 0xc7)
    || (marker >= 0xc9 && marker <= 0xcb)
    || (marker >= 0xcd && marker <= 0xcf)
  );
}

function detectGif(content: Buffer): DetectedImage | undefined {
  if (
    content.length >= 10
    && (content.subarray(0, 6).toString("ascii") === "GIF87a"
      || content.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return {
      mimeType: "image/gif",
      width: content.readUInt16LE(6),
      height: content.readUInt16LE(8),
    };
  }
  return undefined;
}

function detectWebp(content: Buffer): DetectedImage | undefined {
  if (
    content.length >= 12
    && content.subarray(0, 4).toString("ascii") === "RIFF"
    && content.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mimeType: "image/webp" };
  }
  return undefined;
}
