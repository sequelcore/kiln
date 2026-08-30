import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxConfig } from "@kilnai/core/sandbox";
import { PathValidator, SandboxPolicy } from "@kilnai/core/sandbox";
import { nodePhysicalPathResolver } from "../../src/tools/node-physical-path-resolver.js";

export async function makeTempDir(prefix = "kiln-runtime-verification-"): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

export async function removeTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export function makeSandbox(path: string, config: Partial<SandboxConfig> = {}) {
  const policy = new SandboxPolicy({
    config: {
      fsPolicy: config.fsPolicy ?? "read-write",
      netPolicy: config.netPolicy ?? "none",
      allowedPaths: config.allowedPaths ?? [path],
      deniedPaths: config.deniedPaths ?? [],
      allowedDomains: config.allowedDomains ?? [],
    },
    projectPath: path,
  });
  return {
    cwd: path,
    policy,
    pathValidator: new PathValidator({ policy, physicalPathResolver: nodePhysicalPathResolver }),
    physicalPathResolver: nodePhysicalPathResolver,
  };
}
