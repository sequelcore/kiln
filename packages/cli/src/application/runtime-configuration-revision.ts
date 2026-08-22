import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { RuntimeConfigurationRevisionSnapshot } from "@kilnai/runtime";
import { resolveGlobalConfigPath } from "../config/global-config.js";

const MAX_CAPTURE_ATTEMPTS = 3;

/**
 * Captures the exact canonical revision set used to identify one admitted
 * Runtime turn. It carries no configuration values or secret material.
 */
export function readRuntimeConfigurationRevision(
  projectPath: string,
  options?: { readonly globalConfigPath?: string },
): RuntimeConfigurationRevisionSnapshot {
  const globalPath = options?.globalConfigPath ?? resolveGlobalConfigPath();
  const projectConfigPath = join(projectPath, ".kiln", "kiln.yaml");
  for (let attempt = 0; attempt < MAX_CAPTURE_ATTEMPTS; attempt += 1) {
    const firstGlobal = readSource(globalPath);
    const firstProject = readSource(projectConfigPath);
    const secondGlobal = readSource(globalPath);
    const secondProject = readSource(projectConfigPath);
    if (firstGlobal.revision !== secondGlobal.revision || firstProject.revision !== secondProject.revision) continue;

    const revisions = {
      global: firstGlobal.revision,
      project: firstProject.revision,
      "execution-target-evidence": managedEvidenceRevision(firstGlobal.bytes),
    } as const;
    return {
      revisionSetId: `sha256:${createHash("sha256").update(JSON.stringify(revisions)).digest("hex")}`,
      revisions,
    };
  }
  throw new Error("Canonical configuration changed during Runtime revision admission.");
}

function readSource(path: string): { readonly bytes: string | null; readonly revision: string } {
  if (!existsSync(path)) return { bytes: null, revision: "absent" };
  const bytes = readFileSync(path, "utf8");
  return { bytes, revision: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}

function managedEvidenceRevision(globalBytes: string | null): string {
  if (globalBytes === null) return "absent";
  const value: unknown = parse(globalBytes);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "absent";
  const targetCatalog = (value as Record<string, unknown>).targetCatalog;
  if (!targetCatalog || typeof targetCatalog !== "object" || Array.isArray(targetCatalog)) return "absent";
  const revision = (targetCatalog as Record<string, unknown>).evidenceRevision;
  return typeof revision === "string" && /^sha256:[a-f0-9]{64}$/u.test(revision) ? revision : "absent";
}
