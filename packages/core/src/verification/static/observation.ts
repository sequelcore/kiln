import { normalizeFormalProofSubjects } from "../../work-governance/formal-proof-subjects.js";

export const STATIC_ANALYSIS_OBSERVATION_SCHEMA = "kiln.static-analysis-observation/v1" as const;
export const STATIC_ANALYSIS_PROFILE = "oxlint.correctness+suspicious/v1" as const;

export type StaticAnalysisOutcome = "clean" | "violations";
export type StaticAnalysisSeverity = "error" | "warning";

export interface StaticAnalysisSubject { readonly path: string; readonly contentDigest: string }
export interface StaticAnalysisDiagnostic {
  readonly rule?: string;
  readonly severity: StaticAnalysisSeverity;
  readonly message: string;
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
}

/** Immutable facts produced by one exact Oxlint engine run. */
export interface StaticAnalysisObservation {
  readonly schema: typeof STATIC_ANALYSIS_OBSERVATION_SCHEMA;
  readonly toolName: "static_analyze";
  readonly kind: "static_analysis";
  readonly analyzer: { readonly name: "oxlint"; readonly version: string };
  readonly profile: { readonly id: typeof STATIC_ANALYSIS_PROFILE; readonly rulesAnalyzed: number };
  readonly outcome: StaticAnalysisOutcome;
  readonly subjects: readonly StaticAnalysisSubject[];
  readonly diagnostics: readonly StaticAnalysisDiagnostic[];
  readonly establishes: readonly [];
}

export function staticAnalysisObservation(value: Omit<StaticAnalysisObservation, "schema" | "toolName" | "kind" | "establishes">): StaticAnalysisObservation {
  return parseStaticAnalysisObservation({ schema: STATIC_ANALYSIS_OBSERVATION_SCHEMA, toolName: "static_analyze", kind: "static_analysis", establishes: [], ...value });
}

export function parseStaticAnalysisObservation(value: unknown): StaticAnalysisObservation {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schema", "toolName", "kind", "analyzer", "profile", "outcome", "subjects", "diagnostics", "establishes"])) throw new Error("static analysis observation has an invalid shape or extra field");
  if (value.schema !== STATIC_ANALYSIS_OBSERVATION_SCHEMA || value.toolName !== "static_analyze" || value.kind !== "static_analysis") throw new Error("static analysis observation identity is invalid");
  if (!isRecord(value.analyzer) || !hasOnlyKeys(value.analyzer, ["name", "version"]) || value.analyzer.name !== "oxlint" || !isNonEmptyString(value.analyzer.version)) throw new Error("static analysis engine identity is invalid");
  if (!isRecord(value.profile) || !hasOnlyKeys(value.profile, ["id", "rulesAnalyzed"]) || value.profile.id !== STATIC_ANALYSIS_PROFILE || !isPositiveInteger(value.profile.rulesAnalyzed)) throw new Error("static analysis profile is invalid");
  if (!Array.isArray(value.subjects) || value.subjects.length !== 1) throw new Error("static analysis observation must contain exactly one subject");
  const rawSubject = value.subjects[0];
  if (!isRecord(rawSubject) || !hasOnlyKeys(rawSubject, ["path", "contentDigest"]) || typeof rawSubject.path !== "string" || typeof rawSubject.contentDigest !== "string") throw new Error("static analysis subject is invalid");
  const subjects = normalizeFormalProofSubjects([{ path: rawSubject.path, contentDigest: rawSubject.contentDigest }]);
  const diagnostics = parseDiagnostics(value.diagnostics, subjects[0]!.path);
  if (value.outcome !== "clean" && value.outcome !== "violations") throw new Error("static analysis outcome is invalid");
  if ((value.outcome === "clean") !== (diagnostics.length === 0)) throw new Error("static analysis outcome must agree with diagnostics");
  if (!Array.isArray(value.establishes) || value.establishes.length !== 0) throw new Error("static analysis observation establishes must be empty");
  return Object.freeze({ schema: STATIC_ANALYSIS_OBSERVATION_SCHEMA, toolName: "static_analyze", kind: "static_analysis", analyzer: Object.freeze({ name: "oxlint", version: value.analyzer.version }), profile: Object.freeze({ id: STATIC_ANALYSIS_PROFILE, rulesAnalyzed: value.profile.rulesAnalyzed }), outcome: value.outcome, subjects: Object.freeze(subjects.map((subject) => Object.freeze(subject))), diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze(diagnostic))), establishes: Object.freeze([]) as readonly [] });
}

export function isStaticAnalysisObservation(value: unknown): value is StaticAnalysisObservation {
  try { parseStaticAnalysisObservation(value); return true; } catch { return false; }
}

function parseDiagnostics(value: unknown, subjectPath: string): readonly StaticAnalysisDiagnostic[] {
  if (!Array.isArray(value) || value.length > 1_000) throw new Error("static analysis diagnostics must contain at most 1000 entries");
  return value.map((entry) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["severity", "message", "file"], ["rule", "line", "column"])) throw new Error("static analysis diagnostic has an invalid shape");
    if ((entry.severity !== "error" && entry.severity !== "warning") || !isNonEmptyString(entry.message) || entry.message.length > 4_000 || entry.file !== subjectPath) throw new Error("static analysis diagnostic is invalid");
    if (entry.rule !== undefined && (!isNonEmptyString(entry.rule) || entry.rule.length > 4_000)) throw new Error("static analysis diagnostic rule is invalid");
    if (entry.line !== undefined && !isPositiveInteger(entry.line)) throw new Error("static analysis diagnostic line is invalid");
    if (entry.column !== undefined && (!isPositiveInteger(entry.column) || entry.line === undefined)) throw new Error("static analysis diagnostic column is invalid");
    return { ...(entry.rule === undefined ? {} : { rule: entry.rule }), severity: entry.severity, message: entry.message, file: entry.file, ...(entry.line === undefined ? {} : { line: entry.line }), ...(entry.column === undefined ? {} : { column: entry.column }) };
  });
}

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean { const keys = Object.keys(value); return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => required.includes(key) || optional.includes(key)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.trim() === value; }
function isPositiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
