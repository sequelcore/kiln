import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "../packages/cli/src/application/private-project-state-filesystem.js";
import {
  resolveProjectStateBinding,
  type ProjectStateBinding,
} from "../packages/cli/src/application/project-state-root.js";
import {
  KILN_LIVE_CLAUDE_MODEL,
  KILN_LIVE_CLAUDE_TESTS_ENV,
  KILN_LIVE_CODEX_MODEL,
  KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL,
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV,
  KILN_LIVE_CODEX_TESTS_ENV,
  KILN_LIVE_MANAGED_AGENT_TESTS_ENV,
  KILN_LIVE_OPENAI_DIRECT_MODEL,
  KILN_LIVE_OPENAI_DIRECT_TESTS_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_OPENCODE_MODEL,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV,
  evaluateManagedAgentLivePreflight,
  projectClaudeNativeEntitlementEnvironment,
  type ManagedAgentLivePreflightResult,
} from "./managed-agent-live-preflight.js";
import {
  buildSourceStabilityRecoveryReport,
  parseSourceStabilityRecoveryManifest,
  parseVitestSourceStabilityResults,
  type SourceStabilityExecutorProvenance,
  type SourceStabilityRecoveryCandidateMetadata,
  type SourceStabilityRecoveryEnvironmentMetadata,
  type SourceStabilityRecoveryManifest,
  type SourceStabilityRecoveryReport,
  type SourceStabilityLiveRun,
} from "./source-stability-recovery-report.js";

