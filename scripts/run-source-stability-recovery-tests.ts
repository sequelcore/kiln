import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  parseSourceStabilityRecoveryManifest,
  parseVitestSourceStabilityResults,
  type ParsedVitestSourceStabilityAssertion,
  type SourceStabilityRecoveryManifest,
} from "./source-stability-recovery-report.js";
import {
  collectManagedAgentLiveChildOutput,
  type ManagedAgentLiveChild,
  type ManagedAgentLiveProcessControl,
} from "./run-managed-agent-live-tests.js";

export interface SourceStabilityRecoveryPackageExecution {
  readonly packageName: "runtime" | "cli";
  readonly cwd: string;
  readonly configPath: string;
  readonly files: readonly string[];
  readonly argv: readonly string[];
}

export interface SourceStabilityRecoveryChildResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number | null;
  readonly error?: unknown;
  readonly terminationReason?: "timeout" | "output-limit" | "interrupted";
}

export interface SourceStabilityRecoveryRunnerOptions {
  readonly repositoryRoot?: string;
  readonly manifest?: SourceStabilityRecoveryManifest;
  readonly executePackage?: (
    input: SourceStabilityRecoveryPackageExecution,
  ) => Promise<SourceStabilityRecoveryChildResult>;
  readonly logger?: {
    readonly log: (message: string) => void;
    readonly error: (message: string) => void;
  };
  /** Narrow test seams; production uses fixed bounded values. */
  readonly deadlineMs?: number;
  readonly maxOutputBytes?: number;
  readonly terminationCloseMs?: number;
  readonly abortSignal?: AbortSignal;
  readonly spawnPackage?: (command: string, args: readonly string[], options: Record<string, unknown>) => ManagedAgentLiveChild;
  readonly processControl?: ManagedAgentLiveProcessControl;
}

export interface SourceStabilityRecoveryRunnerResult {
  readonly exitCode: 0 | 1;
  readonly reason?: SourceStabilityRecoveryFailureReason;
}

export interface SourceStabilityRecoverySignalEvents {
  readonly on: (event: "SIGINT" | "SIGTERM", handler: () => void) => void;
  readonly off: (event: "SIGINT" | "SIGTERM", handler: () => void) => void;
}

export type SourceStabilityRecoveryMainRun = (
  options: Pick<SourceStabilityRecoveryRunnerOptions, "abortSignal">,
) => Promise<SourceStabilityRecoveryRunnerResult>;

export type SourceStabilityRecoveryFailureReason =
  | "manifest-invalid"
  | "unsupported-locator-path"
  | "spawn-failed"
  | "child-timeout"
  | "child-interrupted"
  | "output-limit"
  | "malformed-json"
  | "child-nonzero"
  | "locator-missing"
  | "locator-duplicate"
  | "locator-not-passed";

const REPOSITORY_ROOT = join(import.meta.dirname, "..");
const MANIFEST_PATH = join(REPOSITORY_ROOT, "scripts", "fixtures", "source-stability-recovery.manifest.json");
const PACKAGE_NAMES = ["runtime", "cli"] as const;
const PACKAGE_PREFIXES = {
  runtime: "packages/runtime/tests/",
  cli: "packages/cli/tests/",
} as const;
const CONFIG_PATH = "vitest.config.ts";
const DETERMINISTIC_GATE_DEADLINE_MS = 15 * 60 * 1000;
const DETERMINISTIC_GATE_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DETERMINISTIC_GATE_CLOSE_TIMEOUT_MS = 5_000;

/** Run only the canonical deterministic locators; importing this module starts nothing. */
export async function runSourceStabilityRecoveryTests(
  options: SourceStabilityRecoveryRunnerOptions = {},
): Promise<SourceStabilityRecoveryRunnerResult> {
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const logger = options.logger ?? console;
  const manifest = options.manifest ?? readCanonicalManifest();
  if (manifest === undefined) return fail(logger, "manifest-invalid");

  const locators = collectDeterministicLocators(manifest);
  const plans = buildPackagePlans(repositoryRoot, locators);
  if (plans === undefined) return fail(logger, "unsupported-locator-path");

  const executePackage = options.executePackage ?? ((input: SourceStabilityRecoveryPackageExecution) => executePackageWithChild(input, options));
  const assertions: ParsedVitestSourceStabilityAssertion[] = [];
  for (const plan of plans) {
    let child: SourceStabilityRecoveryChildResult;
    try {
      child = await executePackage(plan);
    } catch {
      return fail(logger, "spawn-failed");
    }
    if (child.error !== undefined) return fail(logger, "spawn-failed");
    if (child.terminationReason === "timeout") return fail(logger, "child-timeout");
    if (child.terminationReason === "output-limit") return fail(logger, "output-limit");
    if (child.terminationReason === "interrupted") return fail(logger, "child-interrupted");
    const exitCode = child.exitCode;
    if (exitCode === undefined || exitCode === null || exitCode !== 0) {
      return fail(logger, "child-nonzero");
    }
    let json: unknown;
    try {
      json = JSON.parse(child.stdout) as unknown;
    } catch {
      return fail(logger, "malformed-json");
    }
    const parsed = parseVitestSourceStabilityResults(json, repositoryRoot);
    if (parsed.status === "invalid") return fail(logger, "malformed-json");
    assertions.push(...parsed.value);
  }

  for (const locator of locators) {
    const matches = assertions.filter((assertion) => assertion.path === locator.path && assertion.title === locator.title);
    if (matches.length === 0) return fail(logger, "locator-missing");
    if (matches.length > 1) return fail(logger, "locator-duplicate");
    if (matches[0]?.status !== "passed") return fail(logger, "locator-not-passed");
  }
  logger.log("Source-stability deterministic gate passed.");
  return { exitCode: 0 };
}

