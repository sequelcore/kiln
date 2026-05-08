import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveConfigChangeProposal } from "../../src/application/config-approval.js";
import { applyConfigChange } from "../../src/application/config-apply.js";
import { ConfigMutationStore } from "../../src/application/config-mutation-store.js";
import { createConfigChangeProposalRecord } from "../../src/application/config-proposal.js";

vi.mock("../../src/config/native-agent-projection.js", () => ({
  syncNativeAgentProjections: vi.fn(async () => ({ claude: true, codex: true, opencode: true, synced: 1, errors: [] })),
}));

vi.mock("../../src/config/native-skill-projection.js", () => ({
  syncNativeSkillProjections: vi.fn(async () => ({ claude: true, codex: true, opencode: true, synced: 1, errors: [] })),
}));

vi.mock("../../src/application/repo-shim-projection.js", () => ({
  writeRepoShimProjections: vi.fn(async () => ({ written: false, targets: [], errors: [] })),
}));

let tempDir: string;

describe("config apply", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-apply-"));
    mkdirSync(join(tempDir, ".kiln"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("requires an explicit matching approval before writing canonical config", async () => {
    const record = createConfigChangeProposalRecord({
      projectPath: tempDir,
      operation: "skill.upsert",
      payload: {
        name: "repo-review",
        description: "Review repo facts.",
        instructions: "# Repo Review",
      },
      now: new Date("2026-05-07T12:00:00.000Z"),
    });
    const store = new ConfigMutationStore(tempDir);
    store.saveProposal(record);

    const missingApproval = await applyConfigChange({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      approvalId: "cfgap_missing",
      now: new Date("2026-05-07T12:01:00.000Z"),
    });
    expect(missingApproval.status).toBe("failed");
    expect(existsSync(join(tempDir, ".kiln", "skills", "repo-review", "SKILL.md"))).toBe(false);

    const approval = approveConfigChangeProposal({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      approvedBy: "tester",
      now: new Date("2026-05-07T12:02:00.000Z"),
    });
    const result = await applyConfigChange({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      approvalId: approval.approvalId,
      now: new Date("2026-05-07T12:03:00.000Z"),
    });

    expect(result.status).toBe("applied");
    expect(readFileSync(join(tempDir, ".kiln", "skills", "repo-review", "SKILL.md"), "utf-8")).toContain("name: repo-review");
    expect(result.projectionEffects.map((effect) => effect.target)).toEqual(["native-skills", "repo-shims"]);
  });

  it("fails closed when the proposal base file changed after proposal creation", async () => {
    const agentsDir = join(tempDir, ".kiln", "agents");
    mkdirSync(agentsDir, { recursive: true });
    const agentPath = join(agentsDir, "architect.md");
    writeFileSync(agentPath, [
      "---",
      "name: architect",
      "role: Software architect",
      "goal: Review architecture.",
      "tier: reasoning",
      "---",
      "",
    ].join("\n"), "utf-8");

    const record = createConfigChangeProposalRecord({
      projectPath: tempDir,
      operation: "agent.attach_skills",
      payload: { agent: "architect", skills: ["ddd-review"] },
    });
    const store = new ConfigMutationStore(tempDir);
    store.saveProposal(record);
    const approval = approveConfigChangeProposal({ projectPath: tempDir, proposalId: record.proposal.proposalId });
    writeFileSync(agentPath, `${readFileSync(agentPath, "utf-8")}\nChanged underneath proposal.\n`, "utf-8");

    const result = await applyConfigChange({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      approvalId: approval.approvalId,
    });

    expect(result.status).toBe("failed");
    expect(result.diagnostics[0]?.message).toContain("stale");
    expect(readFileSync(agentPath, "utf-8")).toContain("Changed underneath proposal.");
  });

  it("fails closed when a stored proposal targets non-canonical config paths", async () => {
    const record = createConfigChangeProposalRecord({
      projectPath: tempDir,
      operation: "skill.upsert",
      payload: {
        name: "repo-review",
        description: "Review repo facts.",
        instructions: "# Repo Review",
      },
    });
    const write = record.writes[0];
    expect(write).toBeDefined();
    const tamperedRecord = {
      ...record,
      writes: [{
        ...write!,
        path: join(tempDir, ".kiln", "config.yaml"),
      }],
    };
    const store = new ConfigMutationStore(tempDir);
    store.saveProposal(tamperedRecord);
    const approval = approveConfigChangeProposal({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
    });

    const result = await applyConfigChange({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      approvalId: approval.approvalId,
    });

    expect(result.status).toBe("failed");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: join(tempDir, ".kiln", "config.yaml"),
        message: "Config apply can only write project .kiln/agents or .kiln/skills canonical files.",
      }),
    ]));
    expect(existsSync(join(tempDir, ".kiln", "config.yaml"))).toBe(false);
  });
});
