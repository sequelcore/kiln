import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { textParts } from "@kilnai/core";
import { ModeBSession } from "../../src/session/mode-b-session.js";

describe("ModeBSession", () => {
  describe("constructor", () => {
    it("creates session with correct id format", () => {
      const session = new ModeBSession({
        appName: "codeson",
        tenantId: "test-tenant",
        userId: "user-42",
        systemPrompt: "You are helpful.",
      });
      expect(session.id).toMatch(/^codeson:test-tenant:user-42:\d+$/);
    });

    it("stores appName", () => {
      const session = new ModeBSession({ appName: "arete", tenantId: "test-tenant", userId: "u1", systemPrompt: "sys" });
      expect(session.appName).toBe("arete");
    });

    it("stores userId", () => {
      const session = new ModeBSession({ appName: "arete", tenantId: "test-tenant", userId: "u1", systemPrompt: "sys" });
      expect(session.userId).toBe("u1");
    });

    it("stores systemPrompt", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "be concise" });
      expect(session.systemPrompt).toBe("be concise");
    });

    it("sets default idle timeout to 30 minutes", () => {
      const before = Date.now();
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      // isExpired should be false immediately
      expect(session.isExpired).toBe(false);
      // The default is 30 * 60 * 1000 ms -- verified via the timeout test
      const _ = before;
    });
  });

  describe("addUserMessage", () => {
    it("adds message to conversation history with role user", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.addUserMessage(textParts("hello"));
      expect(session.conversationHistory).toHaveLength(1);
      expect(session.conversationHistory[0]).toEqual({ role: "user", parts: textParts("hello") });
    });
  });

  describe("addAssistantMessage", () => {
    it("adds message to conversation history with role assistant", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.addAssistantMessage(textParts("hi there"));
      expect(session.conversationHistory).toHaveLength(1);
      expect(session.conversationHistory[0]).toEqual({ role: "assistant", parts: textParts("hi there") });
    });
  });

  describe("conversationHistory", () => {
    it("preserves order of messages", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.addUserMessage(textParts("msg1"));
      session.addAssistantMessage(textParts("msg2"));
      session.addUserMessage(textParts("msg3"));
      session.addAssistantMessage(textParts("msg4"));

      const history = session.conversationHistory;
      expect(history).toHaveLength(4);
      expect(history[0]).toEqual({ role: "user", parts: textParts("msg1") });
      expect(history[1]).toEqual({ role: "assistant", parts: textParts("msg2") });
      expect(history[2]).toEqual({ role: "user", parts: textParts("msg3") });
      expect(history[3]).toEqual({ role: "assistant", parts: textParts("msg4") });
    });
  });

  describe("messageCount", () => {
    it("returns correct count", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      expect(session.messageCount).toBe(0);
      session.addUserMessage(textParts("a"));
      expect(session.messageCount).toBe(1);
      session.addAssistantMessage(textParts("b"));
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
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
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
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      expect(session.isExpired).toBe(false);
    });

    it("returns true after default timeout (30 minutes)", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      expect(session.isExpired).toBe(false);
      vi.advanceTimersByTime(30 * 60 * 1000 + 1);
      expect(session.isExpired).toBe(true);
    });

    it("respects custom idle timeout", () => {
      const session = new ModeBSession({
        appName: "app",
        tenantId: "test-tenant",
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
        tenantId: "test-tenant",
        userId: "u",
        systemPrompt: "sys",
        idleTimeoutMs: 10000,
      });
      vi.advanceTimersByTime(9999);
      expect(session.isExpired).toBe(false);
    });
  });

  describe("lastAssistantTexts", () => {
    it("returns last N assistant messages in chronological order", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.addUserMessage(textParts("q1"));
      session.addAssistantMessage(textParts("a1"));
      session.addUserMessage(textParts("q2"));
      session.addAssistantMessage(textParts("a2"));
      session.addUserMessage(textParts("q3"));
      session.addAssistantMessage(textParts("a3"));

      expect(session.lastAssistantTexts(2)).toEqual(["a2", "a3"]);
    });

    it("returns all assistant messages when count exceeds available", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.addAssistantMessage(textParts("only"));

      expect(session.lastAssistantTexts(5)).toEqual(["only"]);
    });

    it("returns empty array when no assistant messages", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.addUserMessage(textParts("q1"));

      expect(session.lastAssistantTexts(3)).toEqual([]);
    });

    it("skips user messages and only returns assistant texts", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.addUserMessage(textParts("q1"));
      session.addAssistantMessage(textParts("a1"));
      session.addUserMessage(textParts("q2"));
      session.addUserMessage(textParts("q3"));
      session.addAssistantMessage(textParts("a2"));

      expect(session.lastAssistantTexts(2)).toEqual(["a1", "a2"]);
    });
  });

  describe("injectOperatorMessage", () => {
    it("adds message as assistant role", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.injectOperatorMessage(textParts("operator reply"));

      expect(session.conversationHistory).toHaveLength(1);
      expect(session.conversationHistory[0]).toEqual({
        role: "assistant",
        parts: textParts("operator reply"),
      });
    });

    it("updates lastActivityAt", () => {
      vi.useFakeTimers();
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      const before = session.lastActivityAt.getTime();
      vi.advanceTimersByTime(5000);
      session.injectOperatorMessage(textParts("msg"));
      expect(session.lastActivityAt.getTime()).toBeGreaterThan(before);
      vi.useRealTimers();
    });
  });

  describe("sessionMode", () => {
    it("defaults to ai_active", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      expect(session.sessionMode).toBe("ai_active");
    });

    it("transitions to queued", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.setSessionMode("queued");
      expect(session.sessionMode).toBe("queued");
    });

    it("throws on invalid transition", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      expect(() => session.setSessionMode("resolved")).toThrow();
    });
  });

  describe("version tracking", () => {
    it("starts at version 0", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      expect(session.version).toBe(0);
      expect(session.loadedVersion).toBe(0);
    });

    it("increments on addUserMessage", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.addUserMessage(textParts("hello"));
      expect(session.version).toBe(1);
    });

    it("increments on addAssistantMessage", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.addAssistantMessage(textParts("hello"));
      expect(session.version).toBe(1);
    });

    it("increments on setSessionMode", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.setSessionMode("queued");
      expect(session.version).toBe(1);
    });

    it("increments on injectOperatorMessage", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.injectOperatorMessage(textParts("operator msg"));
      expect(session.version).toBe(1);
    });

    it("accumulates across multiple mutations", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.addUserMessage(textParts("q1"));
      session.addAssistantMessage(textParts("a1"));
      session.setSessionMode("queued");
      expect(session.version).toBe(3);
    });

    it("restores version and loadedVersion from serialized data", () => {
      const session = new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "u", systemPrompt: "sys" });
      session.addUserMessage(textParts("q1"));
      session.addAssistantMessage(textParts("a1"));
      // version is now 2

      const restored = ModeBSession.fromSerialized({
        id: session.id,
        appName: "app",
        tenantId: "test-tenant",
        userId: "u",
        systemPrompt: "sys",
        idleTimeoutMs: session.idleTimeoutMs,
        sessionMode: "ai_active",
        version: 2,
        createdAt: session.createdAt.toISOString(),
        lastActivityAt: session.lastActivityAt.toISOString(),
        history: [...session.conversationHistory],
        activeAgentId: null,
        agentTurnHistory: [],
        handoffCount: 0,
        lastRouteChangeAt: 0,
      });

      expect(restored.version).toBe(2);
      expect(restored.loadedVersion).toBe(2);

      // New mutations increment from restored version
      restored.addUserMessage(textParts("q2"));
      expect(restored.version).toBe(3);
      expect(restored.loadedVersion).toBe(2);
    });
  });
});
