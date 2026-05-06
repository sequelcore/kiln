import { describe, expect, it } from "vitest";
import schema from "../../src/config/schemas/kiln-global-config.v2.schema.json" with { type: "json" };

describe("kiln global config v2 schema", () => {
  it("declares the v2 discriminant and rejects unknown root fields", () => {
    expect(schema.properties.version).toEqual({ const: "2" });
    expect(schema.additionalProperties).toBe(false);
  });

  it("allows null budget ceilings", () => {
    const budget = schema.properties.routing.properties.budget.additionalProperties;
    expect(budget.properties.dailyTokenCeiling).toEqual({ type: ["number", "null"] });
  });
});
