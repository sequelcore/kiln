import { describe, expect, it } from "vitest";
import type { OperatorSessionEvent } from "../src/frames.js";
import {
  applyOperatorSessionEvent,
  projectOperatorSessionEvents,
  projectedEventsForSurface,
} from "../src/operator-session-projection.js";

function event(eventId: string, sequence: number, kind: OperatorSessionEvent["kind"], payload: Record<string, unknown>): OperatorSessionEvent {
  return { eventId, kilnSessionId: "session", sequence, timestamp: `2026-08-25T08:00:0${sequence}.000Z`, kind, payload };
}

describe("operator session projection", () => {
  it("produces identical semantics for ordered batch and out-of-order incremental delivery", () => {
    const events = [
      event("approval-1", 1, "approval_requested", { approvalId: "one", action: "write" }),
      event("approval-2", 2, "approval_requested", { approvalId: "two", action: "execute" }),
      event("resolved-1", 3, "approval_resolved", { approvalId: "one", resolution: { decision: "approved" } }),
      event("tool-start", 4, "tool_call_started", { toolCallId: "call", toolCallScopeId: "turn", toolName: "read" }),
      event("tool-done", 5, "tool_call_completed", { toolCallId: "call", toolCallScopeId: "turn", toolName: "read" }),
      event("cost", 6, "cost_updated", { cost: { deltaUsd: 0.25 }, usage: { inputTokens: 10, outputTokens: 5 } }),
      event("file", 7, "file_changed", { path: "src/a.ts", changeType: "updated" }),
      event("continuity", 8, "continuity_decided", { decision: "reuse" }),
      event("goal", 9, "goal.updated", { goalId: "goal" }),
      event("work", 10, "work_item_updated", { workItemId: "work" }),
      event("terminal", 11, "turn_completed", { outcome: "completed" }),
    ];
    const batch = projectOperatorSessionEvents(events);
    const incremental = [events[7]!, events[1]!, ...events, events[0]!]
      .reduce(applyOperatorSessionEvent, projectOperatorSessionEvents([]));

    expect(incremental).toEqual(batch);
    expect(batch.pendingApprovals.map((entry) => entry.approvalId)).toEqual(["two"]);
    expect(batch).toMatchObject({
      toolCalls: [{ status: "completed" }],
      changedFiles: [{ path: "src/a.ts", changeType: "modified" }],
      totalCostUsd: 0.25,
      inputTokens: 10,
      outputTokens: 5,
      lastContinuityEventId: "continuity",
      terminalOutcome: "completed",
      goalEventIds: ["goal"],
      workItemEventIds: ["work"],
    });
    expect(projectedEventsForSurface(batch, "activity_panel")).toHaveLength(events.length);
  });

  it("fails closed when approval or tool identity is missing", () => {
    const projection = projectOperatorSessionEvents([
      event("approval", 1, "approval_requested", { action: "write" }),
      event("resolved", 2, "approval_resolved", { resolution: { decision: "approved" } }),
      event("tool", 3, "tool_call_started", { toolCallId: "call" }),
    ]);
    expect(projection.pendingApprovals).toEqual([]);
    expect(projection.toolCalls).toEqual([]);
  });
});
