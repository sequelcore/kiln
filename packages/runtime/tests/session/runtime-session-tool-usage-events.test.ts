import { describe, expect, it } from "vitest";
import type { ToolCalledEvent, ToolResultEvent } from "@kilnai/core";
import { appendCanonicalTurnEvents } from "../../src/session/runtime-session-event-ledger.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

describe("runtime session tool usage events", () => {
  it("projects tool usage snapshots onto canonical tool completion events", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Be useful.",
    });
    const startedAt = new Date("2026-06-29T12:00:00.000Z");
    const completedAt = new Date("2026-06-29T12:00:01.000Z");
    const toolCalled: ToolCalledEvent = {
      type: "tool_called",
      sessionId: session.id,
      toolName: "web_search",
      toolInput: { query: "agent harness tools" },
      timestamp: startedAt,
    };
    const toolResult: ToolResultEvent = {
      type: "tool_result",
      sessionId: session.id,
      toolName: "web_search",
      durationMs: 42,
      success: true,
      output: "sources",
      resultSummary: "sources",
      toolUsage: {
        scope: "turn",
        toolName: "web_search",
        calls: 9,
        budget: 8,
        exceeded: true,
      },
      timestamp: completedAt,
    };

    appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Research with a max of 8 searches.",
      assistantMessageContent: "I used about 6 searches.",
      queued: false,
      turnStartedAt: startedAt,
      turnCompletedAt: completedAt,
      continuity: { strategy: "none" },
      runtimeEvents: [toolCalled, toolResult],
    });

    const completed = session.sessionEvents.find((event) => event.kind === "tool_call_completed");

    expect(completed).toMatchObject({
      kind: "tool_call_completed",
      toolName: "web_search",
      toolUsage: {
        scope: "turn",
        toolName: "web_search",
        calls: 9,
        budget: 8,
        exceeded: true,
      },
    });
  });
});
