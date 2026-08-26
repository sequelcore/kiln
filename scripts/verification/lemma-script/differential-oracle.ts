/**
 * Pure, fail-closed semantic evidence for the LemmaScript qualification v1
 * fixture. This module deliberately accepts untrusted values at its boundary
 * and returns facts only; it never makes an acceptance or benchmark decision.
 */

export const LEMMA_SCRIPT_QUALIFICATION_V1_SCHEMA = "kiln.lemma-script-qualification-v1" as const;
export const LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION = "accessPolicy" as const;
export const TYPESCRIPT_OBSERVATION_SCHEMA = "kiln.lemma-script-typescript-evaluator/v1" as const;
export const DAFNY_OBSERVATION_SCHEMA = "kiln.lemma-script-dafny-evaluator/v1" as const;

export type AccessDecision = "allow" | "deny";
export type LemmaScriptCaseKey = "false,false" | "false,true" | "true,false" | "true,true";

export const LEMMA_SCRIPT_CASE_KEYS: readonly LemmaScriptCaseKey[] = [
  "false,false",
  "false,true",
  "true,false",
  "true,true",
];

export interface LemmaScriptCaseRow {
  readonly authenticated: boolean;
  readonly canRead: boolean;
  readonly expected: AccessDecision;
}

export interface LemmaScriptCaseManifest {
  readonly schema: typeof LEMMA_SCRIPT_QUALIFICATION_V1_SCHEMA;
  readonly function: typeof LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION;
  readonly inputs: readonly LemmaScriptCaseRow[];
}

export interface LemmaScriptObservation {
  readonly key: LemmaScriptCaseKey;
  readonly value: AccessDecision;
}

export type LemmaScriptDifferentialDiagnosticCode =
  | "input-shape"
  | "manifest-fields"
  | "schema-mismatch"
  | "function-mismatch"
  | "inputs-shape"
  | "case-fields"
  | "case-value"
  | "case-count"
  | "case-duplicate"
  | "case-missing"
  | "observations-shape"
  | "observation-fields"
  | "observation-key"
  | "observation-value"
  | "observation-duplicate"
  | "observation-extra"
  | "observation-missing"
  | "ts-observations-invalid"
  | "dafny-observations-invalid"
  | "ts-expected-mismatch"
  | "dafny-expected-mismatch"
  | "ts-dafny-mismatch"
  | "mutation-execution-invalid";

export interface LemmaScriptDifferentialDiagnostic {
  readonly code: LemmaScriptDifferentialDiagnosticCode;
  readonly message: string;
}

export interface LemmaScriptParseValidResult<T> {
  readonly status: "valid";
  readonly value: T;
  readonly diagnostics: readonly [];
}

export interface LemmaScriptParseInvalidResult {
  readonly status: "invalid";
  readonly diagnostics: readonly LemmaScriptDifferentialDiagnostic[];
}

export type LemmaScriptParseResult<T> = LemmaScriptParseValidResult<T> | LemmaScriptParseInvalidResult;

export interface LemmaScriptDifferentialComparisonFact {
  readonly key: LemmaScriptCaseKey;
  readonly expected: AccessDecision;
  readonly typescript: AccessDecision;
  readonly dafny: AccessDecision;
  readonly typescriptMatchesExpected: boolean;
  readonly dafnyMatchesExpected: boolean;
  readonly typescriptMatchesDafny: boolean;
}

export interface LemmaScriptDifferentialFacts {
  readonly caseCount: number;
  readonly typescriptObservationCount: number;
  readonly dafnyObservationCount: number;
  readonly comparisons: readonly LemmaScriptDifferentialComparisonFact[];
}

interface DifferentialBaseResult {
  readonly benchmarkReady: false;
  readonly facts: LemmaScriptDifferentialFacts;
  readonly diagnostics: readonly LemmaScriptDifferentialDiagnostic[];
}

