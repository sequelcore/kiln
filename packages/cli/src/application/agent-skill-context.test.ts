import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { KilnAppConfig } from "../config.js";
import {
  resolveAgentSkillContextCandidates,
  withContextCandidates,
} from "./agent-skill-context.js";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-agent-skill-context-"));
  tempRoots.push(root);
  return root;
}

function writeSkill(root: string, name: string): void {
  const skillDir = join(root, ".kiln", "skills", name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${name} skill`,
      "tags:",
      "  - test",
      "---",
      "",
      `Use ${name} carefully.`,
      "",
    ].join("\n"),
    "utf-8",
  );
}

describe("agent skill context", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns no candidates for agents without skills", () => {
    const root = createTempRoot();

    expect(resolveAgentSkillContextCandidates(undefined, root, root)).toEqual([]);
    expect(resolveAgentSkillContextCandidates({
      name: "planner",
      role: "planner",
      goal: "Plan work",
      tier: "reasoning",
      scope: "project",
    }, root, root)).toEqual([]);
  });

  it("resolves declared agent skills as required procedural context", () => {
    const root = createTempRoot();
    writeSkill(root, "clean-architecture");

    const candidates = resolveAgentSkillContextCandidates({
      name: "architecture-reviewer",
      role: "reviewer",
      goal: "Review architecture",
      tier: "reasoning",
      skills: ["clean-architecture"],
      scope: "project",
    }, root, root);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "procedural",
      required: true,
      score: 0.95,
    });
    expect(candidates[0]?.content).toContain("name: clean-architecture");
    expect(candidates[0]?.content).toContain("Use clean-architecture carefully.");
  });

  it("fails closed when an agent references an unavailable skill", () => {
    const root = createTempRoot();

    expect(() => resolveAgentSkillContextCandidates({
      name: "architecture-reviewer",
      role: "reviewer",
      goal: "Review architecture",
      tier: "reasoning",
      skills: ["missing-skill"],
      scope: "project",
    }, root, root)).toThrow(
      'Agent "architecture-reviewer" references unavailable skill(s): missing-skill',
    );
  });

  it("appends context candidates without mutating the original app config", () => {
    const appConfig: KilnAppConfig = {
      createRegistry: () => ({}) as never,
      contextCandidates: [{
        kind: "knowledge",
        source: "existing",
        content: "Existing context",
      }],
    };
    const candidate = {
      kind: "procedural" as const,
      source: "skill",
      content: "Skill context",
    };

    const wrapped = withContextCandidates(appConfig, [candidate]);

    expect(wrapped).not.toBe(appConfig);
    expect(wrapped.contextCandidates).toEqual([
      appConfig.contextCandidates?.[0],
      candidate,
    ]);
    expect(appConfig.contextCandidates).toHaveLength(1);
  });
});
