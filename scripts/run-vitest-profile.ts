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
  writeFileSync(output.outputFile, profileJson, "utf8");
}

export async function runVitestProfile(packageName: VitestProfilePackage): Promise<number> {
  const projectRoot = resolve(import.meta.dirname, "..");
  const packageRoot = join(projectRoot, "packages", packageName);
  const output = resolveVitestProfileOutput(projectRoot, packageName);
  prepareVitestProfileOutput(output);

  const child = Bun.spawn(["bunx", "vitest", "run", "--reporter=json"], {
    cwd: packageRoot,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "inherit",
  });

  // Start consuming immediately so a large JSON report cannot block Vitest on
  // a full child-process pipe while the parent waits for exit.
  const stdout = new Response(child.stdout).text();
  const exitCode = await child.exited;
  const profileJson = await stdout;
  if (exitCode !== 0) {
    process.stdout.write(profileJson);
    return exitCode;
  }
  writeVitestProfileOutput(output, profileJson);
  return 0;
}

if (import.meta.main) {
  const packageName = process.argv[2];
  if (packageName !== "cli" && packageName !== "runtime") {
    throw new Error("Usage: bun scripts/run-vitest-profile.ts <cli|runtime>");
  }
  const exitCode = await runVitestProfile(packageName);
  if (exitCode !== 0) process.exit(exitCode);
}
