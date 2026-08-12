import { describe, expect, it } from "vitest";
import { projectOperatorGovernedWorkItemSnapshot } from "../src/operator-governed-work.js";

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

describe("operator governed work projection", () => {
  it("projects canonical bounded-work evidence without recomputing authority", () => {
    const projected = projectOperatorGovernedWorkItemSnapshot({
      workItem: {
        id: "work-1",
        summary: "Bound work.",
        status: "blocked",
        workflowProfile: "architecture-change",
        authorityProfile: "foundation-apply-approved-writes",
        boundedWork: {
          contractRevisionDigest: sha("a"),
          candidateDigest: sha("b"),
          accounting: {
            revision: 4,
            executionAttempts: { used: 2, limit: 2 },
            managedInvocations: { used: 1, active: 1, limit: 1 },
            toolCalls: { kind: "unknown", limit: 10 },
          },
          decision: {
            kind: "pause_budget_exhausted",
            exhaustedLimits: ["execution_attempts"],
            continuation: {
              action: "request_budget_revision",
              accountingRevision: 4,
            },
          },
        },
      },
      observedAt: "2026-08-12T18:00:00.000Z",
    });

    expect(projected?.boundedWork).toEqual({
      contractRevisionDigest: sha("a"),
      candidateDigest: sha("b"),
      accounting: {
        revision: 4,
        executionAttempts: { used: 2, limit: 2 },
        managedInvocations: { used: 1, active: 1, limit: 1 },
        toolCalls: { kind: "unknown", limit: 10 },
      },
      decision: {
        kind: "pause_budget_exhausted",
        exhaustedLimits: ["execution_attempts"],
        continuation: { action: "request_budget_revision", accountingRevision: 4 },
      },
    });
  });

  it("rejects malformed bounded-work evidence instead of presenting synthetic zero", () => {
    const projected = projectOperatorGovernedWorkItemSnapshot({
      workItem: {
        id: "work-1",
        summary: "Bound work.",
        status: "blocked",
        workflowProfile: "architecture-change",
        authorityProfile: "foundation-apply-approved-writes",
        boundedWork: {
          contractRevisionDigest: sha("a"),
          accounting: {
            revision: 1,
            toolCalls: { kind: "unknown", value: 0, limit: 10 },
          },
          decision: { kind: "admitted" },
        },
      },
      observedAt: "2026-08-12T18:00:00.000Z",
    });
    expect(projected?.boundedWork).toBeUndefined();
  });
});
