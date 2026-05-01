import { describe, expect, it } from "vitest";
import {
  planMemoryForgetting,
  type MemoryForgettingPolicy,
  type MemoryLifecycleEvaluationRecord,
  type MemoryRecord,
} from "../../../src/index.js";

const PROJECT_SCOPE = { kind: "project", id: "kiln" } as const;
const OTHER_SCOPE = { kind: "project", id: "other" } as const;
const POLICY: MemoryForgettingPolicy = {
  id: "scoped-soft-delete",
  layers: ["working", "episodic"],
  mode: "soft_delete",
  requiresExplicitScope: true,
};

describe("memory lifecycle forgetting planner", () => {
  it("requires explicit scope and validates forgetting policy", () => {
    expect(() =>
      planMemoryForgetting({
        policy: POLICY,
        policyVersion: "2026-05-01",
        records: [],
      }),
    ).toThrow("Memory lifecycle forgetting requires explicit scope");

    expect(() =>
      planMemoryForgetting({
        policy: {
          ...POLICY,
          layers: ["audit"],
        },
        policyVersion: "2026-05-01",
        scope: PROJECT_SCOPE,
        records: [],
      }),
    ).toThrow("Audit memory cannot be forgotten by lifecycle policy");
  });

  it("plans forget actions only for records matching explicit scope and allowed layers", () => {
    const plan = planMemoryForgetting({
      policy: POLICY,
      policyVersion: "2026-05-01",
      scope: PROJECT_SCOPE,
      records: [
        evidence(memoryRecord({ id: "b", scope: PROJECT_SCOPE, layer: "episodic" })),
        evidence(memoryRecord({ id: "a", scope: PROJECT_SCOPE, layer: "working" })),
        evidence(memoryRecord({ id: "scope-mismatch", scope: OTHER_SCOPE, layer: "working" })),
        evidence(memoryRecord({ id: "layer-not-forgettable", scope: PROJECT_SCOPE, layer: "semantic" })),
        evidence(memoryRecord({ id: "audit-preserved", scope: PROJECT_SCOPE, layer: "audit" })),
      ],
    });

    expect(plan.decisions.map((decision) => decision.action)).toEqual([
      {
        type: "forget",
        recordId: "a",
        scope: PROJECT_SCOPE,
        layer: "working",
        policyId: "scoped-soft-delete",
        policyVersion: "2026-05-01",
        reason: "Memory record met explicit forgetting policy.",
        mode: "soft_delete",
      },
      {
        type: "forget",
        recordId: "b",
        scope: PROJECT_SCOPE,
        layer: "episodic",
        policyId: "scoped-soft-delete",
        policyVersion: "2026-05-01",
        reason: "Memory record met explicit forgetting policy.",
        mode: "soft_delete",
      },
    ]);

    expect(plan.rejected.map((rejection) => [rejection.recordId, rejection.reasons])).toEqual([
      ["audit-preserved", ["layer-not-forgettable", "audit-preserved"]],
      ["layer-not-forgettable", ["layer-not-forgettable"]],
      ["scope-mismatch", ["scope-mismatch"]],
    ]);
  });
});

function evidence(record: MemoryRecord): MemoryLifecycleEvaluationRecord {
  return { record };
}

function memoryRecord(overrides: {
  readonly id: string;
  readonly scope?: MemoryRecord["scope"];
  readonly layer?: MemoryRecord["layer"];
}): MemoryRecord {
  return {
    id: overrides.id,
    layer: overrides.layer ?? "episodic",
    scope: overrides.scope ?? PROJECT_SCOPE,
    content: `memory ${overrides.id}`,
    topicKey: `topic/${overrides.id}`,
    tags: ["memory"],
    provenance: {
      sourceType: "operator",
      sourceId: "forgetting-test",
      capturedAt: "2026-05-01T00:00:00.000Z",
    },
    confidence: 0.9,
    createdAt: "2026-04-30T00:00:00.000Z",
  };
}
