import { dirname } from "node:path";
import { resolveVendoredToolBinary } from "@kilnai/tools";
import {
  detectToolEnvironment,
  type ToolEnvironment,
} from "../domain/tool-environment.js";
import {
  structuredDataToolMetadata,
  type SearchRuntimeSource,
  type ToolOutputVerbosity,
} from "../domain/tool-result-metadata.js";
import {
  TOOL_SCHEMAS,
  type DevTool,
  type ToolInput,
  type ToolResult,
} from "../domain/tool.js";
import { parseOutputVerbosity } from "./output-verbosity.js";
import type { VendoredToolResolver } from "./search-runtime.js";
import {
  type CommandResult,
  getSandboxContext,
  optionalNumber,
  optionalString,
  requireString,
  resolvePath,
  runCommand as defaultRunCommand,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
} from "./tool-helpers.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_BYTES_LIMIT = 1024 * 1024;

type JsonQueryCommandRunner = (
  binary: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  stdin?: string,
) => Promise<CommandResult>;

type EnvironmentProvider = () => Promise<ToolEnvironment>;

interface JsonQueryRuntime {
  readonly path: string;
  readonly source: Extract<SearchRuntimeSource, "bundled" | "system">;
  readonly version?: string;
}

type JsonQuerySource =
  | { readonly kind: "inline"; readonly json: string; readonly cwd: string }
  | { readonly kind: "file"; readonly path: string; readonly cwd: string };

export interface JsonQueryToolOptions {
  readonly commandRunner?: JsonQueryCommandRunner;
  readonly environmentProvider?: EnvironmentProvider;
  readonly vendoredToolResolver?: VendoredToolResolver;
}

export class JsonQueryTool implements DevTool {
  readonly name = "json_query";
  readonly description = TOOL_SCHEMAS.json_query.description;
  readonly inputSchema = TOOL_SCHEMAS.json_query.inputSchema;

  private readonly commandRunner: JsonQueryCommandRunner;
  private readonly environmentProvider: EnvironmentProvider;
  private readonly vendoredToolResolver: VendoredToolResolver;

  constructor(options: JsonQueryToolOptions = {}) {
    this.commandRunner = options.commandRunner ?? defaultRunCommand;
    this.environmentProvider = options.environmentProvider ?? detectToolEnvironment;
    this.vendoredToolResolver = options.vendoredToolResolver ?? resolveVendoredToolBinary;
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const filterInput = requireString(input, "filter");
    if (!filterInput.ok) {
      return filterInput.result;
    }
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) {
      return verbosityInput.result;
    }
    const maxBytesInput = parseMaxBytes(input);
    if (!maxBytesInput.ok) {
      return toErrorResult(maxBytesInput.message, baseMetadata("inline", filterInput.value, verbosityInput.value));
    }

    const source = resolveJsonSource(input, sandbox);
    if (!source.ok) {
      return toErrorResult(source.message, baseMetadata("inline", filterInput.value, verbosityInput.value));
    }

    if (source.value.kind === "file") {
      const readError = validateReadPath(source.value.path, sandbox);
      if (readError) {
        return toErrorResult(readError, baseMetadata("file", filterInput.value, verbosityInput.value, {
          path: source.value.path,
        }));
      }
    }

    const runtime = await this.resolveRuntime();
    if (!runtime) {
      return toErrorResult("jq runtime is required for json_query; install bundled Kiln tools or provide jq on PATH", baseMetadata(
        source.value.kind,
        filterInput.value,
        verbosityInput.value,
        {
          ...(source.value.kind === "file" ? { path: source.value.path } : {}),
          runtimeSource: "unavailable",
        },
      ));
    }

