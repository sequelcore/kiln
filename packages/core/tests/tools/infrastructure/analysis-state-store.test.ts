import { describe, expect, it } from "vitest";
import {
  AnalysisStateStore,
  type AnalysisFinding,
} from "../../../src/tools/infrastructure/analysis-state-store.js";
import type { SessionPlan } from "../../../src/tools/infrastructure/plan-state-store.js";
import type { SessionSpecification } from "../../../src/tools/infrastructure/specification-state-store.js";

describe("analysis state store", () => {
  it("keeps finding identity stable across plan revisions for the same specification", () => {
    const store = new AnalysisStateStore({ now: () => 1_800_000_000_000 });
    const specification = baseSpecification();

    const first = store.analyzePlan({
      specification,
      plan: basePlan({
        id: "plan-1",
        proposedWorkItems: [workItem({ id: "wi-1", summary: "Unrelated implementation task." })],
      }),
    });
    const second = store.analyzePlan({
      specification,
      plan: basePlan({
        id: "plan-2",
        proposedWorkItems: [workItem({ id: "wi-1", summary: "Unrelated implementation task." })],
      }),
    });

    expect(first.report.findingIds).toHaveLength(1);
    expect(second.report.findingIds).toHaveLength(1);
    expect(second.report.findingIds[0]).toBe(first.report.findingIds[0]);

    const finding = store.getFinding(first.report.findingIds[0]!);
    expect(finding?.references).toContain("plan:plan-1");
    expect(finding?.references).toContain("plan:plan-2");
    expect(finding?.status).toBe("open");
  });

  it("notifies per-finding resources when findings are closed by a clean revision", () => {
    const notifications: string[] = [];
    const store = new AnalysisStateStore({
      now: () => 1_800_000_000_000,
      resourceNotifications: {
        notifyResourceUpdated(uri: string): void {
          notifications.push(uri);
        },
        notifyResourceListChanged(): void {},
      },
    });
    const specification = baseSpecification();

    const first = store.analyzePlan({
      specification,
      plan: basePlan({
        id: "plan-1",
        assumptions: [],
        proposedWorkItems: [workItem({ id: "wi-1", summary: "Handle criterion validation." })],
      }),
    });
    expect(first.report.findingIds).toHaveLength(1);
    const findingId = first.report.findingIds[0]!;
    notifications.length = 0;

    const second = store.analyzePlan({
      specification,
      plan: basePlan({
        id: "plan-2",
        assumptions: ["Assumption is explicit."],
        proposedWorkItems: [workItem({ id: "wi-2", summary: "Handle criterion validation." })],
      }),
    });

    expect(second.report.findingIds).toHaveLength(0);
    const finding = store.getFinding(findingId);
    expect(finding?.status).toBe("closed");
    expect(finding?.supersededByReportId).toBe(second.report.id);
    expect(notifications).toContain(`kiln://session/analysis-findings/${findingId}`);
  });

  it("supersedes changed findings without losing the original history", () => {
    const store = new AnalysisStateStore({ now: () => 1_800_000_000_000 });
    const first = store.analyzePlan({
      specification: baseSpecification({
        successCriteria: ["First requirement coverage"],
      }),
      plan: basePlan({
        id: "plan-1",
        proposedWorkItems: [workItem({ id: "wi-1", summary: "Unrelated implementation task." })],
      }),
    });
    const originalFindingId = first.report.findingIds[0]!;

    const second = store.analyzePlan({
      specification: baseSpecification({
        successCriteria: ["Second requirement coverage"],
      }),
      plan: basePlan({
        id: "plan-2",
        proposedWorkItems: [workItem({ id: "wi-1", summary: "Unrelated implementation task." })],
      }),
    });

    expect(second.report.findingIds).toHaveLength(1);
    expect(second.report.findingIds[0]).not.toBe(originalFindingId);
    expect(store.getFinding(originalFindingId)).toMatchObject({
      status: "superseded",
      supersededByReportId: second.report.id,
    });
  });

  it("flags dependency cycles as critical task-order inconsistencies", () => {
    const store = new AnalysisStateStore({ now: () => 1_800_000_000_000 });
    const specification = baseSpecification();
    const result = store.analyzePlan({
      specification,
      plan: basePlan({
        proposedWorkItems: [
          workItem({ id: "a", summary: "Work item A.", dependencies: ["b"] }),
          workItem({ id: "b", summary: "Work item B.", dependencies: ["a"] }),
        ],
      }),
    });

    expect(result.report.status).toBe("blocked");
    const cycleFinding = result.findings.find((finding) => finding.title === "Work Item Dependency Cycle");
    expect(cycleFinding).toBeDefined();
    expect(cycleFinding).toMatchObject<Partial<AnalysisFinding>>({
      category: "task_order_inconsistency",
      severity: "critical",
      status: "blocked",
    });
    expect(cycleFinding?.detail).toContain("a -> b -> a");
  });

  it("reports plan-level evidence that is not covered by proposed work items", () => {
    const store = new AnalysisStateStore({ now: () => 1_800_000_000_000 });
    const result = store.analyzePlan({
      specification: baseSpecification(),
      plan: basePlan({
        expectedEvidence: ["typecheck"],
        proposedWorkItems: [
          workItem({
            id: "wi-1",
            summary: "Criterion token coverage implementation.",
            expectedEvidence: ["unit tests"],
          }),
        ],
      }),
    });

    expect(result.findings).toContainEqual(expect.objectContaining({
      category: "evidence_mismatch",
      severity: "high",
      title: "Plan Evidence Lacks Work Item Coverage",
      status: "open",
    }));
  });
});

