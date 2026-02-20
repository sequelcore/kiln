import { describe, it, expect } from "vitest";
import type { App, MemoryConfig } from "../../../src/engine/composites/app.js";
import { validateApp } from "../../../src/engine/composites/app.js";
import type { Team } from "../../../src/engine/composites/team.js";
import type { Router } from "../../../src/engine/composites/router.js";
import type { Agent } from "../../../src/engine/domain/agent.js";
import type { Capability } from "../../../src/engine/domain/capability.js";
import type { Workflow } from "../../../src/engine/domain/workflow.js";
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

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    phases: ["implement", "verify"],
    gates: { verify: { requires: ["tests_pass"] } },
    ...overrides,
  };
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    name: "development",
    agents: { worker: makeAgent() },
    workflow: makeWorkflow(),
    capabilities: [makeCapability()],
    qualityGates: [{ name: "test", command: "vitest run", description: "Run tests", required: true }],
    ...overrides,
  };
}

function makeRouter(overrides: Partial<Router> = {}): Router {
  return {
    rules: [{ match: "^code:", team: "dev" }],
    fallback: "dev",
    ...overrides,
  };
}

function makeMemory(overrides: Partial<MemoryConfig> = {}): MemoryConfig {
  return {
    scopes: ["user", "project:my-project"],
    backend: "sqlite",
    ...overrides,
  };
}

function makeApp(overrides: Partial<App> = {}): App {
  return {
    name: "test-app",
    teams: { dev: makeTeam({ name: "dev" }) },
    router: makeRouter(),
    memory: makeMemory(),
    channels: ["cli", "web"],
    ...overrides,
  };
}

describe("App composite", () => {
  describe("interface conformance", () => {
    it("accepts a valid App", () => {
      const app = makeApp();
      expect(app.name).toBe("test-app");
      expect(Object.keys(app.teams)).toHaveLength(1);
      expect(app.channels).toHaveLength(2);
      expect(app.router.fallback).toBe("dev");
    });

    it("accepts a valid MemoryConfig", () => {
      const memory = makeMemory();
      expect(memory.scopes).toHaveLength(2);
      expect(memory.backend).toBe("sqlite");
      expect(memory.sync).toBeUndefined();
    });

    it("accepts MemoryConfig with optional sync", () => {
      const memory = makeMemory({ sync: "git" });
      expect(memory.sync).toBe("git");
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

    it("reports no channels", () => {
      const errors = validateApp(makeApp({ channels: [] }));
      expect(errors.some((e) => e.field === "channels")).toBe(true);
    });

    it("reports router fallback referencing unknown team", () => {
      const app = makeApp({ router: makeRouter({ fallback: "nonexistent" }) });
      const errors = validateApp(app);
      expect(errors.some((e) => e.field === "router.fallback")).toBe(true);
      expect(errors.find((e) => e.field === "router.fallback")?.message).toContain("nonexistent");
    });

    it("reports router rule referencing unknown team", () => {
      const app = makeApp({
        router: makeRouter({ rules: [{ match: "^test:", team: "unknown" }] }),
      });
      const errors = validateApp(app);
      expect(errors.some((e) => e.field === "router.rules[0].team")).toBe(true);
      expect(errors.find((e) => e.field === "router.rules[0].team")?.message).toContain("unknown");
    });

    it("reports empty memory scopes", () => {
      const errors = validateApp(makeApp({ memory: makeMemory({ scopes: [] }) }));
      expect(errors.some((e) => e.field === "memory.scopes")).toBe(true);
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
        channels: [],
        memory: makeMemory({ scopes: [] }),
      });
      const errors = validateApp(app);
      expect(errors.length).toBeGreaterThanOrEqual(4);
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
