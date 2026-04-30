import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  fileToolMetadata,
  type FileToolChangeMetadata,
} from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import {
  buildAddedPreview,
  buildRemovedPreview,
  clipDiffPreview,
  countTextLines,
} from "./file-diff-preview.js";
import {
  optionalBoolean,
  requireString,
  resolvePath,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
  validateWritePath,
} from "./tool-helpers.js";

type PatchOperation =
  | { readonly type: "add"; readonly path: string; readonly lines: readonly string[] }
  | { readonly type: "delete"; readonly path: string }
  | {
      readonly type: "update";
      readonly path: string;
      readonly moveTo?: string;
      readonly hunks: readonly PatchHunk[];
    };

type PatchLine = {
  readonly kind: "context" | "add" | "remove";
  readonly text: string;
};

type PatchHunk = {
  readonly lines: readonly PatchLine[];
};

type PlannedPatchOperation =
  | {
      readonly type: "write";
      readonly path: string;
      readonly content: string;
      readonly metadata: FileToolChangeMetadata;
    }
  | {
      readonly type: "delete";
      readonly path: string;
      readonly metadata: FileToolChangeMetadata;
    }
  | {
      readonly type: "move";
      readonly fromPath: string;
      readonly toPath: string;
      readonly content: string;
      readonly metadata: FileToolChangeMetadata;
    };

type FileSnapshot =
  | { readonly exists: false }
  | { readonly exists: true; readonly content: string };

export class PatchTool implements DevTool {
  readonly name = "patch";
  readonly description = TOOL_SCHEMAS.patch.description;
  readonly inputSchema = TOOL_SCHEMAS.patch.inputSchema;
  readonly annotations = TOOL_SCHEMAS.patch.annotations;

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const patchInput = requireString(input, "patch");
    if (!patchInput.ok) {
      return patchInput.result;
    }

    const dryRun = optionalBoolean(input, "dryRun") ?? false;
    const parsed = parsePatchDocument(patchInput.value);
    if (!parsed.ok) {
      return toErrorResult(`Invalid patch: ${parsed.error}`, fileToolMetadata("patch", {
        operation: "patch",
        dryRun,
      }));
    }

    const validationError = validatePatchPaths(parsed.operations, sandbox);
    if (validationError) {
      return toErrorResult(validationError, fileToolMetadata("patch", {
        operation: "patch",
        dryRun,
        operationCount: parsed.operations.length,
      }));
    }

    try {
      const planned = await planPatchOperations(parsed.operations, sandbox);
      const files = planned.map((operation) => operation.metadata);

      if (!dryRun) {
        await applyPlannedOperations(planned);
      }

      const verb = dryRun ? "Dry run validated" : "Applied";
      return toSuccessResult(
        `${verb} ${planned.length} patch operation${planned.length === 1 ? "" : "s"}`,
        fileToolMetadata("patch", {
          operation: "patch",
          dryRun,
          operationCount: planned.length,
          files,
        }),
      );
    } catch (error) {
      const err = error as Error;
      return toErrorResult(err.message, fileToolMetadata("patch", {
        operation: "patch",
        dryRun,
        operationCount: parsed.operations.length,
      }));
    }
  }
}

