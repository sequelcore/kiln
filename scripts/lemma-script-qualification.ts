import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { correctnessEfforts, parseDafnyProofLog } from "../packages/core/src/verification/dafny-proof-log.js";
import {
  LEMMA_SCRIPT_ALLOWED_COMMANDS,
  type LEMMA_SCRIPT_DEPENDENCY_BINDING_SCHEMA,
  type LemmaScriptAllowedCommand,
  type LemmaScriptDependencyBindingRejectionCode,
  type LemmaScriptDependencyBindingResult,
  type LemmaScriptRuntimeFact,
  observeLemmaScriptDependencyBinding,
} from "./lemma-script-dependency-binding.js";
import {
  evaluateLemmaScriptQualificationPolicy,
  type LemmaScriptQualificationDiagnosticCode,
  type LemmaScriptQualificationInput as PolicyInput,
  type LemmaScriptQualificationResult as PolicyResult,
} from "./lemma-script-qualification-policy.js";

export interface LemmaScriptQualificationInput {
  readonly sourcePath: string;
  readonly lemmaScriptPackageRoot: string;
  readonly lscScriptPath: string;
  readonly dafnyExecutable: string;
  readonly expectedLemmaScriptVersion: string;
  readonly expectedDafnyVersion: string;
  readonly requiredFunctionNames: readonly string[];
  readonly timeoutMs?: number;
}

export interface LemmaScriptProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface LemmaScriptProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type LemmaScriptProcessRunner = (request: LemmaScriptProcessRequest) => Promise<LemmaScriptProcessResult>;

export interface LemmaScriptQualificationOptions {
  readonly processRunner?: LemmaScriptProcessRunner;
  readonly cleanupWorkspace?: (workspacePath: string) => Promise<void>;
}

export interface LemmaScriptQualificationVersions {
  readonly lemmaScript: {
    readonly expected: string;
    readonly observed: string | null;
  };
  readonly dafny: {
    readonly expected: string;
    readonly observed: string | null;
  };
}

export interface LemmaScriptQualificationDigests {
  readonly source?: string;
  readonly generated?: string;
  readonly proof?: string;
  readonly lemmaScriptExecutable?: string;
  readonly dafnyExecutable?: string;
}

export interface LemmaScriptDependencyBindingSummary {
  readonly schema: typeof LEMMA_SCRIPT_DEPENDENCY_BINDING_SCHEMA;
  readonly digest: string;
  readonly manifestFileCount: number;
  readonly packageCount: number;
  readonly runtime: LemmaScriptRuntimeFact;
  readonly allowedCommands: readonly LemmaScriptAllowedCommand[];
}

export interface LemmaScriptProcessObservation {
  readonly label: ProcessLabel;
  readonly argvRoles: readonly string[];
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
}

export type LemmaScriptVerificationStatus =
  | "passed"
  | "no_checks"
  | "failed"
  | "inconclusive"
  | "diagnostics"
  | "log_missing";

export interface LemmaScriptVerificationFacts {
  readonly status: LemmaScriptVerificationStatus;
  readonly correctnessChecks: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly inconclusive: number;
  };
  readonly diagnostics: number;
}

export interface LemmaScriptQualificationFacts {
  readonly effectiveTimeoutMs: number;
  readonly versions: LemmaScriptQualificationVersions;
  readonly digests: LemmaScriptQualificationDigests;
  readonly processes: readonly LemmaScriptProcessObservation[];
  readonly dependencyBinding?: LemmaScriptDependencyBindingSummary;
  readonly policyEligible?: boolean;
  readonly policyDiagnosticCodes?: readonly LemmaScriptQualificationDiagnosticCode[];
  readonly verification?: LemmaScriptVerificationFacts;
}

interface LemmaScriptQualificationBaseResult {
  readonly semanticEquivalence: "unresolved";
  readonly benchmarkReady: false;
  readonly facts: LemmaScriptQualificationFacts;
  readonly stage?: QualificationStage;
  readonly message?: string;
}

export type LemmaScriptQualificationResult =
  | (LemmaScriptQualificationBaseResult & {
      readonly kind: "invalid_input";
      readonly status: "failed";
      readonly stage: "input";
    })
  | (LemmaScriptQualificationBaseResult & {
      readonly kind: "pipeline_failed";
      readonly status: "failed";
      readonly stage: Exclude<QualificationStage, "input">;
    })
  | (LemmaScriptQualificationBaseResult & {
      readonly kind: "policy_ineligible";
      readonly status: "ineligible";
      readonly stage: "policy";
    })
  | (LemmaScriptQualificationBaseResult & {
      readonly kind: "pipeline_passed";
      readonly status: "passed";
      readonly stage: "complete";
    });

