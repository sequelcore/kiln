import { spawn } from "node:child_process";

import type {
  BenchmarkWriteWorkspaceChanges,
  BenchmarkWriteWorkspaceLease,
} from "./benchmark-write-workspace.js";

export const CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_FIXTURE =
  "packages/core/evals/fixtures/context-efficiency-post-fix-v1/bounded-implementation";
export const CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_VERIFIER_ID =
  "kiln.context-efficiency.bounded-implementation.v1";
export const CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_VERIFIER_VERSION = "1";
export const CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_ALLOWED_CHANGED_PATHS = ["src/normalize.ts"] as const;
const VERIFICATION_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1_048_576;

export interface ContextEfficiencyBoundedImplementationVerification {
  readonly verifierId: typeof CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_VERIFIER_ID;
  readonly verifierVersion: typeof CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_VERIFIER_VERSION;
  readonly status: "passed" | "failed";
  readonly changes: BenchmarkWriteWorkspaceChanges;
  readonly violations: readonly string[];
  readonly tests: {
    readonly exitCode: number | null;
    readonly failed: number;
    readonly timedOut: boolean;
  };
}

/** True only for the preregistered post-fix fixture; other coding fixtures retain their owners. */
export function isContextEfficiencyBoundedImplementationFixture(workspaceFixture: unknown): boolean {
  return workspaceFixture === CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_FIXTURE;
}

/**
 * Runs the fixture's committed `bun run test` command in its disposable lease
 * and captures the lease diff before the caller cleans that lease up.
 */
export async function verifyContextEfficiencyBoundedImplementationLease(input: {
  readonly lease: BenchmarkWriteWorkspaceLease;
}): Promise<ContextEfficiencyBoundedImplementationVerification> {
  const changes = input.lease.collectChanges();
  const result = await runFixtureTests(input.lease.rootPath);
  const violations = validateAllowedChanges(changes);
  const failed = result.failed ?? (result.exitCode === 0 && !result.timedOut ? 0 : 1);
  const status = result.exitCode === 0 && !result.timedOut && failed === 0 && violations.length === 0
    ? "passed"
    : "failed";

  return {
    verifierId: CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_VERIFIER_ID,
    verifierVersion: CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_VERIFIER_VERSION,
    status,
    changes,
    violations,
    tests: { exitCode: result.exitCode, failed, timedOut: result.timedOut },
  };
}

function validateAllowedChanges(changes: BenchmarkWriteWorkspaceChanges): readonly string[] {
  const paths = [
    ...changes.changed.map((entry) => entry.path),
    ...changes.added.map((entry) => entry.path),
    ...changes.deleted.map((entry) => entry.path),
  ];
  if (paths.length === 0) return ["Bounded implementation verification requires a candidate source change."];
  const allowed = new Set<string>(CONTEXT_EFFICIENCY_BOUNDED_IMPLEMENTATION_ALLOWED_CHANGED_PATHS);
  const disallowed = paths.filter((path) => !allowed.has(path));
  return disallowed.length === 0
    ? []
    : [`Bounded implementation changed paths outside the admitted scope: ${disallowed.join(", ")}`];
}

interface FixtureTestResult {
  readonly exitCode: number | null;
  readonly failed?: number;
  readonly timedOut: boolean;
}

function runFixtureTests(cwd: string): Promise<FixtureTestResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("bun", ["run", "test"], {
        cwd,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve({ exitCode: null, timedOut: false });
      return;
    }
    if (child.stdout === null || child.stderr === null) {
      child.kill();
      resolve({ exitCode: null, timedOut: false });
      return;
    }

    let output = "";
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode, timedOut, ...(parseFailedTestCount(output) === undefined
        ? {}
        : { failed: parseFailedTestCount(output) }) });
    };
    const append = (chunk: Buffer): void => {
      if (settled || Buffer.byteLength(output) >= MAX_OUTPUT_BYTES) return;
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", () => finish(null));
    child.once("close", (exitCode) => finish(exitCode));
    const timeout = setTimeout(() => {
      timedOut = true;
      if (process.platform !== "win32" && child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      } else {
        child.kill("SIGTERM");
      }
    }, VERIFICATION_TIMEOUT_MS);
  });
}

function parseFailedTestCount(output: string): number | undefined {
  const match = /(?:^|\n)\s*(\d+)\s+fail(?:\s|$)/mu.exec(output);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
