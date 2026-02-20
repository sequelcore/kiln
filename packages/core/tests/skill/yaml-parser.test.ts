import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSkillYaml, loadSkillYaml, SkillYamlError } from "../../src/skill/yaml-parser.js";

describe("parseSkillYaml", () => {
  const fullYaml = `
name: code-review
description: Automated code review skill
tools:
  - read_file
  - search_code
triggers:
  - event: task_started
    filter:
      phase: review
tags:
  - review
  - quality
instructions: Review the code for quality issues.
handler: handlers/code-review.ts
`;

  const minimalYaml = `
name: summarizer
description: Summarizes content
instructions: Summarize the provided content.
`;

  it("parses valid YAML with all fields", () => {
    const config = parseSkillYaml(fullYaml);
    expect(config.name).toBe("code-review");
    expect(config.description).toBe("Automated code review skill");
    expect(config.tools).toEqual(["read_file", "search_code"]);
    expect(config.triggers).toHaveLength(1);
    expect(config.triggers[0]!.event).toBe("task_started");
    expect(config.triggers[0]!.filter).toEqual({ phase: "review" });
    expect(config.tags).toEqual(["review", "quality"]);
    expect(config.instructions).toBe("Review the code for quality issues.");
    expect(config.handler).toBe("handlers/code-review.ts");
  });

  it("parses minimal YAML with defaults applied", () => {
    const config = parseSkillYaml(minimalYaml);
    expect(config.name).toBe("summarizer");
    expect(config.description).toBe("Summarizes content");
    expect(config.instructions).toBe("Summarize the provided content.");
    expect(config.tools).toEqual([]);
    expect(config.triggers).toEqual([]);
    expect(config.tags).toEqual([]);
    expect(config.handler).toBeUndefined();
  });

  it("throws SkillYamlError for missing required fields", () => {
    expect(() => parseSkillYaml("name: test")).toThrow(SkillYamlError);
  });

  it("throws SkillYamlError for empty content", () => {
    expect(() => parseSkillYaml("")).toThrow();
  });

  it("includes filePath in error when provided", () => {
    try {
      parseSkillYaml("name: test", "skill.yaml");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillYamlError);
      expect((err as SkillYamlError).filePath).toBe("skill.yaml");
    }
  });

  it("includes validation errors in error object", () => {
    try {
      parseSkillYaml("name: test");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillYamlError);
      expect((err as SkillYamlError).errors.length).toBeGreaterThan(0);
    }
  });

  it("SkillYamlError has correct code", () => {
    try {
      parseSkillYaml("name: test");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillYamlError);
      expect((err as SkillYamlError).code).toBe("SKILL_YAML_INVALID");
    }
  });

  it("throws SkillYamlError for unknown event type in trigger", () => {
    const yaml = `
name: test
description: Test skill
instructions: Do the thing.
triggers:
  - event: unknown_event_xyz
`;
    try {
      parseSkillYaml(yaml);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillYamlError);
      expect((err as SkillYamlError).errors.some((e) => e.field.includes("triggers[0].event"))).toBe(true);
    }
  });

  it("accepts known event types in triggers", () => {
    const yaml = `
name: test
description: Test skill
instructions: Do the thing.
triggers:
  - event: task_started
  - event: task_completed
  - event: tool_called
`;
    const config = parseSkillYaml(yaml);
    expect(config.triggers).toHaveLength(3);
    expect(config.triggers[0]!.event).toBe("task_started");
    expect(config.triggers[1]!.event).toBe("task_completed");
    expect(config.triggers[2]!.event).toBe("tool_called");
  });

  it("trigger without filter has no filter property", () => {
    const yaml = `
name: test
description: Test skill
instructions: Do the thing.
triggers:
  - event: task_started
`;
    const config = parseSkillYaml(yaml);
    expect(config.triggers[0]!.filter).toBeUndefined();
  });
});

describe("loadSkillYaml", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-skill-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads and parses YAML file from disk", () => {
    const yaml = `
name: test-skill
description: A test skill
instructions: Do something useful.
tags:
  - test
`;
    const filePath = join(tmpDir, "test-skill.yaml");
    writeFileSync(filePath, yaml, "utf-8");

    const config = loadSkillYaml(filePath);
    expect(config.name).toBe("test-skill");
    expect(config.description).toBe("A test skill");
    expect(config.tags).toEqual(["test"]);
    expect(config.tools).toEqual([]);
  });

  it("throws for non-existent file", () => {
    expect(() => loadSkillYaml(join(tmpDir, "missing.yaml"))).toThrow();
  });

  it("throws SkillYamlError for invalid file content", () => {
    const filePath = join(tmpDir, "invalid.yaml");
    writeFileSync(filePath, "name: test", "utf-8");
    expect(() => loadSkillYaml(filePath)).toThrow(SkillYamlError);
  });

  it("includes file path in error message", () => {
    const filePath = join(tmpDir, "bad.yaml");
    writeFileSync(filePath, "name: test", "utf-8");

    try {
      loadSkillYaml(filePath);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillYamlError);
      expect((err as SkillYamlError).message).toContain("bad.yaml");
    }
  });
});