export const SOURCE_STABILITY_RECOVERY_EVIDENCE_DIRECTORY = "source-stability-recovery";
export const SOURCE_STABILITY_RECOVERY_LATEST_FILENAME = "latest.json";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const CANONICAL_MANIFEST_PATH = join(
  REPOSITORY_ROOT,
  "scripts",
  "fixtures",
  "source-stability-recovery.manifest.json",
);
const RUNTIME_PACKAGE_PATH = join(REPOSITORY_ROOT, "packages", "runtime", "package.json");
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const VERSION_IN_OUTPUT = /\b(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?\b/gu;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SENSITIVE_MODEL = /(?:\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b|\b(?:account|subscription)(?:[_ -]?(?:id|identifier|ref|reference))?\s*[:=_-]|\b(?:acct|sub)[-_][A-Za-z0-9._-]{3,}\b|\bbearer\s+[A-Za-z0-9._~+/-]{8,})/iu;
const MAX_EXIT_CODE = 255;

export const MANAGED_AGENT_LIVE_DEADLINE_MS = 45 * 60 * 1000;
export const MANAGED_AGENT_LIVE_MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const MANAGED_AGENT_LIVE_KILL_GRACE_MS = 1_000;
const MANAGED_AGENT_LIVE_TERMINATION_CALL_TIMEOUT_MS = 5_000;
const MANAGED_AGENT_LIVE_CLOSE_TIMEOUT_MS = 5_000;

export interface ManagedAgentLiveReadable {
  setEncoding?: (encoding: BufferEncoding) => void;
  on: (event: "data", listener: (chunk: string | Buffer) => void) => unknown;
}

export interface ManagedAgentLiveChild {
  readonly pid?: number | null;
  readonly stdout?: ManagedAgentLiveReadable | null;
  readonly stderr?: ManagedAgentLiveReadable | null;
  on: (event: "data", listener: (chunk: string | Buffer) => void) => unknown;
  once: (event: "error" | "close", listener: (...args: unknown[]) => void) => unknown;
  kill: (signal?: NodeJS.Signals) => boolean;
}

export interface ManagedAgentLiveProcessControl {
  readonly platform?: NodeJS.Platform;
  readonly terminateTree: (child: ManagedAgentLiveChild, graceMs: number) => Promise<void>;
}

export interface ManagedAgentLiveTreeTerminationOptions {
  readonly platform?: NodeJS.Platform;
  readonly graceMs?: number;
  readonly spawnTaskkill?: (args: readonly string[], options: Record<string, unknown>) => ManagedAgentLiveChild;
  readonly signalProcessGroup?: (pid: number, signal: NodeJS.Signals) => void;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface ManagedAgentLiveSpawnInput {
  readonly repositoryRoot: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly bunExecutable: string;
  readonly abortSignal?: AbortSignal;
  readonly deadlineMs?: number;
  readonly maxOutputBytes?: number;
  readonly killGraceMs?: number;
  readonly terminationCloseMs?: number;
  readonly spawnChild?: (command: string, args: readonly string[], options: Record<string, unknown>) => ManagedAgentLiveChild;
  readonly processControl?: ManagedAgentLiveProcessControl;
}

export interface ManagedAgentLiveSpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly error?: unknown;
  readonly terminationReason?: "timeout" | "interrupted" | "output-limit";
}

export interface ManagedAgentLiveGitResult {
  readonly status: number | null;
  readonly stdout?: string;
  readonly error?: unknown;
}

export interface ManagedAgentLiveLogger {
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

export interface ManagedAgentLiveReportFileOperations {
  readonly writeTempFileSync?: (path: string, content: string, mode: number) => void;
  readonly syncTempFileSync?: (path: string) => void;
  readonly replaceFileSync?: (tempPath: string, outputFile: string) => void;
  readonly removeTempFileSync?: (path: string) => void;
  readonly tempFilePath?: (outputFile: string) => string;
}

export interface ManagedAgentLiveRunnerOptions {
  /** Production defaults to the fixed repository root next to this script. */
  readonly repositoryRoot?: string;
  /** Tests may pass the already parsed canonical manifest; production reads the fixed file. */
  readonly manifest?: SourceStabilityRecoveryManifest;
  readonly environment?: NodeJS.ProcessEnv;
  readonly candidateMetadata?: SourceStabilityRecoveryCandidateMetadata;
  readonly environmentMetadata?: SourceStabilityRecoveryEnvironmentMetadata;
  readonly projectBinding?: ProjectStateBinding;
  readonly probeVersion?: (command: string, environment: NodeJS.ProcessEnv) => string;
  readonly runtimeVersion?: () => string;
  readonly spawnVitest?: (input: ManagedAgentLiveSpawnInput) => Promise<ManagedAgentLiveSpawnResult>;
  readonly abortSignal?: AbortSignal;
  readonly deadlineMs?: number;
  readonly maxOutputBytes?: number;
  readonly killGraceMs?: number;
  readonly terminationCloseMs?: number;
  readonly spawnChild?: ManagedAgentLiveSpawnInput["spawnChild"];
  readonly processControl?: ManagedAgentLiveProcessControl;
  readonly bunExecutable?: string;
  readonly logger?: ManagedAgentLiveLogger;
}

export interface ManagedAgentLiveRunnerResult {
  readonly exitCode: number;
  readonly report?: SourceStabilityRecoveryReport;
  /** Stable blocker identifier; raw errors are deliberately not exposed. */
  readonly blocker?:
    | "manifest-invalid"
    | "candidate-metadata"
    | "environment-metadata"
    | "executor-provenance-unavailable"
    | "report-contract"
    | "report-write";
}

interface ExecutorSpec {
  readonly providerId: SourceStabilityExecutorProvenance["providerId"];
  readonly harnessId: SourceStabilityExecutorProvenance["harnessId"];
  readonly model?: string;
  readonly authorityFlags: readonly string[];
  readonly command?: string;
}

/**
 * Execute the separately-authorized live proof and persist one sanitized
 * report. Importing this module never probes the machine or starts a child.
 */
export async function runManagedAgentLiveTests(
  options: ManagedAgentLiveRunnerOptions = {},
): Promise<ManagedAgentLiveRunnerResult> {
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const environment = options.environment ?? process.env;
  const logger = options.logger ?? console;
  const manifest = options.manifest ?? readCanonicalManifest();
  if (manifest === undefined) {
    logger.error("Managed-agent live proof blocked: manifest-invalid.");
    return { exitCode: 1, blocker: "manifest-invalid" };
  }

  const preflight = evaluateManagedAgentLivePreflight(environment);

  let candidate: SourceStabilityRecoveryCandidateMetadata;
  let environmentMetadata: SourceStabilityRecoveryEnvironmentMetadata;
  try {
    candidate = options.candidateMetadata ?? collectCandidateMetadata({ repositoryRoot });
  } catch {
    logger.error("Managed-agent live proof blocked: candidate-metadata.");
    return { exitCode: 1, blocker: "candidate-metadata" };
  }
  try {
    environmentMetadata = options.environmentMetadata ?? collectEnvironmentMetadata();
  } catch {
    logger.error("Managed-agent live proof blocked: environment-metadata.");
    return { exitCode: 1, blocker: "environment-metadata" };
  }

  let projectBinding: ProjectStateBinding;
  try {
    projectBinding = options.projectBinding ?? resolveProjectStateBinding(repositoryRoot);
  } catch {
    logger.error("Managed-agent live proof blocked: report-write.");
    return { exitCode: 1, blocker: "report-write" };
  }
  const outputFile = join(
    projectBinding.evidencePath,
    SOURCE_STABILITY_RECOVERY_EVIDENCE_DIRECTORY,
    SOURCE_STABILITY_RECOVERY_LATEST_FILENAME,
  );

  if (!preflight.ok) {
    let report: SourceStabilityRecoveryReport;
    try {
      report = buildReport({
        manifest,
        repositoryRoot,
        candidate,
        environment: environmentMetadata,
        executors: [],
        selectedAuthorityFlags: [],
        preflight: "denied",
        liveRun: { status: "not-started", reasonCode: "preflight-denied" },
      });
    } catch {
      logger.error("Managed-agent live proof blocked: report-contract.");
      return { exitCode: 1, blocker: "report-contract" };
    }
    const persisted = persistReportSafely(projectBinding, outputFile, report, logger);
    if (!persisted) return { exitCode: 1, report, blocker: "report-write" };
    logger.error("Managed-agent live proof denied before execution.");
    return { exitCode: 1, report };
  }

  let executors: readonly SourceStabilityExecutorProvenance[];
  try {
    executors = buildExecutorProvenance(preflight, environment, options);
  } catch {
    let report: SourceStabilityRecoveryReport;
    try {
      report = buildReport({
        manifest,
        repositoryRoot,
        candidate,
        environment: environmentMetadata,
        executors: [],
        selectedAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS_ENV, ...preflight.enabledProviders],
        preflight: "allowed",
        liveRun: { status: "not-started", reasonCode: "executor-provenance-unavailable" },
      });
    } catch {
      logger.error("Managed-agent live proof blocked: report-contract.");
      return { exitCode: 1, blocker: "report-contract" };
    }
    const persisted = persistReportSafely(projectBinding, outputFile, report, logger);
    if (!persisted) return { exitCode: 1, report, blocker: "report-write" };
    logger.error("Managed-agent live proof blocked: executor-provenance-unavailable.");
    return { exitCode: 1, report, blocker: "executor-provenance-unavailable" };
  }

  const childEnvironment = {
    ...(preflight.enabledProviders.includes(KILN_LIVE_CLAUDE_TESTS_ENV)
      ? projectClaudeNativeEntitlementEnvironment(environment)
      : environment),
    ...preflight.environment,
  };
  const spawnVitest = options.spawnVitest ?? spawnManagedAgentLiveVitest;
  let childResult: ManagedAgentLiveSpawnResult;
  try {
    childResult = await spawnVitest({
      repositoryRoot,
      environment: childEnvironment,
      bunExecutable: options.bunExecutable ?? process.execPath,
      abortSignal: options.abortSignal,
      deadlineMs: options.deadlineMs,
      maxOutputBytes: options.maxOutputBytes,
      killGraceMs: options.killGraceMs,
      terminationCloseMs: options.terminationCloseMs,
      spawnChild: options.spawnChild,
      processControl: options.processControl,
    });
  } catch {
    childResult = { stdout: "", stderr: "", error: true };
  }

  const runOutcome = classifyChildResult(childResult, repositoryRoot);
  let report: SourceStabilityRecoveryReport;
  try {
    report = buildReport({
      manifest,
      repositoryRoot,
      candidate,
      environment: environmentMetadata,
      executors,
      selectedAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS_ENV, ...preflight.enabledProviders],
      preflight: "allowed",
      liveRun: runOutcome.liveRun,
      ...(runOutcome.liveVitest === undefined ? {} : { liveVitest: runOutcome.liveVitest }),
    });
  } catch {
    // A syntactically valid result that cannot satisfy the pure report
    // contract is an attempted live observation with invalid evidence. Build
    // a sanitized failure report without the offending JSON, then replace the
    // latest report atomically. If even that fallback cannot be built, retain
    // the contract blocker and do not touch the previous latest report.
    if (runOutcome.liveVitest !== undefined) {
      try {
        report = buildReport({
          manifest,
          repositoryRoot,
          candidate,
          environment: environmentMetadata,
          executors,
          selectedAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS_ENV, ...preflight.enabledProviders],
          preflight: "allowed",
          liveRun: { status: "failed", reasonCode: "invalid-live-observation" },
        });
      } catch {
        logger.error("Managed-agent live proof blocked: report-contract.");
        return { exitCode: 1, blocker: "report-contract" };
      }
      const persisted = persistReportSafely(projectBinding, outputFile, report, logger);
      if (!persisted) return { exitCode: 1, report, blocker: "report-write" };
      logger.error("Managed-agent live proof failed: invalid-live-observation.");
      return { exitCode: 1, report };
    }
    logger.error("Managed-agent live proof blocked: report-contract.");
    return { exitCode: 1, blocker: "report-contract" };
  }

  const persisted = persistReportSafely(projectBinding, outputFile, report, logger);
  if (!persisted) return { exitCode: 1, report, blocker: "report-write" };

  if (report.liveRun.status === "completed" && report.liveProofOutcome === "passed") {
    logger.log("Managed-agent live proof completed.");
    return { exitCode: 0, report };
  }
  if (report.liveRun.status === "completed") {
    logger.error("Managed-agent live proof completed without passed live proofs.");
    return { exitCode: 1, report };
  }
  logger.error(`Managed-agent live proof failed: ${report.liveRun.reasonCode ?? "unknown"}.`);
  return {
    exitCode: report.liveRun.exitCode === undefined || report.liveRun.exitCode === 0
      ? 1
      : report.liveRun.exitCode,
    report,
  };
}

