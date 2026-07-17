import { describe, expect, it } from "vitest";
import {
  PlanStateStore,
  type PlanSubmissionInput,
} from "../../../src/tools/infrastructure/plan-state-store.js";

describe("plan state store", () => {
  it("keeps content hash stable across timestamp and sequence-only revisions", () => {
    let now = 1_800_000_000_000;
    const store = new PlanStateStore({ now: () => now });

    const first = store.submitPlan(baseInput());
    now += 60_000;
    const second = store.submitPlan({
      ...baseInput(),
      planId: first.id,
    });

    expect(second.id).toBe(first.id);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.sequence).toBeGreaterThan(first.sequence);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(store.listPlans()).toHaveLength(1);
  });

  it("invalidates stale approvals when a same-id revision changes content", () => {
    const notifications: string[] = [];
    const store = new PlanStateStore({
      now: () => 1_800_000_000_000,
      resourceNotifications: {
        notifyResourceUpdated(uri: string): void {
          notifications.push(uri);
        },
      },
    });

    const first = store.submitPlan(baseInput());
    const approved = store.approvePlan(first.id);
    expect(approved.success).toBe(true);
    expect(store.executionReadiness(first.id)).toMatchObject({ success: true, ready: true });

    notifications.length = 0;
    const revised = store.submitPlan({
      ...baseInput(),
      planId: first.id,
      objective: "Deliver updated Slice 4 approval behavior.",
    });

    expect(revised.contentHash).not.toBe(first.contentHash);
    expect(revised.approval?.status).toBe("superseded");
    expect(revised.approval?.supersededByPlanHash).toBe(revised.contentHash);
    expect(store.executionReadiness(first.id)).toMatchObject({
      success: true,
      ready: false,
      code: "approval_hash_mismatch",
    });
    expect(notifications).toContain("kiln://session/plans");
    expect(notifications).toContain(`kiln://session/plans/${first.id}`);
  });

  it("normalizes work classification and its plan work-item provenance", () => {
    const store = new PlanStateStore({ now: () => 1_800_000_000_000 });

    const plan = store.submitPlan(baseInput({
      proposedWorkItems: [classifiedWorkItem({
        workClassification: {
          intents: [" write ", "review", "write"],
          artifacts: [" document ", "message"],
          domains: [" education "],
          effects: [" write-artifact "],
          modes: [" coauthor "],
        },
        workClassificationProvenance: {
          sourceKind: "plan-work-item",
          sourceId: " wi-1 ",
        },
      })],
    }));

    expect(plan.proposedWorkItems[0]).toMatchObject({
      workClassification: {
        intents: ["write", "review"],
        artifacts: ["document", "message"],
        domains: ["education"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      workClassificationProvenance: {
        sourceKind: "plan-work-item",
        sourceId: "wi-1",
      },
    });
  });

  it("fails closed when plan work-item classification provenance does not match its draft", () => {
    const store = new PlanStateStore({ now: () => 1_800_000_000_000 });

    expect(() => store.submitPlan(baseInput({
      proposedWorkItems: [classifiedWorkItem({
        workClassificationProvenance: {
          sourceKind: "plan-work-item",
          sourceId: "wi-other",
        },
      })],
    }))).toThrow("Work classification provenance sourceId 'wi-other' must match plan work-item id 'wi-1'");
  });

  it("binds work classification and provenance to approval content hashes", () => {
    const store = new PlanStateStore({ now: () => 1_800_000_000_000 });
    const first = store.submitPlan(baseInput({
      proposedWorkItems: [classifiedWorkItem()],
    }));
    expect(store.approvePlan(first.id).success).toBe(true);

    const revised = store.submitPlan({
      ...baseInput({
        proposedWorkItems: [classifiedWorkItem({
          workClassification: {
            intents: ["review"],
            artifacts: ["document"],
            domains: ["education"],
            effects: ["read-only"],
            modes: ["critique"],
          },
        })],
      }),
      planId: first.id,
    });

    expect(revised.contentHash).not.toBe(first.contentHash);
    expect(revised.approval).toMatchObject({
      status: "superseded",
      planHash: first.contentHash,
      supersededByPlanHash: revised.contentHash,
    });
    expect(store.executionReadiness(first.id)).toMatchObject({
      success: true,
      ready: false,
      code: "approval_hash_mismatch",
    });
  });

  it("does not approve draft or malformed plans", () => {
    const store = new PlanStateStore({ now: () => 1_800_000_000_000 });
    const draft = store.submitPlan({
      ...baseInput(),
      objective: " ",
      proposedWorkItems: [],
    });

    expect(draft.status).toBe("draft");
    expect(store.approvePlan(draft.id)).toMatchObject({
      success: false,
      code: "plan_not_ready_for_approval",
      planId: draft.id,
    });
    expect(store.approvePlan("missing-plan")).toMatchObject({
      success: false,
      code: "plan_not_found",
      planId: "missing-plan",
    });
  });

  it("applies high-control validation by risk and workflow profile", () => {
    const store = new PlanStateStore({ now: () => 1_800_000_000_000 });

    const highRiskDraft = store.submitPlan({
      ...baseInput(),
      riskClassification: "critical",
      workGovernanceRecommendation: {
        posture: "orchestrate",
        rationale: "Critical workflow-control change.",
        workflowProfile: "architecture-change",
      },
      operatorDecisionsRequired: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
    });

    expect(highRiskDraft.status).toBe("draft");
    expect(highRiskDraft.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "missing_operator_decisions",
      "high_risk_approval_boundaries",
      "high_risk_rollback_notes",
      "high_risk_residual_risks",
    ]));

    const lowRiskReady = store.submitPlan(baseInput({
      riskClassification: "low",
      workGovernanceRecommendation: {
        posture: "direct",
        rationale: "Single low-risk documentation correction.",
        workflowProfile: "small-fix",
      },
      operatorDecisionsRequired: [],
      approvalBoundaries: [],
      rollbackNotes: "",
      residualRisks: [],
    }));

    expect(lowRiskReady.status).toBe("ready_for_approval");
    expect(lowRiskReady.issues).toEqual([]);
  });

  it("revisions and rejection keep one plan id without duplication", () => {
    const store = new PlanStateStore({ now: () => 1_800_000_000_000 });
    const first = store.submitPlan(baseInput());
    const second = store.submitPlan({
      ...baseInput(),
      planId: first.id,
      assumptions: ["Session resources are available.", "Tool catalog remains stable."],
    });

    expect(second.id).toBe(first.id);
    expect(store.listPlans()).toHaveLength(1);

    const rejected = store.rejectPlan(first.id, "Need stronger rollback details.");
    expect(rejected).toMatchObject({
      success: true,
      code: "rejected",
      planId: first.id,
    });
    expect(store.listPlans()).toHaveLength(1);
    expect(store.getPlan(first.id)?.approval).toMatchObject({
      status: "rejected",
      rejectionReason: "Need stronger rollback details.",
    });
  });

  it("approves latest ready plan when plan id is omitted", () => {
    const store = new PlanStateStore({ now: () => 1_800_000_000_000 });
    const first = store.submitPlan(baseInput({ objective: "Plan A objective." }));
    const second = store.submitPlan(baseInput({ objective: "Plan B objective." }));

    const result = store.approvePlan();
    expect(result).toMatchObject({
      success: true,
      code: "approved",
      planId: second.id,
    });
    expect(result.success && result.approval.planHash).toBe(second.contentHash);
    expect(store.executionReadiness()).toMatchObject({
      success: true,
      ready: true,
      planId: second.id,
    });
    expect(store.executionReadiness(first.id)).toMatchObject({
      success: true,
      ready: false,
      code: "approval_missing",
      planId: first.id,
    });
  });
});

