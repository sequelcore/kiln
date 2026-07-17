import { describe, expect, it } from "vitest";
import {
  operatorEventAnchorsAssistantTurn,
  projectConversationTurnItems,
} from "../src/conversation-turn-projection.js";

describe("conversation turn projection", () => {
  it("anchors tool events to the following assistant turn when tools arrive before text", () => {
    const items = projectConversationTurnItems([
      { id: "user-1", kind: "message", role: "user", turnId: "turn-1" },
      { id: "tool-start", kind: "event", eventKind: "tool_call_started", toolCallId: "tool-1", turnId: "turn-1" },
      { id: "tool-done", kind: "event", eventKind: "tool_call_completed", toolCallId: "tool-1", turnId: "turn-1" },
      { id: "assistant-1", kind: "message", role: "assistant", turnId: "turn-1" },
    ]);

    expect(items).toEqual([
      { kind: "message", entryId: "user-1", beforeEventIds: [], afterEventIds: [] },
      { kind: "message", entryId: "assistant-1", beforeEventIds: ["tool-done"], afterEventIds: [] },
    ]);
  });

  it("can keep tool events as standalone conversation rows", () => {
    const items = projectConversationTurnItems([
      { id: "user-1", kind: "message", role: "user", turnId: "turn-1" },
      { id: "tool-start", kind: "event", eventKind: "tool_call_started", toolCallId: "tool-1", turnId: "turn-1" },
      { id: "tool-done", kind: "event", eventKind: "tool_call_completed", toolCallId: "tool-1", turnId: "turn-1" },
      { id: "assistant-1", kind: "message", role: "assistant", turnId: "turn-1" },
    ], { anchorToolEventsToAssistant: false });

    expect(items).toEqual([
      { kind: "message", entryId: "user-1", beforeEventIds: [], afterEventIds: [] },
      { kind: "event", entryId: "tool-done" },
      { kind: "message", entryId: "assistant-1", beforeEventIds: [], afterEventIds: [] },
    ]);
  });

  it("renders trailing same-turn tool evidence before the previous assistant content", () => {
    const items = projectConversationTurnItems([
      { id: "user-1", kind: "message", role: "user", turnId: "turn-1" },
      { id: "assistant-1", kind: "message", role: "assistant", turnId: "turn-1" },
      { id: "tool-done", kind: "event", eventKind: "tool_call_completed", toolCallId: "tool-1", turnId: "turn-1" },
      { id: "user-2", kind: "message", role: "user", turnId: "turn-2" },
    ]);

    expect(items).toEqual([
      { kind: "message", entryId: "user-1", beforeEventIds: [], afterEventIds: [] },
      { kind: "message", entryId: "assistant-1", beforeEventIds: ["tool-done"], afterEventIds: [] },
      { kind: "message", entryId: "user-2", beforeEventIds: [], afterEventIds: [] },
    ]);
  });

  it("projects pending tools into an activity shell when assistant text has not arrived", () => {
    const items = projectConversationTurnItems(
      [
        { id: "user-1", kind: "message", role: "user", turnId: "turn-1" },
        { id: "tool-start", kind: "event", eventKind: "tool_call_started", toolCallId: "tool-1", turnId: "turn-1" },
      ],
      { activity: { phase: "tool_running", toolName: "patch" } },
    );

    expect(items).toEqual([
      { kind: "message", entryId: "user-1", beforeEventIds: [], afterEventIds: [] },
      { kind: "activity", phase: "tool_running", toolName: "patch", details: undefined, eventIds: ["tool-start"] },
    ]);
  });

  it("does not attach tool events across explicit turn boundaries", () => {
    const items = projectConversationTurnItems([
      { id: "user-1", kind: "message", role: "user", turnId: "turn-1" },
      { id: "tool-done", kind: "event", eventKind: "tool_call_completed", toolCallId: "tool-1", turnId: "turn-1" },
      { id: "assistant-2", kind: "message", role: "assistant", turnId: "turn-2" },
    ]);

    expect(items).toEqual([
      { kind: "message", entryId: "user-1", beforeEventIds: [], afterEventIds: [] },
      { kind: "event", entryId: "tool-done" },
      { kind: "message", entryId: "assistant-2", beforeEventIds: [], afterEventIds: [] },
    ]);
  });

  it("declares which operator events start an assistant turn shell", () => {
    expect(operatorEventAnchorsAssistantTurn("tool_call_started")).toBe(true);
    expect(operatorEventAnchorsAssistantTurn("tool_call_completed")).toBe(true);
    expect(operatorEventAnchorsAssistantTurn("provider_routed")).toBe(false);
  });
});
