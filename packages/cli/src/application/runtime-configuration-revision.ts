import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { RuntimeConfigurationRevisionSnapshot } from "@kilnai/runtime";
import { parse } from "yaml";
import { resolveGlobalConfigPath } from "../config/global-config.js";
import { ConfigMutationStore } from "./config-mutation-store.js";
import {
  captureProjectStateSourceDigests,
  type ProjectStateSourceDigests,
  readProjectAdoption,
} from "./project-adoption-manifest.js";
import {
  type ProjectStateBinding,
  type ProjectStateRootOptions,
  resolveProjectStateBinding,
} from "./project-state-root.js";

const MAX_CAPTURE_ATTEMPTS = 3;

export interface RuntimeConfigurationRevisionOptions extends ProjectStateRootOptions {
  readonly globalConfigPath?: string;
  /** Test/embedding seam for the existing ConfigMutationStore root. */
  readonly mutationStoreRoot?: string;
  readonly projectStateBinding?: ProjectStateBinding;
}

/**
 * Capture the canonical revision set used to identify one admitted Runtime
 * turn. Project bytes are read only from the private project-state owner; the
 * repository's `.kiln` tree is never a fallback or compatibility source.
 */
export function readRuntimeConfigurationRevision(
  projectPath: string,
  options?: RuntimeConfigurationRevisionOptions,
): RuntimeConfigurationRevisionSnapshot {
  const globalPath = options?.globalConfigPath ?? resolveGlobalConfigPath();
  const binding = options?.projectStateBinding ?? resolveProjectStateBinding(projectPath, options);
  const projectConfigPath = binding.configPath;
  const mutationStore =
    options?.mutationStoreRoot === undefined
      ? new ConfigMutationStore(binding.canonicalRoot, { root: binding.mutationsPath, globalConfigPath: globalPath })
      : new ConfigMutationStore(binding.canonicalRoot, {
          root: options.mutationStoreRoot,
          globalConfigPath: globalPath,
        });

  for (let attempt = 0; attempt < MAX_CAPTURE_ATTEMPTS; attempt += 1) {
    const firstGlobal = readSource(globalPath);
    const firstProject = readSource(projectConfigPath);
    const firstAdoption = readAdoptionRevision(binding);
    const firstProjectState = deriveProjectStateRevision(
      binding,
      firstProject.revision,
      captureProjectStateSourceDigests(binding),
    );
    const firstLineage = readActivationLineage(
      mutationStore,
      binding.canonicalRoot,
      globalPath,
      projectConfigPath,
      firstGlobal.revision,
      firstProject.revision,
    );
    const secondGlobal = readSource(globalPath);
    const secondProject = readSource(projectConfigPath);
    const secondAdoption = readAdoptionRevision(binding);
    const secondProjectState = deriveProjectStateRevision(
      binding,
      secondProject.revision,
      captureProjectStateSourceDigests(binding),
    );
    const secondLineage = readActivationLineage(
      mutationStore,
      binding.canonicalRoot,
      globalPath,
      projectConfigPath,
      secondGlobal.revision,
      secondProject.revision,
    );
    if (
      firstGlobal.revision !== secondGlobal.revision ||
      firstProject.revision !== secondProject.revision ||
      firstAdoption !== secondAdoption ||
      firstProjectState !== secondProjectState ||
      JSON.stringify(firstLineage) !== JSON.stringify(secondLineage)
    )
      continue;

    const revisions = {
      global: firstGlobal.revision,
      project: firstProject.revision,
      "project-state": firstProjectState,
      adoption: firstAdoption,
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

/** Derive the stable identity for one secret-free Runtime revision set. */
export function createRuntimeConfigurationRevisionSetId(
  revisions: Readonly<Record<string, string>>,
): `sha256:${string}` {
  const canonical = Object.fromEntries(
    Object.entries(revisions).sort(([left], [right]) => compareCodeUnits(left, right)),
  );
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex")}`;
}

function readAdoptionRevision(binding: ProjectStateBinding): `sha256:${string}` {
  const adoption = readProjectAdoption(binding);
  if (adoption.status === "adopted") return adoption.adoptionRevision;
  throw new Error(`Project adoption is not valid: ${adoption.reason}`);
}

function deriveProjectStateRevision(
  binding: ProjectStateBinding,
  projectRevision: string,
  sourceDigests: ProjectStateSourceDigests,
): `sha256:${string}` {
  const canonical = {
    projectRuntimeId: binding.projectRuntimeId,
    projectRevision,
    sourceDigests: {
      context: sourceDigests.context,
      agents: sourceDigests.agents,
      instructions: sourceDigests.instructions,
      skills: sourceDigests.skills,
    },
  };
  return `sha256:${createHash("sha256")
    .update("kiln:project-state-revision:v1\0", "utf8")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex")}`;
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
  if (
    !settlement ||
    settlement.scope !== expectedScope ||
    settlement.committedRevision !== committedRevision ||
    !isCommittedRevision(settlement.committedRevision) ||
    settlement.reconciliationGenerations === undefined
  )
    return undefined;
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
  if (scope === "project" && samePath(canonicalPath, projectConfigPath)) return "config.yaml";
  if (scope === "global") return "config.yaml";
  const relativePath = relativePathWithinProject(projectPath, canonicalPath);
  return relativePath.length === 0 ? "." : relativePath;
}

function relativePathWithinProject(projectPath: string, childPath: string): string {
  return relative(projectPath, childPath).replaceAll("\\", "/");
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function readSource(path: string): { readonly bytes: Buffer | null; readonly revision: string } {
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Unsafe canonical configuration file: ${path}`);
    const bytes = readFileSync(path);
    const after = lstatSync(path);
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      !bytes.equals(readFileSync(path))
    ) {
      throw new Error(`Canonical configuration changed during revision capture: ${path}`);
    }
    return { bytes, revision: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  } catch (error) {
    if (isMissingError(error)) return { bytes: null, revision: "absent" };
    throw error;
  }
}

function managedEvidenceRevision(globalBytes: Buffer | null): string {
  if (globalBytes === null) return "absent";
  const value: unknown = parse(globalBytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) return "absent";
  const targetCatalog = (value as Record<string, unknown>).targetCatalog;
  if (!targetCatalog || typeof targetCatalog !== "object" || Array.isArray(targetCatalog)) return "absent";
  const revision = (targetCatalog as Record<string, unknown>).evidenceRevision;
  return typeof revision === "string" && /^sha256:[a-f0-9]{64}$/u.test(revision) ? revision : "absent";
}

function isMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { readonly code?: unknown }).code === "ENOENT" ||
      (error as { readonly code?: unknown }).code === "ENOTDIR")
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
