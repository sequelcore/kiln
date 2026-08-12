import { describe, expect, it } from "vitest";
import {
  accountedWorkItemEvidence,
  GoalRunStore,
  selectNextGoalExecutionStep,
  WorkItemStore,
  type WorkItemPauseRequirement,
  type WorkItemUpsertInput,
} from "../../src/work-governance/index.js";
import { testBoundedWorkRevision } from "./bounded-work-fixtures.js";

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
  it("projects provided evidence and governed skips through one canonical accounting rule", () => {
    expect(accountedWorkItemEvidence({
      providedEvidence: ["surface-map"],
      skippedVerificationGates: ["tests"],
      verificationGateResults: [
        { gate: "typecheck", status: "skipped", summary: "Not executable in the read-only review." },
        { gate: "review", status: "passed", summary: "Review completed." },
      ],
    })).toEqual(["surface-map", "tests", "typecheck"]);
  });

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

describe("WorkItemStore terminal state", () => {
  it("rejects reopening a terminal work item through upsert", () => {
    const store = new WorkItemStore();
    const completed = store.upsert(workItemInput({
      id: "completed-work",
      status: "completed",
      providedEvidence: ["tests"],
      verificationGates: [],
    }));

    expect(() => store.upsert({
      ...completed,
      status: "pending",
    })).toThrow("Terminal work item 'completed-work' cannot transition from completed to pending");
    expect(store.get("completed-work")?.status).toBe("completed");
  });
});

