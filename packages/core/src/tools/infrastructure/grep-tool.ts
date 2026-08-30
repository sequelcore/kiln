import { basename, dirname } from "node:path";
import { type BuiltinFilesystem, unavailableBuiltinFilesystem } from "../contracts/builtin-filesystem.js";
import type { ToolEnvironment } from "../domain/tool-environment.js";
import { searchToolMetadata, type ToolOutputVerbosity } from "../domain/tool-result-metadata.js";
import {
  TOOL_SCHEMAS,
  type DevTool,
  type ToolInput,
  type ToolResult,
} from "../domain/tool.js";
import {
  type CommandResult,
  getSandboxContext,
  optionalNumber,
  optionalString,
  requireString,
  resolvePath,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
} from "./tool-helpers.js";
import { parseOutputVerbosity, pluralize, splitNonEmptyLines } from "./output-verbosity.js";
import {
  createRipgrepRuntimeProvider,
  type RipgrepRuntime,
  type VendoredToolResolver,
} from "./search-runtime.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESULTS = 200;
const MAX_RESULTS_LIMIT = 1_000;
const DEFAULT_MAX_FILESIZE = "1M";
const DEFAULT_EXCLUDED_GLOBS = [
  "!**/.git/**",
  "!**/.kiln/**",
  "!**/node_modules/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/coverage/**",
  "!**/.next/**",
  "!**/.turbo/**",
] as const;

type GrepOutputMode = "content" | "files_with_matches" | "count";
type GrepRequestedMatchMode = "auto" | "regex" | "literal";
type GrepEffectiveMatchMode = "regex" | "literal";

type GrepCommandRunner = (
  binary: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) => Promise<CommandResult>;

type EnvironmentProvider = () => Promise<ToolEnvironment>;
type SearchRuntimeProvider = () => Promise<RipgrepRuntime | undefined>;

interface GrepSearchTarget {
  readonly path: string;
  readonly root: string;
  readonly rgTarget: string;
}

export interface GrepToolOptions {
  readonly filesystem?: BuiltinFilesystem;
  readonly commandRunner?: GrepCommandRunner;
  readonly environmentProvider?: EnvironmentProvider;
  readonly searchRuntimeProvider?: SearchRuntimeProvider;
  readonly bundledRgPath?: string;
  readonly configuredRgPath?: string;
  readonly vendoredToolResolver?: VendoredToolResolver;
  readonly defaultCwd?: string;
}

export class GrepTool implements DevTool {
  readonly name = "grep";
  readonly description = TOOL_SCHEMAS.grep.description;
  readonly inputSchema = TOOL_SCHEMAS.grep.inputSchema;

  private readonly commandRunner: GrepCommandRunner;
  private readonly searchRuntimeProvider: SearchRuntimeProvider;
  private readonly filesystem: BuiltinFilesystem;
  private readonly defaultCwd: string;

  constructor(options: GrepToolOptions = {}) {
    this.commandRunner = options.commandRunner ?? unavailableGrepCommandRunner;
    this.filesystem = options.filesystem ?? unavailableBuiltinFilesystem;
    this.defaultCwd = options.defaultCwd ?? ".";
    this.searchRuntimeProvider = options.searchRuntimeProvider ?? createRipgrepRuntimeProvider({
      bundledPath: options.bundledRgPath,
      configuredPath: options.configuredRgPath,
      commandRunner: this.commandRunner,
      environmentProvider: options.environmentProvider ?? emptyToolEnvironment,
      vendoredToolResolver: options.vendoredToolResolver,
    });
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const patternInput = requireString(input, "pattern");
    if (!patternInput.ok) {
      return patternInput.result;
    }
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) {
      return verbosityInput.result;
    }

    const sandboxContext = getSandboxContext(sandbox);
    const searchPath = resolvePath(
      optionalString(input, "path") ?? sandboxContext?.cwd ?? this.defaultCwd,
      sandbox,
    );
    const rootReadError = validateReadPath(searchPath, sandbox);
    if (rootReadError) {
      return toErrorResult(rootReadError, searchToolMetadata("grep", {
        path: searchPath,
      }));
    }

