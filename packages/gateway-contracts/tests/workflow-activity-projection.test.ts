import { describe, expect, it } from "vitest";
import type { OperatorSessionEvent } from "../src/frames.js";
import { projectWorkflowActivity } from "../src/workflow-activity-projection.js";

function event(
  sequence: number,
  kind: OperatorSessionEvent["kind"],
  payload: Record<string, unknown>,
): OperatorSessionEvent {
  return {
    eventId: `event-${sequence}`,
    kilnSessionId: "session-1",
    sequence,
    timestamp: `2026-07-15T18:13:${String(sequence).padStart(2, "0")}.000Z`,
    kind,
    turnId: "turn-1",
    source: { actor: kind.startsWith("tool_") ? "tool" : "runtime", surface: "runtime" },
    payload,
  };
}

function workItem(id: string, status: string, providedEvidence: readonly string[] = []) {
  return {
    id,
    summary: `Inspect ${id}`,
    status,
    workflowProfile: "verification-heavy",
    risk: "low",
    surface: "gui",
    authorityProfile: "read-only",
    expectedEvidence: ["surface-map", "tests"],
    providedEvidence,
    pauseRequirements: [],
    executionAttempts: [],
  };
}

describe("workflow activity projection", () => {
  it("materializes one live goal container and replaces work item snapshots by identity", () => {
    const projection = projectWorkflowActivity([
      event(1, "tool_call_started", {
        toolCallId: "work-update-1",
        toolName: "work_item.update",
        input: { id: null },
      }),
      event(2, "tool_call_completed", {
        toolCallId: "work-update-1",
        toolName: "work_item.update",
        metadata: { kind: "work_item", operation: "update", id: "work-1", item: workItem("work-1", "pending") },
        status: { state: "succeeded" },
      }),
      event(3, "tool_call_completed", {
        toolCallId: "goal-create-1",
        toolName: "goal.create",
        metadata: {
          kind: "goal",
          operation: "create",
          id: "goal-1",
          goal: {
            id: "goal-1",
            objective: "Inspect the GUI",
            status: "active",
            workItemIds: ["work-1"],
            evidenceRequirements: [],
          },
        },
        status: { state: "succeeded" },
      }),
      event(4, "tool_call_completed", {
        toolCallId: "work-update-2",
        toolName: "work_item.update",
        metadata: {
          kind: "work_item",
          operation: "update",
          id: "work-1",
          item: workItem("work-1", "completed", ["surface-map", "tests"]),
        },
        status: { state: "succeeded" },
      }),
    ]);

    expect(projection.goals).toHaveLength(1);
    expect(projection.goals[0]?.goal.id).toBe("goal-1");
    expect(projection.goals[0]).toMatchObject({
      status: "blocked",
      statusReason: "Goal closeout is missing",
    });
    expect(projection.goals[0]?.workItems).toHaveLength(1);
    expect(projection.goals[0]?.workItems[0]?.item).toMatchObject({
      id: "work-1",
      status: "completed",
      evidence: [
        { label: "surface-map", status: "completed" },
        { label: "tests", status: "completed" },
      ],
    });
    expect(projection.standaloneWorkItems).toEqual([]);
    expect(projection.consumedEventIds).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
    ]);
  });

  it("replaces the active goal snapshot with the terminal execution result", () => {
    const projection = projectWorkflowActivity([
      event(1, "tool_call_completed", {
        toolCallId: "goal-create-1",
        toolName: "goal.create",
        metadata: {
          kind: "goal",
          operation: "create",
          goal: {
            id: "goal-1",
            objective: "Inspect the GUI",
            status: "active",
            workItemIds: ["work-1"],
            evidenceRequirements: [],
          },
        },
        status: { state: "succeeded" },
      }),
      event(2, "tool_call_completed", {
        toolCallId: "work-finish-1",
        toolName: "work_item.execution.finish",
        metadata: {
          kind: "work_item",
          operation: "execution_finished",
          item: workItem("work-1", "completed", ["surface-map", "tests"]),
          goal: {
            id: "goal-1",
            objective: "Inspect the GUI",
            status: "completed",
            workItemIds: ["work-1"],
            evidenceRequirements: [],
          },
        },
        status: { state: "succeeded" },
      }),
    ]);

    expect(projection.goals[0]).toMatchObject({
      goal: { id: "goal-1", status: "completed" },
      status: "completed",
    });
  });

  it("coalesces tool lifecycle events and correlates them only through explicit execution evidence", () => {
    const projection = projectWorkflowActivity([
      event(1, "work_item_execution_started", {
        workItem: { ...workItem("work-1", "in_progress"), goalRunId: "goal-1" },
        attempt: {
          id: "attempt-1",
          workItemId: "work-1",
          goalRunId: "goal-1",
          status: "started",
          executionMode: "managed_delegation",
          managedInvocationId: "invocation-1",
        },
      }),
      event(2, "tool_call_started", {
        toolCallId: "read-1",
        toolName: "read",
        managedInvocationId: "invocation-1",
        input: { filePath: "packages/gui/src/components/transcript.tsx" },
      }),
      event(3, "tool_call_completed", {
        toolCallId: "read-1",
        toolName: "read",
        managedInvocationId: "invocation-1",
        outputSummary: "Read transcript.tsx",
        status: { state: "succeeded" },
      }),
      event(4, "tool_call_completed", {
        toolCallId: "read-unscoped",
        toolName: "read",
        outputSummary: "Read unrelated file",
        status: { state: "succeeded" },
      }),
    ]);

    const item = projection.standaloneWorkItems[0];
    expect(item?.attempts).toHaveLength(1);
    expect(item?.attempts[0]).toMatchObject({
      id: "attempt-1",
      managedInvocationId: "invocation-1",
      toolCalls: [{ toolCallId: "read-1", toolName: "read", state: "completed" }],
    });
    expect(projection.unscopedToolCalls).toMatchObject([
      { toolCallId: "read-unscoped", toolName: "read", state: "completed" },
    ]);
  });

  it("claims explicitly scoped tool events for their work item without temporal inference", () => {
    const scope = { kind: "work_item", goalRunId: "goal-1", workItemId: "work-1" } as const;
    const projection = projectWorkflowActivity([
      event(1, "tool_call_completed", {
        toolCallId: "work-update-1",
        toolName: "work_item.update",
        metadata: { kind: "work_item", operation: "update", id: "work-1", item: workItem("work-1", "in_progress") },
        status: { state: "succeeded" },
      }),
      { ...event(2, "tool_call_started", { toolCallId: "read-1", toolName: "read" }), executionScope: scope },
      { ...event(3, "tool_call_completed", {
        toolCallId: "read-1",
        toolName: "read",
        outputSummary: "Read transcript.tsx",
        status: { state: "succeeded" },
      }), executionScope: scope },
    ]);

    expect(projection.standaloneWorkItems[0]?.toolCalls).toMatchObject([
      { toolCallId: "read-1", toolName: "read", state: "completed" },
    ]);
    expect(projection.unscopedToolCalls).toEqual([]);
    expect(projection.consumedEventIds).toEqual(["event-1", "event-2", "event-3"]);
  });
});
