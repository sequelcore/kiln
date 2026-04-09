import { describe, it, expect } from "vitest";
import {
  TeamComposer,
  BUILTIN_TEMPLATES,
  type TeamTemplate,
  type TeamRole,
} from "../../src/orchestrator/team-composer.js";
import { ThresholdAllocator } from "../../src/orchestrator/threshold-allocator.js";
import { CascadeController } from "../../src/orchestrator/cascade-controller.js";

describe("TeamComposer", () => {
  describe("compose", () => {
    it("compose('java', 0.8) returns java-spring template with all 5 roles", () => {
      const composer = new TeamComposer();
      const team = composer.compose("java", 0.8);

      expect(team.templateId).toBe("java-spring");
      expect(team.roles.length).toBe(5);
      expect(team.roles.map((r) => r.name)).toEqual([
        "planner",
        "implementer",
        "tdd-guide",
        "reviewer",
        "architect",
      ]);
    });

    it("compose('java', 0.2) returns java-spring template with only required roles (3)", () => {
      const composer = new TeamComposer();
      const team = composer.compose("java", 0.2);

      expect(team.templateId).toBe("java-spring");
      expect(team.roles.length).toBe(3);
      expect(team.roles.map((r) => r.name)).toEqual([
        "planner",
        "implementer",
        "tdd-guide",
      ]);
    });

    it("compose('react', 0.6) returns react-typescript template with all 4 roles", () => {
      const composer = new TeamComposer();
      const team = composer.compose("react", 0.6);

      expect(team.templateId).toBe("react-typescript");
      expect(team.roles.length).toBe(4);
      expect(team.roles.map((r) => r.name)).toEqual([
        "planner",
        "implementer",
        "reviewer",
        "designer",
      ]);
    });

    it("compose('unknown', 0.5) falls back to generic template", () => {
      const composer = new TeamComposer();
      const team = composer.compose("unknown", 0.5);

      expect(team.templateId).toBe("generic");
      expect(team.roles.length).toBe(3);
    });

    it("compose domain matching is case-insensitive ('Java' matches 'java')", () => {
      const composer = new TeamComposer();
      const team = composer.compose("Java", 0.8);

      expect(team.templateId).toBe("java-spring");
    });

    it("composed team has pre-configured ThresholdAllocator with correct agent count", () => {
      const composer = new TeamComposer();
      const team = composer.compose("java", 0.8);

      expect(team.allocator).toBeInstanceOf(ThresholdAllocator);
      expect(team.allocator.getThresholds("planner")).toBeDefined();
      expect(team.allocator.getThresholds("implementer")).toBeDefined();
      expect(team.allocator.getThresholds("tdd-guide")).toBeDefined();
    });

    it("composed team has CascadeController with template's cascade config", () => {
      const composer = new TeamComposer();
      const team = composer.compose("java", 0.8);

      expect(team.cascadeController).toBeInstanceOf(CascadeController);
      expect(team.cascadeController.shouldContinue(0.3)).toBe(true);
    });
  });

  describe("registerTemplate", () => {
    it("registerTemplate adds custom template, compose uses it", () => {
      const customTemplate: TeamTemplate = {
        id: "custom-test",
        name: "Custom Test Team",
        domains: ["custom"],
        roles: [
          {
            name: "custom-role",
            category: "triage",
            thresholds: { triage: 0.1 },
            required: true,
            pipelineOrder: 1,
          },
        ],
        maxConcurrent: 2,
      };

      const composer = new TeamComposer();
      composer.registerTemplate(customTemplate);
      const team = composer.compose("custom", 0.5);

      expect(team.templateId).toBe("custom-test");
      expect(team.roles.length).toBe(1);
      expect(team.roles[0]!.name).toBe("custom-role");
    });

    it("registerTemplate replaces built-in by id", () => {
      const replacementTemplate: TeamTemplate = {
        id: "java-spring",
        name: "Replaced Java Spring Team",
        domains: ["java"],
        roles: [
          {
            name: "replaced-planner",
            category: "triage",
            thresholds: { triage: 0.1 },
            required: true,
            pipelineOrder: 1,
          },
        ],
        maxConcurrent: 1,
      };

      const composer = new TeamComposer();
      composer.registerTemplate(replacementTemplate);
      const team = composer.compose("java", 0.8);

      expect(team.templateId).toBe("java-spring");
      expect(team.roles[0]!.name).toBe("replaced-planner");
    });
  });

  describe("getTemplate", () => {
    it("getTemplate returns template by id", () => {
      const composer = new TeamComposer();
      const template = composer.getTemplate("java-spring");

      expect(template).toBeDefined();
      expect(template!.id).toBe("java-spring");
    });

    it("getTemplate returns undefined for unknown", () => {
      const composer = new TeamComposer();
      const template = composer.getTemplate("nonexistent");

      expect(template).toBeUndefined();
    });
  });

  describe("listTemplates", () => {
    it("listTemplates returns all registered templates", () => {
      const composer = new TeamComposer();
      const templates = composer.listTemplates();

      expect(templates.length).toBe(4);
      expect(templates.map((t) => t.id)).toContain("java-spring");
      expect(templates.map((t) => t.id)).toContain("react-typescript");
      expect(templates.map((t) => t.id)).toContain("python");
      expect(templates.map((t) => t.id)).toContain("generic");
    });
  });

  describe("generic template", () => {
    it("default generic template has no domains array entries (empty array)", () => {
      const composer = new TeamComposer();
      const generic = composer.getTemplate("generic");

      expect(generic).toBeDefined();
      expect(generic!.domains.length).toBe(0);
    });
  });

  describe("pipelineOrder", () => {
    it("roles have correct pipelineOrder values", () => {
      const composer = new TeamComposer();
      const team = composer.compose("java", 0.8);
      const rolesMap = new Map(team.roles.map((r) => [r.name, r.pipelineOrder]));

      expect(rolesMap.get("planner")).toBe(1);
      expect(rolesMap.get("implementer")).toBe(2);
      expect(rolesMap.get("tdd-guide")).toBe(2);
      expect(rolesMap.get("reviewer")).toBe(3);
      expect(rolesMap.get("architect")).toBe(1);
    });
  });

  describe("complexity filtering", () => {
    it("compose with complexity < 0.4 filters out on-demand roles across all templates", () => {
      const composer = new TeamComposer();

      const pythonTeam = composer.compose("python", 0.3);
      expect(pythonTeam.roles.length).toBe(3); // all 3 roles are required=true in python template
      expect(pythonTeam.roles.map((r) => r.name)).toContain("planner");
      expect(pythonTeam.roles.map((r) => r.name)).toContain("implementer");
      expect(pythonTeam.roles.map((r) => r.name)).toContain("tester");

      const reactTeam = composer.compose("react", 0.3);
      expect(reactTeam.roles.length).toBe(3); // planner + implementer + reviewer (all required=true in react template)
    });
  });

  describe("BUILTIN_TEMPLATES", () => {
    it("is a frozen array", () => {
      expect(Object.isFrozen(BUILTIN_TEMPLATES)).toBe(true);
    });

    it("contains 4 templates", () => {
      expect(BUILTIN_TEMPLATES.length).toBe(4);
    });
  });
});