type QualificationStage =
  | "input"
  | "versions"
  | "typed_info"
  | "generation"
  | "proof_integrity"
  | "policy"
  | "dafny_verification"
  | "tool_integrity"
  | "cleanup"
  | "infrastructure"
  | "complete";

type ProcessLabel =
  | "lemmascript_version"
  | "dafny_version"
  | "lemmascript_typed_info"
  | "lemmascript_generate_dafny"
  | "dafny_verify";

interface MutableVersions {
  readonly lemmaScript: {
    readonly expected: string;
    observed: string | null;
  };
  readonly dafny: {
    readonly expected: string;
    observed: string | null;
  };
}

interface MutableDigests {
  source?: string;
  generated?: string;
  proof?: string;
  lemmaScriptExecutable?: string;
  dafnyExecutable?: string;
}

interface MutableExecutionFacts {
  readonly effectiveTimeoutMs: number;
  readonly versions: MutableVersions;
  readonly digests: MutableDigests;
  readonly processes: LemmaScriptProcessObservation[];
  dependencyBinding?: LemmaScriptDependencyBindingSummary;
  policyEligible?: boolean;
  policyDiagnosticCodes?: readonly LemmaScriptQualificationDiagnosticCode[];
  verification?: LemmaScriptVerificationFacts;
}

interface ExecutionContext {
  readonly facts: MutableExecutionFacts;
  readonly sourcePath: string;
  readonly lemmaScriptPackageRoot: string;
  readonly lscScriptPath: string;
  readonly dafnyExecutable: string;
  readonly sourceBytes: Buffer;
  readonly processRunner: LemmaScriptProcessRunner;
  readonly timeoutMs: number;
  readonly initialLemmaScriptDigest: string;
  readonly initialDafnyDigest: string;
  readonly workspacePath: string;
  readonly lscChildEnvironment: NodeJS.ProcessEnv;
  readonly dependencyBindingDigest: string;
}

const CANONICAL_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const DAFNY_VERSION_OUTPUT_PATTERN =
  /^(?:dafny(?:\s+version)?\s+)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:\+[0-9A-Za-z.-]+)?$/iu;
const DEFAULT_TIMEOUT_MS = 30_000;
const CLI_OPTIONS = new Set([
  "source",
  "lsc-root",
  "lsc",
  "dafny",
  "lsc-version",
  "dafny-version",
  "functions",
  "timeout-ms",
]);
const LEMMA_SCRIPT_CHILD_ENVIRONMENT_KEYS = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMP",
  "TEMP",
  "TMPDIR",
  "TEMPDIR",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
]);
const DEPENDENCY_COMMAND_PROFILE = { allowedCommands: [...LEMMA_SCRIPT_ALLOWED_COMMANDS] } as const;
const DEFAULT_PROCESS_RUNNER: LemmaScriptProcessRunner = runLemmaScriptProcess;
const DEFAULT_CLEANUP: NonNullable<LemmaScriptQualificationOptions["cleanupWorkspace"]> = async (workspacePath) => {
  await rm(workspacePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
};

export function buildLemmaScriptChildEnvironment(
  sourceEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(sourceEnvironment)) {
    if (value !== undefined && LEMMA_SCRIPT_CHILD_ENVIRONMENT_KEYS.has(key.toUpperCase())) environment[key] = value;
  }
  return environment;
}

export type LemmaScriptDependencyBindingVerification =
  | { readonly status: "valid"; readonly digest: string }
  | {
      readonly status: "drift";
      readonly observedDigest: string;
    }
  | {
      readonly status: "invalid";
      readonly rejectionCodes: readonly LemmaScriptDependencyBindingRejectionCode[];
    };

export async function verifyLemmaScriptDependencyBinding(
  lemmaScriptPackageRoot: string,
  lscScriptPath: string,
  expectedDigest: string,
): Promise<LemmaScriptDependencyBindingVerification> {
  const observation = await observeCurrentLemmaScriptDependencyBinding(lemmaScriptPackageRoot, lscScriptPath);
  if (observation.status === "invalid") {
    return { status: "invalid", rejectionCodes: observation.rejectionCodes };
  }
  if (observation.facts.digest !== expectedDigest) {
    return { status: "drift", observedDigest: observation.facts.digest };
  }
  return { status: "valid", digest: observation.facts.digest };
}

