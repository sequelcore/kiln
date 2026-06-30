import { describe, expect, it } from "vitest";
import { buildOperatorToolResultPayload } from "@kilnai/gateway-contracts";
import {
  operatorTranscriptSourceForEntry,
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
});
