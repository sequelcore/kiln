import { basename, join, relative } from "node:path";
import {
  detectToolEnvironment,
  type ToolEnvironment,
} from "../domain/tool-environment.js";
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
  matchesGlob,
  normalizePath,
  optionalString,
  requireString,
  resolvePath,
  runCommand as defaultRunCommand,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
  walkFiles,
  expandGlobAlternates,
} from "./tool-helpers.js";
import { parseOutputVerbosity, pluralize, splitNonEmptyLines } from "./output-verbosity.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const SUMMARY_MATCH_LIMIT = 20;
const RAW_MATCH_LIMIT = 200;

type GlobCommandRunner = (
  binary: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) => Promise<CommandResult>;

type EnvironmentProvider = () => Promise<ToolEnvironment>;

export interface GlobToolOptions {
  readonly commandRunner?: GlobCommandRunner;
  readonly environmentProvider?: EnvironmentProvider;
}

export class GlobTool implements DevTool {
  readonly name = "glob";
  readonly description = TOOL_SCHEMAS.glob.description;
  readonly inputSchema = TOOL_SCHEMAS.glob.inputSchema;

  private readonly commandRunner: GlobCommandRunner;
  private readonly environmentProvider: EnvironmentProvider;

  constructor(options: GlobToolOptions = {}) {
    this.commandRunner = options.commandRunner ?? defaultRunCommand;
    this.environmentProvider = options.environmentProvider ?? detectToolEnvironment;
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
    const searchRoot = resolvePath(
      optionalString(input, "path") ?? sandboxContext?.cwd ?? process.cwd(),
      sandbox,
    );
    const rootReadError = validateReadPath(searchRoot, sandbox);
    if (rootReadError) {
      return toErrorResult(rootReadError, searchToolMetadata("glob", {
        path: searchRoot,
      }));
    }

    try {
      const environment = await this.environmentProvider();
      const fdPath = environment.fd?.path;

      if (fdPath) {
        const fastPathResult = await this.executeFastPath(fdPath, searchRoot, patternInput.value, verbosityInput.value);
        if (!fastPathResult.isError) {
          return fastPathResult;
        }
      }

      return await this.executeFallback(searchRoot, patternInput.value, verbosityInput.value, sandbox);
    } catch (error) {
      const err = error as Error;
      return toErrorResult(err.message, searchToolMetadata("glob", {
        path: searchRoot,
      }));
    }
  }

  private async executeFastPath(
    fdPath: string,
    searchRoot: string,
    pattern: string,
    verbosity: ToolOutputVerbosity,
  ): Promise<ToolResult> {
    const patterns = expandGlobAlternates(pattern);
    const matches: string[] = [];
    try {
      for (const expandedPattern of patterns) {
        const plan = planFastPathGlob(searchRoot, expandedPattern);
        const args = ["--glob", "--type", "f", plan.pattern, "."];
        try {
          const result = await this.commandRunner(
            fdPath,
            args,
            plan.cwd,
            DEFAULT_TIMEOUT_MS,
          );

          const plannedMatches = splitNonEmptyLines(result.stdout.trim())
            .map((line) => prefixFastPathMatch(line, plan.outputPrefix))
            .filter((match) => !plan.filterPattern || matchesGlob(match, plan.filterPattern));
          matches.push(...plannedMatches);
        } catch (error) {
          const err = error as NodeJS.ErrnoException & {
            stdout?: string;
            stderr?: string;
            code?: number | string;
          };

          if (String(err.code) === "1") {
            continue;
          }

          throw err;
        }
      }

      const uniqueMatches = [...new Set(matches)];
      const rawOutput = uniqueMatches.join("\n");
      const metadata = searchToolMetadata("glob", {
        path: searchRoot,
        strategy: "fd",
        count: uniqueMatches.length,
        ...globTruncationMetadata(uniqueMatches, verbosity),
        ...(uniqueMatches.length === 0 ? { noMatches: true } : {}),
        verbosity,
      });
      return toSuccessResult(formatGlobOutput(rawOutput, uniqueMatches, verbosity), metadata);
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };

      const message =
        [err.stderr, err.stdout].filter(Boolean).join("").trim() ||
        err.message ||
        "fd execution failed";
      return toErrorResult(message, searchToolMetadata("glob", {
        path: searchRoot,
        strategy: "fd",
      }));
    }
  }

  private async executeFallback(
    searchRoot: string,
    pattern: string,
    verbosity: ToolOutputVerbosity,
    sandbox?: unknown,
  ): Promise<ToolResult> {
    const files = await walkFiles(searchRoot);
    const matches: string[] = [];

    for (const filePath of files) {
      const readError = validateReadPath(filePath, sandbox);
      if (readError) {
        continue;
      }

      const relativePath = normalizePath(relative(searchRoot, filePath) || basename(filePath));
      if (matchesGlob(relativePath, pattern)) {
        matches.push(relativePath);
      }
    }

    const rawOutput = matches.join("\n");
    return toSuccessResult(formatGlobOutput(rawOutput, matches, verbosity), searchToolMetadata("glob", {
      path: searchRoot,
      strategy: "fallback",
      count: matches.length,
      ...globTruncationMetadata(matches, verbosity),
      verbosity,
    }));
  }
}

