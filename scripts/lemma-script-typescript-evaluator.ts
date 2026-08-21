import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CANONICAL_OUTPUT_PREFIX = "kiln.lemma-script-typescript-evaluator";
export const CANONICAL_OUTPUT_VERSION = "v1";
export const CANONICAL_OUTPUT_SCHEMA = `${CANONICAL_OUTPUT_PREFIX}/${CANONICAL_OUTPUT_VERSION}`;
export const EVALUATOR_FUNCTION_NAME = "accessPolicy";
export const QUALIFICATION_CASE_MANIFEST_SCHEMA = "kiln.lemma-script-qualification-v1";
const REQUIRED_INPUT_KEYS = new Set(["sourcePath", "functionName", "caseManifestPath"]);
const REQUIRED_ARGUMENTS = new Set(["source", "function", "manifest"]);
const DOMAIN_ORDER = [
  { authenticated: false, canRead: false },
  { authenticated: false, canRead: true },
  { authenticated: true, canRead: false },
  { authenticated: true, canRead: true },
] as const;
let importSequence = 0;

export type AccessDecision = "allow" | "deny";

export interface LemmaScriptTypescriptEvaluatorInput {
  readonly sourcePath: string;
  readonly functionName: string;
  readonly caseManifestPath: string;
}

export interface LemmaScriptTypescriptCase {
  readonly authenticated: boolean;
  readonly canRead: boolean;
}

export interface LemmaScriptTypescriptCaseManifest {
  readonly schema: string;
  readonly functionName: string;
  readonly cases: readonly LemmaScriptTypescriptCase[];
}

export interface LemmaScriptTypescriptObservation {
  readonly authenticated: boolean;
  readonly canRead: boolean;
  readonly result: AccessDecision;
  readonly line: string;
}

export type LemmaScriptTypescriptEvaluatorErrorCode =
  | "invalid_input"
  | "invalid_manifest"
  | "export_unavailable"
  | "import_failed"
  | "evaluation_failed"
  | "promise_result"
  | "invalid_result";

export interface LemmaScriptTypescriptEvaluatorFailure {
  readonly ok: false;
  readonly status: "failed";
  readonly code: LemmaScriptTypescriptEvaluatorErrorCode;
  readonly message: string;
  readonly lines: readonly [];
  readonly output: "";
}

export interface LemmaScriptTypescriptEvaluatorSuccess {
  readonly ok: true;
  readonly status: "passed";
  readonly lines: readonly [string, string, string, string];
  readonly output: string;
  readonly observations: readonly [
    LemmaScriptTypescriptObservation,
    LemmaScriptTypescriptObservation,
    LemmaScriptTypescriptObservation,
    LemmaScriptTypescriptObservation,
  ];
}

export type LemmaScriptTypescriptEvaluatorResult =
  | LemmaScriptTypescriptEvaluatorSuccess
  | LemmaScriptTypescriptEvaluatorFailure;

export interface ParsedLemmaScriptTypescriptEvaluatorArguments {
  readonly input?: LemmaScriptTypescriptEvaluatorInput;
  readonly error?: string;
}

class EvaluatorFailure extends Error {
  readonly code: LemmaScriptTypescriptEvaluatorErrorCode;

  constructor(code: LemmaScriptTypescriptEvaluatorErrorCode, message: string) {
    super(message);
    this.name = "EvaluatorFailure";
    this.code = code;
  }
}

/**
 * Parse the deliberately small case-manifest contract. `expected` is not part
 * of the returned value: it is evidence for another layer, never an execution
 * input for this evaluator.
 */
export function parseCaseManifest(
  value: unknown,
  functionName = EVALUATOR_FUNCTION_NAME,
): LemmaScriptTypescriptCaseManifest {
  if (!isRecord(value)) throw new EvaluatorFailure("invalid_manifest", "manifest is not an object");
  if (!hasOnlyKeys(value, ["schema", "function", "inputs"])) {
    throw new EvaluatorFailure("invalid_manifest", "manifest has unexpected fields");
  }
  const schema = value.schema;
  if (schema !== QUALIFICATION_CASE_MANIFEST_SCHEMA) {
    throw new EvaluatorFailure("invalid_manifest", "manifest schema is unsupported");
  }
  if (value.function !== functionName || typeof value.function !== "string") {
    throw new EvaluatorFailure("invalid_manifest", "manifest function is not accessPolicy");
  }
  if (!Array.isArray(value.inputs) || value.inputs.length !== DOMAIN_ORDER.length) {
    throw new EvaluatorFailure("invalid_manifest", "manifest must contain four cases");
  }

  const cases: LemmaScriptTypescriptCase[] = [];
  const domains = new Set<string>();
  for (const candidate of value.inputs) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["authenticated", "canRead", "expected"])) {
      throw new EvaluatorFailure("invalid_manifest", "manifest case is malformed");
    }
    if (
      typeof candidate.authenticated !== "boolean" ||
      typeof candidate.canRead !== "boolean" ||
      !Object.hasOwn(candidate, "expected") ||
      !isAccessDecision(candidate.expected)
    ) {
      throw new EvaluatorFailure("invalid_manifest", "manifest case fields are malformed");
    }
    const key = domainKey(candidate.authenticated, candidate.canRead);
    if (domains.has(key)) throw new EvaluatorFailure("invalid_manifest", "manifest contains a duplicate domain");
    domains.add(key);
    cases.push({ authenticated: candidate.authenticated, canRead: candidate.canRead });
  }
  for (const domain of DOMAIN_ORDER) {
    if (!domains.has(domainKey(domain.authenticated, domain.canRead))) {
      throw new EvaluatorFailure("invalid_manifest", "manifest is missing a domain");
    }
  }
  return { schema, functionName, cases };
}