/** Collect only the commit OID and dirty bit; porcelain paths never leave this function. */
export function collectCandidateMetadata(
  options: {
    readonly repositoryRoot?: string;
    readonly runGit?: (args: readonly string[], repositoryRoot: string) => ManagedAgentLiveGitResult;
  } = {},
): SourceStabilityRecoveryCandidateMetadata {
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const runGit = options.runGit ?? runGitCommand;
  const head = runGit(["rev-parse", "HEAD"], repositoryRoot);
  if (head.status !== 0 || typeof head.stdout !== "string") throw new Error("candidate metadata unavailable");
  const commit = head.stdout.trim();
  if (!COMMIT.test(commit)) throw new Error("candidate metadata unavailable");

  const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"], repositoryRoot);
  if (status.status !== 0 || typeof status.stdout !== "string") throw new Error("candidate metadata unavailable");
  return { commit, dirty: status.stdout.trim().length > 0 };
}

/** Read process identity only; denied preflight never runs a native version probe. */
export function collectEnvironmentMetadata(): SourceStabilityRecoveryEnvironmentMetadata {
  const bun = process.versions.bun;
  const node = process.versions.node;
  if (typeof bun !== "string" || !SEMVER.test(bun) || typeof node !== "string" || !SEMVER.test(node)) {
    throw new Error("environment metadata unavailable");
  }
  if (!SAFE_IDENTIFIER.test(process.platform) || !SAFE_IDENTIFIER.test(process.arch)) {
    throw new Error("environment metadata unavailable");
  }
  return { platform: process.platform, arch: process.arch, bun, node };
}

