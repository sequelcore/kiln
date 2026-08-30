import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import {
  parseCliStartupArgs,
  runCliStartupMeasurement,
  type CliChildInput,
  type CliChildResult,
} from "./profile-startup-cli.js";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(import.meta.dirname, "..");
const GUI_GATEWAY_READY_BUDGET_MS = 5_000;
const GUI_FIRST_USABLE_BUDGET_MS = 12_000;

test("parses the explicit CLI startup measurement mode with a test-sized repetition count", () => {
  expect(parseCliStartupArgs([
    "--cli",
    "--classes",
    "help,heavy",
    "--repetitions",
    "2",
    "--timeout-ms=4000",
  ])).toEqual({
    classes: ["help", "heavy"],
    repetitions: 2,
    timeoutMs: 4_000,
  });
  expect(parseCliStartupArgs(["--mode", "dev"])).toBeUndefined();
});

test("records isolated cold/warm CLI lanes and frozen aggregates through a synthetic child seam", async () => {
  const childInputs: CliChildInput[] = [];
  let duration = 10;
  const runChild = async (input: CliChildInput): Promise<CliChildResult> => {
    childInputs.push(input);
    const output = input.argv.includes("--help")
      ? "Usage: kiln [command] [options]"
      : input.argv.includes("target")
        ? "Execution Targets:"
        : '{"schemaRevision": null}';
    return {
      exit: 0,
      timeout: false,
      durationMs: duration,
      stdout: output,
      stderr: "",
    };
  };
  const report = await runCliStartupMeasurement({
    classes: ["help", "simple", "heavy"],
    repetitions: 2,
    timeoutMs: 4_000,
  }, {
    runChild: async (input) => {
      const result = await runChild(input);
      duration += 10;
      return result;
    },
  });

  expect(report.profileType).toBe("cli-startup");
  expect(report.contract).toMatchObject({
    repetitions: 2,
    defaultRepetitions: 20,
    childProcess: "fresh-per-sample",
    ordering: "sequential-class-state-repetition",
    stateSemantics: "isolated-synthetic-state-only",
    osPageCacheClaim: "not-measured",
    aggregation: {
      p50: "arithmetic-midpoint",
      p95: "nearest-rank",
      failedDurations: "excluded",
    },
  });
  expect(report.samples).toHaveLength(12);
  expect(report.samples.map((sample) => sample.order)).toEqual([...Array(12).keys()]);
  expect(report.samples.map((sample) => sample.sequence)).toEqual([...Array(12).keys()].map((value) => value + 1));
  const rootsByLane = new Map<string, string[]>();
  for (const [index, input] of childInputs.entries()) {
    const sample = report.samples[index]!;
    const key = `${sample.class}:${sample.state}`;
    rootsByLane.set(key, [...(rootsByLane.get(key) ?? []), input.stateRoot]);
  }
  for (const commandClass of ["help", "simple", "heavy"] as const) {
    expect(new Set(rootsByLane.get(`${commandClass}:cold`)).size).toBe(2);
    expect(new Set(rootsByLane.get(`${commandClass}:warm`)).size).toBe(1);
  }
  const rootsByClass = new Map<string, Set<string>>();
  for (const [index, input] of childInputs.entries()) {
    const sample = report.samples[index]!;
    const roots = rootsByClass.get(sample.class) ?? new Set<string>();
    roots.add(input.stateRoot);
    rootsByClass.set(sample.class, roots);
  }
  expect([...rootsByClass.get("help")!].some((root) => rootsByClass.get("simple")!.has(root))).toBe(false);
  expect([...rootsByClass.get("help")!].some((root) => rootsByClass.get("heavy")!.has(root))).toBe(false);
  expect([...rootsByClass.get("simple")!].some((root) => rootsByClass.get("heavy")!.has(root))).toBe(false);
  expect(childInputs.every((input) => input.env.XDG_CONFIG_HOME === input.stateRoot)).toBe(true);
  expect(childInputs.every((input) => input.env.HOME === input.stateRoot)).toBe(true);
  expect(childInputs.every((input) => input.env.USERPROFILE === input.stateRoot)).toBe(true);
  expect(childInputs.every((input) => !("AWS_ACCESS_KEY_ID" in input.env))).toBe(true);
  expect(childInputs.every((input) => !("OPENAI_API_KEY" in input.env))).toBe(true);
  expect(childInputs.every((input) => !("NODE_OPTIONS" in input.env))).toBe(true);
  expect(report.samples[0]).toMatchObject({
    class: "help",
    state: "cold",
    exit: 0,
    timeout: false,
    success: true,
    cache: {
      semantics: "isolated-synthetic-state",
      osPageCache: "not-measured",
      before: { status: "empty", fileCount: 0 },
      after: { status: "observed", fileCount: 0 },
    },
  });
  expect(report.samples[2]).toMatchObject({
    class: "help",
    state: "warm",
    cache: {
      before: { status: "seeded", fileCount: 2 },
    },
  });
  expect(report.samples.every((sample) => !sample.output.stdoutTail.includes("kiln-startup-cli-state-"))).toBe(true);
  expect(report.samples.every((sample) => sample.output.identity.combined.startsWith("sha256:"))).toBe(true);
  expect(report.samples.every((sample) => !("outputIdentity" in sample))).toBe(true);
  expect(report.aggregates["help:cold"]).toMatchObject({
    sampleCount: 2,
    successCount: 2,
    failureCount: 0,
    timeoutCount: 0,
    p50Ms: 15,
    p95Ms: 20,
  });
  expect(report.summary).toEqual({
    sampleCount: 12,
    successCount: 12,
    failureCount: 0,
    timeoutCount: 0,
    complete: true,
  });
  expect(report.runtimeTrace.status).toBe("unavailable");
});

