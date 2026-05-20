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
