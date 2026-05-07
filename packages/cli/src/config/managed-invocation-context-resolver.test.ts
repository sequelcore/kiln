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
    const resolver = createManagedInvocationContextResolver(root, root);

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
    const resolver = createManagedInvocationContextResolver(root, root);

    await expect(resolver({
      skills: [],
      contextMode: "fork",
      task: "Inspect architecture.",
    })).rejects.toThrow("Managed invocation fork context is not enabled for this surface.");
  });
});