function formatGlobOutput(
  rawOutput: string,
  matches: readonly string[],
  verbosity: ToolOutputVerbosity,
): string {
  if (verbosity === "structured") {
    return JSON.stringify({
      matches,
      count: matches.length,
    }, null, 2);
  }

  if (verbosity === "summary") {
    const sample = matches.slice(0, SUMMARY_MATCH_LIMIT);
    if (sample.length === 0) {
      return `${matches.length} ${pluralize(matches.length, "match", "matches")}`;
    }
    const suffix = matches.length > sample.length
      ? `\n[glob summary truncated: showing ${sample.length} of ${matches.length} matches]`
      : "";
    return `${matches.length} ${pluralize(matches.length, "match", "matches")}:\n${sample.join("\n")}${suffix}`;
  }

  if (matches.length > RAW_MATCH_LIMIT) {
    const sample = matches.slice(0, RAW_MATCH_LIMIT);
    return [
      sample.join("\n"),
      `[glob raw output truncated: showing ${sample.length} of ${matches.length} matches. Narrow the path or pattern, then read concrete files before using this as evidence.]`,
    ].join("\n");
  }

  return rawOutput;
}

function globTruncationMetadata(
  matches: readonly string[],
  verbosity: ToolOutputVerbosity,
): Record<string, unknown> {
  const visibleMatches = verbosity === "summary"
    ? SUMMARY_MATCH_LIMIT
    : verbosity === "raw"
      ? RAW_MATCH_LIMIT
      : undefined;
  if (visibleMatches === undefined || matches.length <= visibleMatches) {
    return {};
  }
  return {
    truncated: true,
    visibleMatches,
  };
}

interface FastPathGlobPlan {
  readonly cwd: string;
  readonly pattern: string;
  readonly outputPrefix: string;
  readonly filterPattern?: string;
}

function planFastPathGlob(searchRoot: string, pattern: string): FastPathGlobPlan {
  const normalizedPattern = normalizePath(pattern);
  const firstGlobIndex = firstGlobTokenIndex(normalizedPattern);
  let plan: FastPathGlobPlan;
  if (firstGlobIndex < 0) {
    const slashIndex = normalizedPattern.lastIndexOf("/");
    if (slashIndex < 0) {
      return { cwd: searchRoot, pattern: normalizedPattern, outputPrefix: "" };
    }
    return {
      cwd: join(searchRoot, ...normalizedPattern.slice(0, slashIndex).split("/")),
      pattern: normalizedPattern.slice(slashIndex + 1),
      outputPrefix: normalizedPattern.slice(0, slashIndex),
    };
  }

  const slashIndex = normalizedPattern.lastIndexOf("/", firstGlobIndex);
  if (slashIndex < 0) {
    return withFdCandidateFiltering(
      { cwd: searchRoot, pattern: normalizedPattern, outputPrefix: "" },
      normalizedPattern,
    );
  }

  const outputPrefix = normalizedPattern.slice(0, slashIndex);
  plan = {
    cwd: join(searchRoot, ...outputPrefix.split("/")),
    pattern: normalizedPattern.slice(slashIndex + 1),
    outputPrefix,
  };
  return withFdCandidateFiltering(plan, normalizedPattern);
}

function firstGlobTokenIndex(pattern: string): number {
  const indexes = ["*", "?", "["]
    .map((token) => pattern.indexOf(token))
    .filter((index) => index >= 0);
  return indexes.length === 0 ? -1 : Math.min(...indexes);
}

function prefixFastPathMatch(match: string, outputPrefix: string): string {
  const normalized = normalizePath(match).replace(/^\.\//, "");
  if (!outputPrefix) {
    return normalized;
  }
  return `${outputPrefix}/${normalized}`;
}

function withFdCandidateFiltering(plan: FastPathGlobPlan, normalizedPattern: string): FastPathGlobPlan {
  if (!requiresFdPathPostFilter(plan.pattern)) {
    return plan;
  }

  return {
    ...plan,
    pattern: fdCandidatePattern(plan.pattern),
    filterPattern: normalizedPattern,
  };
}

function requiresFdPathPostFilter(plannedPattern: string): boolean {
  const normalizedPattern = normalizePath(plannedPattern);
  return normalizedPattern.includes("/") && !normalizedPattern.startsWith("**/");
}

function fdCandidatePattern(plannedPattern: string): string {
  const segments = normalizePath(plannedPattern).split("/").filter(Boolean);
  return segments.at(-1) ?? plannedPattern;
}
