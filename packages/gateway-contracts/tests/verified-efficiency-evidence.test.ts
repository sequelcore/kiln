import { describe, expect, it } from "vitest";
import {
  VerifiedEfficiencyEvidenceProjectionSchema,
  formatVerifiedEfficiencyEvidence,
} from "../src/index.js";

const PROJECTION = {
  schemaVersion: "verified-efficiency-evidence-v1" as const,
  sessionId: "session-1",
  turnId: "turn-1",
  observedAt: "2026-07-14T20:00:01.000Z",
  provider: {
    providerId: "codex-oauth",
    modelId: "gpt-5.6-terra",
    billingMode: "subscription",
  },
  policy: {
    owner: "ContextGovernor",
    policyId: "context-allocation-segmented-v1",
    configurationHash: `sha256:${"a".repeat(64)}`,
  },
  totals: {
    providerTotalTokens: 150,
    providerTotalCostUsd: 0,
    measured: { tokens: 20, costUsd: 0 },
    estimated: { tokens: 50, costUsd: 0 },
    cached: { tokens: 40, costUsd: 0 },
    unknown: { tokens: 30, costUsd: 0 },
    cacheWritten: { tokens: 10, costUsd: 0 },
    avoided: { tokens: 25, costUsd: 0.005 },
  },
  outcome: "succeeded" as const,
  verification: {
    status: "passed" as const,
    results: [{
      verificationResultId: "verification-1",
      status: "passed" as const,
      method: "deterministic",
      evidenceUris: ["kiln://artifacts/verification/result/content"],
    }],
  },
  actions: [{
    actionId: "allocation-1",
    kind: "context_allocation" as const,
    decision: "segmented",
    evidenceUris: ["kiln://artifacts/context/allocation/content"],
  }],
  savings: [{
    savingId: "saving-1",
    actionId: "allocation-1",
    verificationResultId: "verification-1",
    tokens: 25,
    costUsd: 0.005,
    comparisonHash: `sha256:${"b".repeat(64)}`,
    evidenceUris: ["kiln://artifacts/benchmarks/comparison/content"],
  }],
  evidenceUris: [
    "kiln://artifacts/benchmarks/comparison/content",
    "kiln://artifacts/context/allocation/content",
    "kiln://artifacts/verification/result/content",
  ],
};

describe("verified efficiency evidence wire contract", () => {
  it("validates the canonical view and formats the same totals for every surface", () => {
    const parsed = VerifiedEfficiencyEvidenceProjectionSchema.parse(PROJECTION);

    expect(parsed).toEqual(PROJECTION);
    expect(formatVerifiedEfficiencyEvidence(parsed)).toBe(
      "Efficiency: 20 measured · 50 estimated · 40 cached · 25 avoided · verification passed · context-allocation-segmented-v1",
    );
  });

  it("rejects provider-total disagreement and unlinked avoided claims", () => {
    expect(VerifiedEfficiencyEvidenceProjectionSchema.safeParse({
      ...PROJECTION,
      totals: { ...PROJECTION.totals, providerTotalTokens: 151 },
    }).success).toBe(false);

    expect(VerifiedEfficiencyEvidenceProjectionSchema.safeParse({
      ...PROJECTION,
      verification: { status: "failed", results: [{ ...PROJECTION.verification.results[0], status: "failed" }] },
    }).success).toBe(false);
  });
});
