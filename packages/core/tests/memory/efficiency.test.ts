import { describe, expect, it } from "vitest";
import {
  defineMemoryEfficiencyUsageReport,
  evaluateMemoryEfficiencyPromotion,
  evaluateMemoryOfflineLifecycle,
  evaluateMemoryWriteAdmission,
  type MemoryEfficiencyObservation,
} from "../../src/memory/index.js";

const provenance = {
  sourceType: "resource" as const,
  sourceId: "kiln://artifacts/run/source/content",
  capturedAt: "2026-07-14T00:00:00.000Z",
};

describe("memory efficiency control", () => {
  it("admits durable trusted memory only with provenance, confidence, evidence, and future value", () => {
    expect(evaluateMemoryWriteAdmission({
      layer: "semantic",
      topicKey: "architecture/context-owner",
      provenance,
      confidence: 0.9,
      durability: "durable",
      futureTaskValue: 0.8,
      contradictionState: "none",
      derivativeTrust: "original",
      canonicalEvidenceUris: ["kiln://artifacts/run/source/content"],
    })).toMatchObject({ decision: "admit", policyId: "memory-write-admission-v1" });

    expect(evaluateMemoryWriteAdmission({
      layer: "semantic",
      topicKey: "architecture/context-owner",
      provenance,
      confidence: 0.3,
      durability: "durable",
      futureTaskValue: 0.2,
      contradictionState: "none",
      derivativeTrust: "original",
      canonicalEvidenceUris: ["kiln://artifacts/run/source/content"],
    })).toMatchObject({ decision: "defer", reasons: expect.arrayContaining(["insufficient-confidence", "insufficient-future-value"]) });

    expect(evaluateMemoryWriteAdmission({
      layer: "semantic",
      topicKey: "architecture/context-owner",
      provenance,
      confidence: 1,
      durability: "durable",
      futureTaskValue: 1,
      contradictionState: "none",
      derivativeTrust: "original",
      canonicalEvidenceUris: ["https://example.test/untrusted"],
    })).toMatchObject({ decision: "defer", reasons: ["noncanonical-evidence"] });
  });

  it("rejects poisoned derivatives and unresolved contradictions regardless of utility", () => {
    expect(evaluateMemoryWriteAdmission({
      layer: "procedural",
      topicKey: "release/process",
      provenance: { ...provenance, sourceType: "agent" },
      confidence: 1,
      durability: "durable",
      futureTaskValue: 1,
      contradictionState: "unresolved",
      derivativeTrust: "untrusted",
      canonicalEvidenceUris: ["kiln://artifacts/run/source/content"],
    })).toMatchObject({
      decision: "reject",
      reasons: expect.arrayContaining(["untrusted-derivative", "unresolved-contradiction"]),
    });
  });

  it("attributes write, recall, injection, and stale recall by layer with honest unknowns", () => {
    const report = defineMemoryEfficiencyUsageReport({
      version: "memory-efficiency-usage-v1",
      entries: [
        usage("write", "episodic", 20, 0.001),
        usage("recall", "episodic", 12, 0.0005),
        usage("injection", "episodic", 8, 0.0004),
        {
          ...usage("stale_recall", "episodic", "unknown", "unknown"),
          tokens: { value: "unknown", source: "unknown" },
          costUsd: { value: "unknown", source: "unknown" },
        },
      ],
    });

    expect(report.byLayer).toEqual([{
      layer: "episodic",
      write: { tokens: 20, costUsd: 0.001, latencyMs: 5 },
      recall: { tokens: 12, costUsd: 0.0005, latencyMs: 5 },
      injection: { tokens: 8, costUsd: 0.0004, latencyMs: 5 },
      stale_recall: { tokens: "unknown", costUsd: "unknown", latencyMs: 5 },
    }]);
  });

  it("requires offline correction, consolidation, expiration, and forgetting fixtures to preserve canonical evidence", () => {
    const result = evaluateMemoryOfflineLifecycle([
      offline("correction"),
      offline("consolidation"),
      offline("expiration"),
      offline("forgetting"),
    ]);
    expect(result.eligible).toBe(true);

    expect(evaluateMemoryOfflineLifecycle([
      offline("correction"),
      { ...offline("consolidation"), canonicalEvidencePreserved: false },
      offline("expiration"),
      offline("forgetting"),
    ])).toMatchObject({ eligible: false, issues: expect.arrayContaining([expect.stringContaining("canonical evidence")]) });
  });

  it("promotes only after five paired tasks preserve continuity and poison defenses at lower replay cost", () => {
    const observations: MemoryEfficiencyObservation[] = [];
    for (let index = 1; index <= 5; index += 1) {
      for (const policy of ["static-baseline", "candidate"] as const) {
        observations.push({
          taskId: `task-${index}`,
          taskClass: "continuity",
          policy,
          verifiedContinuity: true,
          replayTokens: policy === "candidate" ? 80 : 160,
          totalCostUsd: policy === "candidate" ? 0.01 : 0.02,
          economicsKnown: true,
          scopePreserved: true,
          authorityPreserved: true,
          canonicalEvidencePreserved: true,
          revisionLineagePreserved: true,
          staleDetected: true,
          contradictionDetected: true,
          poisonDetected: true,
          reconsolidationReversible: true,
          usageEvidenceId: `${policy}-${index}`,
        });
      }
    }
    const report = evaluateMemoryEfficiencyPromotion(observations);
    expect(report.promotionEligible).toBe(true);
    expect(report.replayTokenDelta).toBe(-400);
    expect(report.costDeltaUsd).toBeCloseTo(-0.05);
  });
});

function usage(
  operation: "write" | "recall" | "injection" | "stale_recall",
  layer: "episodic",
  tokens: number | "unknown",
  costUsd: number | "unknown",
) {
  return {
    operation,
    layer,
    tokens: metric(tokens),
    costUsd: metric(costUsd),
    latencyMs: metric(5),
    evidenceUris: [`kiln://artifacts/memory/${operation}/content`],
  } as const;
}

function metric(value: number | "unknown") {
  return value === "unknown"
    ? { value, source: "unknown" as const }
    : { value, source: "estimated" as const };
}

function offline(operation: "correction" | "consolidation" | "expiration" | "forgetting") {
  return {
    fixtureId: `fixture-${operation}`,
    operation,
    expectedOutcomeObserved: true,
    reversible: true,
    sourceRecordsPreserved: true,
    canonicalEvidencePreserved: true,
    staleDetected: true,
    contradictionDetected: true,
    poisonDetected: true,
    evidenceUris: [`kiln://artifacts/memory/${operation}/content`],
  } as const;
}
