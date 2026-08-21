import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionEffectEnvelope, DevTool, ToolInput, ToolResult } from "@kilnai/core";

/** The only source location a model invocation may cause this host tool to inspect. */
export const LEMMA_CHECK_CANDIDATE_RELATIVE_PATH = "src/solution.ts" as const;

/**
 * lemma_check is an experimental local observation.  It is deliberately not
 * a formal-verification or work-governance capability.
 */
export const LEMMA_CHECK_EFFECT: ActionEffectEnvelope = Object.freeze({
  operation: "observe",
  boundaries: ["process"] as const,
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [] as const,
  idempotency: "idempotent",
});

const DEFAULT_QUALIFICATION_SCRIPT_PATH = fileURLToPath(
  new URL("../../../../scripts/lemma-script-qualification.ts", import.meta.url),
);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const ALLOWED_POLICY_CODES = new Set<string>([
  "input-shape",
  "schema-mismatch",
  "version-mismatch",
  "unsupported-backend",
  "dafny-error",
  "externs-present",
  "classes-present",
  "missing-function",
  "missing-contract",
  "function-not-pure",
  "force-pure",
  "autohavoc",
  "unsupported-body-kind",
  "numeric-semantics",
  "unsupported-target-type",
  "source-directive",
  "generated-trust-pattern",
]);
const ALLOWED_PROCESS_LABELS = new Set<string>([
  "lemmascript_version",
  "dafny_version",
  "lemmascript_typed_info",
  "lemmascript_generate_dafny",
  "dafny_verify",
]);
const ALLOWED_ARG_ROLES = new Set<string>([
  "lsc_script",
  "dafny_executable",
  "version",
  "--version",
  "info",
  "--typed",
  "gen",
  "--backend=dafny",
  "verify",
  "--json-output",
  "--log-format",
  "verification_log",
  "staged_source",
  "staged_proof",
]);

export interface LemmaCheckToolchain {
  readonly lemmaScriptPackageRoot: string;
  readonly lscScriptPath: string;
  readonly dafnyExecutable: string;
  readonly expectedLemmaScriptVersion: string;
  readonly expectedDafnyVersion: string;
}

export interface LemmaCheckSubprocessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface LemmaCheckSubprocessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type LemmaCheckSubprocessRunner = (
  request: LemmaCheckSubprocessRequest,
) => Promise<LemmaCheckSubprocessResult>;

export interface LemmaCheckToolOptions {
  readonly requiredFunctionNames: readonly string[];
  readonly toolchain: LemmaCheckToolchain;
  readonly timeoutMs: number;
  /** Host-only test/packaging override; never model input. */
  readonly qualificationScriptPath?: string;
  /** Injectable subprocess runner. Production defaults to a Bun child process. */
  readonly runner?: LemmaCheckSubprocessRunner;
}

export interface LemmaCheckQualificationVersions {
  readonly lemmaScript: { readonly expected: string; readonly observed: string | null };
  readonly dafny: { readonly expected: string; readonly observed: string | null };
}

export interface LemmaCheckQualificationDigests {
  readonly source?: string;
  readonly generated?: string;
  readonly proof?: string;
  readonly lemmaScriptExecutable?: string;
  readonly dafnyExecutable?: string;
}

export interface LemmaCheckProcessObservation {
  readonly label: string;
  readonly argvRoles: readonly string[];
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
}

export interface LemmaCheckDependencyBindingSummary {
  readonly digest: string;
}

export interface LemmaCheckVerificationFacts {
  readonly status: string;
  readonly correctnessChecks: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly inconclusive: number;
  };
  readonly diagnostics: number;
}

export interface LemmaCheckQualificationFacts {
  readonly effectiveTimeoutMs: number;
  readonly versions: LemmaCheckQualificationVersions;
  readonly digests: LemmaCheckQualificationDigests;
  readonly processes: readonly LemmaCheckProcessObservation[];
  readonly dependencyBinding?: LemmaCheckDependencyBindingSummary;
  readonly policyEligible?: boolean;
  readonly policyDiagnosticCodes?: readonly string[];
  readonly verification?: LemmaCheckVerificationFacts;
}

