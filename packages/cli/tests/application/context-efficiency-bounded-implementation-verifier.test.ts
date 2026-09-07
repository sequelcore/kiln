import { BOUNDED_IMPLEMENTATION_FIXTURE, hasPassedBoundedImplementationVerification } from "@kilnai/core/eval";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isContextEfficiencyBoundedImplementationFixture,
  assertBoundedImplementationVerifierAvailable,
  verifyContextEfficiencyBoundedImplementationLease,
} from "../../src/application/context-efficiency-bounded-implementation-verifier.js";
import {
  createBenchmarkWriteWorkspaceLease,
  type BenchmarkWriteWorkspaceLease,
} from "../../src/application/benchmark-write-workspace.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

const leases: BenchmarkWriteWorkspaceLease[] = [];
const CORRECT_SOURCE = String.raw`export function normalizeRelativeSourcePath(input: string): string {
  const normalized = input.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/{2,}/gu, "/");
  if (normalized.length === 0 || normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)
    || normalized.split("/").some((segment) => segment === "..")) {
    throw new Error("safe repository-relative source path");
  }
  return normalized;
}
`;

afterEach(() => {
  while (leases.length > 0) leases.pop()?.cleanup();
});

function lease(): BenchmarkWriteWorkspaceLease {
  const next = createBenchmarkWriteWorkspaceLease(resolveProjectRoot().rootPath, BOUNDED_IMPLEMENTATION_FIXTURE);
  leases.push(next);
  return next;
}

