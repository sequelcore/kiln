import { describe, expect, it } from "vitest";
import { deriveGovernedTurnOutcomeFromToolRecords } from "../../src/session/governed-turn-outcome.js";
import type { GovernedTurnOutcomeToolRecord } from "../../src/session/governed-turn-outcome.js";

function record(input: GovernedTurnOutcomeToolRecord): GovernedTurnOutcomeToolRecord {
  return input;
}

describe("deriveGovernedTurnOutcomeFromToolRecords", () => {
  it("keeps managed recovery blocked until the required work_item.update call records phase evidence", () => {
    const failedStart = record({
      toolName: "work_item.execution.start",
      success: false,
      metadata: {
        operation: "managed_invocation_failed",
        managedInvocationRecovery: {
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["visual-reference-research"],
        },
      },
    });

    expect(deriveGovernedTurnOutcomeFromToolRecords([failedStart])).toBe("failed");
    expect(deriveGovernedTurnOutcomeFromToolRecords([
      failedStart,
      record({
        toolName: "work_item.update",
        success: true,
        metadata: {
          id: "work-1",
          item: {
            id: "work-1",
            status: "pending",
            providedEvidence: ["visual-reference-research"],
            pauseRequirements: [],
          },
        },
      }),
    ])).toBeUndefined();
  });

  it("keeps explicit managed invocation timeout recovery blocked until work_item.update records phase evidence", () => {
    const timedOutChild = record({
      toolName: "managed_agent.invoke",
      success: false,
      metadata: {
        kind: "managed-invocation",
        status: "timed-out",
        managedInvocationRecovery: {
          nextTool: "work_item.update",
          workItemId: "work-ui",
          evidenceToRecord: ["visual-reference-research"],
        },
      },
    });

    expect(deriveGovernedTurnOutcomeFromToolRecords([timedOutChild])).toBe("failed");
    expect(deriveGovernedTurnOutcomeFromToolRecords([
      timedOutChild,
      record({
        toolName: "work_item.update",
        success: true,
        metadata: {
          id: "work-ui",
          item: {
            id: "work-ui",
            status: "pending",
            providedEvidence: ["visual-reference-research"],
            pauseRequirements: [],
          },
        },
      }),
    ])).toBeUndefined();
  });

  it("keeps non-substantive managed handoff recovery blocked until work_item.update records phase evidence", () => {
    const noHandoffChild = record({
      toolName: "managed_agent.invoke",
      success: false,
      metadata: {
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          nextTool: "work_item.update",
          workItemId: "work-ui",
          evidenceToRecord: ["visual-reference-research"],
        },
      },
    });

    expect(deriveGovernedTurnOutcomeFromToolRecords([noHandoffChild])).toBe("failed");
    expect(deriveGovernedTurnOutcomeFromToolRecords([
      noHandoffChild,
      record({
        toolName: "work_item.update",
        success: true,
        metadata: {
          id: "work-ui",
          item: {
            id: "work-ui",
            status: "pending",
            providedEvidence: ["visual-reference-research"],
            pauseRequirements: [],
          },
        },
      }),
    ])).toBeUndefined();
  });

  it("keeps final managed invocation failure blocked after work_item.execution.fail records missing evidence", () => {
    const timedOutChild = record({
      toolName: "managed_agent.invoke",
      success: false,
      metadata: {
        kind: "managed-invocation",
        status: "timed-out",
        managedInvocationRecovery: {
          nextTool: "work_item.execution.fail",
          goalRunId: "goal-final",
          workItemId: "work-final",
          evidenceToRecord: ["managed-orchestration:result-handoff"],
        },
      },
    });

    expect(deriveGovernedTurnOutcomeFromToolRecords([timedOutChild])).toBe("failed");
    expect(deriveGovernedTurnOutcomeFromToolRecords([
      timedOutChild,
      record({
        toolName: "work_item.execution.fail",
        success: false,
        metadata: {
          id: "work-final",
          item: {
            id: "work-final",
            status: "blocked",
            expectedEvidence: ["managed-orchestration:result-handoff"],
            providedEvidence: [],
            missingEvidence: ["managed-orchestration:result-handoff"],
            pauseRequirements: [],
          },
        },
      }),
    ])).toBe("failed");
  });

  it("does not clear managed failure recovery with a different execution attempt", () => {
    const timedOutChild = record({
      toolName: "managed_agent.invoke",
      success: false,
      metadata: {
        kind: "managed-invocation",
        status: "timed-out",
        managedInvocationRecovery: {
          nextTool: "work_item.execution.fail",
          workItemId: "work-final",
          workItemExecutionFailInputTemplate: {
            workItemId: "work-final",
            attemptId: "goal-final:work-final:attempt:2",
          },
        },
      },
    });

    expect(deriveGovernedTurnOutcomeFromToolRecords([
      timedOutChild,
      record({
        toolName: "work_item.execution.fail",
        success: false,
        metadata: {
          id: "work-final",
          attempt: {
            id: "goal-final:work-final:attempt:1",
          },
          item: {
            id: "work-final",
            status: "blocked",
            providedEvidence: [],
            pauseRequirements: [],
          },
        },
      }),
      record({
        toolName: "work_item.complete",
        success: true,
        metadata: {
          id: "work-final",
          item: {
            id: "work-final",
            status: "completed",
            providedEvidence: ["managed-orchestration:result-handoff"],
            pauseRequirements: [],
          },
        },
      }),
    ])).toBe("failed");
  });

  it("treats unavailable managed invocations as terminal blocking failures", () => {
    const unavailableChild = record({
      toolName: "managed_agent.invoke",
      success: false,
      metadata: {
        kind: "managed-invocation",
        status: "unavailable",
      },
    });

    expect(deriveGovernedTurnOutcomeFromToolRecords([unavailableChild])).toBe("failed");
  });

  it("treats route/profile managed invocation conflicts as terminal blocking failures", () => {
    const routeConflict = record({
      toolName: "managed_agent.invoke",
      success: false,
      metadata: {
        kind: "managed-invocation",
        status: "route_profile_conflict",
        nextTool: "managed_agent.invoke",
        retryInputTemplate: {
          routeId: "opencode-readonly",
          forbiddenInputFields: ["agentProfile"],
        },
      },
    });

    expect(deriveGovernedTurnOutcomeFromToolRecords([routeConflict])).toBe("failed");
  });

  it("treats denied managed invocation context admission as a terminal blocking failure", () => {
    const deniedChild = record({
      toolName: "managed_agent.invoke",
      success: false,
      metadata: {
        kind: "managed-invocation",
        status: "denied",
        context: {
          mode: "isolated",
          agentProfile: "architecture-reviewer",
          skills: ["workspace-write"],
          deniedSkills: ["workspace-write"],
        },
      },
    });

    expect(deriveGovernedTurnOutcomeFromToolRecords([deniedChild])).toBe("failed");
  });

  it("does not close a started execution with a different attempt finish", () => {
    expect(deriveGovernedTurnOutcomeFromToolRecords([
      record({
        toolName: "work_item.execution.start",
        success: true,
        metadata: {
          id: "work-final",
          attempt: {
            id: "goal-final:work-final:attempt:2",
            workItemId: "work-final",
          },
        },
      }),
      record({
        toolName: "work_item.execution.finish",
        success: true,
        metadata: {
          attempt: {
            id: "goal-final:work-final:attempt:1",
          },
          item: {
            id: "work-final",
            status: "completed",
          },
        },
      }),
    ])).toBe("failed");
  });

  it("allows work_item.complete to close an attempt-bearing started execution", () => {
    expect(deriveGovernedTurnOutcomeFromToolRecords([
      record({
        toolName: "work_item.execution.start",
        success: true,
        metadata: {
          attempt: {
            id: "goal-final:work-final:attempt:2",
          },
        },
      }),
      record({
        toolName: "work_item.complete",
        success: true,
        metadata: {
          id: "work-final",
          item: {
            id: "work-final",
            status: "completed",
          },
        },
      }),
    ])).toBeUndefined();
  });

  it("does not close a started execution with another work item's completion", () => {
    expect(deriveGovernedTurnOutcomeFromToolRecords([
      record({
        toolName: "work_item.execution.start",
        success: true,
        metadata: {
          id: "work-open",
          item: {
            id: "work-open",
            status: "in_progress",
          },
          attempt: {
            id: "goal:work-open:attempt:1",
            workItemId: "work-open",
          },
        },
      }),
      record({
        toolName: "work_item.complete",
        success: true,
        metadata: {
          id: "work-other",
          item: {
            id: "work-other",
            status: "completed",
          },
        },
      }),
    ])).toBe("failed");
  });

  it("keeps successful managed phase completion blocked until work_item.update records phase evidence", () => {
    const completedChild = record({
      toolName: "managed_agent.invoke",
      success: true,
      metadata: {
        kind: "managed-invocation",
        status: "completed",
        managedInvocationPhaseCompletion: {
          status: "phase_completed_by_child",
          nextTool: "work_item.update",
          workItemId: "work-ui",
          evidenceToRecord: ["visual-reference-research"],
        },
      },
    });

    expect(deriveGovernedTurnOutcomeFromToolRecords([completedChild])).toBe("failed");
    expect(deriveGovernedTurnOutcomeFromToolRecords([
      completedChild,
      record({
        toolName: "work_item.update",
        success: true,
        metadata: {
          id: "work-ui",
          item: {
            id: "work-ui",
            status: "pending",
            providedEvidence: ["visual-reference-research"],
            pauseRequirements: [],
          },
        },
      }),
    ])).toBeUndefined();
  });

  it("keeps visual-reference browser research blocked until work_item.update records the phase evidence", () => {
    const openUiWork = record({
      toolName: "work_item.update",
      success: true,
      metadata: {
        id: "work-ui",
        item: {
          id: "work-ui",
          status: "pending",
          expectedEvidence: ["visual-reference-research", "plan"],
          providedEvidence: [],
          pauseRequirements: [],
        },
      },
    });
    const browserResearch = record({
      toolName: "browser_observe",
      success: true,
      output: "browser_observe screenshot: kiln://artifacts/interactive-screenshots/artifact_20/content",
    });
    const terminalPlan = record({
      toolName: "submit_plan",
      success: true,
      output: "{\"planId\":\"plan-1\"}",
    });

    expect(deriveGovernedTurnOutcomeFromToolRecords([
      record({
        toolName: "work_governance.assess",
        success: true,
        output: "recommendation: orchestrate",
      }),
      openUiWork,
      browserResearch,
      terminalPlan,
    ])).toBe("failed");

    expect(deriveGovernedTurnOutcomeFromToolRecords([
      record({
        toolName: "work_governance.assess",
        success: true,
        output: "recommendation: orchestrate",
      }),
      openUiWork,
      browserResearch,
      record({
        toolName: "work_item.update",
        success: true,
        metadata: {
          id: "work-ui",
          item: {
            id: "work-ui",
            status: "pending",
            expectedEvidence: ["visual-reference-research", "plan"],
            providedEvidence: ["visual-reference-research"],
            pauseRequirements: [],
          },
        },
      }),
      terminalPlan,
    ])).toBeUndefined();
  });
});