async function observeCurrentLemmaScriptDependencyBinding(
  lemmaScriptPackageRoot: string,
  lscScriptPath: string,
): Promise<LemmaScriptDependencyBindingResult> {
  return observeLemmaScriptDependencyBinding({
    packageRoot: lemmaScriptPackageRoot,
    entrypointPath: lscScriptPath,
    spawnCwd: lemmaScriptPackageRoot,
    runtimeExecutablePath: process.execPath,
    environment: process.env,
    commandProfile: DEPENDENCY_COMMAND_PROFILE,
  });
}

function dependencyBindingSummary(
  observation: Extract<LemmaScriptDependencyBindingResult, { readonly status: "valid" }>,
): LemmaScriptDependencyBindingSummary {
  return {
    schema: observation.facts.schema,
    digest: observation.facts.digest,
    manifestFileCount: observation.facts.manifest.length,
    packageCount: observation.facts.packages.length,
    runtime: { ...observation.facts.runtime },
    allowedCommands: [...observation.facts.allowedCommands],
  };
}

export async function runLemmaScriptQualification(
  input: LemmaScriptQualificationInput,
  options: LemmaScriptQualificationOptions = {},
): Promise<LemmaScriptQualificationResult> {
  const expectedLemmaScriptVersion =
    typeof input?.expectedLemmaScriptVersion === "string" ? input.expectedLemmaScriptVersion : "";
  const expectedDafnyVersion = typeof input?.expectedDafnyVersion === "string" ? input.expectedDafnyVersion : "";
  const effectiveTimeoutMs = isPositiveFiniteNumber(input?.timeoutMs) ? input.timeoutMs : DEFAULT_TIMEOUT_MS;
  const versions: MutableVersions = {
    lemmaScript: { expected: expectedLemmaScriptVersion, observed: null },
    dafny: { expected: expectedDafnyVersion, observed: null },
  };
  const facts: MutableExecutionFacts = {
    effectiveTimeoutMs,
    versions,
    digests: {},
    processes: [],
  };
  const invalidInput = await validateInput(input);
  if (invalidInput !== undefined) {
    return makeInvalidInput(invalidInput, toFacts(facts));
  }

  const sourcePath = resolve(input.sourcePath);
  const lemmaScriptPackageRoot = resolve(input.lemmaScriptPackageRoot);
  const lscScriptPath = resolve(input.lscScriptPath);
  const dafnyExecutable = resolve(input.dafnyExecutable);
  const dependencyBinding = await observeCurrentLemmaScriptDependencyBinding(lemmaScriptPackageRoot, lscScriptPath);
  if (dependencyBinding.status === "invalid") {
    return makeInvalidInput(
      `LemmaScript dependency binding is invalid (${dependencyBinding.rejectionCodes.join(", ")})`,
      toFacts(facts),
    );
  }
  facts.dependencyBinding = dependencyBindingSummary(dependencyBinding);
  let workspacePath: string | undefined;
  let context: ExecutionContext | undefined;
  let result: LemmaScriptQualificationResult;
  try {
    const sourceBytes = await readFile(sourcePath);
    const lscBytes = await readFile(lscScriptPath);
    const dafnyBytes = await readFile(dafnyExecutable);
    facts.digests.source = digestBytes(sourceBytes);
    facts.digests.lemmaScriptExecutable = digestBytes(lscBytes);
    facts.digests.dafnyExecutable = digestBytes(dafnyBytes);
    workspacePath = await mkdtemp(join(tmpdir(), "kiln-lemma-script-qualification-"));
    context = {
      facts,
      sourcePath,
      lemmaScriptPackageRoot,
      lscScriptPath,
      dafnyExecutable,
      sourceBytes,
      processRunner: options.processRunner ?? DEFAULT_PROCESS_RUNNER,
      timeoutMs: effectiveTimeoutMs,
      initialLemmaScriptDigest: digestBytes(lscBytes),
      initialDafnyDigest: digestBytes(dafnyBytes),
      workspacePath,
      lscChildEnvironment: buildLemmaScriptChildEnvironment(),
      dependencyBindingDigest: dependencyBinding.facts.digest,
    };
    result = await executePipeline(context, input);
  } catch {
    result = makeFailure("infrastructure", "qualification infrastructure failed", toFacts(facts));
  }
  if (context !== undefined) {
    result = await verifyToolIntegrity(context, result);
  }

  if (workspacePath !== undefined) {
    try {
      await (options.cleanupWorkspace ?? DEFAULT_CLEANUP)(workspacePath);
    } catch {
      return makeFailure("cleanup", "qualification workspace cleanup failed", toFacts(facts));
    }
  }
  return result;
}

