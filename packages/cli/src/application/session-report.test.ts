import { describe, expect, it } from "vitest";
import { formatReport } from "./session-report.js";

describe("formatReport", () => {
  it("renders the runtime-normalized context projection in the existing human session report", () => {
    const lines = formatReport({
      sessionId: "session-1",
      task: "Verify context evidence",
      domain: "default",
      phaseReached: "complete",
      cost: { total: 0, byRoleModel: {} },
      duration: 1_000,
      contextUsage: {
        state: "partial",
        usedTokens: 2_400,
        providerId: "anthropic",
        modelId: "claude-sonnet",
        turnId: "session-1:turn:1",
        observedAt: "2026-07-13T00:00:00.000Z",
        measurement: "runtime_estimate",
        lifecycle: "completed",
        contextWindowAuthority: "runtime_observed",
        freshness: "fresh",
        reason: "No provider-authoritative context window is available.",
      },
    }, "kiln");

    expect(lines).toContain("Context usage: Context partial: 2.4k tokens");
  });

  it("renders canonical efficiency evidence with quality and policy identity", () => {
    const lines = formatReport({
      sessionId: "session-1",
      task: "Verify efficiency evidence",
      domain: "default",
      phaseReached: "complete",
      cost: { total: 0, byRoleModel: {} },
      duration: 1_000,
      efficiencyEvidence: {
        schemaVersion: "verified-efficiency-evidence-v1",
        sessionId: "session-1",
        observedAt: "2026-07-13T00:00:00.000Z",
        provider: { providerId: "codex-oauth", modelId: "gpt-5.6-terra", billingMode: "subscription" },
        policy: {
          owner: "ContextGovernor",
          policyId: "context-whole-block-static-v1",
          configurationHash: `sha256:${"a".repeat(64)}`,
        },
        totals: {
          providerTotalTokens: 10,
          providerTotalCostUsd: 0,
          measured: { tokens: 2, costUsd: 0 },
          estimated: { tokens: 0, costUsd: 0 },
          cached: { tokens: 3, costUsd: 0 },
          unknown: { tokens: 5, costUsd: 0 },
          cacheWritten: { tokens: 0, costUsd: 0 },
          avoided: { tokens: 0, costUsd: 0 },
        },
        outcome: "succeeded",
        verification: { status: "not_run", results: [] },
        actions: [],
        savings: [],
        evidenceUris: [],
      },
    }, "kiln");

    expect(lines).toContain(
      "Efficiency: 2 measured · 0 estimated · 3 cached · 0 avoided · verification not_run · context-whole-block-static-v1",
    );
  });
});