export type LemmaScriptDifferentialOracleResult =
  | (DifferentialBaseResult & {
      readonly status: "equivalent";
      readonly semanticEquivalence: "equivalent_for_enumerated_domain";
      readonly diagnostics: readonly [];
    })
  | (DifferentialBaseResult & {
      readonly status: "mismatch";
      readonly semanticEquivalence: "mismatch";
    })
  | (DifferentialBaseResult & {
      readonly status: "invalid";
      readonly semanticEquivalence: "invalid";
    });

export interface LemmaScriptDifferentialOracleInput {
  readonly cases: unknown;
  readonly tsObservations: unknown;
  readonly dafnyObservations: unknown;
}

export interface LemmaScriptMutationFacts {
  readonly validObservationCount: number;
  readonly expectedCount: number;
  readonly differingKeys: readonly LemmaScriptCaseKey[];
}

interface MutationBaseResult {
  readonly benchmarkReady: false;
  readonly facts: LemmaScriptMutationFacts;
  readonly diagnostics: readonly LemmaScriptDifferentialDiagnostic[];
}

export type LemmaScriptMutationAssessment =
  | (MutationBaseResult & { readonly status: "killed" })
  | (MutationBaseResult & { readonly status: "survived" })
  | (MutationBaseResult & { readonly status: "invalid" });

export interface LemmaScriptMutationInput {
  readonly cases: unknown;
  readonly observations: unknown;
  readonly execution: unknown;
}

const MANIFEST_FIELDS = ["schema", "function", "inputs"] as const;
const ORACLE_INPUT_FIELDS = ["cases", "tsObservations", "dafnyObservations"] as const;
const MUTATION_INPUT_FIELDS = ["cases", "observations", "execution"] as const;
const CASE_FIELDS = ["authenticated", "canRead", "expected"] as const;
const OBSERVATION_FIELDS = ["key", "value"] as const;
const CASE_KEY_SET: ReadonlySet<string> = new Set(LEMMA_SCRIPT_CASE_KEYS);
const CANONICAL_LINE_PATTERN =
  /^(kiln\.lemma-script-(?:typescript|dafny)-evaluator\/v1)\|authenticated=(true|false)\|canRead=(true|false)\|result=(allow|deny)$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addDiagnostic(
  diagnostics: LemmaScriptDifferentialDiagnostic[],
  code: LemmaScriptDifferentialDiagnosticCode,
  message: string,
): void {
  diagnostics.push({ code, message });
}

function invalid<T>(diagnostics: readonly LemmaScriptDifferentialDiagnostic[]): LemmaScriptParseResult<T> {
  return { status: "invalid", diagnostics };
}

function valid<T>(value: T): LemmaScriptParseResult<T> {
  return { status: "valid", value, diagnostics: [] };
}

function exactFields(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  path: string,
  diagnostics: LemmaScriptDifferentialDiagnostic[],
  code: LemmaScriptDifferentialDiagnosticCode,
): boolean {
  const expectedSet = new Set(expected);
  const actual = Object.keys(value);
  let matches = true;

  for (const field of expected) {
    if (!Object.hasOwn(value, field)) {
      addDiagnostic(diagnostics, code, `${path} is missing required field '${field}'.`);
      matches = false;
    }
  }
  for (const field of actual) {
    if (!expectedSet.has(field)) {
      addDiagnostic(diagnostics, code, `${path} contains unexpected field '${field}'.`);
      matches = false;
    }
  }
  return matches;
}

function caseKey(authenticated: boolean, canRead: boolean): LemmaScriptCaseKey {
  if (authenticated) return canRead ? "true,true" : "true,false";
  return canRead ? "false,true" : "false,false";
}

function parseCaseKey(value: unknown): LemmaScriptCaseKey | undefined {
  if (typeof value !== "string" || !CASE_KEY_SET.has(value)) return undefined;
  if (value === "false,false" || value === "false,true" || value === "true,false" || value === "true,true") {
    return value;
  }
  return undefined;
}

function parseDecision(value: unknown): AccessDecision | undefined {
  if (value === "allow") return "allow";
  if (value === "deny") return "deny";
  return undefined;
}

