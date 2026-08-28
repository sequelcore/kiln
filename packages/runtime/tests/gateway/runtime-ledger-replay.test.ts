import { describe, expect, it } from "vitest";
import type { ToolResultEvent } from "@kilnai/core";
import { resolveTurnToolExecutions } from "../../src/gateway/message-pipeline/runtime-ledger-replay.js";

describe("runtime ledger tool execution replay", () => {
  it("preserves the canonical scoped tool execution identity", () => {
    const event: ToolResultEvent = {
      type: "tool_result",
      sessionId: "session-1",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      toolCallScopeId: "scope-1",
      toolCallId: "call-1",
      toolName: "formal_verify",
      durationMs: 1,
      success: true,
      resultSummary: "verified",
    };

    expect(resolveTurnToolExecutions(undefined, [event])).toEqual([{
      toolCallScopeId: "scope-1",
      toolCallId: "call-1",
      toolName: "formal_verify",
      durationMs: 1,
      success: true,
      resultSummary: "verified",
    }]);
  });
});
