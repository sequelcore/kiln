import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  BenchmarkWriteWorkspaceChanges,
  BenchmarkWriteWorkspaceLease,
} from "./benchmark-write-workspace.js";

export const BACKEND_VERIFIER_ID = "kiln.backend-write.order-reservation";
export const BACKEND_VERIFIER_VERSION = "1";
export const BACKEND_VERIFIER_IMAGE = "node:24.15.0-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f";
export const BACKEND_VERIFIER_ALLOWED_CHANGED_PATHS = ["src/order-service.mjs"] as const;
const VERIFIER_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1_048_576;

const HIDDEN_TEST_SOURCE = String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { reserveStock } from "/workspace/src/order-service.mjs";

test("reserves a positive integer quantity", () => {
  const state = { stock: { kiln: 5 }, reservations: {} };
  const result = reserveStock(state, "kiln", 2, "req-1");
  assert.deepEqual(result, { sku: "kiln", quantity: 2, remaining: 3, requestId: "req-1" });
  assert.equal(state.stock.kiln, 3);
});

test("rejects invalid quantities without mutation", () => {
  for (const quantity of [0, -1, 1.5, Number.NaN]) {
    const state = { stock: { kiln: 5 }, reservations: {} };
    assert.throws(() => reserveStock(state, "kiln", quantity, "req-invalid"), /positive integer/i);
    assert.equal(state.stock.kiln, 5);
    assert.deepEqual(state.reservations, {});
  }
});

test("rejects unknown and insufficient stock without mutation", () => {
  const unknown = { stock: { kiln: 5 }, reservations: {} };
  assert.throws(() => reserveStock(unknown, "missing", 1, "req-missing"), /unknown sku/i);
  assert.deepEqual(unknown, { stock: { kiln: 5 }, reservations: {} });
  const insufficient = { stock: { kiln: 1 }, reservations: {} };
  assert.throws(() => reserveStock(insufficient, "kiln", 2, "req-large"), /insufficient stock/i);
  assert.deepEqual(insufficient, { stock: { kiln: 1 }, reservations: {} });
});

