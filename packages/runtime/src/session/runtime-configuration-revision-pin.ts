/**
 * Secret-free configuration evidence attached to one admitted Runtime turn.
 *
 * This is deliberately only an identity/evidence value. It does not contain
 * configuration authority and must not be used as a substitute for the owner
 * of any configuration family.
 */
export interface RuntimeConfigurationRevisionSnapshot {
  readonly revisionSetId: string;
  readonly revisions: Readonly<Record<string, string>>;
  /**
   * Causal identity for the canonical settlement that produced an admitted
   * revision. This is evidence only; omitted lineage never proves activation.
   */
  readonly activationLineage?: readonly RuntimeConfigurationActivationLineage[];
}

export interface RuntimeConfigurationActivationLineage {
  readonly proposalId: string;
  readonly scope: "project" | "global";
  /** A logical canonical path; operator-specific absolute paths are forbidden. */
  readonly path: string;
  readonly committedRevision: "absent" | `sha256:${string}`;
  readonly reconciliationGenerations: readonly RuntimeConfigurationReconciliationGeneration[];
}

export interface RuntimeConfigurationReconciliationGeneration {
  readonly target: string;
  readonly generation: `sha256:${string}`;
}

const RECONCILIATION_TARGETS = [
  "native-agents",
  "native-skills",
  "native-permissions",
  "repo-shims",
  "execution-routes",
] as const;

export type RuntimeConfigurationRevisionProvider = () =>
  | RuntimeConfigurationRevisionSnapshot
  | Promise<RuntimeConfigurationRevisionSnapshot>;

/** Capture exactly one provider observation as an immutable plain value. */
export async function captureRuntimeConfigurationRevision(
  provider: RuntimeConfigurationRevisionProvider,
): Promise<RuntimeConfigurationRevisionSnapshot> {
  return normalizeRuntimeConfigurationRevision(await provider());
}

/** Validate, detach, and freeze revision evidence crossing a runtime boundary. */
export function normalizeRuntimeConfigurationRevision(
  observed: RuntimeConfigurationRevisionSnapshot,
): RuntimeConfigurationRevisionSnapshot {
  if (!isRecord(observed) || typeof observed.revisionSetId !== "string" || observed.revisionSetId.trim().length === 0) {
    throw new TypeError("Runtime configuration revision must include a non-empty revisionSetId.");
  }
  if (!isRecord(observed.revisions)) {
    throw new TypeError("Runtime configuration revision must include a plain revisions record.");
  }

  const revisions: Record<string, string> = {};
  for (const [family, revision] of Object.entries(observed.revisions)) {
    if (family.trim().length === 0 || typeof revision !== "string" || revision.trim().length === 0) {
      throw new TypeError("Runtime configuration revision families must have non-empty string revisions.");
    }
    revisions[family] = revision;
  }

  const activationLineage = observed.activationLineage === undefined
    ? undefined
    : normalizeActivationLineage(observed.activationLineage);

  return Object.freeze({
    revisionSetId: observed.revisionSetId,
    revisions: Object.freeze(revisions),
    ...(activationLineage === undefined ? {} : { activationLineage }),
  });
}

function normalizeActivationLineage(
  observed: readonly RuntimeConfigurationActivationLineage[],
): readonly RuntimeConfigurationActivationLineage[] {
  if (!Array.isArray(observed)) {
    throw new TypeError("Runtime configuration activationLineage must be an array.");
  }
  const normalized = observed.map((entry, index): RuntimeConfigurationActivationLineage => {
    if (!isRecord(entry)) {
      throw new TypeError(`Runtime configuration activationLineage[${index}] must be a plain record.`);
    }
    const proposalId = requiredString(entry.proposalId, `activationLineage[${index}].proposalId`);
    const scope = entry.scope;
    if (scope !== "project" && scope !== "global") {
      throw new TypeError(`activationLineage[${index}].scope must be project or global.`);
    }
    const path = requiredString(entry.path, `activationLineage[${index}].path`);
    if (!isLogicalPath(path)) {
      throw new TypeError(`activationLineage[${index}].path must be a logical relative path.`);
    }
    const committedRevision = entry.committedRevision;
    if (!isCommittedRevision(committedRevision)) {
      throw new TypeError(`activationLineage[${index}].committedRevision is malformed.`);
    }
    if (!Array.isArray(entry.reconciliationGenerations)) {
      throw new TypeError(`activationLineage[${index}].reconciliationGenerations must be an array.`);
    }
    const reconciliationGenerations = entry.reconciliationGenerations.map((generation, generationIndex) => {
      if (!isRecord(generation)) {
        throw new TypeError(`activationLineage[${index}].reconciliationGenerations[${generationIndex}] must be a plain record.`);
      }
      const target = requiredString(
        generation.target,
        `activationLineage[${index}].reconciliationGenerations[${generationIndex}].target`,
      );
      if (!isReconciliationTarget(target)) {
        throw new TypeError(`activationLineage[${index}].reconciliationGenerations[${generationIndex}].target is unsupported.`);
      }
      const value = generation.generation;
      if (!isDigest(value)) {
        throw new TypeError(`activationLineage[${index}].reconciliationGenerations[${generationIndex}].generation is malformed.`);
      }
      return Object.freeze({ target, generation: value });
    }).sort((left, right) => compareCodeUnits(left.target, right.target));
    if (new Set(reconciliationGenerations.map((generation) => generation.target)).size !== reconciliationGenerations.length) {
      throw new TypeError(`activationLineage[${index}].reconciliationGenerations must not repeat a target.`);
    }
    return {
      proposalId,
      scope,
      path,
      committedRevision,
      reconciliationGenerations: Object.freeze(reconciliationGenerations),
    };
  }).sort((left, right) => compareCodeUnits(
    `${left.scope}\0${left.path}\0${left.committedRevision}\0${left.proposalId}`,
    `${right.scope}\0${right.path}\0${right.committedRevision}\0${right.proposalId}`,
  ));
  const lineageIdentities = normalized.map((entry) => `${entry.scope}\0${entry.path}`);
  if (new Set(lineageIdentities).size !== lineageIdentities.length) {
    throw new TypeError("Runtime configuration activationLineage must contain one settlement per scope and logical path.");
  }
  return Object.freeze(normalized.map((entry) => Object.freeze(entry)));
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function isCommittedRevision(value: unknown): value is "absent" | `sha256:${string}` {
  return value === "absent" || isDigest(value);
}

function isDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isReconciliationTarget(value: string): boolean {
  return RECONCILIATION_TARGETS.some((target) => target === value);
}

function isLogicalPath(value: string): boolean {
  return !/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(value)
    && !value.split(/[\\/]/u).some((segment) => segment === ".." || segment.length === 0);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