function baseSpecification(overrides: Partial<SessionSpecification> = {}): SessionSpecification {
  return {
    id: "spec-1",
    title: "Test specification",
    objective: "Ship deterministic plan analysis.",
    nonGoals: ["No implementation side effects in planning."],
    successCriteria: ["Criterion token coverage"],
    actors: [],
    dataLifecycle: "Session-scoped resources only.",
    uxEdgeCases: [],
    securityPrivacy: "No secrets.",
    externalDependencies: [],
    completionSignals: [],
    constitutionSnapshot: {
      instructionProfileHash: "hash-1",
      instructionProfileIds: ["sequel-engineering"],
    },
    clarificationIds: [],
    issues: [],
    status: "ready_for_plan",
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
    sequence: 1,
    ...overrides,
  };
}

function basePlan(overrides: Partial<SessionPlan> = {}): SessionPlan {
  return {
    id: "plan-1",
    objective: "Deliver the requested plan changes.",
    nonGoals: ["Do not execute implementation during plan mode."],
    operatorDecisionsRequired: ["Approve before execute mode."],
    assumptions: ["Runtime stores are available."],
    affectedSurfaces: ["runtime", "core"],
    riskClassification: "high",
    workGovernanceRecommendation: {
      posture: "orchestrate",
      rationale: "Cross-surface change.",
      workflowProfile: "architecture-change",
    },
    proposedWorkItems: [workItem({ id: "wi-1", summary: "Criterion token coverage implementation." })],
    expectedEvidence: ["tests"],
    verificationGates: ["bun test", "bun run typecheck"],
    managedAgentDelegationCandidates: [],
    approvalBoundaries: ["Operator approval before execute transition."],
    rollbackNotes: "Revert plan-gate changes if needed.",
    residualRisks: [],
    sourceSpecificationId: "spec-1",
    clarificationRecordIds: [],
    constitutionSnapshot: {
      instructionProfileHash: "hash-1",
      instructionProfileIds: ["sequel-engineering"],
    },
    contentHash: "sha256:plan",
    status: "ready_for_approval",
    issues: [],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
    sequence: 1,
    ...overrides,
  };
}

function workItem(overrides: Partial<SessionPlan["proposedWorkItems"][number]>): SessionPlan["proposedWorkItems"][number] {
  return {
    id: "wi",
    summary: "Default work item summary.",
    workflowProfile: "architecture-change",
    risk: "high",
    expectedEvidence: ["tests"],
    verificationGates: ["bun test"],
    dependencies: [],
    ...overrides,
  };
}