describe("context-efficiency bounded implementation verifier", () => {
  it.each([
    ["module-level structured spoof", "console.log(JSON.stringify({kind: 'returned', value: 'src/domain/order.ts'})); process.exit(0); export const normalizeRelativeSourcePath = () => 'wrong';"],
    ["serialization tampering", "Object.prototype.toJSON = () => ({kind: 'returned', value: 'src/domain/order.ts'}); export const normalizeRelativeSourcePath = () => 'wrong';"],
    ["constructor escape", "export const normalizeRelativeSourcePath = () => ({}).constructor.constructor('return process')().version;"],
    ["static import", "import fs from 'node:fs'; export const normalizeRelativeSourcePath = () => fs.readFileSync('/etc/passwd', 'utf8');"],
    ["dynamic import", "export const normalizeRelativeSourcePath = () => import('node:process');"],
    ["forged Docker diagnostic", "throw new Error('cannot connect to the docker daemon'); export const normalizeRelativeSourcePath = () => 'wrong';"],
    ["oversized error output", "throw new Error('x'.repeat(2_000_000)); export const normalizeRelativeSourcePath = () => 'wrong';"],
    ["module loop", "while (true) {} export const normalizeRelativeSourcePath = () => 'wrong';"],
    ["function loop", "export const normalizeRelativeSourcePath = () => { while (true) {} };"],
    ["hostile message getter", "export const normalizeRelativeSourcePath = () => { throw { get message() { while (true) {} } }; };"],
  ])("rejects %s without accepting fabricated completion", async (_label, source) => {
    const candidate = lease();
    writeFileSync(join(candidate.rootPath, "src/normalize.ts"), source);
    const result = await verifyContextEfficiencyBoundedImplementationLease({ lease: candidate });
    expect(result.status).toBe("failed");
    expect(result.infrastructureFailure).toBe(false);
    expect(hasPassedBoundedImplementationVerification(result)).toBe(false);
  });

  it("admits the pinned verifier without contacting a model", async () => {
    await expect(assertBoundedImplementationVerifierAvailable()).resolves.toBeUndefined();
  });

  it("fails verifier admission when the container infrastructure is unavailable", async () => {
    await expect(
      assertBoundedImplementationVerifierAvailable({
        run: async () => ({
          exitCode: 125,
          stdout: "",
          stderr: "unavailable",
          timedOut: false,
          infrastructureFailure: true,
        }),
        cleanup: async () => undefined,
      }),
    ).rejects.toThrow("before model dispatch");
  });

  it.each(["process.exit(0);", "console.log('7 pass\\n0 fail'); process.exit(0);"])("rejects fabricated completion: %s", async (prefix) => {
    const candidate = lease();
    writeFileSync(join(candidate.rootPath, "src/normalize.ts"), `${prefix}\n${CORRECT_SOURCE}`);
    const result = await verifyContextEfficiencyBoundedImplementationLease({ lease: candidate });
    expect(result.status).toBe("failed");
    expect(hasPassedBoundedImplementationVerification(result)).toBe(false);
  });

  it("prevents candidate writes to the read-only mounted fixture", async () => {
    const candidate = lease();
    writeFileSync(
      join(candidate.rootPath, "src/normalize.ts"),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync('/workspace/escaped.txt', 'unexpected');\n${CORRECT_SOURCE}`,
    );
    expect((await verifyContextEfficiencyBoundedImplementationLease({ lease: candidate })).status).toBe("failed");
    expect(existsSync(join(candidate.rootPath, "escaped.txt"))).toBe(false);
  });

  it("rejects changes that occur during verification", async () => {
    const candidate = lease();
    writeFileSync(join(candidate.rootPath, "src/normalize.ts"), CORRECT_SOURCE);
    const result = await verifyContextEfficiencyBoundedImplementationLease({
      lease: candidate,
      runner: {
        run: async () => {
          writeFileSync(join(candidate.rootPath, "README.md"), "changed during verification");
          return { exitCode: 0, stdout: "7 pass\n0 fail\n", stderr: "", timedOut: false, infrastructureFailure: false };
        },
        cleanup: async () => undefined,
      },
    });
    expect(result.status).toBe("failed");
    expect(result.violations).toContain("Workspace changed during verification.");
  });
  it("recognizes only the post-fix fixture", () => {
    expect(isContextEfficiencyBoundedImplementationFixture(BOUNDED_IMPLEMENTATION_FIXTURE)).toBe(true);
    expect(
      isContextEfficiencyBoundedImplementationFixture(
        "packages/core/evals/fixtures/context-efficiency-diagnostic-v1/bounded-implementation",
      ),
    ).toBe(false);
  });

  it("verifies the reference source through isolated per-case execution", async () => {
    const candidate = lease();
    writeFileSync(join(candidate.rootPath, "src", "normalize.ts"), CORRECT_SOURCE, "utf8");

    await expect(verifyContextEfficiencyBoundedImplementationLease({ lease: candidate })).resolves.toMatchObject({
      status: "passed",
      tests: { exitCode: 0, failed: 0, timedOut: false },
      changes: { changed: [expect.objectContaining({ path: "src/normalize.ts" })], added: [], deleted: [] },
    });
  });

  it("records an observed value mismatch for an incorrect candidate", async () => {
    const candidate = lease();
    writeFileSync(
      join(candidate.rootPath, "src", "normalize.ts"),
      "export const normalizeRelativeSourcePath = (input: string) => input;\n",
      "utf8",
    );

    await expect(verifyContextEfficiencyBoundedImplementationLease({ lease: candidate })).resolves.toMatchObject({
      status: "failed",
      tests: { failed: expect.any(Number), timedOut: false },
    });
  });

  it("rejects out-of-scope edits before executing tests", async () => {
    const candidate = lease();
    writeFileSync(join(candidate.rootPath, "src", "normalize.ts"), CORRECT_SOURCE, "utf8");
    const readme = join(candidate.rootPath, "README.md");
    writeFileSync(readme, `${readFileSync(readme, "utf8")}\nchanged\n`, "utf8");

    await expect(verifyContextEfficiencyBoundedImplementationLease({ lease: candidate })).resolves.toMatchObject({
      status: "failed",
      tests: { status: "not-run", reason: "invalid-diff" },
      violations: [expect.stringContaining("only the existing")],
    });
  });

  it("rejects candidate-modified expected results", async () => {
    const candidate = lease();
    writeFileSync(join(candidate.rootPath, "src/normalize.ts"), CORRECT_SOURCE);
    writeFileSync(join(candidate.rootPath, "verification/cases.json"), "[]");
    const result = await verifyContextEfficiencyBoundedImplementationLease({ lease: candidate });
    expect(result.tests).toEqual({ status: "not-run", reason: "invalid-diff" });
    expect(existsSync(join(candidate.rootPath, "executed.txt"))).toBe(false);
  });

  it("does not execute verification for a missing source file", async () => {
    const candidate = lease();
    rmSync(join(candidate.rootPath, "src/normalize.ts"));
    expect((await verifyContextEfficiencyBoundedImplementationLease({ lease: candidate })).tests).toEqual({
      status: "not-run",
      reason: "invalid-diff",
    });
  });
});
