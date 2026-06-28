import { describe, expect, it } from "vitest";
import { WorkItemStore, type WorkItemUpsertInput } from "../../src/work-governance/index.js";

describe("WorkItemStore work classification", () => {
  it("normalizes and preserves paired classification with plan work-item provenance", () => {
    const store = new WorkItemStore({ now: () => "2026-06-28T12:00:00.000Z" });

    const item = store.upsert(workItemInput({
      id: "write-report",
      workClassification: {
        intents: [" write ", "write", "edit"],
        artifacts: [" document ", "document"],
        domains: [" business "],
        effects: [" write-artifact "],
        modes: [" coauthor "],
      },
      workClassificationProvenance: {
        sourceKind: "plan-work-item",
        sourceId: " write-report ",
      },
    }));

    expect(item.workClassification).toEqual({
      intents: ["write", "edit"],
      artifacts: ["document"],
      domains: ["business"],
      effects: ["write-artifact"],
      modes: ["coauthor"],
    });
    expect(item.workClassificationProvenance).toEqual({
      sourceKind: "plan-work-item",
      sourceId: "write-report",
    });
    expect(store.get("write-report")).toEqual(item);
  });

  it("fails closed for incomplete classification and provenance pairs", () => {
    const store = new WorkItemStore();

    expect(() => store.upsert(workItemInput({
      id: "classification-only",
      workClassification: { intents: ["write"] },
    }))).toThrow("must define workClassification and workClassificationProvenance together");

    expect(() => store.upsert(workItemInput({
      id: "provenance-only",
      workClassificationProvenance: {
        sourceKind: "plan-work-item",
        sourceId: "provenance-only",
      },
    }))).toThrow("must define workClassification and workClassificationProvenance together");
  });

  it("fails closed when provenance does not identify the work item's governing source", () => {
    const store = new WorkItemStore();

    expect(() => store.upsert(workItemInput({
      id: "write-report",
      workClassification: { intents: ["write"] },
      workClassificationProvenance: {
        sourceKind: "plan-work-item",
        sourceId: "other-item",
      },
    }))).toThrow("must match work item source id 'write-report'");
  });
});

function workItemInput(overrides: Partial<WorkItemUpsertInput> = {}): WorkItemUpsertInput {
  return {
    id: "work-item",
    summary: "Write a governed report.",
    workflowProfile: "verification-heavy",
    risk: "medium",
    triggers: ["verification-heavy", "medium"],
    expectedEvidence: ["tests"],
    verificationGates: ["bun test"],
    ...overrides,
  };
}
