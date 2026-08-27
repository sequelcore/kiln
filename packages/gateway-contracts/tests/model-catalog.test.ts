import { describe, expect, it } from "vitest";

import {
  ExecutionTargetSelectionIntentSchema,
  ModelCatalogSchema,
  type ExecutionTargetSelectionIntent,
  type ModelCatalog,
} from "../src/index.js";

const catalog = {
  observedAt: "2026-08-26T16:00:00.000Z",
  revision: "catalog-1",
  models: [{
    providerId: "codex-oauth",
    providerRouteId: "codex-oauth:direct",
    providerModelId: "gpt-5.6-terra",
    access: "subscription",
    family: "gpt-5.6",
    displayName: "GPT-5.6 Terra",
    releaseDate: "2026-07-01",
    discovery: "observed",
    eligibility: "eligible",
    availability: "available",
    capabilities: {
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      tools: true,
      structuredOutput: true,
      reasoning: true,
      contextWindow: 1_000_000,
    },
    provenance: [
      { field: "availability", source: "runtime-provider-catalog", observedAt: "2026-08-26T16:00:00.000Z" },
      { field: "displayName", source: "models.dev", observedAt: "2026-08-26T15:59:00.000Z" },
    ],
    targets: [{
      targetId: "terra",
      label: "Terra",
      access: "subscription",
      availability: "available",
      reasonCodes: ["configured"],
      repairActions: [],
      eligibleAccountCount: 2,
      accountOverrideIds: ["work", "personal"],
      cost: { kind: "subscription" },
    }],
  }],
} as const satisfies ModelCatalog;

describe("ModelCatalogSchema", () => {
  it("joins model metadata and executable targets without exposing credentials", () => {
    expect(ModelCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(JSON.stringify(catalog)).not.toContain("credential");
  });

  it("keeps discovered unconfigured models selectable only through configuration", () => {
    const unconfigured = {
      ...catalog,
      models: [{
        ...catalog.models[0],
        availability: "unknown",
        targets: [],
      }],
    } as const satisfies ModelCatalog;

    expect(ModelCatalogSchema.parse(unconfigured).models[0]?.targets).toEqual([]);
  });

  it("rejects secret and implicit selection fields", () => {
    expect(ModelCatalogSchema.safeParse({
      ...catalog,
      models: [{ ...catalog.models[0], credentialId: "secret-ref" }],
    }).success).toBe(false);
    expect(ModelCatalogSchema.safeParse({
      ...catalog,
      models: [{ ...catalog.models[0], selected: true }],
    }).success).toBe(false);
  });

  it("selects one configured target and an optional eligible account override", () => {
    const intent = {
      targetId: "terra",
      accountOverrideId: "work",
    } as const satisfies ExecutionTargetSelectionIntent;

    expect(ExecutionTargetSelectionIntentSchema.parse(intent)).toEqual(intent);
    expect(ExecutionTargetSelectionIntentSchema.safeParse({
      ...intent,
      providerId: "codex-oauth",
    }).success).toBe(false);
  });
});
