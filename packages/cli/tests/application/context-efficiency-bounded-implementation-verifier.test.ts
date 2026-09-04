import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_FIXTURE,
  isContextEfficiencyBoundedImplementationFixture,
  verifyContextEfficiencyBoundedImplementationLease,
} from "../../src/application/context-efficiency-bounded-implementation-verifier.js";
import { createBenchmarkWriteWorkspaceLease, type BenchmarkWriteWorkspaceLease } from "../../src/application/benchmark-write-workspace.js";
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
  const next = createBenchmarkWriteWorkspaceLease(resolveProjectRoot().rootPath, CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_FIXTURE);
  leases.push(next);
  return next;
}

describe("context-efficiency bounded implementation verifier", () => {
  it("recognizes only the post-fix fixture", () => {
    expect(isContextEfficiencyBoundedImplementationFixture(CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_FIXTURE)).toBe(true);
    expect(isContextEfficiencyBoundedImplementationFixture("packages/core/evals/fixtures/context-efficiency-diagnostic-v1/bounded-implementation")).toBe(false);
  });

  it("runs the fixture's real Bun test command against the reference source", async () => {
    const candidate = lease();
    writeFileSync(join(candidate.rootPath, "src", "normalize.ts"), CORRECT_SOURCE, "utf8");

    await expect(verifyContextEfficiencyBoundedImplementationLease({ lease: candidate })).resolves.toMatchObject({
      status: "passed",
      tests: { exitCode: 0, failed: 0, timedOut: false },
      changes: { changed: [expect.objectContaining({ path: "src/normalize.ts" })], added: [], deleted: [] },
    });
  });

  it("records a real Bun test failure for an incorrect candidate", async () => {
    const candidate = lease();
    writeFileSync(join(candidate.rootPath, "src", "normalize.ts"), "export const normalizeRelativeSourcePath = (input: string) => input;\n", "utf8");

    await expect(verifyContextEfficiencyBoundedImplementationLease({ lease: candidate })).resolves.toMatchObject({
      status: "failed",
      tests: { failed: expect.any(Number), timedOut: false },
    });
  });

  it("fails a passing candidate that edits outside its admitted source path", async () => {
    const candidate = lease();
    writeFileSync(join(candidate.rootPath, "src", "normalize.ts"), CORRECT_SOURCE, "utf8");
    const readme = join(candidate.rootPath, "README.md");
    writeFileSync(readme, `${readFileSync(readme, "utf8")}\nchanged\n`, "utf8");

    await expect(verifyContextEfficiencyBoundedImplementationLease({ lease: candidate })).resolves.toMatchObject({
      status: "failed",
      tests: { exitCode: 0, failed: 0, timedOut: false },
      violations: [expect.stringContaining("README.md")],
    });
  });
});
