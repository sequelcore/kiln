import { readFile } from "node:fs/promises";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import {
  optionalNumber,
  requireString,
  resolvePath,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
} from "./tool-helpers.js";

export class ReadTool implements DevTool {
  readonly name = "read";
  readonly description = TOOL_SCHEMAS.read.description;
  readonly inputSchema = TOOL_SCHEMAS.read.inputSchema;
  readonly annotations = TOOL_SCHEMAS.read.annotations;

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const filePathInput = requireString(input, "filePath");
    if (!filePathInput.ok) {
      return filePathInput.result;
    }

    const absolutePath = resolvePath(filePathInput.value, sandbox);
    const readError = validateReadPath(absolutePath, sandbox);
    if (readError) {
      return toErrorResult(readError, { filePath: absolutePath });
    }

    const offset = optionalNumber(input, "offset") ?? 0;
    const limit = optionalNumber(input, "limit");
    if (offset < 0) {
      return toErrorResult('Invalid input: "offset" must be >= 0');
    }
    if (limit !== undefined && limit < 0) {
      return toErrorResult('Invalid input: "limit" must be >= 0');
    }

    try {
      const content = await readFile(absolutePath, "utf8");
      const lines = content.split(/\r?\n/);
      const sliced = limit !== undefined ? lines.slice(offset, offset + limit) : lines.slice(offset);
      const windowed = sliced.join("\n");
      return toSuccessResult(windowed, {
        filePath: absolutePath,
        offset,
        limit,
        totalLines: lines.length,
      });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return toErrorResult(err.message, { filePath: absolutePath, code: err.code });
    }
  }
}
