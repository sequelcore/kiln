import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  detectToolEnvironment,
  type ToolEnvironment,
} from "../domain/tool-environment.js";
import { commandToolMetadata } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import {
  getSandboxContext,
  optionalNumber,
  optionalString,
  requireString,
  resolvePath,
  toErrorResult,
  validateCommand,
  validateReadPath,
} from "./tool-helpers.js";
import { parseOutputVerbosity } from "./output-verbosity.js";

const execFile = promisify(execFileCallback);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 2 * 1024 * 1024;
const METADATA_STREAM_PREVIEW_BYTES = 8 * 1024;

type BashCommandResult = {
  readonly stdout: string;
  readonly stderr: string;
};

type BashCommandRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<BashCommandResult>;

type BashProcessRunner = (
  executable: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) => Promise<BashCommandResult>;

type EnvironmentProvider = () => Promise<ToolEnvironment>;

export interface BashToolOptions {
  readonly commandRunner?: BashCommandRunner;
  readonly processRunner?: BashProcessRunner;
  readonly environmentProvider?: EnvironmentProvider;
  readonly platform?: NodeJS.Platform;
}

export class BashTool implements DevTool {
  readonly name = "bash";
  readonly description = TOOL_SCHEMAS.bash.description;
  readonly inputSchema = TOOL_SCHEMAS.bash.inputSchema;

  private readonly commandRunner?: BashCommandRunner;
  private readonly processRunner: BashProcessRunner;
  private readonly environmentProvider: EnvironmentProvider;
  private readonly platform: NodeJS.Platform;

  constructor(options: BashToolOptions = {}) {
    this.commandRunner = options.commandRunner;
    this.processRunner = options.processRunner ?? runBashProcess;
    this.environmentProvider = options.environmentProvider ?? detectToolEnvironment;
    this.platform = options.platform ?? process.platform;
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
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) {
      return verbosityInput.result;
    }

    const sandboxContext = getSandboxContext(sandbox);
    const cwd = resolvePath(
      normalizeShellCwdForHost(optionalString(input, "cwd") ?? sandboxContext?.cwd ?? process.cwd(), this.platform),
      sandbox,
    );

    // Validate cwd is within sandbox boundaries (read access implies path containment)
    const cwdError = validateReadPath(cwd, sandbox);
    if (cwdError) {
      return toErrorResult(cwdError, commandToolMetadata("bash", {
        cwd,
        command: commandInput.value,
        timeoutMs: timeoutInput.value,
        verbosity: verbosityInput.value,
      }));
    }

    const commandError = validateCommand(commandInput.value, cwd, sandbox);
    if (commandError) {
      return toErrorResult(commandError, commandToolMetadata("bash", {
        cwd,
        command: commandInput.value,
        timeoutMs: timeoutInput.value,
        verbosity: verbosityInput.value,
      }));
    }

    const startedAtMs = Date.now();

    try {
      const result = this.commandRunner
        ? await this.commandRunner(commandInput.value, cwd, timeoutInput.value)
        : await runBashCommand(
          commandInput.value,
          cwd,
          timeoutInput.value,
          this.environmentProvider,
          this.processRunner,
        );
      const durationMs = elapsedDurationMs(startedAtMs);
      const stdout = result.stdout;
      const stderr = result.stderr;
      const output = [stdout, stderr].filter(Boolean).join("").trim();
      const stdoutPreview = clipTextToBytes(stdout, METADATA_STREAM_PREVIEW_BYTES);
      const stderrPreview = clipTextToBytes(stderr, METADATA_STREAM_PREVIEW_BYTES);
      const metadataTruncated = stdoutPreview.truncated || stderrPreview.truncated;
      const metadata = commandToolMetadata("bash", {
        cwd,
        command: commandInput.value,
        timeoutMs: timeoutInput.value,
        stdout: stdoutPreview.text,
        stderr: stderrPreview.text,
        stdoutTruncated: stdoutPreview.truncated,
        stderrTruncated: stderrPreview.truncated,
        stdoutBytes: byteLength(stdout),
        stderrBytes: byteLength(stderr),
        exitCode: 0,
        timedOut: false,
        truncated: metadataTruncated,
        durationMs,
        verbosity: verbosityInput.value,
      });
      return {
        output: formatBashOutput(output, metadata),
        isError: false,
        metadata,
        ...(metadataTruncated || verbosityInput.value !== "raw"
          ? {
            resourcePayload: {
              title: "bash full output",
              mimeType: "text/plain",
              text: output,
            },
          }
          : {}),
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        signal?: NodeJS.Signals;
        killed?: boolean;
      };
      const durationMs = elapsedDurationMs(startedAtMs);
      const stdout = err.stdout ?? "";
      const stderr = err.stderr ?? "";
      const stdoutPreview = clipTextToBytes(stdout, METADATA_STREAM_PREVIEW_BYTES);
      const stderrPreview = clipTextToBytes(stderr, METADATA_STREAM_PREVIEW_BYTES);

      const message =
        [stderr, stdout].filter(Boolean).join("").trim() ||
        err.message ||
        "bash command failed";
      const maxBufferExceeded = isMaxBufferExceeded(err);
      const metadataTruncated = maxBufferExceeded || stdoutPreview.truncated || stderrPreview.truncated;

      const metadata = commandToolMetadata("bash", {
        cwd,
        command: commandInput.value,
        timeoutMs: timeoutInput.value,
        maxBufferBytes: MAX_BUFFER,
        code: err.code,
        signal: err.signal,
        stdout: stdoutPreview.text,
        stderr: stderrPreview.text,
        stdoutTruncated: stdoutPreview.truncated,
        stderrTruncated: stderrPreview.truncated,
        stdoutBytes: byteLength(stdout),
        stderrBytes: byteLength(stderr),
        exitCode: deriveExitCode(err.code),
        timedOut: isTimedOut(err),
        truncated: metadataTruncated,
        durationMs,
        verbosity: verbosityInput.value,
      });
      return {
        output: formatBashOutput(message, metadata),
        isError: true,
        metadata,
        ...(metadataTruncated || verbosityInput.value !== "raw"
          ? {
            resourcePayload: {
              title: "bash full output",
              mimeType: "text/plain",
              text: message,
            },
          }
          : {}),
      };
    }
  }
}