/** Own the one private report target and re-check containment immediately before opening it. */
export function persistManagedAgentLiveReport(input: {
  readonly projectStateRoot: string;
  readonly evidenceDirectory: string;
  readonly outputFile: string;
  readonly report: unknown;
  readonly fileOperations?: ManagedAgentLiveReportFileOperations;
}): void {
  const serialized = `${JSON.stringify(input.report)}\n`;
  ensurePrivateStateDirectorySync(input.projectStateRoot, input.evidenceDirectory);
  assertPrivateStateFileTargetSync(input.projectStateRoot, input.outputFile);
  const operations = input.fileOperations ?? {};
  const tempPath = operations.tempFilePath?.(input.outputFile)
    ?? join(dirname(input.outputFile), `.${basename(input.outputFile)}.${randomUUID()}.tmp`);
  const outputDirectory = resolve(dirname(input.outputFile));
  const tempDirectory = resolve(dirname(tempPath));
  const sameDirectory = process.platform === "win32"
    ? outputDirectory.toLowerCase() === tempDirectory.toLowerCase()
    : outputDirectory === tempDirectory;
  if (!sameDirectory) throw new Error("report temp file must share the latest report directory");
  if (existsSync(tempPath)) throw new Error("report temp file already exists");
  let tempCreated = false;
  try {
    assertPrivateStateFileTargetSync(input.projectStateRoot, tempPath);
    tempCreated = true;
    (operations.writeTempFileSync ?? ((path, content, mode) => writeFileSync(path, content, { encoding: "utf8", flag: "wx", mode })))(tempPath, serialized, 0o600);
    (operations.syncTempFileSync ?? syncPrivateReportTempFileSync)(tempPath);
    // Re-check the final private target immediately before the atomic replace.
    assertPrivateStateFileTargetSync(input.projectStateRoot, input.outputFile);
    (operations.replaceFileSync ?? renameSync)(tempPath, input.outputFile);
    tempCreated = false;
  } finally {
    if (tempCreated) {
      try { (operations.removeTempFileSync ?? unlinkSync)(tempPath); } catch { /* preserve the previous latest report */ }
    }
  }
}

