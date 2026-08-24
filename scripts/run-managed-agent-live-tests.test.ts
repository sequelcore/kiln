import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL,
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_OPENCODE_MODEL,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV,
} from "./managed-agent-live-preflight.js";
import { parseSourceStabilityRecoveryManifest, type SourceStabilityRecoveryManifest } from "./source-stability-recovery-report.js";
import {
  collectCandidateMetadata,
  collectManagedAgentLiveChildOutput,
  persistManagedAgentLiveReport,
  runManagedAgentLiveTests,
  SOURCE_STABILITY_RECOVERY_EVIDENCE_DIRECTORY,
  terminateManagedAgentLiveProcessTree,
  type ManagedAgentLiveRunnerOptions,
  type ManagedAgentLiveSpawnResult,
} from "./run-managed-agent-live-tests.js";

const repositoryRoot = join(import.meta.dirname, "..");
const manifestPath = join(repositoryRoot, "scripts", "fixtures", "source-stability-recovery.manifest.json");
const commit = "0123456789abcdef0123456789abcdef01234567";
const fixtures: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("managed-agent live runner", () => {
  it("is import-safe and exposes the guarded runner seam", () => {
    expect(runManagedAgentLiveTests).toBeTypeOf("function");
    expect(persistManagedAgentLiveReport).toBeTypeOf("function");
  });

  it("denial persists a not-started report without version probes or child execution", async () => {
    const fixture = createFixture();
    const probeVersion = vi.fn(() => "1.18.18");
    const spawnVitest = vi.fn(async (): Promise<ManagedAgentLiveSpawnResult> => ({
      stdout: "{}",
      stderr: "should-not-run",
      exitCode: 0,
    }));
    const result = await runManagedAgentLiveTests(baseOptions(fixture, {
      environment: {},
      probeVersion,
      spawnVitest,
    }));

    expect(result.exitCode).toBe(1);
    expect(result.report?.preflight).toBe("denied");
    expect(result.report?.liveRun).toEqual({ status: "not-started", reasonCode: "preflight-denied" });
    expect(probeVersion).not.toHaveBeenCalled();
    expect(spawnVitest).not.toHaveBeenCalled();
    expect(readLatest(fixture)).toMatchObject({
      preflight: "denied",
      liveRun: { status: "not-started", reasonCode: "preflight-denied" },
    });
  });

  it("runs Vitest through the Bun seam and writes a completed sanitized report", async () => {
    const fixture = createFixture();
    const manifest = readManifest();
    const spawnVitest = vi.fn(async (): Promise<ManagedAgentLiveSpawnResult> => ({
      stdout: JSON.stringify(successVitest(manifest, openCodeEnvironment())),
      stderr: "provider stderr must not be persisted",
      exitCode: 0,
    }));
    const result = await runManagedAgentLiveTests(baseOptions(fixture, {
      environment: openCodeEnvironment(),
      spawnVitest,
      probeVersion: () => "1.18.18",
    }));

    expect(result.exitCode).toBe(0);
    expect(result.report?.liveProofOutcome).toBe("passed");
    expect(result.report?.liveRun).toEqual({ status: "completed", exitCode: 0 });
    expect(spawnVitest).toHaveBeenCalledOnce();
    expect(readLatest(fixture).liveRun).toEqual({ status: "completed", exitCode: 0 });
  });

  it.each(["unknown", "disabled-passed"] as const)("replaces a seeded latest report when live observation is %s", async (kind) => {
    const fixture = createFixture();
    const manifest = readManifest();
    const proof = manifest.liveProofs.find((candidate) => candidate.id === "opencode-approved-write");
    if (!proof || proof.kind !== "implemented") throw new Error("fixture is missing OpenCode write proof");
    const name = kind === "unknown"
      ? "packages/runtime/tests/managed-agent/unknown.live.test.ts"
      : proof.locator.path;
    const title = kind === "unknown" ? "unlisted unauthorized assertion" : proof.locator.title;
    mkdirSync(join(fixture.binding.evidencePath, "source-stability-recovery"), { recursive: true });
    writeFileSync(latestPath(fixture), JSON.stringify({ previous: true }), "utf8");

    const result = await runManagedAgentLiveTests(baseOptions(fixture, {
      environment: openCodeEnvironment(),
      spawnVitest: async () => ({
        stdout: JSON.stringify({
          testResults: [{
            name,
            assertionResults: [{ title, fullName: title, status: "passed" }],
          }],
        }),
        stderr: "raw unauthorized provider payload",
        exitCode: 0,
      }),
      probeVersion: () => "1.18.18",
    }));

    expect(result.exitCode).toBe(1);
    expect(result.report?.liveRun).toEqual({ status: "failed", reasonCode: "invalid-live-observation" });
    expect(result.report?.cleanupOutcome).toBe("unverified");
    expect(result.report?.residualRisks).toContain("live-run-failed:invalid-live-observation");
    const persisted = readFileSync(latestPath(fixture), "utf8");
    expect(persisted).not.toContain('"previous":true');
    if (kind === "unknown") expect(persisted).not.toContain(title);
    expect(persisted).not.toContain("raw unauthorized provider payload");
  });

  it("reports executor provenance as a blocker instead of abusing spawn-failed", async () => {
    const fixture = createFixture();
    const spawnVitest = vi.fn(async (): Promise<ManagedAgentLiveSpawnResult> => ({
      stdout: JSON.stringify({ testResults: [] }),
      stderr: "must not execute",
      exitCode: 0,
    }));
    const result = await runManagedAgentLiveTests(baseOptions(fixture, {
      environment: openCodeEnvironment(),
      probeVersion: () => {
        throw new Error("raw version probe failure");
      },
      spawnVitest,
    }));

    expect(result.exitCode).toBe(1);
    expect(result.blocker).toBe("executor-provenance-unavailable");
    expect(result.report?.liveRun).toEqual({ status: "not-started", reasonCode: "executor-provenance-unavailable" });
    expect(spawnVitest).not.toHaveBeenCalled();
    expect(existsSync(latestPath(fixture))).toBe(true);
  });

  it("retains valid per-case evidence when Vitest exits nonzero", async () => {
    const fixture = createFixture();
    const manifest = readManifest();
    const proof = manifest.liveProofs.find((candidate) => candidate.id === "opencode-cancellation");
    if (!proof || proof.kind !== "implemented") throw new Error("fixture is missing cancellation proof");
    const locator = proof.locator;
    const result = await runManagedAgentLiveTests(baseOptions(fixture, {
      environment: openCodeEnvironment(),
      spawnVitest: async () => ({
        stdout: JSON.stringify({
          testResults: [{
            name: locator.path,
            assertionResults: [{ title: locator.title, fullName: locator.title, status: "passed" }],
          }],
        }),
        stderr: "raw provider stderr",
        exitCode: 7,
      }),
      probeVersion: () => "1.18.18",
    }));

    expect(result.exitCode).toBe(7);
    expect(result.report?.liveRun).toEqual({ status: "failed", reasonCode: "test-process-nonzero", exitCode: 7 });
    expect(result.report?.liveProofs.find((candidate) => candidate.id === proof.id)).toMatchObject({
      status: "executed", reasonCode: "test-passed",
    });
    expect(JSON.stringify(readLatest(fixture))).not.toContain("raw provider stderr");
  });

  it.each([
    ["missing-json", "", ""],
    ["malformed-json", "not-json", "raw stderr"],
  ] as const)("maps %s to the existing stable run reason", async (reasonCode, stdout, stderr) => {
    const fixture = createFixture();
    const result = await runManagedAgentLiveTests(baseOptions(fixture, {
      environment: openCodeEnvironment(),
      spawnVitest: async () => ({ stdout, stderr, exitCode: 0 }),
      probeVersion: () => "1.18.18",
    }));

    expect(result.exitCode).toBe(1);
    expect(result.report?.liveRun).toEqual({ status: "failed", reasonCode, exitCode: 0 });
  });

  it.each([
    ["spawn-failed", { stdout: "", stderr: "raw spawn stderr", error: new Error("raw spawn error") }],
    ["test-process-terminated", { stdout: "", stderr: "raw terminated stderr", exitCode: null, signal: "SIGTERM" }],
  ] as const)("maps %s without persisting raw child details", async (reasonCode, spawnResult) => {
    const fixture = createFixture();
    const log = vi.fn();
    const error = vi.fn();
    const result = await runManagedAgentLiveTests(baseOptions(fixture, {
      environment: openCodeEnvironment(),
      spawnVitest: async () => spawnResult,
      probeVersion: () => "1.18.18",
      logger: { log, error },
    }));

    expect(result.exitCode).toBe(1);
    expect(result.report?.liveRun).toEqual({ status: "failed", reasonCode });
    expect(JSON.stringify(readLatest(fixture))).not.toMatch(/raw (?:spawn|terminated)|SIGTERM/iu);
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toMatch(/raw (?:spawn|terminated)|SIGTERM/iu);
  });

  it("records only a dirty boolean and never leaks status paths", async () => {
    const observed = collectCandidateMetadata({
      runGit: (args) => args[0] === "rev-parse"
        ? { status: 0, stdout: `${commit}\n` }
        : { status: 0, stdout: " M private/operator-secret.txt\n?? credentials.json\n" },
    });

    expect(observed).toEqual({ commit, dirty: true });
    expect(JSON.stringify(observed)).not.toContain("private/operator-secret.txt");
    expect(JSON.stringify(observed)).not.toContain("credentials.json");
  });

  it("consolidates duplicate OpenCode and Codex OAuth direct identities", async () => {
    const fixture = createFixture();
    const result = await runManagedAgentLiveTests(baseOptions(fixture, {
      environment: {
        KILN_LIVE_MANAGED_AGENT_TESTS: "1",
        [KILN_LIVE_OPENCODE_TESTS_ENV]: "1",
        [KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV]: "1",
        [KILN_LIVE_OPENCODE_MODEL]: "opencode/minimax-m2.7-free",
        [KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV]: "1",
        [KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV]: "1",
        [KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL]: "gpt-5.5",
      },
      probeVersion: () => "1.18.18",
      runtimeVersion: () => "3.0.0-beta.1",
      spawnVitest: async () => ({ stdout: JSON.stringify(successVitest(readManifest(), {
        KILN_LIVE_MANAGED_AGENT_TESTS: "1",
        [KILN_LIVE_OPENCODE_TESTS_ENV]: "1",
        [KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV]: "1",
        [KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV]: "1",
        [KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV]: "1",
      })), stderr: "", exitCode: 0 }),
    }));

    expect(result.exitCode).toBe(0);
    expect(result.report?.executors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: "opencode",
        harnessId: "opencode-cli",
        enabledAuthorityFlags: expect.arrayContaining([
          KILN_LIVE_OPENCODE_TESTS_ENV,
          KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV,
        ]),
      }),
      expect.objectContaining({
        providerId: "codex-oauth",
        harnessId: "kiln-direct-runtime",
        enabledAuthorityFlags: expect.arrayContaining([
          KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
          KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
        ]),
      }),
    ]));
    expect(result.report?.executors).toHaveLength(3);
    const executorFlags = [...new Set(result.report?.executors.flatMap((executor) => executor.enabledAuthorityFlags) ?? [])].sort();
    expect(executorFlags).toEqual([
      "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS",
      "KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS",
      "KILN_LIVE_MANAGED_AGENT_TESTS",
      "KILN_LIVE_OPENCODE_TESTS",
      "KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS",
    ]);
    expect(result.report?.enabledAuthorityFlags).toEqual(executorFlags);
  });

  it("does not persist explicit route values or raw command output", async () => {
    const fixture = createFixture();
    const route = "acct-secret-route-123";
    const raw = "RAW_STDOUT_SECRET RAW_STDERR_SECRET";
    const result = await runManagedAgentLiveTests(baseOptions(fixture, {
      environment: {
        KILN_LIVE_MANAGED_AGENT_TESTS: "1",
        [KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV]: "1",
        [KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV]: route,
      },
      runtimeVersion: () => "3.0.0-beta.1",
      spawnVitest: async () => ({ stdout: raw, stderr: raw, exitCode: 0 }),
      logger: { log: vi.fn(), error: vi.fn() },
    }));

    expect(result.exitCode).toBe(1);
    const persisted = readFileSync(latestPath(fixture), "utf8");
    expect(persisted).not.toContain(route);
    expect(persisted).not.toContain(raw);
  });

  it("enforces the private project-state target immediately before writing", () => {
    const fixture = createFixture();
    const outside = join(fixture.root, "outside", "latest.json");
    mkdirSync(join(fixture.root, "outside"), { recursive: true });
    expect(() => persistManagedAgentLiveReport({
      projectStateRoot: fixture.privateStateRoot,
      evidenceDirectory: join(fixture.root, "outside"),
      outputFile: outside,
      report: { sanitized: true },
    })).toThrow(/private|root|escape/iu);
    expect(existsSync(outside)).toBe(false);
  });

  it.each(["write", "fsync", "rename"] as const)("preserves the previous report when atomic %s fails", (failure) => {
    const fixture = createFixture();
    const output = latestPath(fixture);
    mkdirSync(join(fixture.binding.evidencePath, "source-stability-recovery"), { recursive: true });
    const previous = JSON.stringify({ previous: true });
    writeFileSync(output, `${previous}\n`, "utf8");
    const removed: string[] = [];
    const operations = {
      writeTempFileSync: (path: string, value: string, mode: number) => {
        expect(mode).toBe(0o600);
        if (failure === "write") throw new Error("raw write fault");
        writeFileSync(path, value, { encoding: "utf8", flag: "wx", mode });
      },
      syncTempFileSync: (_path: string) => {
        if (failure === "fsync") throw new Error("raw fsync fault");
      },
      replaceFileSync: (_temp: string, _target: string) => {
        if (failure === "rename") throw new Error("raw rename fault");
      },
      removeTempFileSync: (path: string) => {
        removed.push(path);
        try { rmSync(path, { force: true }); } catch { /* test cleanup seam */ }
      },
    };

    expect(() => persistManagedAgentLiveReport({
      projectStateRoot: fixture.privateStateRoot,
      evidenceDirectory: join(fixture.binding.evidencePath, SOURCE_STABILITY_RECOVERY_EVIDENCE_DIRECTORY),
      outputFile: output,
      report: { replacement: true },
      fileOperations: operations,
    })).toThrow();
    expect(readFileSync(output, "utf8")).toBe(`${previous}\n`);
    expect(removed).toHaveLength(1);
  });

  it("atomically replaces an existing latest report and leaves no temp file", () => {
    const fixture = createFixture();
    const directory = join(fixture.binding.evidencePath, SOURCE_STABILITY_RECOVERY_EVIDENCE_DIRECTORY);
    const output = latestPath(fixture);
    mkdirSync(directory, { recursive: true });
    writeFileSync(output, '{"previous":true}\n', "utf8");

    persistManagedAgentLiveReport({
      projectStateRoot: fixture.privateStateRoot,
      evidenceDirectory: directory,
      outputFile: output,
      report: { replacement: true },
    });

    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({ replacement: true });
    expect(readdirSync(directory).filter((name) => name.includes(".latest.json.")).length).toBe(0);
  });

  it("rejects an injected temp path outside the latest report directory", () => {
    const fixture = createFixture();
    const directory = join(fixture.binding.evidencePath, SOURCE_STABILITY_RECOVERY_EVIDENCE_DIRECTORY);
    const output = latestPath(fixture);
    const outside = join(fixture.root, "outside-temp.json");
    mkdirSync(directory, { recursive: true });
    writeFileSync(output, '{"previous":true}\n', "utf8");

    expect(() => persistManagedAgentLiveReport({
      projectStateRoot: fixture.privateStateRoot,
      evidenceDirectory: directory,
      outputFile: output,
      report: { replacement: true },
      fileOperations: { tempFilePath: () => outside },
    })).toThrow(/share.*directory/iu);
    expect(readFileSync(output, "utf8")).toBe('{"previous":true}\n');
    expect(existsSync(outside)).toBe(false);
  });
});

