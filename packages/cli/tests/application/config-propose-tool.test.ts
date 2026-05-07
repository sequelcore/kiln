import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKilnConfigProposeChangeTool } from "../../src/application/config-propose-tool.js";

let tempDir: string;

describe("KilnConfigProposeChangeTool", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-propose-tool-"));
    vi.stubEnv("XDG_CONFIG_HOME", join(tempDir, "xdg"));
    mkdirSync(join(tempDir, ".kiln"), { recursive: true });
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "proposal-tool-project" }), "utf-8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("returns a valid proposal without writing files", async () => {
    const tool = createKilnConfigProposeChangeTool(tempDir);

    const result = await tool.execute({
      name: "kiln_config.propose_change",
      input: {
        operation: "skill.upsert",
        payload: {
          name: "repo-review",
          description: "Review repo facts.",
          instructions: "# Repo Review",
        },
      },
    });

    const proposal = JSON.parse(result.output) as { proposalId: string; status: string; operation: string; affectedCanonicalPaths: string[] };
    expect(result.isError).toBe(false);
    expect(proposal.status).toBe("valid");
    expect(proposal.operation).toBe("skill.upsert");
    expect(proposal.affectedCanonicalPaths[0]).toContain(join(".kiln", "skills", "repo-review", "SKILL.md"));
    expect(existsSync(join(tempDir, ".kiln", "proposals", "config", `${proposal.proposalId}.json`))).toBe(true);
  });

  it("returns an error result for invalid proposals", async () => {
    const tool = createKilnConfigProposeChangeTool(tempDir);

    const result = await tool.execute({
      name: "kiln_config.propose_change",
      input: {
        operation: "agent.attach_skills",
        payload: {
          agent: "missing",
          skills: ["repo-review"],
        },
      },
    });

    const proposal = JSON.parse(result.output) as { status: string };
    expect(result.isError).toBe(true);
    expect(proposal.status).toBe("invalid");
  });
});