function acceptedObservationSchemas(source: string): ReadonlySet<string> {
  const normalized = source.toLowerCase();
  if (normalized.includes("typescript") || normalized === "ts") {
    return new Set([TYPESCRIPT_OBSERVATION_SCHEMA]);
  }
  if (normalized.includes("dafny")) return new Set([DAFNY_OBSERVATION_SCHEMA]);
  return new Set([TYPESCRIPT_OBSERVATION_SCHEMA, DAFNY_OBSERVATION_SCHEMA]);
}

function parseCanonicalObservationLine(
  value: unknown,
  index: number,
  source: string,
  diagnostics: LemmaScriptDifferentialDiagnostic[],
): LemmaScriptObservation | undefined {
  const path = `observations[${index}]`;
  if (typeof value !== "string") {
    addDiagnostic(diagnostics, "observation-fields", `${path} canonical observation must be a string.`);
    return undefined;
  }
  const match = CANONICAL_LINE_PATTERN.exec(value);
  if (match === null) {
    addDiagnostic(diagnostics, "observation-fields", `${path} is not a canonical observation line.`);
    return undefined;
  }
  const schema = match[1];
  const authenticatedText = match[2];
  const canReadText = match[3];
  const decisionText = match[4];
  if (
    schema === undefined ||
    authenticatedText === undefined ||
    canReadText === undefined ||
    decisionText === undefined ||
    !acceptedObservationSchemas(source).has(schema)
  ) {
    addDiagnostic(diagnostics, "observation-fields", `${path} uses an unexpected canonical observation schema.`);
    return undefined;
  }
  const decision = parseDecision(decisionText);
  if (decision === undefined) {
    addDiagnostic(diagnostics, "observation-value", `${path} has an unknown result value.`);
    return undefined;
  }
  return {
    key: caseKey(authenticatedText === "true", canReadText === "true"),
    value: decision,
  };
}

function prefixedDiagnostics(
  source: "typescript" | "dafny",
  diagnostics: readonly LemmaScriptDifferentialDiagnostic[],
): readonly LemmaScriptDifferentialDiagnostic[] {
  const code = source === "typescript" ? "ts-observations-invalid" : "dafny-observations-invalid";
  return [{ code, message: `${source} observations are invalid.` }, ...diagnostics];
}

function emptyFacts(): LemmaScriptDifferentialFacts {
  return {
    caseCount: 0,
    typescriptObservationCount: 0,
    dafnyObservationCount: 0,
    comparisons: [],
  };
}

function emptyMutationFacts(): LemmaScriptMutationFacts {
  return { validObservationCount: 0, expectedCount: 0, differingKeys: [] };
}

