import { describe, expect, it } from "vitest";
import {
  parseQualityAnalysisObservation,
  qualityAnalysisObservation,
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
      profiles: [{ name: "type-integrity", revision: "v1", rules: TYPE_INTEGRITY_RULES, diagnostics: [] }],
    });
    expect(observation.establishes).toEqual([]);
    expect(observation.profiles[0]?.rules).toEqual(TYPE_INTEGRITY_RULES);
    expect(() => parseQualityAnalysisObservation({ ...observation, outcome: "diagnostics" })).toThrow(/agree/iu);
    expect(() => parseQualityAnalysisObservation({ ...observation, score: 100 })).toThrow(/extra field/iu);
  });
});
