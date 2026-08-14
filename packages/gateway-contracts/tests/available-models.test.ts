import { describe, expect, it } from "vitest";
import { AvailableModelCatalogSchema } from "../src/available-models.js";

const catalog = {
  observedAt: "2026-08-13T18:00:00.000Z",
  entries: [{
    providerId: "provider-new",
    providerRouteId: "provider-new:direct",
    providerModelId: "model-new",
    discoveryState: "observed",
    eligibilityState: "eligible",
    availabilityState: "available",
    configuredState: "configured",
    configuredRouteRefs: [{ routeId: "route-new", label: "New route" }],
    reasonCodes: ["configured-route-present"],
  }],
} as const;

describe("AvailableModelCatalogSchema", () => {
  it("accepts a secret-free discovery/configuration projection", () => {
    expect(AvailableModelCatalogSchema.parse(catalog)).toEqual(catalog);
  });

  it("strictly rejects unknown authority and secret fields", () => {
    expect(() => AvailableModelCatalogSchema.parse({
      ...catalog,
      entries: [{ ...catalog.entries[0], selected: true }],
    })).toThrow();
    expect(() => AvailableModelCatalogSchema.parse({
      ...catalog,
      entries: [{ ...catalog.entries[0], credentialId: "credential-ref" }],
    })).toThrow();
    expect(() => AvailableModelCatalogSchema.parse({ ...catalog, dispatch: {} })).toThrow();
  });
});
