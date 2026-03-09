import { describe, it, expect } from "vitest";
import { textParts } from "@kilnai/core";
import type { AgentMessage } from "@kilnai/core";
import { detectRepetitiveAbuse } from "../../src/session/repetitive-abuse-detector.js";

function userMsg(text: string): AgentMessage {
  return { role: "user", parts: textParts(text) };
}

function assistantMsg(text: string): AgentMessage {
  return { role: "assistant", parts: textParts(text) };
}

describe("detectRepetitiveAbuse", () => {
  it("returns null for first message (no history)", () => {
    const result = detectRepetitiveAbuse("hello", []);
    expect(result).toBeNull();
  });

  it("returns null when history has fewer than 2 user messages", () => {
    const history: AgentMessage[] = [userMsg("hi"), assistantMsg("hello")];
    const result = detectRepetitiveAbuse("how are you", history);
    expect(result).toBeNull();
  });

  it("detects exact repetition", () => {
    const history: AgentMessage[] = [
      userMsg("tell me a joke"),
      assistantMsg("Why did the chicken..."),
      userMsg("tell me a joke"),
      assistantMsg("Another joke..."),
      userMsg("tell me a joke"),
      assistantMsg("Yet another..."),
    ];
    const result = detectRepetitiveAbuse("tell me a joke", history);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("repetition");
    expect(result!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result!.detail).toContain("tell me a joke");
  });

  it("detects keyword spam (continue repeated)", () => {
    const history: AgentMessage[] = [
      userMsg("continue"),
      assistantMsg("Continuing..."),
      userMsg("continue"),
      assistantMsg("More content..."),
      userMsg("continue"),
      assistantMsg("Even more..."),
      userMsg("continue"),
      assistantMsg("Still going..."),
    ];
    const result = detectRepetitiveAbuse("continue", history);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("repetition");
  });

  it("detects sequential counting (1, 2, 3, 4)", () => {
    const history: AgentMessage[] = [
      userMsg("1"),
      assistantMsg("One"),
      userMsg("2"),
      assistantMsg("Two"),
      userMsg("3"),
      assistantMsg("Three"),
      userMsg("4"),
      assistantMsg("Four"),
    ];
    const result = detectRepetitiveAbuse("5", history);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("sequential");
    expect(result!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("returns null for normal conversation", () => {
    const history: AgentMessage[] = [
      userMsg("What time do you open?"),
      assistantMsg("We open at 9 AM."),
      userMsg("Do you have parking?"),
      assistantMsg("Yes, free parking is available."),
      userMsg("How much is a haircut?"),
      assistantMsg("Haircuts start at $25."),
    ];
    const result = detectRepetitiveAbuse("Can I book for tomorrow?", history);
    expect(result).toBeNull();
  });

  it("respects custom windowSize", () => {
    // With windowSize=2 and only 2 matching messages, should detect
    const history: AgentMessage[] = [
      userMsg("something different"),
      assistantMsg("ok"),
      userMsg("something different"),
      assistantMsg("ok"),
      userMsg("repeat"),
      assistantMsg("ok"),
      userMsg("repeat"),
      assistantMsg("ok"),
    ];
    const result = detectRepetitiveAbuse("repeat", history, { windowSize: 2 });
    expect(result).not.toBeNull();
    expect(result!.type).toBe("repetition");
  });

  it("respects custom threshold", () => {
    // 2 out of 5 recent user messages match = 0.4 ratio
    // Default threshold 0.6 would not trigger, but 0.3 should
    const history: AgentMessage[] = [
      userMsg("alpha"),
      assistantMsg("ok"),
      userMsg("beta"),
      assistantMsg("ok"),
      userMsg("gamma"),
      assistantMsg("ok"),
      userMsg("hello"),
      assistantMsg("ok"),
      userMsg("hello"),
      assistantMsg("ok"),
    ];
    const result = detectRepetitiveAbuse("hello", history, { repetitionThreshold: 0.3 });
    expect(result).not.toBeNull();
  });
});