describe("managed-agent live child settlement", () => {
  it("maps a deadline to timeout and resolves only after close", async () => {
    const child = new FakeChild(101);
    let closed = false;
    const resultPromise = collectManagedAgentLiveChildOutput(child, {
      deadlineMs: 5,
      killGraceMs: 1,
      processControl: {
        platform: "win32",
        terminateTree: async () => {
          child.once("close", () => { closed = true; });
          child.close(null, null);
        },
      },
    });
    const result = await resultPromise;
    expect(result.terminationReason).toBe("timeout");
    expect(closed).toBe(true);
  });

  it("maps an already-aborted signal to interrupted and clears its deadline", async () => {
    const controller = new AbortController();
    controller.abort();
    const child = new FakeChild(102);
    const result = await collectManagedAgentLiveChildOutput(child, {
      abortSignal: controller.signal,
      deadlineMs: 25,
      killGraceMs: 1,
      processControl: {
        terminateTree: async () => child.close(null, null),
      },
    });
    expect(result.terminationReason).toBe("interrupted");
  });

  it("preserves timeout over late oversized output and child errors", async () => {
    const child = new FakeChild(109);
    const resultPromise = collectManagedAgentLiveChildOutput(child, {
      deadlineMs: 1,
      maxOutputBytes: 4,
      terminationCloseMs: 25,
      processControl: {
        terminateTree: async () => {
          child.stdoutStream.emit("data", "late oversized output");
          child.emit("error", new Error("late raw child error"));
          child.close(null, null);
        },
      },
    });
    const result = await resultPromise;
    expect(result).toEqual({ stdout: "", stderr: "", terminationReason: "timeout" });
  });

  it("preserves interruption over late oversized output", async () => {
    const child = new FakeChild(110);
    const controller = new AbortController();
    const resultPromise = collectManagedAgentLiveChildOutput(child, {
      abortSignal: controller.signal,
      maxOutputBytes: 4,
      terminationCloseMs: 25,
      processControl: {
        terminateTree: async () => {
          child.stderrStream.emit("data", "late oversized output");
          child.close(null, null);
        },
      },
    });
    controller.abort();
    expect(await resultPromise).toEqual({ stdout: "", stderr: "", terminationReason: "interrupted" });
  });

  it("bounds combined stdout and stderr without retaining oversized content", async () => {
    const child = new FakeChild(103);
    const terminateTree = vi.fn(async () => child.close(null, null));
    const resultPromise = collectManagedAgentLiveChildOutput(child, {
      maxOutputBytes: 5,
      processControl: { terminateTree },
    });
    child.stdoutStream.emit("data", "1234");
    child.stderrStream.emit("data", "56");
    const result = await resultPromise;
    expect(result.terminationReason).toBe("output-limit");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(terminateTree).toHaveBeenCalledOnce();
  });

  it("settles after a bounded close wait when tree termination does not close the child", async () => {
    const child = new FakeChild(107);
    const result = await collectManagedAgentLiveChildOutput(child, {
      deadlineMs: 1,
      terminationCloseMs: 5,
      processControl: { terminateTree: async () => undefined },
    });
    expect(result).toEqual({ stdout: "", stderr: "", terminationReason: "timeout" });
  });

  it.each([
    { deadlineMs: 0 },
    { maxOutputBytes: 0 },
    { killGraceMs: 0 },
    { terminationCloseMs: 0 },
    { deadlineMs: Number.NaN },
  ])("rejects invalid settlement bounds: %o", (bounds) => {
    expect(() => collectManagedAgentLiveChildOutput(new FakeChild(108), bounds)).toThrow(/invalid live/iu);
  });

  it("uses the Windows taskkill tree command shape", async () => {
    const child = new FakeChild(104);
    const killer = new FakeChild(105);
    const spawnTaskkill = vi.fn((_args: readonly string[], _options: Record<string, unknown>) => killer);
    const taskkill = terminateManagedAgentLiveProcessTree(child, { platform: "win32", spawnTaskkill });
    const options = spawnTaskkill.mock.calls[0]?.[1];
    expect(spawnTaskkill.mock.calls[0]?.[0]).toEqual(["/PID", "104", "/T", "/F"]);
    expect(options).toMatchObject({ shell: false, windowsHide: true, stdio: "ignore" });
    killer.close(0, null);
    await taskkill;
  });

  it("signals a POSIX process group and escalates after grace", async () => {
    const child = new FakeChild(106);
    const signals: Array<[number, NodeJS.Signals]> = [];
    await terminateManagedAgentLiveProcessTree(child, {
      platform: "linux",
      graceMs: 1,
      signalProcessGroup: (pid, signal) => signals.push([pid, signal]),
      sleep: async () => undefined,
    });
    expect(signals).toEqual([[-106, "SIGTERM"], [-106, "SIGKILL"]]);
  });
});

