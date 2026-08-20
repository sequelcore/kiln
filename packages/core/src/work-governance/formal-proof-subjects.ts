import { requireBoundedWorkDigest } from "./bounded-work-content.js";

/** One candidate-relative source a deterministic verifier covered. */
export interface FormalProofSubject {
  readonly path: string;
  readonly contentDigest: string;
}

/** Per-path content digests resolved from one exact candidate. */
export interface CandidateSubjectDigests {
  readonly candidateContentDigest: string;
  readonly digests: ReadonlyMap<string, string>;
}

/**
 * Normalize the candidate-relative subject value used by the #93 resolver.
 * This concern deliberately carries no verifier outcome or acceptance mapping.
 */
export function normalizeFormalProofSubjects(
  subjects: readonly FormalProofSubject[],
): readonly FormalProofSubject[] {
  const normalized = subjects.map((subject) => ({
    path: requireSubjectPath(subject.path),
    contentDigest: requireBoundedWorkDigest(subject.contentDigest, "subject.contentDigest"),
  }));
  const seen = new Set<string>();
  for (const subject of normalized) {
    if (seen.has(subject.path)) throw new Error(`duplicate subject path ${subject.path}`);
    seen.add(subject.path);
  }
  return normalized.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

/** Normalize the candidate tag and every candidate-relative digest in a map. */
export function normalizeCandidateSubjectDigests(
  value: CandidateSubjectDigests,
): CandidateSubjectDigests {
  const candidateContentDigest = requireBoundedWorkDigest(
    value.candidateContentDigest,
    "candidateSubjects.candidateContentDigest",
  );
  if (!(value.digests instanceof Map)) {
    throw new Error("candidateSubjects.digests must be a Map");
  }
  const digests = new Map<string, string>();
  for (const [path, digest] of value.digests) {
    const normalizedPath = requireSubjectPath(path);
    if (digests.has(normalizedPath)) throw new Error(`duplicate subject path ${normalizedPath}`);
    digests.set(normalizedPath, requireBoundedWorkDigest(digest, `candidateSubjects.digests.${normalizedPath}`));
  }
  return { candidateContentDigest, digests };
}

function requireSubjectPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) throw new Error("subject path is required");
  if (trimmed !== path) throw new Error(`subject path ${path} must not have surrounding whitespace`);
  if (trimmed.includes("\\")) {
    throw new Error(`subject path ${trimmed} must use POSIX separators`);
  }
  if (trimmed.startsWith("/")) {
    throw new Error(`subject path ${trimmed} must be candidate-relative`);
  }
  if (/^[A-Za-z]:/u.test(trimmed)) {
    throw new Error(`subject path ${trimmed} must not carry a drive letter`);
  }
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`subject path ${trimmed} must not contain empty, '.', or '..' segments`);
  }
  return trimmed;
}
