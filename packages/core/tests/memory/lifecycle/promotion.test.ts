import { describe, expect, it } from "vitest";
import {
  planMemoryPromotions,
  type MemoryLifecycleEvaluationRecord,
  type MemoryPromotionPolicy,
  type MemoryRecord,
} from "../../../src/index.js";

const PROJECT_SCOPE = { kind: "project", id: "kiln" } as const;
const POLICY: MemoryPromotionPolicy = {
  id: "episodic-to-semantic",
  sourceLayers: ["working", "episodic"],
  targetLayer: "semantic",
  minConfidence: 0.75,
  minUses: 2,
  requireTopicKey: true,
};

describe("memory lifecycle promotion planner", () => {
  it("promotes only when utility, scope, provenance, confidence, and topic coherence are explicit", () => {
    const plan = planMemoryPromotions({
      policy: POLICY,
      policyVersion: "2026-05-01",
      records: [
        evidence(memoryRecord({
          id: "promotable",
          content: "Lifecycle policy should promote durable facts.",
          topicKey: "memory/lifecycle",
          confidence: 0.86,
        }), { useCount: 3 }),
        evidence(memoryRecord({
          id: "low-utility",
          content: "Lifecycle policy maybe useful once.",
          topicKey: "memory/lifecycle",
          confidence: 0.9,
        }), { useCount: 1 }),
        evidence(memoryRecord({
          id: "low-confidence",
          content: "Uncertain memory.",
          topicKey: "memory/lifecycle",
          confidence: 0.4,
        }), { useCount: 4 }),
        evidence(memoryRecord({
          id: "missing-topic",
          content: "No coherent topic.",
          topicKey: "",
          confidence: 0.9,
        }), { useCount: 4 }),
        evidence(memoryRecord({
          id: "weak-provenance",
          content: "Missing source provenance.",
          topicKey: "memory/lifecycle",
          confidence: 0.9,
          provenance: {
            sourceType: "operator",
            sourceId: "",
            capturedAt: "2026-05-01T00:00:00.000Z",
          },
        }), { useCount: 4 }),
      ],
    });

    expect(plan.decisions.map((decision) => decision.action)).toEqual([{
      type: "promote",
      recordId: "promotable",
      scope: PROJECT_SCOPE,
      layer: "episodic",
      policyId: "episodic-to-semantic",
      policyVersion: "2026-05-01",
      reason: "Memory record met promotion criteria.",
      targetLayer: "semantic",
    }]);
    expect(plan.accepted[0]).toMatchObject({
      recordId: "promotable",
      criteria: {
        confidence: true,
        utility: true,
        topicCoherence: true,
        provenanceQuality: true,
        scope: true,
      },
    });
    expect(plan.rejected.map((rejection) => [rejection.recordId, rejection.reasons])).toEqual([
      ["low-utility", ["insufficient-utility"]],
      ["low-confidence", ["insufficient-confidence"]],
      ["missing-topic", ["missing-topic-key", "weak-topic-coherence"]],
      ["weak-provenance", ["weak-provenance"]],
    ]);
  });

  it("does not promote semantic, audit, or cross-scope records outside the policy boundary", () => {
    const plan = planMemoryPromotions({
      policy: POLICY,
      policyVersion: "2026-05-01",
      scope: PROJECT_SCOPE,
      records: [
        evidence(memoryRecord({ id: "semantic", layer: "semantic", topicKey: "memory/lifecycle" }), { useCount: 4 }),
        evidence(memoryRecord({ id: "audit", layer: "audit", topicKey: "memory/lifecycle" }), { useCount: 4 }),
        evidence(memoryRecord({ id: "other-scope", scopeId: "other", topicKey: "memory/lifecycle" }), { useCount: 4 }),
      ],
    });

    expect(plan.decisions).toEqual([]);
    expect(plan.rejected.map((rejection) => [rejection.recordId, rejection.reasons])).toEqual([
      ["semantic", ["outside-scope", "source-layer-not-promotable"]],
      ["audit", ["outside-scope", "source-layer-not-promotable"]],
      ["other-scope", ["scope-mismatch"]],
    ]);
  });
});

function evidence(
  record: MemoryRecord,
  overrides: Partial<MemoryLifecycleEvaluationRecord> = {},
): MemoryLifecycleEvaluationRecord {
  return {
    record,
    ...overrides,
  };
}

function memoryRecord(overrides: Partial<MemoryRecord> & { readonly id: string }): MemoryRecord {
  return {
    id: overrides.id,
    layer: overrides.layer ?? "episodic",
    scope: { kind: "project", id: overrides.scopeId ?? "kiln" },
    content: overrides.content ?? `memory ${overrides.id}`,
    topicKey: overrides.topicKey ?? `topic/${overrides.id}`,
    tags: ["memory"],
    provenance: overrides.provenance ?? {
      sourceType: "operator",
      sourceId: "promotion-test",
      capturedAt: "2026-05-01T00:00:00.000Z",
    },
    confidence: overrides.confidence ?? 0.9,
    createdAt: overrides.createdAt ?? "2026-04-30T00:00:00.000Z",
  };
}
