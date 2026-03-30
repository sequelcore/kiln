// Scheduler: manages cron-based timers for schedule triggers
// Uses setTimeout chains (not setInterval) for drift-free scheduling

import type { EventBus, ScheduleTrigger, ScheduleFiredEvent } from "@kilnai/core";
import { parseCronExpression, nextFireTime } from "@kilnai/core";
import { executeTrigger } from "./trigger-executor.js";
import type { TriggerExecutionContext } from "./trigger-executor.js";

export interface ScheduleEntry {
  readonly trigger: ScheduleTrigger;
  nextFireAt: Date;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Manages cron-based schedule triggers */
export class Scheduler {
  private readonly config: { appName: string; eventBus: EventBus };
  private readonly entries: ScheduleEntry[] = [];
  private started = false;

  constructor(config: { appName: string; eventBus: EventBus }) {
    this.config = config;
  }

  /** Register a schedule trigger */
  register(trigger: ScheduleTrigger): void {
    if (trigger.enabled === false) return;
    const cron = parseCronExpression(trigger.cron);
    const now = new Date();
    const next = nextFireTime(cron, now, trigger.timezone);
    this.entries.push({ trigger, nextFireAt: next, timer: null });
  }

  /** Start all schedule timers */
  start(): void {
    if (this.started) return;
    this.started = true;

    for (const entry of this.entries) {
      this.scheduleNext(entry);
    }
  }

  /** Stop all schedule timers */
  stop(): void {
    for (const entry of this.entries) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
    this.started = false;
  }

  /** Schedule the next fire for a given entry */
  private scheduleNext(entry: ScheduleEntry): void {
    const cron = parseCronExpression(entry.trigger.cron);
    const now = new Date();
    const next = nextFireTime(cron, now, entry.trigger.timezone);
    entry.nextFireAt = next;
    const delay = next.getTime() - now.getTime();

    entry.timer = setTimeout(() => {
      this.fireEntry(entry);
      if (this.started) {
        this.scheduleNext(entry);
      }
    }, Math.max(delay, 0));
  }

  /** Fire a schedule trigger */
  private fireEntry(entry: ScheduleEntry): void {
    const { trigger } = entry;

    const firedEvent: ScheduleFiredEvent = {
      type: "schedule_fired",
      timestamp: new Date(),
      sessionId: `schedule-${this.config.appName}-${trigger.name}`,
      triggerName: trigger.name,
      cron: trigger.cron,
      team: trigger.team,
    };
    this.config.eventBus.emit(firedEvent);

    const ctx: TriggerExecutionContext = {
      appName: this.config.appName,
      eventBus: this.config.eventBus,
      sessionId: `schedule-${this.config.appName}-${trigger.name}-${Date.now()}`,
    };

    try {
      executeTrigger(trigger, {}, ctx);
    } catch {
      // Error already emitted by executeTrigger
    }
  }

  /** List all registered schedule entries with projected next fire times */
  list(): ScheduleEntry[] {
    const now = new Date();
    return this.entries.map((entry) => {
      const cron = parseCronExpression(entry.trigger.cron);
      const next = nextFireTime(cron, now, entry.trigger.timezone);
      return { ...entry, nextFireAt: next };
    });
  }

  /** Remove a schedule by name. Clears its timer and returns true if found. */
  remove(name: string): boolean {
    const idx = this.entries.findIndex((e) => e.trigger.name === name);
    if (idx === -1) return false;
    const entry = this.entries[idx]!;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    this.entries.splice(idx, 1);
    return true;
  }

  /** Manually fire a schedule by name. Does not reset the scheduled timer. */
  async fire(name: string): Promise<boolean> {
    const entry = this.entries.find((e) => e.trigger.name === name);
    if (!entry) return false;
    this.fireEntry(entry);
    return true;
  }
}
