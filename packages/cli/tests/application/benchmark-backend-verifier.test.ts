import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  BACKEND_VERIFIER_IMAGE,
  verifyBackendBenchmarkLease,
  type BackendVerifierRunner,
} from "../../src/application/benchmarks/formal-screening/backend-verifier.js";
import { BACKEND_BENCHMARK_CASES } from "../../src/application/benchmark-backend-cases.js";
import { createBenchmarkWriteWorkspaceLease } from "../../src/application/benchmark-write-workspace.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

const FIXTURE = "packages/core/evals/fixtures/model-roster-backend-write-v2/idempotent-reservation";
const CASE_ID = "idempotent-reservation";
const CASE_PAYLOAD = {
  id: CASE_ID,
  hiddenTestSource: BACKEND_BENCHMARK_CASES[CASE_ID].hiddenTestSource,
  hiddenTestDigest: BACKEND_BENCHMARK_CASES[CASE_ID].testDigest,
  hiddenTestCount: BACKEND_BENCHMARK_CASES[CASE_ID].testCount,
} as const;
const LEGACY_ALLOWED_CHANGED_PATHS = ["src/solution.mjs"] as const;

describe("verifyBackendBenchmarkLease", () => {
  it("runs the fixed hidden tests in a locked-down pinned container", async () => {
    const lease = createBenchmarkWriteWorkspaceLease(resolveProjectRoot().rootPath, FIXTURE);
    writeFileSync(`${lease.rootPath}/src/solution.mjs`, "export const fixed = true;\n", "utf8");
    const runner = passingRunner();

    try {
      const result = await verifyBackendBenchmarkLease({
        lease,
        runner,
        benchmarkCase: CASE_PAYLOAD,
        allowedChangedPaths: LEGACY_ALLOWED_CHANGED_PATHS,
      });

      expect(result).toMatchObject({
        status: "passed",
        infrastructureFailure: false,
        benchmarkCaseId: CASE_ID,
        testDigest: BACKEND_BENCHMARK_CASES[CASE_ID].testDigest,
        runner: {
          kind: "docker",
          image: BACKEND_VERIFIER_IMAGE,
          network: "none",
          rootFilesystem: "read-only",
        },
        changes: {
          changed: [expect.objectContaining({ path: "src/solution.mjs" })],
          added: [],
          deleted: [],
        },
        tests: { passed: 4, failed: 0, timedOut: false },
      });
      const args = vi.mocked(runner.run).mock.calls[0]?.[1] ?? [];
      expect(args).toContain("--network");
      expect(args).toContain("none");
      expect(args).toContain("--read-only");
      expect(args).toContain("no-new-privileges");
      expect(args).toContain(BACKEND_VERIFIER_IMAGE);
      expect(args.some((arg) => arg.endsWith(":/workspace:ro"))).toBe(true);
      expect(args).not.toContain("--allow-child-process");
      expect(args).not.toContain("--allow-net");
    } finally {
      lease.cleanup();
    }
  });

  it("rejects out-of-scope changes before starting Docker", async () => {
    const lease = createBenchmarkWriteWorkspaceLease(resolveProjectRoot().rootPath, FIXTURE);
    writeFileSync(`${lease.rootPath}/README.md`, "tampered verifier contract\n", "utf8");
    const runner = passingRunner();

    try {
      await expect(verifyBackendBenchmarkLease({
        lease,
        runner,
        benchmarkCase: CASE_PAYLOAD,
        allowedChangedPaths: LEGACY_ALLOWED_CHANGED_PATHS,
      })).resolves.toMatchObject({
        status: "failed",
        violations: [expect.stringContaining("outside the admitted scope: README.md")],
      });
      expect(runner.run).not.toHaveBeenCalled();
    } finally {
      lease.cleanup();
    }
  });

  it("fails closed on timeout or incomplete TAP evidence", async () => {
    const lease = createBenchmarkWriteWorkspaceLease(resolveProjectRoot().rootPath, FIXTURE);
    writeFileSync(`${lease.rootPath}/src/solution.mjs`, "export const fixed = true;\n", "utf8");
    const runner: BackendVerifierRunner = {
      run: vi.fn(async () => ({
        exitCode: 1,
        stdout: "TAP version 13\n# pass 3\n# fail 1\n",
        stderr: "",
        timedOut: true,
        infrastructureFailure: false,
      })),
      cleanup: vi.fn(async () => undefined),
    };

    try {
      await expect(verifyBackendBenchmarkLease({
        lease,
        runner,
        benchmarkCase: CASE_PAYLOAD,
        allowedChangedPaths: LEGACY_ALLOWED_CHANGED_PATHS,
      })).resolves.toMatchObject({
        status: "failed",
        tests: { passed: 3, failed: 1, timedOut: true },
      });
    } finally {
      lease.cleanup();
    }
  });

  it("reports an unavailable container runtime as infrastructure failure", async () => {
    const lease = createBenchmarkWriteWorkspaceLease(resolveProjectRoot().rootPath, FIXTURE);
    writeFileSync(`${lease.rootPath}/src/solution.mjs`, "export const fixed = true;\n", "utf8");
    const runner: BackendVerifierRunner = {
      run: vi.fn(async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "failed to connect to the docker API",
        timedOut: false,
        infrastructureFailure: true,
      })),
      cleanup: vi.fn(async () => undefined),
    };

    try {
      await expect(verifyBackendBenchmarkLease({
        lease,
        runner,
        benchmarkCase: CASE_PAYLOAD,
        allowedChangedPaths: LEGACY_ALLOWED_CHANGED_PATHS,
      })).resolves.toMatchObject({
        status: "failed",
        infrastructureFailure: true,
        tests: { passed: 0, failed: 0, timedOut: false },
      });
    } finally {
      lease.cleanup();
    }
  });

  it("rejects a hidden-source digest or positive test-count mismatch before Docker", async () => {
    const lease = createBenchmarkWriteWorkspaceLease(resolveProjectRoot().rootPath, FIXTURE);
    writeFileSync(`${lease.rootPath}/src/solution.mjs`, "export const fixed = true;\n", "utf8");
    const runner = passingRunner();

    try {
      const badDigest = { ...CASE_PAYLOAD, hiddenTestDigest: `sha256:${"0".repeat(64)}` };
      await expect(verifyBackendBenchmarkLease({
        lease,
        runner,
        benchmarkCase: badDigest,
        allowedChangedPaths: LEGACY_ALLOWED_CHANGED_PATHS,
      })).resolves.toMatchObject({ status: "failed", tests: { exitCode: -1 } });

      const badCount = { ...CASE_PAYLOAD, hiddenTestCount: CASE_PAYLOAD.hiddenTestCount + 1 };
      await expect(verifyBackendBenchmarkLease({
        lease,
        runner,
        benchmarkCase: badCount,
        allowedChangedPaths: LEGACY_ALLOWED_CHANGED_PATHS,
      })).resolves.toMatchObject({ status: "failed", tests: { exitCode: -1 } });
      expect(runner.run).not.toHaveBeenCalled();
    } finally {
      lease.cleanup();
    }
  });
});

function passingRunner(): BackendVerifierRunner {
  return {
    run: vi.fn(async () => ({
      exitCode: 0,
      stdout: "TAP version 13\n# pass 4\n# fail 0\n",
      stderr: "",
      timedOut: false,
      infrastructureFailure: false,
    })),
    cleanup: vi.fn(async () => undefined),
  };
}