test("replays the same request idempotently", () => {
  const state = { stock: { kiln: 5 }, reservations: {} };
  const first = reserveStock(state, "kiln", 2, "req-repeat");
  const second = reserveStock(state, "kiln", 2, "req-repeat");
  assert.deepEqual(second, first);
  assert.equal(state.stock.kiln, 3);
  assert.equal(Object.keys(state.reservations).length, 1);
});
`;

export const BACKEND_VERIFIER_TEST_DIGEST = `sha256:${createHash("sha256").update(HIDDEN_TEST_SOURCE).digest("hex")}`;

export interface BackendVerifierProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface BackendVerifierRunner {
  run(containerName: string, args: readonly string[]): Promise<BackendVerifierProcessResult>;
  cleanup(containerName: string): Promise<void>;
}

export interface BackendBenchmarkVerification {
  readonly verifierId: typeof BACKEND_VERIFIER_ID;
  readonly verifierVersion: typeof BACKEND_VERIFIER_VERSION;
  readonly status: "passed" | "failed";
  readonly testDigest: string;
  readonly runner: {
    readonly kind: "docker";
    readonly image: typeof BACKEND_VERIFIER_IMAGE;
    readonly network: "none";
    readonly rootFilesystem: "read-only";
  };
  readonly changes: BenchmarkWriteWorkspaceChanges;
  readonly violations: readonly string[];
  readonly tests: {
    readonly exitCode: number;
    readonly passed: number;
    readonly failed: number;
    readonly timedOut: boolean;
    readonly output: string;
  };
}

export async function verifyBackendBenchmarkLease(input: {
  readonly lease: BenchmarkWriteWorkspaceLease;
  readonly runner?: BackendVerifierRunner;
}): Promise<BackendBenchmarkVerification> {
  const changes = input.lease.collectChanges();
  const violations = validateAllowedChanges(changes);
  if (violations.length > 0) {
    return failedScopeVerification(changes, violations);
  }
  const verifierRoot = await mkdtemp(join(tmpdir(), "kiln-backend-verifier-"));
  const testPath = join(verifierRoot, "hidden.test.mjs");
  const containerName = `kiln-backend-verifier-${randomUUID()}`;
  const runner = input.runner ?? DOCKER_RUNNER;
  try {
    await writeFile(testPath, HIDDEN_TEST_SOURCE, "utf8");
    const result = await runner.run(containerName, buildBackendVerifierDockerArgs(containerName, input.lease.rootPath, verifierRoot));
    const counts = parseTapCounts(result.stdout);
    const status = !result.timedOut && result.exitCode === 0 && counts.passed === 4 && counts.failed === 0
      ? "passed"
      : "failed";
    return {
      verifierId: BACKEND_VERIFIER_ID,
      verifierVersion: BACKEND_VERIFIER_VERSION,
      status,
      testDigest: BACKEND_VERIFIER_TEST_DIGEST,
      runner: {
        kind: "docker",
        image: BACKEND_VERIFIER_IMAGE,
        network: "none",
        rootFilesystem: "read-only",
      },
      changes,
      violations: [],
      tests: {
        exitCode: result.exitCode,
        passed: counts.passed,
        failed: counts.failed,
        timedOut: result.timedOut,
        output: clipOutput(`${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`),
      },
    };
  } finally {
    await runner.cleanup(containerName);
    await rm(verifierRoot, { recursive: true, force: true });
  }
}

function validateAllowedChanges(changes: BenchmarkWriteWorkspaceChanges): readonly string[] {
  const allowed = new Set<string>(BACKEND_VERIFIER_ALLOWED_CHANGED_PATHS);
  const paths = [
    ...changes.changed.map((entry) => entry.path),
    ...changes.added.map((entry) => entry.path),
    ...changes.deleted.map((entry) => entry.path),
  ];
  if (paths.length === 0) {
    return ["Backend benchmark verification requires a candidate source change."];
  }
  const disallowed = paths.filter((path) => !allowed.has(path));
  if (disallowed.length > 0) {
    return [`Backend benchmark changed paths outside the admitted scope: ${disallowed.join(", ")}`];
  }
  return [];
}

function failedScopeVerification(
  changes: BenchmarkWriteWorkspaceChanges,
  violations: readonly string[],
): BackendBenchmarkVerification {
  return {
    verifierId: BACKEND_VERIFIER_ID,
    verifierVersion: BACKEND_VERIFIER_VERSION,
    status: "failed",
    testDigest: BACKEND_VERIFIER_TEST_DIGEST,
    runner: {
      kind: "docker",
      image: BACKEND_VERIFIER_IMAGE,
      network: "none",
      rootFilesystem: "read-only",
    },
    changes,
    violations,
    tests: {
      exitCode: -1,
      passed: 0,
      failed: 0,
      timedOut: false,
      output: violations.join("\n"),
    },
  };
}

export function buildBackendVerifierDockerArgs(
  containerName: string,
  workspaceRoot: string,
  verifierRoot: string,
): readonly string[] {
  return [
    "run", "--rm", "--pull", "never", "--name", containerName,
    "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "64",
    "--memory", "256m", "--cpus", "1", "--user", "65532:65532",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
    "--volume", `${workspaceRoot}:/workspace:ro`,
    "--volume", `${verifierRoot}:/verifier:ro`,
    BACKEND_VERIFIER_IMAGE,
    "node", "--permission", "--allow-fs-read=/workspace", "--allow-fs-read=/verifier",
    "/verifier/hidden.test.mjs",
  ];
}

function parseTapCounts(output: string): { readonly passed: number; readonly failed: number } {
  const passed = Number(/^(?:# |ℹ )pass (\d+)$/mu.exec(output)?.[1] ?? 0);
  const failed = Number(/^(?:# |ℹ )fail (\d+)$/mu.exec(output)?.[1] ?? 0);
  return { passed, failed };
}

function clipOutput(output: string): string {
  return Buffer.from(output).subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
}

const DOCKER_RUNNER: BackendVerifierRunner = {
  run: (_containerName, args) => runDocker(args),
  cleanup: async (containerName) => {
    await execDocker(["rm", "--force", containerName], 5_000).catch(() => undefined);
  },
};

async function runDocker(args: readonly string[]): Promise<BackendVerifierProcessResult> {
  try {
    const result = await execDocker(args, VERIFIER_TIMEOUT_MS);
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr, timedOut: false };
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
      timedOut: failure.killed === true,
    };
  }
}

function execDocker(args: readonly string[], timeout: number): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("docker", [...args], {
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
