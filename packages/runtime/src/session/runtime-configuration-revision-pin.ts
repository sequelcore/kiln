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
}

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

  return Object.freeze({
    revisionSetId: observed.revisionSetId,
    revisions: Object.freeze(revisions),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
