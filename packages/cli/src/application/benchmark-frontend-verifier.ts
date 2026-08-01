import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  BenchmarkWriteWorkspaceChanges,
  BenchmarkWriteWorkspaceLease,
} from "./benchmark-write-workspace.js";

export const FRONTEND_VERIFIER_ID = "kiln.frontend-render.order-queue";
export const FRONTEND_VERIFIER_VERSION = "1";
export const FRONTEND_VERIFIER_IMAGE = "kiln/frontend-benchmark-verifier:1";
export const FRONTEND_VERIFIER_IMAGE_ID = "sha256:dbac9bef7a818c11a1c1e0602504481b5692c2a7c635203f6559fb870dd615f4";
export const FRONTEND_VERIFIER_SOURCE_DIGEST = "sha256:79717a4c691b4c926e98c1e0d8ceafe6d578a5ecf5f8ec04362c202ec1db6336";
export const FRONTEND_VERIFIER_ALLOWED_CHANGED_PATHS = ["src/OrderQueue.jsx"] as const;
const FRONTEND_VERIFIER_TIMEOUT_MS = 60_000;
const MAX_PROCESS_OUTPUT_BYTES = 1_048_576;
const MAX_SCREENSHOT_BYTES = 2_097_152;

export interface FrontendVerifierProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface FrontendVerifierImageEvidence {
  readonly imageId: string;
  readonly sourceDigest: string;
  readonly version: string;
}

export interface FrontendVerifierRunner {
  inspectImage(): Promise<FrontendVerifierImageEvidence>;
  run(containerName: string, args: readonly string[]): Promise<FrontendVerifierProcessResult>;
  cleanup(containerName: string): Promise<void>;
}

export interface FrontendBenchmarkVerification {
  readonly verifierId: typeof FRONTEND_VERIFIER_ID;
  readonly verifierVersion: typeof FRONTEND_VERIFIER_VERSION;
  readonly status: "passed" | "failed";
  readonly violations: readonly string[];
  readonly changes: BenchmarkWriteWorkspaceChanges;
  readonly runner: {
    readonly kind: "docker-playwright";
    readonly image: typeof FRONTEND_VERIFIER_IMAGE;
    readonly imageId: string;
    readonly sourceDigest: typeof FRONTEND_VERIFIER_SOURCE_DIGEST;
    readonly network: "none";
    readonly rootFilesystem: "read-only";
  };
  readonly render: Record<string, unknown> | undefined;
  readonly screenshot: {
    readonly sha256: string;
    readonly bytes: number;
    readonly base64: string;
  } | undefined;
  readonly process: FrontendVerifierProcessResult;
}

export async function verifyFrontendBenchmarkLease(input: {
  readonly lease: BenchmarkWriteWorkspaceLease;
  readonly runner?: FrontendVerifierRunner;
}): Promise<FrontendBenchmarkVerification> {
  const changes = input.lease.collectChanges();
  const scopeViolations = validateAllowedChanges(changes);
  const runner = input.runner ?? DOCKER_RUNNER;
  const image = await runner.inspectImage();
  assertImageEvidence(image);
  if (scopeViolations.length > 0) {
    return failedVerification(changes, image, scopeViolations);
  }

  const outputRoot = await mkdtemp(join(tmpdir(), "kiln-frontend-verifier-"));
  const containerName = `kiln-frontend-verifier-${randomUUID()}`;
  try {
    const processResult = await runner.run(
      containerName,
      buildFrontendVerifierDockerArgs(containerName, input.lease.rootPath, outputRoot),
    );
    const report = await readJsonRecord(join(outputRoot, "report.json"));
    const screenshot = await readScreenshotEvidence(join(outputRoot, "screenshot.png"), report);
    const reportPassed = report?.status === "passed"
      && readRecord(report.accessibility)?.violationCount === 0
      && Object.values(readRecord(report.assertions) ?? {}).every((value) => value === true);
    const violations = [
      ...(processResult.timedOut ? ["Frontend verifier timed out."] : []),
      ...(processResult.exitCode !== 0 ? [`Frontend verifier exited with code ${processResult.exitCode}.`] : []),
      ...(!reportPassed ? ["Rendered interaction or accessibility verification failed."] : []),
      ...(!screenshot ? ["Frontend verifier did not produce a valid screenshot evidence file."] : []),
    ];
    return {
      verifierId: FRONTEND_VERIFIER_ID,
      verifierVersion: FRONTEND_VERIFIER_VERSION,
      status: violations.length === 0 ? "passed" : "failed",
      violations,
      changes,
      runner: runnerEvidence(image),
      render: report,
      screenshot,
      process: processResult,
    };
  } finally {
    await runner.cleanup(containerName);
    await rm(outputRoot, { recursive: true, force: true });
  }
}

