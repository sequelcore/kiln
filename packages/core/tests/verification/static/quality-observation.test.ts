import { describe, expect, it } from "vitest";
import {
  COMPLEXITY_RULES,
  parseQualityAnalysisObservation,
  qualityAnalysisObservation,
  TEST_INTEGRITY_RULES,
  TYPE_INTEGRITY_RULES,
} from "../../../src/verification/static/quality-observation.js";

describe("quality analysis observation", () => {
  it("binds exact artifact, parser, profile, rules, and empty authority", () => {
    const observation = qualityAnalysisObservation({
      analyzer: {
        name: "kiln-quality",
        version: "3.0.0-beta.1",
        parser: { name: "@typescript/typescript6", version: "6.0.3" },
      },
      artifact: { kind: "typescript", path: "src/value.ts", contentDigest: `sha256:${"a".repeat(64)}` },
      outcome: "no_diagnostics",
      profiles: [
        { name: "type-integrity", revision: "v1", rules: TYPE_INTEGRITY_RULES, diagnostics: [] },
        { name: "complexity", revision: "v1", rules: COMPLEXITY_RULES, diagnostics: [] },
        { name: "test-integrity", revision: "v1", rules: TEST_INTEGRITY_RULES, diagnostics: [] },
      ],
    });
    expect(observation.establishes).toEqual([]);
    expect(observation.profiles[0]?.rules).toEqual(TYPE_INTEGRITY_RULES);
    expect(() => parseQualityAnalysisObservation({ ...observation, outcome: "diagnostics" })).toThrow(/agree/iu);
    expect(() => parseQualityAnalysisObservation({ ...observation, score: 100 })).toThrow(/extra field/iu);
  });

  it("rejects duplicate or out-of-order profile identities", () => {
    const base = {
      schema: "kiln.quality-analysis-observation/v1",
      toolName: "quality_analyze",
      kind: "static_quality_analysis",
      analyzer: {
        name: "kiln-quality",
        version: "3.0.0-beta.1",
        parser: { name: "@typescript/typescript6", version: "6.0.3" },
      },
      artifact: { kind: "typescript", path: "src/value.ts", contentDigest: `sha256:${"a".repeat(64)}` },
      outcome: "no_diagnostics",
      establishes: [],
    } as const;
    expect(() =>
      parseQualityAnalysisObservation({
        ...base,
        profiles: [
          { name: "complexity", revision: "v1", rules: COMPLEXITY_RULES, diagnostics: [] },
          { name: "type-integrity", revision: "v1", rules: TYPE_INTEGRITY_RULES, diagnostics: [] },
        ],
      }),
    ).toThrow(/order/iu);
  });
});
