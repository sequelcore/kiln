import {
  TOOL_CATALOG_OBLIGATION_ALIASES,
  type ToolCatalogAlias,
} from "../tools/domain/tool-catalog.js";

export type RequiredProducerEvidenceStatus =
  | "accepted"
  | "unavailable"
  | "not_run"
  | "execution_failed"
  | "invalid_evidence";

/** A completion requirement whose producer identity is fixed by the Core catalog. */
export type CompletionObligation = {
  readonly kind: "required_producer";
  readonly obligationId: string;
  readonly canonicalToolId: string;
  readonly acceptedEquivalentToolIds: readonly string[];
  readonly sourceAlias: string;
};

/** Canonical identity of one Runtime tool execution used as producer evidence. */
export interface RequiredProducerEvidenceReference {
  readonly toolCallScopeId: string;
  readonly toolCallId: string;
}

/** Facts about one attempted producer; prose or model claims are not evidence. */
export interface RequiredProducerEvidence {
  readonly canonicalProducerId: string;
  readonly status: RequiredProducerEvidenceStatus;
  readonly evidenceReferences?: readonly RequiredProducerEvidenceReference[];
}

export type CompletionObligationUnmetStatus = Exclude<RequiredProducerEvidenceStatus, "accepted">;

export interface CompletionObligationUnmet {
  readonly obligationId: string;
  readonly canonicalToolId: string;
  readonly sourceAlias: string;
  readonly status: CompletionObligationUnmetStatus;
  readonly evidence?: RequiredProducerEvidence;
}

export type CompletionEligibility =
  | { readonly status: "eligible" }
  | { readonly status: "ineligible"; readonly unmet: readonly CompletionObligationUnmet[] };

interface AliasMatch {
  readonly alias: ToolCatalogAlias;
  readonly start: number;
  readonly length: number;
}

const USE_WORD = /\buse\b/giu;
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+|\r?\n/u;
const NEGATED_USE_AT_END = /(?:\bdo\s+not|\bdon(?:\u0027|\u2019)t|\bnever)\s+$/iu;

/**
 * Resolve only explicit imperative `use` clauses. This intentionally does not
 * attempt general language understanding: questions and negated clauses do not
 * create completion obligations.
 */
export function resolveRequiredProducerObligations(text: string): readonly CompletionObligation[] {
  const obligations: CompletionObligation[] = [];
  const seenCanonicalIds = new Set<string>();

  for (const segment of text.split(SENTENCE_BOUNDARY)) {
    if (segment.includes("?")) continue;

    const useMatches = [...segment.matchAll(USE_WORD)]
      .flatMap((match) => match.index === undefined ? [] : [{ index: match.index }]);
    if (useMatches.length === 0) continue;

    const positiveUseMatches = useMatches.filter(({ index }) => !isNegatedUse(segment, index));
    if (positiveUseMatches.length === 0) continue;

    for (const match of findAliasMatches(segment)) {
      const precedingUse = useMatches
        .filter(({ index }) => index <= match.start)
        .at(-1);
      if (precedingUse === undefined || isNegatedUse(segment, precedingUse.index)) continue;

      const canonicalToolId = match.alias.canonicalName;
      if (seenCanonicalIds.has(canonicalToolId)) continue;
      seenCanonicalIds.add(canonicalToolId);
      obligations.push({
        kind: "required_producer",
        obligationId: `required-producer:${canonicalToolId}`,
        canonicalToolId,
        acceptedEquivalentToolIds: [],
        sourceAlias: match.alias.alias,
      });
    }
  }

  return obligations;
}

/**
 * Evaluate producer evidence by exact canonical identity (or an explicitly
 * listed equivalent). Any accepted evidence from another producer is invalid.
 */
export function assessCompletionEligibility(
  obligations: readonly CompletionObligation[],
  evidence: readonly RequiredProducerEvidence[],
): CompletionEligibility {
  const unmet = obligations.flatMap((obligation) => {
    const matchingEvidence = evidence.filter((item) =>
      item.canonicalProducerId === obligation.canonicalToolId
      || obligation.acceptedEquivalentToolIds.includes(item.canonicalProducerId),
    );
    const acceptedEvidence = matchingEvidence.find((item) =>
      item.status === "accepted" && hasValidEvidenceReferences(item.evidenceReferences),
    );
    if (acceptedEvidence !== undefined) return [];

    const invalidAcceptedEvidence = matchingEvidence.find((item) => item.status === "accepted");
    if (invalidAcceptedEvidence !== undefined) {
      return [unmetItem(obligation, "invalid_evidence", invalidAcceptedEvidence)];
    }

    const failedEvidence = matchingEvidence[0];
    if (failedEvidence !== undefined) {
      return [unmetItem(obligation, failedEvidence.status, failedEvidence)];
    }

    return [unmetItem(obligation, "not_run")];
  });

  return unmet.length === 0
    ? { status: "eligible" }
    : { status: "ineligible", unmet };
}

function hasValidEvidenceReferences(
  references: readonly RequiredProducerEvidenceReference[] | undefined,
): boolean {
  if (!Array.isArray(references) || references.length === 0) return false;
  return references.every((reference) => (
    reference !== null
    && typeof reference === "object"
    && !Array.isArray(reference)
    && typeof reference.toolCallScopeId === "string"
    && reference.toolCallScopeId.trim().length > 0
    && typeof reference.toolCallId === "string"
    && reference.toolCallId.trim().length > 0
  ));
}

function findAliasMatches(text: string): readonly AliasMatch[] {
  const matches: AliasMatch[] = [];
  for (const alias of TOOL_CATALOG_OBLIGATION_ALIASES) {
    const pattern = new RegExp(`\\b${escapeRegExp(alias.alias)}\\b`, "giu");
    for (const match of text.matchAll(pattern)) {
      if (match.index !== undefined) {
        matches.push({ alias, start: match.index, length: match[0].length });
      }
    }
  }

  return matches.sort((left, right) =>
    left.start - right.start
    || right.length - left.length
    || left.alias.alias.localeCompare(right.alias.alias),
  );
}

function isNegatedUse(segment: string, useIndex: number): boolean {
  return NEGATED_USE_AT_END.test(segment.slice(0, useIndex));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function unmetItem(
  obligation: CompletionObligation,
  status: RequiredProducerEvidenceStatus,
  evidence?: RequiredProducerEvidence,
): CompletionObligationUnmet {
  const unmetStatus: CompletionObligationUnmetStatus = status === "accepted" ? "invalid_evidence" : status;
  return {
    obligationId: obligation.obligationId,
    canonicalToolId: obligation.canonicalToolId,
    sourceAlias: obligation.sourceAlias,
    status: unmetStatus,
    ...(evidence === undefined ? {} : { evidence }),
  };
}
