import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillRegistry } from "../../src/skill/skill-registry.js";
import type { SkillConfig } from "../../src/skill/types.js";
import type { DomainPackageManifest } from "../../src/package/types.js";

const makeSkill = (name: string, overrides: Partial<SkillConfig> = {}): SkillConfig => ({
  name,
  description: `${name} skill`,
  tools: [],
  triggers: [],
  tags: [],
  instructions: `Instructions for ${name}.`,
  filePath: "",
  ...overrides,
});

const validSkillMd = (name: string) => `---
name: ${name}
description: ${name} skill
---

Instructions for ${name}.
`;

describe("SkillRegistry", () => {
  let registry: SkillRegistry;
  let tmpDir: string;

  beforeEach(() => {
    registry = new SkillRegistry();
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-registry-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("starts empty when no options provided", () => {
      expect(registry.all()).toHaveLength(0);
    });

    it("registers builtinSkills passed via constructor", () => {
      const builtins = [makeSkill("alpha"), makeSkill("beta")];
      const reg = new SkillRegistry({ builtinSkills: builtins });
      expect(reg.all()).toHaveLength(2);
      expect(reg.get("alpha")).toBeDefined();
      expect(reg.get("beta")).toBeDefined();
    });
  });

  describe("register + get + all", () => {
    it("registers and retrieves a skill by name", () => {
      const skill = makeSkill("review");
      registry.register(skill);
      expect(registry.get("review")?.name).toBe("review");
    });

    it("all() returns all registered skills", () => {
      registry.register(makeSkill("a"));
      registry.register(makeSkill("b"));
      registry.register(makeSkill("c"));
      expect(registry.all()).toHaveLength(3);
    });

    it("get() returns undefined for unknown name", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("first-registered wins -- does not overwrite", () => {
      const original = makeSkill("x", { description: "original" });
      const updated = makeSkill("x", { description: "updated" });
      registry.register(original);
      registry.register(updated);
      expect(registry.get("x")!.description).toBe("original");
    });

    it("removes both discovery and cached materialization", () => {
      registry.registerFull(makeSkill("retired"));

      expect(registry.remove("retired")).toBe(true);
      expect(registry.get("retired")).toBeUndefined();
      expect(registry.load("retired")).toBeUndefined();
      expect(registry.remove("retired")).toBe(false);
    });
  });

  describe("registerFull + load", () => {
    it("registerFull stores index and caches full config", () => {
      const config = makeSkill("cached");
      registry.registerFull(config);
      expect(registry.get("cached")).toBeDefined();
      const loaded = registry.load("cached");
      expect(loaded).toBeDefined();
      expect(loaded!.instructions).toBe("Instructions for cached.");
    });

    it("load returns undefined for unknown name", () => {
      expect(registry.load("nonexistent")).toBeUndefined();
    });

    it("load reads from disk when not cached", () => {
      const filePath = join(tmpDir, "SKILL.md");
      writeFileSync(filePath, validSkillMd("disk-skill"), "utf-8");

      // Register index manually with filePath
      registry.register({
        name: "disk-skill",
        description: "disk-skill skill",
        tools: [],
        triggers: [],
        tags: [],
        filePath,
      });

      const loaded = registry.load("disk-skill");
      expect(loaded).toBeDefined();
      expect(loaded!.instructions).toContain("Instructions for disk-skill.");
    });

    it("load caches result after first read", () => {
      const filePath = join(tmpDir, "SKILL.md");
      writeFileSync(filePath, validSkillMd("cached-read"), "utf-8");

      registry.register({
        name: "cached-read",
        description: "cached-read skill",
        tools: [],
        triggers: [],
        tags: [],
        filePath,
      });

      const first = registry.load("cached-read");
      // Delete file -- second load should return cached
      rmSync(filePath);
      const second = registry.load("cached-read");
      expect(second).toEqual(first);
    });

    it("load returns undefined when file is missing", () => {
      registry.register({
        name: "missing-file",
        description: "missing",
        tools: [],
        triggers: [],
        tags: [],
        filePath: join(tmpDir, "nonexistent.md"),
      });

      expect(registry.load("missing-file")).toBeUndefined();
    });
  });

  describe("resolve", () => {
    beforeEach(() => {
      registry.register(makeSkill("alpha", { tags: ["review", "quality"] }));
      registry.register(makeSkill("beta", { tags: ["deploy"] }));
      registry.register(makeSkill("gamma", { tags: ["review"] }));
    });

    it("resolves by name", () => {
      const results = registry.resolve(["alpha", "beta"]);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.name).sort()).toEqual(["alpha", "beta"]);
    });

    it("resolves by tag", () => {
      const results = registry.resolve(undefined, ["review"]);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.name).sort()).toEqual(["alpha", "gamma"]);
    });

    it("resolves by name and tag combined", () => {
      const results = registry.resolve(["beta"], ["quality"]);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.name).sort()).toEqual(["alpha", "beta"]);
    });

    it("returns empty for no matches", () => {
      expect(registry.resolve(["nonexistent"])).toEqual([]);
    });

    it("returns empty when both args are empty", () => {
      expect(registry.resolve([], [])).toEqual([]);
    });

    it("returns empty when both args are undefined", () => {
      expect(registry.resolve()).toEqual([]);
    });
  });

  describe("discoverFrom", () => {
    it("returns 0 for non-existent directory", () => {
      const loaded = registry.discoverFrom(join(tmpDir, "no-such-dir"));
      expect(loaded).toBe(0);
      expect(registry.all()).toHaveLength(0);
    });

    it("loads SKILL.md files from subdirectories", () => {
      const alphaDir = join(tmpDir, "alpha");
      const betaDir = join(tmpDir, "beta");
      mkdirSync(alphaDir, { recursive: true });
      mkdirSync(betaDir, { recursive: true });

      writeFileSync(join(alphaDir, "SKILL.md"), validSkillMd("alpha"), "utf-8");
      writeFileSync(join(betaDir, "SKILL.md"), validSkillMd("beta"), "utf-8");

      const loaded = registry.discoverFrom(tmpDir);
      expect(loaded).toBe(2);
      expect(registry.get("alpha")).toBeDefined();
      expect(registry.get("beta")).toBeDefined();
    });

    it("ignores legacy flat .md files because skills are complete directory packages", () => {
      writeFileSync(join(tmpDir, "flat-skill.md"), validSkillMd("flat"), "utf-8");

      const loaded = registry.discoverFrom(tmpDir);
      expect(loaded).toBe(0);
      expect(registry.get("flat")).toBeUndefined();
    });

    it("skips invalid SKILL.md files silently", () => {
      const badDir = join(tmpDir, "bad");
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(badDir, "SKILL.md"), "# No frontmatter", "utf-8");

      const goodDir = join(tmpDir, "good");
      mkdirSync(goodDir, { recursive: true });
      writeFileSync(join(goodDir, "SKILL.md"), validSkillMd("good"), "utf-8");

      const loaded = registry.discoverFrom(tmpDir);
      expect(loaded).toBe(1);
      expect(registry.get("good")).toBeDefined();
    });

    it("ignores non-.md files", () => {
      writeFileSync(join(tmpDir, "readme.txt"), "text", "utf-8");
      writeFileSync(join(tmpDir, "config.json"), '{"name":"x"}', "utf-8");
      writeFileSync(join(tmpDir, "old.yaml"), "name: old", "utf-8");

      const loaded = registry.discoverFrom(tmpDir);
      expect(loaded).toBe(0);
    });

    it("does not overwrite already-registered skill", () => {
      const existing = makeSkill("alpha", { description: "existing" });
      registry.register(existing);

      const alphaDir = join(tmpDir, "alpha");
      mkdirSync(alphaDir, { recursive: true });
      writeFileSync(join(alphaDir, "SKILL.md"), validSkillMd("alpha"), "utf-8");

      const loaded = registry.discoverFrom(tmpDir);
      expect(loaded).toBe(0);
      expect(registry.get("alpha")!.description).toBe("existing");
    });
  });

  describe("discoverAll", () => {
    let projectDir: string;
    let userDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "kiln-project-"));
      userDir = mkdtempSync(join(tmpdir(), "kiln-user-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(userDir, { recursive: true, force: true });
    });

    it("discovers from explicit private project and user skills directories", () => {
      const wsSkillDir = join(projectDir, "ws-skill");
      const userSkillDir = join(userDir, "user-skill");
      mkdirSync(wsSkillDir, { recursive: true });
      mkdirSync(userSkillDir, { recursive: true });

      writeFileSync(join(wsSkillDir, "SKILL.md"), validSkillMd("ws-skill"), "utf-8");
      writeFileSync(join(userSkillDir, "SKILL.md"), validSkillMd("user-skill"), "utf-8");

      const total = registry.discoverAll(projectDir, userDir);
      expect(total).toBe(2);
      expect(registry.get("ws-skill")).toBeDefined();
      expect(registry.get("user-skill")).toBeDefined();
    });

    it("project skill overrides user skill with same name", () => {
      const wsSkillDir = join(projectDir, "shared");
      const userSkillDir = join(userDir, "shared");
      mkdirSync(wsSkillDir, { recursive: true });
      mkdirSync(userSkillDir, { recursive: true });

      const wsMd = `---
name: shared
description: workspace version
---

Workspace instructions.
`;
      const userMd = `---
name: shared
description: user version
---

User instructions.
`;
      writeFileSync(join(wsSkillDir, "SKILL.md"), wsMd, "utf-8");
      writeFileSync(join(userSkillDir, "SKILL.md"), userMd, "utf-8");

      registry.discoverAll(projectDir, userDir);
      expect(registry.get("shared")!.description).toBe("workspace version");
    });

    it("returns 0 when no skill directories exist", () => {
      const total = registry.discoverAll(projectDir, userDir);
      expect(total).toBe(0);
    });
  });

  describe("discoverFromPackage", () => {
    it("loads skills from package manifest", () => {
      const pkgDir = mkdtempSync(join(tmpdir(), "kiln-pkg-skill-"));
      const skillsDir = join(pkgDir, "skills");
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(join(skillsDir, "refactor.md"), validSkillMd("pkg-skill"), "utf-8");

      const manifest: DomainPackageManifest = {
        name: "test-domain",
        type: "domain",
        version: "1.0.0",
        author: "Test",
        contentHash: "abc",
        installPath: pkgDir,
        config: { name: "test", displayName: "Test", detectPatterns: [], toolTags: new Set<string>(), qualityGates: [], multishotExamples: "", phaseExamples: "" },
        skills: ["skills/refactor.md"],
        tools: null,
      };

      const loaded = registry.discoverFromPackage(manifest);
      expect(loaded).toBe(1);
      expect(registry.get("pkg-skill")).toBeDefined();

      rmSync(pkgDir, { recursive: true, force: true });
    });

    it("returns 0 for package with no skills", () => {
      const manifest: DomainPackageManifest = {
        name: "empty",
        type: "domain",
        version: "1.0.0",
        author: "Test",
        contentHash: "abc",
        installPath: "/nonexistent",
        config: { name: "test", displayName: "Test", detectPatterns: [], toolTags: new Set<string>(), qualityGates: [], multishotExamples: "", phaseExamples: "" },
        skills: [],
        tools: null,
      };

      expect(registry.discoverFromPackage(manifest)).toBe(0);
    });

    it("skips invalid skill files silently", () => {
      const pkgDir = mkdtempSync(join(tmpdir(), "kiln-pkg-invalid-"));
      const skillsDir = join(pkgDir, "skills");
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(join(skillsDir, "broken.md"), "# No frontmatter", "utf-8");

      const manifest: DomainPackageManifest = {
        name: "broken-pkg",
        type: "domain",
        version: "1.0.0",
        author: "Test",
        contentHash: "abc",
        installPath: pkgDir,
        config: { name: "test", displayName: "Test", detectPatterns: [], toolTags: new Set<string>(), qualityGates: [], multishotExamples: "", phaseExamples: "" },
        skills: ["skills/broken.md"],
        tools: null,
      };

      const loaded = registry.discoverFromPackage(manifest);
      expect(loaded).toBe(0);

      rmSync(pkgDir, { recursive: true, force: true });
    });
  });
});
