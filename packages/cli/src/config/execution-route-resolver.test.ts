import { describe, expect, it } from "vitest";
import { inferRouteTask, resolveExecutionRouteCandidates } from "./execution-route-resolver.js";
import type { KilnGlobalConfig } from "./global-config.js";
import {
  managedAgentIntentConfig,
} from "../../tests/config/managed-agent-intent-config-fixture.js";
import { syntheticExecutionCatalog } from "../../tests/config/execution-target-evidence-fixture.js";

const fixture = managedAgentIntentConfig();
const standardTarget = fixture.targetCatalog!.targets[0]!;
const config: KilnGlobalConfig = {
  ...fixture,
  targetCatalog: {
    ...fixture.targetCatalog!,
    targets: [
      { ...standardTarget, id: "terra", label: "Terra", providerModelId: "gpt-5.6-terra", dataPolicyEvidence: { ...standardTarget.dataPolicyEvidence, providerModelId: "gpt-5.6-terra" } },
      { ...standardTarget, id: "luna", label: "Luna", providerModelId: "gpt-5.6-luna", dataPolicyEvidence: { ...standardTarget.dataPolicyEvidence, providerModelId: "gpt-5.6-luna" } },
    ],
  },
  targetRouting: { defaultTargetId: "terra" },
};
const executionCatalog = syntheticExecutionCatalog(config);

describe("resolveExecutionRouteCandidates", () => {
  it("derives only the default dispatch identity from V4 target routing", () => {
    expect(resolveExecutionRouteCandidates({ globalConfig: config, executionCatalog })).toEqual([
      { routeId: "terra", provider: "codex-oauth", model: "gpt-5.6-terra" },
    ]);
  });

  it("uses an explicit route as the sole operator selection", () => {
    expect(resolveExecutionRouteCandidates({ globalConfig: config, executionCatalog, routeId: "luna" })).toEqual([
      { routeId: "luna", provider: "codex-oauth", model: "gpt-5.6-luna" },
    ]);
  });

  it("fails closed for an unknown explicit route", () => {
    expect(() => resolveExecutionRouteCandidates({ globalConfig: config, executionCatalog, routeId: "unknown" }))
      .toThrow("Execution target 'unknown' is not configured.");
  });

  it("does not infer execution candidates from legacy direct models or gateway virtual models", () => {
    expect(resolveExecutionRouteCandidates({ globalConfig: { version: "5" }, executionCatalog: undefined })).toEqual([]);
  });

  it("rejects native harness routes instead of treating them as direct execution targets", () => {
    const nativeRouteConfig = {
      ...config,
      targetCatalog: {
        ...config.targetCatalog!,
        targets: [{
          id: "terra",
          kind: "harness",
          label: "Native Codex",
          providerId: "codex",
          providerModelId: "gpt-5.6-terra",
          dataClassification: "internal",
          dataPolicyEvidence: { ...standardTarget.dataPolicyEvidence, providerId: "codex", providerModelId: "gpt-5.6-terra" },
        }],
      },
    } as KilnGlobalConfig;
    expect(() => resolveExecutionRouteCandidates({
      globalConfig: nativeRouteConfig,
      executionCatalog: syntheticExecutionCatalog(nativeRouteConfig),
    }))
      .toThrow("Execution target 'terra' is not configured.");
  });

});

describe("inferRouteTask", () => {
  it("prefers agent affinity over task keywords", () => {
    expect(inferRouteTask({ agentTaskAffinity: ["mechanical-edit"], text: "Research current frontend benchmarks" })).toBe("mechanical-edit");
  });

  it("infers research from external-source evidence rather than generic analysis", () => {
    expect(inferRouteTask({ text: "Verify the latest official specification and cite its source" })).toBe("research");
    expect(inferRouteTask({ text: "Analyze callers and affected tests in this repository" })).toBe("architecture-review");
    expect(inferRouteTask({ text: "Research this codebase dependency graph" })).toBe("architecture-review");
  });
});
