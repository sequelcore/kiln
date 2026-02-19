import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDomainYaml, loadDomainYaml, DomainYamlError } from "../../src/domain/yaml-parser.js";

describe("parseDomainYaml", () => {
  const validYaml = `
name: python
displayName: Python
detectPatterns:
  - pyproject.toml
  - setup.py
toolTags:
  - python
  - testing
qualityGates:
  - name: lint
    command: "ruff check ."
    description: Lint Python source
    required: true
multishotExamples: "example content"
phaseExamples: "phase content"
`;

  it("parses valid YAML into DomainConfig", () => {
    const config = parseDomainYaml(validYaml);
    expect(config.name).toBe("python");
    expect(config.displayName).toBe("Python");
    expect(config.detectPatterns).toEqual(["pyproject.toml", "setup.py"]);
    expect(config.toolTags).toBeInstanceOf(Set);
    expect(config.toolTags.has("python")).toBe(true);
    expect(config.toolTags.has("testing")).toBe(true);
    expect(config.qualityGates).toHaveLength(1);
    expect(config.qualityGates[0]!.name).toBe("lint");
    expect(config.qualityGates[0]!.command).toBe("ruff check .");
    expect(config.qualityGates[0]!.required).toBe(true);
    expect(config.multishotExamples).toBe("example content");
    expect(config.phaseExamples).toBe("phase content");
  });

  it("converts toolTags array to Set", () => {
    const config = parseDomainYaml(validYaml);
    expect(config.toolTags).toBeInstanceOf(Set);
    expect(config.toolTags.size).toBe(2);
  });

  it("defaults required to true when not specified", () => {
    const yaml = `
name: test
displayName: Test
detectPatterns: []
toolTags: []
qualityGates:
  - name: lint
    command: "lint"
    description: "lint desc"
`;
    const config = parseDomainYaml(yaml);
    expect(config.qualityGates[0]!.required).toBe(true);
  });

  it("respects required: false", () => {
    const yaml = `
name: test
displayName: Test
detectPatterns: []
toolTags: []
qualityGates:
  - name: lint
    command: "lint"
    description: "lint desc"
    required: false
`;
    const config = parseDomainYaml(yaml);
    expect(config.qualityGates[0]!.required).toBe(false);
  });

  it("defaults multishotExamples to empty string", () => {
    const yaml = `
name: test
displayName: Test
detectPatterns: []
toolTags: []
qualityGates: []
`;
    const config = parseDomainYaml(yaml);
    expect(config.multishotExamples).toBe("");
  });

  it("defaults phaseExamples to empty string", () => {
    const yaml = `
name: test
displayName: Test
detectPatterns: []
toolTags: []
qualityGates: []
`;
    const config = parseDomainYaml(yaml);
    expect(config.phaseExamples).toBe("");
  });

  it("throws DomainYamlError for invalid YAML structure", () => {
    expect(() => parseDomainYaml("name: test")).toThrow(DomainYamlError);
  });

  it("throws DomainYamlError for empty content", () => {
    expect(() => parseDomainYaml("")).toThrow();
  });

  it("includes filePath in error when provided", () => {
    try {
      parseDomainYaml("name: test", "test.yaml");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainYamlError);
      expect((err as DomainYamlError).filePath).toBe("test.yaml");
    }
  });

  it("includes validation errors in error object", () => {
    try {
      parseDomainYaml("name: test");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainYamlError);
      expect((err as DomainYamlError).errors.length).toBeGreaterThan(0);
    }
  });

  it("parses YAML with multiple quality gates", () => {
    const yaml = `
name: fullstack
displayName: Full Stack
detectPatterns:
  - package.json
  - tsconfig.json
toolTags:
  - typescript
  - testing
qualityGates:
  - name: types
    command: "tsc --noEmit"
    description: Type check
    required: true
  - name: lint
    command: "eslint ."
    description: Lint code
    required: false
  - name: test
    command: "vitest run"
    description: Run tests
    required: true
`;
    const config = parseDomainYaml(yaml);
    expect(config.qualityGates).toHaveLength(3);
    expect(config.qualityGates[0]!.required).toBe(true);
    expect(config.qualityGates[1]!.required).toBe(false);
    expect(config.qualityGates[2]!.required).toBe(true);
  });
});

describe("loadDomainYaml", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads and parses YAML file from disk", () => {
    const yaml = `
name: python
displayName: Python
detectPatterns:
  - pyproject.toml
toolTags:
  - python
qualityGates:
  - name: lint
    command: "ruff check ."
    description: Lint
`;
    const filePath = join(tmpDir, "python.yaml");
    writeFileSync(filePath, yaml, "utf-8");

    const config = loadDomainYaml(filePath);
    expect(config.name).toBe("python");
    expect(config.displayName).toBe("Python");
    expect(config.toolTags.has("python")).toBe(true);
  });

  it("throws for non-existent file", () => {
    expect(() => loadDomainYaml(join(tmpDir, "missing.yaml"))).toThrow();
  });

  it("throws DomainYamlError for invalid file content", () => {
    const filePath = join(tmpDir, "invalid.yaml");
    writeFileSync(filePath, "not_valid: [", "utf-8");

    expect(() => loadDomainYaml(filePath)).toThrow();
  });

  it("includes file path in error message", () => {
    const filePath = join(tmpDir, "bad.yaml");
    writeFileSync(filePath, "name: test", "utf-8");

    try {
      loadDomainYaml(filePath);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainYamlError);
      expect((err as DomainYamlError).message).toContain("bad.yaml");
    }
  });
});
