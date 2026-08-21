import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKilnConfigProposeChangeTool } from "../../src/application/config-propose-tool.js";
import { ConfigMutationStore } from "../../src/application/config-mutation-store.js";

let tempDir: string;
let globalHome: string;
let previousXdgConfigHome: string | undefined;

describe("KilnConfigProposeChangeTool", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-propose-tool-"));
    globalHome = mkdtempSync(join(tmpdir(), "kiln-config-propose-tool-global-"));
    mkdirSync(join(tempDir, ".kiln"), { recursive: true });
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "proposal-tool-project" }), "utf-8");
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = globalHome;
  });

  afterEach(() => {
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(globalHome, { recursive: true, force: true });
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
    expect(new ConfigMutationStore(tempDir).readProposal(proposal.proposalId)).not.toBeNull();
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
