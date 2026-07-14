import { describe, expect, it } from "vitest";
import type { ProjectedContext } from "../context-types.js";
import { summarizeContextGovernance } from "../session-report.js";

describe("summarizeContextGovernance", () => {
  it("uses core context audit reasons instead of local inference when available", () => {
    const projectedContext: ProjectedContext = {
      blocks: [
        {
          id: "candidate:0",
          kind: "summary",
          source: "runtime-continuity",
          content: "summary",
          required: false,
          score: 80,
          estimatedTokens: 2,
        },
      ],
      deferredBlocks: [
        {
          id: "candidate:1",
          kind: "memory",
          source: "runtime-recalled-memory",
          content: "memory",
          required: false,
          score: 40,
          estimatedTokens: 2,
        },
      ],
      estimatedTokens: 2,
      tokenBudget: 2,
      overflow: true,
      auditTrail: [
        {
          governor: "DefaultContextGovernor",
          selectedBlockIds: ["candidate:0"],
          deferredBlockIds: ["candidate:1"],
          requiredBlockIds: [],
          preservedRequiredBlockIds: [],
          selectedTokens: 2,
          requiredTokens: 0,
          tokenBudget: 2,
          overflow: true,
          overflowReason: "budget-cap",
          allocationMode: "whole-block",
          positionProfile: "balanced",
          requiredOverflowPolicy: "admit-and-report",
          blocks: [
            {
              id: "candidate:0",
              kind: "summary",
              source: "runtime-continuity",
              required: false,
              estimatedTokens: 2,
              baseScore: 80,
              effectiveScore: 80,
              decision: "admitted",
              reason: "within-budget",
              order: 0,
            },
            {
              id: "candidate:1",
              kind: "memory",
              source: "runtime-recalled-memory",
              required: false,
              estimatedTokens: 2,
              baseScore: 40,
              effectiveScore: 40,
              decision: "deferred",
              reason: "budget-cap",
              order: 1,
            },
          ],
        },
      ],
    };

    expect(summarizeContextGovernance(projectedContext).deferredReasons).toEqual([
      "budget-cap",
    ]);
  });

  it("keeps the local deferred reason fallback when no core audit is present", () => {
    const projectedContext: ProjectedContext = {
      blocks: [],
      deferredBlocks: [
        {
          id: "candidate:1",
          kind: "memory",
          source: "runtime-recalled-memory",
          content: "memory",
          required: false,
          score: 40,
          estimatedTokens: 2,
        },
      ],
      estimatedTokens: 0,
      tokenBudget: 2,
      overflow: true,
    };

    expect(summarizeContextGovernance(projectedContext).deferredReasons).toEqual([
      "required-overflow",
      "lower-priority-memory",
    ]);
  });
});
