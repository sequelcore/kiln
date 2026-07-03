import { describe, expect, it } from "vitest";
import type { ToolCalledEvent, ToolResultEvent } from "@kilnai/core";
import { appendCanonicalTurnEvents } from "../../src/session/runtime-session-event-ledger.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

describe("runtime session tool usage events", () => {
  it("projects rich tool result evidence onto canonical tool completion events", () => {
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
      toolCallId: "web-search-1",
      toolName: "web_search",
      toolInput: { query: "agent harness tools" },
      timestamp: startedAt,
    };
    const toolResult: ToolResultEvent = {
      type: "tool_result",
      sessionId: session.id,
      toolCallId: "web-search-1",
      toolName: "web_search",
      durationMs: 42,
      success: true,
      output: "sources",
      resultSummary: "sources",
      metadata: {
        toolName: "web_search",
        kind: "research",
        routeId: "codex-oauth-auto-review-readonly",
      },
      resourceLinks: [{
        uri: "kiln://artifacts/web-search/sources",
        title: "Search sources",
        relation: "source",
      }],
      toolUsage: {
        scope: "turn",
        toolName: "web_search",
        calls: 9,
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
      metadata: {
        toolName: "web_search",
        kind: "research",
        routeId: "codex-oauth-auto-review-readonly",
      },
      resourceLinks: [{
        uri: "kiln://artifacts/web-search/sources",
        title: "Search sources",
        relation: "source",
      }],
      toolUsage: {
        scope: "turn",
        toolName: "web_search",
        calls: 9,
      },
    });
  });

  it("correlates out-of-order tool results by their originating tool call id", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Be useful.",
    });
    const startedAt = new Date("2026-06-29T12:00:00.000Z");
    const firstCall: ToolCalledEvent = {
      type: "tool_called",
      sessionId: session.id,
      toolCallId: "search-first",
      toolName: "web_search",
      toolInput: { query: "first" },
      timestamp: startedAt,
    };
    const secondCall: ToolCalledEvent = {
      type: "tool_called",
      sessionId: session.id,
      toolCallId: "search-second",
      toolName: "web_search",
      toolInput: { query: "second" },
      timestamp: new Date("2026-06-29T12:00:00.100Z"),
    };
    const secondResult: ToolResultEvent = {
      type: "tool_result",
      sessionId: session.id,
      toolCallId: "search-second",
      toolName: "web_search",
      durationMs: 20,
      success: false,
      output: "second failed",
      resultSummary: "search failed",
      timestamp: new Date("2026-06-29T12:00:00.300Z"),
    };
    const firstResult: ToolResultEvent = {
      type: "tool_result",
      sessionId: session.id,
      toolCallId: "search-first",
      toolName: "web_search",
      durationMs: 40,
      success: true,
      output: "first succeeded",
      timestamp: new Date("2026-06-29T12:00:00.400Z"),
    };

    appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Run both searches.",
      assistantMessageContent: "Finished.",
      queued: false,
      turnStartedAt: startedAt,
      turnCompletedAt: new Date("2026-06-29T12:00:00.500Z"),
      continuity: { strategy: "none" },
      runtimeEvents: [firstCall, secondCall, secondResult, firstResult],
    });

    const toolEvents = session.sessionEvents
      .filter((event) => event.kind === "tool_call_started" || event.kind === "tool_call_completed")
      .map((event) => event.kind === "tool_call_started"
        ? {
            kind: event.kind,
            toolCallId: event.toolCallId,
            input: event.input,
          }
        : {
            kind: event.kind,
            toolCallId: event.toolCallId,
            status: event.status.state,
            durationMs: event.durationMs,
            output: event.output,
          });

    expect(toolEvents).toEqual([
      {
        kind: "tool_call_started",
        toolCallId: "search-first",
        input: { query: "first" },
      },
      {
        kind: "tool_call_started",
        toolCallId: "search-second",
        input: { query: "second" },
      },
      {
        kind: "tool_call_completed",
        toolCallId: "search-second",
        status: "failed",
        durationMs: 20,
        output: "second failed",
      },
      {
        kind: "tool_call_completed",
        toolCallId: "search-first",
        status: "succeeded",
        durationMs: 40,
        output: "first succeeded",
      },
    ]);
  });

  it("replays persisted runtime tool events without rewriting tool call identity", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Be useful.",
    });
    const startedAt = new Date("2026-06-29T12:00:00.000Z");

    const events = appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Replay the persisted tool result.",
      assistantMessageContent: "Replayed.",
      queued: false,
      turnStartedAt: startedAt,
      turnCompletedAt: new Date("2026-06-29T12:00:02.000Z"),
      continuity: { strategy: "restored" },
      runtimeEvents: [
        {
          type: "tool_called",
          sessionId: session.id,
          toolCallId: "persisted-tool-1",
          toolName: "read_file",
          toolInput: { path: "docs/plan.md" },
          timestamp: new Date("2026-06-29T12:00:00.250Z"),
        },
        {
          type: "tool_result",
          sessionId: session.id,
          toolCallId: "persisted-tool-1",
          toolName: "read_file",
          durationMs: 1000,
          success: true,
          output: "plan contents",
          timestamp: new Date("2026-06-29T12:00:01.250Z"),
        },
      ],
    });

    expect(events.filter((event) => event.kind.startsWith("tool_call")).map((event) => ({
      kind: event.kind,
      toolCallId: event.toolCallId,
    }))).toEqual([
      { kind: "tool_call_started", toolCallId: "persisted-tool-1" },
      { kind: "tool_call_completed", toolCallId: "persisted-tool-1" },
    ]);
  });

  it("fails fast when runtime tool events are missing tool call identity", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Be useful.",
    });
    const startedAt = new Date("2026-06-29T12:00:00.000Z");

    expect(() => appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Run a search.",
      assistantMessageContent: "Finished.",
      queued: false,
      turnStartedAt: startedAt,
      turnCompletedAt: new Date("2026-06-29T12:00:00.500Z"),
      continuity: { strategy: "none" },
      runtimeEvents: [{
        type: "tool_called",
        sessionId: session.id,
        toolName: "web_search",
        toolInput: { query: "missing id" },
        timestamp: startedAt,
      } as unknown as ToolCalledEvent],
    })).toThrow(/missing toolCallId/);
  });

  it("fails fast when runtime tool results are missing tool call identity", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Be useful.",
    });
    const startedAt = new Date("2026-06-29T12:00:00.000Z");

    expect(() => appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Run a search.",
      assistantMessageContent: "Finished.",
      queued: false,
      turnStartedAt: startedAt,
      turnCompletedAt: new Date("2026-06-29T12:00:00.500Z"),
      continuity: { strategy: "none" },
      runtimeEvents: [{
        type: "tool_result",
        sessionId: session.id,
        toolName: "web_search",
        durationMs: 10,
        success: true,
        output: "missing id",
        timestamp: startedAt,
      } as unknown as ToolResultEvent],
    })).toThrow(/missing toolCallId/);
  });
});
