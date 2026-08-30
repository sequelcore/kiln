import { describe, it, expect } from "vitest";
import {
  parseDomainPackageYaml,
  parseSkillPackageYaml,
  PackageYamlError,
} from "../../src/package/yaml-parser.js";
import { computeContentHash } from "../../src/package/security.js";

const VALID_DOMAIN_PACKAGE = `
type: domain
version: "1.2.0"
author: "Test Author"
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
skills:
  - skills/refactor.md
tools:
  server: tools/server.ts
`;

const VALID_SKILL_PACKAGE = `
type: skill
version: "0.1.0"
author: "Skill Author"
name: refactor
description: Code refactoring skill
instructions: Follow clean code principles
tags:
  - refactoring
  - quality
`;

describe("parseDomainPackageYaml", () => {
  it("parses full domain package YAML", () => {
    const manifest = parseDomainPackageYaml(VALID_DOMAIN_PACKAGE, "/install/path");
    expect(manifest.type).toBe("domain");
    expect(manifest.name).toBe("python");
    expect(manifest.version).toBe("1.2.0");
    expect(manifest.author).toBe("Test Author");
    expect(manifest.installPath).toBe("/install/path");
    expect(manifest.config.name).toBe("python");
    expect(manifest.config.toolTags.has("python")).toBe(true);
    expect(manifest.skills).toEqual(["skills/refactor.md"]);
    expect(manifest.tools).toEqual({ server: "tools/server.ts" });
    expect(manifest.contentHash).toBe(computeContentHash(VALID_DOMAIN_PACKAGE));
  });

  it("throws PackageYamlError for invalid YAML", () => {
    expect(() => parseDomainPackageYaml("type: domain", "/path")).toThrow(PackageYamlError);
  });

  it("throws for non-domain type", () => {
    expect(() => parseDomainPackageYaml(VALID_SKILL_PACKAGE, "/path")).toThrow(PackageYamlError);
  });

  it("includes filePath in error", () => {
    try {
      parseDomainPackageYaml("type: domain", "/path", "test.yaml");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PackageYamlError);
      expect((err as PackageYamlError).filePath).toBe("test.yaml");
    }
  });
});

describe("parseSkillPackageYaml", () => {
  it("parses full skill package YAML", () => {
    const manifest = parseSkillPackageYaml(VALID_SKILL_PACKAGE, "/install/path");
    expect(manifest.type).toBe("skill");
    expect(manifest.name).toBe("refactor");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.author).toBe("Skill Author");
    expect(manifest.skill.name).toBe("refactor");
    expect(manifest.skill.description).toBe("Code refactoring skill");
    expect(manifest.skill.tags).toEqual(["refactoring", "quality"]);
    expect(manifest.contentHash).toBe(computeContentHash(VALID_SKILL_PACKAGE));
  });

  it("throws for non-skill type", () => {
    expect(() => parseSkillPackageYaml(VALID_DOMAIN_PACKAGE, "/path")).toThrow(PackageYamlError);
  });
});
