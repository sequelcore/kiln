import type { KilnWorkGovernanceEvidence } from "./evidence.js";

/**
 * Roadmap 01 (External Runtime Governance), Slice 1 - Evidence Realization
 * Contract. Provider-neutral mapping from canonical evidence requirements to
 * admitted capability realizations. Route-declared realizations take
 * precedence; the default table below preserves exact pre-Slice-1 behavior
 * for routes that declare nothing of their own (ordinary shell/browser
 * capable routes keep working unchanged). Evidence not present in either
 * table requires no tool at all and always passes through - most evidence
 * ids (e.g. "plan", "residual-risk") were never tool-gated.
 */
const DEFAULT_EVIDENCE_REALIZATION: Partial<Record<KilnWorkGovernanceEvidence, readonly string[]>> = {
  tests: ["bash"],
  typecheck: ["bash"],
  "visual-reference-research": ["read", "glob", "grep"],
  "browser-qa": ["browser_session_start", "browser_navigate", "browser_observe"],
};

export interface EvidenceRealizationCapabilityPause {
  readonly status: "capability_pause";
  /** Evidence this route can realize with neither its own declared tools nor the default realization. */
  readonly unrealizedEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly routeId: string;
  /** What the route declared, for operator diagnosis. */
  readonly declaredRealizations: Readonly<Record<string, readonly string[]>>;
  /** What the route actually admits, for operator diagnosis. */
  readonly admittedToolNames: readonly string[];
  readonly reason: string;
}

export interface EvidenceRealizationResolved {
  readonly ok: true;
  readonly requiredToolNames: readonly string[];
}

export interface EvidenceRealizationPaused {
  readonly ok: false;
  readonly pause: EvidenceRealizationCapabilityPause;
}

export type EvidenceRealizationResult = EvidenceRealizationResolved | EvidenceRealizationPaused;

export interface ResolveEvidenceRealizationInput {
  readonly routeId: string;
  readonly expectedEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly declaredRealizations?: Partial<Record<KilnWorkGovernanceEvidence, readonly string[]>>;
  readonly admittedToolNames: readonly string[];
}

/**
 * Resolve which tools a route must have available to realize the given
 * evidence, or fail closed with a precise capability pause. Never silently
 * substitutes weaker evidence: a realization is only accepted when every
 * one of its listed tools is actually admitted by the route (closes the
 * drift risk between a route's own `allowedToolNames` and its
 * `evidenceRealizations` declaration).
 */
export function resolveEvidenceRealization(
  input: ResolveEvidenceRealizationInput,
): EvidenceRealizationResult {
  const admitted = new Set(input.admittedToolNames);
  const requiredToolNames = new Set<string>();
  const unrealizedEvidence: KilnWorkGovernanceEvidence[] = [];

  for (const evidence of input.expectedEvidence) {
    const declared = input.declaredRealizations?.[evidence];

    if (declared !== undefined) {
      // The route explicitly declared intent for this evidence id. Honor
      // only that declaration - a failed explicit declaration signals a
      // real misconfiguration (drift, typo) and must fail closed, never
      // silently fall through to the generic default behind the route's
      // back.
      if (declared.length > 0 && declared.every((tool) => admitted.has(tool))) {
        for (const tool of declared) requiredToolNames.add(tool);
        continue;
      }
      unrealizedEvidence.push(evidence);
      continue;
    }

    const fallback = DEFAULT_EVIDENCE_REALIZATION[evidence];
    if (!fallback) {
      // No tool-based realization concept exists for this evidence id at
      // all (e.g. "plan", "residual-risk") - nothing to require.
      continue;
    }

    if (fallback.every((tool) => admitted.has(tool))) {
      for (const tool of fallback) requiredToolNames.add(tool);
      continue;
    }

    unrealizedEvidence.push(evidence);
  }

  if (unrealizedEvidence.length > 0) {
    return {
      ok: false,
      pause: {
        status: "capability_pause",
        unrealizedEvidence,
        routeId: input.routeId,
        declaredRealizations: input.declaredRealizations ?? {},
        admittedToolNames: input.admittedToolNames,
        reason: `Route '${input.routeId}' has no admitted realization for: ${unrealizedEvidence.join(", ")}.`,
      },
    };
  }

  return { ok: true, requiredToolNames: [...requiredToolNames] };
}