function fail(
  logger: NonNullable<SourceStabilityRecoveryRunnerOptions["logger"]>,
  reason: SourceStabilityRecoveryFailureReason,
): SourceStabilityRecoveryRunnerResult {
  logger.error(`Source-stability deterministic gate failed: ${reason}.`);
  return { exitCode: 1, reason };
}

function readCanonicalManifest(): SourceStabilityRecoveryManifest | undefined {
  try {
    const parsed = parseSourceStabilityRecoveryManifest(JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown);
    return parsed.status === "valid" ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

function collectDeterministicLocators(manifest: SourceStabilityRecoveryManifest): readonly { path: string; title: string }[] {
  const seen = new Set<string>();
  const locators: { path: string; title: string }[] = [];
  for (const entry of manifest.cases) {
    for (const locator of entry.deterministicEvidence) {
      const key = `${locator.path}\u0000${locator.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        locators.push(locator);
      }
    }
  }
  return locators;
}

function buildPackagePlans(
  repositoryRoot: string,
  locators: readonly { path: string; title: string }[],
): readonly SourceStabilityRecoveryPackageExecution[] | undefined {
  const files = new Map<(typeof PACKAGE_NAMES)[number], string[]>();
  for (const packageName of PACKAGE_NAMES) files.set(packageName, []);
  for (const locator of locators) {
    const packageName = PACKAGE_NAMES.find((candidate) => locator.path.startsWith(PACKAGE_PREFIXES[candidate]));
    if (packageName === undefined || locator.path.includes("\\") || locator.path.includes(".live.test.")) return undefined;
    const file = locator.path.slice(PACKAGE_PREFIXES[packageName].length);
    if (file.length === 0 || file.includes("..")) return undefined;
    const packageFiles = files.get(packageName)!;
    const relative = `tests/${file}`;
    if (!packageFiles.includes(relative)) packageFiles.push(relative);
  }
  return PACKAGE_NAMES.flatMap((packageName) => {
    const packageFiles = files.get(packageName)!;
    if (packageFiles.length === 0) return [];
    const cwd = join(repositoryRoot, "packages", packageName);
    const argv = ["x", "vitest", "run", "--config", CONFIG_PATH, "--reporter=json", ...packageFiles] as const;
    return [{ packageName, cwd, configPath: CONFIG_PATH, files: packageFiles, argv }];
  });
}

function executePackageWithChild(
  input: SourceStabilityRecoveryPackageExecution,
  bounds: Pick<SourceStabilityRecoveryRunnerOptions, "abortSignal" | "deadlineMs" | "maxOutputBytes" | "terminationCloseMs" | "spawnPackage" | "processControl">,
): Promise<SourceStabilityRecoveryChildResult> {
  const deadlineMs = bounds.deadlineMs ?? DETERMINISTIC_GATE_DEADLINE_MS;
  const maxOutputBytes = bounds.maxOutputBytes ?? DETERMINISTIC_GATE_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 60 * 60 * 1000) throw new Error("invalid deterministic deadline");
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0 || maxOutputBytes > 64 * 1024 * 1024) throw new Error("invalid deterministic output limit");
  const platform = bounds.processControl?.platform ?? process.platform;
  const spawnOptions: Record<string, unknown> = {
    cwd: input.cwd,
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...(platform === "win32" ? {} : { detached: true }),
  };
  const spawnPackage = bounds.spawnPackage ?? ((command, args, options) => spawn(command, args, options) as unknown as ManagedAgentLiveChild);
  const child = spawnPackage(process.execPath, input.argv, spawnOptions);
  return collectManagedAgentLiveChildOutput(child, {
    abortSignal: bounds.abortSignal,
    deadlineMs,
    maxOutputBytes,
    terminationCloseMs: bounds.terminationCloseMs ?? DETERMINISTIC_GATE_CLOSE_TIMEOUT_MS,
    processControl: bounds.processControl,
  }).then((result) => ({
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    ...(result.terminationReason === undefined ? {} : { terminationReason: result.terminationReason }),
  }));
}

export async function runSourceStabilityRecoveryMain(
  run: SourceStabilityRecoveryMainRun = (options) => runSourceStabilityRecoveryTests(options),
  signalEvents: SourceStabilityRecoverySignalEvents = {
    on: (event, handler) => process.on(event, handler),
    off: (event, handler) => process.off(event, handler),
  },
  setExitCode: (exitCode: 0 | 1) => void = (exitCode) => { process.exitCode = exitCode; },
): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  signalEvents.on("SIGINT", interrupt);
  signalEvents.on("SIGTERM", interrupt);
  try {
    const result = await run({ abortSignal: controller.signal });
    if (result.exitCode !== 0) setExitCode(result.exitCode);
  } finally {
    signalEvents.off("SIGINT", interrupt);
    signalEvents.off("SIGTERM", interrupt);
  }
}

async function main(): Promise<void> {
  await runSourceStabilityRecoveryMain();
}

if (import.meta.main) await main();
