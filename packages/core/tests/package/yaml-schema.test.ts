import { describe, it, expect } from "vitest";
import { validatePackageYaml } from "../../src/package/yaml-schema.js";

describe("validatePackageYaml", () => {
  const validDomainPackage = {
    type: "domain",
    version: "1.0.0",
    author: "Test Author",
    name: "python",
    displayName: "Python",
    detectPatterns: ["pyproject.toml"],
    toolTags: ["python"],
    qualityGates: [{ name: "lint", command: "ruff check .", description: "Lint" }],
  };

  const validSkillPackage = {
    type: "skill",
    version: "1.0.0",
    author: "Test Author",
    name: "refactor",
    description: "Refactoring skill",
    instructions: "Follow best practices",
  };

  describe("common fields", () => {
    it("accepts valid domain package", () => {
      expect(validatePackageYaml(validDomainPackage)).toHaveLength(0);
    });

    it("accepts valid skill package", () => {
      expect(validatePackageYaml(validSkillPackage)).toHaveLength(0);
    });

    it("rejects non-object input", () => {
      const errors = validatePackageYaml(null);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("(root)");
    });

    it("rejects missing type", () => {
      const { type, ...rest } = validDomainPackage;
      const errors = validatePackageYaml(rest);
      expect(errors.some((e) => e.field === "type")).toBe(true);
    });

    it("rejects invalid type", () => {
      const errors = validatePackageYaml({ ...validDomainPackage, type: "unknown" });
      expect(errors.some((e) => e.field === "type")).toBe(true);
    });

    it("rejects missing version", () => {
      const { version, ...rest } = validDomainPackage;
      const errors = validatePackageYaml(rest);
      expect(errors.some((e) => e.field === "version")).toBe(true);
    });

    it("rejects missing author", () => {
      const { author, ...rest } = validDomainPackage;
      const errors = validatePackageYaml(rest);
      expect(errors.some((e) => e.field === "author")).toBe(true);
    });
  });

  describe("domain package fields", () => {
    it("rejects domain package missing name", () => {
      const { name, ...rest } = validDomainPackage;
      const errors = validatePackageYaml(rest);
      expect(errors.some((e) => e.field === "name")).toBe(true);
    });

    it("rejects domain package missing displayName", () => {
      const { displayName, ...rest } = validDomainPackage;
      const errors = validatePackageYaml(rest);
      expect(errors.some((e) => e.field === "displayName")).toBe(true);
    });

    it("accepts domain package with skills", () => {
      const errors = validatePackageYaml({ ...validDomainPackage, skills: ["s1", "s2"] });
      expect(errors).toHaveLength(0);
    });

    it("rejects non-array skills", () => {
      const errors = validatePackageYaml({ ...validDomainPackage, skills: "not-array" });
      expect(errors.some((e) => e.field === "skills")).toBe(true);
    });

    it("accepts domain package with tools", () => {
      const errors = validatePackageYaml({ ...validDomainPackage, tools: { server: "server.ts" } });
      expect(errors).toHaveLength(0);
    });

    it("rejects tools without server", () => {
      const errors = validatePackageYaml({ ...validDomainPackage, tools: {} });
      expect(errors.some((e) => e.field === "tools.server")).toBe(true);
    });

    it("accepts domain package with knowledge", () => {
      const errors = validatePackageYaml({ ...validDomainPackage, knowledge: { examples: "ex.yaml" } });
      expect(errors).toHaveLength(0);
    });

    it("rejects non-object knowledge", () => {
      const errors = validatePackageYaml({ ...validDomainPackage, knowledge: "not-object" });
      expect(errors.some((e) => e.field === "knowledge")).toBe(true);
    });
  });

  describe("skill package fields", () => {
    it("rejects skill package missing name", () => {
      const { name, ...rest } = validSkillPackage;
      const errors = validatePackageYaml(rest);
      expect(errors.some((e) => e.field === "name")).toBe(true);
    });

    it("rejects skill package missing description", () => {
      const { description, ...rest } = validSkillPackage;
      const errors = validatePackageYaml(rest);
      expect(errors.some((e) => e.field === "description")).toBe(true);
    });

    it("rejects skill package missing instructions", () => {
      const { instructions, ...rest } = validSkillPackage;
      const errors = validatePackageYaml(rest);
      expect(errors.some((e) => e.field === "instructions")).toBe(true);
    });
  });

  describe("filePath tracking", () => {
    it("includes filePath in errors", () => {
      const errors = validatePackageYaml({}, "pkg.yaml");
      expect(errors.every((e) => e.filePath === "pkg.yaml")).toBe(true);
    });
  });
});