class FakeStream extends EventEmitter {
  setEncoding(_encoding: BufferEncoding): void { /* test seam */ }
}

class FakeChild extends EventEmitter {
  readonly stdoutStream = new FakeStream();
  readonly stderrStream = new FakeStream();
  readonly stdout = this.stdoutStream;
  readonly stderr = this.stderrStream;
  readonly killed: NodeJS.Signals[] = [];

  constructor(readonly pid: number) { super(); }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed.push(signal);
    return true;
  }

  close(exitCode: number | null, signal: string | null): void {
    this.emit("close", exitCode, signal);
  }
}

function baseOptions(
  fixture: Fixture,
  overrides: Partial<ManagedAgentLiveRunnerOptions> = {},
): ManagedAgentLiveRunnerOptions {
  return {
    repositoryRoot,
    manifest: readManifest(),
    projectBinding: fixture.binding,
    candidateMetadata: { commit, dirty: false },
    environmentMetadata: { platform: "win32", arch: "x64", bun: "1.4.0", node: "22.14.0" },
    ...overrides,
  };
}

function openCodeEnvironment(): NodeJS.ProcessEnv {
  return {
    KILN_LIVE_MANAGED_AGENT_TESTS: "1",
    [KILN_LIVE_OPENCODE_TESTS_ENV]: "1",
    [KILN_LIVE_OPENCODE_MODEL]: "opencode/minimax-m2.7-free",
  };
}

