import { lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathValidator } from "../../../src/sandbox/path-validator.js";
import { SandboxPolicy } from "../../../src/sandbox/policies.js";
import type { SandboxConfig } from "../../../src/sandbox/index.js";
import type { BuiltinFilesystem } from "../../../src/tools/contracts/builtin-filesystem.js";

export const nodeTestFilesystem: BuiltinFilesystem = {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
};

export async function makeTempDir(prefix = "kiln-tools-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTempDir(path: string): Promise<void> {
  const attempts = 20;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, attempt * 25)));
    }
  }
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
