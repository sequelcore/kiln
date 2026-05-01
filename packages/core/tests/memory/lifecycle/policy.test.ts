import { describe, expect, it } from "vitest";
import {
  createDefaultMemoryLifecyclePolicySet,
  isMemoryLifecycleActionType,
  validateMemoryLifecycleAction,
  validateMemoryLifecyclePolicySet,
  type MemoryLifecycleAction,
  type MemoryLifecyclePolicySet,
} from "../../../src/memory/lifecycle/index.js";

describe("Memory lifecycle policy domain", () => {
  it("creates layer-aware defaults with semantic retention and immutable audit", () => {
    const policySet = createDefaultMemoryLifecyclePolicySet({
      id: "default-lifecycle",
      version: "2026-05-01",
    });

    expect(policySet.retentionPolicies).toContainEqual({
      id: "semantic-retention",
      layers: ["semantic", "procedural"],
      mode: "retain",
    });
    expect(policySet.retentionPolicies).toContainEqual({
      id: "audit-retention",
      layers: ["audit"],
      mode: "retain",
      immutable: true,
    });
    expect(policySet.decayPolicies.map((policy) => policy.layers)).toEqual([
      ["working", "episodic", "coordination"],
    ]);
  });

  it("accepts explicit lifecycle action types", () => {
    expect(isMemoryLifecycleActionType("retain")).toBe(true);
    expect(isMemoryLifecycleActionType("lower_recall_salience")).toBe(true);
    expect(isMemoryLifecycleActionType("archive")).toBe(true);
    expect(isMemoryLifecycleActionType("compact")).toBe(true);
    expect(isMemoryLifecycleActionType("promote")).toBe(true);
    expect(isMemoryLifecycleActionType("forget")).toBe(true);
    expect(isMemoryLifecycleActionType("create_derived_summary")).toBe(true);
    expect(isMemoryLifecycleActionType("silently_overwrite")).toBe(false);
  });

  it("validates lifecycle decisions with policy evidence and bounded salience", () => {
    const action = validateMemoryLifecycleAction({
      type: "lower_recall_salience",
      recordId: "mem-1",
      scope: { kind: "project", id: "kiln" },
      layer: "episodic",
      policyId: "episodic-decay",
      policyVersion: "2026-05-01",
      reason: "Episodic record has exceeded its decay threshold.",
      targetSalience: 0.25,
    });

    expect(action).toEqual({
      type: "lower_recall_salience",
      recordId: "mem-1",
      scope: { kind: "project", id: "kiln" },
      layer: "episodic",
      policyId: "episodic-decay",
      policyVersion: "2026-05-01",
      reason: "Episodic record has exceeded its decay threshold.",
      targetSalience: 0.25,
    });
  });

  it("rejects invalid policy values", () => {
    expect(() =>
      validateMemoryLifecyclePolicySet({
        id: "bad",
        version: "2026-05-01",
        retentionPolicies: [{
          id: "bad-retention",
          layers: ["episodic"],
          mode: "archive",
          afterDays: 0,
        }],
        decayPolicies: [],
        forgettingPolicies: [],
        compactionPolicies: [],
        promotionPolicies: [],
      }),
    ).toThrow("Memory lifecycle retention afterDays must be a positive integer");

    expect(() =>
      validateMemoryLifecycleAction({
        type: "lower_recall_salience",
        recordId: "mem-1",
        scope: { kind: "project", id: "kiln" },
        layer: "episodic",
        policyId: "episodic-decay",
        policyVersion: "2026-05-01",
        reason: "bad salience",
        targetSalience: 1.5,
      }),
    ).toThrow("Memory lifecycle salience must be between 0 and 1");
  });

  it("rejects policies that mutate audit memory or decay semantic memory by default", () => {
    expect(() =>
      validateMemoryLifecyclePolicySet(policySet({
        decayPolicies: [{
          id: "bad-audit-decay",
          layers: ["audit"],
          halfLifeDays: 30,
          minSalience: 0.1,
        }],
      })),
    ).toThrow("Audit memory cannot be decayed");

    expect(() =>
      validateMemoryLifecyclePolicySet(policySet({
        decayPolicies: [{
          id: "bad-semantic-decay",
          layers: ["semantic"],
          halfLifeDays: 30,
          minSalience: 0.1,
        }],
      })),
    ).toThrow("Semantic memory decay requires explicit allowSemanticDecay");

    expect(() =>
      validateMemoryLifecyclePolicySet(policySet({
        compactionPolicies: [{
          id: "bad-audit-compaction",
          sourceLayers: ["audit"],
          targetLayer: "semantic",
          strategy: "summarize_by_topic",
          minSourceRecords: 2,
        }],
      })),
    ).toThrow("Audit memory cannot be compacted");
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

void ({} as MemoryLifecycleAction);
