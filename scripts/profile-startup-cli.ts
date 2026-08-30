import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { arch, platform as osPlatform, release, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CliStartupClass = "help" | "simple" | "heavy";
export type CliStartupState = "cold" | "warm";

const DEFAULT_REPETITIONS = 20;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TAIL_LENGTH = 2_000;
const CLI_ENTRY_RELATIVE_PATH = "packages/cli/src/executable.ts";
const CLI_STATE_FIXTURE_RELATIVE_PATH = "scripts/fixtures/startup-profile-cli-state.json";

const CLI_STARTUP_COMMANDS = [
  {
    class: "help",
    argv: [CLI_ENTRY_RELATIVE_PATH, "--help"],
    expectedExit: 0,
    expectedOutput: "Usage: kiln [command] [options]",
    description: "Top-level CLI help and command discovery.",
  },
  {
    class: "simple",
    argv: [CLI_ENTRY_RELATIVE_PATH, "target"],
    expectedExit: 0,
    expectedOutput: "Execution Targets:",
    description: "Local execution-target listing with no configured target.",
  },
  {
    class: "heavy",
    argv: [CLI_ENTRY_RELATIVE_PATH, "config", "read"],
    expectedExit: 0,
    expectedOutput: '"schemaRevision":',
    expectedOutputByState: {
      cold: "null",
      warm: '"schemaRevision":',
    },
    description: "Local effective configuration/status projection.",
  },
] as const satisfies readonly CliStartupCommandDefinition[];

interface CliStartupCommandDefinition {
  readonly class: CliStartupClass;
  readonly argv: readonly string[];
  readonly expectedExit: number;
  readonly expectedOutput: string;
  readonly expectedOutputByState?: Partial<Record<CliStartupState, string>>;
  readonly description: string;
}

interface CliStateFixture {
  readonly fixtureVersion: 1;
  readonly warmFiles: readonly CliStateFixtureFile[];
}

interface CliStateFixtureFile {
  readonly path: string;
  readonly content: string;
}

export interface CliStartupMeasurementOptions {
  readonly classes?: readonly CliStartupClass[];
  readonly repetitions?: number;
  readonly timeoutMs?: number;
  readonly repositoryRoot?: string;
  readonly fixturePath?: string;
}

export interface CliChildInput {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly stateRoot: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface CliChildResult {
  readonly exit: number | null;
  readonly timeout: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliStartupMeasurementDependencies {
  /** Test seam for child execution. Production always uses a fresh Bun child. */
  readonly runChild?: (input: CliChildInput) => Promise<CliChildResult>;
  /** Test seam for repository commit lookup. */
  readonly readCommit?: (repositoryRoot: string) => string;
  /** Test seam for monotonic duration timing. */
  readonly now?: () => number;
}

export interface CliStartupStateFile {
  readonly path: string;
  readonly size: number;
  readonly digest: string;
}

export interface CliStartupStateSnapshot {
  readonly kind: "isolated-synthetic-state";
  readonly status: "empty" | "seeded" | "observed";
  readonly fileCount: number;
  readonly digest: string;
  readonly files: readonly CliStartupStateFile[];
}

export interface CliStartupSample {
  readonly class: CliStartupClass;
  readonly state: CliStartupState;
  readonly order: number;
  readonly sequence: number;
  readonly argv: readonly string[];
  readonly exit: number | null;
  readonly timeout: boolean;
  readonly durationMs: number;
  readonly cache: {
    readonly semantics: "isolated-synthetic-state";
    readonly osPageCache: "not-measured";
    readonly before: CliStartupStateSnapshot;
    readonly after: CliStartupStateSnapshot;
  };
  readonly output: {
    readonly identity: CliStartupOutputIdentity;
    readonly stdoutTail: string;
    readonly stderrTail: string;
  };
  readonly success: boolean;
  readonly failureReason?: string;
}

export interface CliStartupOutputIdentity {
  readonly stdout: string;
  readonly stderr: string;
  readonly combined: string;
}

export interface CliStartupLaneAggregate {
  readonly class: CliStartupClass;
  readonly state: CliStartupState;
  readonly sampleCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly timeoutCount: number;
  readonly exitFailureCount: number;
  readonly durationsMs: readonly number[];
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
}

export interface CliStartupReport {
  readonly profileVersion: 2;
  readonly profileType: "cli-startup";
  readonly contract: {
    readonly defaultRepetitions: number;
    readonly repetitions: number;
    readonly classes: readonly CliStartupClass[];
    readonly states: readonly CliStartupState[];
    readonly childProcess: "fresh-per-sample";
    readonly ordering: "sequential-class-state-repetition";
    readonly stateSemantics: "isolated-synthetic-state-only";
    readonly osPageCacheClaim: "not-measured";
    readonly network: "none-by-command-selection";
    readonly aggregation: {
      readonly p50: "arithmetic-midpoint";
      readonly p95: "nearest-rank";
      readonly failedDurations: "excluded";
    };
  };
  readonly commandClasses: readonly {
    readonly class: CliStartupClass;
    readonly argv: readonly string[];
    readonly expectedExit: number;
    readonly expectedOutput: string;
    readonly expectedOutputByState?: Partial<Record<CliStartupState, string>>;
    readonly description: string;
  }[];
  readonly environment: {
    readonly commit: string;
    readonly os: string;
    readonly platform: NodeJS.Platform;
    readonly arch: string;
    readonly bun: string;
    readonly node: string;
    readonly entryDigest: string;
    readonly artifact: {
      readonly kind: "cli-entry";
      readonly path: string;
      readonly digest: string;
    };
    readonly fixtureDigest: string;
    readonly fixture: {
      readonly path: string;
      readonly digest: string;
    };
  };
  readonly samples: readonly CliStartupSample[];
  readonly aggregates: Readonly<Record<string, CliStartupLaneAggregate>>;
  readonly summary: {
    readonly sampleCount: number;
    readonly successCount: number;
    readonly failureCount: number;
    readonly timeoutCount: number;
    readonly complete: boolean;
  };
  readonly runtimeTrace: {
    readonly status: "unavailable";
    readonly method: "none";
    readonly reason: string;
  };
}

/** Parse the explicit CLI measurement mode without changing the GUI/TUI mode. */
export function parseCliStartupArgs(args: readonly string[]): CliStartupMeasurementOptions | undefined {
  if (!args.includes("--cli") && !args.includes("--cli-startup")) {
    return undefined;
  }
  const selectedClasses: CliStartupClass[] = [];
  let repetitions: number | undefined;
  let timeoutMs: number | undefined;
  let repositoryRoot: string | undefined;
  let fixturePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--cli" || argument === "--cli-startup") {
      continue;
    }
    if (argument === "--class" || argument === "--cli-class") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      selectedClasses.push(...parseClassList(value));
      index += 1;
      continue;
    }
    if (argument.startsWith("--class=") || argument.startsWith("--cli-class=")) {
      selectedClasses.push(...parseClassList(argument.slice(argument.indexOf("=") + 1)));
      continue;
    }
    if (argument === "--classes" || argument === "--cli-classes") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a comma-separated value.`);
      selectedClasses.push(...parseClassList(value));
      index += 1;
      continue;
    }
    if (argument.startsWith("--classes=") || argument.startsWith("--cli-classes=")) {
      selectedClasses.push(...parseClassList(argument.slice(argument.indexOf("=") + 1)));
      continue;
    }
    if (argument === "--repetitions" || argument === "--repeat") {
      repetitions = parsePositiveInteger(argument, args[index + 1]);
      index += 1;
      continue;
    }
    if (argument.startsWith("--repetitions=") || argument.startsWith("--repeat=")) {
      repetitions = parsePositiveInteger(argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1));
      continue;
    }
    if (argument === "--timeout-ms") {
      timeoutMs = parsePositiveInteger(argument, args[index + 1]);
      index += 1;
      continue;
    }
    if (argument.startsWith("--timeout-ms=")) {
      timeoutMs = parsePositiveInteger("--timeout-ms", argument.slice(argument.indexOf("=") + 1));
      continue;
    }
    if (argument === "--cwd" || argument === "--repository-root") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a path.`);
      repositoryRoot = resolve(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--cwd=") || argument.startsWith("--repository-root=")) {
      repositoryRoot = resolve(argument.slice(argument.indexOf("=") + 1));
      continue;
    }
    if (argument === "--fixture") {
      const value = args[index + 1];
      if (!value) throw new Error("--fixture requires a path.");
      fixturePath = resolve(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--fixture=")) {
      fixturePath = resolve(argument.slice(argument.indexOf("=") + 1));
      continue;
    }
    throw new Error(`Unknown CLI startup measurement option '${argument}'.`);
  }
  const classes = uniqueClasses(selectedClasses);
  return {
    ...(classes.length > 0 ? { classes } : {}),
    ...(repetitions === undefined ? {} : { repetitions }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(repositoryRoot === undefined ? {} : { repositoryRoot }),
    ...(fixturePath === undefined ? {} : { fixturePath }),
  };
}

/** Execute the deterministic CLI startup contract in sequential sample order. */
export async function runCliStartupMeasurement(
  options: CliStartupMeasurementOptions = {},
  dependencies: CliStartupMeasurementDependencies = {},
): Promise<CliStartupReport> {
  const repositoryRoot = resolve(options.repositoryRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const repetitions = options.repetitions ?? DEFAULT_REPETITIONS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assertPositiveInteger(repetitions, "repetitions");
  assertPositiveInteger(timeoutMs, "timeoutMs");
  const classes = resolveClasses(options.classes);
  const fixturePath = resolve(options.fixturePath ?? join(repositoryRoot, CLI_STATE_FIXTURE_RELATIVE_PATH));
  const fixtureBytes = await readFile(fixturePath);
  const fixture = parseFixture(fixtureBytes.toString("utf8"));
  const entryPath = join(repositoryRoot, CLI_ENTRY_RELATIVE_PATH);
  const entryDigest = digestBytes(await readFile(entryPath));
  const fixtureDigest = digestBytes(fixtureBytes);
  const environment = {
    commit: dependencies.readCommit?.(repositoryRoot) ?? readCommit(repositoryRoot),
    os: `${osPlatform()} ${release()} ${arch()}`,
    platform: osPlatform(),
    arch: arch(),
    bun: typeof Bun === "undefined" ? "unavailable" : Bun.version,
    node: process.versions.node,
    entryDigest,
    artifact: {
      kind: "cli-entry" as const,
      path: redactWorkspacePath(repositoryRoot, entryPath),
      digest: entryDigest,
    },
    fixtureDigest,
    fixture: {
      path: redactWorkspacePath(repositoryRoot, fixturePath),
      digest: fixtureDigest,
    },
  };
  const samples: CliStartupSample[] = [];
  let order = 0;
  for (const command of classes.map((value) => findCommand(value))) {
    for (const state of ["cold", "warm"] as const) {
      const warmStateRoot = state === "warm"
        ? await mkdtemp(join(tmpdir(), "kiln-startup-cli-state-warm-"))
        : undefined;
      try {
        if (warmStateRoot !== undefined) {
          await seedWarmState(warmStateRoot, fixture);
        }
        for (let repetition = 0; repetition < repetitions; repetition += 1) {
          const sample = await measureSample({
            command,
            state,
            order,
            repositoryRoot,
            fixture,
            timeoutMs,
            dependencies,
            ...(warmStateRoot === undefined ? {} : { stateRoot: warmStateRoot }),
          });
          samples.push(sample);
          order += 1;
        }
      } finally {
        if (warmStateRoot !== undefined) {
          await rm(warmStateRoot, { recursive: true, force: true });
        }
      }
    }
  }
  const aggregates = aggregateSamples(samples);
  const successCount = samples.filter((sample) => sample.success).length;
  const timeoutCount = samples.filter((sample) => sample.timeout).length;
  const failureCount = samples.length - successCount;
  return {
    profileVersion: 2,
    profileType: "cli-startup",
    contract: {
      defaultRepetitions: DEFAULT_REPETITIONS,
      repetitions,
      classes,
      states: ["cold", "warm"],
      childProcess: "fresh-per-sample",
      ordering: "sequential-class-state-repetition",
      stateSemantics: "isolated-synthetic-state-only",
      osPageCacheClaim: "not-measured",
      network: "none-by-command-selection",
      aggregation: {
        p50: "arithmetic-midpoint",
        p95: "nearest-rank",
        failedDurations: "excluded",
      },
    },
    commandClasses: classes.map((value) => {
      const command = findCommand(value);
      return {
        class: command.class,
        argv: [...command.argv],
        expectedExit: command.expectedExit,
        expectedOutput: command.expectedOutput,
        ...(command.expectedOutputByState === undefined ? {} : { expectedOutputByState: command.expectedOutputByState }),
        description: command.description,
      };
    }),
    environment,
    samples,
    aggregates,
    summary: {
      sampleCount: samples.length,
      successCount,
      failureCount,
      timeoutCount,
      complete: failureCount === 0,
    },
    runtimeTrace: {
      status: "unavailable",
      method: "none",
      reason: "No validated portable Bun 1.4 module-trace method is available for this profile.",
    },
  };
}

async function measureSample(input: {
  readonly command: CliStartupCommandDefinition;
  readonly state: CliStartupState;
  readonly order: number;
  readonly repositoryRoot: string;
  readonly fixture: CliStateFixture;
  readonly timeoutMs: number;
  readonly dependencies: CliStartupMeasurementDependencies;
  readonly stateRoot?: string;
}): Promise<CliStartupSample> {
  const ownsStateRoot = input.stateRoot === undefined;
  const stateRoot = input.stateRoot ?? await mkdtemp(join(tmpdir(), "kiln-startup-cli-state-cold-"));
  try {
    if (input.state === "warm" && input.stateRoot === undefined) {
      await seedWarmState(stateRoot, input.fixture);
    }
    await mkdir(join(stateRoot, "tmp"), { recursive: true });
    const before = await snapshotState(stateRoot, input.state === "cold" ? "empty" : "seeded");
    const childResult = await (input.dependencies.runChild ?? runFreshChild)({
      executable: process.execPath,
      argv: input.command.argv,
      cwd: input.repositoryRoot,
      stateRoot,
      env: buildChildEnvironment(stateRoot),
      timeoutMs: input.timeoutMs,
    });
    const after = await snapshotState(stateRoot, "observed");
    const redactedStdout = redactOutput(childResult.stdout, input.repositoryRoot, stateRoot);
    const redactedStderr = redactOutput(childResult.stderr, input.repositoryRoot, stateRoot);
    const outputIdentity = createOutputIdentity(redactedStdout, redactedStderr);
    const expectedOutput = input.command.expectedOutputByState?.[input.state] ?? input.command.expectedOutput;
    const success = !childResult.timeout
      && childResult.exit === input.command.expectedExit
      && redactedStdout.includes(expectedOutput);
    const failureReason = success
      ? undefined
      : describeFailure(input.command, expectedOutput, childResult, redactedStdout);
    return {
      class: input.command.class,
      state: input.state,
      order: input.order,
      sequence: input.order + 1,
      argv: [...input.command.argv],
      exit: childResult.exit,
      timeout: childResult.timeout,
      durationMs: normalizeDuration(childResult.durationMs),
      cache: {
        semantics: "isolated-synthetic-state",
        osPageCache: "not-measured",
        before,
        after,
      },
      output: {
        identity: outputIdentity,
        stdoutTail: tail(redactedStdout),
        stderrTail: tail(redactedStderr),
      },
      success,
      ...(failureReason === undefined ? {} : { failureReason }),
    };
  } finally {
    if (ownsStateRoot) {
      await rm(stateRoot, { recursive: true, force: true });
    }
  }
}

async function runFreshChild(input: CliChildInput): Promise<CliChildResult> {
  const startedAt = performance.now();
  let child: Bun.Subprocess;
  try {
    child = Bun.spawn([input.executable, ...input.argv], {
      cwd: input.cwd,
      env: input.env,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      exit: null,
      timeout: false,
      durationMs: elapsedMs(startedAt),
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
  const stdoutPromise = new Response(child.stdout as ReadableStream<Uint8Array>).text();
  const stderrPromise = new Response(child.stderr as ReadableStream<Uint8Array>).text();
  const timeoutToken = Symbol("cli-startup-timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof timeoutToken>((resolveTimeout) => {
    timeoutHandle = setTimeout(() => resolveTimeout(timeoutToken), input.timeoutMs);
  });
  let result: number | typeof timeoutToken;
  try {
    result = await Promise.race([child.exited, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
  const timeout = result === timeoutToken;
  if (timeout) {
    terminateProcessTree(child.pid);
    await Promise.race([child.exited, delay(2_000)]);
  }
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return {
    exit: timeout ? null : typeof result === "number" ? result : null,
    timeout,
    durationMs: elapsedMs(startedAt),
    stdout,
    stderr,
  };
}

async function seedWarmState(root: string, fixture: CliStateFixture): Promise<void> {
  for (const file of fixture.warmFiles) {
    const target = resolveFixturePath(root, file.path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
}

async function snapshotState(root: string, status: CliStartupStateSnapshot["status"]): Promise<CliStartupStateSnapshot> {
  const files = (await collectStateFiles(root)).filter((filePath) => !isTransientStatePath(relative(root, filePath)));
  const entries = await Promise.all(files.map(async (filePath) => {
    const bytes = await readFile(filePath);
    return {
      path: relative(root, filePath).replaceAll("\\", "/"),
      size: bytes.byteLength,
      digest: digestBytes(bytes),
    } satisfies CliStartupStateFile;
  }));
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return {
    kind: "isolated-synthetic-state",
    status,
    fileCount: entries.length,
    digest: digestText(JSON.stringify(entries)),
    files: entries,
  };
}

async function collectStateFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectStateFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function aggregateSamples(samples: readonly CliStartupSample[]): Readonly<Record<string, CliStartupLaneAggregate>> {
  const result: Record<string, CliStartupLaneAggregate> = {};
  for (const sample of samples) {
    const key = `${sample.class}:${sample.state}`;
    if (!(key in result)) {
      result[key] = aggregateLane(sample.class, sample.state, samplesForLane(samples, sample.class, sample.state));
    }
  }
  return result;
}

function samplesForLane(
  samples: readonly CliStartupSample[],
  sampleClass: CliStartupClass,
  state: CliStartupState,
): readonly CliStartupSample[] {
  return samples.filter((sample) => sample.class === sampleClass && sample.state === state);
}

function aggregateLane(
  sampleClass: CliStartupClass,
  state: CliStartupState,
  samples: readonly CliStartupSample[],
): CliStartupLaneAggregate {
  const successes = samples.filter((sample) => sample.success);
  const durationsMs = successes.map((sample) => sample.durationMs).sort((left, right) => left - right);
  return {
    class: sampleClass,
    state,
    sampleCount: samples.length,
    successCount: successes.length,
    failureCount: samples.length - successes.length,
    timeoutCount: samples.filter((sample) => sample.timeout).length,
    exitFailureCount: samples.filter((sample) => !sample.timeout && sample.exit !== null && sample.exit !== 0).length,
    durationsMs,
    p50Ms: durationsMs.length === 0 ? null : arithmeticMidpointPercentile(durationsMs, 0.5),
    p95Ms: durationsMs.length === 0 ? null : nearestRankPercentile(durationsMs, 0.95),
  };
}

function arithmeticMidpointPercentile(sorted: readonly number[], percentile: number): number {
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return roundDuration(lower === upper ? sorted[lower]! : (sorted[lower]! + sorted[upper]!) / 2);
}

function nearestRankPercentile(sorted: readonly number[], percentile: number): number {
  const rank = Math.max(1, Math.ceil(sorted.length * percentile));
  return sorted[rank - 1]!;
}

function parseFixture(value: string): CliStateFixture {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || parsed.fixtureVersion !== 1 || !Array.isArray(parsed.warmFiles)) {
    throw new Error("CLI startup state fixture must declare fixtureVersion 1 and warmFiles.");
  }
  const warmFiles: CliStateFixtureFile[] = [];
  for (const entry of parsed.warmFiles) {
    if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.content !== "string") {
      throw new Error("CLI startup state fixture warmFiles entries must contain path and content.");
    }
    resolveFixturePath("C:\\synthetic-state", entry.path);
    warmFiles.push({ path: entry.path, content: entry.content });
  }
  return { fixtureVersion: 1, warmFiles };
}

function buildChildEnvironment(stateRoot: string): Record<string, string> {
  const environment: Record<string, string> = {};
  const platformEnvironmentNames = process.platform === "win32"
    ? ["Path", "PATH", "PATHEXT", "ComSpec", "COMSPEC", "SystemRoot", "SYSTEMROOT", "SystemDrive", "WINDIR"]
    : ["PATH", "TMPDIR", "LANG", "LC_ALL"];
  for (const name of platformEnvironmentNames) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  const stateHome = join(stateRoot, "kiln");
  const tempRoot = join(stateRoot, "tmp");
  environment.HOME = stateRoot;
  environment.USERPROFILE = stateRoot;
  environment.APPDATA = stateRoot;
  environment.LOCALAPPDATA = stateRoot;
  environment.XDG_CONFIG_HOME = stateRoot;
  environment.XDG_DATA_HOME = join(stateRoot, "data");
  environment.XDG_CACHE_HOME = join(stateRoot, "cache");
  environment.TMP = tempRoot;
  environment.TEMP = tempRoot;
  environment.TMPDIR = tempRoot;
  environment.KILN_HOME = stateHome;
  environment.CODEX_HOME = join(stateRoot, "codex");
  environment.CLAUDE_CONFIG_DIR = join(stateRoot, "claude");
  environment.KILN_STARTUP_PROFILE = "1";
  environment.NO_COLOR = "1";
  return environment;
}

function resolveFixturePath(root: string, relativePath: string): string {
  if (relativePath.trim().length === 0 || relativePath.includes("\\") || relativePath.startsWith("/")) {
    throw new Error(`CLI startup fixture path is not portable: ${relativePath}`);
  }
  const target = resolve(root, relativePath);
  const prefix = `${resolve(root)}${process.platform === "win32" ? "\\" : "/"}`;
  if (!target.startsWith(prefix)) {
    throw new Error(`CLI startup fixture path escapes synthetic state: ${relativePath}`);
  }
  return target;
}

function createOutputIdentity(stdout: string, stderr: string): CliStartupOutputIdentity {
  return {
    stdout: digestText(stdout),
    stderr: digestText(stderr),
    combined: digestText(`${stdout}\n${stderr}`),
  };
}

function redactOutput(value: string, repositoryRoot: string, stateRoot: string): string {
  return value
    .replaceAll(stateRoot, "<synthetic-state>")
    .replaceAll(repositoryRoot, "<workspace>")
    .replaceAll(stateRoot.replaceAll("\\", "/"), "<synthetic-state>")
    .replaceAll(repositoryRoot.replaceAll("\\", "/"), "<workspace>")
    .replaceAll(/([A-Za-z]:\\[^\r\n\s"]+|\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/gu, "<path>")
    .replaceAll(/\r\n/gu, "\n");
}

function redactWorkspacePath(repositoryRoot: string, path: string): string {
  const relativePath = relative(repositoryRoot, path).replaceAll("\\", "/");
  return `<workspace:${relativePath}>`;
}

function describeFailure(
  command: CliStartupCommandDefinition,
  expectedOutput: string,
  childResult: CliChildResult,
  stdout: string,
): string {
  if (childResult.timeout) return "child process timed out";
  if (childResult.exit !== command.expectedExit) return `expected exit ${command.expectedExit}, observed ${childResult.exit ?? "unknown"}`;
  if (!stdout.includes(expectedOutput)) return `stdout did not contain '${expectedOutput}'`;
  return "command behavior did not satisfy the startup contract";
}

function isTransientStatePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("cache/bun/");
}

function resolveClasses(classes: readonly CliStartupClass[] | undefined): readonly CliStartupClass[] {
  const selected = uniqueClasses(classes ?? ["help", "simple", "heavy"]);
  if (selected.length === 0) throw new Error("At least one CLI startup class is required.");
  for (const value of selected) findCommand(value);
  return selected;
}

function uniqueClasses(classes: readonly CliStartupClass[]): readonly CliStartupClass[] {
  return [...new Set(classes)];
}

function parseClassList(value: string): CliStartupClass[] {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) throw new Error("CLI startup class list cannot be empty.");
  for (const item of values) {
    if (item !== "help" && item !== "simple" && item !== "heavy") {
      throw new Error(`Unknown CLI startup class '${item}'. Use help, simple, or heavy.`);
    }
  }
  return values as CliStartupClass[];
}

function findCommand(value: CliStartupClass): CliStartupCommandDefinition {
  const command = CLI_STARTUP_COMMANDS.find((candidate) => candidate.class === value);
  if (!command) throw new Error(`Unknown CLI startup class '${value}'.`);
  return command;
}

function parsePositiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
}

function normalizeDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return roundDuration(value);
}

function roundDuration(value: number): number {
  return Math.round(value * 100) / 100;
}

function elapsedMs(startedAt: number): number {
  return normalizeDuration(performance.now() - startedAt);
}

function digestBytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestText(value: string): string {
  return digestBytes(Buffer.from(value, "utf8"));
}

function readCommit(repositoryRoot: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "unavailable";
  } catch {
    return "unavailable";
  }
}

function terminateProcessTree(pid: number): void {
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: 2_000,
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process already exited.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function tail(value: string): string {
  if (value.length <= MAX_OUTPUT_TAIL_LENGTH) return value;
  return value.slice(-MAX_OUTPUT_TAIL_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
