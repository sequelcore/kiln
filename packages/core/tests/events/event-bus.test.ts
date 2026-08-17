import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../../src/events/event-bus.js";
import { EVENT_LEVEL_MAP } from "../../src/events/index.js";
import type {
  KilnEvent,
  PhaseChangedEvent,
  ErrorEvent,
  ToolCalledEvent,
  HandoffRequestedEvent,
  HandoffCompletedEvent,
  InterruptRequestedEvent,
  InterruptResumedEvent,
} from "../../src/events/index.js";

function makeEvent<T extends KilnEvent>(overrides: T): T {
  return overrides;
}

function makePhaseEvent(phase = "plan"): PhaseChangedEvent {
  return makeEvent<PhaseChangedEvent>({
    type: "phase_changed",
    phase,
    phaseName: "Plan",
    phaseDescription: "Planning phase",
    timestamp: new Date(),
    sessionId: "test-session",
  });
}

function makeErrorEvent(message = "something failed"): ErrorEvent {
  return makeEvent<ErrorEvent>({
    type: "error",
    message,
    code: "ERR_TEST",
    taskId: null,
    timestamp: new Date(),
    sessionId: "test-session",
  });
}

function makeToolEvent(toolName = "read_file"): ToolCalledEvent {
  return makeEvent<ToolCalledEvent>({
    type: "tool_called",
    toolCallId: "tool-call-1",
    toolCallScopeId: "turn-1:response:1",
    toolName,
    taskId: "task-1",
    workerIndex: 0,
    timestamp: new Date(),
    sessionId: "test-session",
  });
}

