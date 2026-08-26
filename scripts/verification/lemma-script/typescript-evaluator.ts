import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION,
  LEMMA_SCRIPT_CASE_KEYS,
  type LemmaScriptCaseManifest,
  parseLemmaScriptCases,
  TYPESCRIPT_OBSERVATION_SCHEMA,
} from "./differential-oracle.js";

const EVALUATOR_FUNCTION_NAME = LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION;
const REQUIRED_INPUT_KEYS = new Set(["sourcePath", "functionName", "caseManifestPath"]);
const REQUIRED_ARGUMENTS = new Set(["source", "function", "manifest"]);
let importSequence = 0;

type AccessDecision = "allow" | "deny";

export interface LemmaScriptTypescriptEvaluatorInput {
  readonly sourcePath: string;
  readonly functionName: string;
  readonly caseManifestPath: string;
}

interface LemmaScriptTypescriptObservation {
  readonly authenticated: boolean;
  readonly canRead: boolean;
  readonly result: AccessDecision;
  readonly line: string;
}

type LemmaScriptTypescriptEvaluatorErrorCode =
  | "invalid_input"
  | "invalid_manifest"
  | "export_unavailable"
  | "import_failed"
  | "evaluation_failed"
  | "promise_result"
  | "invalid_result";

interface LemmaScriptTypescriptEvaluatorFailure {
  readonly ok: false;
  readonly code: LemmaScriptTypescriptEvaluatorErrorCode;
  readonly message: string;
  readonly output: "";
}

interface LemmaScriptTypescriptEvaluatorSuccess {
  readonly ok: true;
  readonly lines: readonly [string, string, string, string];
  readonly output: string;
}

type LemmaScriptTypescriptEvaluatorResult =
  | LemmaScriptTypescriptEvaluatorSuccess
  | LemmaScriptTypescriptEvaluatorFailure;

interface ParsedLemmaScriptTypescriptEvaluatorArguments {
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
 * Strictly parse `--name=value` arguments. Positional and space-separated
 * forms are rejected because they make process invocation ambiguous.
 */
function parseArguments(argv: readonly string[]): ParsedLemmaScriptTypescriptEvaluatorArguments {
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
    const manifest = await readManifest(parsedInput.caseManifestPath);
    await assertRegularNonSymlinkSource(parsedInput.sourcePath);
    const observations = await withSuppressedProcessOutput(async () => {
      const namespace = await importSource(parsedInput.sourcePath);
      const exported = getExport(namespace, parsedInput.functionName);
      return evaluateCases(exported, manifest);
    });
    const lines = observations.map(({ line }) => line) as [string, string, string, string];
    return {
      ok: true,
      lines,
      output: `${lines.join("\n")}\n`,
    };
  } catch (error) {
    return toFailure(error);
  }
}

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

async function readManifest(path: string): Promise<LemmaScriptCaseManifest> {
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
  const parsed = parseLemmaScriptCases(value);
  if (parsed.status === "invalid") {
    throw new EvaluatorFailure("invalid_manifest", "manifest is malformed");
  }
  return parsed.value;
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
  manifest: LemmaScriptCaseManifest,
): readonly [
  LemmaScriptTypescriptObservation,
  LemmaScriptTypescriptObservation,
  LemmaScriptTypescriptObservation,
  LemmaScriptTypescriptObservation,
] {
  const byDomain = new Map(
    manifest.inputs.map((candidate) => [`${candidate.authenticated},${candidate.canRead}`, candidate]),
  );
  const observations: LemmaScriptTypescriptObservation[] = [];
  for (const key of LEMMA_SCRIPT_CASE_KEYS) {
    const candidate = byDomain.get(key);
    if (candidate === undefined) throw new EvaluatorFailure("invalid_manifest", "manifest is missing a domain");
    const authenticated = key.startsWith("true,");
    const canRead = key.endsWith(",true");
    let value: unknown;
    try {
      value = accessPolicy(authenticated, canRead);
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
      authenticated,
      canRead,
      result,
      line: `${TYPESCRIPT_OBSERVATION_SCHEMA}|authenticated=${authenticated}|canRead=${canRead}|result=${result}`,
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
    return { ok: false, code: error.code, message: error.message, output: "" };
  }
  return {
    ok: false,
    code: "evaluation_failed",
    message: "evaluation failed",
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