    const globFilter = optionalString(input, "glob");
    const modeValue = optionalString(input, "outputMode");
    const outputMode = isGrepOutputMode(modeValue) ? modeValue : "content";
    const requestedMatchMode = parseMatchMode(optionalString(input, "matchMode"));
    const matchMode = resolveMatchMode(patternInput.value, requestedMatchMode);
    if (!matchMode.ok) {
      return toErrorResult(matchMode.message, searchToolMetadata("grep", {
        path: searchPath,
        outputMode,
      }));
    }
    const maxResultsInput = parseMaxResults(input);
    if (!maxResultsInput.ok) {
      return toErrorResult(maxResultsInput.message, searchToolMetadata("grep", {
        path: searchPath,
      }));
    }

    try {
      const searchTarget = await resolveSearchTarget(this.filesystem, searchPath);
      const runtime = await this.searchRuntimeProvider();
      if (!runtime) {
        return toErrorResult("ripgrep runtime is required for grep; install bundled Kiln search runtime or configure KILN_RG_PATH", searchToolMetadata("grep", {
          path: searchTarget.path,
          strategy: "rg",
          runtimeSource: "unavailable",
          outputMode,
          matchMode: matchMode.value,
          maxResults: maxResultsInput.value,
          verbosity: verbosityInput.value,
        }));
      }

      return await this.executeFastPath(
        runtime,
        searchTarget,
        patternInput.value,
        globFilter,
        outputMode,
        matchMode.value,
        maxResultsInput.value,
        verbosityInput.value,
      );
    } catch (error) {
      const err = error as Error;
      return toErrorResult(err.message, searchToolMetadata("grep", {
        path: searchPath,
      }));
    }
  }

  private async executeFastPath(
    runtime: RipgrepRuntime,
    searchTarget: GrepSearchTarget,
    pattern: string,
    globFilter: string | undefined,
    outputMode: GrepOutputMode,
    matchMode: GrepEffectiveMatchMode,
    maxResults: number,
    verbosity: ToolOutputVerbosity,
  ): Promise<ToolResult> {
    const args = buildFastPathArgs(pattern, globFilter, outputMode, matchMode, maxResults, searchTarget.rgTarget);

    try {
      const result = await this.commandRunner(
        runtime.path,
        args,
        searchTarget.root,
        DEFAULT_TIMEOUT_MS,
      );

      const rawOutput = result.stdout.trim();
      const allResults = splitNonEmptyLines(rawOutput);
      const projection = projectGrepResults(allResults, maxResults);
      return toSuccessResult(formatGrepOutput(projection, outputMode, verbosity), searchToolMetadata("grep", {
        path: searchTarget.path,
        strategy: "rg",
        runtimeSource: runtime.source,
        runtimePath: runtime.path,
        runtimeVersion: runtime.version,
        outputMode,
        matchMode,
        count: projection.results.length,
        totalCount: projection.totalCount,
        maxResults,
        truncated: projection.truncated,
        verbosity,
      }));
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };

      if (String(err.code) === "1") {
        const projection = projectGrepResults([], maxResults);
        return toSuccessResult(formatGrepOutput(projection, outputMode, verbosity), searchToolMetadata("grep", {
          path: searchTarget.path,
          strategy: "rg",
          runtimeSource: runtime.source,
          runtimePath: runtime.path,
          runtimeVersion: runtime.version,
          outputMode,
          matchMode,
          count: 0,
          totalCount: projection.totalCount,
          maxResults,
          truncated: false,
          noMatches: true,
          verbosity,
        }));
      }

      const message =
        [err.stderr, err.stdout].filter(Boolean).join("").trim() ||
        err.message ||
        "rg execution failed";

      return toErrorResult(message, searchToolMetadata("grep", {
        path: searchTarget.path,
        strategy: "rg",
        runtimeSource: runtime.source,
        runtimePath: runtime.path,
        runtimeVersion: runtime.version,
      }));
    }
  }
}

const unavailableGrepCommandRunner: GrepCommandRunner = async () => {
  throw new Error("Grep execution requires a Runtime-owned command runner");
};

const emptyToolEnvironment: EnvironmentProvider = async () => ({});

