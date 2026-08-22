import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";
import type { RuntimeConfigurationRevisionSnapshot } from "@kilnai/runtime";
import { resolveGlobalConfigPath } from "../config/global-config.js";
import { ConfigMutationStore } from "./config-mutation-store.js";

const MAX_CAPTURE_ATTEMPTS = 3;

/**
 * Captures the exact canonical revision set used to identify one admitted
 * Runtime turn. It carries no configuration values or secret material.
 */
export function readRuntimeConfigurationRevision(
  projectPath: string,
  options?: {
    readonly globalConfigPath?: string;
    /** Test/embedding seam for the existing ConfigMutationStore root. */
    readonly mutationStoreRoot?: string;
  },
): RuntimeConfigurationRevisionSnapshot {
  const globalPath = options?.globalConfigPath ?? resolveGlobalConfigPath();
  const projectConfigPath = join(projectPath, ".kiln", "kiln.yaml");
  const mutationStore = options?.mutationStoreRoot === undefined
    ? new ConfigMutationStore(projectPath, { globalConfigPath: globalPath })
    : new ConfigMutationStore(projectPath, { root: options.mutationStoreRoot, globalConfigPath: globalPath });
  for (let attempt = 0; attempt < MAX_CAPTURE_ATTEMPTS; attempt += 1) {
    const firstGlobal = readSource(globalPath);
    const firstProject = readSource(projectConfigPath);
    const firstLineage = readActivationLineage(
      mutationStore,
      projectPath,
      globalPath,
      projectConfigPath,
      firstGlobal.revision,
      firstProject.revision,
    );
    const secondGlobal = readSource(globalPath);
    const secondProject = readSource(projectConfigPath);
    const secondLineage = readActivationLineage(
      mutationStore,
      projectPath,
      globalPath,
      projectConfigPath,
      secondGlobal.revision,
      secondProject.revision,
    );
    if (firstGlobal.revision !== secondGlobal.revision
      || firstProject.revision !== secondProject.revision
      || JSON.stringify(firstLineage) !== JSON.stringify(secondLineage)) continue;

    const revisions = {
      global: firstGlobal.revision,
      project: firstProject.revision,
      "execution-target-evidence": managedEvidenceRevision(firstGlobal.bytes),
    } as const;
    return {
      revisionSetId: createRuntimeConfigurationRevisionSetId(revisions),
      revisions,
      ...(firstLineage.length === 0 ? {} : { activationLineage: firstLineage }),
    };
  }
  throw new Error("Canonical configuration changed during Runtime revision admission.");
}

/** Derives the stable identity for one secret-free Runtime revision set. */
export function createRuntimeConfigurationRevisionSetId(
  revisions: Readonly<Record<string, string>>,
): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(revisions)).digest("hex")}`;
}

function readActivationLineage(
  store: ConfigMutationStore,
  projectPath: string,
  globalPath: string,
  projectConfigPath: string,
  globalRevision: string,
  projectRevision: string,
): readonly NonNullable<RuntimeConfigurationRevisionSnapshot["activationLineage"]>[number][] {
  const candidates = [
    readSettlementLineage(store, globalPath, globalRevision, "global", projectPath, projectConfigPath),
    readSettlementLineage(store, projectConfigPath, projectRevision, "project", projectPath, projectConfigPath),
  ];
  return candidates.filter((lineage): lineage is NonNullable<typeof lineage> => lineage !== undefined);
}

function readSettlementLineage(
  store: ConfigMutationStore,
  canonicalPath: string,
  committedRevision: string,
  expectedScope: "project" | "global",
  projectPath: string,
  projectConfigPath: string,
): NonNullable<RuntimeConfigurationRevisionSnapshot["activationLineage"]>[number] | undefined {
  const settlement = store.readLatestSettlementForPath(canonicalPath, committedRevision);
  if (!settlement
    || settlement.scope !== expectedScope
    || settlement.committedRevision !== committedRevision
    || !isCommittedRevision(settlement.committedRevision)
    || settlement.reconciliationGenerations === undefined) return undefined;
  return {
    proposalId: settlement.proposalId,
    scope: settlement.scope,
    path: logicalCanonicalPath(canonicalPath, expectedScope, projectPath, projectConfigPath),
    committedRevision: settlement.committedRevision,
    reconciliationGenerations: settlement.reconciliationGenerations.map((generation) => ({
      target: generation.target,
      generation: generation.generation,
    })),
  };
}

function isCommittedRevision(value: string): value is "absent" | `sha256:${string}` {
  return value === "absent" || /^sha256:[a-f0-9]{64}$/u.test(value);
}

function logicalCanonicalPath(
  canonicalPath: string,
  scope: "project" | "global",
  projectPath: string,
  projectConfigPath: string,
): string {
  if (scope === "project" && samePath(canonicalPath, projectConfigPath)) return ".kiln/kiln.yaml";
  if (scope === "global") return "config.yaml";
  const relativePath = relative(projectPath, canonicalPath).replaceAll("\\", "/");
  return relativePath.length === 0 ? "." : relativePath;
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
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