describe("WorkItemStore pause requirement supersession", () => {
  const fixedNow = () => "2026-07-01T00:00:00.000Z";

  it("keeps both the superseded entry and its replacement when a requirement is superseded", () => {
    const store = new WorkItemStore({ now: fixedNow });
    store.upsert(workItemInput({
      id: "supersede-keeps-both",
      pauseRequirements: [
        {
          id: "requires-legacy-credential",
          kind: "credentials",
          summary: "Provide the legacy service credential.",
          status: "pending",
        },
      ],
    }));

    const item = store.upsert({
      ...store.get("supersede-keeps-both")!,
      pauseRequirements: [
        {
          id: "requires-legacy-credential",
          kind: "credentials",
          summary: "Provide the legacy service credential.",
          status: "superseded",
          supersededByRequirementId: "requires-rotated-credential",
          supersededAt: "2026-07-01T00:00:00.000Z",
          supersededBy: "operator",
          reason: "Legacy credential retired in favor of the rotated credential.",
        },
        {
          id: "requires-rotated-credential",
          kind: "credentials",
          summary: "Provide the rotated service credential.",
          status: "pending",
        },
      ],
    });

    expect(item.pauseRequirements).toEqual([
      {
        id: "requires-legacy-credential",
        kind: "credentials",
        summary: "Provide the legacy service credential.",
        status: "superseded",
        supersededByRequirementId: "requires-rotated-credential",
        supersededAt: "2026-07-01T00:00:00.000Z",
        supersededBy: "operator",
        reason: "Legacy credential retired in favor of the rotated credential.",
      },
      {
        id: "requires-rotated-credential",
        kind: "credentials",
        summary: "Provide the rotated service credential.",
        status: "pending",
      },
    ]);
  });

  it("applies the most recent transition for a repeated requirement id instead of discarding it", () => {
    const store = new WorkItemStore({ now: fixedNow });

    const item = store.upsert(workItemInput({
      id: "repeated-transition",
      pauseRequirements: [
        {
          id: "requires-approval",
          kind: "approval",
          summary: "Awaiting operator approval.",
          status: "pending",
        },
        {
          id: "requires-approval",
          kind: "approval",
          summary: "Awaiting operator approval.",
          status: "resolved",
          resolvedBy: "operator",
          resolvedAt: "2026-07-01T00:00:00.000Z",
          resolution: "Approved.",
        },
      ],
    }));

    // Proves the fix: the pre-fix normalizer kept the FIRST entry for a
    // duplicate id and discarded later transitions, which would leave this
    // requirement "pending" instead of "resolved".
    expect(item.pauseRequirements).toEqual([
      {
        id: "requires-approval",
        kind: "approval",
        summary: "Awaiting operator approval.",
        status: "resolved",
        resolvedBy: "operator",
        resolvedAt: "2026-07-01T00:00:00.000Z",
        resolution: "Approved.",
      },
    ]);
  });

  it("links a superseded requirement to the id of the replacing requirement", () => {
    const store = new WorkItemStore({ now: fixedNow });
    const item = store.upsert(workItemInput({
      id: "links-replacement",
      pauseRequirements: [
        {
          id: "requirement-a",
          kind: "capability",
          summary: "Original requirement.",
          status: "superseded",
          supersededByRequirementId: "requirement-b",
          supersededAt: "2026-07-01T00:00:00.000Z",
          supersededBy: "operator",
          reason: "Replaced by a narrower requirement.",
        },
        {
          id: "requirement-b",
          kind: "capability",
          summary: "Replacement requirement.",
          status: "pending",
        },
      ],
    }));

    const superseded = item.pauseRequirements.find((requirement) => requirement.id === "requirement-a");
    expect(superseded).toMatchObject({
      status: "superseded",
      supersededByRequirementId: "requirement-b",
    });
  });

  it("rejects a supersession pointing at a requirement id that does not exist", () => {
    const store = new WorkItemStore({ now: fixedNow });

    expect(() => store.upsert(workItemInput({
      id: "supersede-missing-target",
      pauseRequirements: [
        {
          id: "requirement-a",
          kind: "capability",
          summary: "Original requirement.",
          status: "superseded",
          supersededByRequirementId: "requirement-nonexistent",
          supersededAt: "2026-07-01T00:00:00.000Z",
          supersededBy: "operator",
          reason: "Replaced.",
        },
      ],
    }))).toThrow(/unknown requirement|does not exist|not found/i);
  });

  it("rejects a requirement superseded by itself", () => {
    const store = new WorkItemStore({ now: fixedNow });

    expect(() => store.upsert(workItemInput({
      id: "self-supersede",
      pauseRequirements: [
        {
          id: "requirement-a",
          kind: "capability",
          summary: "Original requirement.",
          status: "superseded",
          supersededByRequirementId: "requirement-a",
          supersededAt: "2026-07-01T00:00:00.000Z",
          supersededBy: "operator",
          reason: "Replaced.",
        },
      ],
    }))).toThrow(/itself|self/i);
  });

  it("rejects a supersession cycle", () => {
    const store = new WorkItemStore({ now: fixedNow });

    expect(() => store.upsert(workItemInput({
      id: "supersede-cycle",
      pauseRequirements: [
        {
          id: "requirement-a",
          kind: "capability",
          summary: "Requirement A.",
          status: "superseded",
          supersededByRequirementId: "requirement-b",
          supersededAt: "2026-07-01T00:00:00.000Z",
          supersededBy: "operator",
          reason: "Replaced by B.",
        },
        {
          id: "requirement-b",
          kind: "capability",
          summary: "Requirement B.",
          status: "superseded",
          supersededByRequirementId: "requirement-a",
          supersededAt: "2026-07-01T00:00:00.000Z",
          supersededBy: "operator",
          reason: "Replaced by A.",
        },
      ],
    }))).toThrow(/cycle/i);
  });

  it("does not block goal execution on a superseded requirement once its replacement is resolved", () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert(workItemInput({
      id: "supersede-unblocks",
      pauseRequirements: [
        {
          id: "requirement-a",
          kind: "operator_input",
          summary: "Original requirement.",
          status: "superseded",
          supersededByRequirementId: "requirement-b",
          supersededAt: "2026-07-01T00:00:00.000Z",
          supersededBy: "operator",
          reason: "Replaced by a resolved requirement.",
        },
        {
          id: "requirement-b",
          kind: "operator_input",
          summary: "Replacement requirement.",
          status: "resolved",
          resolvedBy: "operator",
          resolvedAt: "2026-07-01T00:00:00.000Z",
          resolution: "Confirmed.",
        },
      ],
    }));
    const goal = new GoalRunStore({ now: fixedNow }).create({
      id: "goal-supersede-unblocks",
      objective: "Execute approved plan.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-supersede-unblocks", [item.id], "Execute approved plan."),
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });

    const step = selectNextGoalExecutionStep({
      goalRun: goal,
      workItems: workItemStore.snapshot().items,
    });

    expect(step).toMatchObject({ status: "ready", workItemId: item.id });
  });

  it("does not treat a superseded requirement as satisfied evidence that unblocks goal execution on its own", () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert(workItemInput({
      id: "supersede-still-blocks",
      pauseRequirements: [
        {
          id: "requirement-a",
          kind: "operator_input",
          summary: "Original requirement.",
          status: "superseded",
          supersededByRequirementId: "requirement-b",
          supersededAt: "2026-07-01T00:00:00.000Z",
          supersededBy: "operator",
          reason: "Replaced by a still-pending requirement.",
        },
        {
          id: "requirement-b",
          kind: "operator_input",
          summary: "Replacement requirement.",
          status: "pending",
        },
      ],
    }));
    const goal = new GoalRunStore({ now: fixedNow }).create({
      id: "goal-supersede-still-blocks",
      objective: "Execute approved plan.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-supersede-still-blocks", [item.id], "Execute approved plan."),
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });

    const step = selectNextGoalExecutionStep({
      goalRun: goal,
      workItems: workItemStore.snapshot().items,
    });

    expect(step).toMatchObject({
      status: "paused",
      reasonCode: "pause_requirements_unresolved",
      pendingPauseRequirements: [
        { id: "requirement-b", status: "pending" },
      ],
    });
  });

  it("preserves existing pending and resolved pause requirement behavior", () => {
    const store = new WorkItemStore({ now: fixedNow });
    const pending: WorkItemPauseRequirement = {
      id: "pending-requirement",
      kind: "operator_input",
      summary: "Awaiting operator input.",
      status: "pending",
    };
    const resolved: WorkItemPauseRequirement = {
      id: "resolved-requirement",
      kind: "approval",
      summary: "Awaiting approval.",
      status: "resolved",
      resolvedBy: "operator",
      resolvedAt: "2026-07-01T00:00:00.000Z",
      resolution: "Approved.",
    };

    const item = store.upsert(workItemInput({
      id: "regression-pending-resolved",
      pauseRequirements: [pending, resolved],
    }));

    expect(item.pauseRequirements).toEqual([pending, resolved]);
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
