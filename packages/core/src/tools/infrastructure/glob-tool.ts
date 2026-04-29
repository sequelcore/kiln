import { basename, relative } from "node:path";
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
  readonly annotations = TOOL_SCHEMAS.glob.annotations;

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
        return await this.executeFastPath(fdPath, searchRoot, patternInput.value);
      }

      return await this.executeFallback(searchRoot, patternInput.value, sandbox);
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
  ): Promise<ToolResult> {
    const args = ["--glob", "--type", "f", pattern, "."];
    try {
      const result = await this.commandRunner(
        fdPath,
        args,
        searchRoot,
        DEFAULT_TIMEOUT_MS,
      );

      return toSuccessResult(result.stdout.trim(), searchToolMetadata("glob", {
        path: searchRoot,
        strategy: "fd",
      }));
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };

      if (String(err.code) === "1") {
        return toSuccessResult("", searchToolMetadata("glob", {
          path: searchRoot,
          strategy: "fd",
          noMatches: true,
        }));
      }

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

    return toSuccessResult(matches.join("\n"), searchToolMetadata("glob", {
      path: searchRoot,
      strategy: "fallback",
      count: matches.length,
    }));
  }
}
