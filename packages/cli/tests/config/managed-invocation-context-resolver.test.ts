import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import { createManagedInvocationContextResolver } from "../../src/config/managed-invocation-context-resolver.js";

function writeSkill(skillsDirectory: string, name: string, description = `${name} skill.`): void {
  const dir = join(skillsDirectory, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    `# ${name}`,
    "",
    "Use this skill.",
    "",
  ].join("\n"), "utf-8");
}

describe("managed invocation context resolver skill admission", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "kiln-managed-context-"));
    roots.push(root);
    return root;
  }

  function projectSkillsDirectory(root: string): string {
    return resolveProjectStateBinding(root, {
      kilnHome: join(root, "synthetic-kiln-home"),
    }).skillsPath;
  }

  it("fails closed for explicitly requested missing skills", async () => {
    const root = tempRoot();
    const resolver = createManagedInvocationContextResolver(root, root, {
      globalConfig: null,
      projectConfig: null,
      skillConfig: { builtin: { enabled: false } },
    });

    await expect(resolver({
      skills: ["shadcn"],
      contextMode: "isolated",
      task: "Review UI components.",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.5",
      },
    })).rejects.toThrow("Managed invocation references unavailable skill(s): shadcn");
  });

  it("keeps recommended skills advisory unless auto selection is enabled", async () => {
    const root = tempRoot();
    const skillsDirectory = projectSkillsDirectory(root);
    writeSkill(skillsDirectory, "frontend-design");
    const resolver = createManagedInvocationContextResolver(root, root, {
      globalConfig: null,
      projectConfig: null,
      projectSkillsDirectory: skillsDirectory,
      skillConfig: {
        selection: { mode: "advisory" },
        builtin: { enabled: false },
      },
    });

    const resolution = await resolver({
      skills: [],
      contextMode: "isolated",
      task: "Build a frontend component.",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.5",
      },
      taskSuitability: [{
        task: "frontend-design",
        level: "preferred",
        source: "operator-override",
        reason: "Prefer this route for frontend work.",
        recommendedSkills: ["frontend-design"],
      }],
    });

    expect(resolution.admittedSkills).toBeUndefined();
    expect(resolution.promptPrefix).toBeUndefined();
  });

  it("records auto-selected recommended skills as admitted context", async () => {
    const root = tempRoot();
    const skillsDirectory = projectSkillsDirectory(root);
    writeSkill(skillsDirectory, "frontend-design");
    const resolver = createManagedInvocationContextResolver(root, root, {
      globalConfig: null,
      projectConfig: null,
      projectSkillsDirectory: skillsDirectory,
      skillConfig: {
        selection: { mode: "auto" },
        builtin: { enabled: false },
      },
    });

    const resolution = await resolver({
      skills: [],
      contextMode: "isolated",
      task: "Build a frontend component.",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.5",
      },
      taskSuitability: [{
        task: "frontend-design",
        level: "preferred",
        source: "operator-override",
        reason: "Prefer this route for frontend work.",
        recommendedSkills: ["frontend-design", "missing-browser-skill"],
      }],
    });

    expect(resolution.admittedSkills).toEqual(["frontend-design"]);
    expect(resolution.promptPrefix).toContain("# frontend-design");
  });
});