async function executePipeline(
  context: ExecutionContext,
  input: LemmaScriptQualificationInput,
): Promise<LemmaScriptQualificationResult> {
  const workspacePath = context.workspacePath;
  const stagedSourcePath = join(workspacePath, basename(context.sourcePath));
  const generatedPath = replaceSourceExtension(stagedSourcePath, ".dfy.gen");
  const proofPath = replaceSourceExtension(stagedSourcePath, ".dfy");
  const logFileName = "verification.csv";
  const logPath = join(workspacePath, logFileName);
  await writeFile(stagedSourcePath, context.sourceBytes);
  const sourceDigest = digestBytes(context.sourceBytes);

  const lemmaVersion = await invokeProcess(
    context,
    "lemmascript_version",
    ["lsc_script", "version"],
    [context.lscScriptPath, "version"],
  );
  context.facts.versions.lemmaScript.observed = parseLemmaScriptVersion(lemmaVersion.stdout);

  const dafnyVersion = await invokeProcess(context, "dafny_version", ["dafny_executable", "--version"], ["--version"]);
  context.facts.versions.dafny.observed = parseObservedDafnyVersion(dafnyVersion.stdout);
  if (!isSuccessful(lemmaVersion) || !isSuccessful(dafnyVersion)) {
    return makeFailure("versions", "version command failed", toFacts(context.facts));
  }
  if (context.facts.versions.lemmaScript.observed !== input.expectedLemmaScriptVersion) {
    return makeFailure(
      "versions",
      "LemmaScript version did not match the expected canonical version",
      toFacts(context.facts),
    );
  }
  if (context.facts.versions.dafny.observed !== input.expectedDafnyVersion) {
    return makeFailure(
      "versions",
      "Dafny version did not match the expected canonical version",
      toFacts(context.facts),
    );
  }

  const typedInfoProcess = await invokeProcess(
    context,
    "lemmascript_typed_info",
    ["lsc_script", "info", "--typed", "staged_source"],
    [context.lscScriptPath, "info", "--typed", stagedSourcePath],
  );
  if (!isSuccessful(typedInfoProcess)) {
    return makeFailure("typed_info", "LemmaScript typed-info command failed", toFacts(context.facts));
  }
  let typedInfo: unknown;
  try {
    typedInfo = JSON.parse(typedInfoProcess.stdout) as unknown;
  } catch (error) {
    return makeFailure(
      "typed_info",
      `LemmaScript typed-info was not valid JSON: ${sanitizeMessage(errorMessage(error))}`,
      toFacts(context.facts),
    );
  }
  const missingFunctions = validateTypedFunctionNames(typedInfo, input.requiredFunctionNames);
  if (missingFunctions !== undefined) {
    return makeFailure("typed_info", missingFunctions, toFacts(context.facts));
  }

  const generationProcess = await invokeProcess(
    context,
    "lemmascript_generate_dafny",
    ["lsc_script", "gen", "--backend=dafny", "staged_source"],
    [context.lscScriptPath, "gen", "--backend=dafny", stagedSourcePath],
  );
  if (!isSuccessful(generationProcess)) {
    return makeFailure("generation", "LemmaScript Dafny generation failed", toFacts(context.facts));
  }
  if (digestBytes(await readFile(stagedSourcePath)) !== sourceDigest) {
    return makeFailure("proof_integrity", "staged TypeScript source changed during generation", toFacts(context.facts));
  }

  const generatedBytes = await readRequiredArtifact(generatedPath, "generated Dafny");
  if (generatedBytes === undefined) {
    return makeFailure("generation", "LemmaScript produced no generated Dafny artifact", toFacts(context.facts));
  }
  const proofState = await artifactState(proofPath);
  if (proofState !== "regular") {
    return makeFailure(
      "proof_integrity",
      "LemmaScript produced no regular non-symlink Dafny proof artifact",
      toFacts(context.facts),
    );
  }
  const proofBytes = await readRequiredArtifact(proofPath, "Dafny proof");
  if (proofBytes === undefined) {
    return makeFailure("proof_integrity", "LemmaScript produced no Dafny proof artifact", toFacts(context.facts));
  }
  context.facts.digests.generated = digestBytes(generatedBytes);
  context.facts.digests.proof = digestBytes(proofBytes);
  if (!generatedBytes.equals(proofBytes)) {
    return makeFailure(
      "proof_integrity",
      "generated Dafny and proof bytes differ; proof additions are outside this prepilot",
      toFacts(context.facts),
    );
  }

  let policyResult: PolicyResult;
  try {
    const policyInput: PolicyInput = {
      typedInfo,
      sourceText: context.sourceBytes.toString("utf8"),
      generatedDafny: generatedBytes.toString("utf8"),
      expectedLemmaScriptVersion: input.expectedLemmaScriptVersion,
      requiredFunctionNames: [...input.requiredFunctionNames],
    };
    policyResult = evaluateLemmaScriptQualificationPolicy(policyInput);
  } catch {
    return makeFailure("policy", "LemmaScript qualification policy failed", toFacts(context.facts));
  }
  context.facts.policyEligible = policyResult.status === "eligible";
  context.facts.policyDiagnosticCodes = uniquePolicyDiagnosticCodes(policyResult);
  if (policyResult.status !== "eligible") {
    return {
      kind: "policy_ineligible",
      status: "ineligible",
      stage: "policy",
      semanticEquivalence: "unresolved",
      benchmarkReady: false,
      facts: toFacts(context.facts),
      message: "LemmaScript qualification policy marked the source ineligible",
    };
  }

  const verificationProcess = await invokeProcess(
    context,
    "dafny_verify",
    ["dafny_executable", "verify", "--json-output", "--log-format", "verification_log", "staged_proof"],
    ["verify", "--json-output", "--log-format", `csv;LogFileName=${logFileName}`, proofPath],
  );
  const proofAfterVerification = await readRequiredArtifact(proofPath, "Dafny proof after verification");
  if (proofAfterVerification === undefined || digestBytes(proofAfterVerification) !== context.facts.digests.proof) {
    return makeFailure("proof_integrity", "Dafny verification changed the proof bytes", toFacts(context.facts));
  }
  const verificationFacts = await readVerificationFacts(logPath, verificationProcess);
  context.facts.verification = verificationFacts.facts;
  if (verificationFacts.error !== undefined) {
    return makeFailure("dafny_verification", verificationFacts.error, toFacts(context.facts));
  }
  return {
    kind: "pipeline_passed",
    status: "passed",
    stage: "complete",
    semanticEquivalence: "unresolved",
    benchmarkReady: false,
    facts: toFacts(context.facts),
  };
}