/**
 * Format one output observation. The prefix and version are constants so a
 * parent process can compare lines without parsing source-specific text.
 */
export function formatCanonicalObservation(authenticated: boolean, canRead: boolean, result: AccessDecision): string {
  return `${CANONICAL_OUTPUT_SCHEMA}|authenticated=${authenticated}|canRead=${canRead}|result=${result}`;
}

/**
 * Strictly parse `--name=value` arguments. Positional and space-separated
 * forms are rejected because they make process invocation ambiguous.
 */
export function parseArguments(argv: readonly string[]): ParsedLemmaScriptTypescriptEvaluatorArguments {
  const values = new Map<string, string>();
  for (const argument of argv) {
    if (!argument.startsWith("--")) return { error: "unexpected positional argument" };
    const separator = argument.indexOf("=");
    if (separator <= 2) return { error: "arguments must use --name=value" };
    const name = argument.slice(2, separator);
    if (!REQUIRED_ARGUMENTS.has(name)) return { error: "unknown option" };
    if (values.has(name)) return { error: "duplicate option" };
    const value = argument.slice(separator + 1);
    if (value.length === 0) return { error: "option value is empty" };
    values.set(name, value);
  }
  const sourcePath = values.get("source");
  const functionName = values.get("function");
  const caseManifestPath = values.get("manifest");
  if (sourcePath === undefined || functionName === undefined || caseManifestPath === undefined) {
    return { error: "required options are missing" };
  }
  return { input: { sourcePath, functionName, caseManifestPath } };
}

/**
 * Execute the named export from the exact staged source path over the four
 * manifest domains. This function never uses the manifest's expected values.
 */
export async function runLemmaScriptTypescriptEvaluator(input: unknown): Promise<LemmaScriptTypescriptEvaluatorResult> {
  try {
    const parsedInput = validateInput(input);
    await assertRegularNonSymlinkSource(parsedInput.sourcePath);
    await assertRegularNonSymlinkManifest(parsedInput.caseManifestPath);
    const manifest = await readManifest(parsedInput.caseManifestPath, parsedInput.functionName);
    await assertRegularNonSymlinkSource(parsedInput.sourcePath);
    const observations = await withSuppressedProcessOutput(async () => {
      const namespace = await importSource(parsedInput.sourcePath);
      const exported = getExport(namespace, parsedInput.functionName);
      return evaluateCases(exported, manifest);
    });
    const lines = observations.map(({ line }) => line) as [string, string, string, string];
    return {
      ok: true,
      status: "passed",
      lines,
      output: `${lines.join("\n")}\n`,
      observations,
    };
  } catch (error) {
    return toFailure(error);
  }
}

/** Compatibility spelling for callers that preserve the TypeScript brand casing. */
export const runLemmaScriptTypeScriptEvaluator = runLemmaScriptTypescriptEvaluator;

/** A named API alias useful to process-level and differential-oracle tests. */
export const evaluateLemmaScriptTypescriptSource = runLemmaScriptTypescriptEvaluator;

/** Compatibility spelling for callers that use TypeScript's conventional casing. */
export const evaluateLemmaScriptTypeScriptSource = runLemmaScriptTypescriptEvaluator;

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArguments(argv);
  if (parsed.input === undefined) {
    writeSanitizedStderr("invalid input");
    return 1;
  }
  const result = await runLemmaScriptTypescriptEvaluator(parsed.input);
  if (!result.ok) {
    writeSanitizedStderr(result.message);
    return 1;
  }
  process.stdout.write(result.output);
  return 0;
}

function validateInput(value: unknown): LemmaScriptTypescriptEvaluatorInput {
  if (!isRecord(value) || !hasOnlyKeys(value, [...REQUIRED_INPUT_KEYS])) {
    throw new EvaluatorFailure("invalid_input", "input is malformed");
  }
  if (typeof value.sourcePath !== "string" || !isAbsolute(value.sourcePath) || !value.sourcePath.endsWith(".ts")) {
    throw new EvaluatorFailure("invalid_input", "source path is not an absolute .ts path");
  }
  if (value.functionName !== EVALUATOR_FUNCTION_NAME) {
    throw new EvaluatorFailure("invalid_input", "function name is not accessPolicy");
  }
  if (typeof value.caseManifestPath !== "string" || !isAbsolute(value.caseManifestPath)) {
    throw new EvaluatorFailure("invalid_input", "manifest path is not absolute");
  }
  return {
    sourcePath: value.sourcePath,
    functionName: value.functionName,
    caseManifestPath: value.caseManifestPath,
  };
}

