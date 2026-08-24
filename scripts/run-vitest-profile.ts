import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "../packages/cli/src/application/private-project-state-filesystem.js";
import { resolveProjectStateBinding } from "../packages/cli/src/application/project-state-root.js";

export type VitestProfilePackage = "cli" | "runtime";

export interface VitestProfileOutput {
  readonly projectStateRoot: string;
  readonly profileRoot: string;
  readonly outputFile: string;
}

/** Request Vitest to suppress logs from passing tests. */
export function buildVitestProfileArgs(): readonly string[] {
  return ["vitest", "run", "--reporter=json", "--silent=passed-only"];
}

/**
 * Keep only the reporter object when test code writes directly to stdout.
 * Vitest's JSON reporter emits one top-level object, but test-owned stdout can
 * precede or follow it even with the passing-test silent mode enabled.
 */
export function extractVitestProfileJson(profileOutput: string): string {
  const objectFrames: Array<{ readonly start: number; hasProfileMarker: boolean }> = [];
  let matchingReport: string | undefined;
  let matchCount = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < profileOutput.length; index += 1) {
    const character = profileOutput[index];
    if (!inString && profileOutput.startsWith('"numTotalTestSuites"', index)) {
      const frame = objectFrames.at(-1);
      if (frame) frame.hasProfileMarker = true;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      objectFrames.push({ start: index, hasProfileMarker: false });
    } else if (character === "}") {
      const frame = objectFrames.pop();
      if (!frame?.hasProfileMarker) continue;
      const candidate = profileOutput.slice(frame.start, index + 1);
      let parsed: unknown;
      try {
        parsed = JSON.parse(candidate) as unknown;
      } catch {
        continue;
      }
      if (isVitestProfileReport(parsed)) {
        matchCount += 1;
        matchingReport ??= candidate;
      }
    }
  }
  if (matchCount === 0) {
    throw new Error("Vitest JSON reporter did not produce a valid JSON report.");
  }
  if (matchCount > 1) {
    throw new Error("Vitest JSON reporter produced ambiguous multiple JSON reports.");
  }
  return matchingReport!;
}

/** Resolve the one private artifact target used by the profiling command. */
export function resolveVitestProfileOutput(
  projectRoot: string,
  packageName: VitestProfilePackage,
): VitestProfileOutput {
  const binding = resolveProjectStateBinding(projectRoot);
  const profileRoot = join(binding.evidencePath, "test-profiles");
  return {
    projectStateRoot: binding.projectStateRoot,
    profileRoot,
    outputFile: join(profileRoot, `${packageName}-vitest-profile.json`),
  };
}

/**
 * Establish the profile directory and validate its existing output target.
 * These checks happen immediately before the child process is started.
 */
export function prepareVitestProfileOutput(output: VitestProfileOutput): void {
  ensurePrivateStateDirectorySync(output.projectStateRoot, output.profileRoot);
  assertPrivateStateFileTargetSync(output.projectStateRoot, output.outputFile);
}

/**
 * Own the final profile write in this process so Vitest never receives a
 * filesystem path that it could follow after the private-state check.
 */
export function writeVitestProfileOutput(output: VitestProfileOutput, profileJson: string): void {
  ensurePrivateStateDirectorySync(output.projectStateRoot, output.profileRoot);
  assertPrivateStateFileTargetSync(output.projectStateRoot, output.outputFile);
  try {
    JSON.parse(profileJson);
  } catch {
    throw new Error("Vitest profile output was not valid JSON.");
  }
  writeFileSync(output.outputFile, profileJson, "utf8");
}

export interface VitestProfileSettlementSinks {
  readonly writeProfile?: (output: VitestProfileOutput, profileJson: string) => void;
  readonly writeStdout?: (value: string) => void;
  readonly writeStderr?: (value: string) => void;
}

/** Settle one child result without mixing diagnostics into the committed report. */
export function settleVitestProfileOutput(
  output: VitestProfileOutput,
  exitCode: number,
  profileOutput: string,
  sinks: VitestProfileSettlementSinks = {},
): number {
  const writeProfile = sinks.writeProfile ?? writeVitestProfileOutput;
  const writeStdout = sinks.writeStdout ?? ((value: string) => process.stdout.write(value));
  const writeStderr = sinks.writeStderr ?? ((value: string) => process.stderr.write(value));
  if (exitCode !== 0) {
    writeStdout(profileOutput);
    return exitCode;
  }
  let reportJson: string;
  try {
    reportJson = extractVitestProfileJson(profileOutput);
  } catch {
    // A zero exit code cannot turn a contaminated stream into a valid artifact;
    // preserve the raw stream for diagnosis and leave the prior artifact intact.
    writeStdout(profileOutput);
    writeStderr("Vitest profile output did not contain a valid JSON report.\n");
    return 1;
  }
  writeProfile(output, reportJson);
  return 0;
}

export async function runVitestProfile(packageName: VitestProfilePackage): Promise<number> {
  const projectRoot = resolve(import.meta.dirname, "..");
  const packageRoot = join(projectRoot, "packages", packageName);
  const output = resolveVitestProfileOutput(projectRoot, packageName);
  prepareVitestProfileOutput(output);

  // Keep failure logs visible with passed-only; successful-run stdout is
  // normalized below before committing the artifact.
  const child = Bun.spawn(["bunx", ...buildVitestProfileArgs()], {
    cwd: packageRoot,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "inherit",
  });

  // Start consuming immediately so a large JSON report cannot block Vitest on
  // a full child-process pipe while the parent waits for exit.
  const stdout = new Response(child.stdout).text();
  const exitCode = await child.exited;
  return settleVitestProfileOutput(output, exitCode, await stdout);
}

function isVitestProfileReport(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  const countFields = [
    "numTotalTestSuites",
    "numPassedTestSuites",
    "numFailedTestSuites",
    "numPendingTestSuites",
    "numTotalTests",
    "numPassedTests",
    "numFailedTests",
    "numPendingTests",
    "numTodoTests",
    "startTime",
  ] as const;
  return (
    typeof report.success === "boolean" &&
    isRecord(report.snapshot) &&
    Array.isArray(report.testResults) &&
    countFields.every((field) => isFiniteNumber(report[field]))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

if (import.meta.main) {
  const packageName = process.argv[2];
  if (packageName !== "cli" && packageName !== "runtime") {
    throw new Error("Usage: bun scripts/run-vitest-profile.ts <cli|runtime>");
  }
  const exitCode = await runVitestProfile(packageName);
  if (exitCode !== 0) process.exit(exitCode);
}