function parsePatchDocument(input: string): { ok: true; operations: readonly PatchOperation[] } | { ok: false; error: string } {
  const lines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines[0] !== "*** Begin Patch") {
    return { ok: false, error: 'document must start with "*** Begin Patch"' };
  }

  const operations: PatchOperation[] = [];
  let index = 1;
  let ended = false;

  while (index < lines.length) {
    const line = lines[index]!;
    if (line === "*** End Patch") {
      ended = true;
      index += 1;
      break;
    }

    if (line.startsWith("*** Add File: ")) {
      const path = parseHeaderPath(line, "*** Add File: ");
      if (!path) return { ok: false, error: "Add File path must be non-empty" };
      index += 1;
      const contentLines: string[] = [];
      while (index < lines.length && !isPatchHeader(lines[index]!)) {
        const contentLine = lines[index]!;
        if (!contentLine.startsWith("+")) {
          return { ok: false, error: `Add File lines must start with "+": ${contentLine}` };
        }
        contentLines.push(contentLine.slice(1));
        index += 1;
      }
      operations.push({ type: "add", path, lines: contentLines });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      const path = parseHeaderPath(line, "*** Delete File: ");
      if (!path) return { ok: false, error: "Delete File path must be non-empty" };
      operations.push({ type: "delete", path });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const path = parseHeaderPath(line, "*** Update File: ");
      if (!path) return { ok: false, error: "Update File path must be non-empty" };
      index += 1;
      let moveTo: string | undefined;
      const hunks: PatchHunk[] = [];

      if (lines[index]?.startsWith("*** Move to: ")) {
        moveTo = parseHeaderPath(lines[index]!, "*** Move to: ");
        if (!moveTo) return { ok: false, error: "Move to path must be non-empty" };
        index += 1;
      }

      while (index < lines.length && !isPatchOperationHeader(lines[index]!) && lines[index] !== "*** End Patch") {
        if (lines[index] === "*** End of File") {
          index += 1;
          continue;
        }
        if (!lines[index]?.startsWith("@@")) {
          return { ok: false, error: `Update File expected hunk header, got: ${lines[index] ?? ""}` };
        }
        index += 1;
        const hunkLines: PatchLine[] = [];
        while (
          index < lines.length
          && !lines[index]?.startsWith("@@")
          && !isPatchOperationHeader(lines[index]!)
          && lines[index] !== "*** End Patch"
          && lines[index] !== "*** End of File"
        ) {
          const hunkLine = lines[index]!;
          const marker = hunkLine[0];
          if (marker !== " " && marker !== "+" && marker !== "-") {
            return { ok: false, error: `Hunk lines must start with space, "+", or "-": ${hunkLine}` };
          }
          hunkLines.push({
            kind: marker === " " ? "context" : marker === "+" ? "add" : "remove",
            text: hunkLine.slice(1),
          });
          index += 1;
        }
        if (!hunkLines.some((hunkLine) => hunkLine.kind !== "context")) {
          return { ok: false, error: "Update hunk must add or remove at least one line" };
        }
        hunks.push({ lines: hunkLines });
      }

      if (!moveTo && hunks.length === 0) {
        return { ok: false, error: "Update File requires at least one hunk or Move to header" };
      }
      operations.push({ type: "update", path, ...(moveTo ? { moveTo } : {}), hunks });
      continue;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    return { ok: false, error: `unsupported patch header: ${line}` };
  }

  if (!ended) {
    return { ok: false, error: 'document must end with "*** End Patch"' };
  }
  if (lines.slice(index).some((line) => line.trim() !== "")) {
    return { ok: false, error: "content after End Patch is not allowed" };
  }
  if (operations.length === 0) {
    return { ok: false, error: "document contains no operations" };
  }

  return { ok: true, operations };
}

function parseHeaderPath(line: string, prefix: string): string | undefined {
  const value = line.slice(prefix.length).trim();
  return value.length > 0 ? value : undefined;
}

function isPatchHeader(line: string): boolean {
  return line.startsWith("*** ");
}

function isPatchOperationHeader(line: string): boolean {
  return line.startsWith("*** Add File: ")
    || line.startsWith("*** Delete File: ")
    || line.startsWith("*** Update File: ");
}

function validatePatchPaths(operations: readonly PatchOperation[], sandbox?: unknown): string | undefined {
  const touchedPaths = new Set<string>();

  for (const operation of operations) {
    const primaryPath = resolvePath(operation.path, sandbox);
    if (touchedPaths.has(primaryPath)) {
      return `Patch touches ${primaryPath} more than once; split repeated edits into one Update File operation`;
    }
    touchedPaths.add(primaryPath);

    const readError = operation.type === "add" ? undefined : validateReadPath(primaryPath, sandbox);
    if (readError) return readError;

    const writeError = validateWritePath(primaryPath, sandbox);
    if (writeError) return writeError;

    if (operation.type === "update" && operation.moveTo) {
      const targetPath = resolvePath(operation.moveTo, sandbox);
      if (touchedPaths.has(targetPath)) {
        return `Patch touches ${targetPath} more than once; move target must be unique`;
      }
      touchedPaths.add(targetPath);
      const targetWriteError = validateWritePath(targetPath, sandbox);
      if (targetWriteError) return targetWriteError;
    }
  }

  return undefined;
}