async function verifyToolIntegrity(
  context: ExecutionContext,
  result: LemmaScriptQualificationResult,
): Promise<LemmaScriptQualificationResult> {
  try {
    const dependencyBinding = await verifyLemmaScriptDependencyBinding(
      context.lemmaScriptPackageRoot,
      context.lscScriptPath,
      context.dependencyBindingDigest,
    );
    if (dependencyBinding.status !== "valid") {
      return makeFailure(
        "tool_integrity",
        dependencyBinding.status === "drift"
          ? "the LemmaScript dependency binding changed during qualification"
          : "the LemmaScript dependency binding could not be re-observed after qualification",
        toFacts(context.facts),
      );
    }
    const currentLemmaScriptDigest = digestBytes(await readFile(context.lscScriptPath));
    const currentDafnyDigest = digestBytes(await readFile(context.dafnyExecutable));
    if (
      currentLemmaScriptDigest !== context.initialLemmaScriptDigest ||
      currentDafnyDigest !== context.initialDafnyDigest
    ) {
      return makeFailure(
        "tool_integrity",
        "a verifier executable changed during qualification",
        toFacts(context.facts),
      );
    }
    return result;
  } catch {
    return makeFailure(
      "tool_integrity",
      "could not re-read verifier executables after qualification",
      toFacts(context.facts),
    );
  }
}

interface VerificationFactsResult {
  readonly facts: LemmaScriptVerificationFacts;
  readonly error?: string;
}