/** Parse the JSON-decoded v1 case manifest without widening its contract. */
export function parseLemmaScriptCases(value: unknown): LemmaScriptParseResult<LemmaScriptCaseManifest> {
  const diagnostics: LemmaScriptDifferentialDiagnostic[] = [];
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "input-shape", "cases.json must contain an object.");
    return invalid(diagnostics);
  }

  exactFields(value, MANIFEST_FIELDS, "cases.json", diagnostics, "manifest-fields");
  if (value.schema !== LEMMA_SCRIPT_QUALIFICATION_V1_SCHEMA) {
    addDiagnostic(
      diagnostics,
      "schema-mismatch",
      `cases.json.schema must be '${LEMMA_SCRIPT_QUALIFICATION_V1_SCHEMA}'.`,
    );
  }
  if (value.function !== LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION) {
    addDiagnostic(
      diagnostics,
      "function-mismatch",
      `cases.json.function must be '${LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION}'.`,
    );
  }
  if (!Array.isArray(value.inputs)) {
    addDiagnostic(diagnostics, "inputs-shape", "cases.json.inputs must be an array.");
    return invalid(diagnostics);
  }
  if (value.inputs.length !== LEMMA_SCRIPT_CASE_KEYS.length) {
    addDiagnostic(
      diagnostics,
      "case-count",
      `cases.json.inputs must contain exactly ${LEMMA_SCRIPT_CASE_KEYS.length} rows.`,
    );
  }

  const rows: LemmaScriptCaseRow[] = [];
  const seenKeys = new Set<LemmaScriptCaseKey>();
  value.inputs.forEach((rawRow, index) => {
    const path = `cases.json.inputs[${index}]`;
    if (!isRecord(rawRow)) {
      addDiagnostic(diagnostics, "case-fields", `${path} must be an object.`);
      return;
    }
    exactFields(rawRow, CASE_FIELDS, path, diagnostics, "case-fields");
    if (typeof rawRow.authenticated !== "boolean" || typeof rawRow.canRead !== "boolean") {
      addDiagnostic(diagnostics, "case-value", `${path}.authenticated and ${path}.canRead must be booleans.`);
      return;
    }
    const expected = parseDecision(rawRow.expected);
    if (expected === undefined) {
      addDiagnostic(diagnostics, "case-value", `${path}.expected must be 'allow' or 'deny'.`);
      return;
    }
    const key = caseKey(rawRow.authenticated, rawRow.canRead);
    if (seenKeys.has(key)) {
      addDiagnostic(diagnostics, "case-duplicate", `${path} duplicates case key '${key}'.`);
      return;
    }
    seenKeys.add(key);
    rows.push({ authenticated: rawRow.authenticated, canRead: rawRow.canRead, expected });
  });

  for (const key of LEMMA_SCRIPT_CASE_KEYS) {
    if (!seenKeys.has(key)) addDiagnostic(diagnostics, "case-missing", `cases.json is missing case key '${key}'.`);
  }
  if (diagnostics.length > 0) return invalid(diagnostics);

  return valid({
    schema: LEMMA_SCRIPT_QUALIFICATION_V1_SCHEMA,
    function: LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION,
    inputs: rows,
  });
}

function parseObservationRow(
  value: unknown,
  index: number,
  source: string,
  diagnostics: LemmaScriptDifferentialDiagnostic[],
): LemmaScriptObservation | undefined {
  const path = `observations[${index}]`;
  if (typeof value === "string") return parseCanonicalObservationLine(value, index, source, diagnostics);
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "observation-fields", `${path} must be an object.`);
    return undefined;
  }
  exactFields(value, OBSERVATION_FIELDS, path, diagnostics, "observation-fields");
  const key = parseCaseKey(value.key);
  if (key === undefined) {
    addDiagnostic(diagnostics, "observation-key", `${path}.key must be a known boolean case key.`);
  }
  const decision = parseDecision(value.value);
  if (decision === undefined) {
    addDiagnostic(diagnostics, "observation-value", `${path}.value must be 'allow' or 'deny'.`);
  }
  if (key === undefined || decision === undefined) return undefined;
  return { key, value: decision };
}

/** Parse exact keyed rows or canonical TS/Dafny observation lines. */
export function parseLemmaScriptObservations(
  value: unknown,
  source: string = "observations",
): LemmaScriptParseResult<readonly LemmaScriptObservation[]> {
  const diagnostics: LemmaScriptDifferentialDiagnostic[] = [];
  const observations: LemmaScriptObservation[] = [];

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const observation = parseObservationRow(entry, index, source, diagnostics);
      if (observation !== undefined) observations.push(observation);
    });
  } else if (typeof value === "string") {
    const lines = value.split(/\r?\n/u);
    const contentLines = lines.at(-1) === "" ? lines.slice(0, -1) : lines;
    contentLines.forEach((line, index) => {
      const observation = parseCanonicalObservationLine(line, index, source, diagnostics);
      if (observation !== undefined) observations.push(observation);
    });
  } else {
    addDiagnostic(diagnostics, "observations-shape", `${source} observations must be rows or canonical lines.`);
  }

  const byKey = new Map<LemmaScriptCaseKey, LemmaScriptObservation>();
  for (const observation of observations) {
    if (byKey.has(observation.key)) {
      addDiagnostic(
        diagnostics,
        "observation-duplicate",
        `${source} observations duplicate case key '${observation.key}'.`,
      );
      continue;
    }
    byKey.set(observation.key, observation);
  }
  for (const key of LEMMA_SCRIPT_CASE_KEYS) {
    if (!byKey.has(key))
      addDiagnostic(diagnostics, "observation-missing", `${source} observations are missing case key '${key}'.`);
  }

  if (diagnostics.length > 0) return invalid(diagnostics);
  return valid(LEMMA_SCRIPT_CASE_KEYS.map((key) => byKey.get(key) as LemmaScriptObservation));
}

