import { describe, it, expect } from "vitest";
import {
  ARCHITECT_PLAN_SCHEMA,
  ARCHITECT_EVALUATION_SCHEMA,
  ARCHITECT_REVIEW_SCHEMA,
} from "../../src/orchestrator/schemas.js";

const ALL_SCHEMAS = [
  { name: "ARCHITECT_PLAN_SCHEMA", schema: ARCHITECT_PLAN_SCHEMA },
  { name: "ARCHITECT_EVALUATION_SCHEMA", schema: ARCHITECT_EVALUATION_SCHEMA },
  { name: "ARCHITECT_REVIEW_SCHEMA", schema: ARCHITECT_REVIEW_SCHEMA },
] as const;

describe("Architect Schemas", () => {
  describe.each(ALL_SCHEMAS)("$name", ({ schema }) => {
    it("has additionalProperties: false at root", () => {
      expect(schema.additionalProperties).toBe(false);
    });

    it("has a required array", () => {
      expect(Array.isArray(schema.required)).toBe(true);
      expect(schema.required.length).toBeGreaterThan(0);
    });

    it("root type is object", () => {
      expect(schema.type).toBe("object");
    });

    it("can be serialized and deserialized without loss", () => {
      const serialized = JSON.stringify(schema);
      const deserialized = JSON.parse(serialized) as Record<string, unknown>;
      expect(deserialized).toEqual(JSON.parse(JSON.stringify(schema)));
    });
  });

  describe("ARCHITECT_PLAN_SCHEMA", () => {
    it("has tasks property", () => {
      expect(ARCHITECT_PLAN_SCHEMA.properties.tasks).toBeDefined();
      expect(ARCHITECT_PLAN_SCHEMA.properties.tasks.type).toBe("array");
    });

    it("has approach property", () => {
      expect(ARCHITECT_PLAN_SCHEMA.properties.approach).toBeDefined();
      expect(ARCHITECT_PLAN_SCHEMA.properties.approach.type).toBe("string");
    });

    it("has risks property", () => {
      expect(ARCHITECT_PLAN_SCHEMA.properties.risks).toBeDefined();
      expect(ARCHITECT_PLAN_SCHEMA.properties.risks.type).toBe("array");
    });

    it("has estimatedComplexity property with enum", () => {
      expect(ARCHITECT_PLAN_SCHEMA.properties.estimatedComplexity).toBeDefined();
      expect(ARCHITECT_PLAN_SCHEMA.properties.estimatedComplexity.enum).toEqual([
        "low",
        "medium",
        "high",
      ]);
    });

    it("task items have additionalProperties: false", () => {
      expect(ARCHITECT_PLAN_SCHEMA.properties.tasks.items.additionalProperties).toBe(false);
    });
  });

  describe("ARCHITECT_EVALUATION_SCHEMA", () => {
    it("has taskId property", () => {
      expect(ARCHITECT_EVALUATION_SCHEMA.properties.taskId).toBeDefined();
      expect(ARCHITECT_EVALUATION_SCHEMA.properties.taskId.type).toBe("string");
    });

    it("has action property with enum", () => {
      expect(ARCHITECT_EVALUATION_SCHEMA.properties.action).toBeDefined();
      expect(ARCHITECT_EVALUATION_SCHEMA.properties.action.enum).toEqual([
        "deepen",
        "branch",
        "prune",
      ]);
    });

    it("has reasoning property", () => {
      expect(ARCHITECT_EVALUATION_SCHEMA.properties.reasoning).toBeDefined();
      expect(ARCHITECT_EVALUATION_SCHEMA.properties.reasoning.type).toBe("string");
    });

    it("has newTask property (nullable object)", () => {
      expect(ARCHITECT_EVALUATION_SCHEMA.properties.newTask).toBeDefined();
      expect(ARCHITECT_EVALUATION_SCHEMA.properties.newTask.type).toEqual(["object", "null"]);
      expect(ARCHITECT_EVALUATION_SCHEMA.properties.newTask.additionalProperties).toBe(false);
    });

    it("has gatesPassed property", () => {
      expect(ARCHITECT_EVALUATION_SCHEMA.properties.gatesPassed).toBeDefined();
      expect(ARCHITECT_EVALUATION_SCHEMA.properties.gatesPassed.type).toBe("boolean");
    });
  });

  describe("ARCHITECT_REVIEW_SCHEMA", () => {
    it("has approved property", () => {
      expect(ARCHITECT_REVIEW_SCHEMA.properties.approved).toBeDefined();
      expect(ARCHITECT_REVIEW_SCHEMA.properties.approved.type).toBe("boolean");
    });

    it("has issues array with structured items", () => {
      expect(ARCHITECT_REVIEW_SCHEMA.properties.issues).toBeDefined();
      expect(ARCHITECT_REVIEW_SCHEMA.properties.issues.type).toBe("array");
      const items = ARCHITECT_REVIEW_SCHEMA.properties.issues.items;
      expect(items.properties.file).toBeDefined();
      expect(items.properties.line).toBeDefined();
      expect(items.properties.description).toBeDefined();
      expect(items.properties.severity).toBeDefined();
      expect(items.additionalProperties).toBe(false);
    });

    it("has suggestions property", () => {
      expect(ARCHITECT_REVIEW_SCHEMA.properties.suggestions).toBeDefined();
      expect(ARCHITECT_REVIEW_SCHEMA.properties.suggestions.type).toBe("array");
    });

    it("issue severity has correct enum values", () => {
      const severity = ARCHITECT_REVIEW_SCHEMA.properties.issues.items.properties.severity;
      expect(severity.enum).toEqual(["error", "warning", "info"]);
    });
  });
});
