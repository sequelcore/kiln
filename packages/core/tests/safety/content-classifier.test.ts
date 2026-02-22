import { describe, it, expect, vi } from "vitest";
import { ContentClassifier } from "../../src/safety/content-classifier.js";
import type { ContentConfig } from "../../src/engine/domain/safety-config.js";
import type { ContentDeepScanProvider } from "../../src/safety/content-classifier.js";

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

  describe("classifyDeep", () => {
    it("fail-open: provider throws, returns empty scores", async () => {
      const classifier = new ContentClassifier(makeConfig());
      const provider: ContentDeepScanProvider = {
        classify: vi.fn().mockRejectedValue(new Error("Service unavailable")),
      };
      const result = await classifier.classifyDeep("some text", provider);
      expect(result.scores).toHaveLength(0);
      expect(result.tier).toBe("deep");
    });
  });

  describe("classify (combined)", () => {
    it("merges heuristic and deep results, taking max confidence", async () => {
      const classifier = new ContentClassifier(makeConfig({ deepScan: true }));
      const provider: ContentDeepScanProvider = {
        classify: vi.fn().mockResolvedValue([
          { category: "hate", confidence: 0.9 },
        ]),
      };
      // "racist" will be caught by heuristic with weight 0.3
      const result = await classifier.classify("racist content", provider);
      expect(result.tier).toBe("deep");
      const hateScore = result.scores.find((s) => s.category === "hate");
      expect(hateScore).toBeDefined();
      // max of heuristic (0.3) and deep (0.9) = 0.9
      expect(hateScore!.confidence).toBe(0.9);
    });

    it("returns heuristic result when deepScan disabled", async () => {
      const classifier = new ContentClassifier(makeConfig({ deepScan: false }));
      const result = await classifier.classify("some text");
      expect(result.tier).toBe("heuristic");
    });
  });
});
