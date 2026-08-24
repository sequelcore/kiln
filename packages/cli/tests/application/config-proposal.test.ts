import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proposeConfigMutation } from "../../src/application/config-mutation-authority.js";
import { bootstrapProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { resolveProjectStateBinding, type ProjectStateBinding } from "../../src/application/project-state-root.js";

function withProject(test: (projectPath: string, projectStateBinding: ProjectStateBinding) => void): void {
  const projectPath = mkdtempSync(join(tmpdir(), "kiln-config-proposal-"));
  try {
    const projectStateBinding = resolveProjectStateBinding(projectPath, { kilnHome: join(projectPath, "kiln-home") });
    bootstrapProjectAdoption(projectStateBinding);
    test(projectPath, projectStateBinding);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

describe("config proposals", () => {
  it("creates a valid skill upsert proposal without writing files", () => withProject((projectPath, projectStateBinding) => {
    const proposal = proposeConfigMutation({
      projectPath,
      projectStateBinding,
      operation: "skill.upsert",
      payload: {
        name: "repo-review",
        description: "Review repository evidence.",
        tools: ["read", "grep"],
        tags: ["repo"],
        instructions: "# Repo Review\n\nInspect evidence.",
      },
      now: new Date("2026-05-07T12:00:00.000Z"),
    }).proposal;

    expect(proposal.status).toBe("valid");
    expect(proposal.createdAt).toBe("2026-05-07T12:00:00.000Z");
    expect(proposal.affectedCanonicalPaths[0]).toBe(join(projectStateBinding.skillsPath, "repo-review", "SKILL.md"));
    expect(proposal.previewDiff).toContain("name: repo-review");
  }));

  it("rejects invalid skill names", () => withProject((projectPath, projectStateBinding) => {
    const proposal = proposeConfigMutation({
      projectPath,
      projectStateBinding,
      operation: "skill.upsert",
      payload: {
        name: "Bad Name",
        description: "Review repository evidence.",
        instructions: "# Review",
      },
    }).proposal;

    expect(proposal.status).toBe("invalid");
    expect(proposal.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "name" }),
    ]));
  }));

  it("creates an agent upsert proposal and reports write authority expansion", () => withProject((projectPath, projectStateBinding) => {
    const proposal = proposeConfigMutation({
      projectPath,
      projectStateBinding,
      operation: "agent.upsert",
      payload: {
        name: "worker",
        displayName: "Reese",
        role: "Implementation worker",
        goal: "Apply scoped code changes.",
        tier: "coding",
        tools: ["read", "write", "bash"],
        skills: ["repo-review"],
        instructions: "Stay scoped.",
      },
    }).proposal;

    expect(proposal.status).toBe("valid");
    expect(proposal.authorityImpact).toBe("expands-write");
    expect(proposal.previewDiff).toContain("displayName: Reese");
  }));

  it("fails closed for unsupported agent tools", () => withProject((projectPath, projectStateBinding) => {
    const proposal = proposeConfigMutation({
      projectPath,
      projectStateBinding,
      operation: "agent.upsert",
      payload: {
        name: "worker",
        role: "Implementation worker",
        goal: "Apply scoped code changes.",
        tier: "coding",
        tools: ["read", "root-shell"],
      },
    }).proposal;

    expect(proposal.status).toBe("invalid");
    expect(proposal.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "tools",
        message: "Unsupported agent profile tool: root-shell",
      }),
    ]));
  }));

  it("fails closed for duplicate agent aliases", () => withProject((projectPath, projectStateBinding) => {
    const proposal = proposeConfigMutation({
      projectPath,
      projectStateBinding,
      operation: "agent.upsert",
      payload: {
        name: "architect",
        displayName: "Piama",
        nicknameCandidates: ["System Designer", "system designer", "Piama"],
        role: "Software architect",
        goal: "Review architecture.",
        tier: "reasoning",
      },
    }).proposal;

    expect(proposal.status).toBe("invalid");
    expect(proposal.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "nicknameCandidates[1]", message: "Duplicate alias." }),
      expect.objectContaining({
        field: "nicknameCandidates[2]",
        message: "Alias must not duplicate the canonical name or display name.",
      }),
    ]));
  }));

  it("fails closed for legacy top-level agent model", () => withProject((projectPath, projectStateBinding) => {
    const proposal = proposeConfigMutation({
      projectPath,
      projectStateBinding,
      operation: "agent.upsert",
      payload: {
        name: "worker",
        role: "Implementation worker",
        goal: "Apply scoped code changes.",
        tier: "coding",
        model: "codex-oauth/gpt-5.5",
      },
    }).proposal;

    expect(proposal.status).toBe("invalid");
    expect(proposal.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "model",
        message: "Agent model is not a canonical top-level field. Select a global targetId instead.",
      }),
    ]));
  }));

  it("attaches skills only to an existing valid project agent", () => withProject((projectPath, projectStateBinding) => {
    const agentsDir = projectStateBinding.agentsPath;
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "architect.md"), [
      "---",
      "name: architect",
      "displayName: Piama",
      "role: Software architect",
      "goal: Review architecture.",
      "tier: reasoning",
      "skills:",
      "  - existing",
      "---",
      "",
      "Use architectural judgment.",
      "",
    ].join("\n"), "utf-8");

    const proposal = proposeConfigMutation({
      projectPath,
      projectStateBinding,
      operation: "agent.attach_skills",
      payload: {
        agent: "architect",
        skills: ["ddd-review", "existing"],
      },
    }).proposal;

    expect(proposal.status).toBe("valid");
    expect(proposal.previewDiff).toContain("  - existing");
    expect(proposal.previewDiff).toContain("  - ddd-review");
  }));

  it("fails closed when attaching skills to a missing project agent", () => withProject((projectPath, projectStateBinding) => {
    const proposal = proposeConfigMutation({
      projectPath,
      projectStateBinding,
      operation: "agent.attach_skills",
      payload: {
        agent: "missing-agent",
        skills: ["ddd-review"],
      },
    }).proposal;

    expect(proposal.status).toBe("invalid");
    expect(proposal.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "agent" }),
    ]));
  }));
});
