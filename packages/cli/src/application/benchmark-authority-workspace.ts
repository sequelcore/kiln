import { existsSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface BenchmarkAuthorityWorkspaceLease {
  readonly rootPath: string;
  cleanup(): void;
}

/** Owns disposable authority state for one synthetic benchmark execution. */
export function createBenchmarkAuthorityWorkspaceLease(): BenchmarkAuthorityWorkspaceLease {
  const rootPath = mkdtempSync(join(tmpdir(), "kiln-benchmark-authority-"));
  let cleaned = false;
  return {
    rootPath,
    cleanup() {
      if (cleaned) return;
      if (existsSync(rootPath)) {
        const metadata = lstatSync(rootPath);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          throw new Error("Refusing to clean an invalid benchmark authority workspace lease.");
        }
        rmSync(rootPath, { recursive: true, force: true });
      }
      cleaned = true;
    },
  };
}
