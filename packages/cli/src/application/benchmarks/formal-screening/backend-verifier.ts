import {
  buildContainerVerifierArgs,
  CONTAINER_VERIFIER_RUNNER,
  NODE_VERIFIER_IMAGE,
  type ContainerVerifierRunner,
} from "../container-verifier-runner.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BenchmarkWriteWorkspaceChanges, BenchmarkWriteWorkspaceLease } from "../../benchmark-write-workspace.js";
import { countBenchmarkHiddenTests } from "../../benchmark-hidden-test-source.js";

export const BACKEND_VERIFIER_ID = "kiln.backend-write.v2";
export const BACKEND_VERIFIER_VERSION = "2";
export const BACKEND_VERIFIER_ALLOWED_CHANGED_PATHS = ["src/solution.mjs"] as const;

const MAX_OUTPUT_BYTES = 1_048_576;

export interface BackendVerifierCasePayload {
  readonly id: string;
  readonly hiddenTestSource: string;
  readonly hiddenTestDigest: string;
  readonly hiddenTestCount: number;
}

export interface BackendBenchmarkVerification {
  readonly verifierId: typeof BACKEND_VERIFIER_ID;
  readonly verifierVersion: typeof BACKEND_VERIFIER_VERSION;
  readonly benchmarkCaseId: string;
  readonly status: "passed" | "failed";
  readonly infrastructureFailure: boolean;
  readonly testDigest: string;
  readonly runner: {
    readonly kind: "docker";
    readonly image: typeof NODE_VERIFIER_IMAGE;
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
  readonly benchmarkCase: BackendVerifierCasePayload;
  readonly allowedChangedPaths?: readonly string[];
  readonly runner?: ContainerVerifierRunner;
}): Promise<BackendBenchmarkVerification> {
  const benchmarkCase = input.benchmarkCase;
  const changes = input.lease.collectChanges();
  const caseViolations = validateBackendVerifierCasePayload(benchmarkCase);
  const changeViolations = validateAllowedChanges(
    changes,
    input.allowedChangedPaths ?? BACKEND_VERIFIER_ALLOWED_CHANGED_PATHS,
  );
  const violations = [...caseViolations, ...changeViolations];
  if (violations.length > 0) {
    return failedScopeVerification(changes, violations, benchmarkCase, caseViolations.length > 0);
  }
  const verifierRoot = await mkdtemp(join(tmpdir(), "kiln-backend-verifier-"));
  const testPath = join(verifierRoot, "hidden.test.mjs");
  const containerName = `kiln-backend-verifier-${randomUUID()}`;
  const runner = input.runner ?? CONTAINER_VERIFIER_RUNNER;
  try {
    await writeFile(testPath, benchmarkCase.hiddenTestSource, "utf8");
    const result = await runner.run(
      containerName,
      buildBackendVerifierDockerArgs(containerName, input.lease.rootPath, verifierRoot),
    );
    const counts = parseTapCounts(result.stdout);
    const status =
      !result.infrastructureFailure &&
      !result.timedOut &&
      result.exitCode === 0 &&
      counts.passed === benchmarkCase.hiddenTestCount &&
      counts.failed === 0
        ? "passed"
        : "failed";
    return {
      verifierId: BACKEND_VERIFIER_ID,
      verifierVersion: BACKEND_VERIFIER_VERSION,
      benchmarkCaseId: benchmarkCase.id,
      status,
      infrastructureFailure: result.infrastructureFailure,
      testDigest: benchmarkCase.hiddenTestDigest,
      runner: {
        kind: "docker",
        image: NODE_VERIFIER_IMAGE,
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

function validateAllowedChanges(
  changes: BenchmarkWriteWorkspaceChanges,
  allowedChangedPaths: readonly string[],
): readonly string[] {
  const allowed = new Set<string>(allowedChangedPaths);
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

function validateBackendVerifierCasePayload(casePayload: BackendVerifierCasePayload): readonly string[] {
  const violations: string[] = [];
  if (typeof casePayload?.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(casePayload.id)) {
    violations.push("Backend benchmark case id must be a non-empty portable synthetic identifier.");
  }
  if (typeof casePayload?.hiddenTestSource !== "string" || casePayload.hiddenTestSource.trim().length === 0) {
    violations.push("Backend benchmark hidden test source must be non-empty.");
  }
  if (
    typeof casePayload?.hiddenTestDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(casePayload.hiddenTestDigest)
  ) {
    violations.push("Backend benchmark hidden test digest must be a sha256 digest.");
  } else if (typeof casePayload.hiddenTestSource === "string") {
    const actualDigest = `sha256:${createHash("sha256").update(casePayload.hiddenTestSource, "utf8").digest("hex")}`;
    if (actualDigest !== casePayload.hiddenTestDigest) {
      violations.push("Backend benchmark hidden test digest does not match its source.");
    }
  }
  if (
    typeof casePayload?.hiddenTestCount !== "number" ||
    !Number.isSafeInteger(casePayload.hiddenTestCount) ||
    casePayload.hiddenTestCount <= 0
  ) {
    violations.push("Backend benchmark hidden test count must be a positive integer.");
  } else if (typeof casePayload.hiddenTestSource === "string") {
    const actualCount = countBenchmarkHiddenTests(casePayload.hiddenTestSource);
    if (actualCount !== casePayload.hiddenTestCount) {
      violations.push("Backend benchmark hidden test count does not match its source.");
    }
  }
  return violations;
}

function failedScopeVerification(
  changes: BenchmarkWriteWorkspaceChanges,
  violations: readonly string[],
  benchmarkCase: BackendVerifierCasePayload,
  infrastructureFailure: boolean,
): BackendBenchmarkVerification {
  const benchmarkCaseId = typeof benchmarkCase?.id === "string" ? benchmarkCase.id : "invalid-case";
  const testDigest =
    typeof benchmarkCase?.hiddenTestDigest === "string" ? benchmarkCase.hiddenTestDigest : "sha256:" + "0".repeat(64);
  return {
    verifierId: BACKEND_VERIFIER_ID,
    verifierVersion: BACKEND_VERIFIER_VERSION,
    benchmarkCaseId,
    status: "failed",
    infrastructureFailure,
    testDigest,
    runner: {
      kind: "docker",
      image: NODE_VERIFIER_IMAGE,
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
  return buildContainerVerifierArgs({
    name: containerName,
    image: NODE_VERIFIER_IMAGE,
    mounts: [
      { source: workspaceRoot, target: "/workspace" },
      { source: verifierRoot, target: "/verifier" },
    ],
    command: [
      "node",
      "--permission",
      "--allow-fs-read=/workspace",
      "--allow-fs-read=/verifier",
      "/verifier/hidden.test.mjs",
    ],
  });
}

function parseTapCounts(output: string): { readonly passed: number; readonly failed: number } {
  const passed = Number(/^(?:# |ℹ )pass (\d+)$/mu.exec(output)?.[1] ?? 0);
  const failed = Number(/^(?:# |ℹ )fail (\d+)$/mu.exec(output)?.[1] ?? 0);
  return { passed, failed };
}

function clipOutput(output: string): string {
  return Buffer.from(output).subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
}
