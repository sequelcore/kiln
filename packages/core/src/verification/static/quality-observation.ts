import { normalizeFormalProofSubjects } from "../../work-governance/formal-proof-subjects.js";

export const QUALITY_ANALYSIS_OBSERVATION_SCHEMA = "kiln.quality-analysis-observation/v1" as const;
export const TYPESCRIPT_QUALITY_ARTIFACT = "typescript" as const;
export const TYPE_INTEGRITY_PROFILE = "type-integrity" as const;
export const TYPE_INTEGRITY_PROFILE_REVISION = "v1" as const;
export const TYPE_INTEGRITY_RULES = [
  { name: "chained-type-assertion", revision: "v1" },
  { name: "widen-then-assert", revision: "v1" },
] as const;

export type QualityProfileName = typeof TYPE_INTEGRITY_PROFILE;
export type QualityRuleName = (typeof TYPE_INTEGRITY_RULES)[number]["name"];
export interface QualityAnalysisDiagnostic {
  readonly rule: { readonly name: QualityRuleName; readonly revision: "v1" };
  readonly message: string;
  readonly line: number;
  readonly column: number;
}
export interface QualityAnalysisProfileObservation {
  readonly name: QualityProfileName;
  readonly revision: typeof TYPE_INTEGRITY_PROFILE_REVISION;
  readonly rules: typeof TYPE_INTEGRITY_RULES;
  readonly diagnostics: readonly QualityAnalysisDiagnostic[];
}
export interface QualityAnalysisObservation {
  readonly schema: typeof QUALITY_ANALYSIS_OBSERVATION_SCHEMA;
  readonly toolName: "quality_analyze";
  readonly kind: "static_quality_analysis";
  readonly analyzer: {
    readonly name: "kiln-quality";
    readonly version: string;
    readonly parser: { readonly name: "@typescript/typescript6"; readonly version: string };
  };
  readonly artifact: {
    readonly kind: typeof TYPESCRIPT_QUALITY_ARTIFACT;
    readonly path: string;
    readonly contentDigest: string;
  };
  readonly outcome: "no_diagnostics" | "diagnostics";
  readonly profiles: readonly QualityAnalysisProfileObservation[];
  readonly establishes: readonly [];
}

export function qualityAnalysisObservation(
  value: Omit<QualityAnalysisObservation, "schema" | "toolName" | "kind" | "establishes">,
): QualityAnalysisObservation {
  return parseQualityAnalysisObservation({
    schema: QUALITY_ANALYSIS_OBSERVATION_SCHEMA,
    toolName: "quality_analyze",
    kind: "static_quality_analysis",
    establishes: [],
    ...value,
  });
}