function syncPrivateReportTempFileSync(path: string): void {
  const descriptor = openSync(path, "r+");
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

function readCanonicalManifest(): SourceStabilityRecoveryManifest | undefined {
  try {
    const parsed = parseSourceStabilityRecoveryManifest(JSON.parse(readFileSync(CANONICAL_MANIFEST_PATH, "utf8")) as unknown);
    return parsed.status === "valid" ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

function buildReport(input: {
  readonly manifest: SourceStabilityRecoveryManifest;
  readonly repositoryRoot: string;
  readonly candidate: SourceStabilityRecoveryCandidateMetadata;
  readonly environment: SourceStabilityRecoveryEnvironmentMetadata;
  readonly executors: readonly SourceStabilityExecutorProvenance[];
  readonly selectedAuthorityFlags: readonly string[];
  readonly preflight: "allowed" | "denied";
  readonly liveRun: SourceStabilityLiveRun;
  readonly liveVitest?: unknown;
}): SourceStabilityRecoveryReport {
  return buildSourceStabilityRecoveryReport(input);
}

function persistReportSafely(
  projectBinding: ProjectStateBinding,
  outputFile: string,
  report: SourceStabilityRecoveryReport,
  logger: ManagedAgentLiveLogger,
): boolean {
  try {
    persistManagedAgentLiveReport({
      projectStateRoot: projectBinding.projectStateRoot,
      evidenceDirectory: join(projectBinding.evidencePath, SOURCE_STABILITY_RECOVERY_EVIDENCE_DIRECTORY),
      outputFile,
      report,
    });
    return true;
  } catch {
    logger.error("Managed-agent live proof blocked: report-write.");
    return false;
  }
}

export function buildExecutorProvenance(
  preflight: ManagedAgentLivePreflightResult,
  environment: NodeJS.ProcessEnv,
  options: ManagedAgentLiveRunnerOptions,
): readonly SourceStabilityExecutorProvenance[] {
  const enabled = new Set(preflight.enabledProviders);
  const specs: ExecutorSpec[] = [];
  const addNative = (
    providerId: ExecutorSpec["providerId"],
    harnessId: ExecutorSpec["harnessId"],
    command: string,
    model: string | undefined,
    authorityFlags: readonly string[],
  ): void => {
    const flags = authorityFlags.filter((flag) => enabled.has(flag));
    if (flags.length > 0) specs.push({ providerId, harnessId, command, model, authorityFlags: flags });
  };
  const addRuntime = (
    providerId: ExecutorSpec["providerId"],
    harnessId: ExecutorSpec["harnessId"],
    model: string | undefined,
    authorityFlags: readonly string[],
  ): void => {
    const flags = authorityFlags.filter((flag) => enabled.has(flag));
    if (flags.length > 0) specs.push({ providerId, harnessId, model, authorityFlags: flags });
  };

  addNative("codex", "codex-cli", "codex", environment[KILN_LIVE_CODEX_MODEL], [KILN_LIVE_CODEX_TESTS_ENV]);
  addNative("claude", "claude-cli", "claude", environment[KILN_LIVE_CLAUDE_MODEL], [KILN_LIVE_CLAUDE_TESTS_ENV]);
  addNative(
    "opencode",
    "opencode-cli",
    "opencode",
    environment[KILN_LIVE_OPENCODE_MODEL],
    [KILN_LIVE_OPENCODE_TESTS_ENV, KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV],
  );
  addRuntime(
    "opencode-go",
    "kiln-direct-runtime",
    undefined,
    [KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV],
  );
  addRuntime(
    "openai",
    "kiln-direct-runtime",
    environment[KILN_LIVE_OPENAI_DIRECT_MODEL],
    [KILN_LIVE_OPENAI_DIRECT_TESTS_ENV],
  );
  addRuntime(
    "codex-oauth",
    "kiln-direct-runtime",
    environment[KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL],
    [KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV, KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV],
  );
  addRuntime(
    "codex-oauth",
    "kiln-managed-account-runtime",
    undefined,
    [KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV],
  );
  if (specs.length === 0) throw new Error("executor metadata unavailable");

  const runtimeVersion = options.runtimeVersion ?? readRuntimePackageVersion;
  const nativeVersion = options.probeVersion ?? probeNativeVersion;
  const runtimeVersionValue = runtimeVersion();
  const versionCache = new Map<string, string>();
  const synthetic: SourceStabilityExecutorProvenance = {
    providerId: "kiln",
    harnessId: "kiln-runtime-fixture",
    harnessVersion: runtimeVersionValue,
    enabledAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS_ENV],
  };
  if (!SEMVER.test(runtimeVersionValue)) throw new Error("executor metadata unavailable");
  return [synthetic, ...specs.map((spec) => {
    const model = sanitizeModel(spec.model);
    const harnessVersion = spec.command === undefined
      ? runtimeVersionValue!
      : (() => {
          const existing = versionCache.get(spec.command);
          if (existing !== undefined) return existing;
          const probeEnvironment = spec.command === "claude"
            ? projectClaudeNativeEntitlementEnvironment(environment)
            : environment;
          const probedOutput = nativeVersion(spec.command, probeEnvironment);
          const probed = SEMVER.test(probedOutput) ? probedOutput : extractVersion(probedOutput);
          if (probed === undefined) throw new Error("executor metadata unavailable");
          versionCache.set(spec.command, probed);
          return probed;
        })();
    if (!SEMVER.test(harnessVersion)) throw new Error("executor metadata unavailable");
    return {
      providerId: spec.providerId,
      harnessId: spec.harnessId,
      harnessVersion,
      ...(model === undefined ? {} : { model }),
      enabledAuthorityFlags: [KILN_LIVE_MANAGED_AGENT_TESTS_ENV, ...spec.authorityFlags],
    };
  })];
}

function sanitizeModel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const model = value.trim();
  if (model.length === 0 || model.length > 160 || SENSITIVE_MODEL.test(model) || !/^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,159}$/u.test(model)) {
    throw new Error("executor metadata unavailable");
  }
  return model;
}

