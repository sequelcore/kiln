import { describe, expect, it } from "vitest";
import { buildCliVerifiedEfficiencyEvidence } from "./verified-efficiency-evidence.js";

describe("CLI verified efficiency evidence", () => {
  it("uses the Core projector and keeps cached and unknown volume distinct", () => {
    const evidence = buildCliVerifiedEfficiencyEvidence({
      sessionId: "session-cli-1",
      turnId: "turn-cli-1",
      observedAt: "2026-07-14T20:00:00.000Z",
      providerId: "codex-oauth",
      modelId: "gpt-5.6-terra",
      billingMode: "subscription",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      costUsd: 0,
      outcome: "succeeded",
      contextAllocationMode: "segmented",
      policySelection: {
        policyId: "context-segmented-candidate-v2",
        configurationHash: `sha256:${"c".repeat(64)}`,
      },
    });

    expect(evidence.efficiencyEvidence).toMatchObject({
      schemaVersion: "verified-efficiency-evidence-v1",
      policy: {
        owner: "ContextGovernor",
        policyId: "context-segmented-candidate-v2",
        configurationHash: `sha256:${"c".repeat(64)}`,
      },
      totals: {
        providerTotalTokens: 160,
        measured: { tokens: 20 },
        estimated: { tokens: 0 },
        cached: { tokens: 30 },
        unknown: { tokens: 100 },
        cacheWritten: { tokens: 10 },
        avoided: { tokens: 0, costUsd: 0 },
      },
      verification: { status: "not_run", results: [] },
      savings: [],
    });
    expect(evidence.ledger.sourceEventId).toBe(evidence.costEvent.eventId);
    expect(evidence.summary.totalTokens).toBe(160);
  });
});
