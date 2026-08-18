/**
 * Deterministic-verifier verdicts admitted as bounded-work evidence.
 *
 * A verdict records what a formal verifier proved, about which exact sources,
 * with which toolchain. It is inert on its own: it carries no completion
 * authority and does not decide acceptance. Binding it to a candidate is what
 * makes it evidence, and the work-governance boundary decides whether that
 * evidence satisfies the contract.
 *
 * Two properties are load-bearing:
 *
 * - A verdict names the coverage it was produced against: one or more
 *   candidate-relative paths, each with the content digest the verifier ran
 *   against. Binding proves that every covered path still has that exact
 *   content in the candidate; a path the candidate has changed or dropped
 *   voids the binding, so a proof cannot outlive the code it proved. A
 *   verifier's subject is rarely a whole candidate — a captured candidate is
 *   an entire git worktree — so binding does not require the covered paths to
 *   exhaust the candidate, and it does not decide whether partial coverage is
 *   sufficient for any acceptance criterion; that policy question belongs to
 *   the work-governance boundary, not to this module.
 * - A verdict is `proved` only when every declared obligation is proved.
 *   Unresolved and refuted obligations fail closed; an empty obligation set is
 *   not a proof of anything.
 */

import { bindBoundedWorkEvidence } from "./bounded-work-candidate.js";
import type {
  BoundedWorkCandidateEvidence,
  BoundedWorkCandidateIdentity,
} from "./bounded-work-candidate.js";
import {
  boundedWorkDigest,
  freezeBoundedWorkValue,
  requireBoundedWorkDigest,
} from "./bounded-work-content.js";

export const FORMAL_PROOF_VERDICT_SCHEMA = "kiln.formal-proof-verdict/v2" as const;

/** Outcome of one proof obligation, or of a verdict as a whole. */
export type FormalProofOutcome = "proved" | "refuted" | "unresolved";

/** The toolchain that produced a verdict, recorded for replay and drift detection. */
export interface FormalProofVerifier {
  /** Verifier that discharged the obligations, such as `dafny` or `lean`. */
  readonly name: string;
  readonly version: string;
  /** Source-to-verifier translator, when the proof was not authored directly. */
  readonly translator?: { readonly name: string; readonly version: string };
}

/**
 * One property the verifier was asked to establish. `criterionId` binds the
 * obligation to a declared acceptance criterion so coverage stays auditable;
 * a proved obligation that maps to nothing satisfies no requirement.
 */
export interface FormalProofObligation {
  readonly id: string;
  readonly criterionId: string;
  readonly outcome: FormalProofOutcome;
  /** Counterexample or diagnostic. Required when the outcome is not `proved`. */
  readonly detail?: string;
}

/** One source the verifier ran against, named in the candidate's content namespace. */
export interface FormalProofSubject {
  readonly path: string;
  readonly contentDigest: string;
}

/**
 * Per-path content digests resolved from one candidate, carrying the content
 * digest of the candidate they were resolved from so a map cannot be applied
 * to a candidate it does not describe.
 *
 * This ties a digest map to *which* candidate it claims to describe; it does
 * not and cannot prove the map was actually derived from that candidate — core
 * is pure and has no git access. That derivation proof is a runtime concern
 * (the resolver recomputes the tree digest and requires it to match before
 * emitting this shape). The two checks are not redundant: this one rejects a
 * map asserted about the wrong candidate, the runtime one rejects a map that
 * lies about the right one.
 */
export interface CandidateSubjectDigests {
  /** `candidateContentDigest` of the candidate these were resolved from. */
  readonly candidateContentDigest: string;
  /** Content digest per candidate-relative POSIX path. */
  readonly digests: ReadonlyMap<string, string>;
}

export interface RecordFormalProofVerdictInput {
  readonly verifier: FormalProofVerifier;
  /** Every source the verifier ran against. At least one is required. */
  readonly subjects: readonly FormalProofSubject[];
  readonly obligations: readonly FormalProofObligation[];
  readonly producedAt: string;
}

export interface FormalProofVerdict {
  readonly schema: typeof FORMAL_PROOF_VERDICT_SCHEMA;
  readonly verifier: FormalProofVerifier;
  /** Sorted by path so `verdictDigest` is stable regardless of caller order. */
  readonly subjects: readonly FormalProofSubject[];
  readonly obligations: readonly FormalProofObligation[];
  readonly outcome: FormalProofOutcome;
  readonly producedAt: string;
  readonly verdictDigest: string;
}

/**
 * Normalize a verifier run into a digest-stable verdict.
 *
 * The overall outcome is derived, never supplied: a caller cannot declare a
 * verdict proved while carrying an unresolved obligation.
 */
export function recordFormalProofVerdict(input: RecordFormalProofVerdictInput): FormalProofVerdict {
  if (input.obligations.length === 0) {
    throw new Error("formal-proof verdict must declare at least one obligation");
  }
  if (input.subjects.length === 0) {
    throw new Error("formal-proof verdict must cover at least one subject");
  }
  const obligations = input.obligations.map(normalizeObligation);
  assertUniqueObligationIds(obligations);
  const subjects = normalizeSubjects(input.subjects);
  const verdict = {
    schema: FORMAL_PROOF_VERDICT_SCHEMA,
    verifier: normalizeVerifier(input.verifier),
    subjects,
    obligations,
    outcome: deriveOutcome(obligations),
    producedAt: requireTimestamp(input.producedAt, "producedAt"),
  };
  return freezeBoundedWorkValue({ ...verdict, verdictDigest: boundedWorkDigest(verdict) });
}

