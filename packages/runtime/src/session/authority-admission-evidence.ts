import {
  defineEffectiveAuthorityAdmissionBundle,
  EFFECTIVE_AUTHORITY_ADMISSION_SCHEMA_REVISION,
  type EffectiveAuthorityAdmissionBundle,
} from "./effective-authority-admission-bundle.js";
import type { RuntimeSessionAuthorityFacet } from "./runtime-session-authority-facet.js";

/** Mandatory Runtime-owned sink for secret-free full admission evidence. */
export interface AuthorityAdmissionEvidenceStore {
  persist(bundle: EffectiveAuthorityAdmissionBundle): void | Promise<void>;
  /** Restores the bind-once logical-session facet from durable full-bundle evidence. */
  loadSessionFacet(sessionId: string): RuntimeSessionAuthorityFacet | undefined | Promise<RuntimeSessionAuthorityFacet | undefined>;
  /** Reads back one immutable admission before an operator effect claim. */
  readAdmission?(input: {
    readonly admissionId: string;
    readonly sessionId: string;
    readonly turnId: string;
  }): EffectiveAuthorityAdmissionBundle | undefined | Promise<EffectiveAuthorityAdmissionBundle | undefined>;
}

/** Revalidates values at the persistence boundary before an adapter writes them. */
export function assertPersistableAuthorityAdmissionBundle(bundle: EffectiveAuthorityAdmissionBundle): EffectiveAuthorityAdmissionBundle {
  if (!isPlainRecord(bundle) || bundle.schemaRevision !== EFFECTIVE_AUTHORITY_ADMISSION_SCHEMA_REVISION || !isDeepFrozen(bundle)) {
    throw new TypeError(
      `Authority admission evidence must be an immutable schema-revision-${EFFECTIVE_AUTHORITY_ADMISSION_SCHEMA_REVISION} bundle; older revisions are invalid.`,
    );
  }
  const normalized = defineEffectiveAuthorityAdmissionBundle(bundle);
  if (normalized.admissionId !== bundle.admissionId) throw new TypeError("Authority admission evidence digest does not match its canonical bundle body.");
  return normalized;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDeepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => isDeepFrozen(child));
}