function formatBashOutput(
  rawOutput: string,
  metadata: ReturnType<typeof commandToolMetadata<"bash">>,
): string {
  if (metadata.verbosity === "structured") {
    return JSON.stringify({
      stdout: metadata.stdout ?? "",
      stderr: metadata.stderr ?? "",
      exitCode: metadata.exitCode,
      timedOut: metadata.timedOut ?? false,
      truncated: metadata.truncated ?? false,
      durationMs: metadata.durationMs,
      stdoutBytes: metadata.stdoutBytes ?? 0,
      stderrBytes: metadata.stderrBytes ?? 0,
    }, null, 2);
  }

  if (metadata.verbosity === "summary") {
    const status = metadata.exitCode === 0 ? "succeeded" : "failed";
    return [
      `Command ${status}`,
      `stdout ${metadata.stdoutBytes ?? 0} bytes`,
      `stderr ${metadata.stderrBytes ?? 0} bytes`,
      `duration ${metadata.durationMs ?? 0}ms`,
    ].join("; ");
  }

  return rawOutput;
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
  environmentProvider: EnvironmentProvider,
  processRunner: BashProcessRunner,
): Promise<BashCommandResult> {
  const environment = await environmentProvider();
  const executable = environment.bash?.path;
  if (!executable) {
    throw Object.assign(new Error("bash executable is not available in the detected tool environment"), {
      code: "BASH_NOT_FOUND",
    });
  }

  return await processRunner(executable, ["-c", command], cwd, timeoutMs);
}

async function runBashProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<BashCommandResult> {
  const { stdout, stderr } = await execFile(executable, [...args], {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
  });

  return { stdout, stderr };
}

function normalizeShellCwdForHost(cwd: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return cwd;
  return normalizeWindowsShellPath(cwd);
}

function normalizeWindowsShellPath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  const wslMatch = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(normalized);
  if (wslMatch) {
    return toWindowsDrivePath(wslMatch[1] ?? "", wslMatch[2]);
  }

  const msysMatch = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(normalized);
  if (msysMatch) {
    return toWindowsDrivePath(msysMatch[1] ?? "", msysMatch[2]);
  }

  return pathValue;
}

function toWindowsDrivePath(drive: string, rest: string | undefined): string {
  const suffix = rest && rest.length > 0 ? `\\${rest.replace(/\//g, "\\")}` : "\\";
  return `${drive.toUpperCase()}:` + suffix;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function clipTextToBytes(value: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { text: value, truncated: false };
  }
  return { text: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

function elapsedDurationMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

function deriveExitCode(code: number | string | undefined): number | string | undefined {
  if (typeof code === "number") {
    return code;
  }

  if (typeof code === "string") {
    const numericCode = Number.parseInt(code, 10);
    if (Number.isFinite(numericCode) && `${numericCode}` === code.trim()) {
      return numericCode;
    }

    return code;
  }

  return undefined;
}

function isTimedOut(
  error: NodeJS.ErrnoException & { code?: number | string; signal?: NodeJS.Signals; killed?: boolean },
): boolean {
  if (isMaxBufferExceeded(error)) {
    return false;
  }

  if (error.killed) {
    return true;
  }

  if (typeof error.code === "string") {
    const normalizedCode = error.code.trim().toUpperCase();
    if (normalizedCode === "ETIMEDOUT" || normalizedCode === "TIMEOUT") {
      return true;
    }
  }

  return /timed?\s*out|timeout/i.test(error.message ?? "");
}

function isMaxBufferExceeded(error: NodeJS.ErrnoException & { code?: number | string }): boolean {
  if (typeof error.code === "string" && error.code.trim().toUpperCase() === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return true;
  }

  return /maxBuffer/i.test(error.message ?? "");
}