async function readVerificationFacts(
  logPath: string,
  processResult: LemmaScriptProcessResult,
): Promise<VerificationFactsResult> {
  let csv: string;
  try {
    const metadata = await lstat(logPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("verification log is not a regular file");
    csv = await readFile(logPath, "utf8");
  } catch {
    const facts = emptyVerificationFacts("log_missing");
    return { facts, error: "Dafny verification log was missing or unreadable" };
  }
  const log = parseDafnyProofLog({ csv, jsonLines: processResult.stdout });
  const efforts = correctnessEfforts(log);
  const counts = {
    total: efforts.length,
    passed: efforts.filter((effort) => effort.outcome === "passed").length,
    failed: efforts.filter((effort) => effort.outcome === "failed").length,
    inconclusive: efforts.filter((effort) => effort.outcome === "inconclusive").length,
  };
  if (log.diagnostics.length > 0) {
    return {
      facts: { status: "diagnostics", correctnessChecks: counts, diagnostics: log.diagnostics.length },
      error: "Dafny verification produced diagnostics",
    };
  }
  if (efforts.length === 0) {
    return {
      facts: { status: "no_checks", correctnessChecks: counts, diagnostics: 0 },
      error: "Dafny verification produced no correctness checks",
    };
  }
  if (counts.failed > 0) {
    return {
      facts: { status: "failed", correctnessChecks: counts, diagnostics: 0 },
      error: "Dafny verification reported a failed correctness check",
    };
  }
  if (counts.inconclusive > 0) {
    return {
      facts: { status: "inconclusive", correctnessChecks: counts, diagnostics: 0 },
      error: "Dafny verification reported an inconclusive correctness check",
    };
  }
  if (!isSuccessful(processResult)) {
    return {
      facts: { status: "failed", correctnessChecks: counts, diagnostics: 0 },
      error: "Dafny verification process did not complete successfully",
    };
  }
  return { facts: { status: "passed", correctnessChecks: counts, diagnostics: 0 } };
}

function emptyVerificationFacts(status: LemmaScriptVerificationStatus): LemmaScriptVerificationFacts {
  return { status, correctnessChecks: { total: 0, passed: 0, failed: 0, inconclusive: 0 }, diagnostics: 0 };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArguments(argv);
  if (parsed.error !== undefined || parsed.input === undefined) {
    process.stdout.write(
      `${JSON.stringify({ kind: "invalid_input", status: "failed", message: sanitizeMessage(parsed.error ?? "invalid arguments") })}\n`,
    );
    return 1;
  }
  const result = await runLemmaScriptQualification(parsed.input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.kind === "pipeline_passed" ? 0 : 1;
}

async function validateInput(input: LemmaScriptQualificationInput): Promise<string | undefined> {
  if (!isRecord(input)) return "input must be an object";
  const paths: readonly [string, unknown][] = [
    ["sourcePath", input.sourcePath],
    ["lscScriptPath", input.lscScriptPath],
    ["dafnyExecutable", input.dafnyExecutable],
  ];
  if (typeof input.lemmaScriptPackageRoot !== "string" || !isAbsolute(input.lemmaScriptPackageRoot)) {
    return "lemmaScriptPackageRoot must be an absolute path";
  }
  for (const [name, value] of paths) {
    if (typeof value !== "string" || !isAbsolute(value)) return `${name} must be an absolute path`;
    if (!(await isRegularNonSymlink(resolve(value)))) return `${name} must refer to a regular non-symlink file`;
  }
  if (typeof input.sourcePath !== "string" || !input.sourcePath.endsWith(".ts")) {
    return "sourcePath must refer to a .ts source file";
  }
  if (
    typeof input.expectedLemmaScriptVersion !== "string" ||
    !CANONICAL_VERSION_PATTERN.test(input.expectedLemmaScriptVersion)
  ) {
    return "expectedLemmaScriptVersion must be a canonical semver";
  }
  if (typeof input.expectedDafnyVersion !== "string" || !CANONICAL_VERSION_PATTERN.test(input.expectedDafnyVersion)) {
    return "expectedDafnyVersion must be a canonical semver";
  }
  if (
    !Array.isArray(input.requiredFunctionNames) ||
    input.requiredFunctionNames.length === 0 ||
    input.requiredFunctionNames.some((name) => typeof name !== "string" || name.trim() === "") ||
    new Set(input.requiredFunctionNames).size !== input.requiredFunctionNames.length
  ) {
    return "requiredFunctionNames must contain unique non-empty function names";
  }
  if (input.timeoutMs !== undefined && !isPositiveFiniteNumber(input.timeoutMs)) {
    return "timeoutMs must be a positive finite number";
  }
  return undefined;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function isRegularNonSymlink(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

type ArtifactState = "missing" | "regular" | "invalid";

async function artifactState(path: string): Promise<ArtifactState> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) return "invalid";
    return "regular";
  } catch {
    return "missing";
  }
}

function replaceSourceExtension(sourcePath: string, suffix: ".dfy.gen" | ".dfy"): string {
  const stem = sourcePath.slice(0, -".ts".length);
  return `${stem}${suffix}`;
}

async function readRequiredArtifact(path: string, label: string): Promise<Buffer | undefined> {
  try {
    if (!(await isRegularNonSymlink(path))) return undefined;
    return await readFile(path);
  } catch (error) {
    throw new Error(`could not read ${label}: ${sanitizeMessage(errorMessage(error))}`);
  }
}

function validateTypedFunctionNames(typedInfo: unknown, requiredNames: readonly string[]): string | undefined {
  if (!isRecord(typedInfo)) return "LemmaScript typed-info must be an object";
  const names = new Set<string>();
  if (Array.isArray(typedInfo.functions)) {
    for (const entry of typedInfo.functions) {
      if (isRecord(entry) && typeof entry.name === "string") names.add(entry.name);
    }
  }
  if (Array.isArray(typedInfo.classes)) {
    for (const entry of typedInfo.classes) {
      if (!isRecord(entry) || typeof entry.name !== "string" || !Array.isArray(entry.methods)) continue;
      for (const method of entry.methods) {
        if (isRecord(method) && typeof method.name === "string") names.add(`${entry.name}.${method.name}`);
      }
    }
  }
  const missing = requiredNames.filter((name) => !names.has(name));
  return missing.length === 0
    ? undefined
    : `LemmaScript typed-info is missing required function(s): ${missing.join(", ")}`;
}

async function invokeProcess(
  context: ExecutionContext,
  label: ProcessLabel,
  argvRoles: readonly string[],
  args: readonly string[],
): Promise<LemmaScriptProcessResult> {
  const lscProcess =
    label === "lemmascript_version" || label === "lemmascript_typed_info" || label === "lemmascript_generate_dafny";
  const request: LemmaScriptProcessRequest = {
    executable: label === "dafny_version" || label === "dafny_verify" ? context.dafnyExecutable : process.execPath,
    args: [...args],
    cwd: lscProcess ? context.lemmaScriptPackageRoot : context.workspacePath,
    timeoutMs: context.timeoutMs,
    ...(lscProcess ? { env: context.lscChildEnvironment } : {}),
  };
  let outcome: LemmaScriptProcessResult;
  try {
    outcome = normalizeProcessResult(await context.processRunner(request));
  } catch (error) {
    outcome = {
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: sanitizeMessage(errorMessage(error)),
      timedOut: false,
    };
  }
  context.facts.processes.push({
    label,
    argvRoles: [...argvRoles],
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    stdoutDigest: digestBytes(Buffer.from(outcome.stdout, "utf8")),
    stderrDigest: digestBytes(Buffer.from(outcome.stderr, "utf8")),
  });
  return outcome;
}

function normalizeProcessResult(result: LemmaScriptProcessResult): LemmaScriptProcessResult {
  return {
    exitCode: typeof result.exitCode === "number" || result.exitCode === null ? result.exitCode : null,
    signal: typeof result.signal === "string" || result.signal === null ? result.signal : null,
    stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? ""),
    stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? ""),
    timedOut: result.timedOut === true,
  };
}

