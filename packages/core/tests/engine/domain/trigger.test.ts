import { describe, it, expect } from "vitest";
import { validateTrigger } from "../../../src/engine/domain/trigger.js";
import type { WebhookTrigger, EventTrigger, ScheduleTrigger } from "../../../src/engine/domain/trigger.js";

const TEAMS = ["ops", "review", "dev"];

describe("validateTrigger", () => {
  describe("webhook triggers", () => {
    const valid: WebhookTrigger = {
      name: "on-deploy",
      type: "webhook",
      team: "ops",
      path: "/hooks/deploy",
    };

    it("accepts valid webhook trigger", () => {
      expect(validateTrigger(valid, TEAMS)).toHaveLength(0);
    });

    it("accepts webhook with all optional fields", () => {
      const full: WebhookTrigger = {
        ...valid,
        task: "Deploy {{payload.url}}",
        enabled: true,
        method: "PUT",
        secretEnv: "DEPLOY_SECRET",
      };
      expect(validateTrigger(full, TEAMS)).toHaveLength(0);
    });

    it("rejects missing path", () => {
      const errors = validateTrigger({ ...valid, path: "" } as WebhookTrigger, TEAMS);
      expect(errors.some((e) => e.field === "path")).toBe(true);
    });

    it("rejects path without leading slash", () => {
      const errors = validateTrigger({ ...valid, path: "hooks/deploy" } as WebhookTrigger, TEAMS);
      expect(errors.some((e) => e.field === "path")).toBe(true);
    });

    it("rejects unknown team", () => {
      const errors = validateTrigger({ ...valid, team: "unknown" }, TEAMS);
      expect(errors.some((e) => e.field === "team")).toBe(true);
    });

    it("rejects missing name", () => {
      const errors = validateTrigger({ ...valid, name: "" } as WebhookTrigger, TEAMS);
      expect(errors.some((e) => e.field === "name")).toBe(true);
    });
  });

  describe("event triggers", () => {
    const valid: EventTrigger = {
      name: "on-error",
      type: "event",
      team: "ops",
      event: "error",
    };

    it("accepts valid event trigger", () => {
      expect(validateTrigger(valid, TEAMS)).toHaveLength(0);
    });

    it("accepts event trigger with filter", () => {
      const withFilter: EventTrigger = {
        ...valid,
        filter: { code: "PROVIDER_UNAVAILABLE" },
      };
      expect(validateTrigger(withFilter, TEAMS)).toHaveLength(0);
    });

    it("rejects missing event", () => {
      const errors = validateTrigger({ ...valid, event: "" } as EventTrigger, TEAMS);
      expect(errors.some((e) => e.field === "event")).toBe(true);
    });
  });

  describe("schedule triggers", () => {
    const valid: ScheduleTrigger = {
      name: "nightly-audit",
      type: "schedule",
      team: "review",
      cron: "0 2 * * *",
    };

    it("accepts valid schedule trigger", () => {
      expect(validateTrigger(valid, TEAMS)).toHaveLength(0);
    });

    it("accepts schedule with timezone", () => {
      const withTz: ScheduleTrigger = { ...valid, timezone: "America/Tijuana" };
      expect(validateTrigger(withTz, TEAMS)).toHaveLength(0);
    });

    it("rejects missing cron", () => {
      const errors = validateTrigger({ ...valid, cron: "" } as ScheduleTrigger, TEAMS);
      expect(errors.some((e) => e.field === "cron")).toBe(true);
    });
  });
});
