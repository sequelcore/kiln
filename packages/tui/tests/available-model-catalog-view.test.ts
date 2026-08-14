import { describe, expect, it } from "vitest";
import { formatAvailableModelCatalog } from "../src/available-model-catalog-view.js";

describe("available model catalog view", () => {
  it("renders the runtime-owned catalog as a read-only route-setup view", () => {
    expect(formatAvailableModelCatalog({ observedAt: "2026-08-13T00:00:00.000Z", entries: [{ providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model", discoveryState: "observed", eligibilityState: "eligible", availabilityState: "available", configuredState: "unconfigured", configuredRouteRefs: [], reasonCodes: ["discovery-observed"] }] })).toContain("provider/model");
  });
});