function isSuccessful(result: LemmaScriptProcessResult): boolean {
  return result.exitCode === 0 && result.signal === null && !result.timedOut;
}

function parseLemmaScriptVersion(output: string): string | null {
  const observed = output.trim();
  return CANONICAL_VERSION_PATTERN.test(observed) ? observed : null;
}

function parseObservedDafnyVersion(output: string): string | null {
  const match = DAFNY_VERSION_OUTPUT_PATTERN.exec(output.trim());
  return match?.[1] ?? null;
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function toFacts(facts: MutableExecutionFacts): LemmaScriptQualificationFacts {
  return {
    effectiveTimeoutMs: facts.effectiveTimeoutMs,
    versions: facts.versions,
    digests: { ...facts.digests },
    processes: facts.processes.map((process) => ({ ...process, argvRoles: [...process.argvRoles] })),
    ...(facts.dependencyBinding === undefined ? {} : { dependencyBinding: facts.dependencyBinding }),
    ...(facts.policyEligible === undefined ? {} : { policyEligible: facts.policyEligible }),
    ...(facts.policyDiagnosticCodes === undefined ? {} : { policyDiagnosticCodes: [...facts.policyDiagnosticCodes] }),
    ...(facts.verification === undefined ? {} : { verification: facts.verification }),
  };
}

function uniquePolicyDiagnosticCodes(result: PolicyResult): readonly LemmaScriptQualificationDiagnosticCode[] {
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
  return [...new Set(codes)];
}

function makeInvalidInput(message: string, facts: LemmaScriptQualificationFacts): LemmaScriptQualificationResult {
  return {
    kind: "invalid_input",
    status: "failed",
    stage: "input",
    semanticEquivalence: "unresolved",
    benchmarkReady: false,
    facts,
    message: sanitizeMessage(message),
  };
}

function makeFailure(
  stage: Exclude<QualificationStage, "input" | "complete">,
  message: string,
  facts: LemmaScriptQualificationFacts,
): LemmaScriptQualificationResult {
  return {
    kind: "pipeline_failed",
    status: "failed",
    stage,
    semanticEquivalence: "unresolved",
    benchmarkReady: false,
    facts,
    message: sanitizeMessage(message),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/[A-Za-z]:[\\/][^\s|;]+/gu, "<path>")
    .replace(/(^|[\s(])\/(?:[^/\s|;]+\/)+[^/\s|;]*/gu, "$1<path>");
}

export async function runLemmaScriptProcess(request: LemmaScriptProcessRequest): Promise<LemmaScriptProcessResult> {
  return await new Promise((resolvePromise) => {
    const child = (() => {
      try {
        return spawn(request.executable, [...request.args], {
          cwd: request.cwd,
          env: request.env,
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        resolvePromise({
          exitCode: null,
          signal: null,
          stdout: "",
          stderr: sanitizeMessage(errorMessage(error)),
          timedOut: false,
        });
        return undefined;
      }
    })();
    if (child === undefined) return;
    if (child.stdout === null || child.stderr === null) {
      child.kill();
      resolvePromise({
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "process did not expose piped output",
        timedOut: false,
      });
      return;
    }

    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let hardSettleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      if (hardSettleTimer !== undefined) clearTimeout(hardSettleTimer);
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      resolvePromise({ exitCode, signal, stdout, stderr, timedOut });
    };
    const stop = async (): Promise<void> => {
      if (settled) return;
      if (forceKillTimer === undefined) {
        forceKillTimer = setTimeout(() => {
          if (settled) return;
          let signalled = false;
          if (process.platform !== "win32" && child.pid !== undefined) {
            try {
              process.kill(-child.pid, "SIGKILL");
              signalled = true;
            } catch {
              // The child may have exited between the state check and the escalation.
            }
          }
          if (!signalled) child.kill("SIGKILL");
          hardSettleTimer = setTimeout(() => finish(null, "SIGKILL"), 250);
        }, 250);
      }
      if (process.platform === "win32" && child.pid !== undefined) {
        await new Promise<void>((resolveKill) => {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
          killer.once("error", () => {
            child.kill();
            resolveKill();
          });
          killer.once("close", () => resolveKill());
        });
        return;
      }
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
          return;
        } catch {
          // The child may have exited between the state check and the signal.
        }
      }
      child.kill("SIGTERM");
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (!settled) stdout += stdoutDecoder.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!settled) stderr += stderrDecoder.write(chunk);
    });
    child.once("error", (error) => {
      stderr += sanitizeMessage(errorMessage(error));
      finish(null, null);
    });
    child.once("close", (exitCode, signal) => finish(exitCode, signal));
    if (request.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        void stop();
      }, request.timeoutMs);
    }
  });
}

