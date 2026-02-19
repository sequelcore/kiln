import { describe, it, expect, beforeEach } from "vitest";
import { EventBridge, toEngineEvent } from "../../src/channels/event-bridge.js";
import { EventBus } from "@kiln/core";
import type { KilnEvent } from "@kiln/core";

function makeEvent(overrides: Partial<KilnEvent> = {}): KilnEvent {
  return {
    type: "phase_changed",
    timestamp: new Date("2026-01-15T10:00:00Z"),
    sessionId: "test-session",
    ...overrides,
  } as KilnEvent;
}

describe("toEngineEvent", () => {
  it("converts KilnEvent to EngineEvent", () => {
    const event = makeEvent();
    const engine = toEngineEvent(event);

    expect(engine.type).toBe("phase_changed");
    expect(engine.timestamp).toEqual(event.timestamp);
    expect(engine.payload).toEqual({ sessionId: "test-session" });
  });

  it("preserves extra fields in payload", () => {
    const event = {
      ...makeEvent({ type: "task_started" }),
      taskId: "t1",
      statement: "Fix bug",
      parentId: null,
    } as KilnEvent & { taskId: string; statement: string; parentId: null };

    const engine = toEngineEvent(event);

    expect(engine.payload).toEqual({
      sessionId: "test-session",
      taskId: "t1",
      statement: "Fix bug",
      parentId: null,
    });
  });

  it("does not include type or timestamp in payload", () => {
    const engine = toEngineEvent(makeEvent());

    expect(engine.payload).not.toHaveProperty("type");
    expect(engine.payload).not.toHaveProperty("timestamp");
  });
});

describe("EventBridge", () => {
  let bridge: EventBridge;
  let bus: EventBus;

  beforeEach(() => {
    bridge = new EventBridge();
    bus = new EventBus();
  });

  it("yields events emitted on the EventBus", async () => {
    bridge.connect(bus);

    bus.emit(makeEvent({ type: "phase_changed" }));
    bus.emit(makeEvent({ type: "task_started" }));

    const gen = bridge.events();
    const first = await gen.next();
    const second = await gen.next();

    expect(first.value?.type).toBe("phase_changed");
    expect(second.value?.type).toBe("task_started");

    bridge.disconnect();
  });

  it("completes the generator on disconnect", async () => {
    bridge.connect(bus);
    bus.emit(makeEvent());
    bridge.disconnect();

    const results: string[] = [];
    for await (const event of bridge.events()) {
      results.push(event.type);
    }

    expect(results).toEqual(["phase_changed"]);
  });

  it("wakes waiting consumer when event arrives", async () => {
    bridge.connect(bus);

    // Start consuming before any events are emitted
    const gen = bridge.events();
    const promise = gen.next();

    // Emit after a tick
    await new Promise((r) => setTimeout(r, 10));
    bus.emit(makeEvent({ type: "cost_update" }));

    const result = await promise;
    expect(result.value?.type).toBe("cost_update");

    bridge.disconnect();
  });

  it("respects max queue size", () => {
    const smallBridge = new EventBridge(3);
    smallBridge.connect(bus);

    for (let i = 0; i < 10; i++) {
      bus.emit(makeEvent({ type: "phase_changed" }));
    }

    // Queue should be capped at 3
    // We can verify by consuming -- only 3 events should come out
    smallBridge.disconnect();

    let count = 0;
    const gen = smallBridge.events();
    const drain = async () => {
      for await (const _ of gen) {
        count++;
      }
    };
    return drain().then(() => {
      expect(count).toBe(3);
    });
  });

  it("ignores events after disconnect", async () => {
    bridge.connect(bus);
    bridge.disconnect();

    bus.emit(makeEvent());

    const results: string[] = [];
    for await (const event of bridge.events()) {
      results.push(event.type);
    }

    expect(results).toEqual([]);
  });

  it("unsubscribes from EventBus on disconnect", () => {
    bridge.connect(bus);

    // Emit before disconnect -- should be queued
    bus.emit(makeEvent());

    bridge.disconnect();

    // Emit after disconnect -- handler removed, should not queue
    bus.emit(makeEvent({ type: "error" }));

    let count = 0;
    const gen = bridge.events();
    const drain = async () => {
      for await (const _ of gen) {
        count++;
      }
    };
    return drain().then(() => {
      expect(count).toBe(1);
    });
  });
});
