import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KilnConfigReconciliationTarget } from "@kilnai/gateway-contracts";
import { resolveGlobalConfigPath } from "../config/global-config.js";
import {
  type ProjectStateBinding,
  type ProjectStateRootOptions,
  resolveProjectStateBinding,
} from "./project-state-root.js";

export interface ConfigReconciliationGenerationOptions extends ProjectStateRootOptions {
  readonly globalConfigPath?: string;
  readonly projectStateBinding?: ProjectStateBinding;
}

/**
 * Captures the canonical inputs that can feed a reconciliation target.
 * Missing files are represented explicitly so creation and deletion are
 * generations too.
 */
export function captureCanonicalReconciliationGeneration(
  projectPath: string,
  target: KilnConfigReconciliationTarget,
  options: ConfigReconciliationGenerationOptions = {},
): string {
  const binding = options.projectStateBinding ?? resolveProjectStateBinding(projectPath, options);
  const digest = createHash("sha256").update(`kiln:config-reconciliation:${target}\0`, "utf8");
  for (const path of canonicalInputs(target, binding, options.globalConfigPath)) {
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

function canonicalInputs(
  target: KilnConfigReconciliationTarget,
  binding: ProjectStateBinding,
  configuredGlobalPath?: string,
): readonly string[] {
  const globalPath = configuredGlobalPath ?? resolveGlobalConfigPath();
  const globalRoot = dirname(globalPath);
  const projectPathname = binding.configPath;
  switch (target) {
    case "native-agents":
      return [globalPath, projectPathname, join(globalRoot, "agents"), binding.agentsPath];
    case "native-skills":
      return [globalPath, projectPathname, join(globalRoot, "skills"), binding.skillsPath];
    case "native-permissions":
    case "execution-routes":
      return [globalPath];
    case "repo-shims":
      return [
        projectPathname,
        binding.contextPath,
        binding.instructionsPath,
        join(globalRoot, "instructions"),
      ];
  }
}
