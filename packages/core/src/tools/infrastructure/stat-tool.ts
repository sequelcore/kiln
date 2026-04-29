import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { inspectionToolMetadata, type InspectionEntryType } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import {
  optionalString,
  requireString,
  resolvePath,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
} from "./tool-helpers.js";

type HashMode = "none" | "sha256";

export class StatTool implements DevTool {
  readonly name = "stat";
  readonly description = TOOL_SCHEMAS.stat.description;
  readonly inputSchema = TOOL_SCHEMAS.stat.inputSchema;
  readonly annotations = TOOL_SCHEMAS.stat.annotations;

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const pathInput = requireString(input, "path");
    if (!pathInput.ok) {
      return pathInput.result;
    }

    const absolutePath = resolvePath(pathInput.value, sandbox);
    const readError = validateReadPath(absolutePath, sandbox);
    const hashInput = optionalString(input, "hash");
    const hashMode = parseHashMode(hashInput);
    if (!hashMode) {
      return toErrorResult('Invalid input: "hash" must be "none" or "sha256"', inspectionToolMetadata("stat", {
        operation: "stat",
        path: absolutePath,
        hashAlgorithm: "none",
      }));
    }
    if (readError) {
      return toErrorResult(readError, inspectionToolMetadata("stat", {
        operation: "stat",
        path: absolutePath,
        hashAlgorithm: hashMode,
      }));
    }

    try {
      const info = await lstat(absolutePath);
      const type = getEntryType(info);
      const hash = hashMode === "sha256" && type === "file"
        ? await sha256File(absolutePath)
        : undefined;
      const metadata = {
        operation: "stat" as const,
        path: absolutePath,
        type,
        size: info.size,
        modifiedTime: info.mtime.toISOString(),
        hashAlgorithm: hashMode,
        ...(hash ? { hash } : {}),
      };
      const output = {
        path: metadata.path,
        type: metadata.type,
        size: metadata.size,
        modifiedTime: metadata.modifiedTime,
        ...(hash ? { hash: { algorithm: "sha256", value: hash } } : {}),
      };

      return toSuccessResult(JSON.stringify(output, null, 2), inspectionToolMetadata("stat", metadata));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return toErrorResult(err.message, inspectionToolMetadata("stat", {
        operation: "stat",
        path: absolutePath,
        hashAlgorithm: hashMode,
        code: err.code,
      }));
    }
  }
}

function parseHashMode(value: string | undefined): HashMode | undefined {
  if (value === undefined || value === "none") return "none";
  if (value === "sha256") return "sha256";
  return undefined;
}

function getEntryType(info: Awaited<ReturnType<typeof lstat>>): InspectionEntryType {
  if (info.isFile()) return "file";
  if (info.isDirectory()) return "directory";
  if (info.isSymbolicLink()) return "symlink";
  return "other";
}

async function sha256File(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}
