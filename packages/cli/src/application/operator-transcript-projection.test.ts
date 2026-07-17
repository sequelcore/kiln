import { describe, expect, it } from "vitest";
import { buildOperatorToolResultPayload } from "@kilnai/gateway-contracts";
import {
  operatorTranscriptSourceForEntry,
  projectGovernanceTranscriptEventDrafts,
  projectOperatorTranscriptEntryToDraft,
} from "./operator-transcript-projection.js";

describe("operator transcript projection", () => {
  it("projects tool result envelopes into operator transcript payloads", () => {
    const payload = buildOperatorToolResultPayload({
      toolCallId: "call-1",
      toolName: "managed_agent.invoke",
      output: JSON.stringify({
        output: "child completed",
        metadata: {
          invocationId: "managed-1",
          status: "completed",
        },
      }),
      outputSummary: "summary",
    });

    expect(payload).toEqual({
      toolCallId: "call-1",
      toolName: "managed_agent.invoke",
      output: "child completed",
      outputSummary: "summary",
      metadata: {
        invocationId: "managed-1",
        status: "completed",
      },
      status: {
        state: "succeeded",
      },
    });
  });

  it("projects runtime tool results into canonical transcript drafts", () => {
    const event = {
      type: "tool_result" as const,
      toolName: "managed_agent.invoke",
      output: JSON.stringify({
        output: "done",
        metadata: {
          invocationId: "managed-1",
        },
      }),
    };

    const draft = projectOperatorTranscriptEntryToDraft({
      eventId: "event-1",
      kilnSessionId: "session-1",
      timestamp: "2026-06-30T00:00:00.000Z",
      event,
      source: operatorTranscriptSourceForEntry(event, "cli", "run-command"),
    });

    expect(draft).toEqual({
      eventId: "event-1",
      kilnSessionId: "session-1",
      timestamp: "2026-06-30T00:00:00.000Z",
      kind: "tool_call_completed",
      source: {
        actor: "tool",
        surface: "cli",
        component: "run-command",
      },
      payload: {
        type: "tool_result",
        toolCallId: "event-1",
        toolName: "managed_agent.invoke",
        output: "done",
        outputSummary: "done",
        metadata: {
          invocationId: "managed-1",
        },
        status: {
          state: "succeeded",
        },
      },
    });
  });

  it("preserves rich runtime tool-result evidence in canonical transcript drafts", () => {
    const event = {
      type: "tool_result" as const,
      toolCallId: "call-rich",
      toolName: "managed_agent.invoke",
      output: "child completed",
      metadata: {
        invocationId: "managed-1",
        routeId: "codex-oauth-auto-review-readonly",
      },
      resourceLinks: [{
        uri: "kiln://managed-invocations/managed-1/transcript",
        title: "Transcript",
        relation: "events",
      }],
      toolUsage: {
        scope: "turn" as const,
        toolName: "managed_agent.invoke",
        calls: 1,
      },
    };

    const draft = projectOperatorTranscriptEntryToDraft({
      eventId: "event-rich",
      kilnSessionId: "session-1",
      timestamp: "2026-06-30T00:00:00.000Z",
      event,
      source: operatorTranscriptSourceForEntry(event, "cli", "run-command"),
    });

    expect(draft.payload).toMatchObject({
      type: "tool_result",
      toolCallId: "call-rich",
      toolName: "managed_agent.invoke",
      output: "child completed",
      metadata: {
        invocationId: "managed-1",
        routeId: "codex-oauth-auto-review-readonly",
      },
      resourceLinks: [{
        uri: "kiln://managed-invocations/managed-1/transcript",
        title: "Transcript",
        relation: "events",
      }],
      toolUsage: {
        scope: "turn",
        toolName: "managed_agent.invoke",
        calls: 1,
      },
    });
  });

  it("projects work-item and terminal goal snapshots into canonical lifecycle drafts", () => {
    const source = { actor: "tool", surface: "gui", component: "gui-command" } as const;
    const toolResult = projectOperatorTranscriptEntryToDraft({
      eventId: "event-finish",
      kilnSessionId: "session-1",
      timestamp: "2026-07-15T20:00:00.000Z",
      event: {
        type: "tool_result",
        toolCallId: "call-finish",
        toolName: "work_item.execution.finish",
        output: "completed",
        metadata: {
          kind: "work_item",
          operation: "execution_finished",
          item: {
            id: "work-1",
            summary: "Finish governed work.",
            status: "completed",
          },
          attempt: { id: "attempt-1" },
          goal: {
            id: "goal-1",
            objective: "Finish governed work.",
            status: "completed",
            closeoutSummary: "All governed work completed.",
          },
        },
      },
      source,
    });

    expect(projectGovernanceTranscriptEventDrafts(toolResult)).toEqual([
      expect.objectContaining({
        eventId: "event-finish:work-item",
        kind: "work_item_execution_finished",
        payload: expect.objectContaining({
          toolCallId: "call-finish",
          workItem: expect.objectContaining({ id: "work-1", status: "completed" }),
        }),
      }),
      expect.objectContaining({
        eventId: "event-finish:goal",
        kind: "goal.completed",
        payload: {
          goal: expect.objectContaining({ id: "goal-1", status: "completed" }),
          closeoutSummary: "All governed work completed.",
        },
      }),
    ]);
  });
});
