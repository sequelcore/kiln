import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileToolMetadata } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import {
  buildAddedPreview,
  buildReplacementPreview,
  clipDiffPreview,
  countTextLines,
} from "./file-diff-preview.js";
import {
  requireString,
  resolvePath,
  toErrorResult,
  toSuccessResult,
  validateWritePath,
} from "./tool-helpers.js";

export class WriteTool implements DevTool {
  readonly name = "write";
  readonly description = TOOL_SCHEMAS.write.description;
  readonly inputSchema = TOOL_SCHEMAS.write.inputSchema;
  readonly annotations = TOOL_SCHEMAS.write.annotations;

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const filePathInput = requireString(input, "filePath");
    if (!filePathInput.ok) {
      return filePathInput.result;
    }

    const contentInput = requireString(input, "content", { allowEmpty: true });
    if (!contentInput.ok) {
      return contentInput.result;
    }

    const absolutePath = resolvePath(filePathInput.value, sandbox);
    const writeError = validateWritePath(absolutePath, sandbox);
    if (writeError) {
      return toErrorResult(writeError, fileToolMetadata("write", {
        operation: "write",
        filePath: absolutePath,
      }));
    }

    try {
      const previous = await readOptionalTextFile(absolutePath);
      const preview = clipDiffPreview(previous === null
        ? buildAddedPreview(contentInput.value)
        : buildReplacementPreview(previous, contentInput.value));
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, contentInput.value, "utf8");

      return toSuccessResult(
        `Wrote ${contentInput.value.length} characters to ${absolutePath}`,
        fileToolMetadata("write", {
          operation: "write",
          filePath: absolutePath,
          changeType: previous === null ? "created" : "modified",
          bytesWritten: Buffer.byteLength(contentInput.value, "utf8"),
          linesAdded: countTextLines(contentInput.value),
          ...(previous !== null ? { linesRemoved: countTextLines(previous) } : {}),
          ...(preview.preview.length > 0 ? { diffPreview: preview.preview } : {}),
          diffTruncated: preview.truncated,
        }),
      );
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return toErrorResult(err.message, fileToolMetadata("write", {
        operation: "write",
        filePath: absolutePath,
        code: err.code,
      }));
    }
  }
}

async function readOptionalTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
