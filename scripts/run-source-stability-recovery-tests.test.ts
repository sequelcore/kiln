import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseSourceStabilityRecoveryManifest,
  type SourceStabilityRecoveryManifest,
} from "./source-stability-recovery-report.js";
import {
  runSourceStabilityRecoveryMain,
  runSourceStabilityRecoveryTests,
  type SourceStabilityRecoveryMainRun,
  type SourceStabilityRecoveryPackageExecution,
  type SourceStabilityRecoveryRunnerOptions,
} from "./run-source-stability-recovery-tests.js";
import type { ManagedAgentLiveChild, ManagedAgentLiveProcessControl } from "./run-managed-agent-live-tests.js";

const repositoryRoot = join(import.meta.dirname, "..");
const manifestPath = join(repositoryRoot, "scripts", "fixtures", "source-stability-recovery.manifest.json");

describe("source-stability deterministic gate", () => {
  it("is import-safe and exposes an injectable runner", () => {
    expect(runSourceStabilityRecoveryTests).toBeTypeOf("function");
    expect(runSourceStabilityRecoveryMain).toBeTypeOf("function");
  });

  it("runs each admitted package once with its package cwd/config and passes every locator", async () => {
    const manifest = readManifest();
    const executions: SourceStabilityRecoveryPackageExecution[] = [];
    const result = await runSourceStabilityRecoveryTests(baseOptions(manifest, {
      executePackage: async (input) => {
        executions.push(input);
        return { stdout: JSON.stringify({ testResults: resultsFor(manifest, input.packageName) }), stderr: "ignored", exitCode: 0 };
      },
    }));

    expect(result).toEqual({ exitCode: 0 });
    expect(executions).toHaveLength(2);
    expect(executions.map((input) => input.packageName)).toEqual(["runtime", "cli"]);
    expect(executions[0]).toMatchObject({
      cwd: join(repositoryRoot, "packages", "runtime"),
      configPath: "vitest.config.ts",
      argv: expect.arrayContaining(["x", "vitest", "run", "--config", "vitest.config.ts", "--reporter=json"]),
    });
    expect(executions[0]?.files).toEqual([
      "tests/session/runtime-configuration-revision-pipeline.test.ts",
      "tests/agent-tasks/agent-task-application.test.ts",
      "tests/managed-agent/external-harness-adapter-claim.test.ts",
      "tests/gateway/ws-response-egress.test.ts",
      "tests/managed-agent/orchestration-lifecycle.test.ts",
      "tests/managed-agent/invocation-service.recovery.test.ts",
      "tests/managed-agent/managed-economic-dispatch-coordinator.test.ts",
    ]);
    expect(executions[0]?.argv.slice(-7)).toEqual(executions[0]?.files);
    expect(executions[1]?.files).toEqual(["tests/application/operator-project-agent-tasks.test.ts"]);
  });

  it("fails closed on an unknown package path without spawning a child", async () => {
    const manifest = withDeterministicPath(readManifest(), "packages/other/tests/unknown.test.ts");
    const executePackage = vi.fn(async () => ({ stdout: "{}", stderr: "", exitCode: 0 }));
    const result = await runSourceStabilityRecoveryTests(baseOptions(manifest, { executePackage }));

    expect(result).toEqual({ exitCode: 1, reason: "unsupported-locator-path" });
    expect(executePackage).not.toHaveBeenCalled();
  });

  it("fails on malformed JSON, child nonzero, and spawn errors", async () => {
    const manifest = readManifest();
    await expectResult(manifest, { stdout: "not-json", stderr: "secret", exitCode: 0 }, "malformed-json");
    await expectResult(manifest, { stdout: JSON.stringify({ testResults: resultsFor(manifest) }), stderr: "secret", exitCode: 7 }, "child-nonzero");
    await expectResult(manifest, { stdout: "", stderr: "secret", error: new Error("secret") }, "spawn-failed");
    await expectResult(manifest, { stdout: "", stderr: "secret", terminationReason: "timeout" }, "child-timeout");
    await expectResult(manifest, { stdout: "", stderr: "secret", terminationReason: "output-limit" }, "output-limit");
  });

  it("logs only a stable reason and never emits raw child output or errors", async () => {
    const manifest = readManifest();
    const log = vi.fn();
    const error = vi.fn();
    await runSourceStabilityRecoveryTests(baseOptions(manifest, {
      logger: { log, error },
      executePackage: async () => ({ stdout: "RAW_STDOUT_SECRET", stderr: "RAW_STDERR_SECRET", error: new Error("RAW_ERROR_SECRET") }),
    }));
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toMatch(/RAW_(?:STDOUT|STDERR|ERROR)_SECRET/u);
    expect(error).toHaveBeenCalledWith("Source-stability deterministic gate failed: spawn-failed.");
  });

  it("uses the bounded tree owner for timeout and preserves a late child error", async () => {
    const manifest = readManifest();
    const child = new FakeChild();
    const terminateTree = vi.fn(async (_target: ManagedAgentLiveChild) => {
      child.emit("error", new Error("late raw child error"));
    });
    const result = await runSourceStabilityRecoveryTests(baseOptions(manifest, {
      deadlineMs: 1,
      terminationCloseMs: 5,
      spawnPackage: () => child,
      processControl: { platform: "linux", terminateTree },
    }));

    expect(result).toEqual({ exitCode: 1, reason: "child-timeout" });
    expect(terminateTree).toHaveBeenCalledOnce();
  });

  it("uses the bounded tree owner for output overflow and settles without close", async () => {
    const manifest = readManifest();
    const child = new FakeChild();
    const terminateTree = vi.fn(async () => undefined);
    const resultPromise = runSourceStabilityRecoveryTests(baseOptions(manifest, {
      maxOutputBytes: 4,
      terminationCloseMs: 5,
      spawnPackage: () => {
        queueMicrotask(() => child.stdoutStream.emit("data", "oversized"));
        return child;
      },
      processControl: { platform: "linux", terminateTree },
    }));

    expect(await resultPromise).toEqual({ exitCode: 1, reason: "output-limit" });
    expect(terminateTree).toHaveBeenCalledOnce();
  });

  it("passes interruption to the bounded tree owner and preserves it over late output/errors", async () => {
    const manifest = readManifest();
    const child = new FakeChild();
    const terminateTree = vi.fn(async () => {
      child.stdoutStream.emit("data", "late oversized raw output");
      child.emit("error", new Error("late raw child error"));
    });
    const controller = new AbortController();
    const log = vi.fn();
    const error = vi.fn();
    const resultPromise = runSourceStabilityRecoveryTests(baseOptions(manifest, {
      abortSignal: controller.signal,
      maxOutputBytes: 4,
      terminationCloseMs: 5,
      logger: { log, error },
      spawnPackage: () => child,
      processControl: { platform: "linux", terminateTree },
    }));

    controller.abort();

    expect(await resultPromise).toEqual({ exitCode: 1, reason: "child-interrupted" });
    expect(terminateTree).toHaveBeenCalledOnce();
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toMatch(/late (?:oversized raw output|raw child error)/u);
  });

  it("aborts from the CLI signal owner and removes handlers after settlement", async () => {
    const handlers = new Map<"SIGINT" | "SIGTERM", () => void>();
    const on = vi.fn((event: "SIGINT" | "SIGTERM", handler: () => void): void => {
      handlers.set(event, handler);
    });
    const off = vi.fn((event: "SIGINT" | "SIGTERM", handler: () => void): void => {
      if (handlers.get(event) === handler) handlers.delete(event);
    });
    const setExitCode = vi.fn<(exitCode: 0 | 1) => void>();
    const run: SourceStabilityRecoveryMainRun = async (options) => {
      expect(options.abortSignal?.aborted).toBe(false);
      handlers.get("SIGTERM")?.();
      expect(options.abortSignal?.aborted).toBe(true);
      return { exitCode: 1, reason: "child-interrupted" };
    };

    await runSourceStabilityRecoveryMain(run, { on, off }, setExitCode);

    expect(on).toHaveBeenCalledTimes(2);
    expect(off).toHaveBeenCalledTimes(2);
    expect(handlers).toHaveLength(0);
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it("establishes detached POSIX and Windows-safe child spawn shapes", async () => {
    const manifest = readManifest();
    const linuxCalls: Array<Record<string, unknown>> = [];
    const linuxResult = await runSourceStabilityRecoveryTests(baseOptions(manifest, {
      spawnPackage: (_command, _args, options) => {
        linuxCalls.push(options);
        const child = new FakeChild();
        queueMicrotask(() => {
          child.stdoutStream.emit("data", JSON.stringify({ testResults: resultsFor(manifest, linuxCalls.length === 1 ? "runtime" : "cli") }));
          child.close(0, null);
        });
        return child;
      },
      processControl: { platform: "linux", terminateTree: async () => undefined },
    }));
    expect(linuxResult).toEqual({ exitCode: 0 });
    expect(linuxCalls).toHaveLength(2);
    expect(linuxCalls.every((options) => options.detached === true && options.shell === false)).toBe(true);

    const windowsCalls: Array<Record<string, unknown>> = [];
    const windowsResult = await runSourceStabilityRecoveryTests(baseOptions(manifest, {
      spawnPackage: (_command, _args, options) => {
        windowsCalls.push(options);
        const child = new FakeChild();
        queueMicrotask(() => {
          child.stdoutStream.emit("data", JSON.stringify({ testResults: resultsFor(manifest, windowsCalls.length === 1 ? "runtime" : "cli") }));
          child.close(0, null);
        });
        return child;
      },
      processControl: { platform: "win32", terminateTree: async () => undefined },
    }));
    expect(windowsResult).toEqual({ exitCode: 0 });
    expect(windowsCalls.every((options) => options.detached === undefined && options.windowsHide === true && options.shell === false)).toBe(true);
  });

  it.each([
    ["missing", (manifest: SourceStabilityRecoveryManifest) => resultsFor(manifest).filter((entry) => entry.name !== firstLocator(manifest).path)],
    ["duplicate", (manifest: SourceStabilityRecoveryManifest) => [...resultsFor(manifest), resultsFor(manifest)[0]!]],
    ["skipped", (manifest: SourceStabilityRecoveryManifest) => resultsFor(manifest).map((entry) => ({
      ...entry,
      assertionResults: entry.assertionResults.map((assertion) => ({ ...assertion, status: "skipped" })),
    }))],
    ["failed", (manifest: SourceStabilityRecoveryManifest) => resultsFor(manifest).map((entry) => ({
      ...entry,
      assertionResults: entry.assertionResults.map((assertion) => ({ ...assertion, status: "failed" })),
    }))],
    ["todo", (manifest: SourceStabilityRecoveryManifest) => resultsFor(manifest).map((entry) => ({
      ...entry,
      assertionResults: entry.assertionResults.map((assertion) => ({ ...assertion, status: "todo" })),
    }))],
    ["pending", (manifest: SourceStabilityRecoveryManifest) => resultsFor(manifest).map((entry) => ({
      ...entry,
      assertionResults: entry.assertionResults.map((assertion) => ({ ...assertion, status: "pending" })),
    }))],
  ] as const)("rejects %s locator evidence", async (_name, rawMakeResults) => {
    const manifest = readManifest();
    const makeResults = rawMakeResults as (input: SourceStabilityRecoveryManifest) => readonly unknown[];
    const result = await runSourceStabilityRecoveryTests(baseOptions(manifest, {
      executePackage: async () => ({ stdout: JSON.stringify({ testResults: makeResults(manifest) }), stderr: "", exitCode: 0 }),
    }));

    expect(result.exitCode).toBe(1);
    expect(result.reason).toMatch(/^locator-/u);
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

  kill(_signal?: NodeJS.Signals): boolean { return true; }

  close(exitCode: number | null, signal: string | null): void {
    this.emit("close", exitCode, signal);
  }
}

function baseOptions(
  manifest: SourceStabilityRecoveryManifest,
  overrides: Partial<SourceStabilityRecoveryRunnerOptions> = {},
): SourceStabilityRecoveryRunnerOptions {
  return {
    repositoryRoot,
    manifest,
    ...overrides,
  };
}

function readManifest(): SourceStabilityRecoveryManifest {
  const parsed = parseSourceStabilityRecoveryManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
  if (parsed.status === "invalid") throw new Error("canonical manifest is invalid");
  return parsed.value;
}

function deterministicLocators(manifest: SourceStabilityRecoveryManifest): readonly { path: string; title: string }[] {
  const seen = new Set<string>();
  return manifest.cases.flatMap((entry) => entry.deterministicEvidence).filter((locator) => {
    const key = `${locator.path}\u0000${locator.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface SyntheticVitestResult {
  readonly name: string;
  readonly assertionResults: readonly { readonly title: string; readonly fullName: string; readonly status: string }[];
}

function resultsFor(manifest: SourceStabilityRecoveryManifest, packageName?: "runtime" | "cli"): readonly SyntheticVitestResult[] {
  const byPath = new Map<string, Array<{ title: string; fullName: string; status: string }>>();
  for (const locator of deterministicLocators(manifest)) {
    if (packageName !== undefined && !locator.path.startsWith(`packages/${packageName}/tests/`)) continue;
    const assertions = byPath.get(locator.path) ?? [];
    assertions.push({ title: locator.title, fullName: locator.title, status: "passed" });
    byPath.set(locator.path, assertions);
  }
  return [...byPath].map(([name, assertionResults]) => ({ name, assertionResults }));
}

function firstLocator(manifest: SourceStabilityRecoveryManifest): { path: string; title: string } {
  const locator = deterministicLocators(manifest)[0];
  if (!locator) throw new Error("manifest has no deterministic locator");
  return locator;
}

function withDeterministicPath(manifest: SourceStabilityRecoveryManifest, path: string): SourceStabilityRecoveryManifest {
  return {
    ...manifest,
    cases: manifest.cases.map((entry, index) => index === 0
      ? { ...entry, deterministicEvidence: [{ ...entry.deterministicEvidence[0]!, path }] }
      : entry),
  };
}

async function expectResult(
  manifest: SourceStabilityRecoveryManifest,
  child: { stdout: string; stderr: string; exitCode?: number; error?: unknown; terminationReason?: "timeout" | "output-limit" },
  reason: string,
): Promise<void> {
  const result = await runSourceStabilityRecoveryTests(baseOptions(manifest, { executePackage: async () => child }));
  expect(result).toEqual({ exitCode: 1, reason });
}
