import { describe, expect, it, vi } from "vitest";
import { SkillRegistry } from "../../src/skill/skill-registry.js";
import type { SkillConfig, SkillIndex } from "../../src/skill/types.js";

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

const makeIndex = (name: string): SkillIndex => ({
  name,
  description: `${name} skill`,
  tools: [],
  triggers: [],
  tags: [],
  filePath: `${name}/SKILL.md`,
});

describe("SkillRegistry", () => {
  it("registers builtins and preserves first-registration precedence", () => {
    const registry = new SkillRegistry({ builtinSkills: [makeSkill("builtin")] });
    registry.register(makeSkill("shared", { description: "project" }));
    registry.register(makeSkill("shared", { description: "user" }));

    expect(registry.all().map((skill) => skill.name)).toEqual(["builtin", "shared"]);
    expect(registry.get("shared")?.description).toBe("project");
  });

  it("resolves exact names and tags without duplication", () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill("alpha", { tags: ["review"] }));
    registry.register(makeSkill("beta", { tags: ["deploy"] }));

    expect(registry.resolve(["alpha"], ["review", "deploy"]).map((skill) => skill.name)).toEqual(["alpha", "beta"]);
    expect(registry.resolve()).toEqual([]);
  });

  it("materializes through the supplied port and caches the result", () => {
    const materialize = vi.fn(() => ({ skill: makeSkill("external"), source: "filesystem" as const }));
    const registry = new SkillRegistry({ materializationPort: { materialize } });
    registry.register(makeIndex("external"));

    expect(registry.loadWithEvidence("external")?.source).toBe("filesystem");
    expect(registry.load("external")?.instructions).toContain("Instructions for external");
    expect(materialize).toHaveBeenCalledOnce();
  });

  it("returns undefined when no materializer can supply an indexed skill", () => {
    const registry = new SkillRegistry();
    registry.register(makeIndex("indexed"));

    expect(registry.load("indexed")).toBeUndefined();
    expect(registry.load("missing")).toBeUndefined();
  });

  it("removes both the index and cached materialization", () => {
    const registry = new SkillRegistry({ builtinSkills: [makeSkill("retired")] });

    expect(registry.remove("retired")).toBe(true);
    expect(registry.get("retired")).toBeUndefined();
    expect(registry.load("retired")).toBeUndefined();
    expect(registry.remove("retired")).toBe(false);
  });
});
