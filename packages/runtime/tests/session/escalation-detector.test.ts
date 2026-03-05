import { describe, it, expect } from "vitest";
import { textParts } from "@kilnai/core";
import {
  DefaultEscalationDetector,
  wordOverlapSimilarity,
} from "../../src/session/escalation-detector.js";
import { ModeBSession } from "../../src/session/mode-b-session.js";

function makeSession(): ModeBSession {
  return new ModeBSession({ appName: "test", userId: "user-1", systemPrompt: "You are helpful." });
}

describe("DefaultEscalationDetector", () => {
  describe("checkPreLLM", () => {
    const detector = new DefaultEscalationDetector();

    it("matches exact single keyword 'human'", () => {
      const signal = detector.checkPreLLM("I want a human");
      expect(signal).not.toBeNull();
      expect(signal!.reason).toBe("keyword");
      expect(signal!.confidence).toBe(0.8);
      expect(signal!.detail).toContain("human");
    });

    it("matches case-insensitively", () => {
      const signal = detector.checkPreLLM("I want a HUMAN");
      expect(signal).not.toBeNull();
      expect(signal!.reason).toBe("keyword");
    });

    it("matches multi-word phrase 'talk to someone'", () => {
      const signal = detector.checkPreLLM("I want to talk to someone please");
      expect(signal).not.toBeNull();
      expect(signal!.reason).toBe("keyword");
      expect(signal!.confidence).toBe(0.9);
      expect(signal!.detail).toContain("talk to someone");
    });

    it("matches Spanish phrase 'hablar con alguien'", () => {
      const signal = detector.checkPreLLM("quiero hablar con alguien");
      expect(signal).not.toBeNull();
      expect(signal!.confidence).toBe(0.9);
    });

    it("does not false-positive on partial match like 'superhuman'", () => {
      const signal = detector.checkPreLLM("That was superhuman performance");
      expect(signal).toBeNull();
    });

    it("does not false-positive on partial match like 'inhumane'", () => {
      const signal = detector.checkPreLLM("That was inhumane");
      expect(signal).toBeNull();
    });

    it("returns null for normal messages", () => {
      const signal = detector.checkPreLLM("What is the weather today?");
      expect(signal).toBeNull();
    });

    it("returns null for empty string", () => {
      const signal = detector.checkPreLLM("");
      expect(signal).toBeNull();
    });

    it("uses custom keywords when configured", () => {
      const custom = new DefaultEscalationDetector({ keywords: ["escalate", "manager"] });
      expect(custom.checkPreLLM("I want to escalate")).not.toBeNull();
      expect(custom.checkPreLLM("Get me a manager")).not.toBeNull();
      expect(custom.checkPreLLM("I want a human")).toBeNull();
    });

    it("matches Spanish single keyword 'agente'", () => {
      const signal = detector.checkPreLLM("quiero un agente");
      expect(signal).not.toBeNull();
      expect(signal!.reason).toBe("keyword");
    });
  });

  describe("checkPostLLM", () => {
    it("detects loop with identical responses", () => {
      const detector = new DefaultEscalationDetector({ loopWindowSize: 3 });
      const session = makeSession();

      // Add 3 identical assistant responses
      session.addAssistantMessage(textParts("I can help you with that."));
      session.addAssistantMessage(textParts("I can help you with that."));
      session.addAssistantMessage(textParts("I can help you with that."));

      const signal = detector.checkPostLLM(session, textParts("response"));
      expect(signal).not.toBeNull();
      expect(signal!.reason).toBe("loop");
      expect(signal!.confidence).toBe(0.85);
    });

    it("detects loop with very similar responses above threshold", () => {
      const detector = new DefaultEscalationDetector({ loopWindowSize: 3, loopThreshold: 0.7 });
      const session = makeSession();

      // Jaccard similarity between consecutive pairs: 7/9 ~ 0.778 > 0.7
      session.addAssistantMessage(textParts("I can help you with that request today"));
      session.addAssistantMessage(textParts("I can help you with that request now"));
      session.addAssistantMessage(textParts("I can help you with that request here"));

      const signal = detector.checkPostLLM(session, textParts("response"));
      expect(signal).not.toBeNull();
      expect(signal!.reason).toBe("loop");
    });

    it("returns null for different responses", () => {
      const detector = new DefaultEscalationDetector({ loopWindowSize: 3 });
      const session = makeSession();

      session.addAssistantMessage(textParts("Hello there!"));
      session.addAssistantMessage(textParts("The weather is sunny."));
      session.addAssistantMessage(textParts("I like pizza."));

      const signal = detector.checkPostLLM(session, textParts("response"));
      expect(signal).toBeNull();
    });

    it("returns null when history has fewer than loopWindowSize messages", () => {
      const detector = new DefaultEscalationDetector({ loopWindowSize: 3 });
      const session = makeSession();

      session.addAssistantMessage(textParts("I can help you with that."));
      session.addAssistantMessage(textParts("I can help you with that."));

      const signal = detector.checkPostLLM(session, textParts("response"));
      expect(signal).toBeNull();
    });

    it("respects custom loopThreshold", () => {
      // Very high threshold means even identical messages might trigger, but dissimilar won't
      const detector = new DefaultEscalationDetector({ loopWindowSize: 2, loopThreshold: 0.99 });
      const session = makeSession();

      session.addAssistantMessage(textParts("I can help you with that request."));
      session.addAssistantMessage(textParts("I can help you with that problem."));

      const signal = detector.checkPostLLM(session, textParts("response"));
      // "request" vs "problem" differ -- similarity should be below 0.99
      expect(signal).toBeNull();
    });
  });
});

describe("wordOverlapSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(wordOverlapSimilarity("hello world", "hello world")).toBe(1.0);
  });

  it("returns 0.0 for completely different strings", () => {
    expect(wordOverlapSimilarity("hello world", "foo bar")).toBe(0.0);
  });

  it("returns 1.0 for both empty strings", () => {
    expect(wordOverlapSimilarity("", "")).toBe(1.0);
  });

  it("returns 0.0 when one string is empty", () => {
    expect(wordOverlapSimilarity("hello", "")).toBe(0.0);
    expect(wordOverlapSimilarity("", "hello")).toBe(0.0);
  });

  it("returns value between 0 and 1 for partial overlap", () => {
    // "hello world" and "hello there" share "hello" but differ on "world"/"there"
    const sim = wordOverlapSimilarity("hello world", "hello there");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
    // Jaccard: intersection=1 (hello), union=3 (hello, world, there) => 1/3
    expect(sim).toBeCloseTo(1 / 3);
  });

  it("is case-insensitive", () => {
    expect(wordOverlapSimilarity("Hello World", "hello world")).toBe(1.0);
  });
});
