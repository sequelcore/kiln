import { normalizeFormalProofSubjects } from "../../work-governance/formal-proof-subjects.js";

export const QUALITY_ANALYSIS_OBSERVATION_SCHEMA = "kiln.quality-analysis-observation/v1" as const;
export const TYPESCRIPT_QUALITY_ARTIFACT = "typescript" as const;
export const TYPE_INTEGRITY_PROFILE = "type-integrity" as const;
export const TYPE_INTEGRITY_PROFILE_REVISION = "v1" as const;
export const TYPE_INTEGRITY_RULES = [
  { name: "chained-type-assertion", revision: "v1" },
  { name: "widen-then-assert", revision: "v1" },
] as const;
export const COMPLEXITY_PROFILE = "complexity" as const;
export const COMPLEXITY_PROFILE_REVISION = "v1" as const;
export const COMPLEXITY_RULES = [{ name: "high-cyclomatic-complexity", revision: "v1" }] as const;
export const TEST_INTEGRITY_PROFILE = "test-integrity" as const;
export const TEST_INTEGRITY_PROFILE_REVISION = "v1" as const;
export const TEST_INTEGRITY_RULES = [
  { name: "focused-test", revision: "v1" },
  { name: "empty-test-body", revision: "v1" },
] as const;
export const QUALITY_PROFILE_ORDER = [TYPE_INTEGRITY_PROFILE, COMPLEXITY_PROFILE, TEST_INTEGRITY_PROFILE] as const;

export type QualityProfileName = (typeof QUALITY_PROFILE_ORDER)[number];
export type QualityRuleName =
  | (typeof TYPE_INTEGRITY_RULES)[number]["name"]
  | (typeof COMPLEXITY_RULES)[number]["name"]
  | (typeof TEST_INTEGRITY_RULES)[number]["name"];
export interface QualityRuleIdentity {
  readonly name: QualityRuleName;
  readonly revision: "v1";
}
export interface QualityAnalysisDiagnostic {
  readonly rule: QualityRuleIdentity;
  readonly message: string;
  readonly line: number;
  readonly column: number;
}
export interface QualityAnalysisProfileObservation {
  readonly name: QualityProfileName;
  readonly revision: "v1";
  readonly rules: readonly QualityRuleIdentity[];
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
  if (
    !Array.isArray(value.profiles) ||
    value.profiles.length < 1 ||
    value.profiles.length > QUALITY_PROFILE_ORDER.length
  )
    throw new Error("quality analysis must contain between one and three configured profiles");
  const profiles = value.profiles.map(parseProfile);
  const profileOrder = profiles.map((profile) => QUALITY_PROFILE_ORDER.indexOf(profile.name));
  if (profileOrder.some((position, index) => index > 0 && position <= profileOrder[index - 1]!))
    throw new Error("quality profiles must be unique and follow canonical order");
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
    !isQualityProfileName(value.name) ||
    value.revision !== "v1"
  )
    throw new Error("quality profile identity is invalid");
  const expectedRules = rulesForProfile(value.name);
  if (!Array.isArray(value.rules) || JSON.stringify(value.rules) !== JSON.stringify(expectedRules))
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
      !expectedRules.some((rule) => rule.name === rawRule.name && rule.revision === rawRule.revision) ||
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
    name: value.name,
    revision: "v1",
    rules: expectedRules,
    diagnostics: Object.freeze(diagnostics),
  });
}

export function rulesForQualityProfile(name: QualityProfileName): readonly QualityRuleIdentity[] {
  return rulesForProfile(name);
}

function rulesForProfile(name: QualityProfileName): readonly QualityRuleIdentity[] {
  if (name === TYPE_INTEGRITY_PROFILE) return TYPE_INTEGRITY_RULES;
  if (name === COMPLEXITY_PROFILE) return COMPLEXITY_RULES;
  return TEST_INTEGRITY_RULES;
}

function isQualityProfileName(value: unknown): value is QualityProfileName {
  return typeof value === "string" && QUALITY_PROFILE_ORDER.some((profile) => profile === value);
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
