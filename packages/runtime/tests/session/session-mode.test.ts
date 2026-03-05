import { describe, it, expect } from "vitest";
import { KilnError } from "@kilnai/core";
import { isValidTransition, transitionSessionMode } from "../../src/session/session-mode.js";
import type { SessionMode } from "../../src/session/session-mode.js";

describe("session-mode", () => {
  describe("isValidTransition", () => {
    const validTransitions: [SessionMode, SessionMode][] = [
      ["ai_active", "queued"],
      ["ai_active", "human_active"],
      ["queued", "human_active"],
      ["queued", "ai_active"],
      ["human_active", "ai_active"],
      ["human_active", "resolved"],
      ["resolved", "ai_active"],
    ];

    it.each(validTransitions)("returns true for %s -> %s", (from, to) => {
      expect(isValidTransition(from, to)).toBe(true);
    });

    const invalidTransitions: [SessionMode, SessionMode][] = [
      ["ai_active", "resolved"],
      ["ai_active", "ai_active"],
      ["queued", "queued"],
      ["queued", "resolved"],
      ["human_active", "queued"],
      ["human_active", "human_active"],
      ["resolved", "queued"],
      ["resolved", "human_active"],
      ["resolved", "resolved"],
    ];

    it.each(invalidTransitions)("returns false for %s -> %s", (from, to) => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  });

  describe("transitionSessionMode", () => {
    const validTransitions: [SessionMode, SessionMode][] = [
      ["ai_active", "queued"],
      ["ai_active", "human_active"],
      ["queued", "human_active"],
      ["queued", "ai_active"],
      ["human_active", "ai_active"],
      ["human_active", "resolved"],
      ["resolved", "ai_active"],
    ];

    it.each(validTransitions)("returns target mode for valid transition %s -> %s", (from, to) => {
      expect(transitionSessionMode(from, to)).toBe(to);
    });

    it("throws KilnError with INVALID_SESSION_TRANSITION for invalid transition", () => {
      expect(() => transitionSessionMode("ai_active", "resolved")).toThrow(KilnError);
      try {
        transitionSessionMode("ai_active", "resolved");
      } catch (err) {
        const kilnErr = err as KilnError;
        expect(kilnErr.code).toBe("INVALID_SESSION_TRANSITION");
        expect(kilnErr.message).toBe("Invalid session mode transition: ai_active -> resolved");
        expect(kilnErr.context).toEqual({ from: "ai_active", to: "resolved" });
      }
    });

    it("throws for same-state transition (ai_active -> ai_active)", () => {
      expect(() => transitionSessionMode("ai_active", "ai_active")).toThrow(KilnError);
    });

    it("throws for same-state transition (queued -> queued)", () => {
      expect(() => transitionSessionMode("queued", "queued")).toThrow(KilnError);
    });

    it("throws for same-state transition (human_active -> human_active)", () => {
      expect(() => transitionSessionMode("human_active", "human_active")).toThrow(KilnError);
    });

    it("throws for same-state transition (resolved -> resolved)", () => {
      expect(() => transitionSessionMode("resolved", "resolved")).toThrow(KilnError);
    });
  });
});