describe("EventBus", () => {
  it("emits events to registered handlers", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("phase_changed", handler);

    const event = makePhaseEvent();
    bus.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("type-specific handlers only receive matching events", () => {
    const bus = new EventBus();
    const phaseHandler = vi.fn();
    const errorHandler = vi.fn();
    bus.on("phase_changed", phaseHandler);
    bus.on("error", errorHandler);

    bus.emit(makePhaseEvent());

    expect(phaseHandler).toHaveBeenCalledOnce();
    expect(errorHandler).not.toHaveBeenCalled();
  });

  it("supports multiple handlers on the same event type", () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.on("error", handler1);
    bus.on("error", handler2);

    bus.emit(makeErrorEvent());

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("does not error when emitting with zero subscribers", () => {
    const bus = new EventBus();
    expect(() => bus.emit(makePhaseEvent())).not.toThrow();
  });

  it("off removes handler correctly", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("phase_changed", handler);
    bus.off("phase_changed", handler);

    bus.emit(makePhaseEvent());

    expect(handler).not.toHaveBeenCalled();
  });

  it("off is idempotent (removing non-existent handler does not throw)", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    expect(() => bus.off("phase_changed", handler)).not.toThrow();
  });

  it("onAny receives all events", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.onAny(handler);

    const phaseEvent = makePhaseEvent();
    const errorEvent = makeErrorEvent();
    bus.emit(phaseEvent);
    bus.emit(errorEvent);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, phaseEvent);
    expect(handler).toHaveBeenNthCalledWith(2, errorEvent);
  });

  it("offAny removes wildcard handler", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.onAny(handler);
    bus.offAny(handler);

    bus.emit(makePhaseEvent());

    expect(handler).not.toHaveBeenCalled();
  });

  it("history returns events in oldest-first order", () => {
    const bus = new EventBus();
    const e1 = makePhaseEvent("plan");
    const e2 = makePhaseEvent("implement");
    const e3 = makePhaseEvent("verify");

    bus.emit(e1);
    bus.emit(e2);
    bus.emit(e3);

    const events = bus.history();
    expect(events).toHaveLength(3);
    expect(events[0]).toBe(e1);
    expect(events[1]).toBe(e2);
    expect(events[2]).toBe(e3);
  });

  it("history respects limit parameter", () => {
    const bus = new EventBus();
    bus.emit(makePhaseEvent("plan"));
    bus.emit(makePhaseEvent("implement"));
    bus.emit(makePhaseEvent("verify"));

    const events = bus.history(2);
    expect(events).toHaveLength(2);
    // Should return the 2 most recent
    expect((events[0] as PhaseChangedEvent).phase).toBe("implement");
    expect((events[1] as PhaseChangedEvent).phase).toBe("verify");
  });

  it("history returns empty array when no events emitted", () => {
    const bus = new EventBus();
    expect(bus.history()).toEqual([]);
  });

  it("ring buffer wraps around when exceeding max history", () => {
    const bus = new EventBus(3);

    bus.emit(makePhaseEvent("a"));
    bus.emit(makePhaseEvent("b"));
    bus.emit(makePhaseEvent("c"));
    bus.emit(makePhaseEvent("d")); // overwrites "a"
    bus.emit(makePhaseEvent("e")); // overwrites "b"

    const events = bus.history();
    expect(events).toHaveLength(3);
    expect((events[0] as PhaseChangedEvent).phase).toBe("c");
    expect((events[1] as PhaseChangedEvent).phase).toBe("d");
    expect((events[2] as PhaseChangedEvent).phase).toBe("e");
  });

  it("ring buffer with limit after wrap-around", () => {
    const bus = new EventBus(3);

    bus.emit(makePhaseEvent("a"));
    bus.emit(makePhaseEvent("b"));
    bus.emit(makePhaseEvent("c"));
    bus.emit(makePhaseEvent("d"));

    const events = bus.history(2);
    expect(events).toHaveLength(2);
    expect((events[0] as PhaseChangedEvent).phase).toBe("c");
    expect((events[1] as PhaseChangedEvent).phase).toBe("d");
  });

  it("history limit larger than count returns all available", () => {
    const bus = new EventBus();
    bus.emit(makePhaseEvent());

    const events = bus.history(50);
    expect(events).toHaveLength(1);
  });

  it("clear resets handlers and history", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const anyHandler = vi.fn();
    bus.on("phase_changed", handler);
    bus.onAny(anyHandler);
    bus.emit(makePhaseEvent());

    bus.clear();

    // History should be empty
    expect(bus.history()).toEqual([]);

    // Handlers should be removed
    bus.emit(makePhaseEvent());
    expect(handler).toHaveBeenCalledOnce(); // only the call before clear
    expect(anyHandler).toHaveBeenCalledOnce();
  });

  it("both type-specific and onAny handlers fire for the same event", () => {
    const bus = new EventBus();
    const specific = vi.fn();
    const any = vi.fn();
    bus.on("tool_called", specific);
    bus.onAny(any);

    const event = makeToolEvent();
    bus.emit(event);

    expect(specific).toHaveBeenCalledWith(event);
    expect(any).toHaveBeenCalledWith(event);
  });

  it("default max history is 100", () => {
    const bus = new EventBus();

    for (let i = 0; i < 150; i++) {
      bus.emit(makePhaseEvent(`phase-${i}`));
    }

    const events = bus.history();
    expect(events).toHaveLength(100);
    // Oldest should be phase-50 (first 50 were overwritten)
    expect((events[0] as PhaseChangedEvent).phase).toBe("phase-50");
    expect((events[99] as PhaseChangedEvent).phase).toBe("phase-149");
  });

  describe("Phase 2 event types", () => {
    it("handoff events have phase-level mapping", () => {
      expect(EVENT_LEVEL_MAP["handoff_requested"]).toBe("phase");
      expect(EVENT_LEVEL_MAP["handoff_completed"]).toBe("phase");
    });

    it("interrupt events have phase-level mapping", () => {
      expect(EVENT_LEVEL_MAP["interrupt_requested"]).toBe("phase");
      expect(EVENT_LEVEL_MAP["interrupt_resumed"]).toBe("phase");
    });

    it("emits and receives handoff_requested event", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on("handoff_requested", handler);

      const event: HandoffRequestedEvent = {
        type: "handoff_requested",
        fromAgent: "alpha",
        toAgent: "beta",
        reason: "need coding help",
        timestamp: new Date(),
        sessionId: "test-session",
      };
      bus.emit(event);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(event);
    });

    it("emits and receives handoff_completed event", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on("handoff_completed", handler);

      const event: HandoffCompletedEvent = {
        type: "handoff_completed",
        fromAgent: "alpha",
        toAgent: "beta",
        accepted: true,
        timestamp: new Date(),
        sessionId: "test-session",
      };
      bus.emit(event);

      expect(handler).toHaveBeenCalledOnce();
    });

    it("emits and receives interrupt_requested event", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on("interrupt_requested", handler);

      const event: InterruptRequestedEvent = {
        type: "interrupt_requested",
        checkpointId: "ckpt-1",
        reason: "needs user approval",
        resumeSchema: { type: "object" },
        timestamp: new Date(),
        sessionId: "test-session",
      };
      bus.emit(event);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(event);
    });

    it("emits and receives interrupt_resumed event", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on("interrupt_resumed", handler);

      const event: InterruptResumedEvent = {
        type: "interrupt_resumed",
        checkpointId: "ckpt-1",
        resumeValue: { approved: true },
        timestamp: new Date(),
        sessionId: "test-session",
      };
      bus.emit(event);

      expect(handler).toHaveBeenCalledOnce();
    });

    it("onLevel('phase') captures handoff and interrupt events", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.onLevel("phase", handler);

      const event: HandoffRequestedEvent = {
        type: "handoff_requested",
        fromAgent: "a",
        toAgent: "b",
        reason: "test",
        timestamp: new Date(),
        sessionId: "s",
      };
      bus.emit(event);

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("knowledge_source_failed event", () => {
    it("has state-level mapping in EVENT_LEVEL_MAP", () => {
      expect(EVENT_LEVEL_MAP["knowledge_source_failed"]).toBe("state");
    });

    it("emits and receives knowledge_source_failed event", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on("knowledge_source_failed", handler);

      const event = makeEvent({
        type: "knowledge_source_failed" as const,
        sourceId: "src-1",
        sourceName: "FAQ",
        sourceType: "url",
        error: "connection refused",
        timestamp: new Date(),
        sessionId: "test-session",
      });
      bus.emit(event);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe("EventStore sink", () => {
    it("calls store.save() on every emit", async () => {
      const saved: KilnEvent[] = [];
      const store = {
        save: vi.fn(async (event: KilnEvent) => { saved.push(event); }),
        getBySession: vi.fn(async () => []),
        getAfter: vi.fn(async () => []),
      };
      const bus = new EventBus(100, store);
      const event = makePhaseEvent("analyze");
      bus.emit(event);

      // Let the fire-and-forget promise resolve
      await new Promise((r) => setTimeout(r, 0));

      expect(store.save).toHaveBeenCalledOnce();
      expect(saved[0]).toBe(event);
    });

    it("does not block emit when store.save() rejects", async () => {
      const store = {
        save: vi.fn(async () => { throw new Error("db down"); }),
        getBySession: vi.fn(async () => []),
        getAfter: vi.fn(async () => []),
      };
      const bus = new EventBus(100, store);
      const handler = vi.fn();
      bus.on("phase_changed", handler);

      // Should not throw
      bus.emit(makePhaseEvent("analyze"));

      expect(handler).toHaveBeenCalledOnce();
      // Let the rejected promise settle
      await new Promise((r) => setTimeout(r, 0));
    });

    it("works without a store (default behavior)", () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on("phase_changed", handler);
      bus.emit(makePhaseEvent("analyze"));
      expect(handler).toHaveBeenCalledOnce();
    });
  });
});
