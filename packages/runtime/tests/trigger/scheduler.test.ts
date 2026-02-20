import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "../../src/trigger/scheduler.js";
import { EventBus } from "@kilnai/core";
import type { ScheduleTrigger, KilnEvent } from "@kilnai/core";

describe("Scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts and stops without error", () => {
    const eventBus = new EventBus();
    const scheduler = new Scheduler({ appName: "test-app", eventBus });
    scheduler.start();
    scheduler.stop();
  });

  it("fires trigger at scheduled time", () => {
    const eventBus = new EventBus();
    const emitSpy = vi.spyOn(eventBus, "emit");
    const scheduler = new Scheduler({ appName: "test-app", eventBus });

    const trigger: ScheduleTrigger = {
      name: "every-minute",
      type: "schedule",
      team: "ops",
      cron: "* * * * *",
      task: "Run check",
    };

    scheduler.register(trigger);
    scheduler.start();

    // Advance time by 61 seconds (past next minute boundary)
    vi.advanceTimersByTime(61_000);

    const scheduleFiredCalls = emitSpy.mock.calls.filter(
      (call) => (call[0] as KilnEvent).type === "schedule_fired",
    );
    expect(scheduleFiredCalls.length).toBeGreaterThanOrEqual(1);

    scheduler.stop();
  });

  it("does not fire after stop", () => {
    const eventBus = new EventBus();
    const emitSpy = vi.spyOn(eventBus, "emit");
    const scheduler = new Scheduler({ appName: "test-app", eventBus });

    const trigger: ScheduleTrigger = {
      name: "every-minute",
      type: "schedule",
      team: "ops",
      cron: "* * * * *",
    };

    scheduler.register(trigger);
    scheduler.start();
    scheduler.stop();

    emitSpy.mockClear();
    vi.advanceTimersByTime(120_000);

    const scheduleFiredCalls = emitSpy.mock.calls.filter(
      (call) => (call[0] as KilnEvent).type === "schedule_fired",
    );
    expect(scheduleFiredCalls.length).toBe(0);
  });

  it("skips disabled triggers", () => {
    const eventBus = new EventBus();
    const emitSpy = vi.spyOn(eventBus, "emit");
    const scheduler = new Scheduler({ appName: "test-app", eventBus });

    const trigger: ScheduleTrigger = {
      name: "disabled",
      type: "schedule",
      team: "ops",
      cron: "* * * * *",
      enabled: false,
    };

    scheduler.register(trigger);
    scheduler.start();

    vi.advanceTimersByTime(120_000);

    const scheduleFiredCalls = emitSpy.mock.calls.filter(
      (call) => (call[0] as KilnEvent).type === "schedule_fired",
    );
    expect(scheduleFiredCalls.length).toBe(0);

    scheduler.stop();
  });

  it("fires trigger_fired event after schedule_fired", () => {
    const eventBus = new EventBus();
    const emitSpy = vi.spyOn(eventBus, "emit");
    const scheduler = new Scheduler({ appName: "test-app", eventBus });

    const trigger: ScheduleTrigger = {
      name: "check-trigger-fired",
      type: "schedule",
      team: "ops",
      cron: "* * * * *",
      task: "Run audit",
    };

    scheduler.register(trigger);
    scheduler.start();

    vi.advanceTimersByTime(61_000);

    const triggerFiredCalls = emitSpy.mock.calls.filter(
      (call) => (call[0] as KilnEvent).type === "trigger_fired",
    );
    expect(triggerFiredCalls.length).toBeGreaterThanOrEqual(1);

    scheduler.stop();
  });
});
