import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigChangeProposal } from "../../src/application/config-proposal.js";

function withProject(test: (projectPath: string) => void): void {
  const projectPath = mkdtempSync(join(tmpdir(), "kiln-config-proposal-"));
  try {
    mkdirSync(join(projectPath, ".kiln"), { recursive: true });
    test(projectPath);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

describe("config proposals", () => {
  it("creates a valid skill upsert proposal without writing files", () => withProject((projectPath) => {
    const proposal = createConfigChangeProposal({
      projectPath,
      operation: "skill.upsert",
      payload: {
        name: "repo-review",
        description: "Review repository evidence.",
        tools: ["read", "grep"],
        tags: ["repo"],
        instructions: "# Repo Review\n\nInspect evidence.",
      },
      now: new Date("2026-05-07T12:00:00.000Z"),
    });

    expect(proposal.status).toBe("valid");
    expect(proposal.createdAt).toBe("2026-05-07T12:00:00.000Z");
    expect(proposal.affectedCanonicalPaths[0]).toContain(join(".kiln", "skills", "repo-review", "SKILL.md"));
    expect(proposal.previewDiff).toContain("name: repo-review");
  }));

  it("rejects invalid skill names", () => withProject((projectPath) => {
    const proposal = createConfigChangeProposal({
      projectPath,
      operation: "skill.upsert",
      payload: {
        name: "Bad Name",
        description: "Review repository evidence.",
        instructions: "# Review",
      },
    });

    expect(proposal.status).toBe("invalid");
    expect(proposal.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "name" }),
    ]));
  }));

  it("creates an agent upsert proposal and reports write authority expansion", () => withProject((projectPath) => {
    const proposal = createConfigChangeProposal({
      projectPath,
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
    });

    expect(proposal.status).toBe("valid");
    expect(proposal.authorityImpact).toBe("expands-write");
    expect(proposal.previewDiff).toContain("displayName: Reese");
  }));

  it("fails closed for unsupported agent tools", () => withProject((projectPath) => {
    const proposal = createConfigChangeProposal({
      projectPath,
      operation: "agent.upsert",
      payload: {
        name: "worker",
        role: "Implementation worker",
        goal: "Apply scoped code changes.",
        tier: "coding",
        tools: ["read", "root-shell"],
      },
    });

    expect(proposal.status).toBe("invalid");
    expect(proposal.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "tools",
        message: "Unsupported agent profile tool: root-shell",
      }),
    ]));
  }));

  it("fails closed for duplicate agent aliases", () => withProject((projectPath) => {
    const proposal = createConfigChangeProposal({
      projectPath,
      operation: "agent.upsert",
      payload: {
        name: "architect",
        displayName: "Piama",
        nicknameCandidates: ["System Designer", "system designer", "Piama"],
        role: "Software architect",
        goal: "Review architecture.",
        tier: "reasoning",
      },
    });

    expect(proposal.status).toBe("invalid");
    expect(proposal.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "nicknameCandidates[1]", message: "Duplicate alias." }),
      expect.objectContaining({
        field: "nicknameCandidates[2]",
        message: "Alias must not duplicate the canonical name or display name.",
      }),
    ]));
  }));

  it("attaches skills only to an existing valid project agent", () => withProject((projectPath) => {
    const agentsDir = join(projectPath, ".kiln", "agents");
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

    const proposal = createConfigChangeProposal({
      projectPath,
      operation: "agent.attach_skills",
      payload: {
        agent: "architect",
        skills: ["ddd-review", "existing"],
      },
    });

    expect(proposal.status).toBe("valid");
    expect(proposal.previewDiff).toContain("  - existing");
    expect(proposal.previewDiff).toContain("  - ddd-review");
  }));

  it("fails closed when attaching skills to a missing project agent", () => withProject((projectPath) => {
    const proposal = createConfigChangeProposal({
      projectPath,
      operation: "agent.attach_skills",
      payload: {
        agent: "missing-agent",
        skills: ["ddd-review"],
      },
    });

    expect(proposal.status).toBe("invalid");
    expect(proposal.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "agent" }),
    ]));
  }));
});