interface ParsedArguments {
  readonly input?: LemmaScriptQualificationInput;
  readonly error?: string;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const values = new Map<string, string>();
  for (const argument of argv) {
    if (!argument.startsWith("--")) return { error: "unexpected positional argument" };
    const separator = argument.indexOf("=");
    if (separator <= 2) return { error: "arguments must use --name=value" };
    const name = argument.slice(2, separator);
    if (!CLI_OPTIONS.has(name)) return { error: `unknown option: --${name}` };
    if (values.has(name)) return { error: `duplicate option: --${name}` };
    values.set(name, argument.slice(separator + 1));
  }
  const sourcePath = values.get("source");
  const lemmaScriptPackageRoot = values.get("lsc-root");
  const lscScriptPath = values.get("lsc");
  const dafnyExecutable = values.get("dafny");
  const expectedLemmaScriptVersion = values.get("lsc-version");
  const expectedDafnyVersion = values.get("dafny-version");
  const functions = values.get("functions");
  if (
    sourcePath === undefined ||
    lemmaScriptPackageRoot === undefined ||
    lscScriptPath === undefined ||
    dafnyExecutable === undefined ||
    expectedLemmaScriptVersion === undefined ||
    expectedDafnyVersion === undefined ||
    functions === undefined
  ) {
    return { error: "required options are missing" };
  }
  const timeoutText = values.get("timeout-ms");
  const timeoutMs = timeoutText === undefined ? undefined : Number(timeoutText);
  return {
    input: {
      sourcePath,
      lemmaScriptPackageRoot,
      lscScriptPath,
      dafnyExecutable,
      expectedLemmaScriptVersion,
      expectedDafnyVersion,
      requiredFunctionNames: functions
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
  };
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && fileURLToPath(import.meta.url) === resolve(entrypoint)) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