async function planPatchOperations(
  operations: readonly PatchOperation[],
  sandbox?: unknown,
): Promise<readonly PlannedPatchOperation[]> {
  const planned: PlannedPatchOperation[] = [];

  for (const operation of operations) {
    if (operation.type === "add") {
      const path = resolvePath(operation.path, sandbox);
      if (await pathExists(path)) {
        throw new Error(`Cannot add ${path}: file already exists`);
      }
      const content = operation.lines.join("\n");
      const preview = clipDiffPreview(buildAddedPreview(content));
      planned.push({
        type: "write",
        path,
        content,
        metadata: {
          operation: "write",
          filePath: path,
          changeType: "created",
          linesAdded: countTextLines(content),
          diffPreview: preview.preview,
          diffTruncated: preview.truncated,
        },
      });
      continue;
    }

    if (operation.type === "delete") {
      const path = resolvePath(operation.path, sandbox);
      const content = await readExistingFile(path);
      const preview = clipDiffPreview(buildRemovedPreview(content));
      planned.push({
        type: "delete",
        path,
        metadata: {
          operation: "delete",
          filePath: path,
          changeType: "deleted",
          linesRemoved: countTextLines(content),
          diffPreview: preview.preview,
          diffTruncated: preview.truncated,
        },
      });
      continue;
    }

    const path = resolvePath(operation.path, sandbox);
    const originalContent = await readExistingFile(path);
    const updated = applyHunks(originalContent, operation.hunks, path);
    const targetPath = operation.moveTo ? resolvePath(operation.moveTo, sandbox) : path;
    if (operation.moveTo && await pathExists(targetPath)) {
      throw new Error(`Cannot move ${path} to ${targetPath}: target already exists`);
    }
    const preview = clipDiffPreview(buildHunkPreview(operation.hunks));
    const metadata: FileToolChangeMetadata = {
      operation: operation.moveTo ? "move" : "edit",
      ...(operation.moveTo ? { previousFilePath: path } : {}),
      filePath: targetPath,
      changeType: "modified",
      linesAdded: countHunkLines(operation.hunks, "add"),
      linesRemoved: countHunkLines(operation.hunks, "remove"),
      ...(preview.preview.length > 0 ? { diffPreview: preview.preview } : {}),
      diffTruncated: preview.truncated,
    };
    planned.push(operation.moveTo
      ? { type: "move", fromPath: path, toPath: targetPath, content: updated, metadata }
      : { type: "write", path, content: updated, metadata });
  }

  return planned;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return false;
    throw error;
  }
}

async function readExistingFile(path: string): Promise<string> {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new Error(`${path} is not a file`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error(`Cannot patch ${path}: file does not exist`);
    }
    throw error;
  }
}

function applyHunks(content: string, hunks: readonly PatchHunk[], path: string): string {
  if (hunks.length === 0) {
    return content;
  }

  let lines = splitContent(content);
  let cursor = 0;

  for (const hunk of hunks) {
    const oldLines = hunk.lines
      .filter((line) => line.kind !== "add")
      .map((line) => line.text);
    const newLines = hunk.lines
      .filter((line) => line.kind !== "remove")
      .map((line) => line.text);
    const index = findLineSequence(lines, oldLines, cursor);
    if (index < 0) {
      throw new Error(`Hunk did not match ${path}`);
    }
    lines = [
      ...lines.slice(0, index),
      ...newLines,
      ...lines.slice(index + oldLines.length),
    ];
    cursor = index + newLines.length;
  }

  return lines.join("\n");
}

function splitContent(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function findLineSequence(lines: readonly string[], sequence: readonly string[], start: number): number {
  if (sequence.length === 0) {
    return Math.min(start, lines.length);
  }

  for (let index = start; index <= lines.length - sequence.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (lines[index + offset] !== sequence[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }

  return -1;
}

async function applyPlannedOperations(operations: readonly PlannedPatchOperation[]): Promise<void> {
  const snapshots = await captureSnapshots(operations);
  try {
    for (const operation of operations) {
      if (operation.type === "write") {
        await mkdir(dirname(operation.path), { recursive: true });
        await writeFile(operation.path, operation.content, "utf8");
        continue;
      }
      if (operation.type === "delete") {
        await rm(operation.path);
        continue;
      }
      await mkdir(dirname(operation.toPath), { recursive: true });
      await writeFile(operation.toPath, operation.content, "utf8");
      await rm(operation.fromPath);
    }
  } catch (error) {
    await restoreSnapshots(snapshots);
    throw error;
  }
}

async function captureSnapshots(operations: readonly PlannedPatchOperation[]): Promise<ReadonlyMap<string, FileSnapshot>> {
  const paths = new Set<string>();
  for (const operation of operations) {
    if (operation.type === "move") {
      paths.add(operation.fromPath);
      paths.add(operation.toPath);
    } else {
      paths.add(operation.path);
    }
  }

  const snapshots = new Map<string, FileSnapshot>();
  for (const path of paths) {
    try {
      snapshots.set(path, { exists: true, content: await readFile(path, "utf8") });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        snapshots.set(path, { exists: false });
        continue;
      }
      throw error;
    }
  }
  return snapshots;
}

async function restoreSnapshots(snapshots: ReadonlyMap<string, FileSnapshot>): Promise<void> {
  for (const [path, snapshot] of snapshots) {
    if (snapshot.exists) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, snapshot.content, "utf8");
    } else {
      await rm(path, { force: true });
    }
  }
}

function countHunkLines(hunks: readonly PatchHunk[], kind: "add" | "remove"): number {
  return hunks.reduce(
    (count, hunk) => count + hunk.lines.filter((line) => line.kind === kind).length,
    0,
  );
}

function buildHunkPreview(hunks: readonly PatchHunk[]): string {
  return hunks
    .flatMap((hunk) => hunk.lines.filter((line) => line.kind !== "context"))
    .map((line) => `${line.kind === "add" ? "+" : "-"} ${line.text}`)
    .join("\n");
}
