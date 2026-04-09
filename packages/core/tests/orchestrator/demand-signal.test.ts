import { describe, it, expect } from "vitest";
import type { ComplexityScore } from "../../src/engine/domain/model-router.js";
import { inferCategory, buildTaskDemand } from "../../src/orchestrator/demand-signal.js";
import type { TaskDemand } from "../../src/orchestrator/threshold-allocator.js";

describe("demand-signal", () => {
  const makeComplexity = (signals: {
    hasCodeBlocks?: boolean;
    hasTools?: boolean;
    hasReasoningMarkers?: boolean;
  }): ComplexityScore => ({
    score: 0.5,
    class: "moderate",
    signals: {
      tokenCount: 100,
      toolCount: signals.hasTools ? 1 : 0,
      hasTools: signals.hasTools ?? false,
      hasCodeBlocks: signals.hasCodeBlocks ?? false,
      hasReasoningMarkers: signals.hasReasoningMarkers ?? false,
      turnDepth: 0,
    },
  });

  describe("inferCategory", () => {
    it("hasCodeBlocks + hasTools → code", () => {
      const result = inferCategory(makeComplexity({ hasCodeBlocks: true, hasTools: true }));
      expect(result).toBe("code");
    });

    it("hasCodeBlocks only → review", () => {
      const result = inferCategory(makeComplexity({ hasCodeBlocks: true, hasTools: false }));
      expect(result).toBe("review");
    });

    it("hasReasoningMarkers only → research", () => {
      const result = inferCategory(makeComplexity({ hasCodeBlocks: false, hasReasoningMarkers: true }));
      expect(result).toBe("research");
    });

    it("hasTools only (no code, no reasoning) → ops", () => {
      const result = inferCategory(makeComplexity({ hasTools: true, hasCodeBlocks: false, hasReasoningMarkers: false }));
      expect(result).toBe("ops");
    });

    it("no signals → general", () => {
      const result = inferCategory(makeComplexity({}));
      expect(result).toBe("general");
    });
  });

  describe("buildTaskDemand", () => {
    it("uses complexity.score as demand", () => {
      const complexity: ComplexityScore = {
        score: 0.75,
        class: "complex",
        signals: {
          tokenCount: 100,
          hasTools: false,
          toolCount: 0,
          hasCodeBlocks: false,
          hasReasoningMarkers: false,
          turnDepth: 0,
        },
      };
      const result = buildTaskDemand(complexity);

      expect(result.demand).toBe(0.75);
    });

    it("with explicitCategory overrides inference", () => {
      const complexity = makeComplexity({ hasCodeBlocks: true, hasTools: true });
      const result = buildTaskDemand(complexity, "writing");

      expect(result.category).toBe("writing");
      expect(result.demand).toBe(0.5);
    });

    it("returns correct TaskDemand shape", () => {
      const complexity = makeComplexity({});
      const result = buildTaskDemand(complexity);

      expect(result).toHaveProperty("category");
      expect(result).toHaveProperty("demand");
      expect(typeof result.category).toBe("string");
      expect(typeof result.demand).toBe("number");
    });

    it("infers category when no explicitCategory provided", () => {
      const complexity = makeComplexity({ hasCodeBlocks: true, hasTools: true });
      const result = buildTaskDemand(complexity);

      expect(result.category).toBe("code");
    });
  });
});
