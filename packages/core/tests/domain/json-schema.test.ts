import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("domain.schema.json", () => {
  const schemaPath = join(__dirname, "../../src/domain/schema/domain.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

  it("is valid JSON Schema draft-07", () => {
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
  });

  it("has correct $id", () => {
    expect(schema.$id).toBe("https://kiln.dev/schemas/domain.schema.json");
  });

  it("has correct title", () => {
    expect(schema.title).toBe("Kiln Domain Configuration");
  });

  it("is an object type", () => {
    expect(schema.type).toBe("object");
  });

  it("requires all mandatory fields", () => {
    expect(schema.required).toContain("name");
    expect(schema.required).toContain("displayName");
    expect(schema.required).toContain("detectPatterns");
    expect(schema.required).toContain("toolTags");
    expect(schema.required).toContain("qualityGates");
  });

  it("disallows additional properties", () => {
    expect(schema.additionalProperties).toBe(false);
  });

  describe("properties", () => {
    it("defines name as string", () => {
      expect(schema.properties.name.type).toBe("string");
    });

    it("defines displayName as string", () => {
      expect(schema.properties.displayName.type).toBe("string");
    });

    it("defines detectPatterns as array of strings", () => {
      expect(schema.properties.detectPatterns.type).toBe("array");
      expect(schema.properties.detectPatterns.items.type).toBe("string");
    });

    it("defines toolTags as array of strings", () => {
      expect(schema.properties.toolTags.type).toBe("array");
      expect(schema.properties.toolTags.items.type).toBe("string");
    });

    it("defines qualityGates as array of objects", () => {
      expect(schema.properties.qualityGates.type).toBe("array");
      expect(schema.properties.qualityGates.items.type).toBe("object");
    });

    it("defines quality gate required fields", () => {
      const gateSchema = schema.properties.qualityGates.items;
      expect(gateSchema.required).toContain("name");
      expect(gateSchema.required).toContain("command");
      expect(gateSchema.required).toContain("description");
    });

    it("defines quality gate properties", () => {
      const gateProps = schema.properties.qualityGates.items.properties;
      expect(gateProps.name.type).toBe("string");
      expect(gateProps.command.type).toBe("string");
      expect(gateProps.description.type).toBe("string");
      expect(gateProps.required.type).toBe("boolean");
      expect(gateProps.required.default).toBe(true);
    });

    it("defines multishotExamples as string with default", () => {
      expect(schema.properties.multishotExamples.type).toBe("string");
      expect(schema.properties.multishotExamples.default).toBe("");
    });

    it("defines phaseExamples as string with default", () => {
      expect(schema.properties.phaseExamples.type).toBe("string");
      expect(schema.properties.phaseExamples.default).toBe("");
    });
  });
});
