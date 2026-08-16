import { describe, it, expect } from "vitest";
import { TriggerRegistry } from "../../src/trigger/trigger-registry.js";
import type { EventTrigger, ScheduleTrigger, Trigger, WebhookTrigger } from "@kilnai/core/engine";
import { EventBus } from "@kilnai/core/events";

describe("TriggerRegistry", () => {
  it("registers app with triggers", () => {
    const eventBus = new EventBus();
    const registry = new TriggerRegistry({ eventBus });

    const triggers: Trigger[] = [
      {
        name: "on-deploy",
        type: "webhook",
        team: "ops",
        path: "/hooks/deploy",
      } satisfies WebhookTrigger,
      {
        name: "on-error",
        type: "event",
        team: "ops",
        event: "error",
      } satisfies EventTrigger,
      {
        name: "nightly",
        type: "schedule",
        team: "review",
        cron: "0 2 * * *",
      } satisfies ScheduleTrigger,
    ];

    registry.registerApp("my-app", triggers);
    expect(registry.getWebhookApp("my-app")).not.toBeNull();
  });

  it("returns null webhook app for app without webhook triggers", () => {
    const eventBus = new EventBus();
    const registry = new TriggerRegistry({ eventBus });

    registry.registerApp("my-app", [
      {
        name: "nightly",
        type: "schedule",
        team: "review",
        cron: "0 2 * * *",
      } satisfies ScheduleTrigger,
    ]);

    expect(registry.getWebhookApp("my-app")).toBeNull();
  });

  it("returns null for unregistered app", () => {
    const eventBus = new EventBus();
    const registry = new TriggerRegistry({ eventBus });
    expect(registry.getWebhookApp("unknown")).toBeNull();
  });

  it("starts and stops without error", () => {
    const eventBus = new EventBus();
    const registry = new TriggerRegistry({ eventBus });

    registry.registerApp("my-app", [
      {
        name: "on-deploy",
        type: "webhook",
        team: "ops",
        path: "/hooks/deploy",
      } satisfies WebhookTrigger,
    ]);

    registry.start();
    registry.stop();
  });

  it("lists all registered webhook triggers", () => {
    const eventBus = new EventBus();
    const registry = new TriggerRegistry({ eventBus });

    registry.registerApp("app-a", [
      {
        name: "hook-1",
        type: "webhook",
        team: "ops",
        path: "/hooks/1",
      } satisfies WebhookTrigger,
    ]);

    registry.registerApp("app-b", [
      {
        name: "hook-2",
        type: "webhook",
        team: "dev",
        path: "/hooks/2",
      } satisfies WebhookTrigger,
    ]);

    const all = registry.listAll();
    expect(all).toHaveLength(2);
    expect(all[0]!.appName).toBe("app-a");
    expect(all[1]!.appName).toBe("app-b");
  });
});
