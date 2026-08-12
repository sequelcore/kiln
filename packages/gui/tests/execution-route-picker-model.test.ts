import { describe, expect, it } from "vitest";
import { executionRouteBrands, filterExecutionRouteOptions, projectExecutionRoutePicker } from "../src/components/execution-route-picker-model.js";

const catalog = {
  routes: [
    {
      routeId: "codex-auto-review",
      label: "Codex Auto Review",
      providerId: "codex-oauth",
      providerModelId: "gpt-5.6",
      accountOverrideIds: ["team-a"],
      accountSelection: { mode: "automatic" as const, eligibleAccountCount: 2, allowOperatorOverride: true as const },
      availability: "available" as const,
      reasonCodes: [],
      repairActions: [],
    },
    {
      routeId: "unknown-route",
      label: "Custom Route",
      providerId: "private-provider",
      providerModelId: "v1",
      accountSelection: { mode: "exact" as const, eligibleAccountCount: 1, allowOperatorOverride: false as const },
      availability: "unresolved" as const,
      reasonCodes: ["missing-credentials" as const],
      repairActions: ["authenticate-provider" as const],
    },
  ],
};

describe("execution route picker model", () => {
  it("projects automatic and exact account intents without turning display evidence into selection identity", () => {
    const routes = projectExecutionRoutePicker(catalog);

    expect(routes[0]).toMatchObject({ routeId: "codex-auto-review", providerId: "codex-oauth", accountOptions: [
      { id: undefined, mode: "automatic" },
      { id: "team-a", mode: "exact" },
    ] });
    expect(routes[1]).toMatchObject({ routeId: "unknown-route", brandId: "private-provider", available: false });
  });

  it("filters catalog-backed routes by search, brand, and canonical access evidence", () => {
    const routes = projectExecutionRoutePicker(catalog);
    expect(filterExecutionRouteOptions(routes, { query: "gpt", brandId: null, access: "all" })).toHaveLength(1);
    expect(filterExecutionRouteOptions(routes, { query: "", brandId: "codex", access: "subscription" })).toHaveLength(1);
    expect(filterExecutionRouteOptions(routes, { query: "", brandId: "private-provider", access: "api" })).toHaveLength(0);
  });

  it("keeps an unknown provider named all distinct from the synthetic all-providers control", () => {
    const routes = projectExecutionRoutePicker({
      routes: [{
        routeId: "custom",
        label: "Custom",
        providerId: "all",
        providerModelId: "v1",
        accountSelection: { mode: "exact", eligibleAccountCount: 1, allowOperatorOverride: false },
        availability: "available",
        reasonCodes: [],
        repairActions: [],
      }],
    });

    expect(executionRouteBrands(routes)).toEqual([{ id: "all", label: "all" }]);
  });
});
