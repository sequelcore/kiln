import { describe, it, expect } from "vitest";
import type { DomainYaml, QualityGateYaml, DomainToolsYaml, DomainKnowledgeYaml } from "../../src/domain/yaml-schema.js";
import { validateDomainYaml } from "../../src/domain/yaml-schema.js";

describe("validateDomainYaml", () => {
  const validYaml: DomainYaml = {
    name: "python",
    displayName: "Python",
    detectPatterns: ["pyproject.toml", "setup.py"],
    toolTags: ["python", "testing"],
    qualityGates: [
      { name: "lint", command: "ruff check .", description: "Lint Python source" },
    ],
    multishotExamples: "",
    phaseExamples: "",
  };

  it("accepts valid domain yaml", () => {
    const errors = validateDomainYaml(validYaml);
    expect(errors).toHaveLength(0);
  });

  it("accepts valid yaml without optional fields", () => {
    const { multishotExamples, phaseExamples, ...minimal } = validYaml;
    const errors = validateDomainYaml(minimal);
    expect(errors).toHaveLength(0);
  });

  it("rejects null input", () => {
    const errors = validateDomainYaml(null);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("(root)");
    expect(errors[0]!.message).toContain("Expected an object");
  });

  it("rejects array input", () => {
    const errors = validateDomainYaml([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("(root)");
  });

  it("rejects primitive input", () => {
    const errors = validateDomainYaml("not an object");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("(root)");
  });

  describe("required fields", () => {
    it("reports missing name", () => {
      const { name, ...rest } = validYaml;
      const errors = validateDomainYaml(rest);
      expect(errors.some((e) => e.field === "name")).toBe(true);
    });

    it("reports missing displayName", () => {
      const { displayName, ...rest } = validYaml;
      const errors = validateDomainYaml(rest);
      expect(errors.some((e) => e.field === "displayName")).toBe(true);
    });

    it("reports missing detectPatterns", () => {
      const { detectPatterns, ...rest } = validYaml;
      const errors = validateDomainYaml(rest);
      expect(errors.some((e) => e.field === "detectPatterns")).toBe(true);
    });

    it("reports missing toolTags", () => {
      const { toolTags, ...rest } = validYaml;
      const errors = validateDomainYaml(rest);
      expect(errors.some((e) => e.field === "toolTags")).toBe(true);
    });

    it("reports missing qualityGates", () => {
      const { qualityGates, ...rest } = validYaml;
      const errors = validateDomainYaml(rest);
      expect(errors.some((e) => e.field === "qualityGates")).toBe(true);
    });

    it("reports all missing required fields at once", () => {
      const errors = validateDomainYaml({});
      expect(errors.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("type checks", () => {
    it("rejects non-string name", () => {
      const errors = validateDomainYaml({ ...validYaml, name: 123 });
      expect(errors.some((e) => e.field === "name")).toBe(true);
    });

    it("rejects non-string displayName", () => {
      const errors = validateDomainYaml({ ...validYaml, displayName: 123 });
      expect(errors.some((e) => e.field === "displayName")).toBe(true);
    });

    it("rejects non-array detectPatterns", () => {
      const errors = validateDomainYaml({ ...validYaml, detectPatterns: "not-array" });
      expect(errors.some((e) => e.field === "detectPatterns")).toBe(true);
    });

    it("rejects non-array toolTags", () => {
      const errors = validateDomainYaml({ ...validYaml, toolTags: "not-array" });
      expect(errors.some((e) => e.field === "toolTags")).toBe(true);
    });

    it("rejects non-string multishotExamples", () => {
      const errors = validateDomainYaml({ ...validYaml, multishotExamples: 123 });
      expect(errors.some((e) => e.field === "multishotExamples")).toBe(true);
    });

    it("rejects non-string phaseExamples", () => {
      const errors = validateDomainYaml({ ...validYaml, phaseExamples: 123 });
      expect(errors.some((e) => e.field === "phaseExamples")).toBe(true);
    });
  });

  describe("quality gates validation", () => {
    it("rejects non-array qualityGates", () => {
      const errors = validateDomainYaml({ ...validYaml, qualityGates: "not-array" });
      expect(errors.some((e) => e.field === "qualityGates")).toBe(true);
    });

    it("rejects gate missing name", () => {
      const errors = validateDomainYaml({
        ...validYaml,
        qualityGates: [{ command: "test", description: "desc" }],
      });
      expect(errors.some((e) => e.field === "qualityGates[0].name")).toBe(true);
    });

    it("rejects gate missing command", () => {
      const errors = validateDomainYaml({
        ...validYaml,
        qualityGates: [{ name: "test", description: "desc" }],
      });
      expect(errors.some((e) => e.field === "qualityGates[0].command")).toBe(true);
    });

    it("rejects gate missing description", () => {
      const errors = validateDomainYaml({
        ...validYaml,
        qualityGates: [{ name: "test", command: "cmd" }],
      });
      expect(errors.some((e) => e.field === "qualityGates[0].description")).toBe(true);
    });

    it("validates multiple gates independently", () => {
      const errors = validateDomainYaml({
        ...validYaml,
        qualityGates: [
          { name: "good", command: "cmd", description: "desc" },
          { command: "cmd" }, // missing name and description
        ],
      });
      expect(errors.some((e) => e.field === "qualityGates[1].name")).toBe(true);
      expect(errors.some((e) => e.field === "qualityGates[1].description")).toBe(true);
      expect(errors.some((e) => e.field.startsWith("qualityGates[0]"))).toBe(false);
    });

    it("accepts gate with optional required field", () => {
      const gate: QualityGateYaml = {
        name: "test",
        command: "pytest",
        description: "Run tests",
        required: false,
      };
      const errors = validateDomainYaml({ ...validYaml, qualityGates: [gate] });
      expect(errors).toHaveLength(0);
    });
  });

  describe("marketplace fields", () => {
    it("accepts valid version", () => {
      const errors = validateDomainYaml({ ...validYaml, version: "1.0.0" });
      expect(errors).toHaveLength(0);
    });

    it("rejects non-string version", () => {
      const errors = validateDomainYaml({ ...validYaml, version: 123 });
      expect(errors.some((e) => e.field === "version")).toBe(true);
    });

    it("accepts valid author", () => {
      const errors = validateDomainYaml({ ...validYaml, author: "Test Author" });
      expect(errors).toHaveLength(0);
    });

    it("rejects non-string author", () => {
      const errors = validateDomainYaml({ ...validYaml, author: 123 });
      expect(errors.some((e) => e.field === "author")).toBe(true);
    });

    it("accepts valid skills array", () => {
      const errors = validateDomainYaml({ ...validYaml, skills: ["skill1", "skill2"] });
      expect(errors).toHaveLength(0);
    });

    it("rejects non-array skills", () => {
      const errors = validateDomainYaml({ ...validYaml, skills: "not-array" });
      expect(errors.some((e) => e.field === "skills")).toBe(true);
    });

    it("rejects non-string skill entries", () => {
      const errors = validateDomainYaml({ ...validYaml, skills: [123, "valid"] });
      expect(errors.some((e) => e.field === "skills[0]")).toBe(true);
    });

    it("accepts valid tools object", () => {
      const tools: DomainToolsYaml = { server: "tools/server.ts" };
      const errors = validateDomainYaml({ ...validYaml, tools });
      expect(errors).toHaveLength(0);
    });

    it("rejects non-object tools", () => {
      const errors = validateDomainYaml({ ...validYaml, tools: "not-object" });
      expect(errors.some((e) => e.field === "tools")).toBe(true);
    });

    it("rejects tools without server", () => {
      const errors = validateDomainYaml({ ...validYaml, tools: {} });
      expect(errors.some((e) => e.field === "tools.server")).toBe(true);
    });

    it("rejects tools with non-string server", () => {
      const errors = validateDomainYaml({ ...validYaml, tools: { server: 123 } });
      expect(errors.some((e) => e.field === "tools.server")).toBe(true);
    });

    it("accepts valid knowledge object", () => {
      const knowledge: DomainKnowledgeYaml = { examples: "examples.yaml", gates: "gates.yaml" };
      const errors = validateDomainYaml({ ...validYaml, knowledge });
      expect(errors).toHaveLength(0);
    });

    it("accepts knowledge with only examples", () => {
      const errors = validateDomainYaml({ ...validYaml, knowledge: { examples: "ex.yaml" } });
      expect(errors).toHaveLength(0);
    });

    it("accepts knowledge with only gates", () => {
      const errors = validateDomainYaml({ ...validYaml, knowledge: { gates: "gates.yaml" } });
      expect(errors).toHaveLength(0);
    });

    it("rejects non-object knowledge", () => {
      const errors = validateDomainYaml({ ...validYaml, knowledge: "not-object" });
      expect(errors.some((e) => e.field === "knowledge")).toBe(true);
    });

    it("rejects knowledge with non-string examples", () => {
      const errors = validateDomainYaml({ ...validYaml, knowledge: { examples: 123 } });
      expect(errors.some((e) => e.field === "knowledge.examples")).toBe(true);
    });

    it("rejects knowledge with non-string gates", () => {
      const errors = validateDomainYaml({ ...validYaml, knowledge: { gates: 123 } });
      expect(errors.some((e) => e.field === "knowledge.gates")).toBe(true);
    });
  });

  describe("filePath tracking", () => {
    it("includes filePath in error when provided", () => {
      const errors = validateDomainYaml({}, "test.yaml");
      expect(errors.every((e) => e.filePath === "test.yaml")).toBe(true);
    });

    it("does not include filePath when not provided", () => {
      const errors = validateDomainYaml({});
      expect(errors.every((e) => e.filePath === undefined)).toBe(true);
    });
  });
});
