import { describe, expect, it } from "vitest";
import { inferTargetTask, resolveExecutionTargetCandidates } from "./execution-target-resolver.js";
import type { KilnGlobalConfig } from "./global-config.js";
import {
  managedAgentIntentConfig,
} from "../../tests/config/managed-agent-intent-config-fixture.js";
import { syntheticExecutionTargetCatalog } from "../../tests/config/execution-target-evidence-fixture.js";

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
const executionCatalog = syntheticExecutionTargetCatalog(config);

describe("resolveExecutionTargetCandidates", () => {
  it("derives only the default dispatch identity from target routing", () => {
    expect(resolveExecutionTargetCandidates({ globalConfig: config, executionCatalog })).toEqual([
      { targetId: "terra", provider: "codex-oauth", model: "gpt-5.6-terra" },
    ]);
  });

  it("uses an explicit target as the sole operator selection", () => {
    expect(resolveExecutionTargetCandidates({ globalConfig: config, executionCatalog, targetId: "luna" })).toEqual([
      { targetId: "luna", provider: "codex-oauth", model: "gpt-5.6-luna" },
    ]);
  });

  it("fails closed for an unknown explicit target", () => {
    expect(() => resolveExecutionTargetCandidates({ globalConfig: config, executionCatalog, targetId: "unknown" }))
      .toThrow("Execution target 'unknown' is not configured.");
  });

  it("does not infer execution candidates without canonical target authority", () => {
    expect(resolveExecutionTargetCandidates({ globalConfig: { version: "7" }, executionCatalog: undefined })).toEqual([]);
  });

  it("rejects native harness targets instead of treating them as direct execution targets", () => {
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
    expect(() => resolveExecutionTargetCandidates({
      globalConfig: nativeRouteConfig,
      executionCatalog: syntheticExecutionTargetCatalog(nativeRouteConfig),
    }))
      .toThrow("Execution target 'terra' is not configured.");
  });

});

describe("inferTargetTask", () => {
  it("prefers agent affinity over task keywords", () => {
    expect(inferTargetTask({ agentTaskAffinity: ["mechanical-edit"], text: "Research current frontend benchmarks" })).toBe("mechanical-edit");
  });

  it("infers research from external-source evidence rather than generic analysis", () => {
    expect(inferTargetTask({ text: "Verify the latest official specification and cite its source" })).toBe("research");
    expect(inferTargetTask({ text: "Analyze callers and affected tests in this repository" })).toBe("architecture-review");
    expect(inferTargetTask({ text: "Research this codebase dependency graph" })).toBe("architecture-review");
  });
});
