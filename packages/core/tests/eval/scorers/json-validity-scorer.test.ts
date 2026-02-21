// Tests for JsonValidityScorer

import { describe, it, expect } from "vitest";
import { JsonValidityScorer } from "../../../src/eval/scorers/json-validity-scorer.js";

describe("JsonValidityScorer", () => {
  it("scores 1.0 for valid JSON", async () => {
    const scorer = new JsonValidityScorer();
    const result = await scorer.score({ input: "q", output: '{"name": "test"}' });
    expect(result.score).toBe(1);
  });

  it("scores 0.0 for invalid JSON", async () => {
    const scorer = new JsonValidityScorer();
    const result = await scorer.score({ input: "q", output: "not json" });
    expect(result.score).toBe(0);
  });

  it("scores 1.0 when schema keys are present", async () => {
    const scorer = new JsonValidityScorer({ name: "string", value: "number" });
    const result = await scorer.score({ input: "q", output: '{"name": "test", "value": 42}' });
    expect(result.score).toBe(1);
  });

  it("scores 0.0 when schema keys are missing", async () => {
    const scorer = new JsonValidityScorer({ name: "string", missing: "string" });
    const result = await scorer.score({ input: "q", output: '{"name": "test"}' });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain("missing keys");
  });

  it("validates JSON arrays", async () => {
    const scorer = new JsonValidityScorer();
    const result = await scorer.score({ input: "q", output: '[1, 2, 3]' });
    expect(result.score).toBe(1);
  });
});
