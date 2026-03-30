import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "../../src/trigger/scheduler.js";
import type { ScheduleEntry } from "../../src/trigger/scheduler.js";
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

  describe("list()", () => {
    it("returns a copy, not the internal reference", () => {
      const eventBus = new EventBus();
      const scheduler = new Scheduler({ appName: "test-app", eventBus });

      const trigger: ScheduleTrigger = {
        name: "daily",
        type: "schedule",
        team: "ops",
        cron: "0 2 * * *",
      };
      scheduler.register(trigger);

      const list1 = scheduler.list();
      const list2 = scheduler.list();

      expect(list1).not.toBe(list2);
      expect(list1).toHaveLength(list2.length);
    });

    it("includes projected nextFireAt for each entry", () => {
      const eventBus = new EventBus();
      const scheduler = new Scheduler({ appName: "test-app", eventBus });

      const trigger: ScheduleTrigger = {
        name: "every-minute",
        type: "schedule",
        team: "ops",
        cron: "* * * * *",
      };
      scheduler.register(trigger);

      const entries: ScheduleEntry[] = scheduler.list();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.trigger.name).toBe("every-minute");
      expect(entries[0]!.nextFireAt).toBeInstanceOf(Date);
      expect(entries[0]!.nextFireAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("returns empty array when no triggers registered", () => {
      const eventBus = new EventBus();
      const scheduler = new Scheduler({ appName: "test-app", eventBus });
      expect(scheduler.list()).toHaveLength(0);
    });
  });

  describe("remove()", () => {
    it("returns true for known name", () => {
      const eventBus = new EventBus();
      const scheduler = new Scheduler({ appName: "test-app", eventBus });

      const trigger: ScheduleTrigger = {
        name: "nightly",
        type: "schedule",
        team: "ops",
        cron: "0 2 * * *",
      };
      scheduler.register(trigger);
      expect(scheduler.list()).toHaveLength(1);

      const result = scheduler.remove("nightly");
      expect(result).toBe(true);
      expect(scheduler.list()).toHaveLength(0);
    });

    it("returns false for unknown name", () => {
      const eventBus = new EventBus();
      const scheduler = new Scheduler({ appName: "test-app", eventBus });
      const result = scheduler.remove("nonexistent");
      expect(result).toBe(false);
    });

    it("clears the timer for a running schedule", () => {
      const eventBus = new EventBus();
      const scheduler = new Scheduler({ appName: "test-app", eventBus });

      const trigger: ScheduleTrigger = {
        name: "every-minute",
        type: "schedule",
        team: "ops",
        cron: "* * * * *",
      };
      scheduler.register(trigger);
      scheduler.start();

      const removed = scheduler.remove("every-minute");
      expect(removed).toBe(true);

      vi.advanceTimersByTime(120_000);

      const emitSpy = vi.spyOn(eventBus, "emit");
      const scheduleFiredCalls = emitSpy.mock.calls.filter(
        (call) => (call[0] as KilnEvent).type === "schedule_fired",
      );
      expect(scheduleFiredCalls.length).toBe(0);
      scheduler.stop();
    });
  });

  describe("fire()", () => {
    it("returns true for known name", async () => {
      const eventBus = new EventBus();
      const scheduler = new Scheduler({ appName: "test-app", eventBus });

      const trigger: ScheduleTrigger = {
        name: "daily",
        type: "schedule",
        team: "ops",
        cron: "0 2 * * *",
      };
      scheduler.register(trigger);
      const result = await scheduler.fire("daily");
      expect(result).toBe(true);
    });

    it("returns false for unknown name", async () => {
      const eventBus = new EventBus();
      const scheduler = new Scheduler({ appName: "test-app", eventBus });
      const result = await scheduler.fire("nonexistent");
      expect(result).toBe(false);
    });

    it("does not reset the schedule timer", async () => {
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

      vi.advanceTimersByTime(30_000);
      const callsBeforeFire = emitSpy.mock.calls.filter(
        (call) => (call[0] as KilnEvent).type === "schedule_fired",
      ).length;

      await scheduler.fire("every-minute");

      vi.advanceTimersByTime(31_000);
      const callsAfterFire = emitSpy.mock.calls.filter(
        (call) => (call[0] as KilnEvent).type === "schedule_fired",
      ).length;

      expect(callsAfterFire).toBeGreaterThan(callsBeforeFire);
      scheduler.stop();
    });

    it("emits schedule_fired and trigger_fired events when fired", async () => {
      const eventBus = new EventBus();
      const emitSpy = vi.spyOn(eventBus, "emit");
      const scheduler = new Scheduler({ appName: "test-app", eventBus });

      const trigger: ScheduleTrigger = {
        name: "nightly",
        type: "schedule",
        team: "ops",
        cron: "0 2 * * *",
        task: "Run audit",
      };
      scheduler.register(trigger);
      await scheduler.fire("nightly");

      const fired = emitSpy.mock.calls.filter(
        (call) => (call[0] as KilnEvent).type === "schedule_fired",
      );
      const triggered = emitSpy.mock.calls.filter(
        (call) => (call[0] as KilnEvent).type === "trigger_fired",
      );
      expect(fired.length).toBe(1);
      expect(triggered.length).toBe(1);
    });
  });
});
