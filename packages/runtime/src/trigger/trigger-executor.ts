// Trigger executor: interpolates task templates and fires triggers
// Pure function + event emission -- no external deps beyond core types

import type { EventBus, Trigger, TriggerFiredEvent, TriggerFailedEvent } from "@kilnai/core";

/** Interpolate {{payload.field}} placeholders in a task template */
export function interpolateTemplate(
  template: string,
  payload: Record<string, unknown>,
): string {
  return template.replace(/\{\{payload\.(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const parts = path.split(".");
    let value: unknown = payload;
    for (const part of parts) {
      if (value == null || typeof value !== "object") return "";
      value = (value as Record<string, unknown>)[part];
    }
    return value == null ? "" : String(value);
  });
}

export interface TriggerExecutionContext {
  readonly appName: string;
  readonly eventBus: EventBus;
  readonly sessionId: string;
}

/** Execute a trigger: interpolate template and emit events */
export function executeTrigger(
  trigger: Trigger,
  payload: Record<string, unknown>,
  ctx: TriggerExecutionContext,
): { team: string; task: string } {
  const task = trigger.task
    ? interpolateTemplate(trigger.task, payload)
    : `Trigger ${trigger.name} fired`;

  try {
    const firedEvent: TriggerFiredEvent = {
      type: "trigger_fired",
      timestamp: new Date(),
      sessionId: ctx.sessionId,
      triggerName: trigger.name,
      triggerType: trigger.type,
      team: trigger.team,
      task,
    };
    ctx.eventBus.emit(firedEvent);

    return { team: trigger.team, task };
  } catch (err) {
    const failedEvent: TriggerFailedEvent = {
      type: "trigger_failed",
      timestamp: new Date(),
      sessionId: ctx.sessionId,
      triggerName: trigger.name,
      triggerType: trigger.type,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.eventBus.emit(failedEvent);
    throw err;
  }
}
