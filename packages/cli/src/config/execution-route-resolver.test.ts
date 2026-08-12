import { describe, expect, it } from "vitest";
import { inferRouteTask, resolveExecutionRouteCandidates } from "./execution-route-resolver.js";
import type { KilnGlobalConfig } from "./global-config.js";

const config = {
  version: "2",
  executionCatalog: {
    accounts: [], accountPolicies: [],
    routes: [
      { id: "terra", label: "Terra", providerId: "codex-oauth", providerModelId: "gpt-5.6-terra", accountSelection: { mode: "exact", accountId: "account-terra" }, economics: { kind: "unpriced" } },
      { id: "luna", label: "Luna", providerId: "opencode-go", providerModelId: "kimi-k2.6", accountSelection: { mode: "exact", accountId: "account-luna" }, economics: { kind: "unpriced" } },
    ],
  },
  executionRouting: { defaultRouteId: "terra" },
} as KilnGlobalConfig;

describe("resolveExecutionRouteCandidates", () => {
  it("derives only the default dispatch identity from V2 routing", () => {
    expect(resolveExecutionRouteCandidates({ globalConfig: config })).toEqual([
      { routeId: "terra", provider: "codex-oauth", model: "gpt-5.6-terra" },
    ]);
  });

  it("uses an explicit route as the sole operator selection", () => {
    expect(resolveExecutionRouteCandidates({ globalConfig: config, routeId: "luna" })).toEqual([
      { routeId: "luna", provider: "opencode-go", model: "kimi-k2.6" },
    ]);
  });

  it("fails closed for an unknown explicit route", () => {
    expect(() => resolveExecutionRouteCandidates({ globalConfig: config, routeId: "unknown" }))
      .toThrow("Execution route 'unknown' is not configured.");
  });

  it("does not infer execution candidates from legacy direct models or gateway virtual models", () => {
    expect(resolveExecutionRouteCandidates({ globalConfig: { version: "2" } })).toEqual([]);
  });

  it("rejects native harness routes instead of treating them as direct execution routes", () => {
    const nativeRouteConfig = {
      ...config,
      executionCatalog: {
        ...config.executionCatalog,
        routes: [{
          ...config.executionCatalog!.routes[0]!,
          providerId: "codex",
        }],
      },
      executionRouting: { defaultRouteId: "terra" },
    } as KilnGlobalConfig;
    expect(() => resolveExecutionRouteCandidates({ globalConfig: nativeRouteConfig }))
      .toThrow("Execution route 'terra' does not reference a direct provider.");
  });

});

describe("inferRouteTask", () => {
  it("prefers agent affinity over task keywords", () => {
    expect(inferRouteTask({ agentTaskAffinity: ["mechanical-edit"], text: "Research current frontend benchmarks" })).toBe("mechanical-edit");
  });
});
