import { readFile, writeFile } from "node:fs/promises";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import {
  optionalBoolean,
  requireString,
  resolvePath,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
  validateWritePath,
} from "./tool-helpers.js";

function replaceSingle(source: string, oldString: string, newString: string): { value: string; count: number } {
  const index = source.indexOf(oldString);
  if (index < 0) {
    return { value: source, count: 0 };
  }

  const value = `${source.slice(0, index)}${newString}${source.slice(index + oldString.length)}`;
  return { value, count: 1 };
}

function replaceAll(source: string, oldString: string, newString: string): { value: string; count: number } {
  let count = 0;
  let cursor = 0;
  let output = "";

  while (cursor < source.length) {
    const match = source.indexOf(oldString, cursor);
    if (match < 0) {
      output += source.slice(cursor);
      break;
    }

    output += source.slice(cursor, match);
    output += newString;
    cursor = match + oldString.length;
    count += 1;
  }

  return { value: output, count };
}

export class EditTool implements DevTool {
  readonly name = "edit";
  readonly description = TOOL_SCHEMAS.edit.description;
  readonly inputSchema = TOOL_SCHEMAS.edit.inputSchema;
  readonly annotations = TOOL_SCHEMAS.edit.annotations;

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const filePathInput = requireString(input, "filePath");
    if (!filePathInput.ok) {
      return filePathInput.result;
    }

    const oldStringInput = requireString(input, "oldString");
    if (!oldStringInput.ok) {
      return oldStringInput.result;
    }

    const newStringInput = requireString(input, "newString", { allowEmpty: true });
    if (!newStringInput.ok) {
      return newStringInput.result;
    }

    const absolutePath = resolvePath(filePathInput.value, sandbox);
    const readError = validateReadPath(absolutePath, sandbox);
    if (readError) {
      return toErrorResult(readError, { filePath: absolutePath });
    }

    const writeError = validateWritePath(absolutePath, sandbox);
    if (writeError) {
      return toErrorResult(writeError, { filePath: absolutePath });
    }

    const replaceEveryMatch = optionalBoolean(input, "replaceAll") ?? false;

    try {
      const content = await readFile(absolutePath, "utf8");
      const replacement = replaceEveryMatch
        ? replaceAll(content, oldStringInput.value, newStringInput.value)
        : replaceSingle(content, oldStringInput.value, newStringInput.value);

      if (replacement.count === 0) {
        return toErrorResult(`No match found for "${oldStringInput.value}"`, {
          filePath: absolutePath,
        });
      }

      await writeFile(absolutePath, replacement.value, "utf8");

      return toSuccessResult(
        `Applied ${replacement.count} replacement${replacement.count === 1 ? "" : "s"} in ${absolutePath}`,
        {
          filePath: absolutePath,
          replacements: replacement.count,
          replaceAll: replaceEveryMatch,
        },
      );
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return toErrorResult(err.message, { filePath: absolutePath, code: err.code });
    }
  }
}
