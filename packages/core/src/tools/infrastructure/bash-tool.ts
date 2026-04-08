import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import {
  getSandboxContext,
  optionalNumber,
  optionalString,
  requireString,
  resolvePath,
  toErrorResult,
  toSuccessResult,
  validateCommand,
  validateReadPath,
} from "./tool-helpers.js";

const execFile = promisify(execFileCallback);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 2 * 1024 * 1024;

type BashCommandResult = {
  readonly stdout: string;
  readonly stderr: string;
};

type BashCommandRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<BashCommandResult>;

export interface BashToolOptions {
  readonly commandRunner?: BashCommandRunner;
}

export class BashTool implements DevTool {
  readonly name = "bash";
  readonly description = TOOL_SCHEMAS.bash.description;
  readonly inputSchema = TOOL_SCHEMAS.bash.inputSchema;
  readonly annotations = TOOL_SCHEMAS.bash.annotations;

  private readonly commandRunner: BashCommandRunner;

  constructor(options: BashToolOptions = {}) {
    this.commandRunner = options.commandRunner ?? runBashCommand;
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const commandInput = requireString(input, "command");
    if (!commandInput.ok) {
      return commandInput.result;
    }

    const timeoutInput = parseTimeout(input);
    if (!timeoutInput.ok) {
      return toErrorResult(timeoutInput.message);
    }

    const sandboxContext = getSandboxContext(sandbox);
    const cwd = resolvePath(optionalString(input, "cwd") ?? sandboxContext?.cwd ?? process.cwd(), sandbox);

    // Validate cwd is within sandbox boundaries (read access implies path containment)
    const cwdError = validateReadPath(cwd, sandbox);
    if (cwdError) {
      return toErrorResult(cwdError, { cwd });
    }

    const commandError = validateCommand(commandInput.value, cwd, sandbox);
    if (commandError) {
      return toErrorResult(commandError, { cwd, command: commandInput.value });
    }

    try {
      const result = await this.commandRunner(commandInput.value, cwd, timeoutInput.value);
      const output = [result.stdout, result.stderr].filter(Boolean).join("").trim();
      return toSuccessResult(output, {
        cwd,
        command: commandInput.value,
        timeoutMs: timeoutInput.value,
      });
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
        "bash command failed";

      return toErrorResult(message, {
        cwd,
        command: commandInput.value,
        timeoutMs: timeoutInput.value,
        code: err.code,
        signal: err.signal,
      });
    }
  }
}

function parseTimeout(input: ToolInput): { ok: true; value: number } | { ok: false; message: string } {
  const timeout = optionalNumber(input, "timeout");
  if (timeout === undefined) {
    if (input.input["timeout"] !== undefined) {
      return { ok: false, message: 'Invalid input: "timeout" must be a finite number' };
    }

    return { ok: true, value: DEFAULT_TIMEOUT_MS };
  }

  if (timeout <= 0) {
    return { ok: false, message: 'Invalid input: "timeout" must be > 0' };
  }

  return { ok: true, value: Math.min(timeout, MAX_TIMEOUT_MS) };
}

async function runBashCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<BashCommandResult> {
  const { stdout, stderr } = await execFile("bash", ["-c", command], {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
  });

  return { stdout, stderr };
}
