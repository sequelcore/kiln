import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { KilnAppConfig } from "../config.js";
import { resolveProjectStateBinding } from "./project-state-root.js";
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
  const skillDir = join(
    resolveProjectStateBinding(root, { kilnHome: join(root, ".kiln") }).skillsPath,
    name,
  );
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

  it("auto-admits available recommended skills for the selected task and route when policy allows it", () => {
    const root = createTempRoot();
    writeSkill(root, "frontend-design");

    const candidates = resolveAgentSkillContextCandidates({
      name: "frontend-worker",
      role: "frontend",
      goal: "Build UI",
      tier: "coding",
      taskAffinity: ["frontend-design"],
      scope: "project",
    }, root, root, {
      selection: {
        mode: "auto",
      },
    }, {
      task: "frontend-design",
      provider: "opencode-zen",
      model: "kimi-k2.6",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "procedural",
      required: true,
      score: 0.95,
    });
    expect(candidates[0]?.content).toContain("name: frontend-design");
  });

  it("auto-admits recommended skills without an explicit agent when policy allows it", () => {
    const root = createTempRoot();
    writeSkill(root, "frontend-design");

    const candidates = resolveAgentSkillContextCandidates(undefined, root, root, {
      selection: {
        mode: "auto",
      },
    }, {
      task: "frontend-design",
      provider: "opencode-zen",
      model: "kimi-k2.6",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.content).toContain("name: frontend-design");
  });

  it("keeps recommended skills advisory by default", () => {
    const root = createTempRoot();
    writeSkill(root, "frontend-design");

    expect(resolveAgentSkillContextCandidates({
      name: "frontend-worker",
      role: "frontend",
      goal: "Build UI",
      tier: "coding",
      taskAffinity: ["frontend-design"],
      scope: "project",
    }, root, root, undefined, {
      task: "frontend-design",
      provider: "opencode-zen",
      model: "kimi-k2.6",
    })).toEqual([]);
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
