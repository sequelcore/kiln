import { describe, expect, it } from "vitest";
import { formatModelCatalog } from "../src/model-catalog-view.js";

describe("model catalog view", () => {
  it("renders discovered models and their setup state", () => {
    expect(formatModelCatalog({
      observedAt: "2026-08-13T00:00:00.000Z",
      models: [{
        providerId: "provider",
        providerRouteId: "provider:direct",
        providerModelId: "model",
        access: "api",
        family: "model",
        discovery: "observed",
        eligibility: "eligible",
        availability: "available",
        provenance: [],
        targets: [],
      }],
    })).toContain("provider/model");
  });
});
