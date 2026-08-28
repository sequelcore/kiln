import { describe, expect, it } from "vitest";
import {
  assessCompletionEligibility,
  resolveRequiredProducerObligations,
  type CompletionObligation,
  type RequiredProducerEvidence,
} from "../../src/agents/completion-obligation.js";

const DIRECTIVE = "Use Gentle AI to review this change, Dafny to prove correctness, and Oxlint to analyze it.";

function obligation(
  canonicalToolId: string,
  sourceAlias = canonicalToolId,
  acceptedEquivalentToolIds: readonly string[] = [],
): CompletionObligation {
  return {
    kind: "required_producer",
    obligationId: `required-producer:${canonicalToolId}`,
    canonicalToolId,
    acceptedEquivalentToolIds,
    sourceAlias,
  };
}

function evidence(
  canonicalProducerId: string,
  status: RequiredProducerEvidence["status"] = "accepted",
): RequiredProducerEvidence {
  return {
    canonicalProducerId,
    status,
    ...(status === "accepted"
      ? {
        evidenceReferences: [{
          toolCallScopeId: `${canonicalProducerId}:scope`,
          toolCallId: `${canonicalProducerId}:call`,
        }],
      }
      : {}),
  };
}

describe("required producer completion obligations", () => {
  it("resolves the positive directive to all three canonical producers", () => {
    expect(resolveRequiredProducerObligations(DIRECTIVE)).toEqual([
      obligation("gentle_review", "Gentle AI"),
      obligation("formal_verify", "Dafny"),
      obligation("static_analyze", "Oxlint"),
    ]);
  });

  it("does not turn a negated producer instruction into an obligation", () => {
    expect(resolveRequiredProducerObligations("Do not use Dafny")).toEqual([]);
  });

  it("does not treat bare Gentle as a producer alias in ordinary prose", () => {
    expect(resolveRequiredProducerObligations("Use gentle language in the answer.")).toEqual([]);
  });

  it("retains the unambiguous Gentle AI producer alias", () => {
    expect(resolveRequiredProducerObligations("Use Gentle AI to review this change.")).toEqual([
      obligation("gentle_review", "Gentle AI"),
    ]);
  });

  it("recognizes apostrophe negation and keeps mixed clauses scoped", () => {
    expect(resolveRequiredProducerObligations("Don't use Dafny")).toEqual([]);
    expect(resolveRequiredProducerObligations("Use Dafny, but do not use Oxlint")).toEqual([
      obligation("formal_verify", "Dafny"),
    ]);
  });

  it("does not turn an informational availability question into obligations", () => {
    expect(resolveRequiredProducerObligations("Are Dafny and Oxlint available?")).toEqual([]);
  });

  it("deduplicates aliases by canonical producer identity", () => {
    expect(resolveRequiredProducerObligations("Use Dafny, Dafny, and Gentle AI, Gentle."))
      .toEqual([
        obligation("formal_verify", "Dafny"),
        obligation("gentle_review", "Gentle AI"),
      ]);
  });

  it("is eligible only when every obligation has accepted evidence", () => {
    const obligations = resolveRequiredProducerObligations(DIRECTIVE);
    expect(assessCompletionEligibility(obligations, [
      evidence("gentle_review"),
      evidence("formal_verify"),
      evidence("static_analyze"),
    ])).toEqual({ status: "eligible" });
  });

  it.each([
    ["unavailable", "unavailable"],
    ["not run", "not_run"],
    ["execution failure", "execution_failed"],
    ["invalid evidence", "invalid_evidence"],
  ] as const)("returns a typed unmet item for %s evidence", (_label, status) => {
    const required = obligation("formal_verify", "Dafny");
    const result = assessCompletionEligibility([required], [evidence("formal_verify", status)]);

    expect(result).toEqual({
      status: "ineligible",
      unmet: [{
        obligationId: required.obligationId,
        canonicalToolId: required.canonicalToolId,
        sourceAlias: required.sourceAlias,
        status,
        evidence: evidence("formal_verify", status),
      }],
    });
  });

  it("rejects accepted evidence produced by Bash or another noncanonical producer", () => {
    const required = obligation("formal_verify", "Dafny");

    expect(assessCompletionEligibility([required], [evidence("bash")])).toEqual({
      status: "ineligible",
      unmet: [{
        obligationId: required.obligationId,
        canonicalToolId: required.canonicalToolId,
        sourceAlias: required.sourceAlias,
        status: "not_run",
      }],
    });
  });

  it("accepts an explicitly listed equivalent producer without accepting arbitrary producers", () => {
    const required = obligation("formal_verify", "Dafny", ["formal_verify_proxy"]);

    expect(assessCompletionEligibility([required], [evidence("formal_verify_proxy")]))
      .toEqual({ status: "eligible" });
    expect(assessCompletionEligibility([required], [evidence("bash")]).status).toBe("ineligible");
  });

  it("rejects accepted evidence without a complete scoped tool identity", () => {
    const required = obligation("formal_verify", "Dafny");

    expect(assessCompletionEligibility([required], [{
      canonicalProducerId: "formal_verify",
      status: "accepted",
    }])).toEqual({
      status: "ineligible",
      unmet: [{
        obligationId: required.obligationId,
        canonicalToolId: required.canonicalToolId,
        sourceAlias: required.sourceAlias,
        status: "invalid_evidence",
        evidence: {
          canonicalProducerId: "formal_verify",
          status: "accepted",
        },
      }],
    });
  });

  it("does not use model text as completion evidence", () => {
    const required = obligation("formal_verify", "Dafny");

    expect(assessCompletionEligibility([required], [])).toEqual({
      status: "ineligible",
      unmet: [{
        obligationId: required.obligationId,
        canonicalToolId: required.canonicalToolId,
        sourceAlias: required.sourceAlias,
        status: "not_run",
      }],
    });
  });
});