/**
 * Bind a verdict to the candidate it was produced against.
 *
 * First checks that `candidateSubjects` was resolved from this candidate, not
 * some other one — a caller-supplied map with no such tie would let evidence
 * for candidate A bind silently to candidate B. Then checks every subject the
 * verdict covers against the candidate's per-path digests, rather than the
 * candidate's whole-tree digest: a verifier's subject is one file, a
 * candidate is an entire git worktree, and a file digest never equals a tree
 * digest. Throws naming the first covered path that is missing from the
 * candidate or whose content has changed. A refuted or unresolved verdict
 * still binds: a negative result is evidence, and hiding it would let a
 * failed proof leave no trace.
 */
export function bindFormalProofEvidence(input: {
  readonly candidate: BoundedWorkCandidateIdentity;
  readonly candidateSubjects: CandidateSubjectDigests;
  readonly verdict: FormalProofVerdict;
  readonly recordedAt: string;
}): BoundedWorkCandidateEvidence {
  const candidateSubjectsDigest = requireBoundedWorkDigest(
    input.candidateSubjects.candidateContentDigest,
    "candidateSubjects.candidateContentDigest",
  );
  if (candidateSubjectsDigest !== input.candidate.candidateContentDigest) {
    throw new Error(
      "candidateSubjects were resolved from a different candidate than the one being bound",
    );
  }
  for (const subject of input.verdict.subjects) {
    const candidateDigest = input.candidateSubjects.digests.get(subject.path);
    if (candidateDigest === undefined) {
      throw new Error(
        `formal-proof verdict covers ${subject.path}, which is absent from the candidate`,
      );
    }
    if (candidateDigest !== subject.contentDigest) {
      throw new Error(
        `formal-proof verdict covers ${subject.path}, whose content changed after the proof ran`,
      );
    }
  }
  return bindBoundedWorkEvidence({
    candidate: input.candidate,
    kind: "verification",
    subjectCandidateDigest: input.candidate.candidateDigest,
    evidenceDigest: input.verdict.verdictDigest,
    recordedAt: input.recordedAt,
  });
}

/** Acceptance criteria left without a proved obligation, in declaration order. */
export function unprovenCriteria(
  verdict: FormalProofVerdict,
  criterionIds: readonly string[],
): readonly string[] {
  const proved = new Set(
    verdict.obligations.filter((o) => o.outcome === "proved").map((o) => o.criterionId),
  );
  return criterionIds.filter((criterionId) => !proved.has(criterionId));
}

function deriveOutcome(obligations: readonly FormalProofObligation[]): FormalProofOutcome {
  if (obligations.some((obligation) => obligation.outcome === "refuted")) return "refuted";
  if (obligations.some((obligation) => obligation.outcome === "unresolved")) return "unresolved";
  return "proved";
}

function normalizeObligation(obligation: FormalProofObligation): FormalProofObligation {
  const outcome = requireOutcome(obligation.outcome);
  const detail = obligation.detail?.trim();
  if (outcome !== "proved" && (detail === undefined || detail.length === 0)) {
    throw new Error(`obligation ${obligation.id} must record detail when it is not proved`);
  }
  return {
    id: requireText(obligation.id, "obligation.id"),
    criterionId: requireText(obligation.criterionId, "obligation.criterionId"),
    outcome,
    ...(detail === undefined || detail.length === 0 ? {} : { detail }),
  };
}

function normalizeSubjects(subjects: readonly FormalProofSubject[]): readonly FormalProofSubject[] {
  const normalized = subjects.map((subject) => ({
    path: requireSubjectPath(subject.path),
    contentDigest: requireBoundedWorkDigest(subject.contentDigest, "subject.contentDigest"),
  }));
  const seen = new Set<string>();
  for (const subject of normalized) {
    if (seen.has(subject.path)) {
      throw new Error(`duplicate subject path ${subject.path}`);
    }
    seen.add(subject.path);
  }
  return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

/** Rejects anything that could resolve outside the candidate it names paths in. */
function requireSubjectPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) throw new Error("subject path is required");
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

function assertUniqueObligationIds(obligations: readonly FormalProofObligation[]): void {
  const seen = new Set<string>();
  for (const obligation of obligations) {
    if (seen.has(obligation.id)) {
      throw new Error(`duplicate obligation id ${obligation.id}`);
    }
    seen.add(obligation.id);
  }
}

function normalizeVerifier(verifier: FormalProofVerifier): FormalProofVerifier {
  return {
    name: requireText(verifier.name, "verifier.name"),
    version: requireText(verifier.version, "verifier.version"),
    ...(verifier.translator === undefined
      ? {}
      : {
          translator: {
            name: requireText(verifier.translator.name, "verifier.translator.name"),
            version: requireText(verifier.translator.version, "verifier.translator.version"),
          },
        }),
  };
}

function requireOutcome(value: FormalProofOutcome): FormalProofOutcome {
  if (value !== "proved" && value !== "refuted" && value !== "unresolved") {
    throw new Error("outcome must be proved, refuted, or unresolved");
  }
  return value;
}

function requireTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO timestamp`);
  }
  return value;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} is required`);
  return normalized;
}
