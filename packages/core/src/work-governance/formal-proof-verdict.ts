/**
 * Deterministic-verifier verdicts admitted as bounded-work evidence.
 *
 * A verdict records what a formal verifier proved, about which exact source,
 * with which toolchain. It is inert on its own: it carries no completion
 * authority and does not decide acceptance. Binding it to a candidate is what
 * makes it evidence, and the work-governance boundary decides whether that
 * evidence satisfies the contract.
 *
 * Two properties are load-bearing:
 *
 * - A verdict names the content it was produced against. Evidence bound to a
 *   candidate whose content has since changed is rejected rather than reused,
 *   so a proof cannot outlive the code it proved.
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

export const FORMAL_PROOF_VERDICT_SCHEMA = "kiln.formal-proof-verdict/v1" as const;

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

export interface RecordFormalProofVerdictInput {
  readonly verifier: FormalProofVerifier;
  /** Content digest of the exact source the verifier ran against. */
  readonly subjectContentDigest: string;
  readonly obligations: readonly FormalProofObligation[];
  readonly producedAt: string;
}

export interface FormalProofVerdict {
  readonly schema: typeof FORMAL_PROOF_VERDICT_SCHEMA;
  readonly verifier: FormalProofVerifier;
  readonly subjectContentDigest: string;
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
  const obligations = input.obligations.map(normalizeObligation);
  assertUniqueObligationIds(obligations);
  const verdict = {
    schema: FORMAL_PROOF_VERDICT_SCHEMA,
    verifier: normalizeVerifier(input.verifier),
    subjectContentDigest: requireBoundedWorkDigest(
      input.subjectContentDigest,
      "subjectContentDigest",
    ),
    obligations,
    outcome: deriveOutcome(obligations),
    producedAt: requireTimestamp(input.producedAt, "producedAt"),
  };
  return freezeBoundedWorkValue({ ...verdict, verdictDigest: boundedWorkDigest(verdict) });
}

/**
 * Bind a verdict to the candidate it was produced against.
 *
 * Rejects a verdict whose subject content differs from the candidate's, which
 * is the case where the source changed after the proof ran. A refuted or
 * unresolved verdict still binds: a negative result is evidence, and hiding it
 * would let a failed proof leave no trace.
 */
export function bindFormalProofEvidence(input: {
  readonly candidate: BoundedWorkCandidateIdentity;
  readonly verdict: FormalProofVerdict;
  readonly recordedAt: string;
}): BoundedWorkCandidateEvidence {
  if (input.verdict.subjectContentDigest !== input.candidate.candidateContentDigest) {
    throw new Error("formal-proof verdict subject does not match candidate content");
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
