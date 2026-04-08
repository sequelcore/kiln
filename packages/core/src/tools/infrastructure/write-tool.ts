import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
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
      return toErrorResult(writeError, { filePath: absolutePath });
    }

    try {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, contentInput.value, "utf8");

      return toSuccessResult(
        `Wrote ${contentInput.value.length} characters to ${absolutePath}`,
        {
          filePath: absolutePath,
          bytesWritten: Buffer.byteLength(contentInput.value, "utf8"),
        },
      );
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return toErrorResult(err.message, { filePath: absolutePath, code: err.code });
    }
  }
}