test("counts command failures and excludes them from percentile durations", async () => {
  let invocation = 0;
  const report = await runCliStartupMeasurement({ classes: ["simple"], repetitions: 2 }, {
    runChild: async () => {
      invocation += 1;
      if (invocation === 1 || invocation === 3) {
        return { exit: 0, timeout: false, durationMs: 12, stdout: "Execution Targets:", stderr: "" };
      }
      if (invocation === 2) {
        return { exit: 1, timeout: false, durationMs: 99, stdout: "failure", stderr: "diagnostic" };
      }
      return { exit: null, timeout: true, durationMs: 99, stdout: "timeout", stderr: "diagnostic" };
    },
  });
  expect(report.summary).toMatchObject({
    sampleCount: 4,
    successCount: 2,
    failureCount: 2,
    timeoutCount: 1,
    complete: false,
  });
  expect(report.aggregates["simple:cold"]).toMatchObject({
    sampleCount: 2,
    successCount: 1,
    failureCount: 1,
    timeoutCount: 0,
    exitFailureCount: 1,
    p50Ms: 12,
    p95Ms: 12,
  });
  expect(report.aggregates["simple:warm"]).toMatchObject({
    sampleCount: 2,
    successCount: 1,
    failureCount: 1,
    timeoutCount: 1,
    exitFailureCount: 0,
    p50Ms: 12,
    p95Ms: 12,
  });
});