export function parseQualityAnalysisObservation(value: unknown): QualityAnalysisObservation {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schema", "toolName", "kind", "analyzer", "artifact", "outcome", "profiles", "establishes"])
  )
    throw new Error("quality analysis observation has an invalid shape or extra field");
  if (
    value.schema !== QUALITY_ANALYSIS_OBSERVATION_SCHEMA ||
    value.toolName !== "quality_analyze" ||
    value.kind !== "static_quality_analysis"
  )
    throw new Error("quality analysis observation identity is invalid");
  if (
    !isRecord(value.analyzer) ||
    !hasOnlyKeys(value.analyzer, ["name", "version", "parser"]) ||
    value.analyzer.name !== "kiln-quality" ||
    !isNonEmptyString(value.analyzer.version)
  )
    throw new Error("quality analyzer identity is invalid");
  if (
    !isRecord(value.analyzer.parser) ||
    !hasOnlyKeys(value.analyzer.parser, ["name", "version"]) ||
    value.analyzer.parser.name !== "@typescript/typescript6" ||
    !isNonEmptyString(value.analyzer.parser.version)
  )
    throw new Error("quality parser identity is invalid");
  if (
    !isRecord(value.artifact) ||
    !hasOnlyKeys(value.artifact, ["kind", "path", "contentDigest"]) ||
    value.artifact.kind !== TYPESCRIPT_QUALITY_ARTIFACT ||
    typeof value.artifact.path !== "string" ||
    typeof value.artifact.contentDigest !== "string"
  )
    throw new Error("quality artifact is invalid");
  const [artifact] = normalizeFormalProofSubjects([
    { path: value.artifact.path, contentDigest: value.artifact.contentDigest },
  ]);
  if (!artifact) throw new Error("quality artifact is required");
  if (!Array.isArray(value.profiles) || value.profiles.length !== 1)
    throw new Error("quality analysis must contain exactly one configured profile");
  const profiles = value.profiles.map(parseProfile);
  const diagnosticCount = profiles.reduce((count, profile) => count + profile.diagnostics.length, 0);
  if (value.outcome !== "no_diagnostics" && value.outcome !== "diagnostics")
    throw new Error("quality analysis outcome is invalid");
  if ((value.outcome === "no_diagnostics") !== (diagnosticCount === 0))
    throw new Error("quality analysis outcome must agree with diagnostics");
  if (!Array.isArray(value.establishes) || value.establishes.length !== 0)
    throw new Error("quality analysis establishes must be empty");
  return Object.freeze({
    schema: QUALITY_ANALYSIS_OBSERVATION_SCHEMA,
    toolName: "quality_analyze",
    kind: "static_quality_analysis",
    analyzer: Object.freeze({
      name: "kiln-quality",
      version: value.analyzer.version,
      parser: Object.freeze({ name: "@typescript/typescript6", version: value.analyzer.parser.version }),
    }),
    artifact: Object.freeze({
      kind: TYPESCRIPT_QUALITY_ARTIFACT,
      path: artifact.path,
      contentDigest: artifact.contentDigest,
    }),
    outcome: value.outcome,
    profiles: Object.freeze(profiles),
    establishes: Object.freeze([]) as readonly [],
  });
}

function parseProfile(value: unknown): QualityAnalysisProfileObservation {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["name", "revision", "rules", "diagnostics"]) ||
    value.name !== TYPE_INTEGRITY_PROFILE ||
    value.revision !== TYPE_INTEGRITY_PROFILE_REVISION
  )
    throw new Error("quality profile identity is invalid");
  if (!Array.isArray(value.rules) || JSON.stringify(value.rules) !== JSON.stringify(TYPE_INTEGRITY_RULES))
    throw new Error("quality profile rules are incomplete or out of order");
  if (!Array.isArray(value.diagnostics) || value.diagnostics.length > 1_000)
    throw new Error("quality diagnostics must contain at most 1000 entries");
  const diagnostics = value.diagnostics.map((entry) => {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["rule", "message", "line", "column"]) ||
      !isRecord(entry.rule) ||
      !hasOnlyKeys(entry.rule, ["name", "revision"])
    )
      throw new Error("quality diagnostic has an invalid shape");
    const rawRule = entry.rule;
    if (
      !TYPE_INTEGRITY_RULES.some((rule) => rule.name === rawRule.name && rule.revision === rawRule.revision) ||
      !isNonEmptyString(entry.message) ||
      entry.message.length > 4_000 ||
      !isPositiveInteger(entry.line) ||
      !isPositiveInteger(entry.column)
    )
      throw new Error("quality diagnostic is invalid");
    return Object.freeze({
      rule: Object.freeze({ name: rawRule.name as QualityRuleName, revision: "v1" as const }),
      message: entry.message,
      line: entry.line,
      column: entry.column,
    });
  });
  return Object.freeze({
    name: TYPE_INTEGRITY_PROFILE,
    revision: TYPE_INTEGRITY_PROFILE_REVISION,
    rules: TYPE_INTEGRITY_RULES,
    diagnostics: Object.freeze(diagnostics),
  });
}

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => required.includes(key));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
