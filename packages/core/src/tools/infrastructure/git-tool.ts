import { commandToolMetadata } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import {
  getSandboxContext,
  resolvePath,
  requireString,
  toErrorResult,
  toSuccessResult,
  validateCommand,
  validateReadPath,
} from "./tool-helpers.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "blame",
  "branch",
  "config",
  "diff",
  "grep",
  "log",
  "ls-files",
  "rev-list",
  "rev-parse",
  "shortlog",
  "show",
  "show-ref",
  "status",
  "tag",
]);
const DENIED_GIT_ARGS = new Set([
  "-d",
  "-D",
  "-m",
  "-M",
  "--delete",
  "--force",
  "--move",
  "--unset",
  "--unset-all",
]);

type GitCommandResult = {
  readonly stdout: string;
  readonly stderr: string;
};

export type GitCommandRunner = (
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) => Promise<GitCommandResult>;

export interface GitToolOptions {
  readonly commandRunner?: GitCommandRunner;
  readonly defaultCwd?: string;
}

export class GitTool implements DevTool {
  readonly name = "git";
  readonly description = TOOL_SCHEMAS.git.description;
  readonly inputSchema = TOOL_SCHEMAS.git.inputSchema;

  private readonly commandRunner: GitCommandRunner;
  private readonly defaultCwd: string;

  constructor(options: GitToolOptions = {}) {
    this.commandRunner = options.commandRunner ?? unavailableGitCommandRunner;
    this.defaultCwd = options.defaultCwd ?? ".";
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const subcommandInput = requireString(input, "subcommand");
    if (!subcommandInput.ok) {
      return subcommandInput.result;
    }

    const argsInput = readArgs(input);
    if (!argsInput.ok) {
      return toErrorResult(argsInput.message);
    }
    const readonlyError = validateReadOnlyGitCommand(subcommandInput.value, argsInput.value);
    if (readonlyError) {
      return toErrorResult(readonlyError);
    }

    const sandboxContext = getSandboxContext(sandbox);
    const cwd = resolvePath(sandboxContext?.cwd ?? this.defaultCwd, sandbox);
    const commandString = toCommandString(subcommandInput.value, argsInput.value);

    const cwdError = validateReadPath(cwd, sandbox);
    if (cwdError) {
      return toErrorResult(cwdError, commandToolMetadata("git", {
        cwd,
        command: commandString,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      }));
    }

    const commandError = validateCommand(commandString, cwd, sandbox);
    if (commandError) {
      return toErrorResult(commandError, commandToolMetadata("git", {
        cwd,
        command: commandString,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      }));
    }

    const allArgs = [subcommandInput.value, ...argsInput.value];

    try {
      const result = await this.commandRunner(allArgs, cwd, DEFAULT_TIMEOUT_MS);
      const output = [result.stdout, result.stderr].filter(Boolean).join("").trim();
      return toSuccessResult(output, commandToolMetadata("git", {
        cwd,
        command: commandString,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      }));
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        signal?: NodeJS.Signals;
      };

      const message =
        [err.stderr, err.stdout].filter(Boolean).join("").trim() ||
        err.message ||
        "git command failed";

      return toErrorResult(message, commandToolMetadata("git", {
        cwd,
        command: commandString,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        code: err.code,
        signal: err.signal,
      }));
    }
  }
}

function validateReadOnlyGitCommand(subcommand: string, args: readonly string[]): string | undefined {
  const normalizedSubcommand = subcommand.trim().toLowerCase();
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(normalizedSubcommand)) {
    return `Invalid input: git tool only supports read-only git inspection subcommands; '${subcommand}' is denied.`;
  }

  if (
    (normalizedSubcommand === "branch" || normalizedSubcommand === "tag" || normalizedSubcommand === "config")
    && args.some((arg) => DENIED_GIT_ARGS.has(arg))
  ) {
    return `Invalid input: git ${normalizedSubcommand} arguments must be read-only; mutating flags are denied.`;
  }

  return undefined;
}

function readArgs(input: ToolInput): { ok: true; value: string[] } | { ok: false; message: string } {
  const rawArgs = input.input["args"];
  if (rawArgs === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(rawArgs) || rawArgs.some((value) => typeof value !== "string")) {
    return { ok: false, message: "Invalid input: \"args\" must be an array of strings" };
  }

  return { ok: true, value: [...rawArgs] };
}

function toCommandString(subcommand: string, args: readonly string[]): string {
  if (args.length === 0) {
    return `git ${subcommand}`;
  }

  return `git ${subcommand} ${args.join(" ")}`;
}

const unavailableGitCommandRunner: GitCommandRunner = async () => {
  throw new Error("Git execution requires a Runtime-owned command runner");
};
