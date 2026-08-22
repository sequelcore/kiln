import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KilnConfigReconciliationTarget } from "@kilnai/gateway-contracts";
import { resolveGlobalConfigPath } from "../config/global-config.js";

/**
 * Captures the canonical inputs that can feed a reconciliation target.
 * Missing files are represented explicitly so creation and deletion are
 * generations too.
 */
export function captureCanonicalReconciliationGeneration(
  projectPath: string,
  target: KilnConfigReconciliationTarget,
): string {
  const digest = createHash("sha256").update(`kiln:config-reconciliation:${target}\0`, "utf8");
  for (const path of canonicalInputs(projectPath, target)) {
    digestInput(digest, path);
  }
  return `sha256:${digest.digest("hex")}`;
}

function digestInput(digest: ReturnType<typeof createHash>, path: string): void {
  if (!existsSync(path)) {
    digest.update("absent\0", "utf8");
    return;
  }
  if (statSync(path).isDirectory()) {
    const entries = readdirSync(path, { withFileTypes: true });
    digest.update("directory\0", "utf8");
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      digest.update(entry.name).update("\0", "utf8");
      digestInput(digest, join(path, entry.name));
    }
    return;
  }
  try {
    digest.update("file\0", "utf8").update(readFileSync(path)).update("\0", "utf8");
  } catch {
    if (!existsSync(path)) {
      digest.update("absent\0", "utf8");
      return;
    }
    throw new Error("A reconciliation input could not be captured.");
  }
}

function canonicalInputs(projectPath: string, target: KilnConfigReconciliationTarget): readonly string[] {
  const globalPath = resolveGlobalConfigPath();
  const globalRoot = dirname(globalPath);
  const projectPathname = join(projectPath, ".kiln", "kiln.yaml");
  switch (target) {
    case "native-agents":
      return [globalPath, projectPathname, join(globalRoot, "agents"), join(projectPath, ".kiln", "agents")];
    case "native-skills":
      return [globalPath, projectPathname, join(globalRoot, "skills"), join(projectPath, ".kiln", "skills")];
    case "native-permissions":
    case "execution-routes":
      return [globalPath];
    case "repo-shims":
      return [
        projectPathname,
        join(projectPath, ".kiln", "project-context.md"),
        join(projectPath, ".kiln", "instructions"),
        join(globalRoot, "instructions"),
      ];
  }
}
