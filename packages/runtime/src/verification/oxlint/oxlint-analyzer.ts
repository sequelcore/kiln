import type { CommandProcessResult, CommandProcessRunner } from "@kilnai/core";

const MAX_OUTPUT_CHARACTERS = 2_000_000;
const MAX_DIAGNOSTICS = 1_000;
const MAX_TEXT_CHARACTERS = 4_000;

export const OXLINT_ISOLATED_CONFIG_FILE = ".kiln-oxlint.json" as const;

/**
 * The only configuration admitted to the static producer.
 *
 * Keep this JSON closed and version the profile in the observation contract.
 * Categories are intentionally not used: their membership can change between
 * Oxlint releases, while this profile must name the exact rules it ran.
 */
export const OXLINT_ISOLATED_CONFIG = `{
  "plugins": ["oxc", "typescript", "unicorn"],
  "rules": {
    "constructor-super": "error",
    "for-direction": "error",
    "getter-return": "error",
    "no-async-promise-executor": "error",
    "no-caller": "error",
    "no-class-assign": "error",
    "no-compare-neg-zero": "error",
    "no-cond-assign": "error",
    "no-const-assign": "error",
    "no-constant-binary-expression": "error",
    "no-constant-condition": "error",
    "no-control-regex": "error",
    "no-debugger": "error",
    "no-delete-var": "error",
    "no-dupe-class-members": "error",
    "no-dupe-else-if": "error",
    "no-dupe-keys": "error",
    "no-duplicate-case": "error",
    "no-empty-character-class": "error",
    "no-empty-pattern": "error",
    "no-empty-static-block": "error",
    "no-eval": "error",
    "no-ex-assign": "error",
    "no-extra-boolean-cast": "error",
    "no-func-assign": "error",
    "no-global-assign": "error",
    "no-import-assign": "error",
    "no-invalid-regexp": "error",
    "no-irregular-whitespace": "error",
    "no-iterator": "error",
    "no-loss-of-precision": "error",
    "no-misleading-character-class": "error",
    "no-new-native-nonconstructor": "error",
    "no-nonoctal-decimal-escape": "error",
    "no-obj-calls": "error",
    "no-self-assign": "error",
    "no-setter-return": "error",
    "no-shadow-restricted-names": "error",
    "no-sparse-arrays": "error",
    "no-this-before-super": "error",
    "no-unassigned-vars": "error",
    "no-unreachable": "error",
    "no-unsafe-finally": "error",
    "no-unsafe-negation": "error",
    "no-unsafe-optional-chaining": "error",
    "no-unused-expressions": "error",
    "no-unused-labels": "error",
    "no-unused-private-class-members": "error",
    "no-unused-vars": "error",
    "no-useless-backreference": "error",
    "no-useless-catch": "error",
    "no-useless-escape": "error",
    "no-useless-rename": "error",
    "no-with": "error",
    "require-yield": "error",
    "use-isnan": "error",
    "valid-typeof": "error",
    "max-classes-per-file": ["error", { "max": 1 }],
    "max-depth": ["error", { "max": 4 }],
    "max-lines": ["error", { "max": 500 }],
    "max-lines-per-function": [
      "error",
      { "max": 80, "skipBlankLines": true, "skipComments": true }
    ],
    "max-nested-callbacks": ["error", { "max": 4 }],
    "max-params": ["error", { "max": 4, "countThis": "never" }],
    "max-statements": ["error", { "max": 40 }],
    "oxc/bad-array-method-on-arguments": "error",
    "oxc/bad-char-at-comparison": "error",
    "oxc/bad-comparison-sequence": "error",
    "oxc/bad-match-all-arg": "error",
    "oxc/bad-min-max-func": "error",
    "oxc/bad-object-literal-comparison": "error",
    "oxc/bad-replace-all-arg": "error",
    "oxc/const-comparisons": "error",
    "oxc/double-comparisons": "error",
    "oxc/erasing-op": "error",
    "oxc/missing-throw": "error",
    "oxc/number-arg-out-of-range": "error",
    "oxc/only-used-in-recursion": "error",
    "oxc/uninvoked-array-callback": "error",
    "typescript/ban-ts-comment": [
      "error",
      {
        "minimumDescriptionLength": 3,
        "ts-check": false,
        "ts-expect-error": "allow-with-description",
        "ts-ignore": true,
        "ts-nocheck": true
      }
    ],
    "typescript/no-duplicate-enum-values": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-extra-non-null-assertion": "error",
    "typescript/no-misused-new": "error",
    "typescript/no-this-alias": "error",
    "typescript/no-unsafe-declaration-merging": "error",
    "typescript/no-unnecessary-parameter-property-assignment": "error",
    "typescript/no-useless-empty-export": "error",
    "typescript/no-wrapper-object-types": "error",
    "typescript/prefer-as-const": "error",
    "typescript/prefer-namespace-keyword": "error",
    "typescript/triple-slash-reference": "error",
    "unicorn/max-nested-calls": ["error", { "max": 3 }],
    "unicorn/no-await-in-promise-methods": "error",
    "unicorn/no-empty-file": "error",
    "unicorn/no-invalid-fetch-options": "error",
    "unicorn/no-invalid-remove-event-listener": "error",
    "unicorn/no-new-array": "error",
    "unicorn/no-single-promise-in-promise-methods": "error",
    "unicorn/no-thenable": "error",
    "unicorn/no-unnecessary-await": "error",
    "unicorn/no-useless-fallback-in-spread": "error",
    "unicorn/no-useless-length-check": "error",
    "unicorn/no-useless-spread": "error",
    "unicorn/prefer-set-size": "error",
    "unicorn/prefer-string-starts-ends-with": "error"
  }
}
` as const;

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
            "--report-unused-disable-directives-severity",
            "error",
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
