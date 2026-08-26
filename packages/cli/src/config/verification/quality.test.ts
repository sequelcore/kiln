import { describe, expect, it } from "vitest";
import { RUNNING_CLI_VERSION } from "../../build-identity.js";
import { resolveQualityAnalysisConfiguration } from "./quality.js";

describe("quality analysis configuration", () => {
  it("is absent by default and resolves the selected closed profiles in canonical order", () => {
    expect(resolveQualityAnalysisConfiguration(null)).toMatchObject({ diagnostic: { code: "not_configured" } });
    expect(
      resolveQualityAnalysisConfiguration({
        version: "5",
        verification: { static: { quality: { typescript: ["test-integrity", "type-integrity", "complexity"] } } },
      }),
    ).toEqual({
      options: {
        profiles: ["type-integrity", "complexity", "test-integrity"],
        analyzerVersion: RUNNING_CLI_VERSION,
      },
    });
  });
});