interface GrepResultProjection {
  readonly results: readonly string[];
  readonly totalCount: number;
  readonly truncated: boolean;
}

function formatGrepOutput(
  projection: GrepResultProjection,
  outputMode: GrepOutputMode,
  verbosity: ToolOutputVerbosity,
): string {
  const results = projection.results;
  if (verbosity === "structured") {
    return JSON.stringify({
      outputMode,
      results,
      count: results.length,
      totalCount: projection.totalCount,
      truncated: projection.truncated,
    }, null, 2);
  }

  if (verbosity === "summary") {
    const base = `${results.length} ${outputMode} ${pluralize(results.length, "result")}`;
    return projection.truncated
      ? `${base} returned; ${projection.totalCount} total matches`
      : base;
  }

  const output = results.join("\n");
  if (!projection.truncated) return output;
  return [
    output,
    `[grep results truncated: returned ${results.length} of ${projection.totalCount} matches; pass maxResults to adjust]`,
  ].filter(Boolean).join("\n");
}

function isGrepOutputMode(value: string | undefined): value is GrepOutputMode {
  return value === "content" || value === "files_with_matches" || value === "count";
}

function buildFastPathArgs(
  pattern: string,
  globFilter: string | undefined,
  outputMode: GrepOutputMode,
  matchMode: GrepEffectiveMatchMode,
  maxResults: number,
  target: string,
): string[] {
  const args: string[] = ["--no-heading", "--line-number"];
  if (outputMode !== "count") {
    args.push("--max-count", String(maxResults));
  }
  args.push("--max-filesize", DEFAULT_MAX_FILESIZE);
  if (globFilter) {
    args.push("--glob", globFilter);
  }
  for (const excludedGlob of DEFAULT_EXCLUDED_GLOBS) {
    args.push("--glob", excludedGlob);
  }

  if (outputMode === "files_with_matches") {
    args.push("--files-with-matches");
  } else if (outputMode === "count") {
    args.push("--count");
  }
  if (matchMode === "literal") {
    args.push("--fixed-strings");
  }

  args.push(pattern, target);
  return args;
}

function projectGrepResults(results: readonly string[], maxResults: number): GrepResultProjection {
  const projected = results.slice(0, maxResults);
  return {
    results: projected,
    totalCount: results.length,
    truncated: results.length > projected.length,
  };
}

function parseMatchMode(value: string | undefined): GrepRequestedMatchMode {
  return value === "regex" || value === "literal" ? value : "auto";
}

function resolveMatchMode(
  pattern: string,
  requestedMode: GrepRequestedMatchMode,
): { ok: true; value: GrepEffectiveMatchMode } | { ok: false; message: string } {
  if (requestedMode === "literal") {
    return { ok: true, value: "literal" };
  }
  try {
    new RegExp(pattern);
    return { ok: true, value: "regex" };
  } catch {
    if (requestedMode === "auto") {
      return { ok: true, value: "literal" };
    }
    return { ok: false, message: "Invalid input: \"pattern\" must be a valid regular expression" };
  }
}

function parseMaxResults(input: ToolInput): { ok: true; value: number } | { ok: false; message: string } {
  const value = optionalNumber(input, "maxResults");
  if (value === undefined) {
    if (input.input["maxResults"] !== undefined) {
      return { ok: false, message: 'Invalid input: "maxResults" must be a finite number' };
    }
    return { ok: true, value: DEFAULT_MAX_RESULTS };
  }

  if (value <= 0) {
    return { ok: false, message: 'Invalid input: "maxResults" must be > 0' };
  }

  return { ok: true, value: Math.min(Math.floor(value), MAX_RESULTS_LIMIT) };
}

async function resolveSearchTarget(filesystem: BuiltinFilesystem, searchPath: string): Promise<GrepSearchTarget> {
  const stats = await filesystem.stat(searchPath);
  if (stats.isDirectory()) {
    return {
      path: searchPath,
      root: searchPath,
      rgTarget: ".",
    };
  }

  if (stats.isFile()) {
    return {
      path: searchPath,
      root: dirname(searchPath),
      rgTarget: basename(searchPath),
    };
  }

  throw new Error("Invalid input: \"path\" must be a file or directory");
}