function buildFacts(
  manifest: LemmaScriptCaseManifest,
  typescript: readonly LemmaScriptObservation[],
  dafny: readonly LemmaScriptObservation[],
): { readonly facts: LemmaScriptDifferentialFacts; readonly mismatches: readonly LemmaScriptDifferentialDiagnostic[] } {
  const expected = new Map<LemmaScriptCaseKey, AccessDecision>(
    manifest.inputs.map((row) => [caseKey(row.authenticated, row.canRead), row.expected]),
  );
  const typescriptByKey = new Map(typescript.map((observation) => [observation.key, observation.value]));
  const dafnyByKey = new Map(dafny.map((observation) => [observation.key, observation.value]));
  const comparisons: LemmaScriptDifferentialComparisonFact[] = [];
  const diagnostics: LemmaScriptDifferentialDiagnostic[] = [];

  for (const key of LEMMA_SCRIPT_CASE_KEYS) {
    const expectedValue = expected.get(key);
    const typescriptValue = typescriptByKey.get(key);
    const dafnyValue = dafnyByKey.get(key);
    if (expectedValue === undefined || typescriptValue === undefined || dafnyValue === undefined) continue;
    const typescriptMatchesExpected = typescriptValue === expectedValue;
    const dafnyMatchesExpected = dafnyValue === expectedValue;
    const typescriptMatchesDafny = typescriptValue === dafnyValue;
    comparisons.push({
      key,
      expected: expectedValue,
      typescript: typescriptValue,
      dafny: dafnyValue,
      typescriptMatchesExpected,
      dafnyMatchesExpected,
      typescriptMatchesDafny,
    });
    if (!typescriptMatchesExpected) {
      addDiagnostic(
        diagnostics,
        "ts-expected-mismatch",
        `TypeScript observation for '${key}' was '${typescriptValue}', expected '${expectedValue}'.`,
      );
    }
    if (!dafnyMatchesExpected) {
      addDiagnostic(
        diagnostics,
        "dafny-expected-mismatch",
        `Dafny observation for '${key}' was '${dafnyValue}', expected '${expectedValue}'.`,
      );
    }
    if (!typescriptMatchesDafny) {
      addDiagnostic(
        diagnostics,
        "ts-dafny-mismatch",
        `TypeScript and Dafny observations differ for '${key}': '${typescriptValue}' versus '${dafnyValue}'.`,
      );
    }
  }

  return {
    facts: {
      caseCount: manifest.inputs.length,
      typescriptObservationCount: typescript.length,
      dafnyObservationCount: dafny.length,
      comparisons,
    },
    mismatches: diagnostics,
  };
}