export function readRuntimePackageVersion(): string {
  const value: unknown = JSON.parse(readFileSync(RUNTIME_PACKAGE_PATH, "utf8"));
  if (typeof value !== "object" || value === null || !("version" in value) || typeof value.version !== "string" || !SEMVER.test(value.version)) {
    throw new Error("executor metadata unavailable");
  }
  return value.version;
}

export function probeNativeVersion(command: string, environment: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    env: environment,
    shell: false,
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.status !== 0) throw new Error("executor metadata unavailable");
  const version = extractVersion(`${typeof result.stdout === "string" ? result.stdout : ""}\n${typeof result.stderr === "string" ? result.stderr : ""}`);
  if (version === undefined) throw new Error("executor metadata unavailable");
  return version;
}

function extractVersion(output: string): string | undefined {
  const matches = output.match(VERSION_IN_OUTPUT);
  return matches?.find((candidate) => SEMVER.test(candidate));
}

function runGitCommand(args: readonly string[], repositoryRoot: string): ManagedAgentLiveGitResult {
  const result = spawnSync("git", [...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : undefined,
    error: result.error,
  };
}

export function classifyChildResult(result: ManagedAgentLiveSpawnResult, repositoryRoot: string): {
  readonly liveRun: SourceStabilityLiveRun;
  readonly liveVitest?: unknown;
} {
  if (result.terminationReason !== undefined) {
    const reasonCode = result.terminationReason === "timeout"
      ? "test-process-timeout"
      : result.terminationReason === "interrupted"
        ? "test-process-interrupted"
        : "test-output-limit";
    return { liveRun: { status: "failed", reasonCode } };
  }
  if (result.error !== undefined) return { liveRun: { status: "failed", reasonCode: "spawn-failed" } };
  if (result.signal !== undefined && result.signal !== null) {
    return { liveRun: { status: "failed", reasonCode: "test-process-terminated" } };
  }
  if (result.exitCode === undefined || result.exitCode === null) {
    return { liveRun: { status: "failed", reasonCode: "test-process-terminated" } };
  }
  const exitCode = result.exitCode;
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > MAX_EXIT_CODE) {
    return { liveRun: { status: "failed", reasonCode: "test-process-terminated" } };
  }
  const trimmed = (typeof result.stdout === "string" ? result.stdout : "").trim();
  if (trimmed.length === 0) {
    return { liveRun: { status: "failed", reasonCode: "missing-json", exitCode } };
  }
  let liveVitest: unknown;
  try {
    liveVitest = JSON.parse(trimmed) as unknown;
  } catch {
    return { liveRun: { status: "failed", reasonCode: "malformed-json", exitCode } };
  }
  const parsed = parseVitestSourceStabilityResults(liveVitest, repositoryRoot);
  if (parsed.status === "invalid") {
    return { liveRun: { status: "failed", reasonCode: "malformed-json", exitCode } };
  }
  return exitCode === 0
    ? { liveRun: { status: "completed", exitCode: 0 }, liveVitest }
    : { liveRun: { status: "failed", reasonCode: "test-process-nonzero", exitCode }, liveVitest };
}

