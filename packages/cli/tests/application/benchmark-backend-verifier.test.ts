import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  BACKEND_VERIFIER_IMAGE,
  BACKEND_VERIFIER_TEST_DIGEST,
  verifyBackendBenchmarkLease,
  type BackendVerifierRunner,
} from "../../src/application/benchmark-backend-verifier.js";
import { createBenchmarkWriteWorkspaceLease } from "../../src/application/benchmark-write-workspace.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

const FIXTURE = "packages/core/evals/fixtures/model-roster-backend-write-v1";

describe("verifyBackendBenchmarkLease", () => {
  it("runs the fixed hidden tests in a locked-down pinned container", async () => {
    const lease = createBenchmarkWriteWorkspaceLease(resolveProjectRoot().rootPath, FIXTURE);
    writeFileSync(`${lease.rootPath}/src/order-service.mjs`, "export const fixed = true;\n", "utf8");
    const runner = passingRunner();

    try {
      const result = await verifyBackendBenchmarkLease({ lease, runner });

      expect(result).toMatchObject({
        status: "passed",
        testDigest: BACKEND_VERIFIER_TEST_DIGEST,
        runner: {
          kind: "docker",
          image: BACKEND_VERIFIER_IMAGE,
          network: "none",
          rootFilesystem: "read-only",
        },
        changes: {
          changed: [expect.objectContaining({ path: "src/order-service.mjs" })],
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
      await expect(verifyBackendBenchmarkLease({ lease, runner })).resolves.toMatchObject({
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
    writeFileSync(`${lease.rootPath}/src/order-service.mjs`, "export const fixed = true;\n", "utf8");
    const runner: BackendVerifierRunner = {
      run: vi.fn(async () => ({ exitCode: 1, stdout: "TAP version 13\n# pass 3\n# fail 1\n", stderr: "", timedOut: true })),
      cleanup: vi.fn(async () => undefined),
    };

    try {
      await expect(verifyBackendBenchmarkLease({ lease, runner })).resolves.toMatchObject({
        status: "failed",
        tests: { passed: 3, failed: 1, timedOut: true },
      });
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
    })),
    cleanup: vi.fn(async () => undefined),
  };
}