/** Compare two complete observations against the exact v1 expected table. */
export function evaluateLemmaScriptDifferentialOracle(input: unknown): LemmaScriptDifferentialOracleResult {
  const diagnostics: LemmaScriptDifferentialDiagnostic[] = [];
  const baseFacts = emptyFacts();
  if (!isRecord(input)) {
    addDiagnostic(diagnostics, "input-shape", "differential oracle input must be an object.");
    return {
      status: "invalid",
      semanticEquivalence: "invalid",
      benchmarkReady: false,
      facts: baseFacts,
      diagnostics,
    };
  }

  exactFields(input, ORACLE_INPUT_FIELDS, "differential oracle input", diagnostics, "input-shape");
  const parsedCases = parseLemmaScriptCases(input.cases);
  const parsedTypescript = parseLemmaScriptObservations(input.tsObservations, "TypeScript");
  const parsedDafny = parseLemmaScriptObservations(input.dafnyObservations, "Dafny");

  if (parsedCases.status === "invalid") diagnostics.push(...parsedCases.diagnostics);
  if (parsedTypescript.status === "invalid")
    diagnostics.push(...prefixedDiagnostics("typescript", parsedTypescript.diagnostics));
  if (parsedDafny.status === "invalid") diagnostics.push(...prefixedDiagnostics("dafny", parsedDafny.diagnostics));
  if (
    diagnostics.length > 0 ||
    parsedCases.status === "invalid" ||
    parsedTypescript.status === "invalid" ||
    parsedDafny.status === "invalid"
  ) {
    return {
      status: "invalid",
      semanticEquivalence: "invalid",
      benchmarkReady: false,
      facts: {
        caseCount: parsedCases.status === "valid" ? parsedCases.value.inputs.length : 0,
        typescriptObservationCount: parsedTypescript.status === "valid" ? parsedTypescript.value.length : 0,
        dafnyObservationCount: parsedDafny.status === "valid" ? parsedDafny.value.length : 0,
        comparisons: [],
      },
      diagnostics,
    };
  }

  const comparison = buildFacts(parsedCases.value, parsedTypescript.value, parsedDafny.value);
  if (comparison.mismatches.length > 0) {
    return {
      status: "mismatch",
      semanticEquivalence: "mismatch",
      benchmarkReady: false,
      facts: comparison.facts,
      diagnostics: comparison.mismatches,
    };
  }
  return {
    status: "equivalent",
    semanticEquivalence: "equivalent_for_enumerated_domain",
    benchmarkReady: false,
    facts: comparison.facts,
    diagnostics: [],
  };
}

function parseMutationExecution(value: unknown): "executed" | "invalid" {
  if (typeof value !== "string") return "invalid";
  if (value === "executed") return "executed";
  return "invalid";
}

/** Assess a mutator without converting compilation or parsing failure into a kill. */
export function assessLemmaScriptMutation(input: unknown): LemmaScriptMutationAssessment {
  const diagnostics: LemmaScriptDifferentialDiagnostic[] = [];
  const baseFacts = emptyMutationFacts();
  if (!isRecord(input)) {
    addDiagnostic(diagnostics, "input-shape", "mutation assessment input must be an object.");
    return { status: "invalid", benchmarkReady: false, facts: baseFacts, diagnostics };
  }
  exactFields(input, MUTATION_INPUT_FIELDS, "mutation assessment input", diagnostics, "input-shape");
  const parsedCases = parseLemmaScriptCases(input.cases);
  if (parsedCases.status === "invalid") diagnostics.push(...parsedCases.diagnostics);

  if (parseMutationExecution(input.execution) !== "executed") {
    addDiagnostic(
      diagnostics,
      "mutation-execution-invalid",
      "mutation must report execution='executed'; compile or parse failures are invalid, not killed.",
    );
  }
  const parsedObservations = parseLemmaScriptObservations(input.observations, "mutant");
  if (parsedObservations.status === "invalid") diagnostics.push(...parsedObservations.diagnostics);
  if (diagnostics.length > 0 || parsedCases.status === "invalid" || parsedObservations.status === "invalid") {
    return { status: "invalid", benchmarkReady: false, facts: baseFacts, diagnostics };
  }

  const expected = new Map<LemmaScriptCaseKey, AccessDecision>(
    parsedCases.value.inputs.map((row) => [caseKey(row.authenticated, row.canRead), row.expected]),
  );
  const differingKeys = parsedObservations.value
    .filter((observation) => expected.get(observation.key) !== observation.value)
    .map((observation) => observation.key);
  const facts: LemmaScriptMutationFacts = {
    validObservationCount: parsedObservations.value.length,
    expectedCount: parsedCases.value.inputs.length,
    differingKeys,
  };
  if (differingKeys.length > 0) return { status: "killed", benchmarkReady: false, facts, diagnostics: [] };
  return { status: "survived", benchmarkReady: false, facts, diagnostics: [] };
}