async function readManifest(path: string, functionName: string): Promise<LemmaScriptTypescriptCaseManifest> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new EvaluatorFailure("invalid_manifest", "manifest could not be read");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new EvaluatorFailure("invalid_manifest", "manifest is not valid JSON");
  }
  return parseCaseManifest(value, functionName);
}

async function assertRegularNonSymlinkSource(path: string): Promise<void> {
  if (!(await isRegularNonSymlink(path)) || !path.endsWith(".ts")) {
    throw new EvaluatorFailure("invalid_input", "source path is not a regular non-symlink .ts file");
  }
}

async function assertRegularNonSymlinkManifest(path: string): Promise<void> {
  if (!(await isRegularNonSymlink(path))) {
    throw new EvaluatorFailure("invalid_input", "manifest path is not a regular non-symlink file");
  }
}

async function isRegularNonSymlink(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function importSource(path: string): Promise<unknown> {
  try {
    // Keep the path itself exact; the query only avoids stale ESM cache when a
    // process-level caller evaluates a rewritten staged file twice.
    importSequence += 1;
    return await import(`${pathToFileURL(path).href}?kiln_evaluator=${importSequence}`);
  } catch {
    throw new EvaluatorFailure("import_failed", "source import failed");
  }
}

function getExport(namespace: unknown, functionName: string): (...args: readonly boolean[]) => unknown {
  if (!isRecord(namespace)) throw new EvaluatorFailure("export_unavailable", "export unavailable");
  const exported = namespace[functionName];
  if (typeof exported !== "function") throw new EvaluatorFailure("export_unavailable", "export unavailable");
  return exported as (...args: readonly boolean[]) => unknown;
}

function evaluateCases(
  accessPolicy: (...args: readonly boolean[]) => unknown,
  manifest: LemmaScriptTypescriptCaseManifest,
): readonly [
  LemmaScriptTypescriptObservation,
  LemmaScriptTypescriptObservation,
  LemmaScriptTypescriptObservation,
  LemmaScriptTypescriptObservation,
] {
  const byDomain = new Map(
    manifest.cases.map((candidate) => [domainKey(candidate.authenticated, candidate.canRead), candidate]),
  );
  const observations: LemmaScriptTypescriptObservation[] = [];
  for (const domain of DOMAIN_ORDER) {
    const candidate = byDomain.get(domainKey(domain.authenticated, domain.canRead));
    if (candidate === undefined) throw new EvaluatorFailure("invalid_manifest", "manifest is missing a domain");
    let value: unknown;
    try {
      value = accessPolicy(candidate.authenticated, candidate.canRead);
    } catch {
      throw new EvaluatorFailure("evaluation_failed", "evaluation failed");
    }
    if (isThenable(value)) {
      silencePromiseRejection(value);
      throw new EvaluatorFailure("promise_result", "promise result is not allowed");
    }
    if (value !== "allow" && value !== "deny") {
      throw new EvaluatorFailure("invalid_result", "invalid result");
    }
    const result = value as AccessDecision;
    observations.push({
      authenticated: candidate.authenticated,
      canRead: candidate.canRead,
      result,
      line: formatCanonicalObservation(candidate.authenticated, candidate.canRead, result),
    });
  }
  return observations as [
    LemmaScriptTypescriptObservation,
    LemmaScriptTypescriptObservation,
    LemmaScriptTypescriptObservation,
    LemmaScriptTypescriptObservation,
  ];
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  try {
    return typeof (value as { readonly then?: unknown }).then === "function";
  } catch {
    return true;
  }
}

function silencePromiseRejection(value: PromiseLike<unknown>): void {
  try {
    void value.then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // A hostile thenable is already rejected by the evaluator; no raw reason
    // is useful to a caller and none is emitted.
  }
}

async function withSuppressedProcessOutput<T>(operation: () => Promise<T>): Promise<T> {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    return await operation();
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

function toFailure(error: unknown): LemmaScriptTypescriptEvaluatorFailure {
  if (error instanceof EvaluatorFailure) {
    return { ok: false, status: "failed", code: error.code, message: error.message, lines: [], output: "" };
  }
  return {
    ok: false,
    status: "failed",
    code: "evaluation_failed",
    message: "evaluation failed",
    lines: [],
    output: "",
  };
}

function writeSanitizedStderr(message: string): void {
  const safeMessage = sanitizeMessage(message);
  process.stderr.write(`lemma-script-typescript-evaluator: ${safeMessage}\n`);
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/[\r\n\t]/gu, " ")
    .replace(/[^a-zA-Z0-9 ._-]/gu, "")
    .slice(0, 160);
}

function domainKey(authenticated: boolean, canRead: boolean): string {
  return `${authenticated ? "1" : "0"}:${canRead ? "1" : "0"}`;
}

function isAccessDecision(value: unknown): value is AccessDecision {
  return value === "allow" || value === "deny";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && fileURLToPath(import.meta.url) === resolve(entrypoint)) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
