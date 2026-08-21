/**
 * Facts-only qualification checks for the benchmark LemmaScript fixture.
 *
 * This module deliberately has no knowledge of the LemmaScript implementation,
 * Core, CLI, formal verification, Work Governance, or Assurance. It accepts the
 * machine-readable `lsc info --typed` shape as unknown data and applies a small,
 * conservative allowlist suitable for a boolean/string-union fixture.
 */

export interface LemmaScriptQualificationInput {
  readonly typedInfo: unknown;
  readonly sourceText: string;
  readonly generatedDafny: string;
  readonly expectedLemmaScriptVersion: string;
  readonly requiredFunctionNames: readonly string[];
}

export type LemmaScriptQualificationDiagnosticCode =
  | "input-shape"
  | "schema-mismatch"
  | "version-mismatch"
  | "unsupported-backend"
  | "dafny-error"
  | "externs-present"
  | "classes-present"
  | "missing-function"
  | "missing-contract"
  | "function-not-pure"
  | "force-pure"
  | "autohavoc"
  | "unsupported-body-kind"
  | "numeric-semantics"
  | "unsupported-target-type"
  | "source-directive"
  | "generated-trust-pattern";

export interface LemmaScriptQualificationDiagnostic {
  readonly code: LemmaScriptQualificationDiagnosticCode;
  readonly message: string;
  readonly functionName?: string;
}

export interface LemmaScriptQualificationEligibleResult {
  readonly status: "eligible";
  readonly diagnostics: readonly [];
  readonly requiredFunctionNames: readonly string[];
  readonly observedFunctionNames: readonly string[];
}

export interface LemmaScriptQualificationBlockedResult {
  readonly status: "blocked";
  readonly diagnostics: readonly LemmaScriptQualificationDiagnostic[];
  readonly requiredFunctionNames: readonly string[];
  readonly observedFunctionNames: readonly string[];
}

export type LemmaScriptQualificationResult =
  | LemmaScriptQualificationEligibleResult
  | LemmaScriptQualificationBlockedResult;

interface FunctionSnapshot {
  readonly name: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly isPure: boolean;
  readonly forcePure: boolean;
  readonly autohavoc: boolean;
  readonly bodyKinds: readonly string[];
  readonly ensures: readonly Readonly<Record<string, unknown>>[];
  readonly ensuresCount: number;
  readonly params: readonly Readonly<Record<string, unknown>>[];
  readonly returnTy: unknown;
}

interface ParsedTypedInfo {
  readonly functions: readonly FunctionSnapshot[];
  readonly observedFunctionNames: readonly string[];
  readonly stringUnionNames: ReadonlySet<string>;
}

interface ParsedFunctions {
  readonly functions: readonly FunctionSnapshot[];
  readonly observedFunctionNames: readonly string[];
}

const TYPED_INFO_SCHEMA = 1;
const ALLOWED_BACKENDS = new Set<null | "dafny">([null, "dafny"]);
const NUMERIC_TYPE_KINDS = new Set(["int", "real", "nat"]);
const ALLOWED_BODY_KINDS = new Set([
  "return",
  "var",
  "str",
  "bool",
  "binop",
  "unop",
  "conditional",
  "field",
  "if",
  "switch",
  "tagMatch",
]);
const ALLOWED_ENSURES_KINDS = new Set([
  "var",
  "num",
  "bigint",
  "str",
  "bool",
  "binop",
  "unop",
  "call",
  "index",
  "field",
  "record",
  "arrayLiteral",
  "lambda",
  "conditional",
  "optChain",
  "nullish",
  "someMatch",
  "tagMatch",
  "forall",
  "exists",
  "havoc",
]);
const SOURCE_DIRECTIVE_PATTERN = /\/\/@\s*(assume|extern|havoc|autohavoc|skip|verify)\b/iu;

interface GeneratedBannedPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

