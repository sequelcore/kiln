import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../src/agents/index.js";
import { projectConversationForModel } from "../../src/context/conversation-projection.js";

function toolExchange(index: number, content: string): readonly AgentMessage[] {
  const toolUseId = `call-${index}`;
  return [
    {
      role: "assistant",
      parts: [{ type: "tool_use", id: toolUseId, name: "read", input: { path: `file-${index}.ts` } }],
    },
    {
      role: "user",
      parts: [{ type: "tool_result", toolUseId, content }],
    },
  ];
}

describe("projectConversationForModel", () => {
  it("clears the oldest tool results without mutating canonical conversation history", () => {
    const messages: readonly AgentMessage[] = [
      { role: "user", parts: [{ type: "text", text: "Inspect the repository." }] },
      ...toolExchange(1, "a".repeat(160)),
      ...toolExchange(2, "b".repeat(160)),
      ...toolExchange(3, "c".repeat(160)),
      ...toolExchange(4, "d".repeat(160)),
      ...toolExchange(5, "e".repeat(160)),
    ];

    const projection = projectConversationForModel(messages, {
      triggerToolResultTokens: 100,
      retainRecentToolResults: 2,
    });

    expect(projection.evidence).toMatchObject({
      policyId: "tool-result-clearing-v1",
      triggerToolResultTokens: 100,
      retainRecentToolResults: 2,
      originalToolResultCount: 5,
      projectedToolResultCount: 5,
      clearedToolResultCount: 3,
      clearedToolUseIds: ["call-1", "call-2", "call-3"],
      overflow: false,
    });
    const projectedResults = projection.messages.flatMap((message) => (
      message.parts.filter((part) => part.type === "tool_result")
    ));
    expect(projectedResults.slice(0, 3).map((part) => part.content)).toEqual([
      expect.stringContaining("call-1"),
      expect.stringContaining("call-2"),
      expect.stringContaining("call-3"),
    ]);
    expect(projectedResults.slice(0, 3).every((part) => !part.contentParts)).toBe(true);
    expect(projectedResults.slice(-2).map((part) => part.content)).toEqual([
      "d".repeat(160),
      "e".repeat(160),
    ]);
    expect(messages[2]?.parts[0]).toEqual({
      type: "tool_result",
      toolUseId: "call-1",
      content: "a".repeat(160),
    });
  });

  it("returns the original message identities when the clearing threshold is not reached", () => {
    const messages = toolExchange(1, "short");
    const projection = projectConversationForModel(messages, {
      triggerToolResultTokens: 100,
      retainRecentToolResults: 0,
    });

    expect(projection.messages).not.toBe(messages);
    expect(projection.messages).toEqual(messages);
    expect(projection.evidence.clearedToolResultCount).toBe(0);
  });

  it("reports overflow when retained recent results alone exceed the threshold", () => {
    const messages = [
      ...toolExchange(1, "a".repeat(800)),
      ...toolExchange(2, "b".repeat(800)),
    ];
    const projection = projectConversationForModel(messages, {
      triggerToolResultTokens: 100,
      retainRecentToolResults: 2,
    });

    expect(projection.evidence.clearedToolResultCount).toBe(0);
    expect(projection.evidence.overflow).toBe(true);
  });

  it("rejects invalid policy values", () => {
    expect(() => projectConversationForModel([], {
      triggerToolResultTokens: 0,
      retainRecentToolResults: 1,
    })).toThrow("triggerToolResultTokens");
    expect(() => projectConversationForModel([], {
      triggerToolResultTokens: 10,
      retainRecentToolResults: -1,
    })).toThrow("retainRecentToolResults");
  });
});
