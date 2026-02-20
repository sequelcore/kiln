import { describe, it, expect } from "vitest";
import type { SkillYaml, SkillTriggerYaml } from "../../src/skill/yaml-schema.js";
import { validateSkillYaml } from "../../src/skill/yaml-schema.js";

describe("validateSkillYaml", () => {
  const validMinimal: SkillYaml = {
    name: "code-review",
    description: "Automated code review skill",
    instructions: "Review the code for quality issues.",
  };

  const validFull: SkillYaml = {
    name: "code-review",
    description: "Automated code review skill",
    tools: ["read_file", "search_code"],
    triggers: [{ event: "task_started", filter: { phase: "review" } }],
    tags: ["review", "quality"],
    instructions: "Review the code for quality issues.",
    handler: "handlers/code-review.ts",
  };

  describe("valid inputs", () => {
    it("accepts valid minimal skill (name + description + instructions only)", () => {
      const errors = validateSkillYaml(validMinimal);
      expect(errors).toHaveLength(0);
    });

    it("accepts valid full skill (all fields)", () => {
      const errors = validateSkillYaml(validFull);
      expect(errors).toHaveLength(0);
    });

    it("accepts empty tools array", () => {
      const errors = validateSkillYaml({ ...validMinimal, tools: [] });
      expect(errors).toHaveLength(0);
    });

    it("accepts empty triggers array", () => {
      const errors = validateSkillYaml({ ...validMinimal, triggers: [] });
      expect(errors).toHaveLength(0);
    });

    it("accepts empty tags array", () => {
      const errors = validateSkillYaml({ ...validMinimal, tags: [] });
      expect(errors).toHaveLength(0);
    });

    it("accepts trigger without filter", () => {
      const trigger: SkillTriggerYaml = { event: "task_started" };
      const errors = validateSkillYaml({ ...validMinimal, triggers: [trigger] });
      expect(errors).toHaveLength(0);
    });
  });

  describe("root type check", () => {
    it("rejects null input", () => {
      const errors = validateSkillYaml(null);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("(root)");
      expect(errors[0]!.message).toContain("Expected an object");
    });

    it("rejects array input", () => {
      const errors = validateSkillYaml([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("(root)");
    });

    it("rejects string input", () => {
      const errors = validateSkillYaml("not an object");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("(root)");
    });
  });

  describe("required fields", () => {
    it("reports missing name", () => {
      const { name, ...rest } = validMinimal;
      const errors = validateSkillYaml(rest);
      expect(errors.some((e) => e.field === "name")).toBe(true);
    });

    it("reports missing description", () => {
      const { description, ...rest } = validMinimal;
      const errors = validateSkillYaml(rest);
      expect(errors.some((e) => e.field === "description")).toBe(true);
    });

    it("reports missing instructions", () => {
      const { instructions, ...rest } = validMinimal;
      const errors = validateSkillYaml(rest);
      expect(errors.some((e) => e.field === "instructions")).toBe(true);
    });

    it("reports all missing required fields at once", () => {
      const errors = validateSkillYaml({});
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("type checks", () => {
    it("rejects non-string name", () => {
      const errors = validateSkillYaml({ ...validMinimal, name: 123 });
      expect(errors.some((e) => e.field === "name")).toBe(true);
    });

    it("rejects non-string description", () => {
      const errors = validateSkillYaml({ ...validMinimal, description: 123 });
      expect(errors.some((e) => e.field === "description")).toBe(true);
    });

    it("rejects non-string instructions", () => {
      const errors = validateSkillYaml({ ...validMinimal, instructions: 123 });
      expect(errors.some((e) => e.field === "instructions")).toBe(true);
    });

    it("rejects non-string handler", () => {
      const errors = validateSkillYaml({ ...validMinimal, handler: 123 });
      expect(errors.some((e) => e.field === "handler")).toBe(true);
    });

    it("rejects non-array tools", () => {
      const errors = validateSkillYaml({ ...validMinimal, tools: "not-array" });
      expect(errors.some((e) => e.field === "tools")).toBe(true);
    });

    it("rejects non-string tool items", () => {
      const errors = validateSkillYaml({ ...validMinimal, tools: [123, "valid"] });
      expect(errors.some((e) => e.field === "tools[0]")).toBe(true);
    });

    it("rejects non-array tags", () => {
      const errors = validateSkillYaml({ ...validMinimal, tags: "not-array" });
      expect(errors.some((e) => e.field === "tags")).toBe(true);
    });

    it("rejects non-string tag items", () => {
      const errors = validateSkillYaml({ ...validMinimal, tags: [123, "valid"] });
      expect(errors.some((e) => e.field === "tags[0]")).toBe(true);
    });

    it("rejects non-array triggers", () => {
      const errors = validateSkillYaml({ ...validMinimal, triggers: "not-array" });
      expect(errors.some((e) => e.field === "triggers")).toBe(true);
    });
  });

  describe("trigger validation", () => {
    it("rejects trigger missing event field", () => {
      const errors = validateSkillYaml({ ...validMinimal, triggers: [{ filter: {} }] });
      expect(errors.some((e) => e.field === "triggers[0].event")).toBe(true);
    });

    it("rejects trigger with non-string event", () => {
      const errors = validateSkillYaml({ ...validMinimal, triggers: [{ event: 123 }] });
      expect(errors.some((e) => e.field === "triggers[0].event")).toBe(true);
    });

    it("rejects non-object trigger", () => {
      const errors = validateSkillYaml({ ...validMinimal, triggers: ["not-object"] });
      expect(errors.some((e) => e.field === "triggers[0]")).toBe(true);
    });

    it("validates multiple triggers independently", () => {
      const errors = validateSkillYaml({
        ...validMinimal,
        triggers: [
          { event: "task_started" },
          { filter: {} }, // missing event
        ],
      });
      expect(errors.some((e) => e.field === "triggers[1].event")).toBe(true);
      expect(errors.some((e) => e.field.startsWith("triggers[0]"))).toBe(false);
    });
  });

  describe("filePath tracking", () => {
    it("includes filePath in errors when provided", () => {
      const errors = validateSkillYaml({}, "skill.yaml");
      expect(errors.every((e) => e.filePath === "skill.yaml")).toBe(true);
    });

    it("does not include filePath when not provided", () => {
      const errors = validateSkillYaml({});
      expect(errors.every((e) => e.filePath === undefined)).toBe(true);
    });
  });
});