const GENERATED_BANNED_PATTERNS: readonly GeneratedBannedPattern[] = [
  { name: "assume", pattern: /\bassume\b/iu },
  { name: "expect", pattern: /\bexpect\b/iu },
  { name: "include", pattern: /\binclude\b/iu },
  { name: "block-comment-open", pattern: /\/\*/u },
  { name: "block-comment-close", pattern: /\*\//u },
  { name: "verbatim-string", pattern: /@"/u },
  { name: "axiom", pattern: /\{\s*:axiom\b/iu },
  { name: "extern", pattern: /\{\s*:extern\b/iu },
  { name: "verify-false", pattern: /\{\s*:verify\s+false\b/iu },
  { name: "only", pattern: /\{\s*:only\b/iu },
  { name: "selective-checking", pattern: /\{\s*:selective_checking\b/iu },
  { name: "assumption", pattern: /\{\s*:assumption\b/iu },
  { name: "assume-concurrent", pattern: /\{\s*:assume_concurrent\b/iu },
  { name: "contradiction", pattern: /\{\s*:contradiction\b/iu },
  { name: "options", pattern: /\{\s*:options\b/iu },
  { name: "at-axiom", pattern: /@Axiom\b/iu },
  { name: "at-verify-false", pattern: /@Verify\s*\(\s*false\s*\)/iu },
  { name: "at-verify-only", pattern: /@VerifyOnly\b/iu },
  { name: "at-options", pattern: /@Options\b/iu },
  {
    name: "contract-inference",
    pattern: /\{\s*:(?:autoReq|autocontracts)\b|@AutoRequires\b|@AutoContracts\b/iu,
  },
  { name: "decreases-wildcard", pattern: /\bdecreases\s+\*/iu },
];
const WEAKENING_CLAUSE_PATTERN = /\b(?:requires|reads|modifies)\b/iu;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addDiagnostic(
  diagnostics: LemmaScriptQualificationDiagnostic[],
  code: LemmaScriptQualificationDiagnosticCode,
  message: string,
  functionName?: string,
): void {
  if (functionName === undefined) {
    diagnostics.push({ code, message });
  } else {
    diagnostics.push({ code, message, functionName });
  }
}

function blockedResult(
  diagnostics: readonly LemmaScriptQualificationDiagnostic[],
  requiredFunctionNames: readonly string[],
  observedFunctionNames: readonly string[],
): LemmaScriptQualificationBlockedResult {
  return {
    status: "blocked",
    diagnostics,
    requiredFunctionNames: [...requiredFunctionNames],
    observedFunctionNames: [...observedFunctionNames],
  };
}

function eligibleResult(
  requiredFunctionNames: readonly string[],
  observedFunctionNames: readonly string[],
): LemmaScriptQualificationEligibleResult {
  return {
    status: "eligible",
    diagnostics: [],
    requiredFunctionNames: [...requiredFunctionNames],
    observedFunctionNames: [...observedFunctionNames],
  };
}

function readRequiredFunctionNames(
  input: unknown,
  diagnostics: LemmaScriptQualificationDiagnostic[],
): readonly string[] | null {
  if (!isRecord(input)) {
    addDiagnostic(diagnostics, "input-shape", "The qualification input must be an object.");
    return null;
  }

  const rawNames = input.requiredFunctionNames;
  if (!Array.isArray(rawNames) || rawNames.length === 0) {
    addDiagnostic(diagnostics, "input-shape", "requiredFunctionNames must be a non-empty array of names.");
    return null;
  }

  const names: string[] = [];
  for (const rawName of rawNames) {
    if (typeof rawName !== "string" || rawName.length === 0) {
      addDiagnostic(diagnostics, "input-shape", "requiredFunctionNames must contain non-empty strings.");
      return null;
    }
    if (names.includes(rawName)) {
      addDiagnostic(diagnostics, "input-shape", `requiredFunctionNames contains the duplicate '${rawName}'.`);
      return null;
    }
    names.push(rawName);
  }
  return names;
}

function readTextInput(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: LemmaScriptQualificationDiagnostic[],
): string | null {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    addDiagnostic(diagnostics, "input-shape", `${key} must be a non-empty string.`);
    return null;
  }
  return value;
}

function readEnsures(
  value: Readonly<Record<string, unknown>>,
  name: string,
  diagnostics: LemmaScriptQualificationDiagnostic[],
): { readonly nodes: readonly Readonly<Record<string, unknown>>[]; readonly count: number } {
  const rawEnsures = value.ensures;
  if (rawEnsures === undefined) {
    addDiagnostic(diagnostics, "input-shape", `Function '${name}' must expose an ensures array.`, name);
    return { nodes: [], count: 0 };
  }
  if (!Array.isArray(rawEnsures)) {
    addDiagnostic(diagnostics, "input-shape", `Function '${name}' must expose an ensures array.`, name);
    return { nodes: [], count: 0 };
  }

  const nodes: Readonly<Record<string, unknown>>[] = [];
  for (const rawEnsure of rawEnsures) {
    if (!isRecord(rawEnsure)) {
      addDiagnostic(diagnostics, "input-shape", `Function '${name}' ensures entries must be objects.`, name);
      continue;
    }
    if (typeof rawEnsure.kind !== "string" || rawEnsure.kind.trim().length === 0) {
      addDiagnostic(diagnostics, "input-shape", `Function '${name}' ensures entries need a non-empty kind.`, name);
      continue;
    }
    if (!ALLOWED_ENSURES_KINDS.has(rawEnsure.kind)) {
      addDiagnostic(
        diagnostics,
        "input-shape",
        `Function '${name}' uses an unknown ensures kind '${rawEnsure.kind}'.`,
        name,
      );
      continue;
    }
    nodes.push(rawEnsure);
  }
  return { nodes, count: rawEnsures.length };
}

function readFunctionSnapshot(
  value: unknown,
  name: string,
  diagnostics: LemmaScriptQualificationDiagnostic[],
): FunctionSnapshot | null {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "input-shape", `Function '${name}' must be an object.`, name);
    return null;
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    addDiagnostic(diagnostics, "input-shape", `Function '${name}' has an invalid name.`, name);
    return null;
  }

  if (
    typeof value.isPure !== "boolean" ||
    typeof value.forcePure !== "boolean" ||
    typeof value.autohavoc !== "boolean"
  ) {
    addDiagnostic(diagnostics, "input-shape", `Function '${name}' must expose boolean purity flags.`, name);
    return null;
  }

  if (
    !Array.isArray(value.bodyKinds) ||
    value.bodyKinds.length === 0 ||
    !value.bodyKinds.every((kind): kind is string => typeof kind === "string" && kind.length > 0)
  ) {
    addDiagnostic(
      diagnostics,
      "input-shape",
      `Function '${name}' must expose a non-empty bodyKinds string array.`,
      name,
    );
    return null;
  }

  if (
    !Array.isArray(value.params) ||
    !value.params.every(isRecord) ||
    value.params.some((param) => param.ty === undefined)
  ) {
    addDiagnostic(diagnostics, "input-shape", `Function '${name}' must expose typed parameters.`, name);
    return null;
  }

  if (!isRecord(value.returnTy)) {
    addDiagnostic(diagnostics, "input-shape", `Function '${name}' must expose a typed return value.`, name);
    return null;
  }

  const ensures = readEnsures(value, name, diagnostics);

  return {
    name,
    data: value,
    isPure: value.isPure,
    forcePure: value.forcePure,
    autohavoc: value.autohavoc,
    bodyKinds: value.bodyKinds,
    ensures: ensures.nodes,
    ensuresCount: ensures.count,
    params: value.params,
    returnTy: value.returnTy,
  };
}

function parseTypedFunctions(
  typedInfo: Readonly<Record<string, unknown>>,
  diagnostics: LemmaScriptQualificationDiagnostic[],
): ParsedFunctions | null {
  const rawFunctions = typedInfo.functions;
  if (!Array.isArray(rawFunctions)) {
    addDiagnostic(diagnostics, "input-shape", "typedInfo.functions must be an array.");
    return null;
  }

  const rawClasses = typedInfo.classes;
  if (rawClasses !== undefined && !Array.isArray(rawClasses)) {
    addDiagnostic(diagnostics, "input-shape", "typedInfo.classes must be an array when present.");
    return null;
  }
  if (rawClasses !== undefined && rawClasses.length > 0) {
    addDiagnostic(diagnostics, "classes-present", "typedInfo.classes must be empty for this qualification tier.");
  }

  const functions: FunctionSnapshot[] = [];
  const observedFunctionNames: string[] = [];
  const seenNames = new Set<string>();

  for (const rawFunction of rawFunctions) {
    const candidateName =
      isRecord(rawFunction) && typeof rawFunction.name === "string" ? rawFunction.name : "<unknown>";
    const functionSnapshot = readFunctionSnapshot(rawFunction, candidateName, diagnostics);
    if (functionSnapshot === null) continue;
    if (seenNames.has(functionSnapshot.name)) {
      addDiagnostic(
        diagnostics,
        "input-shape",
        `typedInfo contains duplicate function '${functionSnapshot.name}'.`,
        functionSnapshot.name,
      );
      continue;
    }
    seenNames.add(functionSnapshot.name);
    functions.push(functionSnapshot);
    observedFunctionNames.push(functionSnapshot.name);
  }

  return { functions, observedFunctionNames };
}

function parseStringUnionNames(
  typedInfo: Readonly<Record<string, unknown>>,
  diagnostics: LemmaScriptQualificationDiagnostic[],
): ReadonlySet<string> | null {
  const rawTypeDecls = typedInfo.typeDecls;
  if (rawTypeDecls === undefined) return new Set<string>();
  if (!Array.isArray(rawTypeDecls)) {
    addDiagnostic(diagnostics, "input-shape", "typedInfo.typeDecls must be an array when present.");
    return null;
  }

  const stringUnionNames = new Set<string>();
  for (const rawTypeDecl of rawTypeDecls) {
    if (!isRecord(rawTypeDecl)) {
      addDiagnostic(diagnostics, "input-shape", "Each typedInfo type declaration must be an object.");
      continue;
    }
    if (rawTypeDecl.kind === "string-union") {
      if (typeof rawTypeDecl.name !== "string" || rawTypeDecl.name.length === 0) {
        addDiagnostic(diagnostics, "input-shape", "String-union type declarations must have a name.");
        continue;
      }
      if (
        !Array.isArray(rawTypeDecl.values) ||
        rawTypeDecl.values.length === 0 ||
        !rawTypeDecl.values.every((entry): entry is string => typeof entry === "string")
      ) {
        addDiagnostic(
          diagnostics,
          "unsupported-target-type",
          `String-union type '${rawTypeDecl.name}' must expose a non-empty literal value set.`,
        );
        continue;
      }
      stringUnionNames.add(rawTypeDecl.name);
    }
  }
  return stringUnionNames;
}

function parseTypedInfo(
  value: unknown,
  expectedVersion: string,
  diagnostics: LemmaScriptQualificationDiagnostic[],
): ParsedTypedInfo | null {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "input-shape", "typedInfo must be an object.");
    return null;
  }

  if (value.schema !== TYPED_INFO_SCHEMA) {
    addDiagnostic(diagnostics, "schema-mismatch", `typedInfo.schema must equal ${TYPED_INFO_SCHEMA}.`);
  }

  if (value.lemmascript !== expectedVersion) {
    addDiagnostic(diagnostics, "version-mismatch", "typedInfo.lemmascript does not match expectedLemmaScriptVersion.");
  }

  const backend = value.backendDirective;
  const normalizedBackend: null | "dafny" | undefined =
    backend === null ? null : backend === "dafny" ? "dafny" : undefined;
  if (normalizedBackend === undefined || !ALLOWED_BACKENDS.has(normalizedBackend)) {
    addDiagnostic(diagnostics, "unsupported-backend", "typedInfo.backendDirective must be null or 'dafny'.");
  }

  if (!isRecord(value.dafny)) {
    addDiagnostic(diagnostics, "input-shape", "typedInfo.dafny must be an object.");
  } else if (value.dafny.error !== undefined && value.dafny.error !== null) {
    if (typeof value.dafny.error !== "string") {
      addDiagnostic(diagnostics, "input-shape", "typedInfo.dafny.error must be a string when present.");
    } else if (value.dafny.error.length > 0) {
      addDiagnostic(diagnostics, "dafny-error", "typedInfo.dafny.error reports a generation failure.");
    }
  }

  if (!Array.isArray(value.externs)) {
    addDiagnostic(diagnostics, "input-shape", "typedInfo.externs must be an array.");
  } else if (value.externs.length > 0) {
    addDiagnostic(diagnostics, "externs-present", "typedInfo.externs must be empty.");
  }

  const stringUnionNames = parseStringUnionNames(value, diagnostics);
  const parsedFunctions = parseTypedFunctions(value, diagnostics);
  if (stringUnionNames === null || parsedFunctions === null) return null;
  return { ...parsedFunctions, stringUnionNames };
}

function hasNumericSemantics(value: unknown, key?: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => hasNumericSemantics(entry));
  if (!isRecord(value)) {
    if (
      key === "kind" &&
      typeof value === "string" &&
      (NUMERIC_TYPE_KINDS.has(value) || value === "num" || value === "bigint")
    ) {
      return true;
    }
    if (key === "tsType" && typeof value === "string") {
      return /\b(?:number|bigint|int|real|nat)\b/u.test(value);
    }
    if (key === "aliasOf" && typeof value === "string") {
      return /\b(?:number|bigint|int|real|nat)\b/u.test(value);
    }
    return false;
  }

  if (
    typeof value.kind === "string" &&
    (NUMERIC_TYPE_KINDS.has(value.kind) || value.kind === "num" || value.kind === "bigint")
  ) {
    return true;
  }
  return Object.entries(value).some(([entryKey, entryValue]) => hasNumericSemantics(entryValue, entryKey));
}

function hasUnsupportedSimpleType(value: unknown, stringUnionNames: ReadonlySet<string>): boolean {
  if (!isRecord(value)) return true;
  if (typeof value.kind !== "string") return true;
  if (NUMERIC_TYPE_KINDS.has(value.kind)) return false;

  if (value.kind === "bool") return false;
  if (value.kind === "string") {
    return (
      !Array.isArray(value.values) ||
      value.values.length === 0 ||
      !value.values.every((entry): entry is string => typeof entry === "string")
    );
  }
  if (value.kind === "user") {
    if (typeof value.name !== "string" || value.name.length === 0) return true;
    const lastSegment = value.name.slice(value.name.lastIndexOf(".") + 1);
    return !stringUnionNames.has(value.name) && !stringUnionNames.has(lastSegment);
  }
  return true;
}

function inspectFunction(
  functionSnapshot: FunctionSnapshot,
  diagnostics: LemmaScriptQualificationDiagnostic[],
  stringUnionNames: ReadonlySet<string>,
  required: boolean,
): void {
  const functionName = functionSnapshot.name;
  const functionLabel = required ? "Required function" : "Function";
  if (!functionSnapshot.isPure) {
    addDiagnostic(diagnostics, "function-not-pure", `${functionLabel} '${functionName}' is not pure.`, functionName);
  }
  if (functionSnapshot.forcePure) {
    addDiagnostic(diagnostics, "force-pure", `${functionLabel} '${functionName}' uses forcePure.`, functionName);
  }
  if (functionSnapshot.autohavoc) {
    addDiagnostic(diagnostics, "autohavoc", `${functionLabel} '${functionName}' uses autohavoc.`, functionName);
  }
  if (required && functionSnapshot.ensuresCount === 0) {
    addDiagnostic(
      diagnostics,
      "missing-contract",
      `Required function '${functionName}' must expose a non-empty ensures contract.`,
      functionName,
    );
  }

  const unsupportedBodyKinds = functionSnapshot.bodyKinds.filter((kind) => !ALLOWED_BODY_KINDS.has(kind));
  if (unsupportedBodyKinds.length > 0) {
    addDiagnostic(
      diagnostics,
      "unsupported-body-kind",
      `${functionLabel} '${functionName}' uses unsupported bodyKinds: ${unsupportedBodyKinds.join(", ")}.`,
      functionName,
    );
  }

  if (hasNumericSemantics(functionSnapshot.data)) {
    addDiagnostic(
      diagnostics,
      "numeric-semantics",
      `${functionLabel} '${functionName}' contains numeric semantics.`,
      functionName,
    );
  }

  if (functionSnapshot.bodyKinds.some((kind) => kind === "num" || kind === "bigint")) {
    addDiagnostic(
      diagnostics,
      "numeric-semantics",
      `${functionLabel} '${functionName}' contains numeric bodyKinds.`,
      functionName,
    );
  }

  for (const parameter of functionSnapshot.params) {
    if (hasUnsupportedSimpleType(parameter.ty, stringUnionNames)) {
      addDiagnostic(
        diagnostics,
        "unsupported-target-type",
        `${functionLabel} '${functionName}' has a parameter outside the boolean/string allowlist.`,
        functionName,
      );
      break;
    }
  }
  if (hasUnsupportedSimpleType(functionSnapshot.returnTy, stringUnionNames)) {
    addDiagnostic(
      diagnostics,
      "unsupported-target-type",
      `${functionLabel} '${functionName}' returns a type outside the boolean/string allowlist.`,
      functionName,
    );
  }
}

function findSourceDirective(sourceText: string): string | null {
  const match = SOURCE_DIRECTIVE_PATTERN.exec(sourceText);
  return match?.[1] ?? null;
}

/**
 * Match the upstream benchmark's conservative comment scan. A trailing `//`
 * comment is inert only when no quote occurs before it; otherwise the whole
 * line is scanned so a token after `//` inside a string cannot be hidden.
 */
function scannedGeneratedLine(line: string): string {
  const commentIndex = line.indexOf("//");
  if (commentIndex < 0) return line;
  if (line.slice(0, commentIndex).includes('"')) return line;
  return line.slice(0, commentIndex);
}

function scanGeneratedDafny(generatedDafny: string): string {
  return generatedDafny.split(/\r?\n/u).map(scannedGeneratedLine).join("\n");
}

function hasBodylessDeclaration(maskedDafny: string): boolean {
  const lines = maskedDafny.split(/\r?\n/u);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line === undefined || !/^\s*(?:function|method)\b/u.test(line) || line.includes("{")) {
      continue;
    }

    for (let scanIndex = lineIndex; scanIndex < lines.length; scanIndex += 1) {
      const scanLine = lines[scanIndex];
      if (scanLine === undefined) break;
      if (scanLine.includes("{")) break;
      if (scanLine.includes(";")) return true;
      if (scanIndex > lineIndex && /^\s*(?:function|method)\b/u.test(scanLine)) return true;
    }

    const nextLine = lines[lineIndex + 1];
    if (nextLine === undefined) return true;
    if (!nextLine.trimStart().startsWith("{")) {
      const hasClosingSignature = lines.slice(lineIndex + 1, lineIndex + 8).some((scanLine) => scanLine.includes("{"));
      if (!hasClosingSignature) return true;
    }
  }
  return false;
}

function findGeneratedTrustPattern(generatedDafny: string): string | null {
  const scannedDafny = scanGeneratedDafny(generatedDafny);
  const normalizedDafny = scannedDafny.replace(/\s+/gu, " ");
  const bannedPattern = GENERATED_BANNED_PATTERNS.find(({ pattern }) => pattern.test(normalizedDafny));
  if (bannedPattern !== undefined) return bannedPattern.name;
  if (WEAKENING_CLAUSE_PATTERN.test(normalizedDafny)) return "weakening-clause";
  if (hasBodylessDeclaration(scannedDafny)) return "bodyless declaration";
  return null;
}

export function evaluateLemmaScriptQualificationPolicy(
  input: LemmaScriptQualificationInput,
): LemmaScriptQualificationResult {
  const diagnostics: LemmaScriptQualificationDiagnostic[] = [];
  const requiredFunctionNames = readRequiredFunctionNames(input, diagnostics);
  if (requiredFunctionNames === null || !isRecord(input)) {
    return blockedResult(diagnostics, requiredFunctionNames ?? [], []);
  }

  const sourceText = readTextInput(input, "sourceText", diagnostics);
  const generatedDafny = readTextInput(input, "generatedDafny", diagnostics);
  const expectedVersion = readTextInput(input, "expectedLemmaScriptVersion", diagnostics);
  if (sourceText === null || generatedDafny === null || expectedVersion === null) {
    return blockedResult(diagnostics, requiredFunctionNames, []);
  }

  const parsedTypedInfo = parseTypedInfo(input.typedInfo, expectedVersion, diagnostics);
  if (parsedTypedInfo === null) {
    return blockedResult(diagnostics, requiredFunctionNames, []);
  }

  const observedNames = parsedTypedInfo.observedFunctionNames;
  const byName = new Map(
    parsedTypedInfo.functions.map((functionSnapshot) => [functionSnapshot.name, functionSnapshot] as const),
  );

  for (const functionSnapshot of parsedTypedInfo.functions) {
    inspectFunction(
      functionSnapshot,
      diagnostics,
      parsedTypedInfo.stringUnionNames,
      requiredFunctionNames.includes(functionSnapshot.name),
    );
  }

  for (const requiredName of requiredFunctionNames) {
    const functionSnapshot = byName.get(requiredName);
    if (functionSnapshot === undefined) {
      addDiagnostic(
        diagnostics,
        "missing-function",
        `Required function '${requiredName}' is missing from typedInfo.`,
        requiredName,
      );
    }
  }

  if (hasNumericSemantics(input.typedInfo) && !diagnostics.some(({ code }) => code === "numeric-semantics")) {
    addDiagnostic(diagnostics, "numeric-semantics", "typedInfo contains numeric semantics.");
  }

  const sourceDirective = findSourceDirective(sourceText);
  if (sourceDirective !== null) {
    addDiagnostic(diagnostics, "source-directive", `Source contains the disallowed //@ ${sourceDirective} directive.`);
  }

  const generatedTrustPattern = findGeneratedTrustPattern(generatedDafny);
  if (generatedTrustPattern !== null) {
    addDiagnostic(
      diagnostics,
      "generated-trust-pattern",
      `Generated Dafny contains a disallowed ${generatedTrustPattern} pattern.`,
    );
  }

  return diagnostics.length === 0
    ? eligibleResult(requiredFunctionNames, observedNames)
    : blockedResult(diagnostics, requiredFunctionNames, observedNames);
}