export function buildFrontendVerifierDockerArgs(
  containerName: string,
  workspaceRoot: string,
  outputRoot: string,
): readonly string[] {
  return [
    "run", "--rm", "--pull", "never", "--name", containerName,
    "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "256",
    "--memory", "1g", "--cpus", "2", "--shm-size", "1g",
    "--tmpfs", "/tmp:rw,nosuid,size=256m",
    "--volume", `${workspaceRoot}:/workspace:ro`,
    "--volume", `${outputRoot}:/output:rw`,
    FRONTEND_VERIFIER_IMAGE_ID,
  ];
}

function validateAllowedChanges(changes: BenchmarkWriteWorkspaceChanges): readonly string[] {
  const paths = [
    ...changes.changed.map((entry) => entry.path),
    ...changes.added.map((entry) => entry.path),
    ...changes.deleted.map((entry) => entry.path),
  ];
  if (paths.length === 0) return ["Frontend benchmark verification requires a candidate component change."];
  const allowed = new Set<string>(FRONTEND_VERIFIER_ALLOWED_CHANGED_PATHS);
  const disallowed = paths.filter((path) => !allowed.has(path));
  return disallowed.length > 0
    ? [`Frontend benchmark changed paths outside the admitted scope: ${disallowed.join(", ")}`]
    : [];
}

function assertImageEvidence(image: FrontendVerifierImageEvidence): void {
  if (image.imageId !== FRONTEND_VERIFIER_IMAGE_ID
    || image.sourceDigest !== FRONTEND_VERIFIER_SOURCE_DIGEST
    || image.version !== FRONTEND_VERIFIER_VERSION) {
    throw new Error("Frontend verifier image does not match the exact admitted image ID, source digest, and version.");
  }
}

function runnerEvidence(image: FrontendVerifierImageEvidence): FrontendBenchmarkVerification["runner"] {
  return {
    kind: "docker-playwright",
    image: FRONTEND_VERIFIER_IMAGE,
    imageId: image.imageId,
    sourceDigest: FRONTEND_VERIFIER_SOURCE_DIGEST,
    network: "none",
    rootFilesystem: "read-only",
  };
}

function failedVerification(
  changes: BenchmarkWriteWorkspaceChanges,
  image: FrontendVerifierImageEvidence,
  violations: readonly string[],
): FrontendBenchmarkVerification {
  return {
    verifierId: FRONTEND_VERIFIER_ID,
    verifierVersion: FRONTEND_VERIFIER_VERSION,
    status: "failed",
    violations,
    changes,
    runner: runnerEvidence(image),
    render: undefined,
    screenshot: undefined,
    process: { exitCode: -1, stdout: "", stderr: violations.join("\n"), timedOut: false },
  };
}

async function readJsonRecord(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return readRecord(parsed);
  } catch {
    return undefined;
  }
}

async function readScreenshotEvidence(
  path: string,
  report: Record<string, unknown> | undefined,
): Promise<FrontendBenchmarkVerification["screenshot"]> {
  try {
    const screenshot = await readFile(path);
    if (screenshot.byteLength === 0 || screenshot.byteLength > MAX_SCREENSHOT_BYTES) return undefined;
    const sha256 = `sha256:${createHash("sha256").update(screenshot).digest("hex")}`;
    const declared = readRecord(report?.screenshot);
    if (declared?.sha256 !== sha256 || declared.bytes !== screenshot.byteLength) return undefined;
    return { sha256, bytes: screenshot.byteLength, base64: screenshot.toString("base64") };
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

const DOCKER_RUNNER: FrontendVerifierRunner = {
  inspectImage: async () => {
    const { stdout } = await execDocker([
      "image", "inspect", FRONTEND_VERIFIER_IMAGE,
      "--format", "{{.Id}}|{{index .Config.Labels \"io.kiln.verifier-source\"}}|{{index .Config.Labels \"org.opencontainers.image.version\"}}",
    ], 10_000);
    const [imageId = "", sourceDigest = "", version = ""] = stdout.trim().split("|");
    return { imageId, sourceDigest, version };
  },
  run: async (_containerName, args) => {
    try {
      const result = await execDocker(args, FRONTEND_VERIFIER_TIMEOUT_MS);
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
  },
  cleanup: async (containerName) => {
    await execDocker(["rm", "--force", containerName], 5_000).catch(() => undefined);
  },
};

function execDocker(args: readonly string[], timeout: number): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolveResult, reject) => {
    execFile("docker", [...args], {
      timeout,
      maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
      windowsHide: true,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolveResult({ stdout, stderr });
    });
  });
}