    return await this.executeJq(runtime, source.value, filterInput.value, maxBytesInput.value, verbosityInput.value);
  }

  private async resolveRuntime(): Promise<JsonQueryRuntime | undefined> {
    const vendoredJq = this.vendoredToolResolver("jq");
    if (vendoredJq) {
      return {
        path: vendoredJq.path,
        source: "bundled",
        version: vendoredJq.version,
      };
    }

    const environment = await this.environmentProvider();
    return environment.jq
      ? {
        path: environment.jq.path,
        source: "system",
        version: environment.jq.version,
      }
      : undefined;
  }

  private async executeJq(
    runtime: JsonQueryRuntime,
    source: JsonQuerySource,
    filter: string,
    maxBytes: number,
    verbosity: ToolOutputVerbosity,
  ): Promise<ToolResult> {
    const args = source.kind === "inline"
      ? ["-c", filter]
      : ["-c", filter, source.path];
    const stdin = source.kind === "inline" ? source.json : undefined;

    try {
      const result = stdin === undefined
        ? await this.commandRunner(runtime.path, args, source.cwd, DEFAULT_TIMEOUT_MS)
        : await this.commandRunner(runtime.path, args, source.cwd, DEFAULT_TIMEOUT_MS, stdin);
      const rawOutput = result.stdout.trim();
      const projection = truncateUtf8(rawOutput, maxBytes);
      return toSuccessResult(formatOutput(projection.output, verbosity), structuredDataToolMetadata("json_query", {
        operation: "query",
        source: source.kind,
        ...(source.kind === "file" ? { path: source.path } : {}),
        filter,
        strategy: "jq",
        runtimeSource: runtime.source,
        runtimePath: runtime.path,
        runtimeVersion: runtime.version,
        lineCount: countOutputLines(projection.output),
        totalBytes: projection.totalBytes,
        maxBytes,
        truncated: projection.truncated,
        verbosity,
      }));
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };
      const message =
        [err.stderr, err.stdout].filter(Boolean).join("").trim()
        || err.message
        || "jq execution failed";
      return toErrorResult(message, structuredDataToolMetadata("json_query", {
        operation: "query",
        source: source.kind,
        ...(source.kind === "file" ? { path: source.path } : {}),
        filter,
        strategy: "jq",
        runtimeSource: runtime.source,
        runtimePath: runtime.path,
        runtimeVersion: runtime.version,
        verbosity,
      }));
    }
  }
}

function resolveJsonSource(
  input: ToolInput,
  sandbox?: unknown,
): { ok: true; value: JsonQuerySource } | { ok: false; message: string } {
  const inlineJson = optionalString(input, "json");
  const filePath = optionalString(input, "path");
  if ((inlineJson === undefined && filePath === undefined) || (inlineJson !== undefined && filePath !== undefined)) {
    return { ok: false, message: 'Invalid input: provide exactly one of "json" or "path"' };
  }

  const sandboxContext = getSandboxContext(sandbox);
  const cwd = sandboxContext?.cwd ?? process.cwd();
  if (inlineJson !== undefined) {
    return { ok: true, value: { kind: "inline", json: inlineJson, cwd } };
  }

  return {
    ok: true,
    value: {
      kind: "file",
      path: resolvePath(filePath ?? "", sandbox),
      cwd: dirname(resolvePath(filePath ?? "", sandbox)),
    },
  };
}

function parseMaxBytes(input: ToolInput): { ok: true; value: number } | { ok: false; message: string } {
  const value = optionalNumber(input, "maxBytes");
  if (value === undefined) {
    if (input.input["maxBytes"] !== undefined) {
      return { ok: false, message: 'Invalid input: "maxBytes" must be a finite number' };
    }
    return { ok: true, value: DEFAULT_MAX_BYTES };
  }

  if (value <= 0) {
    return { ok: false, message: 'Invalid input: "maxBytes" must be > 0' };
  }

  return { ok: true, value: Math.min(Math.floor(value), MAX_BYTES_LIMIT) };
}

function baseMetadata(
  source: "inline" | "file",
  filter: string,
  verbosity: ToolOutputVerbosity,
  overrides: Partial<Parameters<typeof structuredDataToolMetadata<"json_query">>[1]> = {},
) {
  return structuredDataToolMetadata("json_query", {
    operation: "query",
    source,
    filter,
    strategy: "jq",
    verbosity,
    ...overrides,
  });
}

function truncateUtf8(output: string, maxBytes: number): {
  readonly output: string;
  readonly totalBytes: number;
  readonly truncated: boolean;
} {
  const buffer = Buffer.from(output, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { output, totalBytes: buffer.byteLength, truncated: false };
  }

  return {
    output: buffer.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/u, ""),
    totalBytes: buffer.byteLength,
    truncated: true,
  };
}

function countOutputLines(output: string): number {
  if (output.length === 0) {
    return 0;
  }
  return output.split(/\r?\n/).length;
}

function formatOutput(output: string, verbosity: ToolOutputVerbosity): string {
  if (verbosity === "structured") {
    return JSON.stringify({
      output,
      lineCount: countOutputLines(output),
    }, null, 2);
  }

  if (verbosity === "summary") {
    return `${countOutputLines(output)} JSON ${countOutputLines(output) === 1 ? "line" : "lines"} returned`;
  }

  return output;
}
