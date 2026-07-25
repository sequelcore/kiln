import { describe, expect, it } from "vitest";
import {
  deriveGovernedTurnOutcome,
  deriveGovernedTurnOutcomeFromToolRecords,
} from "../../src/session/governed-turn-outcome.js";
import type { GovernedTurnOutcomeToolRecord } from "../../src/session/governed-turn-outcome.js";

function record(input: GovernedTurnOutcomeToolRecord): GovernedTurnOutcomeToolRecord {
  return input;
}

describe("deriveGovernedTurnOutcomeFromToolRecords", () => {
  it("reconciles an incomplete runtime plane with canonical terminal surface closeout", () => {
    const activeGoal = { id: "goal-1", status: "active" };
    const completedGoal = { ...activeGoal, status: "completed" };
    const completedItem = { id: "work-1", status: "completed" };

    expect(deriveGovernedTurnOutcome({
      runtimeToolResults: [record({
        toolName: "work_item.execution.finish",
        success: false,
        metadata: { item: { id: "work-1", status: "in_progress" }, goal: activeGoal },
      })] as never,
      surfaceToolCompletions: [
        record({
          toolName: "work_item.execution.finish",
          success: true,
          metadata: { item: completedItem, attempt: { id: "attempt-2", status: "completed" }, goal: activeGoal },
        }),
        record({
          toolName: "goal.complete",
          success: true,
          metadata: { goal: completedGoal },
        }),
      ],
    })).toBeUndefined();
  });

  it("does not let terminal goal closeout hide an unresolved managed invocation failure", () => {
    const activeGoal = { id: "goal-1", status: "active" };

    expect(deriveGovernedTurnOutcome({
      runtimeToolResults: [record({
        toolName: "managed_agent.invoke",
        success: false,
        metadata: { kind: "managed-invocation", status: "timed-out", goal: activeGoal },
      })] as never,
      surfaceToolCompletions: [record({
        toolName: "goal.complete",
        success: true,
        metadata: { goal: { ...activeGoal, status: "completed" } },
      })],
    })).toBe("failed");
  });

  it("treats goal evidence and completion as terminal recovery after work completion", () => {
    const completedItem = { id: "work-1", status: "completed" };
    const activeGoal = { id: "goal-1", status: "active" };

    expect(deriveGovernedTurnOutcomeFromToolRecords([
      record({
        toolName: "work_item.execution.start",
        success: true,
        metadata: { item: { id: "work-1", status: "in_progress" }, attempt: { id: "attempt-1" } },
      }),
      record({
        toolName: "work_item.execution.finish",
        success: true,
        metadata: { item: completedItem, attempt: { id: "attempt-1", status: "completed" }, goal: activeGoal },
      }),
      record({
        toolName: "goal.evidence.record",
        success: true,
        metadata: { goal: activeGoal },
      }),
      record({
        toolName: "goal.complete",
        success: true,
        metadata: { goal: { ...activeGoal, status: "completed" } },
      }),
    ])).toBeUndefined();
  });

  it("keeps an evidence-updated goal failed until goal.complete closes it", () => {
    const activeGoal = {
      id: "goal-1",
      status: "active",
    };
    const recorded = record({
      toolName: "goal.evidence.record",
      success: true,
      metadata: { kind: "goal", operation: "record_evidence", goal: activeGoal },
    });

    expect(deriveGovernedTurnOutcomeFromToolRecords([recorded])).toBe("failed");
    expect(deriveGovernedTurnOutcomeFromToolRecords([
      recorded,
      record({
        toolName: "goal.complete",
        success: true,
        metadata: {
          kind: "goal",
          operation: "complete",
          goal: { ...activeGoal, status: "completed" },
        },
      }),
    ])).toBeUndefined();
  });

  it("does not fail a completed research turn only because governance recommended orchestration", () => {
    expect(deriveGovernedTurnOutcomeFromToolRecords([
      record({
        toolName: "work_governance.assess",
        success: true,
        output: [
          "recommendation: orchestrate",
          "reasons: default posture is orchestrate; delegation trigger matched: architecture, cross-surface",
        ].join("\n"),
      }),
      record({
        toolName: "web_search",
        success: true,
        output: "5 sources for native local search tools",
      }),
      record({
        toolName: "grep",
        success: true,
        output: "packages/core/src/tools/domain/tool.ts",
      }),
      record({
        toolName: "read",
        success: true,
        output: "export const TOOL_SCHEMAS = ...",
      }),
      record({
        toolName: "web_extract",
        success: true,
        output: "Full tool output is available as resource links",
      }),
    ])).toBeUndefined();
  });

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

  // Roadmap 01 (External Runtime Governance), Slice 0 - Failing Trace Fixture.
  // Third regression proof: "failed calls cannot support positive verification
  // claims." isWorkGovernanceToolName() only recognizes the fixed governance tool
  // set (work_governance.assess, goal.*, work_item.*); any other tool name -
  // including a parent's own direct external-runtime MCP calls such as
  // navigate_actor - is invisible to this derivation regardless of success. A
  // parent that bypasses managed invocation and calls external-runtime tools
  // directly (as the incident this fixture encodes did) can have every single
  // call fail without that ever surfacing as a non-"completed" outcome. Expected
  // to fail until Roadmap 01 Slice 1 (Evidence Realization Contract) makes raw
  // tool failures for admitted capability tools count as governance evidence;
  // this .fails must flip to a plain `it` once that lands.
  it.fails(
    "does not let four failed external-runtime navigation calls produce a completed outcome",
    () => {
      const failedNavigationCalls: readonly GovernedTurnOutcomeToolRecord[] = [
        "objective-a",
        "objective-a-retry",
        "objective-b",
        "objective-b-retry",
      ].map((label) => record({
        toolName: "mcp:external-runtime:tool:navigate_actor",
        success: false,
        metadata: { target: label, error: "navigation target unreachable" },
      }));

      expect(deriveGovernedTurnOutcomeFromToolRecords(failedNavigationCalls)).not.toBe(undefined);
    },
  );
});