test("bounds timed-out output drain when a descendant inherits the pipes", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "kiln-startup-cli-descendant-"));
  const fixture = resolve(repoRoot, "scripts", "fixtures", "profile-startup-cli-descendant.mjs");
  const harness = resolve(repoRoot, "scripts", "fixtures", "profile-startup-cli-child-harness.mjs");
  const pidFile = join(stateRoot, "descendant.pid");
  try {
    const startedAt = performance.now();
    const childInput = {
      executable: process.execPath,
      argv: [fixture, "parent"],
      cwd: repoRoot,
      stateRoot,
      env: {
        PATH: process.env.PATH ?? "",
        KILN_PROFILE_DESCENDANT_PID_FILE: pidFile,
      },
      timeoutMs: 100,
    } satisfies CliChildInput;
    const child = await execFile("bun", ["run", harness], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 3_000,
      maxBuffer: 1_000_000,
      env: {
        ...process.env,
        KILN_PROFILE_CHILD_INPUT: JSON.stringify(childInput),
      },
    });
    const result = JSON.parse(child.stdout.trim()) as CliChildResult;
    const elapsedMs = performance.now() - startedAt;

    expect(result.timeout).toBe(true);
    expect(result.exit).toBeNull();
    expect(result.stdout).toContain("parent-open");
    expect(elapsedMs).toBeLessThan(2_000);
    const descendantPid = Number(await readFile(pidFile, "utf8"));
    expect(Number.isInteger(descendantPid)).toBe(true);
    expect(isProcessAlive(descendantPid)).toBe(false);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("profiles the first usable GUI interaction when browser measurement is enabled", async () => {
  const gatewayPort = await reservePort();
  const guiPort = await reservePort();
  const configHome = await seedGlobalConfiguration();
  const stdout = await runStartupProfile(gatewayPort, guiPort, configHome)
    .finally(() => rm(configHome, { recursive: true, force: true }));

  const profile = JSON.parse(stdout) as {
    command: { measureFirstPaint?: boolean };
    timings: {
      firstUsablePaintMs?: number;
      browserResourceSummary?: {
        count: number;
        slowest: Array<{ name: string; durationMs: number }>;
      };
      milestones: Array<{ name: string; atMs: number }>;
      phaseMarkers: Array<{ surface?: string; phase?: string }>;
    };
  };
  expect(profile.command.measureFirstPaint).toBe(true);
  expect(profile.timings.firstUsablePaintMs).toBeGreaterThan(0);
  expect(profile.timings.browserResourceSummary?.count).toBeGreaterThan(0);
  expect(profile.timings.browserResourceSummary?.slowest.length).toBeGreaterThan(0);
  expect(profile.timings.browserResourceSummary?.slowest[0]?.durationMs).toBeGreaterThanOrEqual(0);
  expect(profile.timings.browserResourceSummary?.slowest[0]?.name).toMatch(/^\/gui\//u);
  expect(profile.timings.milestones.map((milestone) => milestone.name)).toContain("browser-ready");
  expect(profile.timings.milestones.map((milestone) => milestone.name)).toContain("gui-first-usable-interaction");
  const gatewayReady = profile.timings.milestones.find((milestone) => milestone.name === "gateway-health-ready");
  expect(gatewayReady?.atMs).toBeLessThan(GUI_GATEWAY_READY_BUDGET_MS);
  expect(profile.timings.firstUsablePaintMs).toBeLessThan(GUI_FIRST_USABLE_BUDGET_MS);
  const gatewayStartedIndex = profile.timings.phaseMarkers.findIndex((marker) => (
    marker.surface === "gui" && marker.phase === "gateway-started"
  ));
  const managedRefreshIndex = profile.timings.phaseMarkers.findIndex((marker) => (
    marker.surface === "managed-agent-route-catalog" && marker.phase === "route-catalog-background-refresh-started"
  ));
  expect(gatewayStartedIndex).toBeGreaterThanOrEqual(0);
  expect(managedRefreshIndex).toBeGreaterThan(gatewayStartedIndex);
}, 75_000);

/**
 * The GUI refuses to start without a configured execution target, and a startup
 * benchmark that reads the operator's own configuration cannot be compared
 * between runs or machines. Point global configuration at a committed fixture so
 * every run profiles the same input. packages/cli keeps that fixture in step with
 * the configuration contract.
 */
async function seedGlobalConfiguration(): Promise<string> {
  const configHome = await mkdtemp(join(tmpdir(), "kiln-startup-profile-config-"));
  const kilnHome = join(configHome, "kiln");
  const sourceConfigPath = resolve(repoRoot, "scripts", "fixtures", "startup-profile-global-config.yaml");
  const configSource = await readFile(sourceConfigPath, "utf8");
  const evidenceRevision = configSource.match(/^[ \t]*evidenceRevision:[ \t]*["']?(sha256:[a-f0-9]{64})["']?[ \t]*$/mu)?.[1];
  if (!evidenceRevision) throw new Error("Startup profile fixture does not declare an execution-target evidence revision.");
  const evidenceDirectory = join(kilnHome, "evidence", "execution-targets");
  await mkdir(evidenceDirectory, { recursive: true });
  await copyFile(
    sourceConfigPath,
    join(kilnHome, "config.yaml"),
  );
  await copyFile(
    resolve(repoRoot, "scripts", "fixtures", "startup-profile-execution-target-evidence.json"),
    join(evidenceDirectory, `${evidenceRevision.slice("sha256:".length)}.json`),
  );
  return configHome;
}

async function runStartupProfile(
  gatewayPort: number,
  guiPort: number,
  configHome: string,
): Promise<string> {
  try {
    const result = await execFile("bun", [
      "run",
      "scripts/profile-startup.ts",
      "--mode",
      "dev",
      "--cwd",
      repoRoot,
      "--port",
      String(gatewayPort),
      "--gui-port",
      String(guiPort),
      "--timeout-ms",
      "60000",
      "--measure-first-paint",
      "--no-open",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 70_000,
      env: { ...process.env, XDG_CONFIG_HOME: configHome },
    });
    return result.stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(
      [
        "GUI startup profile command failed",
        failure.stdout,
        failure.stderr,
        failure.message,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a startup profile port");
  }
  return address.port;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
