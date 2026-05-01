import { describe, expect, it } from "vitest";
import {
  planMemoryCompactions,
  type MemoryCompactionPolicy,
  type MemoryLifecycleEvaluationRecord,
  type MemoryRecord,
} from "../../../src/index.js";

const PROJECT_SCOPE = { kind: "project", id: "kiln" } as const;
const POLICY: MemoryCompactionPolicy = {
  id: "episodic-topic-compaction",
  sourceLayers: ["episodic", "coordination"],
  targetLayer: "semantic",
  strategy: "summarize_by_topic",
  minSourceRecords: 2,
};

describe("memory lifecycle compaction planner", () => {
  it("creates deterministic derived-summary plans with source lineage and no source overwrite", () => {
    const first = memoryRecord({ id: "b", topicKey: "memory/lifecycle", content: "Second useful trace." });
    const second = memoryRecord({ id: "a", topicKey: "memory/lifecycle", content: "First useful trace." });
    const plan = planMemoryCompactions({
      policy: POLICY,
      policyVersion: "2026-05-01",
      records: [
        { record: first },
        { record: second },
        { record: memoryRecord({ id: "other", topicKey: "memory/other" }) },
      ],
    });

    expect(plan.decisions.map((decision) => decision.action)).toEqual([{
      type: "create_derived_summary",
      recordId: "a",
      scope: PROJECT_SCOPE,
      layer: "episodic",
      policyId: "episodic-topic-compaction",
      policyVersion: "2026-05-01",
      reason: "Memory topic group met compaction threshold.",
      targetLayer: "semantic",
    }]);
    expect(plan.groups).toEqual([{
      anchorRecordId: "a",
      scope: PROJECT_SCOPE,
      sourceLayer: "episodic",
      targetLayer: "semantic",
      topicKey: "memory/lifecycle",
      sourceRecordIds: ["a", "b"],
      relationType: "derived_from",
      sourceDisposition: "preserve",
    }]);
    expect(first.content).toBe("Second useful trace.");
    expect(second.content).toBe("First useful trace.");
  });

  it("does not compact across scope, layer, or topic boundaries", () => {
    const plan = planMemoryCompactions({
      policy: POLICY,
      policyVersion: "2026-05-01",
      records: [
        { record: memoryRecord({ id: "project-a", topicKey: "topic/a" }) },
        { record: memoryRecord({ id: "project-b", topicKey: "topic/a" }) },
        { record: memoryRecord({ id: "other-scope", topicKey: "topic/a", scopeId: "other" }) },
        { record: memoryRecord({ id: "semantic", layer: "semantic", topicKey: "topic/a" }) },
        { record: memoryRecord({ id: "other-topic", topicKey: "topic/b" }) },
      ],
    });

    expect(plan.groups).toEqual([{
      anchorRecordId: "project-a",
      scope: PROJECT_SCOPE,
      sourceLayer: "episodic",
      targetLayer: "semantic",
      topicKey: "topic/a",
      sourceRecordIds: ["project-a", "project-b"],
      relationType: "derived_from",
      sourceDisposition: "preserve",
    }]);
  });

  it("rejects audit sources and audit targets before planning compaction", () => {
    expect(() =>
      planMemoryCompactions({
        policy: {
          ...POLICY,
          sourceLayers: ["audit"],
        },
        policyVersion: "2026-05-01",
        records: [],
      }),
    ).toThrow("Audit memory cannot be compacted");

    expect(() =>
      planMemoryCompactions({
        policy: {
          ...POLICY,
          targetLayer: "audit",
        },
        policyVersion: "2026-05-01",
        records: [],
      }),
    ).toThrow("Lifecycle compaction cannot target audit memory");
  });
});

function memoryRecord(overrides: Partial<MemoryRecord> & { readonly id: string }): MemoryRecord {
  return {
    id: overrides.id,
    layer: overrides.layer ?? "episodic",
    scope: { kind: "project", id: overrides.scopeId ?? "kiln" },
    content: overrides.content ?? `memory ${overrides.id}`,
    topicKey: overrides.topicKey ?? `topic/${overrides.id}`,
    tags: ["memory"],
    provenance: {
      sourceType: "operator",
      sourceId: "compaction-test",
      capturedAt: "2026-05-01T00:00:00.000Z",
    },
    confidence: overrides.confidence ?? 0.9,
    createdAt: overrides.createdAt ?? "2026-04-30T00:00:00.000Z",
  };
}

void ({} as MemoryLifecycleEvaluationRecord);