export function spawnManagedAgentLiveVitest(input: ManagedAgentLiveSpawnInput): Promise<ManagedAgentLiveSpawnResult> {
  const runtimeRoot = join(input.repositoryRoot, "packages", "runtime");
  const args = ["x", "vitest", "run", "--config", "vitest.live.config.ts", "--reporter=json"] as const;
  const platform = input.processControl?.platform ?? process.platform;
  const spawnOptions: Record<string, unknown> = {
    cwd: runtimeRoot,
    env: input.environment,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    ...(platform === "win32" ? {} : { detached: true }),
  };
  const child = input.spawnChild === undefined
    ? spawn(input.bunExecutable, args, spawnOptions) as unknown as ManagedAgentLiveChild
    : input.spawnChild(input.bunExecutable, args, spawnOptions);
  return collectManagedAgentLiveChildOutput(child, input);
}

export function collectManagedAgentLiveChildOutput(
  child: ManagedAgentLiveChild,
  input: Pick<ManagedAgentLiveSpawnInput, "abortSignal" | "deadlineMs" | "maxOutputBytes" | "killGraceMs" | "terminationCloseMs" | "processControl"> = {},
): Promise<ManagedAgentLiveSpawnResult> {
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let terminationReason: ManagedAgentLiveSpawnResult["terminationReason"];
  let terminationStarted = false;
  const deadlineMs = input.deadlineMs ?? MANAGED_AGENT_LIVE_DEADLINE_MS;
  const maxOutputBytes = input.maxOutputBytes ?? MANAGED_AGENT_LIVE_MAX_OUTPUT_BYTES;
  const killGraceMs = input.killGraceMs ?? MANAGED_AGENT_LIVE_KILL_GRACE_MS;
  const terminationCloseMs = input.terminationCloseMs ?? MANAGED_AGENT_LIVE_CLOSE_TIMEOUT_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 2 * 60 * 60 * 1000) throw new Error("invalid live deadline");
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0 || maxOutputBytes > 64 * 1024 * 1024) throw new Error("invalid live output limit");
  if (!Number.isSafeInteger(killGraceMs) || killGraceMs <= 0 || killGraceMs > 60 * 1000) throw new Error("invalid live kill grace");
  if (!Number.isSafeInteger(terminationCloseMs) || terminationCloseMs <= 0 || terminationCloseMs > 60 * 1000) throw new Error("invalid live close timeout");
  const processControl = input.processControl ?? defaultProcessControl;
  let requestTermination: ((reason: NonNullable<ManagedAgentLiveSpawnResult["terminationReason"]>) => void) | undefined;
  const append = (target: "stdout" | "stderr", chunk: string | Buffer): void => {
    if (terminationReason !== undefined) return;
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    if (outputBytes + bytes > maxOutputBytes) {
      outputBytes = maxOutputBytes;
      terminationReason = "output-limit";
      requestTermination?.("output-limit");
      return;
    }
    outputBytes += bytes;
    if (target === "stdout") stdout += text;
    else stderr += text;
  };
  child.stdout?.setEncoding?.("utf8");
  child.stderr?.setEncoding?.("utf8");
  child.stdout?.on("data", (chunk) => append("stdout", chunk));
  child.stderr?.on("data", (chunk) => append("stderr", chunk));
  return new Promise((resolveResult) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let closeDeadline: ReturnType<typeof setTimeout> | undefined;
    const terminate = (reason: NonNullable<ManagedAgentLiveSpawnResult["terminationReason"]>): void => {
      if (terminationStarted || settled) return;
      terminationStarted = true;
      terminationReason = reason;
      closeDeadline = setTimeout(
        () => settle({ stdout: "", stderr: "", terminationReason: reason }),
        terminationCloseMs,
      );
      void terminateManagedAgentLiveChild(child, processControl, killGraceMs);
    };
    requestTermination = terminate;
    const onAbort = (): void => terminate("interrupted");
    const settle = (result: ManagedAgentLiveSpawnResult): void => {
      if (settled) return;
      settled = true;
      if (deadline !== undefined) clearTimeout(deadline);
      if (closeDeadline !== undefined) clearTimeout(closeDeadline);
      input.abortSignal?.removeEventListener("abort", onAbort);
      resolveResult(result);
    };
    child.once("error", (error: unknown) => {
      if (terminationReason !== undefined) {
        settle({ stdout: "", stderr: "", terminationReason });
        return;
      }
      settle({ stdout, stderr, error });
    });
    child.once("close", (...args: unknown[]) => {
      const exitCode = typeof args[0] === "number" || args[0] === null ? args[0] : null;
      const signal = typeof args[1] === "string" || args[1] === null ? args[1] : null;
      if (terminationReason !== undefined) {
        settle({ stdout: "", stderr: "", terminationReason });
        return;
      }
      settle({
        stdout,
        stderr,
        exitCode,
        signal,
      });
    });
    deadline = setTimeout(() => terminate("timeout"), deadlineMs);
    input.abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (input.abortSignal?.aborted === true) onAbort();
  });
}