export interface LemmaCheckQualificationResult {
  readonly kind: "invalid_input" | "pipeline_failed" | "policy_ineligible" | "pipeline_passed";
  readonly status: "failed" | "ineligible" | "passed";
  readonly stage: string;
  readonly semanticEquivalence: "unresolved";
  readonly benchmarkReady: false;
  readonly facts: LemmaCheckQualificationFacts;
  readonly message?: string;
}

export type LemmaCheckOutputStage =
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
  | "complete"
  | "process"
  | "timeout"
  | "output_parse"
  | "source_drift";

export interface LemmaCheckOutput {
  readonly kind: string;
  readonly status: "failed" | "ineligible" | "passed";
  readonly stage: LemmaCheckOutputStage;
  readonly versions: LemmaCheckQualificationVersions;
  readonly digests: {
    readonly source?: string;
    readonly sourceBefore?: string;
    readonly sourceAfter?: string;
    readonly generated?: string;
    readonly proof?: string;
    readonly lemmaScriptExecutable?: string;
    readonly dafnyExecutable?: string;
    readonly dependencyBinding?: string;
  };
  readonly processes: readonly LemmaCheckProcessObservation[];
  readonly policyEligible: boolean;
  readonly diagnosticCodes: readonly string[];
  readonly verification?: LemmaCheckVerificationFacts;
  readonly semanticEquivalence: "unresolved";
  readonly benchmarkReady: false;
}

interface HostPaths {
  readonly workspacePath: string;
  readonly canonicalWorkspacePath: string;
  readonly candidatePath: string;
}

export class LemmaCheckTool implements DevTool {
  readonly name = "lemma_check";
  readonly description = [
    "Screen the host-fixed src/solution.ts through the experimental LemmaScript qualification pipeline.",
    "Returns compact local facts only; it is not formal verification, acceptance, assurance, or work governance.",
  ].join(" ");
  readonly inputSchema = {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  } as const;
  readonly effectEnvelope = LEMMA_CHECK_EFFECT;

  private readonly workspacePath: string;
  private readonly options: LemmaCheckToolOptions;

  constructor(workspacePath: string, options: LemmaCheckToolOptions) {
    this.workspacePath = workspacePath;
    this.options = options;
  }

  async execute(input: ToolInput): Promise<ToolResult> {
    const output = await this.screen(input);
    return {
      output: JSON.stringify(output),
      isError: output.status !== "passed",
    };
  }

