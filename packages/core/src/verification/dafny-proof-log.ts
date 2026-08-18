/**
 * Parser for Dafny's structured verification log.
 *
 * Dafny reports per-symbol results through `--log-format csv`, one row per
 * proof effort, and failure detail through `--json-output`, one JSON object per
 * line. Both are machine-readable; neither is scraped from human-facing text.
 *
 * This module is pure. Running the verifier is an infrastructure concern, and
 * mapping a symbol to the acceptance criterion it discharges is the caller's,
 * because only the caller knows what the proof was requested for.
 */

/** Dafny's own outcome vocabulary, preserved rather than reinterpreted here. */
export type DafnyProofOutcome = "passed" | "failed" | "inconclusive";

/**
 * One proof effort. Dafny splits each symbol into a well-formedness check and a
 * correctness check; `correctness` is the one that discharges an `ensures`
 * clause, so it is the effort that maps to a declared obligation.
 */
export interface DafnyProofEffort {
  readonly symbol: string;
  readonly check: string;
  readonly outcome: DafnyProofOutcome;
  readonly durationMs: number;
  readonly resourceCount: number;
}

/** A verifier diagnostic, located at the source position that failed. */
export interface DafnyProofDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly character: number;
  readonly message: string;
  /** Secondary locations, typically the postcondition that could not be proved. */
  readonly related: readonly string[];
}

export interface DafnyProofLog {
  readonly efforts: readonly DafnyProofEffort[];
  readonly diagnostics: readonly DafnyProofDiagnostic[];
}

const CSV_HEADER = "TestResult.DisplayName";
/** `symbol (check)` — Dafny always parenthesizes the effort kind. */
const DISPLAY_NAME = /^(?<symbol>.+?)\s+\((?<check>[^)]+)\)$/u;
/** `hh:mm:ss.fffffff` */
const DURATION = /^(?<h>\d+):(?<m>\d+):(?<s>\d+(?:\.\d+)?)$/u;

/**
 * Parse the CSV verification log. Rows Dafny did not shape as expected are
 * skipped rather than guessed at: a malformed row must not silently become a
 * passing effort.
 */
export function parseDafnyProofEfforts(csv: string): readonly DafnyProofEffort[] {
  const efforts: DafnyProofEffort[] = [];
  for (const line of csv.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith(CSV_HEADER)) continue;
    const cells = splitCsvRow(trimmed);
    if (cells.length < 5) continue;
    const [displayName, outcome, duration, resourceCount] = cells as [string, string, string, string];
    const named = DISPLAY_NAME.exec(displayName);
    if (!named?.groups) continue;
    efforts.push({
      symbol: named.groups["symbol"] ?? "",
      check: named.groups["check"] ?? "",
      outcome: toOutcome(outcome),
      durationMs: toDurationMs(duration),
      resourceCount: Number.parseInt(resourceCount, 10) || 0,
    });
  }
  return efforts;
}

/**
 * Parse the line-delimited JSON diagnostic stream. Non-diagnostic records, such
 * as the trailing status line, are ignored; unparseable lines are skipped so a
 * format change degrades to missing detail rather than a thrown parse error.
 */
export function parseDafnyProofDiagnostics(jsonLines: string): readonly DafnyProofDiagnostic[] {
  const diagnostics: DafnyProofDiagnostic[] = [];
  for (const line of jsonLines.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const diagnostic = toDiagnostic(record);
    if (diagnostic) diagnostics.push(diagnostic);
  }
  return diagnostics;
}

export function parseDafnyProofLog(input: {
  readonly csv: string;
  readonly jsonLines?: string;
}): DafnyProofLog {
  return {
    efforts: parseDafnyProofEfforts(input.csv),
    diagnostics:
      input.jsonLines === undefined ? [] : parseDafnyProofDiagnostics(input.jsonLines),
  };
}

/**
 * Correctness efforts for one symbol. These discharge its `ensures` clauses;
 * well-formedness efforts prove the specification is meaningful, not that the
 * implementation satisfies it.
 */
export function correctnessEfforts(log: DafnyProofLog): readonly DafnyProofEffort[] {
  return log.efforts.filter((effort) => effort.check === "correctness");
}

function toDiagnostic(record: unknown): DafnyProofDiagnostic | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const envelope = record as { type?: unknown; value?: unknown };
  if (envelope.type !== "diagnostic" || typeof envelope.value !== "object" || envelope.value === null) {
    return undefined;
  }
  const value = envelope.value as {
    location?: { filename?: unknown; range?: { start?: { line?: unknown; character?: unknown } } };
    defaultFormatMessage?: unknown;
    relatedInformation?: unknown;
  };
  const start = value.location?.range?.start;
  return {
    file: typeof value.location?.filename === "string" ? value.location.filename : "",
    line: typeof start?.line === "number" ? start.line : 0,
    character: typeof start?.character === "number" ? start.character : 0,
    message: typeof value.defaultFormatMessage === "string" ? value.defaultFormatMessage : "",
    related: Array.isArray(value.relatedInformation)
      ? value.relatedInformation
          .map((entry) =>
            typeof (entry as { defaultFormatMessage?: unknown })?.defaultFormatMessage === "string"
              ? ((entry as { defaultFormatMessage: string }).defaultFormatMessage)
              : "",
          )
          .filter((message) => message.length > 0)
      : [],
  };
}

function toOutcome(value: string): DafnyProofOutcome {
  const normalized = value.trim().toLowerCase();
  if (normalized === "passed") return "passed";
  if (normalized === "failed") return "failed";
  return "inconclusive";
}

function toDurationMs(value: string): number {
  const match = DURATION.exec(value.trim());
  if (!match?.groups) return 0;
  const hours = Number.parseInt(match.groups["h"] ?? "0", 10);
  const minutes = Number.parseInt(match.groups["m"] ?? "0", 10);
  const seconds = Number.parseFloat(match.groups["s"] ?? "0");
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function splitCsvRow(row: string): readonly string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === '"') {
      if (quoted && row[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}
