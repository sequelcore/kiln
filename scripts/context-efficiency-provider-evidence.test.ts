import { describe, expect, it } from "vitest";
import {
  hasSettledContextEfficiencyProviderEvidence,
  projectContextEfficiencyProviderEvidence,
} from "./context-efficiency-provider-evidence.js";

function observation() {
  return {
    version: "v1",
    requestIndex: 0,
    providerId: "codex-oauth",
    modelId: "gpt-5.6-luna",
    routeId: "codex-luna",
    managedInvocation: { invocationId: "invoke-1", childSessionId: "child-1", childTurnId: "turn-1" },
    deliberation: { state: "observed", status: "exact", selectedLevel: "low" },
    authority: { state: "observed", requestedAuthority: "read_only", admittedAuthority: "read_only", completeness: "authoritative" },
    dispatch: {
      attempt: { state: "observed", value: 1 }, retry: { state: "observed", value: false },
      fallback: { state: "unknown" }, outcome: "failed", failurePhase: "transport",
    },
    usage: {
      input: { tokens: 10, measurement: "provider_reported" },
      output: { tokens: 2, measurement: "provider_reported" },
      cacheRead: { measurement: "unknown" }, cacheWrite: { tokens: 0, measurement: "estimated" },
    },
    physicalRegions: [{ source: "system", bytes: 10, measurement: "measured" }],
    regionalTokenAttribution: [{ source: "required_prompt", tokens: 10, measurement: "estimated" }],
    reconciliation: { state: "estimated", providerInputTokens: 10, attributedInputTokens: 10, unresolvedRemainderTokens: 0, reason: "provider_total_not_regionally_measured" },
    capacity: {
      state: "within_capacity", measurement: "estimated", contextWindowTokens: 100,
      contextWindowAuthority: "provider_reported", estimatedInputTokens: 10, outputReserveTokens: 5,
      estimatedTotalTokens: 15, estimatedRemainingTokens: 85, overflow: false,
    },
    cache: {
      partitionIdentity: { state: "observed", hash: `sha256:${"a".repeat(64)}` },
      regions: [{ source: "system", stability: "stable", bytes: 10, includedInStablePrefix: true }],
      readTokens: 0, writeTokens: 0, measurement: "provider_reported",
    },
    toolCount: 0,
    effectivePrompt: {
      version: "v1", estimatedTokens: 10, componentCount: 2,
      componentScopeCounts: { static: 1, dynamic: 1, deferred: 0 },
    },
    conversationProjection: {
      policyId: "tool-result-clearing-v1", originalToolResultCount: 2, projectedToolResultCount: 1,
      originalToolResultTokens: 100, projectedToolResultTokens: 50, clearedToolResultCount: 1, overflow: false,
    },
    collectorTurnIndex: 3,
    rawPrompt: "private prompt", rawToolResult: "private result", credential: "private credential",
  };
}

describe("context efficiency provider evidence projection", () => {
  it("retains canonical measurement, lineage, cache, transport, and collector-turn evidence without raw content", () => {
    const projected = projectContextEfficiencyProviderEvidence(observation());

    expect(projected).toMatchObject({
      managedInvocation: { invocationId: "invoke-1", childSessionId: "child-1", childTurnId: "turn-1" },
      dispatch: { outcome: "failed", failurePhase: "transport" },
      usage: { input: { tokens: 10, measurement: "provider_reported" }, cacheRead: { measurement: "unknown" } },
      cache: { partitionIdentity: { state: "observed", hash: `sha256:${"a".repeat(64)}` } },
      collectorTurnIndex: 3,
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("rawPrompt");
  });

  it("requires all canonical nested evidence while omitting unrelated extra fields", () => {
    const malformed = { ...observation(), usage: { ...observation().usage, input: { measurement: "provider_reported" } } };
    expect(() => projectContextEfficiencyProviderEvidence(malformed)).toThrow(/input usage tokens/u);

    const projected = projectContextEfficiencyProviderEvidence({ ...observation(), extra: { rawMessages: ["secret"] } });
    expect(projected).not.toHaveProperty("extra");
  });

  it("accepts only terminal observed physical dispatches as settled", () => {
    expect(hasSettledContextEfficiencyProviderEvidence([observation()])).toBe(true);
    expect(hasSettledContextEfficiencyProviderEvidence([{ ...observation(), dispatch: {
      ...observation().dispatch,
      attempt: { state: "unknown" },
    }}])).toBe(false);
    expect(hasSettledContextEfficiencyProviderEvidence([{ ...observation(), dispatch: {
      ...observation().dispatch,
      outcome: "unknown",
    }}])).toBe(false);
  });
});
