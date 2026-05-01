import { describe, expect, it } from "vitest";
import {
  evaluateMemoryLifecycle,
  type MemoryLifecycleEvaluationRecord,
  type MemoryLifecyclePolicySet,
} from "../../../src/memory/lifecycle/index.js";
import type { MemoryRecord } from "../../../src/memory/domain/index.js";

const NOW = "2026-05-01T00:00:00.000Z";
const PROJECT_SCOPE = { kind: "project", id: "kiln" } as const;

describe("Memory lifecycle evaluator", () => {
  it("proposes salience lowering for decayed mutable memory without mutating records", () => {
    const record = memoryRecord({
      id: "old-episodic",
      layer: "episodic",
      createdAt: "2026-03-01T00:00:00.000Z",
      confidence: 0.6,
    });

    const result = evaluateMemoryLifecycle({
      now: NOW,
      policySet: policySet({
        decayPolicies: [{
          id: "episodic-decay",
          layers: ["episodic"],
          halfLifeDays: 30,
          minSalience: 0.2,
        }],
      }),
      records: [{ record, recallSalience: 0.9 }],
    });

    expect(result.decisions).toEqual([{
      action: {
        type: "lower_recall_salience",
        recordId: "old-episodic",
        scope: PROJECT_SCOPE,
        layer: "episodic",
        policyId: "episodic-decay",
        policyVersion: "2026-05-01",
        reason: "Memory record age exceeded decay half-life.",
        targetSalience: 0.2,
      },
      recordId: "old-episodic",
      policyId: "episodic-decay",
      policyVersion: "2026-05-01",
      reason: "Memory record age exceeded decay half-life.",
    }]);
    expect(record.content).toBe("memory old-episodic");
  });

  it("proposes archival when retention policy expires a mutable layer", () => {
    const result = evaluateMemoryLifecycle({
      now: NOW,
      policySet: policySet({
        retentionPolicies: [{
          id: "coordination-retention",
          layers: ["coordination"],
          mode: "archive",
          afterDays: 7,
        }],
      }),
      records: [{
        record: memoryRecord({
          id: "stale-coordination",
          layer: "coordination",
          createdAt: "2026-04-01T00:00:00.000Z",
        }),
      }],
    });

    expect(result.decisions.map((decision) => decision.action)).toEqual([{
      type: "archive",
      recordId: "stale-coordination",
      scope: PROJECT_SCOPE,
      layer: "coordination",
      policyId: "coordination-retention",
      policyVersion: "2026-05-01",
      reason: "Memory record exceeded retention window.",
    }]);
  });

  it("proposes promotion only when confidence, utility, and topic criteria are met", () => {
    const result = evaluateMemoryLifecycle({
      now: NOW,
      policySet: policySet({
        promotionPolicies: [{
          id: "episodic-promotion",
          sourceLayers: ["episodic"],
          targetLayer: "semantic",
          minConfidence: 0.7,
          minUses: 2,
          requireTopicKey: true,
        }],
      }),
      records: [
        {
          record: memoryRecord({
            id: "promotable",
            layer: "episodic",
            topicKey: "architecture/lifecycle",
            confidence: 0.82,
          }),
          useCount: 3,
        },
        {
          record: memoryRecord({
            id: "low-confidence",
            layer: "episodic",
            topicKey: "architecture/lifecycle",
            confidence: 0.4,
          }),
          useCount: 5,
        },
        {
          record: memoryRecord({
            id: "missing-topic",
            layer: "episodic",
            topicKey: undefined,
            confidence: 0.9,
          }),
          useCount: 5,
        },
      ],
    });

    expect(result.decisions.map((decision) => decision.action)).toEqual([{
      type: "promote",
      recordId: "promotable",
      scope: PROJECT_SCOPE,
      layer: "episodic",
      policyId: "episodic-promotion",
      policyVersion: "2026-05-01",
      reason: "Memory record met promotion criteria.",
      targetLayer: "semantic",
    }]);
  });

  it("proposes one deterministic derived-summary action for compactable topic groups", () => {
    const result = evaluateMemoryLifecycle({
      now: NOW,
      policySet: policySet({
        compactionPolicies: [{
          id: "episodic-compaction",
          sourceLayers: ["episodic"],
          targetLayer: "semantic",
          strategy: "summarize_by_topic",
          minSourceRecords: 2,
        }],
      }),
      records: [
        { record: memoryRecord({ id: "zeta", layer: "episodic", topicKey: "same-topic" }) },
        { record: memoryRecord({ id: "alpha", layer: "episodic", topicKey: "same-topic" }) },
        { record: memoryRecord({ id: "other", layer: "episodic", topicKey: "other-topic" }) },
      ],
    });

    expect(result.decisions.map((decision) => decision.action)).toEqual([{
      type: "create_derived_summary",
      recordId: "alpha",
      scope: PROJECT_SCOPE,
      layer: "episodic",
      policyId: "episodic-compaction",
      policyVersion: "2026-05-01",
      reason: "Memory topic group met compaction threshold.",
      targetLayer: "semantic",
    }]);
  });

  it("returns deterministic decisions sorted by record and policy", () => {
    const result = evaluateMemoryLifecycle({
      now: NOW,
      policySet: policySet({
        retentionPolicies: [{
          id: "episodic-retention",
          layers: ["episodic"],
          mode: "archive",
          afterDays: 1,
        }],
        decayPolicies: [{
          id: "episodic-decay",
          layers: ["episodic"],
          halfLifeDays: 1,
          minSalience: 0.3,
        }],
      }),
      records: [
        { record: memoryRecord({ id: "b", layer: "episodic", createdAt: "2026-04-01T00:00:00.000Z" }) },
        { record: memoryRecord({ id: "a", layer: "episodic", createdAt: "2026-04-01T00:00:00.000Z" }) },
      ],
    });

    expect(result.decisions.map((decision) => `${decision.recordId}:${decision.policyId}:${decision.action.type}`)).toEqual([
      "a:episodic-decay:lower_recall_salience",
      "a:episodic-retention:archive",
      "b:episodic-decay:lower_recall_salience",
      "b:episodic-retention:archive",
    ]);
  });
});

function policySet(overrides: Partial<MemoryLifecyclePolicySet> = {}): MemoryLifecyclePolicySet {
  return {
    id: "test-lifecycle",
    version: "2026-05-01",
    retentionPolicies: [],
    decayPolicies: [],
    forgettingPolicies: [],
    compactionPolicies: [],
    promotionPolicies: [],
    ...overrides,
  };
}

function memoryRecord(overrides: Partial<MemoryRecord>): MemoryRecord {
  const id = overrides.id ?? "mem-1";
  return {
    id,
    layer: "episodic",
    scope: PROJECT_SCOPE,
    content: `memory ${id}`,
    topicKey: `topic/${id}`,
    tags: [],
    provenance: {
      sourceType: "operator",
      sourceId: "test",
      capturedAt: "2026-04-01T00:00:00.000Z",
    },
    confidence: 0.8,
    createdAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

void ({} as MemoryLifecycleEvaluationRecord);
