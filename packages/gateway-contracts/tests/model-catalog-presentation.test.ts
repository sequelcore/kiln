import { describe, expect, it } from "vitest";

import {
  filterModelCatalogItems,
  modelCatalogPrimaryAction,
  projectModelCatalogItems,
  type ModelCatalog,
} from "../src/index.js";

const catalog = {
  observedAt: "2026-08-26T16:00:00.000Z",
  models: [
    model("provider-a", "model-a", "Model Alpha", [target("alpha-main"), target("alpha-work")]),
    model("provider-b", "model-b", "Model Beta", []),
  ],
} as const satisfies ModelCatalog;

describe("model catalog presentation", () => {
  it("projects one searchable item per provider model route", () => {
    const items = projectModelCatalogItems(catalog);

    expect(items.map((item) => item.label)).toEqual(["Model Alpha", "Model Beta"]);
    expect(items[0]).toMatchObject({ configured: true, targetCount: 2, access: "api" });
    expect(items[1]).toMatchObject({ configured: false, targetCount: 0, access: "api" });
  });

  it("filters by model, family, provider, target label, and access", () => {
    const items = projectModelCatalogItems(catalog);

    expect(filterModelCatalogItems(items, { query: "family-a work", providerId: null, access: "all" })).toHaveLength(1);
    expect(filterModelCatalogItems(items, { query: "", providerId: "provider-b", access: "all" })[0]?.providerModelId).toBe("model-b");
    expect(filterModelCatalogItems(items, { query: "", providerId: null, access: "subscription" })).toEqual([]);
  });

  it("selects directly only when one available target exists", () => {
    expect(modelCatalogPrimaryAction(model("provider-a", "one", "One", [target("only")]))).toEqual({
      kind: "select-target",
      targetId: "only",
    });
    expect(modelCatalogPrimaryAction(catalog.models[0])).toEqual({ kind: "choose-target" });
    expect(modelCatalogPrimaryAction(catalog.models[1])).toEqual({ kind: "configure" });
  });
});

function model(providerId: string, providerModelId: string, displayName: string, targets: readonly ReturnType<typeof target>[]) {
  return {
    providerId,
    providerRouteId: `${providerId}:direct`,
    providerModelId,
    access: "api" as const,
    family: providerModelId === "model-a" ? "family-a" : "family-b",
    displayName,
    discovery: "observed" as const,
    eligibility: "eligible" as const,
    availability: "available" as const,
    provenance: [],
    targets,
  };
}

function target(targetId: string) {
  return {
    targetId,
    label: targetId,
    access: "api" as const,
    availability: "available" as const,
    reasonCodes: ["configured" as const],
    repairActions: [],
    eligibleAccountCount: 1,
    accountOverrideIds: [],
    cost: { kind: "metered" as const, currency: "USD", inputPerMillion: 1, outputPerMillion: 5 },
  };
}
