import { describe, it, expect } from "vitest";
import type { App } from "../../../src/engine/composites/app.js";
import { validateApp } from "../../../src/engine/composites/app.js";
import type { Team } from "../../../src/engine/composites/team.js";
import type { Router } from "../../../src/engine/composites/router.js";
import type { Agent } from "../../../src/engine/domain/agent.js";
import type { Capability } from "../../../src/engine/domain/capability.js";
import type { Trigger, WebhookTrigger, EventTrigger, ScheduleTrigger } from "../../../src/engine/domain/trigger.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    name: "Marcus",
    role: "Implementation Specialist",
    goal: "Write clean, well-tested code",
    tier: "coding",
    tools: ["code_edit"],
    ...overrides,
  };
}

function makeCapability(name = "code_edit"): Capability {
  return {
    name,
    description: `${name} tool`,
    schema: {},
    tags: ["coding"],
  };
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    name: "development",
    agents: { worker: makeAgent() },
    capabilities: [makeCapability()],
    ...overrides,
  };
}

function makeRouter(overrides: Partial<Router> = {}): Router {
  return {
    fallback: "dev",
    ...overrides,
  };
}

function makeApp(overrides: Partial<App> = {}): App {
  return {
    name: "test-app",
    teams: { dev: makeTeam({ name: "dev" }) },
    router: makeRouter(),
    ...overrides,
  };
}

describe("App composite", () => {
  describe("interface conformance", () => {
    it("accepts a valid App", () => {
      const app = makeApp();
      expect(app.name).toBe("test-app");
      expect(Object.keys(app.teams)).toHaveLength(1);
      expect(app.router.fallback).toBe("dev");
    });
  });

  describe("validateApp", () => {
    it("returns empty array for valid config", () => {
      expect(validateApp(makeApp())).toEqual([]);
    });

    it("reports empty name", () => {
      const errors = validateApp(makeApp({ name: "" }));
      expect(errors.some((e) => e.field === "name")).toBe(true);
    });

    it("reports no teams", () => {
      const errors = validateApp(makeApp({ teams: {} }));
      expect(errors.some((e) => e.field === "teams")).toBe(true);
    });

    it("reports router fallback referencing unknown team", () => {
      const app = makeApp({ router: makeRouter({ fallback: "nonexistent" }) });
      const errors = validateApp(app);
      expect(errors.some((e) => e.field === "router.fallback")).toBe(true);
      expect(errors.find((e) => e.field === "router.fallback")?.message).toContain("nonexistent");
    });

    it("propagates team validation errors with prefixed field paths", () => {
      const app = makeApp({
        teams: {
          dev: makeTeam({ name: "dev", agents: {} }),
        },
      });
      const errors = validateApp(app);
      expect(errors.some((e) => e.field === "teams.dev.agents")).toBe(true);
    });

    it("propagates router validation errors with prefixed field paths", () => {
      const app = makeApp({
        router: makeRouter({ fallback: "" }),
      });
      const errors = validateApp(app);
      expect(errors.some((e) => e.field === "router.fallback")).toBe(true);
    });

    it("accumulates multiple errors", () => {
      const app = makeApp({
        name: "",
        teams: {},
      });
      const errors = validateApp(app);
      expect(errors.length).toBeGreaterThanOrEqual(2);
    });

    describe("trigger validation", () => {
      it("accepts app with valid triggers", () => {
        const triggers: Trigger[] = [
          { name: "on-deploy", type: "webhook", team: "dev", path: "/hooks/deploy" } as WebhookTrigger,
          { name: "on-error", type: "event", team: "dev", event: "error" } as EventTrigger,
          { name: "nightly", type: "schedule", team: "dev", cron: "0 2 * * *" } as ScheduleTrigger,
        ];
        const errors = validateApp(makeApp({ triggers }));
        expect(errors.filter((e) => e.field.startsWith("triggers"))).toHaveLength(0);
      });

      it("accepts app without triggers", () => {
        const errors = validateApp(makeApp());
        expect(errors.filter((e) => e.field.startsWith("triggers"))).toHaveLength(0);
      });

      it("reports trigger referencing unknown team", () => {
        const triggers: Trigger[] = [
          { name: "bad-ref", type: "webhook", team: "nonexistent", path: "/hooks/test" } as WebhookTrigger,
        ];
        const errors = validateApp(makeApp({ triggers }));
        expect(errors.some((e) => e.field === "triggers[0].team")).toBe(true);
        expect(errors.find((e) => e.field === "triggers[0].team")?.message).toContain("nonexistent");
      });

      it("reports duplicate trigger names", () => {
        const triggers: Trigger[] = [
          { name: "dup", type: "webhook", team: "dev", path: "/hooks/a" } as WebhookTrigger,
          { name: "dup", type: "event", team: "dev", event: "error" } as EventTrigger,
        ];
        const errors = validateApp(makeApp({ triggers }));
        expect(errors.some((e) => e.field === "triggers[1].name" && e.message.includes("duplicate"))).toBe(true);
      });

      it("reports duplicate webhook paths", () => {
        const triggers: Trigger[] = [
          { name: "hook-a", type: "webhook", team: "dev", path: "/hooks/deploy" } as WebhookTrigger,
          { name: "hook-b", type: "webhook", team: "dev", path: "/hooks/deploy" } as WebhookTrigger,
        ];
        const errors = validateApp(makeApp({ triggers }));
        expect(errors.some((e) => e.field === "triggers[1].path" && e.message.includes("duplicate"))).toBe(true);
      });

      it("propagates trigger field validation errors with prefixed paths", () => {
        const triggers: Trigger[] = [
          { name: "", type: "webhook", team: "dev", path: "" } as unknown as WebhookTrigger,
        ];
        const errors = validateApp(makeApp({ triggers }));
        expect(errors.some((e) => e.field === "triggers[0].name")).toBe(true);
        expect(errors.some((e) => e.field === "triggers[0].path")).toBe(true);
      });
    });
  });
});
