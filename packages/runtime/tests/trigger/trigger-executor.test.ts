import { describe, it, expect, vi } from "vitest";
import { interpolateTemplate, executeTrigger } from "../../src/trigger/trigger-executor.js";
import type { TriggerExecutionContext } from "../../src/trigger/trigger-executor.js";
import { EventBus } from "@kilnai/core";
import type { WebhookTrigger, ScheduleTrigger } from "@kilnai/core";

describe("interpolateTemplate", () => {
  it("replaces simple payload fields", () => {
    const result = interpolateTemplate("Deploy to {{payload.url}}", { url: "https://example.com" });
    expect(result).toBe("Deploy to https://example.com");
  });

  it("replaces nested payload fields", () => {
    const result = interpolateTemplate("User {{payload.user.name}}", {
      user: { name: "Alice" },
    });
    expect(result).toBe("User Alice");
  });

  it("replaces multiple fields", () => {
    const result = interpolateTemplate("{{payload.action}} on {{payload.repo}}", {
      action: "push",
      repo: "kiln",
    });
    expect(result).toBe("push on kiln");
  });

  it("returns empty string for missing fields", () => {
    const result = interpolateTemplate("Missing: {{payload.nonexistent}}", {});
    expect(result).toBe("Missing: ");
  });

  it("returns empty string for null values", () => {
    const result = interpolateTemplate("Null: {{payload.val}}", { val: null });
    expect(result).toBe("Null: ");
  });

  it("converts numbers to string", () => {
    const result = interpolateTemplate("Count: {{payload.count}}", { count: 42 });
    expect(result).toBe("Count: 42");
  });

  it("leaves non-payload templates untouched", () => {
    const result = interpolateTemplate("Hello {{name}}", { name: "world" });
    expect(result).toBe("Hello {{name}}");
  });
});

describe("executeTrigger", () => {
  it("emits trigger_fired event and returns result", () => {
    const eventBus = new EventBus();
    const emitSpy = vi.spyOn(eventBus, "emit");

    const trigger: WebhookTrigger = {
      name: "on-deploy",
      type: "webhook",
      team: "ops",
      task: "Deploy {{payload.url}}",
      path: "/hooks/deploy",
    };

    const ctx: TriggerExecutionContext = {
      appName: "my-app",
      eventBus,
      sessionId: "test-session",
    };

    const result = executeTrigger(trigger, { url: "https://prod.example.com" }, ctx);
    expect(result.team).toBe("ops");
    expect(result.task).toBe("Deploy https://prod.example.com");
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "trigger_fired",
        triggerName: "on-deploy",
        triggerType: "webhook",
        team: "ops",
      }),
    );
  });

  it("uses default task when no task template provided", () => {
    const eventBus = new EventBus();
    const trigger: ScheduleTrigger = {
      name: "nightly",
      type: "schedule",
      team: "review",
      cron: "0 2 * * *",
    };

    const ctx: TriggerExecutionContext = {
      appName: "my-app",
      eventBus,
      sessionId: "test-session",
    };

    const result = executeTrigger(trigger, {}, ctx);
    expect(result.task).toBe("Trigger nightly fired");
  });
});