function baseInput(overrides: Partial<PlanSubmissionInput> = {}): PlanSubmissionInput {
  return {
    objective: "Deliver Slice 4 approval state for session plans.",
    nonGoals: ["No runtime or gateway behavior changes."],
    operatorDecisionsRequired: ["Approve execution only after review."],
    assumptions: ["Session resources are available."],
    affectedSurfaces: ["core/tools/infrastructure"],
    riskClassification: "medium",
    workGovernanceRecommendation: {
      posture: "orchestrate",
      rationale: "Shared session state behavior change.",
      workflowProfile: "verification-heavy",
    },
    proposedWorkItems: [{
      id: "wi-1",
      summary: "Implement content-hash-aware plan approval state.",
      workflowProfile: "verification-heavy",
      risk: "medium",
      expectedEvidence: ["unit-tests"],
      verificationGates: ["bun test"],
      dependencies: [],
    }],
    expectedEvidence: ["unit-tests", "typecheck"],
    verificationGates: ["bun test --filter @kilnai/core"],
    managedAgentDelegationCandidates: [],
    approvalBoundaries: ["Operator approves before execution mode."],
    rollbackNotes: "Revert plan state changes and regenerate plan approval.",
    residualRisks: ["Approval semantics may need CLI surface integration."],
    sourceSpecificationId: "spec-1",
    clarificationRecordIds: [],
    constitutionSnapshot: {
      instructionProfileHash: "profile-hash",
      instructionProfileIds: ["sequel-engineering"],
    },
    ...overrides,
  };
}

interface ClassifiedWorkItemDraftInput {
  readonly workClassification?: {
    readonly intents?: readonly string[];
    readonly artifacts?: readonly string[];
    readonly domains?: readonly string[];
    readonly effects?: readonly string[];
    readonly modes?: readonly string[];
  };
  readonly workClassificationProvenance?: {
    readonly sourceKind: string;
    readonly sourceId: string;
  };
}

function classifiedWorkItem(
  overrides: ClassifiedWorkItemDraftInput = {},
): PlanSubmissionInput["proposedWorkItems"][number] {
  return {
    id: "wi-1",
    summary: "Implement content-hash-aware plan approval state.",
    workflowProfile: "verification-heavy",
    risk: "medium",
    expectedEvidence: ["unit-tests"],
    verificationGates: ["bun test"],
    dependencies: [],
    workClassification: {
      intents: ["write"],
      artifacts: ["document"],
      domains: ["education"],
      effects: ["write-artifact"],
      modes: ["coauthor"],
    },
    workClassificationProvenance: {
      sourceKind: "plan-work-item",
      sourceId: "wi-1",
    },
    ...overrides,
  };
}
