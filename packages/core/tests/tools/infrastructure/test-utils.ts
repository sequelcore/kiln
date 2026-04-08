import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathValidator } from "../../../src/sandbox/path-validator.js";
import { SandboxPolicy, type SandboxConfig } from "../../../src/sandbox/policies.js";

export async function makeTempDir(prefix = "kiln-tools-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export function makeSandbox(path: string, config?: Partial<SandboxConfig>): {
  cwd: string;
  policy: SandboxPolicy;
  pathValidator: PathValidator;
} {
  const merged: SandboxConfig = {
    fsPolicy: config?.fsPolicy ?? "read-write",
    netPolicy: config?.netPolicy ?? "none",
    allowedPaths: config?.allowedPaths ?? [path],
    deniedPaths: config?.deniedPaths ?? [],
    allowedDomains: config?.allowedDomains ?? [],
  };

  const policy = new SandboxPolicy({ config: merged, projectPath: path });
  return {
    cwd: path,
    policy,
    pathValidator: new PathValidator({ policy }),
  };
}
