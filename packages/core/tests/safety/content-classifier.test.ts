import { describe, it, expect } from "vitest";
import { ContentClassifier } from "../../src/safety/content-classifier.js";
import type { ContentConfig } from "../../src/engine/domain/safety-config.js";

function makeConfig(overrides: Partial<ContentConfig> = {}): ContentConfig {
  return {
    enabled: true,
    categories: {
      hate: { threshold: 0.5, action: "block" },
      violence: { threshold: 0.5, action: "warn" },
    },
    ...overrides,
  };
}

describe("ContentClassifier", () => {
  describe("classifyHeuristic", () => {
    it("detects hate speech patterns", () => {
      const classifier = new ContentClassifier(makeConfig());
      const result = classifier.classifyHeuristic("That is hate speech and racist behavior.");
      const hateScore = result.scores.find((s) => s.category === "hate");
      expect(hateScore).toBeDefined();
      expect(hateScore!.confidence).toBeGreaterThan(0);
    });

    it("detects violence patterns", () => {
      const classifier = new ContentClassifier(makeConfig());
      const result = classifier.classifyHeuristic("I will kill and murder you with a weapon.");
      const violenceScore = result.scores.find((s) => s.category === "violence");
      expect(violenceScore).toBeDefined();
      expect(violenceScore!.confidence).toBeGreaterThan(0);
    });

    it("returns empty scores for clean text", () => {
      const classifier = new ContentClassifier(makeConfig());
      const result = classifier.classifyHeuristic("Hello, how can I help you today?");
      expect(result.scores).toHaveLength(0);
    });

    it("confidence is capped at 1.0", () => {
      const classifier = new ContentClassifier(makeConfig());
      // Many violence keywords to force high match count
      const text = "kill kill kill murder murder murder assault weapon threat";
      const result = classifier.classifyHeuristic(text);
      const violenceScore = result.scores.find((s) => s.category === "violence");
      expect(violenceScore).toBeDefined();
      expect(violenceScore!.confidence).toBeLessThanOrEqual(1.0);
    });

    it("returns tier 'heuristic'", () => {
      const classifier = new ContentClassifier(makeConfig());
      const result = classifier.classifyHeuristic("Some text");
      expect(result.tier).toBe("heuristic");
    });
  });

  describe("evaluateThresholds", () => {
    it("returns violations above threshold", () => {
      const classifier = new ContentClassifier(makeConfig({
        categories: { hate: { threshold: 0.2, action: "block" } },
      }));
      const violations = classifier.evaluateThresholds([
        { category: "hate", confidence: 0.5 },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.category).toBe("hate");
      expect(violations[0]!.action).toBe("block");
    });

    it("ignores categories below threshold", () => {
      const classifier = new ContentClassifier(makeConfig({
        categories: { hate: { threshold: 0.8, action: "block" } },
      }));
      const violations = classifier.evaluateThresholds([
        { category: "hate", confidence: 0.3 },
      ]);
      expect(violations).toHaveLength(0);
    });

    it("ignores unconfigured categories", () => {
      const classifier = new ContentClassifier(makeConfig({
        categories: {},
      }));
      const violations = classifier.evaluateThresholds([
        { category: "violence", confidence: 0.9 },
      ]);
      expect(violations).toHaveLength(0);
    });
  });

  it("classify remains deterministic", async () => {
    const classifier = new ContentClassifier(makeConfig());
    const result = await classifier.classify("racist content");
    expect(result.tier).toBe("heuristic");
    expect(result.scores.some((score) => score.category === "hate")).toBe(true);
  });
});
