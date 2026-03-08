import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionRegistry } from "../../src/session/session-registry.js";
import type { ConversationEventEmitter } from "../../src/gateway/conversation-event-emitter.js";
import type { ConversationEvent } from "@kilnai/core";

function makeMockEmitter(): ConversationEventEmitter & { calls: ConversationEvent[] } {
  const calls: ConversationEvent[] = [];
  return {
    emit: vi.fn((event: ConversationEvent) => { calls.push(event); }),
    emitBatch: vi.fn(),
    calls,
  } as unknown as ConversationEventEmitter & { calls: ConversationEvent[] };
}

describe("SessionRegistry lifecycle events", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("SESSION_STARTED", () => {
    it("emits SESSION_STARTED when creating a new session", async () => {
      const emitter = makeMockEmitter();
      const registry = new SessionRegistry();
      registry.eventEmitter = emitter;

      const session = await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-1",
        userId: "user-1",
        systemPrompt: "sys",
      });

      expect(emitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "SESSION_STARTED",
          tenantId: "tenant-1",
          externalUserId: "user-1",
          sessionId: session.id,
          schemaVersion: "1",
        }),
      );
    });

    it("does not emit SESSION_STARTED when returning existing session", async () => {
      const emitter = makeMockEmitter();
      const registry = new SessionRegistry();
      registry.eventEmitter = emitter;

      await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-1",
        userId: "user-1",
        systemPrompt: "sys",
      });

      // Reset mock to track only the second call
      (emitter.emit as ReturnType<typeof vi.fn>).mockClear();

      await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-1",
        userId: "user-1",
        systemPrompt: "sys",
      });

      // Should not have emitted SESSION_STARTED again
      const sessionStartedCalls = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls
        .filter(([e]: [ConversationEvent]) => e.eventType === "SESSION_STARTED");
      expect(sessionStartedCalls).toHaveLength(0);
    });

    it("does not emit SESSION_STARTED when tenantId is absent", async () => {
      const emitter = makeMockEmitter();
      const registry = new SessionRegistry();
      registry.eventEmitter = emitter;

      await registry.getOrCreate({
        appName: "app",
        userId: "user-1",
        systemPrompt: "sys",
      });

      expect(emitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("CONVERSATION_ABANDONED on cleanup", () => {
    it("emits CONVERSATION_ABANDONED alongside SESSION_EXPIRED when session expires", async () => {
      vi.useFakeTimers();
      const emitter = makeMockEmitter();
      const registry = new SessionRegistry(5000);
      registry.eventEmitter = emitter;

      const session = await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-1",
        userId: "user-1",
        systemPrompt: "sys",
      });

      // Add some messages to test turnCount
      session.addUserMessage([{ type: "text", text: "hello" }]);
      session.addAssistantMessage([{ type: "text", text: "hi" }]);

      // Clear mock from SESSION_STARTED
      (emitter.emit as ReturnType<typeof vi.fn>).mockClear();

      // Expire the session
      vi.advanceTimersByTime(5001);
      await registry.cleanup();

      const eventTypes = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls
        .map(([e]: [ConversationEvent]) => e.eventType);

      expect(eventTypes).toContain("SESSION_EXPIRED");
      expect(eventTypes).toContain("CONVERSATION_ABANDONED");

      // Verify CONVERSATION_ABANDONED fields
      const abandonedEvent = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls
        .find(([e]: [ConversationEvent]) => e.eventType === "CONVERSATION_ABANDONED")?.[0] as ConversationEvent;

      expect(abandonedEvent).toBeDefined();
      expect(abandonedEvent.tenantId).toBe("tenant-1");
      expect(abandonedEvent.externalUserId).toBe("user-1");
      expect(abandonedEvent.sessionId).toBe(session.id);
      expect(abandonedEvent.schemaVersion).toBe("1");
      expect(abandonedEvent.closedBy).toBe("session_timeout");
      expect(abandonedEvent.turnCount).toBe(2); // 2 messages added
    });

    it("includes sessionId and schemaVersion on SESSION_EXPIRED", async () => {
      vi.useFakeTimers();
      const emitter = makeMockEmitter();
      const registry = new SessionRegistry(5000);
      registry.eventEmitter = emitter;

      const session = await registry.getOrCreate({
        appName: "app",
        tenantId: "tenant-1",
        userId: "user-1",
        systemPrompt: "sys",
      });

      (emitter.emit as ReturnType<typeof vi.fn>).mockClear();

      vi.advanceTimersByTime(5001);
      await registry.cleanup();

      const expiredEvent = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls
        .find(([e]: [ConversationEvent]) => e.eventType === "SESSION_EXPIRED")?.[0] as ConversationEvent;

      expect(expiredEvent).toBeDefined();
      expect(expiredEvent.sessionId).toBe(session.id);
      expect(expiredEvent.schemaVersion).toBe("1");
    });

    it("does not emit CONVERSATION_ABANDONED when tenantId is absent", async () => {
      vi.useFakeTimers();
      const emitter = makeMockEmitter();
      const registry = new SessionRegistry(5000);
      registry.eventEmitter = emitter;

      await registry.getOrCreate({
        appName: "app",
        userId: "user-1",
        systemPrompt: "sys",
      });

      (emitter.emit as ReturnType<typeof vi.fn>).mockClear();

      vi.advanceTimersByTime(5001);
      await registry.cleanup();

      expect(emitter.emit).not.toHaveBeenCalled();
    });
  });
});
