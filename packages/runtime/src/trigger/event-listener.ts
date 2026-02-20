// Event listener: subscribes to EventBus, evaluates trigger filters, fires callback
// Shallow equality filter matching on event properties

import type { EventBus, EventTrigger, KilnEvent } from "@kilnai/core";
import { executeTrigger } from "./trigger-executor.js";
import type { TriggerExecutionContext } from "./trigger-executor.js";

/** Check if an event matches a trigger's filter (shallow equality) */
export function matchesFilter(
  event: KilnEvent,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;

  const record = event as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(filter)) {
    if (record[key] !== value) return false;
  }

  return true;
}

export interface EventListenerConfig {
  readonly appName: string;
  readonly eventBus: EventBus;
}

/** Manages event trigger subscriptions */
export class EventListener {
  private readonly config: EventListenerConfig;
  private readonly triggers: EventTrigger[] = [];
  private readonly unsubscribers: (() => void)[] = [];
  private started = false;

  constructor(config: EventListenerConfig) {
    this.config = config;
  }

  /** Register an event trigger */
  register(trigger: EventTrigger): void {
    if (trigger.enabled === false) return;
    this.triggers.push(trigger);
  }

  /** Start listening for events */
  start(): void {
    if (this.started) return;
    this.started = true;

    for (const trigger of this.triggers) {
      const handler = (event: KilnEvent) => {
        if (!matchesFilter(event, trigger.filter)) return;

        const ctx: TriggerExecutionContext = {
          appName: this.config.appName,
          eventBus: this.config.eventBus,
          sessionId: `event-${this.config.appName}-${trigger.name}-${Date.now()}`,
        };

        try {
          executeTrigger(
            trigger,
            event as unknown as Record<string, unknown>,
            ctx,
          );
        } catch {
          // Error already emitted by executeTrigger
        }
      };

      this.config.eventBus.on(trigger.event as import("@kilnai/core").EventType, handler);
      const eventType = trigger.event as import("@kilnai/core").EventType;
      this.unsubscribers.push(() => this.config.eventBus.off(eventType, handler));
    }
  }

  /** Stop listening for events */
  stop(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
    this.started = false;
  }
}