async function terminateManagedAgentLiveChild(
  child: ManagedAgentLiveChild,
  processControl: ManagedAgentLiveProcessControl,
  graceMs: number,
): Promise<void> {
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolveTimeout) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      resolveTimeout();
    }, MANAGED_AGENT_LIVE_TERMINATION_CALL_TIMEOUT_MS);
  });
  try {
    await Promise.race([processControl.terminateTree(child, graceMs), timeout]);
  } catch {
    timedOut = true;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
  if (timedOut) {
    try { child.kill("SIGKILL"); } catch { /* sanitized failure path */ }
  }
}

const defaultProcessControl: ManagedAgentLiveProcessControl = {
  platform: process.platform,
  terminateTree: (child, graceMs) => terminateManagedAgentLiveProcessTree(child, { platform: process.platform, graceMs, sleep: (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms)), }).then(() => undefined),
};

export async function terminateManagedAgentLiveProcessTree(
  child: ManagedAgentLiveChild,
  options: ManagedAgentLiveTreeTerminationOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    if (typeof child.pid !== "number") throw new Error("child pid unavailable");
    const killer = options.spawnTaskkill?.(["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" }) ?? spawn(
      "taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" },
    ) as unknown as ManagedAgentLiveChild;
    await new Promise<void>((resolveKill, rejectKill) => {
      killer.once("error", () => rejectKill(new Error("tree termination unavailable")));
      killer.once("close", (code: unknown) => code === 0 ? resolveKill() : rejectKill(new Error("tree termination failed")));
    });
    return;
  }
  if (typeof child.pid !== "number") throw new Error("child pid unavailable");
  const signal = options.signalProcessGroup ?? ((pid: number, value: NodeJS.Signals) => process.kill(pid, value));
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
  let termFailed = false;
  try { signal(-child.pid, "SIGTERM"); } catch { termFailed = true; }
  await sleep(options.graceMs ?? MANAGED_AGENT_LIVE_KILL_GRACE_MS);
  try { signal(-child.pid, "SIGKILL"); } catch { termFailed = true; }
  if (termFailed) {
    try { child.kill("SIGKILL"); } catch { /* sanitized failure path */ }
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const result = await runManagedAgentLiveTests({ abortSignal: controller.signal });
    if (result.exitCode !== 0) process.exitCode = result.exitCode;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

if (import.meta.main) {
  await main();
}
