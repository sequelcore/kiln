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

describe("WorkItemStore evidence consistency", () => {
  it("rejects evidence that is simultaneously claimed as provided and skipped", () => {
    const store = new WorkItemStore();

    expect(() => store.upsert(workItemInput({
      id: "contradictory-evidence",
      providedEvidence: ["managed-agent-review"],
      skippedVerificationGates: ["managed-agent-review"],
    }))).toThrow("cannot be both provided evidence and a skipped verification gate: managed-agent-review");
  });

  it("accounts for explicitly skipped expected checks when residual risk is recorded", () => {
    const store = new WorkItemStore();
    store.upsert(workItemInput({
      id: "read-only-inspection",
      expectedEvidence: ["surface-map", "tests", "typecheck"],
      providedEvidence: ["surface-map"],
      verificationGates: ["tests", "typecheck"],
    }));

    const result = store.complete({
      id: "read-only-inspection",
      verificationGateResults: [
        { gate: "tests", status: "skipped", summary: "Read-only inspection; tests were not executed." },
        { gate: "typecheck", status: "skipped", summary: "Read-only inspection; typecheck was not executed." },
      ],
      residualRisk: "Repository behavior was inspected statically; executable verification remains outstanding.",
    });

    expect(result).toMatchObject({
      item: { status: "completed" },
      missingEvidence: [],
      missingVerificationGates: [],
      missingResidualRisk: false,
    });
  });

  it("blocks skipped expected checks until residual risk is recorded", () => {
    const store = new WorkItemStore();
    store.upsert(workItemInput({
      id: "unqualified-skip",
      expectedEvidence: ["tests"],
      verificationGates: ["tests"],
    }));

    const result = store.complete({
      id: "unqualified-skip",
      verificationGateResults: [
        { gate: "tests", status: "skipped", summary: "Tests were not executed." },
      ],
    });

    expect(result).toMatchObject({
      item: { status: "blocked" },
      missingEvidence: [],
      missingResidualRisk: true,
    });
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
