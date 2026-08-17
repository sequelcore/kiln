import { describe, expect, it } from "vitest";
import {
  DefaultContextGovernor,
  MemoryArtifactResourceStore,
  ReversibleContextProjectionService,
  type ContextCandidate,
  type ContextUtilitySignals,
  type LogArtifact,
} from "../../src/index.js";

const LOW_VALUE: ContextUtilitySignals = {
  semanticRelevance: 0.8,
  authorityValue: 0,
  verificationValue: 0,
  recency: 0,
  novelty: 0,
  retrievalCost: 1,
  redundancy: 1,
  taskPhases: ["orient"],
};

const VERIFY_VALUE: ContextUtilitySignals = {
  semanticRelevance: 0.75,
  authorityValue: 0.5,
  verificationValue: 1,
  recency: 1,
  novelty: 1,
  retrievalCost: 0.1,
  redundancy: 0,
  taskPhases: ["verify"],
};

describe("context utility allocation", () => {
  it("uses auditable multi-signal utility while required context remains score-independent", () => {
    const governor = new DefaultContextGovernor();
    const content = "x".repeat(400);
    const result = governor.project({
      artifacts: [
        candidate("required-authority", content, 0, LOW_VALUE, true),
        candidate("stale-redundant", content, 100, LOW_VALUE),
        candidate("verification-evidence", content, 1, VERIFY_VALUE),
      ],
      tokenBudget: 210,
      contextUtilityPolicy: "context-utility-v1",
      taskPhase: "verify",
    });

    expect(result.blocks.map((block) => block.source)).toEqual([
      "required-authority",
      "verification-evidence",
    ]);
    expect(result.deferredBlocks?.map((block) => block.source)).toEqual(["stale-redundant"]);
    expect(result.auditTrail?.[0]).toMatchObject({
      utilityPolicyId: "context-utility-v1",
      allocationMode: "whole-block",
      positionProfile: "balanced",
      requiredOverflowPolicy: "admit-and-report",
    });
    expect(result.auditTrail?.[0]!.blocks.find((block) => block.source === "verification-evidence")?.utilityEvidence)
      .toMatchObject({
        policyId: "context-utility-v1",
        taskPhase: "verify",
        verificationValue: 1,
        phaseMatch: 1,
      });
  });

  it("compares whole-block, segmented, and retrieval-on-demand allocations through the same governor", () => {
    const governor = new DefaultContextGovernor();
    const relevant = "R".repeat(400);
    const noise = "N".repeat(400);
    const segmentedCandidate: ContextCandidate = {
      kind: "artifact",
      source: "segmented-artifact",
      content: relevant + noise,
      score: 0.5,
      utilitySignals: LOW_VALUE,
      segments: [{ id: "relevant", content: relevant, utilitySignals: VERIFY_VALUE }, {
        id: "noise",
        content: noise,
        utilitySignals: LOW_VALUE,
      }],
    };

    const whole = governor.project({
      artifacts: [segmentedCandidate],
      tokenBudget: 120,
      contextUtilityPolicy: "context-utility-v1",
      taskPhase: "verify",
      contextAllocationMode: "whole-block",
    });
    const segmented = governor.project({
      artifacts: [segmentedCandidate],
      tokenBudget: 120,
      contextUtilityPolicy: "context-utility-v1",
      taskPhase: "verify",
      contextAllocationMode: "segmented",
    });

    expect(whole.blocks).toEqual([]);
    expect(segmented.blocks).toHaveLength(1);
    expect(segmented.blocks[0]).toMatchObject({ source: "segmented-artifact", segmentId: "relevant" });
    expect(segmented.estimatedTokens).toBeLessThan(whole.deferredBlocks?.[0]?.estimatedTokens ?? Infinity);

    const projectionService = new ReversibleContextProjectionService({ store: new MemoryArtifactResourceStore() });
    const reversibleCandidate = projectionService.createContextCandidate({
      artifact: largeLog(),
      source: "retrieval-artifact",
      score: 0.5,
    });
    const full = governor.project({
      artifacts: [reversibleCandidate],
      tokenBudget: 200,
      contextAllocationMode: "whole-block",
    });
    const retrieval = governor.project({
      artifacts: [reversibleCandidate],
      tokenBudget: 200,
      contextAllocationMode: "retrieval-on-demand",
    });
    expect(full.blocks).toEqual([]);
    expect(retrieval.blocks[0]?.projectionEvidence?.mode).toBe("reversible");
    expect(retrieval.estimatedTokens).toBeLessThan(full.deferredBlocks?.[0]?.estimatedTokens ?? Infinity);
  });

  it("uses declared overflow and position policies", () => {
    const governor = new DefaultContextGovernor();
    const required = candidate("required", "r".repeat(800), 1, VERIFY_VALUE, true);
    expect(() => governor.project({
      artifacts: [required],
      tokenBudget: 10,
      requiredOverflowPolicy: "reject",
    })).toThrow("Required context exceeds the declared token budget");

    const positioned = governor.project({
      artifacts: [
        candidate("first", "1".repeat(40), 30, VERIFY_VALUE),
        candidate("second", "2".repeat(40), 20, VERIFY_VALUE),
        candidate("third", "3".repeat(40), 10, VERIFY_VALUE),
      ],
      tokenBudget: 100,
      contextPositionProfile: "edge-biased",
    });
    expect(positioned.blocks.map((block) => block.source)).toEqual(["first", "third", "second"]);
    expect(positioned.auditTrail?.[0]!.positionProfile).toBe("edge-biased");
  });
});

function candidate(
  source: string,
  content: string,
  score: number,
  utilitySignals: ContextUtilitySignals,
  required = false,
): ContextCandidate {
  return { kind: "artifact", source, content, score, utilitySignals, required };
}

function largeLog(): LogArtifact {
  return {
    kind: "log",
    exitStatus: 0,
    warnings: [],
    entries: Array.from({ length: 30 }, (_, index) => ({
      id: `log-${index}`,
      severity: "info" as const,
      message: `large log message ${index} ${"data ".repeat(10)}`,
      timestamp: null,
      source: "test",
      line: index,
    })),
  };
}
