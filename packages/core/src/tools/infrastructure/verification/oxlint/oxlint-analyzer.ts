import type { CommandProcessResult, CommandProcessRunner } from "../../command-process.js";

const MAX_OUTPUT_CHARACTERS = 2_000_000;
const MAX_DIAGNOSTICS = 1_000;
const MAX_TEXT_CHARACTERS = 4_000;

export const OXLINT_ISOLATED_CONFIG_FILE = ".kiln-oxlint.json" as const;

export type OxlintAnalysisStatus = "completed" | "timed_out" | "cancelled" | "failed_to_run";
export type OxlintDiagnosticSeverity = "error" | "warning";

export interface OxlintDiagnostic {
  readonly rule?: string;
  readonly severity: OxlintDiagnosticSeverity;
  readonly message: string;
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
}

export interface OxlintAnalysisRun {
  readonly status: OxlintAnalysisStatus;
  readonly diagnostics: readonly OxlintDiagnostic[];
  readonly filesAnalyzed: number;
  readonly rulesAnalyzed: number;
  readonly stderr: string;
  readonly exitCode?: number | string;
  readonly failure?: string;
}

export interface OxlintAnalyzerOptions {
  readonly executable: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
}

export interface OxlintAnalysisRequest {
  readonly file: string;
  readonly signal?: AbortSignal;
}

export class OxlintAnalyzer {
  constructor(
    private readonly runner: CommandProcessRunner,
    private readonly options: OxlintAnalyzerOptions,
  ) {}

  async analyze(request: OxlintAnalysisRequest): Promise<OxlintAnalysisRun> {
    const process = await this.spawn(request);
    const terminalStatus = toTerminalStatus(process.result);
    if (terminalStatus !== undefined) {
      return failedRun(
        terminalStatus,
        process.stderr,
        process.result,
        process.result.error?.message ?? `oxlint run ${terminalStatus}`,
      );
    }
    if (process.overflow) {
      return failedRun(
        "failed_to_run",
        process.stderr,
        process.result,
        `Oxlint JSON output exceeded ${MAX_OUTPUT_CHARACTERS} characters`,
      );
    }

    try {
      const parsed = parseOxlintOutput(process.stdout, request.file);
      return {
        status: "completed",
        diagnostics: parsed.diagnostics,
        filesAnalyzed: parsed.filesAnalyzed,
        rulesAnalyzed: parsed.rulesAnalyzed,
        stderr: process.stderr,
        ...(process.result.exitCode === undefined ? {} : { exitCode: process.result.exitCode }),
      };
    } catch (error) {
      return failedRun(
        "failed_to_run",
        process.stderr,
        process.result,
        `Oxlint JSON result was invalid: ${errorMessage(error)}`,
      );
    }
  }

  private spawn(request: OxlintAnalysisRequest): Promise<{
    readonly stdout: string;
    readonly stderr: string;
    readonly overflow: boolean;
    readonly result: CommandProcessResult;
  }> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let overflow = false;
      this.runner.start(
        {
          executable: this.options.executable,
          args: [
            "--format",
            "json",
            "--config",
            OXLINT_ISOLATED_CONFIG_FILE,
            "--disable-nested-config",
            "--no-ignore",
            "-D",
            "correctness",
            "-D",
            "suspicious",
            request.file,
          ],
          cwd: this.options.cwd,
          ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
        {
          output: (chunk) => {
            if (chunk.stream === "stdout") {
              if (stdout.length + chunk.text.length > MAX_OUTPUT_CHARACTERS) {
                overflow = true;
                return;
              }
              stdout += chunk.text;
              return;
            }
            if (stderr.length < MAX_OUTPUT_CHARACTERS) {
              stderr += chunk.text.slice(0, MAX_OUTPUT_CHARACTERS - stderr.length);
            }
          },
          finish: (result) => resolve({ stdout, stderr, overflow, result }),
        },
      );
    });
  }
}

function parseOxlintOutput(
  output: string,
  requestedFile: string,
): {
  readonly diagnostics: readonly OxlintDiagnostic[];
  readonly filesAnalyzed: number;
  readonly rulesAnalyzed: number;
} {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new Error(`could not parse JSON: ${errorMessage(error)}`);
  }
  if (!isRecord(value)) throw new Error("root must be an object");
  if (value.number_of_files !== 1) throw new Error("Oxlint must analyze exactly one file");
  if (!isPositiveSafeInteger(value.number_of_rules)) {
    throw new Error("Oxlint must report at least one analyzed rule");
  }
  if (!Array.isArray(value.diagnostics) || value.diagnostics.length > MAX_DIAGNOSTICS) {
    throw new Error(`diagnostics must be an array with at most ${MAX_DIAGNOSTICS} entries`);
  }
  const expectedFile = normalizePath(requestedFile);
  const diagnostics = value.diagnostics.map((entry) => parseDiagnostic(entry, expectedFile));
  return {
    diagnostics,
    filesAnalyzed: value.number_of_files,
    rulesAnalyzed: value.number_of_rules,
  };
}

function parseDiagnostic(value: unknown, expectedFile: string): OxlintDiagnostic {
  if (!isRecord(value)) throw new Error("diagnostic must be an object");
  const message = requireBoundedText(value.message, "diagnostic message");
  if (value.severity !== "error" && value.severity !== "warning") {
    throw new Error("diagnostic severity must be error or warning");
  }
  const file = normalizePath(requireBoundedText(value.filename, "diagnostic filename"));
  if (file !== expectedFile) {
    throw new Error(`diagnostic filename ${file} does not match requested file ${expectedFile}`);
  }
  const rule = value.code === undefined ? undefined : requireBoundedText(value.code, "diagnostic rule");
  const location = firstLocation(value.labels);
  return {
    ...(rule === undefined ? {} : { rule }),
    severity: value.severity,
    message,
    file,
    ...(location?.line === undefined ? {} : { line: location.line }),
    ...(location?.column === undefined ? {} : { column: location.column }),
  };
}

function firstLocation(value: unknown): { readonly line?: number; readonly column?: number } | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("diagnostic labels must be an array");
  for (const label of value) {
    if (!isRecord(label) || !isRecord(label.span)) continue;
    const line = label.span.line;
    const column = label.span.column;
    if (line !== undefined && !isPositiveSafeInteger(line)) throw new Error("diagnostic line is invalid");
    if (column !== undefined && !isPositiveSafeInteger(column)) throw new Error("diagnostic column is invalid");
    if (line !== undefined || column !== undefined)
      return {
        ...(line === undefined ? {} : { line }),
        ...(column === undefined ? {} : { column }),
      };
  }
  return undefined;
}

function toTerminalStatus(result: CommandProcessResult): Exclude<OxlintAnalysisStatus, "completed"> | undefined {
  if (result.cancelled) return "cancelled";
  if (result.timedOut) return "timed_out";
  if (result.error || result.signal !== undefined) return "failed_to_run";
  return undefined;
}

function failedRun(
  status: Exclude<OxlintAnalysisStatus, "completed">,
  stderr: string,
  result: CommandProcessResult,
  failure: string,
): OxlintAnalysisRun {
  return {
    status,
    diagnostics: [],
    filesAnalyzed: 0,
    rulesAnalyzed: 0,
    stderr,
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    failure,
  };
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function requireBoundedText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`${name} must be a non-empty trimmed string`);
  }
  if (value.length > MAX_TEXT_CHARACTERS) throw new Error(`${name} is too long`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
