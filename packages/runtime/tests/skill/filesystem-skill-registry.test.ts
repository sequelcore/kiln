import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFilesystemSkillRegistry,
  discoverSkillsFromDirectories,
  readSkillMd,
  readSkillMdIndex,
} from "../../src/skill/filesystem-skill-registry.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("filesystem skill registry", () => {
  it("discovers directories in order, preserves precedence, and materializes lazily", () => {
    const project = temporaryDirectory();
    const user = temporaryDirectory();
    writeSkill(project, "shared", "project version", "Project instructions.");
    writeSkill(user, "shared", "user version", "User instructions.");
    writeSkill(user, "user-only", "user only", "User-only instructions.");

    const registry = createFilesystemSkillRegistry();
    expect(discoverSkillsFromDirectories(registry, [project, user])).toBe(2);
    expect(registry.get("shared")?.description).toBe("project version");
    expect(registry.loadWithEvidence("shared")).toMatchObject({
      source: "filesystem",
      skill: { instructions: "Project instructions." },
    });
  });

  it("ignores missing directories, flat files, and invalid packages", () => {
    const root = temporaryDirectory();
    writeFileSync(join(root, "flat.md"), skill("flat", "flat", "Flat."), "utf8");
    const invalid = join(root, "invalid");
    mkdirSync(invalid);
    writeFileSync(join(invalid, "SKILL.md"), "# invalid", "utf8");

    const registry = createFilesystemSkillRegistry();
    expect(discoverSkillsFromDirectories(registry, [join(root, "missing"), root])).toBe(0);
    expect(registry.all()).toEqual([]);
  });

  it("owns exact file reads for full and index-only parsing", () => {
    const root = temporaryDirectory();
    const filePath = writeSkill(root, "reader", "reader skill", "Read this.");

    expect(readSkillMd(filePath)).toMatchObject({ name: "reader", instructions: "Read this." });
    expect(readSkillMdIndex(filePath)).toMatchObject({ name: "reader", filePath });
    expect("instructions" in readSkillMdIndex(filePath)).toBe(false);
  });
});

function temporaryDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-skills-"));
  roots.push(root);
  return root;
}

function writeSkill(root: string, name: string, description: string, body: string): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, "SKILL.md");
  writeFileSync(filePath, skill(name, description, body), "utf8");
  return filePath;
}

function skill(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}
