import { describe, expect, it } from "vitest";
import {
  projectCostUpdatedEventToLifecycleLedger,
  summarizeLifecycleAttributionLedger,
  type CanonicalCostUpdatedEvent,
} from "../../src/events/index.js";
import {
  projectVerifiedEfficiencyEvidence,
} from "../../src/efficiency/index.js";

const COST_EVENT: CanonicalCostUpdatedEvent = {
  eventId: "cost-1",
  kilnSessionId: "session-1",
  sequence: 4,
  timestamp: new Date("2026-07-14T20:00:00.000Z"),
  kind: "cost_updated",
  turnId: "turn-1",
  provider: {
    provider: "codex-oauth",
    model: "gpt-5.6-terra",
    canonicalModel: "gpt-5.6-terra",
    billingMode: "subscription",
  },
  usage: {
    inputTokens: 80,
    outputTokens: 20,
    cacheReadTokens: 40,
    cacheWriteTokens: 10,
  },
  cost: { currency: "USD", deltaUsd: 0, totalUsd: 0 },
};

function lifecycleEvidence() {
  const ledger = projectCostUpdatedEventToLifecycleLedger(COST_EVENT, {
    allocations: [
      {
        source: "control_instructions",
        tokenClass: "admitted",
        tokens: 50,
        quality: "estimated",
        evidenceUris: ["kiln://artifacts/context/admission/content"],
      },
      {
        source: "final_output",
        tokenClass: "generated",
        tokens: 20,
        quality: "provider_reported",
        evidenceUris: ["kiln://artifacts/session/output/content"],
      },
    ],
  });
  return { costEvent: COST_EVENT, ledger, summary: summarizeLifecycleAttributionLedger(ledger) };
}

describe("verified efficiency evidence", () => {
  it("projects one reconciled view with measured, estimated, cached, unknown, and comparison-only avoided volume", () => {
    const projection = projectVerifiedEfficiencyEvidence({
      lifecycleEvidence: lifecycleEvidence(),
      observedAt: "2026-07-14T20:00:01.000Z",
      policy: {
        owner: "ContextGovernor",
        policyId: "context-allocation-segmented-v1",
        configurationHash: `sha256:${"a".repeat(64)}`,
      },
      actions: [{
        actionId: "allocation-1",
        kind: "context_allocation",
        decision: "segmented",
        evidenceUris: ["kiln://artifacts/context/allocation/content"],
      }],
      verificationResults: [{
        verificationResultId: "verification-1",
        status: "passed",
        method: "deterministic",
        evidenceUris: ["kiln://artifacts/verification/result/content"],
      }],
      avoidedComparisons: [{
        savingId: "saving-1",
        actionId: "allocation-1",
        verificationResultId: "verification-1",
        baselineTokens: 125,
        candidateTokens: 100,
        baselineCostUsd: 0.02,
        candidateCostUsd: 0.015,
        comparisonHash: `sha256:${"b".repeat(64)}`,
        evidenceUris: ["kiln://artifacts/benchmarks/comparison/content"],
      }],
      outcome: "succeeded",
    });

    expect(projection.schemaVersion).toBe("verified-efficiency-evidence-v1");
    expect(projection.totals).toEqual({
      providerTotalTokens: 150,
      providerTotalCostUsd: 0,
      measured: { tokens: 20, costUsd: 0 },
      estimated: { tokens: 50, costUsd: 0 },
      cached: { tokens: 40, costUsd: 0 },
      unknown: { tokens: 30, costUsd: 0 },
      cacheWritten: { tokens: 10, costUsd: 0 },
      avoided: { tokens: 25, costUsd: 0.005 },
    });
    expect(projection.savings[0]).toEqual(expect.objectContaining({
      actionId: "allocation-1",
      verificationResultId: "verification-1",
      tokens: 25,
      costUsd: 0.005,
    }));
    expect(
      projection.totals.measured.tokens
      + projection.totals.estimated.tokens
      + projection.totals.cached.tokens
      + projection.totals.unknown.tokens
      + projection.totals.cacheWritten.tokens,
    ).toBe(projection.totals.providerTotalTokens);
  });

  it("rejects forged lifecycle summaries and avoided claims without a passing linked verification", () => {
    const evidence = lifecycleEvidence();
    expect(() => projectVerifiedEfficiencyEvidence({
      lifecycleEvidence: {
        ...evidence,
        summary: { ...evidence.summary, totalTokens: evidence.summary.totalTokens + 1 },
      },
      observedAt: "2026-07-14T20:00:01.000Z",
      policy: {
        owner: "ContextGovernor",
        policyId: "context-allocation-segmented-v1",
        configurationHash: `sha256:${"a".repeat(64)}`,
      },
    })).toThrow("summary mismatch");

    expect(() => projectVerifiedEfficiencyEvidence({
      lifecycleEvidence: evidence,
      observedAt: "2026-07-14T20:00:01.000Z",
      policy: {
        owner: "ContextGovernor",
        policyId: "context-allocation-segmented-v1",
        configurationHash: `sha256:${"a".repeat(64)}`,
      },
      actions: [{
        actionId: "allocation-1",
        kind: "context_allocation",
        decision: "segmented",
        evidenceUris: ["kiln://artifacts/context/allocation/content"],
      }],
      verificationResults: [{
        verificationResultId: "verification-1",
        status: "failed",
        method: "deterministic",
        evidenceUris: ["kiln://artifacts/verification/result/content"],
      }],
      avoidedComparisons: [{
        savingId: "saving-1",
        actionId: "allocation-1",
        verificationResultId: "verification-1",
        baselineTokens: 125,
        candidateTokens: 100,
        comparisonHash: `sha256:${"b".repeat(64)}`,
        evidenceUris: ["kiln://artifacts/benchmarks/comparison/content"],
      }],
    })).toThrow("passing linked verification");
  });

  it("does not manufacture avoided savings when no paired comparison exists", () => {
    const projection = projectVerifiedEfficiencyEvidence({
      lifecycleEvidence: lifecycleEvidence(),
      observedAt: "2026-07-14T20:00:01.000Z",
      policy: {
        owner: "ContextGovernor",
        policyId: "context-allocation-segmented-v1",
        configurationHash: `sha256:${"a".repeat(64)}`,
      },
      outcome: "succeeded",
    });

    expect(projection.totals.avoided).toEqual({ tokens: 0, costUsd: 0 });
    expect(projection.savings).toEqual([]);
    expect(projection.verification.status).toBe("not_run");
  });
});
