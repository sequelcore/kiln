import { normalizeFormalProofSubjects } from "../../work-governance/formal-proof-subjects.js";

export const FORMAL_VERIFICATION_OBSERVATION_SCHEMA = "kiln.formal-verification-observation/v3" as const;

export type FormalVerificationOutcome = "proved" | "refuted" | "unresolved";

export interface FormalVerificationArtifact {
  readonly contentDigest: string;
}

export interface FormalVerificationSubject {
  readonly path: string;
  readonly contentDigest: string;
}

export interface FormalVerificationCheck {
  readonly symbol: string;
  readonly check: "correctness";
  readonly outcome: FormalVerificationOutcome;
  readonly detail?: string;
  readonly durationMs: number;
  readonly resourceCount: number;
}

/** Immutable facts produced by one exact Dafny engine run. */
export interface FormalVerificationObservation {
  readonly schema: typeof FORMAL_VERIFICATION_OBSERVATION_SCHEMA;
  readonly toolName: "formal_verify";
  readonly kind: "formal_verification";
  readonly verifier: { readonly name: "dafny"; readonly version: string };
  readonly artifact: FormalVerificationArtifact;
  readonly subjects: readonly FormalVerificationSubject[];
  readonly checks: readonly FormalVerificationCheck[];
  readonly establishes: readonly [];
}

export function formalVerificationObservation(
  value: Omit<FormalVerificationObservation, "schema" | "toolName" | "kind" | "establishes">,
): FormalVerificationObservation {
  return parseFormalVerificationObservation({
    schema: FORMAL_VERIFICATION_OBSERVATION_SCHEMA,
    toolName: "formal_verify",
    kind: "formal_verification",
    establishes: [],
    ...value,
  });
}

export function parseFormalVerificationObservation(value: unknown): FormalVerificationObservation {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schema", "toolName", "kind", "verifier", "artifact", "subjects", "checks", "establishes"])) {
    throw new Error("formal verification observation has an invalid shape or extra field");
  }
  if (value.schema !== FORMAL_VERIFICATION_OBSERVATION_SCHEMA || value.toolName !== "formal_verify" || value.kind !== "formal_verification") {
    throw new Error("formal verification observation identity is invalid");
  }
  if (!isRecord(value.verifier) || !hasOnlyKeys(value.verifier, ["name", "version"]) || value.verifier.name !== "dafny") {
    throw new Error("formal verification engine identity is invalid");
  }
  if (!isNonEmptyString(value.verifier.version)) throw new Error("formal verification engine version is invalid");
  if (!isRecord(value.artifact) || !hasOnlyKeys(value.artifact, ["contentDigest"]) || !isCanonicalSha256(value.artifact.contentDigest)) {
    throw new Error("formal verification artifact contentDigest must be canonical sha256 evidence");
  }
  const subjects = parseSubjects(value.subjects);
  const checks = parseChecks(value.checks);
  if (!Array.isArray(value.establishes) || value.establishes.length !== 0) {
    throw new Error("formal verification observation establishes must be empty");
  }
  return Object.freeze({
    schema: FORMAL_VERIFICATION_OBSERVATION_SCHEMA,
    toolName: "formal_verify",
    kind: "formal_verification",
    verifier: Object.freeze({ name: "dafny", version: value.verifier.version }),
    artifact: Object.freeze({ contentDigest: value.artifact.contentDigest }),
    subjects: Object.freeze(subjects.map((subject) => Object.freeze(subject))),
    checks: Object.freeze(checks.map((check) => Object.freeze(check))),
    establishes: Object.freeze([]) as readonly [],
  });
}

export function isFormalVerificationObservation(value: unknown): value is FormalVerificationObservation {
  try {
    parseFormalVerificationObservation(value);
    return true;
  } catch {
    return false;
  }
}

function parseSubjects(value: unknown): readonly FormalVerificationSubject[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("formal verification observation subjects must be non-empty");
  const subjects = value.map((entry) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["path", "contentDigest"]) || typeof entry.path !== "string" || typeof entry.contentDigest !== "string") {
      throw new Error("formal verification subject has an invalid shape");
    }
    return { path: entry.path, contentDigest: entry.contentDigest };
  });
  const normalized = normalizeFormalProofSubjects(subjects);
  if (normalized.length !== subjects.length || normalized.some((subject, index) => subject.path !== subjects[index]?.path || subject.contentDigest !== subjects[index]?.contentDigest)) {
    throw new Error("formal verification subjects must be in canonical sorted order");
  }
  return normalized;
}

function parseChecks(value: unknown): readonly FormalVerificationCheck[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("formal verification observation checks must be a dense non-empty array");
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new Error("formal verification observation checks must be a dense non-empty array");
  }
  let previousSymbol: string | undefined;
  return value.map((entry) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["symbol", "check", "outcome", "durationMs", "resourceCount"], ["detail"])) {
      throw new Error("formal verification check has an invalid shape or extra field");
    }
    if (!isNonEmptyString(entry.symbol) || entry.check !== "correctness") {
      throw new Error("formal verification check identity is invalid");
    }
    if (entry.outcome !== "proved" && entry.outcome !== "refuted" && entry.outcome !== "unresolved") throw new Error("formal verification check outcome is invalid");
    if (previousSymbol !== undefined && entry.symbol <= previousSymbol) throw new Error("formal verification checks must be in canonical sorted order");
    previousSymbol = entry.symbol;
    if (entry.detail !== undefined && !isNonEmptyString(entry.detail)) throw new Error("formal verification check detail must be non-empty when present");
    if (entry.outcome === "proved" && entry.detail !== undefined) throw new Error("formal verification proved checks must not carry detail");
    if (entry.outcome !== "proved" && entry.detail === undefined) throw new Error("formal verification check detail is required when not proved");
    if (!isNonNegativeInteger(entry.durationMs) || !isNonNegativeInteger(entry.resourceCount)) {
      throw new Error("formal verification proof effort must contain non-negative integer durationMs and resourceCount");
    }
    return {
      symbol: entry.symbol,
      check: "correctness",
      outcome: entry.outcome,
      ...(entry.detail === undefined ? {} : { detail: entry.detail }),
      durationMs: entry.durationMs,
      resourceCount: entry.resourceCount,
    };
  });
}

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isCanonicalSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
