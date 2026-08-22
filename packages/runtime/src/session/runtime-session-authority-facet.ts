import { createHash } from "node:crypto";
import type { EffectiveTurnAuthorityPolicyBound } from "./runtime-session-orchestrator.types.js";
import {
  normalizeRuntimeConfigurationRevision,
  type RuntimeConfigurationRevisionSnapshot,
} from "./runtime-configuration-revision-pin.js";
import type { SkillCatalogAdmission } from "./effective-authority-admission-bundle.js";

export interface RuntimeSessionAuthorityFacetInput {
  readonly sessionId: string;
  readonly sessionRevision: RuntimeConfigurationRevisionSnapshot;
  readonly skillCatalog: SkillCatalogAdmission;
  readonly authorityCeiling: EffectiveTurnAuthorityPolicyBound;
}

export interface RuntimeSessionAuthorityFacet extends RuntimeSessionAuthorityFacetInput {
  readonly schemaRevision: 1;
  readonly facetId: `sha256:${string}`;
}

/** Creates the only session-level authority value that may be serialized. */
export function defineRuntimeSessionAuthorityFacet(
  input: RuntimeSessionAuthorityFacetInput,
): RuntimeSessionAuthorityFacet {
  assertSerializableFacetValue(input, "session authority facet");
  const sessionId = requiredString(input.sessionId, "sessionId");
  const sessionRevision = normalizeRuntimeConfigurationRevision(input.sessionRevision);
  const skillIds = [...input.skillCatalog.skillIds]
    .map((skillId, index) => requiredString(skillId, `skillCatalog.skillIds[${index}]`))
    .sort(compareCodeUnits);
  if (new Set(skillIds).size !== skillIds.length) throw new TypeError("skillCatalog.skillIds must not contain duplicates.");
  const catalogId = requiredString(input.skillCatalog.catalogId, "skillCatalog.catalogId");
  const catalogRevision = requiredString(input.skillCatalog.revision, "skillCatalog.revision");
  const authorityCeiling = normalizeAuthorityCeiling(input.authorityCeiling);
  const body = {
    schemaRevision: 1 as const,
    sessionId,
    sessionRevision,
    skillCatalog: { catalogId, revision: catalogRevision, skillIds: skillIds as readonly string[] },
    authorityCeiling,
  };
  const facetId = `sha256:${createHash("sha256").update(stableStringify(body), "utf8").digest("hex")}` as const;
  return deepFreeze({ facetId, ...body });
}

function normalizeAuthorityCeiling(value: EffectiveTurnAuthorityPolicyBound): EffectiveTurnAuthorityPolicyBound {
  if (value.maximumAuthority !== "read_only" && value.maximumAuthority !== "audited" && value.maximumAuthority !== "destructive") {
    throw new TypeError("authorityCeiling.maximumAuthority is unsupported.");
  }
  return {
    maximumAuthority: value.maximumAuthority,
    reason: requiredString(value.reason, "authorityCeiling.reason"),
    ...(value.subjectId === undefined ? {} : { subjectId: requiredString(value.subjectId, "authorityCeiling.subjectId") }),
  };
}

function assertSerializableFacetValue(value: unknown, label: string, key?: string): void {
  if (key && /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|credential|credentialMaterial)$/iu.test(key)) throw new TypeError(`${label} contains secret material.`);
  if (key && /^(?:cwd|workingDirectory|canonicalRoot|filePath|path)$/u.test(key)) throw new TypeError(`${label} contains a filesystem path.`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value)) throw new TypeError(`${label} contains a filesystem path.`);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be JSON-serializable.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSerializableFacetValue(entry, `${label}[${index}]`));
    return;
  }
  if (!isPlainRecord(value)) throw new TypeError(`${label} must contain only plain JSON-serializable values.`);
  for (const [childKey, child] of Object.entries(value)) {
    if (child === undefined) throw new TypeError(`${label}.${childKey} must be JSON-serializable.`);
    assertSerializableFacetValue(child, `${label}.${childKey}`, childKey);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) throw new TypeError(`${label} must be a non-empty trimmed string.`);
  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainRecord(value)) return `{${Object.entries(value).sort(([left], [right]) => compareCodeUnits(left, right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
