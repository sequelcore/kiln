// Tests for createScorer

import { describe, it, expect } from "vitest";
import { createScorer } from "../../src/eval/scorer-factory.js";
import type { EvalScorerConfig, EvalScorerType } from "../../src/engine/domain/eval-config.js";
import { KilnError } from "../../src/engine/errors.js";
import type { ScorerLLM } from "../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  async evaluate(): Promise<string> {
    return "SCORE: 0.5\nREASONING: Test";
  }
}

describe("createScorer", () => {
  it("creates exact-match scorer", () => {
    const config: EvalScorerConfig = { name: "em", type: "exact-match" };
    const scorer = createScorer(config);
    expect(scorer.name).toBe("exact-match");
  });

  it("creates contains scorer with substrings", () => {
    const config: EvalScorerConfig = { name: "cont", type: "contains", substrings: ["a", "b"] };
    const scorer = createScorer(config);
    expect(scorer.name).toBe("contains");
  });

  it("creates composite scorer recursively", () => {
    const config: EvalScorerConfig = {
      name: "comp",
      type: "composite",
      scorers: [
        { name: "em", type: "exact-match" },
        { name: "cont", type: "contains", substrings: ["x"] },
      ],
    };
    const scorer = createScorer(config);
    expect(scorer.name).toBe("comp");
  });

  it("throws EVAL_SCORER_FAILED for unknown type", () => {
    const config = { name: "bad", type: "unknown" as unknown as EvalScorerType };
    expect(() => createScorer(config)).toThrow(KilnError);
    try {
      createScorer(config);
    } catch (e) {
      expect((e as KilnError).code).toBe("EVAL_SCORER_FAILED");
    }
  });

  it("throws EVAL_SCORER_FAILED for LLM scorer without llm", () => {
    const config: EvalScorerConfig = { name: "faith", type: "faithfulness" };
    expect(() => createScorer(config)).toThrow(KilnError);
    try {
      createScorer(config);
    } catch (e) {
      expect((e as KilnError).code).toBe("EVAL_SCORER_FAILED");
      expect((e as KilnError).suggestion).toContain("ScorerLLM");
    }
  });

  it("creates LLM scorer with mock llm", () => {
    const config: EvalScorerConfig = { name: "faith", type: "faithfulness" };
    const llm = new MockLLM();
    const scorer = createScorer(config, llm);
    expect(scorer.name).toBe("faithfulness");
  });
});
