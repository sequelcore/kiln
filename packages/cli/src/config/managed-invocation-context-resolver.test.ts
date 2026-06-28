import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createManagedInvocationContextResolver } from "./managed-invocation-context-resolver.js";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-managed-context-resolver-"));
  tempRoots.push(root);
  return root;
}

function writeAgent(root: string): void {
  const agentDir = join(root, ".kiln", "agents");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "architecture-reviewer.md"),
    [
      "---",
      "name: architecture-reviewer",
      "displayName: Lloyd",
      "nicknameCandidates:",
      "  - architecture-review",
      "role: reviewer",
      "goal: Review architecture",
      "tier: reasoning",
      "skills:",
      "  - ddd-review",
      "---",
      "",
      "Review architecture boundaries.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeWritingAgent(root: string): void {
  const agentDir = join(root, ".kiln", "agents");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "report-writer.md"),
    [
      "---",
      "name: report-writer",
      "role: writer",
      "goal: Write clear reports",
      "tier: reasoning",
      "workClassification:",
      "  intents:",
      "    - write",
      "  artifacts:",
      "    - document",
      "  domains:",
      "    - business",
      "  effects:",
      "    - write-artifact",
      "  modes:",
      "    - coauthor",
      "---",
      "",
      "Write structured reports.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeSkill(root: string): void {
  const skillDir = join(root, ".kiln", "skills", "ddd-review");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: ddd-review",
      "description: Review DDD boundaries",
      "---",
      "",
      "Check bounded contexts.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeFrontendSkill(root: string): void {
  const skillDir = join(root, ".kiln", "skills", "frontend-design");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: frontend-design",
      "description: Frontend design implementation",
      "---",
      "",
      "Build polished UI.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

describe("managed invocation context resolver", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves requested agent profile and skills into a prompt prefix", async () => {
    const root = createTempRoot();
    writeAgent(root);
    writeSkill(root);
    const resolver = createManagedInvocationContextResolver(root, root, {
      globalConfig: null,
      projectConfig: null,
    });

    const resolved = await resolver({
      agentProfile: "architecture-reviewer",
      skills: [],
      contextMode: "isolated",
      task: "Inspect architecture.",
    });

    expect(resolved).toMatchObject({
      admittedAgentProfile: "architecture-reviewer",
      admittedSkills: ["ddd-review"],
    });
    expect(resolved.promptPrefix).toContain("Review architecture boundaries.");
    expect(resolved.promptPrefix).toContain("displayName: Lloyd");
    expect(resolved.promptPrefix).toContain("nicknameCandidates: architecture-review");
    expect(resolved.promptPrefix).toContain("Check bounded contexts.");
  });

  it("fails closed for fork mode until policy support exists", async () => {
    const root = createTempRoot();
    const resolver = createManagedInvocationContextResolver(root, root, {
      globalConfig: null,
      projectConfig: null,
    });

    await expect(resolver({
      skills: [],
      contextMode: "fork",
      task: "Inspect architecture.",
    })).rejects.toThrow("Managed invocation fork context is not enabled for this surface.");
  });

  it("auto-admits selected route recommended skills when skill selection policy allows it", async () => {
    const root = createTempRoot();
    writeFrontendSkill(root);
    const resolver = createManagedInvocationContextResolver(root, root, {
      globalConfig: null,
      projectConfig: null,
      skillConfig: {
        selection: {
          mode: "auto",
        },
      },
    });

    const resolved = await resolver({
      skills: [],
      contextMode: "isolated",
      task: "Build a responsive React UI.",
      providerRoute: {
        providerId: "custom-provider",
        model: "custom-model",
      },
      taskSuitability: [{
        task: "frontend-design",
        level: "preferred",
        source: "live-proof",
        reason: "Selected route declares frontend suitability.",
        recommendedSkills: ["frontend-design"],
      }],
    });

    expect(resolved).toMatchObject({
      admittedSkills: ["frontend-design"],
    });
    expect(resolved.promptPrefix).toContain("Build polished UI.");
  });

  it("reports advisory work-classification skill recommendations without admitting them", async () => {
    const root = createTempRoot();
    const resolver = createManagedInvocationContextResolver(root, root, {
      globalConfig: null,
      projectConfig: null,
      skillConfig: {
        selection: {
          mode: "advisory",
        },
        builtin: {
          enabled: false,
        },
      },
    });

    const resolved = await resolver({
      skills: [],
      contextMode: "isolated",
      task: "Write a support report.",
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["support"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
    });

    expect(resolved).toMatchObject({
      workRecommendedSkills: ["clear-writing"],
      workRecommendedSkillDiagnostics: [{
        skillName: "clear-writing",
        state: "advisory",
      }],
    });
    expect(resolved.admittedSkills).toBeUndefined();
    expect(resolved.promptPrefix).toBeUndefined();
  });

  it("uses agent profile work classification when the invocation omits one", async () => {
    const root = createTempRoot();
    writeWritingAgent(root);
    const resolver = createManagedInvocationContextResolver(root, root, {
      globalConfig: null,
      projectConfig: null,
      skillConfig: {
        selection: {
          mode: "advisory",
        },
        builtin: {
          enabled: false,
        },
      },
    });

    const resolved = await resolver({
      agentProfile: "report-writer",
      skills: [],
      contextMode: "isolated",
      task: "Draft the business update.",
    });

    expect(resolved).toMatchObject({
      admittedAgentProfile: "report-writer",
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["business"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      workRecommendedSkills: ["clear-writing"],
    });
  });
});
