import { describe, expect, it } from "vitest";
import {
  canonicalTurnId,
  createOperatorAdoptionDecisionAuthority,
  deterministicOperatorAdoptionDecisionId,
  parseCanonicalTurnId,
} from "../../src/events/operator-adoption-decision.js";

describe("operator adoption decision identity", () => {
  it("parses only positive canonical turn ordinals", () => {
    expect(parseCanonicalTurnId("session-1:turn:7", "session-1")).toBe(7);
    expect(parseCanonicalTurnId("session-1:turn:0", "session-1")).toBeUndefined();
    expect(parseCanonicalTurnId("session-1:turn:7x", "session-1")).toBeUndefined();
    expect(parseCanonicalTurnId("other:turn:7", "session-1")).toBeUndefined();
  });

  it("derives a deterministic authority from the session and canonical turn", () => {
    const turnId = canonicalTurnId("session-1", 3);
    const authority = createOperatorAdoptionDecisionAuthority({
      ownerSessionId: "session-1",
      operatorTurnId: turnId,
      actorId: "operator-1",
    });
    expect(authority).toEqual({
      ownerSessionId: "session-1",
      operatorTurnId: turnId,
      decisionId: deterministicOperatorAdoptionDecisionId("session-1", turnId),
      contractAuthority: {
        kind: "operator",
        actorId: "operator-1",
        decisionId: deterministicOperatorAdoptionDecisionId("session-1", turnId),
      },
    });
  });
});
