import { readFile, stat } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import {
  detectToolEnvironment,
  type ToolEnvironment,
} from "../domain/tool-environment.js";
import { searchToolMetadata } from "../domain/tool-result-metadata.js";
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
} from "./tool-helpers.js";

const DEFAULT_TIMEOUT_MS = 30_000;

type GrepOutputMode = "content" | "files_with_matches" | "count";

type GrepCommandRunner = (
  binary: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) => Promise<CommandResult>;

type EnvironmentProvider = () => Promise<ToolEnvironment>;

interface GrepSearchTarget {
  readonly path: string;
  readonly root: string;
  readonly rgTarget: string;
  readonly filePath?: string;
}

export interface GrepToolOptions {
  readonly commandRunner?: GrepCommandRunner;
  readonly environmentProvider?: EnvironmentProvider;
}

export class GrepTool implements DevTool {
  readonly name = "grep";
  readonly description = TOOL_SCHEMAS.grep.description;
  readonly inputSchema = TOOL_SCHEMAS.grep.inputSchema;
  readonly annotations = TOOL_SCHEMAS.grep.annotations;

  private readonly commandRunner: GrepCommandRunner;
  private readonly environmentProvider: EnvironmentProvider;

  constructor(options: GrepToolOptions = {}) {
    this.commandRunner = options.commandRunner ?? defaultRunCommand;
    this.environmentProvider = options.environmentProvider ?? detectToolEnvironment;
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const patternInput = requireString(input, "pattern");
    if (!patternInput.ok) {
      return patternInput.result;
    }

    const sandboxContext = getSandboxContext(sandbox);
    const searchPath = resolvePath(
      optionalString(input,"path") ?? sandboxContext?.cwd ?? process.cwd(),
      sandbox,
    );
    const rootReadError = validateReadPath(searchPath, sandbox);
    if (rootReadError) {
      return toErrorResult(rootReadError, searchToolMetadata("grep", {
        path: searchPath,
      }));
    }

    const globFilter = optionalString(input,"glob");
    const modeValue = optionalString(input,"outputMode");
    const outputMode = isGrepOutputMode(modeValue) ? modeValue : "content";

    try {
      const searchTarget = await resolveSearchTarget(searchPath);
      const environment = await this.environmentProvider();
      const rgPath = environment.rg?.path;

      if (rgPath) {
        return await this.executeFastPath(
          rgPath,
          searchTarget,
          patternInput.value,
          globFilter,
          outputMode,
        );
      }

      return await this.executeFallback(
        searchTarget,
        patternInput.value,
        globFilter,
        outputMode,
        sandbox,
      );
    } catch (error) {
      const err = error as Error;
      return toErrorResult(err.message, searchToolMetadata("grep", {
        path: searchPath,
      }));
    }
  }

  private async executeFastPath(
    rgPath: string,
    searchTarget: GrepSearchTarget,
    pattern: string,
    globFilter: string | undefined,
    outputMode: GrepOutputMode,
  ): Promise<ToolResult> {
    const args = buildFastPathArgs(pattern, globFilter, outputMode, searchTarget.rgTarget);

    try {
      const result = await this.commandRunner(
        rgPath,
        args,
        searchTarget.root,
        DEFAULT_TIMEOUT_MS,
      );

      return toSuccessResult(result.stdout.trim(), searchToolMetadata("grep", {
        path: searchTarget.path,
        strategy: "rg",
        outputMode,
      }));
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };

      if (String(err.code) === "1") {
        return toSuccessResult("", searchToolMetadata("grep", {
          path: searchTarget.path,
          strategy: "rg",
          outputMode,
          noMatches: true,
        }));
      }

      const message =
        [err.stderr, err.stdout].filter(Boolean).join("").trim() ||
        err.message ||
        "rg execution failed";

      return toErrorResult(message, searchToolMetadata("grep", {
        path: searchTarget.path,
        strategy: "rg",
      }));
    }
  }

  private async executeFallback(
    searchTarget: GrepSearchTarget,
    pattern: string,
    globFilter: string | undefined,
    outputMode: GrepOutputMode,
    sandbox?: unknown,
  ): Promise<ToolResult> {
    let expression: RegExp;
    try {
      expression = new RegExp(pattern);
    } catch {
      return toErrorResult("Invalid input: \"pattern\" must be a valid regular expression");
    }

    const files = searchTarget.filePath ? [searchTarget.filePath] : await walkFiles(searchTarget.root);
    const resultsContent: string[] = [];
    const resultsFiles: string[] = [];
    const resultsCount: string[] = [];

    for (const filePath of files) {
      const readError = validateReadPath(filePath, sandbox);
      if (readError) {
        continue;
      }

      const relativePath = normalizePath(relative(searchTarget.root, filePath) || basename(filePath));
      if (globFilter && !matchesGlob(relativePath, globFilter)) {
        continue;
      }

      const content = await readFile(filePath, "utf8");
      const lines = content.split(/\r?\n/);

      let matchedLines = 0;
      for (let index = 0; index < lines.length; index++) {
        if (expression.test(lines[index] ?? "")) {
          matchedLines += 1;

          if (outputMode === "content") {
            resultsContent.push(`${relativePath}:${index + 1}:${lines[index] ?? ""}`);
          }
        }
      }

      if (matchedLines > 0) {
        if (outputMode === "files_with_matches") {
          resultsFiles.push(relativePath);
        } else if (outputMode === "count") {
          resultsCount.push(`${relativePath}:${matchedLines}`);
        }
      }
    }

    const output =
      outputMode === "content"
        ? resultsContent.join("\n")
        : outputMode === "files_with_matches"
          ? resultsFiles.join("\n")
          : resultsCount.join("\n");

    return toSuccessResult(output, searchToolMetadata("grep", {
      path: searchTarget.path,
      strategy: "fallback",
      outputMode,
    }));
  }
}

function isGrepOutputMode(value: string | undefined): value is GrepOutputMode {
  return value === "content" || value === "files_with_matches" || value === "count";
}

function buildFastPathArgs(
  pattern: string,
  globFilter: string | undefined,
  outputMode: GrepOutputMode,
  target: string,
): string[] {
  const args: string[] = ["--no-heading", "--line-number"];
  if (globFilter) {
    args.push("--glob", globFilter);
  }

  if (outputMode === "files_with_matches") {
    args.push("--files-with-matches");
  } else if (outputMode === "count") {
    args.push("--count");
  }

  args.push(pattern, target);
  return args;
}

async function resolveSearchTarget(searchPath: string): Promise<GrepSearchTarget> {
  const stats = await stat(searchPath);
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
      filePath: searchPath,
    };
  }

  throw new Error("Invalid input: \"path\" must be a file or directory");
}
