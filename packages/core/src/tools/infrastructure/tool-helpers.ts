import { basename, resolve } from "node:path";
import type { BuiltinFilesystem } from "../contracts/builtin-filesystem.js";

import { PathValidator, type PhysicalPathResolver } from "../../sandbox/path-validator.js";
import { SandboxPolicy } from "../../sandbox/policies.js";
import type { ToolResultMetadata } from "../domain/tool-result-metadata.js";
import type { ToolInput, ToolResult } from "../domain/tool.js";

type RecordValue = Record<string, unknown>;

export interface ToolSandboxContext {
  readonly cwd?: string;
  readonly policy?: SandboxPolicy;
  readonly pathValidator?: PathValidator;
  readonly physicalPathResolver?: PhysicalPathResolver;
  readonly allowedToolNames?: readonly string[];
}

export function toErrorResult(message: string, metadata?: ToolResultMetadata): ToolResult {
  return {
    output: message,
    isError: true,
    metadata,
  };
}

export function toSuccessResult(output: string, metadata?: ToolResultMetadata): ToolResult {
  return {
    output,
    isError: false,
    metadata,
  };
}

export function getSandboxContext(sandbox?: unknown): ToolSandboxContext | undefined {
  if (!sandbox || typeof sandbox !== "object") {
    return undefined;
  }

  const context = sandbox as {
    cwd?: unknown;
    policy?: unknown;
    pathValidator?: unknown;
    physicalPathResolver?: unknown;
    allowedToolNames?: unknown;
  };

  const policy = context.policy instanceof SandboxPolicy ? context.policy : undefined;
  const physicalPathResolver = isPhysicalPathResolver(context.physicalPathResolver)
    ? context.physicalPathResolver
    : undefined;
  const pathValidator =
    context.pathValidator instanceof PathValidator
      ? context.pathValidator
      : policy
        ? new PathValidator({
            policy,
            ...(physicalPathResolver ? { physicalPathResolver } : {}),
          })
        : undefined;

  return {
    cwd: typeof context.cwd === "string" ? context.cwd : undefined,
    policy,
    pathValidator,
    physicalPathResolver,
    allowedToolNames: isStringArray(context.allowedToolNames) ? context.allowedToolNames : undefined,
  };
}

function isPhysicalPathResolver(value: unknown): value is PhysicalPathResolver {
  return typeof value === "object"
    && value !== null
    && typeof Reflect.get(value, "resolve") === "function";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function resolvePath(filePath: string, sandbox?: unknown): string {
  const context = getSandboxContext(sandbox);
  if (context?.cwd) {
    return resolve(context.cwd, filePath);
  }

  return resolve(filePath);
}

export function validateReadPath(filePath: string, sandbox?: unknown): string | undefined {
  const context = getSandboxContext(sandbox);
  if (!context?.pathValidator) {
    return undefined;
  }

  const result = context.pathValidator.validateRead(filePath);
  return result.allowed ? undefined : result.reason ?? "Read access denied";
}

export function validateWritePath(filePath: string, sandbox?: unknown): string | undefined {
  const context = getSandboxContext(sandbox);
  if (!context?.pathValidator) {
    return undefined;
  }

  const result = context.pathValidator.validateWrite(filePath);
  return result.allowed ? undefined : result.reason ?? "Write access denied";
}

export function requireString(
  input: ToolInput,
  key: string,
  options?: {
    allowEmpty?: boolean;
  },
): { ok: true; value: string } | { ok: false; result: ToolResult } {
  const value = (input.input as RecordValue)[key];
  const allowEmpty = options?.allowEmpty ?? false;
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    return {
      ok: false,
      result: toErrorResult(
        allowEmpty
          ? `Invalid input: "${key}" must be a string`
          : `Invalid input: "${key}" must be a non-empty string`,
      ),
    };
  }

  return { ok: true, value };
}

export function optionalNumber(input: ToolInput, key: string): number | undefined {
  const value = (input.input as RecordValue)[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

export function optionalString(input: ToolInput, key: string): string | undefined {
  const value = (input.input as RecordValue)[key];
  return typeof value === "string" ? value : undefined;
}

export function optionalBoolean(input: ToolInput, key: string): boolean | undefined {
  const value = (input.input as RecordValue)[key];
  return typeof value === "boolean" ? value : undefined;
}

export function validateCommand(
  command: string,
  cwd: string,
  sandbox?: unknown,
): string | undefined {
  const context = getSandboxContext(sandbox);
  if (!context?.pathValidator) {
    return undefined;
  }

  const result = context.pathValidator.validateExecute(command, cwd);
  return result.allowed ? undefined : result.reason ?? "Command execution denied";
}

// --- Shared infrastructure for grep/glob fallback paths ---

export type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
};

export async function runCommand(
  binary: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  stdin?: string,
): Promise<CommandResult> {
  void binary;
  void args;
  void cwd;
  void timeoutMs;
  void stdin;
  throw new Error("Command execution requires a Runtime-owned command runner");
}

export async function walkFiles(filesystem: BuiltinFilesystem, rootPath: string): Promise<string[]> {
  const out: string[] = [];
  await walk(filesystem, rootPath, out);
  return out;
}

async function walk(filesystem: BuiltinFilesystem, currentPath: string, out: string[]): Promise<void> {
  const entries = await filesystem.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = `${currentPath}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(filesystem, fullPath, out);
      continue;
    }
    if (entry.isFile()) out.push(fullPath);
  }
}

export function matchesGlob(candidatePath: string, globPattern: string): boolean {
  const normalizedPath = normalizePath(candidatePath);
  return expandGlobAlternates(globPattern).some((normalizedPattern) => {
    const matcher = globToRegExp(normalizedPattern);
    if (normalizedPattern.includes("/")) return matcher.test(normalizedPath);
    return matcher.test(basename(normalizedPath));
  });
}

export function expandGlobAlternates(globPattern: string): readonly string[] {
  return uniqueStrings(expandFirstBraceGroup(normalizePath(globPattern)));
}

function expandFirstBraceGroup(pattern: string): string[] {
  const start = pattern.indexOf("{");
  if (start < 0) {
    return [pattern];
  }

  const end = pattern.indexOf("}", start + 1);
  if (end < 0) {
    return [pattern];
  }

  const body = pattern.slice(start + 1, end);
  const alternatives = body.split(",").map((value) => value.trim()).filter(Boolean);
  if (alternatives.length < 2) {
    return [pattern];
  }

  const prefix = pattern.slice(0, start);
  const suffix = pattern.slice(end + 1);
  return alternatives.flatMap((alternative) => expandFirstBraceGroup(`${prefix}${alternative}${suffix}`));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withGlobstarSlash = escaped.replace(/\*\*\//g, "::GLOBSTAR_SLASH::");
  const withDoubleStar = withGlobstarSlash.replace(/\*\*/g, "::DOUBLE_STAR::");
  const withSingleStar = withDoubleStar.replace(/\*/g, "[^/]*");
  const withQuestion = withSingleStar.replace(/\?/g, ".");
  const source = withQuestion
    .replace(/::GLOBSTAR_SLASH::/g, "(?:.*/)?")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${source}$`);
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