function readManifest(): SourceStabilityRecoveryManifest {
  const value: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const parsed = parseSourceStabilityRecoveryManifest(value);
  if (parsed.status === "invalid") throw new Error("canonical source-stability manifest is invalid");
  return parsed.value;
}

function successVitest(manifest: SourceStabilityRecoveryManifest, environment: NodeJS.ProcessEnv): { testResults: readonly unknown[] } {
  const selected = new Set(Object.entries(environment).filter(([, value]) => value === "1").map(([key]) => key));
  const testResults = manifest.liveProofs
    .filter((proof): proof is Extract<SourceStabilityRecoveryManifest["liveProofs"][number], { kind: "implemented" }> =>
      proof.kind === "implemented" && proof.authorityFlags.every((flag) => selected.has(flag)))
    .map((proof) => ({
      name: proof.locator.path,
      assertionResults: [{ title: proof.locator.title, fullName: proof.locator.title, status: "passed" }],
    }));
  return { testResults };
}

interface Fixture {
  readonly root: string;
  readonly privateStateRoot: string;
  readonly binding: NonNullable<ManagedAgentLiveRunnerOptions["projectBinding"]>;
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "kiln-live-runner-"));
  fixtures.push(root);
  const privateStateRoot = join(root, "kiln-home", "projects", "krp_test");
  const evidencePath = join(privateStateRoot, "evidence");
  return {
    root,
    privateStateRoot,
    binding: {
      canonicalRoot: repositoryRoot,
      kilnHome: join(root, "kiln-home"),
      projectRuntimeId: "krp_test",
      projectStateRoot: privateStateRoot,
      adoptionManifestPath: join(privateStateRoot, "adoption.json"),
      configPath: join(privateStateRoot, "config.yaml"),
      contextPath: join(privateStateRoot, "context"),
      agentsPath: join(privateStateRoot, "agents"),
      instructionsPath: join(privateStateRoot, "instructions"),
      skillsPath: join(privateStateRoot, "skills"),
      runtimePath: join(privateStateRoot, "runtime"),
      sessionsPath: join(privateStateRoot, "sessions"),
      cachePath: join(privateStateRoot, "cache"),
      backupsPath: join(privateStateRoot, "backups"),
      mutationsPath: join(privateStateRoot, "mutations"),
      projectionsPath: join(privateStateRoot, "projections"),
      domainsPath: join(privateStateRoot, "domains"),
      evidencePath,
      memoryPath: join(privateStateRoot, "memory"),
      feedbackPath: join(privateStateRoot, "feedback"),
      benchmarksPath: join(privateStateRoot, "benchmarks"),
      tmpPath: join(privateStateRoot, "tmp"),
    },
  };
}

function latestPath(fixture: Fixture): string {
  return join(fixture.binding.evidencePath, "source-stability-recovery", "latest.json");
}

function readLatest(fixture: Fixture): Record<string, unknown> {
  return JSON.parse(readFileSync(latestPath(fixture), "utf8")) as Record<string, unknown>;
}
