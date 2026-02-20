// TriggerRegistry: central registry for all trigger types per app
// Manages lifecycle: register -> start -> stop

import type {
  EventBus,
  Trigger,
  WebhookTrigger,
  EventTrigger,
  ScheduleTrigger,
} from "@kilnai/core";
import { createWebhookHandler } from "./webhook-handler.js";
import type { WebhookHandlerConfig } from "./webhook-handler.js";
import { EventListener } from "./event-listener.js";
import { Scheduler } from "./scheduler.js";
import type { Hono } from "hono";

export interface TriggerRegistryConfig {
  readonly eventBus: EventBus;
}

interface AppTriggers {
  readonly appName: string;
  readonly webhookTriggers: WebhookTrigger[];
  readonly eventListener: EventListener;
  readonly scheduler: Scheduler;
  webhookApp: Hono | null;
}

/** Central registry managing triggers across all apps */
export class TriggerRegistry {
  private readonly config: TriggerRegistryConfig;
  private readonly apps = new Map<string, AppTriggers>();
  private started = false;

  constructor(config: TriggerRegistryConfig) {
    this.config = config;
  }

  /** Register all triggers for an app */
  registerApp(appName: string, triggers: readonly Trigger[]): void {
    const eventListener = new EventListener({
      appName,
      eventBus: this.config.eventBus,
    });

    const scheduler = new Scheduler({
      appName,
      eventBus: this.config.eventBus,
    });

    const webhookTriggers: WebhookTrigger[] = [];

    for (const trigger of triggers) {
      switch (trigger.type) {
        case "webhook":
          webhookTriggers.push(trigger);
          break;
        case "event":
          eventListener.register(trigger as EventTrigger);
          break;
        case "schedule":
          scheduler.register(trigger as ScheduleTrigger);
          break;
      }
    }

    // Create webhook Hono app for this app's triggers
    const webhookHandlerConfig: WebhookHandlerConfig = {
      appName,
      eventBus: this.config.eventBus,
    };

    const webhookApp =
      webhookTriggers.length > 0
        ? createWebhookHandler(webhookTriggers, webhookHandlerConfig)
        : null;

    this.apps.set(appName, {
      appName,
      webhookTriggers,
      eventListener,
      scheduler,
      webhookApp,
    });
  }

  /** Get the webhook Hono app for an app (to mount in gateway) */
  getWebhookApp(appName: string): Hono | null {
    return this.apps.get(appName)?.webhookApp ?? null;
  }

  /** Start all event listeners and schedulers */
  start(): void {
    if (this.started) return;
    this.started = true;

    for (const app of this.apps.values()) {
      app.eventListener.start();
      app.scheduler.start();
    }
  }

  /** Stop all event listeners, schedulers, and clear timers */
  stop(): void {
    for (const app of this.apps.values()) {
      app.eventListener.stop();
      app.scheduler.stop();
    }
    this.started = false;
  }

  /** List all registered triggers across all apps (for dev/debug) */
  listAll(): { appName: string; name: string; type: string; enabled: boolean }[] {
    const result: { appName: string; name: string; type: string; enabled: boolean }[] = [];

    for (const app of this.apps.values()) {
      for (const trigger of app.webhookTriggers) {
        result.push({
          appName: app.appName,
          name: trigger.name,
          type: "webhook",
          enabled: trigger.enabled !== false,
        });
      }
    }

    return result;
  }
}