  private async screen(input: ToolInput): Promise<LemmaCheckOutput> {
    const inputError = validateModelInput(input);
    if (inputError !== undefined) return makeFailure("input", [inputError]);

    const configError = validateOptions(this.workspacePath, this.options);
    if (configError !== undefined) return makeFailure("input", [configError]);
    const expectedVersions = configuredVersions(this.options.toolchain);

    const paths = await resolveHostPaths(this.workspacePath);
    if (typeof paths === "string") return makeFailure("input", [paths], expectedVersions);
    const toolchainError = await validateToolchain(this.options.toolchain);
    if (toolchainError !== undefined) return makeFailure("input", [toolchainError], expectedVersions);
    const toolchainBefore = await readToolchainDigests(this.options.toolchain);
    if (toolchainBefore === undefined) return makeFailure("input", ["tool-integrity"], expectedVersions);

    const sourceBefore = await readCandidateDigest(paths);
    if (sourceBefore === undefined) return makeFailure("input", ["candidate-invalid"], expectedVersions);

    const request = createQualificationRequest(paths, this.options);
    const runner = this.options.runner ?? runBunQualificationProcess;
    let processResult: LemmaCheckSubprocessResult;
    try {
      processResult = normalizeSubprocessResult(await runner(request));
    } catch {
      processResult = { exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false };
    }

    const sourceAfter = await readCandidateDigest(paths);
    const toolchainAfter = await readToolchainDigests(this.options.toolchain);
    const sourceDrifted = sourceAfter === undefined || sourceAfter !== sourceBefore;
    const toolchainDrifted = toolchainAfter === undefined || !sameToolchainDigests(toolchainBefore, toolchainAfter);
    const baseDigests = {
      sourceBefore,
      ...(sourceAfter === undefined ? {} : { sourceAfter }),
    };

    if (sourceDrifted) {
      return makeFailure("source_drift", ["source-drift"], expectedVersions, baseDigests);
    }
    if (toolchainDrifted) {
      return makeFailure("tool_integrity", ["tool-integrity"], expectedVersions, baseDigests);
    }
    if (processResult.timedOut) {
      return makeFailure("timeout", ["timeout"], expectedVersions, baseDigests);
    }
    if (!isSuccessfulSubprocess(processResult)) {
      return makeFailure("process", ["process-failed"], expectedVersions, baseDigests);
    }

    const parsed = parseQualificationOutput(processResult.stdout, this.options);
    if (typeof parsed === "string") return makeFailure("output_parse", [parsed], expectedVersions, baseDigests);

    const output = projectQualification(parsed, baseDigests);
    if (output.digests.source !== undefined && output.digests.source !== sourceBefore) {
      return makeFailure("source_drift", ["source-drift"], output.versions, baseDigests);
    }
    return output;
  }
}

export function createLemmaCheckTool(
  workspacePath: string,
  options: LemmaCheckToolOptions,
): LemmaCheckTool {
  return new LemmaCheckTool(workspacePath, options);
}

function validateModelInput(input: ToolInput): string | undefined {
  if (!isRecord(input) || input.name !== "lemma_check" || !isRecord(input.input)) return "invalid-input";
  if (Object.keys(input.input).length !== 0) return "invalid-input";
  return undefined;
}

function validateOptions(workspacePath: string, options: LemmaCheckToolOptions): string | undefined {
  if (!isRecord(options) || typeof workspacePath !== "string" || !isAbsolute(workspacePath)) {
    return "invalid-input";
  }
  if (
    !Array.isArray(options.requiredFunctionNames) ||
    options.requiredFunctionNames.length === 0 ||
    options.requiredFunctionNames.some((name) => typeof name !== "string" || name.trim().length === 0) ||
    new Set(options.requiredFunctionNames).size !== options.requiredFunctionNames.length
  ) {
    return "invalid-input";
  }
  if (!isPositiveFiniteNumber(options.timeoutMs)) return "timeout";
  const toolchain = options.toolchain;
  if (!isRecord(toolchain)) return "invalid-input";
  const paths = [toolchain.lemmaScriptPackageRoot, toolchain.lscScriptPath, toolchain.dafnyExecutable];
  if (paths.some((path) => typeof path !== "string" || !isAbsolute(path))) return "invalid-input";
  if (
    typeof toolchain.expectedLemmaScriptVersion !== "string" ||
    !VERSION_PATTERN.test(toolchain.expectedLemmaScriptVersion) ||
    typeof toolchain.expectedDafnyVersion !== "string" ||
    !VERSION_PATTERN.test(toolchain.expectedDafnyVersion)
  ) {
    return "version-mismatch";
  }
  return undefined;
}

async function resolveHostPaths(workspacePath: string): Promise<HostPaths | string> {
  try {
    const workspaceMetadata = await lstat(workspacePath);
    if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) return "workspace-containment";
    const canonicalWorkspace = await realpath(workspacePath);
    const candidatePath = resolve(workspacePath, LEMMA_CHECK_CANDIDATE_RELATIVE_PATH);
    const candidateMetadata = await lstat(candidatePath);
    if (!candidateMetadata.isFile() || candidateMetadata.isSymbolicLink()) return "candidate-invalid";
    const canonicalCandidate = await realpath(candidatePath);
    if (!isContained(canonicalWorkspace, canonicalCandidate)) return "workspace-containment";
    return {
      workspacePath: resolve(workspacePath),
      canonicalWorkspacePath: canonicalWorkspace,
      candidatePath,
    };
  } catch {
    return "workspace-containment";
  }
}

