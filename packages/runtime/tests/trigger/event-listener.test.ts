import { describe, it, expect, vi } from "vitest";
import { matchesFilter, EventListener } from "../../src/trigger/event-listener.js";
import type { EventTrigger } from "@kilnai/core/engine";
import { type ErrorEvent, EventBus, type KilnEvent } from "@kilnai/core/events";

describe("matchesFilter", () => {
  const baseEvent: KilnEvent = {
    type: "error",
    timestamp: new Date(),
    sessionId: "test",
  };

  it("matches when no filter specified", () => {
    expect(matchesFilter(baseEvent, undefined)).toBe(true);
  });

  it("matches when filter is empty", () => {
    expect(matchesFilter(baseEvent, {})).toBe(true);
  });

  it("matches when all filter fields match", () => {
    const event: ErrorEvent = {
      ...baseEvent,
      type: "error",
      message: "Provider unavailable",
      code: "PROVIDER_UNAVAILABLE",
      taskId: null,
    };
    expect(matchesFilter(event, { code: "PROVIDER_UNAVAILABLE" })).toBe(true);
  });

  it("does not match when a filter field differs", () => {
    const event: ErrorEvent = {
      ...baseEvent,
      type: "error",
      message: "Something else",
      code: "CONFIG_INVALID",
      taskId: null,
    };
    expect(matchesFilter(event, { code: "PROVIDER_UNAVAILABLE" })).toBe(false);
  });

  it("does not match when filter field is missing from event", () => {
    expect(matchesFilter(baseEvent, { nonexistent: "value" })).toBe(false);
  });
});

describe("EventListener", () => {
  it("starts and stops without error", () => {
    const eventBus = new EventBus();
    const listener = new EventListener({ appName: "test-app", eventBus });
    listener.start();
    listener.stop();
  });

  it("fires trigger on matching event", () => {
    const eventBus = new EventBus();
    const listener = new EventListener({ appName: "test-app", eventBus });
    const emitSpy = vi.spyOn(eventBus, "emit");

    const trigger: EventTrigger = {
      name: "on-error",
      type: "event",
      team: "ops",
      event: "error",
      task: "Investigate error",
    };

    listener.register(trigger);
    listener.start();

    // Emit an error event
    const errorEvent: ErrorEvent = {
      type: "error",
      timestamp: new Date(),
      sessionId: "original",
      message: "Provider down",
      code: "PROVIDER_UNAVAILABLE",
      taskId: null,
    };
    eventBus.emit(errorEvent);

    // Should have emitted a trigger_fired event (in addition to the original error)
    const triggerFiredCalls = emitSpy.mock.calls.filter(
      (call) => (call[0] as KilnEvent).type === "trigger_fired",
    );
    expect(triggerFiredCalls.length).toBe(1);

    listener.stop();
  });

  it("does not fire after stop", () => {
    const eventBus = new EventBus();
    const listener = new EventListener({ appName: "test-app", eventBus });
    const emitSpy = vi.spyOn(eventBus, "emit");

    const trigger: EventTrigger = {
      name: "on-error",
      type: "event",
      team: "ops",
      event: "error",
    };

    listener.register(trigger);
    listener.start();
    listener.stop();

    const errorEvent: ErrorEvent = {
      type: "error",
      timestamp: new Date(),
      sessionId: "test",
      message: "Test",
      code: "TEST",
      taskId: null,
    };
    eventBus.emit(errorEvent);

    const triggerFiredCalls = emitSpy.mock.calls.filter(
      (call) => (call[0] as KilnEvent).type === "trigger_fired",
    );
    expect(triggerFiredCalls.length).toBe(0);
  });

  it("applies filter to events", () => {
    const eventBus = new EventBus();
    const listener = new EventListener({ appName: "test-app", eventBus });
    const emitSpy = vi.spyOn(eventBus, "emit");

    const trigger: EventTrigger = {
      name: "on-specific-error",
      type: "event",
      team: "ops",
      event: "error",
      filter: { code: "PROVIDER_UNAVAILABLE" },
    };

    listener.register(trigger);
    listener.start();

    // Non-matching event
    const wrongEvent: ErrorEvent = {
      type: "error",
      timestamp: new Date(),
      sessionId: "test",
      message: "Wrong",
      code: "CONFIG_INVALID",
      taskId: null,
    };
    eventBus.emit(wrongEvent);

    // Matching event
    const matchEvent: ErrorEvent = {
      type: "error",
      timestamp: new Date(),
      sessionId: "test",
      message: "Match",
      code: "PROVIDER_UNAVAILABLE",
      taskId: null,
    };
    eventBus.emit(matchEvent);

    const triggerFiredCalls = emitSpy.mock.calls.filter(
      (call) => (call[0] as KilnEvent).type === "trigger_fired",
    );
    expect(triggerFiredCalls.length).toBe(1);

    listener.stop();
  });

  it("skips disabled triggers", () => {
    const eventBus = new EventBus();
    const listener = new EventListener({ appName: "test-app", eventBus });

    const trigger: EventTrigger = {
      name: "disabled",
      type: "event",
      team: "ops",
      event: "error",
      enabled: false,
    };

    listener.register(trigger);
    listener.start();

    const emitSpy = vi.spyOn(eventBus, "emit");
    const errorEvent: ErrorEvent = {
      type: "error",
      timestamp: new Date(),
      sessionId: "test",
      message: "Test",
      code: "TEST",
      taskId: null,
    };
    eventBus.emit(errorEvent);

    const triggerFiredCalls = emitSpy.mock.calls.filter(
      (call) => (call[0] as KilnEvent).type === "trigger_fired",
    );
    expect(triggerFiredCalls.length).toBe(0);

    listener.stop();
  });
});
