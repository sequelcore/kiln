import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileToolMetadata } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { inferFileMimeType, looksBinaryFilePath } from "./file-content-helpers.js";
import {
  optionalNumber,
  requireString,
  resolvePath,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
} from "./tool-helpers.js";

const MAX_ALTERNATIVE_SCAN_FILES = 2_000;
const MAX_READ_SUGGESTIONS = 12;
const SUGGESTION_SCAN_IGNORED_DIRECTORIES = new Set([".git", "build", "coverage", "dist", "node_modules", "target"]);

export class ReadTool implements DevTool {
  readonly name = "read";
  readonly description = TOOL_SCHEMAS.read.description;
  readonly inputSchema = TOOL_SCHEMAS.read.inputSchema;

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const filePathInput = requireString(input, "filePath");
    if (!filePathInput.ok) {
      return filePathInput.result;
    }

    const absolutePath = resolvePath(filePathInput.value, sandbox);
    const readError = validateReadPath(absolutePath, sandbox);
    if (readError) {
      return toErrorResult(readError, fileToolMetadata("read", {
        operation: "read",
        filePath: absolutePath,
      }));
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
      const contentBuffer = await readFile(absolutePath);
      const mimeType = inferFileMimeType(absolutePath);
      if (looksBinaryFilePath(absolutePath) || contentBuffer.includes(0)) {
        const imageGuidance = mimeType.startsWith("image/")
          ? " Use view_image for supported image files."
          : "";
        return toErrorResult(`Binary file cannot be read as text (${mimeType}).${imageGuidance}`, fileToolMetadata("read", {
          operation: "read",
          filePath: absolutePath,
          code: "BINARY_FILE",
        }));
      }

      const content = contentBuffer.toString("utf8");
      const lines = content.split(/\r?\n/);
      const sliced = limit !== undefined ? lines.slice(offset, offset + limit) : lines.slice(offset);
      const windowed = sliced.join("\n");
      return toSuccessResult(windowed, fileToolMetadata("read", {
        operation: "read",
        filePath: absolutePath,
        offset,
        limit,
        totalLines: lines.length,
      }));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      const suggestions = err.code === "ENOENT"
        ? await suggestReadAlternatives(absolutePath, sandbox)
        : [];
      const suggestionText = suggestions.length > 0
        ? `\nDid you mean one of these existing files?\n${suggestions.map((path) => `- ${path}`).join("\n")}`
        : "";
      return toErrorResult(`${err.message}${suggestionText}`, fileToolMetadata("read", {
        operation: "read",
        filePath: absolutePath,
        code: err.code,
        ...(suggestions.length > 0 ? { suggestions } : {}),
      }));
    }
  }
}

async function suggestReadAlternatives(
  missingPath: string,
  sandbox?: unknown,
): Promise<readonly string[]> {
  const parentPath = dirname(missingPath);
  const parentReadError = validateReadPath(parentPath, sandbox);
  if (parentReadError) {
    return [];
  }

  try {
    const requestedName = basename(missingPath).toLowerCase();
    const requestedStem = requestedName.replace(/\.[^.]+$/, "");
    const requestedExtension = extname(requestedName);
    const entries = await readdir(parentPath, { withFileTypes: true });
    const siblingSuggestions = entries
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const candidatePath = join(parentPath, entry.name);
        const candidateName = entry.name.toLowerCase();
        const candidateStem = candidateName.replace(/\.[^.]+$/, "");
        const candidateExtension = extname(candidateName);
        return {
          path: candidatePath,
          score:
            (candidateExtension === requestedExtension ? 4 : 0)
            + (candidateStem === requestedStem ? 3 : 0)
            + (candidateStem.includes(requestedStem) || requestedStem.includes(candidateStem) ? 2 : 0)
            + (candidateName.includes(requestedName) || requestedName.includes(candidateName) ? 1 : 0),
        };
      })
      .filter((candidate) => !validateReadPath(candidate.path, sandbox))
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path, "en"))
      .slice(0, MAX_READ_SUGGESTIONS)
      .map((candidate) => candidate.path);
    if (siblingSuggestions.length > 0) {
      return siblingSuggestions;
    }
  } catch {
    return await suggestMatchingBasenamesFromNearestAncestor(missingPath, sandbox);
  }

  return await suggestMatchingBasenamesFromNearestAncestor(missingPath, sandbox);
}

async function suggestMatchingBasenamesFromNearestAncestor(
  missingPath: string,
  sandbox?: unknown,
): Promise<readonly string[]> {
  const requestedName = basename(missingPath).toLowerCase();
  let currentPath = dirname(missingPath);

  while (dirname(currentPath) !== currentPath) {
    const readError = validateReadPath(currentPath, sandbox);
    if (readError) {
      return [];
    }

    try {
      await readdir(currentPath, { withFileTypes: true });
      return await findMatchingBasenames(currentPath, requestedName, sandbox);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT" && err.code !== "ENOTDIR") {
        return [];
      }
      currentPath = dirname(currentPath);
    }
  }

  return [];
}

async function findMatchingBasenames(
  rootPath: string,
  requestedName: string,
  sandbox?: unknown,
): Promise<readonly string[]> {
  const suggestions: string[] = [];
  const pending = [rootPath];
  let scannedFiles = 0;

  while (pending.length > 0 && scannedFiles < MAX_ALTERNATIVE_SCAN_FILES && suggestions.length < MAX_READ_SUGGESTIONS) {
    const currentPath = pending.pop()!;
    if (validateReadPath(currentPath, sandbox)) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const candidatePath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (!SUGGESTION_SCAN_IGNORED_DIRECTORIES.has(entry.name)) {
          pending.push(candidatePath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      scannedFiles += 1;
      if (entry.name.toLowerCase() !== requestedName || validateReadPath(candidatePath, sandbox)) {
        continue;
      }
      suggestions.push(candidatePath);
      if (suggestions.length >= MAX_READ_SUGGESTIONS || scannedFiles >= MAX_ALTERNATIVE_SCAN_FILES) {
        break;
      }
    }
  }

  return suggestions.sort((left, right) => left.localeCompare(right, "en"));
}