async function validateToolchain(toolchain: LemmaCheckToolchain): Promise<string | undefined> {
  try {
    const packageRoot = await lstat(toolchain.lemmaScriptPackageRoot);
    if (!packageRoot.isDirectory() || packageRoot.isSymbolicLink()) return "binding-invalid";
    for (const path of [toolchain.lscScriptPath, toolchain.dafnyExecutable]) {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) return "tool-integrity";
    }
    const canonicalPackageRoot = await realpath(toolchain.lemmaScriptPackageRoot);
    const canonicalEntrypoint = await realpath(toolchain.lscScriptPath);
    if (!isContained(canonicalPackageRoot, canonicalEntrypoint)) return "binding-invalid";
    return undefined;
  } catch {
    return "tool-integrity";
  }
}

function configuredVersions(toolchain: LemmaCheckToolchain): LemmaCheckQualificationVersions {
  return {
    lemmaScript: { expected: toolchain.expectedLemmaScriptVersion, observed: null },
    dafny: { expected: toolchain.expectedDafnyVersion, observed: null },
  };
}

function isContained(root: string, child: string): boolean {
  const childRelative = relative(root, child);
  return childRelative.length > 0 && !childRelative.startsWith("..") && !isAbsolute(childRelative);
}

async function readCandidateDigest(paths: HostPaths): Promise<string | undefined> {
  try {
    const metadata = await lstat(paths.candidatePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return undefined;
    const canonicalCandidate = await realpath(paths.candidatePath);
    if (!isContained(paths.canonicalWorkspacePath, canonicalCandidate)) return undefined;
    return digestBytes(await readFile(paths.candidatePath));
  } catch {
    return undefined;
  }
}

interface ToolchainDigests {
  readonly lemmaScriptExecutable: string;
  readonly dafnyExecutable: string;
}

async function readToolchainDigests(toolchain: LemmaCheckToolchain): Promise<ToolchainDigests | undefined> {
  try {
    const [lscMetadata, dafnyMetadata] = await Promise.all([
      lstat(toolchain.lscScriptPath),
      lstat(toolchain.dafnyExecutable),
    ]);
    if (
      !lscMetadata.isFile() || lscMetadata.isSymbolicLink() ||
      !dafnyMetadata.isFile() || dafnyMetadata.isSymbolicLink()
    ) return undefined;
    const [lscBytes, dafnyBytes] = await Promise.all([
      readFile(toolchain.lscScriptPath),
      readFile(toolchain.dafnyExecutable),
    ]);
    return {
      lemmaScriptExecutable: digestBytes(lscBytes),
      dafnyExecutable: digestBytes(dafnyBytes),
    };
  } catch {
    return undefined;
  }
}

function sameToolchainDigests(left: ToolchainDigests, right: ToolchainDigests): boolean {
  return left.lemmaScriptExecutable === right.lemmaScriptExecutable && left.dafnyExecutable === right.dafnyExecutable;
}

function createQualificationRequest(
  paths: HostPaths,
  options: LemmaCheckToolOptions,
): LemmaCheckSubprocessRequest {
  const toolchain = options.toolchain;
  const scriptPath = options.qualificationScriptPath ?? DEFAULT_QUALIFICATION_SCRIPT_PATH;
  const args = [
    scriptPath,
    `--source=${paths.candidatePath}`,
    `--lsc-root=${toolchain.lemmaScriptPackageRoot}`,
    `--lsc=${toolchain.lscScriptPath}`,
    `--dafny=${toolchain.dafnyExecutable}`,
    `--lsc-version=${toolchain.expectedLemmaScriptVersion}`,
    `--dafny-version=${toolchain.expectedDafnyVersion}`,
    `--functions=${options.requiredFunctionNames.join(",")}`,
    `--timeout-ms=${String(options.timeoutMs)}`,
  ];
  return {
    executable: process.execPath,
    args,
    cwd: paths.workspacePath,
    timeoutMs: options.timeoutMs,
    env: buildTrustedBunEnvironment(),
  };
}

function buildTrustedBunEnvironment(sourceEnvironment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowedKeys = new Set([
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
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(sourceEnvironment)) {
    if (value !== undefined && allowedKeys.has(key.toUpperCase())) environment[key] = value;
  }
  return environment;
}

export async function runBunQualificationProcess(
  request: LemmaCheckSubprocessRequest,
): Promise<LemmaCheckSubprocessResult> {
  return await new Promise((settle) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(request.executable, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      settle({ exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false });
      return;
    }
    if (child.stdout === null || child.stderr === null) {
      child.kill();
      settle({ exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      settle({ exitCode, signal, stdout, stderr, timedOut });
    };
    child.stdout.on("data", (chunk: Buffer) => { if (!settled) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { if (!settled) stderr += chunk.toString("utf8"); });
    child.once("error", () => finish(null, null));
    child.once("close", (exitCode, signal) => finish(exitCode, signal));
    timer = setTimeout(() => {
      timedOut = true;
      if (process.platform !== "win32" && child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      } else {
        child.kill("SIGTERM");
      }
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
          finish(null, "SIGKILL");
        }
      }, 250).unref?.();
    }, request.timeoutMs);
  });
}

function normalizeSubprocessResult(result: LemmaCheckSubprocessResult): LemmaCheckSubprocessResult {
  return {
    exitCode: typeof result?.exitCode === "number" || result?.exitCode === null ? result.exitCode : null,
    signal: typeof result?.signal === "string" || result?.signal === null ? result.signal : null,
    stdout: typeof result?.stdout === "string" ? result.stdout : "",
    stderr: typeof result?.stderr === "string" ? result.stderr : "",
    timedOut: result?.timedOut === true,
  };
}

function isSuccessfulSubprocess(result: LemmaCheckSubprocessResult): boolean {
  return result.exitCode === 0 && result.signal === null && !result.timedOut;
}

function parseQualificationOutput(
  stdout: string,
  options: LemmaCheckToolOptions,
): LemmaCheckQualificationResult | string {
  let value: unknown;
  try {
    if (stdout.trim().length === 0) return "output-parse";
    value = JSON.parse(stdout);
  } catch {
    return "output-parse";
  }
  if (!isRecord(value)) return "output-parse";
  const facts = value.facts;
  if (!isRecord(facts) || value.semanticEquivalence !== "unresolved" || value.benchmarkReady !== false) {
    return "output-parse";
  }
  if (!isQualificationVersions(facts.versions, options.toolchain)) return "output-parse";
  if (!isRecord(facts.digests) || !Array.isArray(facts.processes)) return "output-parse";
  if (!isValidDigestRecord(facts.digests)) return "output-parse";
  if (facts.processes.some((process) => !isProcessObservation(process))) return "output-parse";
  if (facts.policyDiagnosticCodes !== undefined) {
    if (!Array.isArray(facts.policyDiagnosticCodes) || facts.policyDiagnosticCodes.some((code) =>
      typeof code !== "string" || !ALLOWED_POLICY_CODES.has(code)
    )) return "unsupported-policy";
  }
  if (facts.policyEligible !== undefined && typeof facts.policyEligible !== "boolean") return "output-parse";
  if (facts.verification !== undefined && !isVerificationFacts(facts.verification)) return "output-parse";
  if (value.kind !== "invalid_input" && value.kind !== "pipeline_failed" && value.kind !== "policy_ineligible" && value.kind !== "pipeline_passed") {
    return "output-parse";
  }
  if (value.status !== "failed" && value.status !== "ineligible" && value.status !== "passed") return "output-parse";
  if (typeof value.stage !== "string" || !isRawQualificationStage(value.stage)) return "output-parse";
  if (value.kind === "pipeline_passed") {
    if (
      value.status !== "passed" || facts.policyEligible !== true || facts.policyDiagnosticCodes === undefined ||
      facts.dependencyBinding === undefined || !isRecord(facts.dependencyBinding) ||
      !validDigest(facts.dependencyBinding.digest) ||
      !validDigest(facts.digests.source) || !validDigest(facts.digests.generated) ||
      !validDigest(facts.digests.proof) || !validDigest(facts.digests.lemmaScriptExecutable) ||
      !validDigest(facts.digests.dafnyExecutable) || facts.verification === undefined ||
      !isVerificationFacts(facts.verification)
    ) return "output-parse";
  }
  if (value.kind === "policy_ineligible") {
    if (
      value.status !== "ineligible" || facts.policyEligible !== false || facts.policyDiagnosticCodes === undefined ||
      facts.dependencyBinding === undefined || !isRecord(facts.dependencyBinding) ||
      !validDigest(facts.dependencyBinding.digest) || !validDigest(facts.digests.source) ||
      !validDigest(facts.digests.generated) || !validDigest(facts.digests.proof) ||
      !validDigest(facts.digests.lemmaScriptExecutable) || !validDigest(facts.digests.dafnyExecutable)
    ) return "output-parse";
  }
  if (
    (value.kind === "invalid_input" && (value.status !== "failed" || value.stage !== "input")) ||
    (value.kind === "pipeline_failed" && (value.status !== "failed" || value.stage === "input" || value.stage === "complete")) ||
    (value.kind === "policy_ineligible" && value.stage !== "policy") ||
    (value.kind === "pipeline_passed" && (value.status !== "passed" || value.stage !== "complete"))
  ) return "output-parse";
  return value as unknown as LemmaCheckQualificationResult;
}

function isQualificationVersions(value: unknown, toolchain: LemmaCheckToolchain): value is LemmaCheckQualificationVersions {
  if (!isRecord(value) || !isRecord(value.lemmaScript) || !isRecord(value.dafny)) return false;
  return (
    value.lemmaScript.expected === toolchain.expectedLemmaScriptVersion &&
    value.dafny.expected === toolchain.expectedDafnyVersion &&
    (value.lemmaScript.observed === null || isVersion(value.lemmaScript.observed)) &&
    (value.dafny.observed === null || isVersion(value.dafny.observed))
  );
}

function isProcessObservation(value: unknown): value is LemmaCheckProcessObservation {
  if (!isRecord(value) || typeof value.label !== "string" || !ALLOWED_PROCESS_LABELS.has(value.label)) return false;
  if (!Array.isArray(value.argvRoles) || value.argvRoles.some((role) => typeof role !== "string" || !ALLOWED_ARG_ROLES.has(role))) return false;
  if (!(value.exitCode === null || (typeof value.exitCode === "number" && Number.isInteger(value.exitCode)))) return false;
  if (!(typeof value.signal === "string" || value.signal === null) || typeof value.timedOut !== "boolean") return false;
  return DIGEST_PATTERN.test(String(value.stdoutDigest)) && DIGEST_PATTERN.test(String(value.stderrDigest));
}

function isVerificationFacts(value: unknown): value is LemmaCheckVerificationFacts {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  const diagnostics = value.diagnostics;
  if (typeof diagnostics !== "number" || !Number.isInteger(diagnostics) || diagnostics < 0) return false;
  const counts = value.correctnessChecks;
  if (!isRecord(counts)) return false;
  return [counts.total, counts.passed, counts.failed, counts.inconclusive].every(
    (count) => typeof count === "number" && Number.isInteger(count) && count >= 0,
  );
}

function isValidDigestRecord(value: Record<string, unknown>): boolean {
  for (const key of ["source", "generated", "proof", "lemmaScriptExecutable", "dafnyExecutable"]) {
    const candidate = value[key];
    if (candidate !== undefined && !validDigest(candidate)) return false;
  }
  return true;
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

function isRawQualificationStage(value: string): boolean {
  return new Set([
    "input", "versions", "typed_info", "generation", "proof_integrity", "policy",
    "dafny_verification", "tool_integrity", "cleanup", "infrastructure", "complete",
  ]).has(value);
}

function projectQualification(
  result: LemmaCheckQualificationResult,
  sourceDigests: Pick<LemmaCheckOutput["digests"], "sourceBefore" | "sourceAfter">,
): LemmaCheckOutput {
  const facts = result.facts;
  const digests = {
    ...sourceDigests,
    ...(validDigest(facts.digests.source) ? { source: facts.digests.source } : {}),
    ...(validDigest(facts.digests.generated) ? { generated: facts.digests.generated } : {}),
    ...(validDigest(facts.digests.proof) ? { proof: facts.digests.proof } : {}),
    ...(validDigest(facts.digests.lemmaScriptExecutable) ? { lemmaScriptExecutable: facts.digests.lemmaScriptExecutable } : {}),
    ...(validDigest(facts.digests.dafnyExecutable) ? { dafnyExecutable: facts.digests.dafnyExecutable } : {}),
    ...(facts.dependencyBinding && validDigest(facts.dependencyBinding.digest)
      ? { dependencyBinding: facts.dependencyBinding.digest }
      : {}),
  };
  const diagnosticCodes = boundedDiagnosticCodes(result, facts);
  return {
    kind: result.kind,
    status: result.status,
    stage: isOutputStage(result.stage) ? result.stage : "output_parse",
    versions: facts.versions,
    digests,
    processes: facts.processes,
    policyEligible: facts.policyEligible === true,
    diagnosticCodes,
    ...(facts.verification === undefined ? {} : { verification: facts.verification }),
    semanticEquivalence: "unresolved",
    benchmarkReady: false,
  };
}

function boundedDiagnosticCodes(
  result: LemmaCheckQualificationResult,
  facts: LemmaCheckQualificationFacts,
): readonly string[] {
  const policyCodes = facts.policyDiagnosticCodes ?? [];
  if (policyCodes.length > 0) return [...new Set(policyCodes)];
  const stageCode: Record<string, string> = {
    input: "invalid-input",
    versions: "version-mismatch",
    typed_info: "typed-info",
    generation: "generation",
    proof_integrity: "proof-integrity",
    policy: "policy",
    dafny_verification: "dafny-verification",
    tool_integrity: "tool-integrity",
    cleanup: "cleanup",
    infrastructure: "infrastructure",
  };
  const code = stageCode[result.stage];
  return code === undefined || result.status === "passed" ? [] : [code];
}

function isOutputStage(value: string): value is LemmaCheckOutputStage {
  return new Set<LemmaCheckOutputStage>([
    "input", "versions", "typed_info", "generation", "proof_integrity", "policy",
    "dafny_verification", "tool_integrity", "cleanup", "infrastructure", "complete",
    "process", "timeout", "output_parse", "source_drift",
  ]).has(value as LemmaCheckOutputStage);
}

function makeFailure(
  stage: LemmaCheckOutputStage,
  diagnosticCodes: readonly string[],
  versions?: LemmaCheckQualificationVersions,
  digests: Pick<LemmaCheckOutput["digests"], "sourceBefore" | "sourceAfter"> = {},
): LemmaCheckOutput {
  return {
    kind: stage === "input" ? "invalid_input" : "pipeline_failed",
    status: "failed",
    stage,
    versions: versions ?? {
      lemmaScript: { expected: "", observed: null },
      dafny: { expected: "", observed: null },
    },
    digests,
    processes: [],
    policyEligible: false,
    diagnosticCodes: [...diagnosticCodes],
    semanticEquivalence: "unresolved",
    benchmarkReady: false,
  };
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
