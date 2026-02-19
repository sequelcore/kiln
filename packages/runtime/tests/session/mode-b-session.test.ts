import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ModeBSession } from "../../src/session/mode-b-session.js";

describe("ModeBSession", () => {
  describe("constructor", () => {
    it("creates session with correct id format", () => {
      const session = new ModeBSession({
        appName: "codeson",
        userId: "user-42",
        systemPrompt: "You are helpful.",
      });
      expect(session.id).toMatch(/^codeson:user-42:\d+$/);
    });

    it("stores appName", () => {
      const session = new ModeBSession({ appName: "arete", userId: "u1", systemPrompt: "sys" });
      expect(session.appName).toBe("arete");
    });

    it("stores userId", () => {
      const session = new ModeBSession({ appName: "arete", userId: "u1", systemPrompt: "sys" });
      expect(session.userId).toBe("u1");
    });

    it("stores systemPrompt", () => {
      const session = new ModeBSession({ appName: "app", userId: "u", systemPrompt: "be concise" });
      expect(session.systemPrompt).toBe("be concise");
    });

    it("sets default idle timeout to 30 minutes", () => {
      const before = Date.now();
      const session = new ModeBSession({ appName: "app", userId: "u", systemPrompt: "sys" });
      // isExpired should be false immediately
      expect(session.isExpired).toBe(false);
      // The default is 30 * 60 * 1000 ms -- verified via the timeout test
      const _ = before;
    });
  });

  describe("addUserMessage", () => {
    it("adds message to conversation history with role user", () => {
      const session = new ModeBSession({ appName: "app", userId: "u", systemPrompt: "sys" });
      session.addUserMessage("hello");
      expect(session.conversationHistory).toHaveLength(1);
      expect(session.conversationHistory[0]).toEqual({ role: "user", content: "hello" });
    });
  });

  describe("addAssistantMessage", () => {
    it("adds message to conversation history with role assistant", () => {
      const session = new ModeBSession({ appName: "app", userId: "u", systemPrompt: "sys" });
      session.addAssistantMessage("hi there");
      expect(session.conversationHistory).toHaveLength(1);
      expect(session.conversationHistory[0]).toEqual({ role: "assistant", content: "hi there" });
    });
  });

  describe("conversationHistory", () => {
    it("preserves order of messages", () => {
      const session = new ModeBSession({ appName: "app", userId: "u", systemPrompt: "sys" });
      session.addUserMessage("msg1");
      session.addAssistantMessage("msg2");
      session.addUserMessage("msg3");
      session.addAssistantMessage("msg4");

      const history = session.conversationHistory;
      expect(history).toHaveLength(4);
      expect(history[0]).toEqual({ role: "user", content: "msg1" });
      expect(history[1]).toEqual({ role: "assistant", content: "msg2" });
      expect(history[2]).toEqual({ role: "user", content: "msg3" });
      expect(history[3]).toEqual({ role: "assistant", content: "msg4" });
    });
  });

  describe("messageCount", () => {
    it("returns correct count", () => {
      const session = new ModeBSession({ appName: "app", userId: "u", systemPrompt: "sys" });
      expect(session.messageCount).toBe(0);
      session.addUserMessage("a");
      expect(session.messageCount).toBe(1);
      session.addAssistantMessage("b");
      expect(session.messageCount).toBe(2);
    });
  });

  describe("touch", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("updates lastActivityAt", () => {
      const session = new ModeBSession({ appName: "app", userId: "u", systemPrompt: "sys" });
      const before = session.lastActivityAt.getTime();
      vi.advanceTimersByTime(5000);
      session.touch();
      expect(session.lastActivityAt.getTime()).toBeGreaterThan(before);
    });
  });

  describe("isExpired", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns false before timeout", () => {
      const session = new ModeBSession({ appName: "app", userId: "u", systemPrompt: "sys" });
      expect(session.isExpired).toBe(false);
    });

    it("returns true after default timeout (30 minutes)", () => {
      const session = new ModeBSession({ appName: "app", userId: "u", systemPrompt: "sys" });
      expect(session.isExpired).toBe(false);
      vi.advanceTimersByTime(30 * 60 * 1000 + 1);
      expect(session.isExpired).toBe(true);
    });

    it("respects custom idle timeout", () => {
      const session = new ModeBSession({
        appName: "app",
        userId: "u",
        systemPrompt: "sys",
        idleTimeoutMs: 5000,
      });
      expect(session.isExpired).toBe(false);
      vi.advanceTimersByTime(5001);
      expect(session.isExpired).toBe(true);
    });

    it("does not expire before custom timeout elapses", () => {
      const session = new ModeBSession({
        appName: "app",
        userId: "u",
        systemPrompt: "sys",
        idleTimeoutMs: 10000,
      });
      vi.advanceTimersByTime(9999);
      expect(session.isExpired).toBe(false);
    });
  });
});
