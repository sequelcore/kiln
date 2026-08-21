import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import {
  applyConfigMutation,
  approveConfigMutation,
  proposeConfigMutation,
} from "../../src/application/config-mutation-authority.js";
import { ConfigMutationStore } from "../../src/application/config-mutation-store.js";
import { defaultGlobalConfig } from "../../src/config/global-config.js";

let tempDir: string;
let globalHome: string;
let previousXdgConfigHome: string | undefined;

/** Reconciliation is exercised separately; these specs assert lifecycle behavior. */
const reconcileOk = vi.fn(async () => []);

function globalConfigPath(): string {
  return join(globalHome, "kiln", "config.yaml");
}

function seedGlobalConfig(): void {
  mkdirSync(join(globalHome, "kiln"), { recursive: true });
  writeFileSync(globalConfigPath(), stringify(defaultGlobalConfig()), "utf-8");
}

function propose(operation: Parameters<typeof proposeConfigMutation>[0]["operation"], payload: unknown) {
  const record = proposeConfigMutation({ projectPath: tempDir, operation, payload });
  new ConfigMutationStore(tempDir).saveProposal(record);
  return record;
}

const agentPayload = (tools: readonly string[]) => ({
  name: "reviewer",
  role: "Reviewer",
  goal: "Review changes",
  tier: "reasoning",
  tools,
});

describe("config mutation authority", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kiln-config-authority-"));
    globalHome = mkdtempSync(join(tmpdir(), "kiln-config-home-"));
    mkdirSync(join(tempDir, ".kiln"), { recursive: true });
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = globalHome;
    reconcileOk.mockClear();
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

  it("commits a non-authority-expanding change without an approval", async () => {
    const record = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Read the diff and report findings.",
    });

    expect(record.proposal.authorityImpact).toBe("none");
    expect(record.proposal.approvalRequired).toBe(false);
    expect(record.proposal.activation).toBe("reconcile");

    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    expect(existsSync(join(tempDir, ".kiln", "skills", "repo-review", "SKILL.md"))).toBe(true);
  });

  it("refuses to commit an authority-expanding change without a matching approval", async () => {
    const record = propose("agent.upsert", agentPayload(["read", "bash"]));
    expect(record.proposal.authorityImpact).toBe("expands-write");
    expect(record.proposal.approvalRequired).toBe(true);

    const rejectedResult = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(rejectedResult.settlement.outcome).toBe("rejected");
    expect(existsSync(join(tempDir, ".kiln", "agents", "reviewer.md"))).toBe(false);

    const approval = approveConfigMutation({ projectPath: tempDir, proposalId: record.proposal.proposalId });
    const committed = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      approvalId: approval.approvalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(committed.settlement.outcome).toBe("committed");
    expect(readFileSync(join(tempDir, ".kiln", "agents", "reviewer.md"), "utf-8")).toContain("bash");
  });

  it("treats authority as a delta, so restating existing tools needs no approval", async () => {
    const first = propose("agent.upsert", agentPayload(["read", "bash"]));
    const approval = approveConfigMutation({ projectPath: tempDir, proposalId: first.proposal.proposalId });
    await applyConfigMutation({
      projectPath: tempDir,
      proposalId: first.proposal.proposalId,
      approvalId: approval.approvalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    const restated = proposeConfigMutation({
      projectPath: tempDir,
      operation: "agent.upsert",
      payload: { ...agentPayload(["read", "bash"]), goal: "Review changes carefully" },
    });

    expect(restated.proposal.authorityImpact).toBe("none");
    expect(restated.proposal.approvalRequired).toBe(false);
  });

  it("rejects a proposal whose base revision changed, leaving the file untouched", async () => {
    const record = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Original instructions.",
    });

    const path = join(tempDir, ".kiln", "skills", "repo-review", "SKILL.md");
    mkdirSync(join(tempDir, ".kiln", "skills", "repo-review"), { recursive: true });
    writeFileSync(path, "---\nname: repo-review\n---\n\nEdited outside the authority.\n", "utf-8");

    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("rejected");
    expect(result.settlement.diagnostics[0]?.message).toContain("stale");
    expect(readFileSync(path, "utf-8")).toContain("Edited outside the authority.");
  });

  it("replays the durable settlement instead of committing a retried apply twice", async () => {
    const record = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Read the diff.",
    });
    const applyOnce = () => applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    const first = await applyOnce();
    const retry = await applyOnce();

    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.settlement.settledAt).toBe(first.settlement.settledAt);
    expect(retry.settlement.committedRevision).toBe(first.settlement.committedRevision);
    // The retry must not re-run reconciliation, because the change already committed.
    expect(reconcileOk).toHaveBeenCalledTimes(1);
  });

  it("reports a committed write whose reconciliation failed as committed, never rejected", async () => {
    const record = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Read the diff.",
    });

    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      readEffectiveState: async () => undefined,
      reconcile: async () => [{
        target: "native-skills" as const,
        status: "failed" as const,
        summary: "projection failed",
        errors: ["harness unavailable"],
      }],
    });

    expect(result.settlement.outcome).toBe("committed-reconciliation-failed");
    expect(existsSync(join(tempDir, ".kiln", "skills", "repo-review", "SKILL.md"))).toBe(true);
    expect(result.settlement.diagnostics.map((entry) => entry.message)).toContain("harness unavailable");
  });

  it("restores the exact prior bytes through a governed rollback", async () => {
    const path = join(tempDir, ".kiln", "skills", "repo-review", "SKILL.md");
    const original = "---\nname: repo-review\ndescription: Original\n---\n\nOriginal instructions.\n";
    mkdirSync(join(tempDir, ".kiln", "skills", "repo-review"), { recursive: true });
    writeFileSync(path, original, "utf-8");

    const change = propose("skill.upsert", {
      name: "repo-review",
      description: "Replaced",
      instructions: "Replaced instructions.",
    });
    const committed = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: change.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });
    expect(readFileSync(path, "utf-8")).toContain("Replaced instructions.");

    const rollback = propose("mutation.rollback", { token: committed.settlement.rollbackToken });
    const restored = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: rollback.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(restored.settlement.outcome).toBe("committed");
    expect(readFileSync(path, "utf-8")).toBe(original);
  });

  it("writes a global preference through the authority rather than the surface", async () => {
    seedGlobalConfig();
    const record = propose("preference.set", { key: "ui.theme", value: "vesper" });

    expect(record.proposal.scope).toBe("global");
    expect(record.proposal.activation).toBe("hot");
    expect(record.proposal.affectedCanonicalPaths).toEqual([globalConfigPath()]);

    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    expect(parse(readFileSync(globalConfigPath(), "utf-8")).ui.theme).toBe("vesper");
  });

  it("preserves operator comments and ordering when editing global configuration", async () => {
    mkdirSync(join(globalHome, "kiln"), { recursive: true });
    const authored = [
      "# Operator-authored global configuration",
      "version: '4'",
      "",
      "ui:",
      "  # keep this note",
      "  theme: kiln-dark",
      "",
    ].join("\n");
    writeFileSync(globalConfigPath(), authored, "utf-8");

    const record = propose("preference.set", { key: "ui.theme", value: "vesper" });
    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    const committed = readFileSync(globalConfigPath(), "utf-8");
    expect(committed).toContain("# Operator-authored global configuration");
    expect(committed).toContain("# keep this note");
    expect(committed).toContain("theme: vesper");
  });

  it("never lets a model-called apply commit without an operator approval", async () => {
    const record = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Read the diff.",
    });
    expect(record.proposal.approvalRequired).toBe(false);

    const modelApply = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "model",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(modelApply.settlement.outcome).toBe("rejected");
    expect(modelApply.settlement.diagnostics[0]?.message).toContain("Model-called");
    expect(existsSync(join(tempDir, ".kiln", "skills", "repo-review", "SKILL.md"))).toBe(false);

    const approval = approveConfigMutation({ projectPath: tempDir, proposalId: record.proposal.proposalId });
    const approved = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      approvalId: approval.approvalId,
      requester: "model",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });
    expect(approved.settlement.outcome).toBe("committed");
  });


  it("keeps governance records outside the model-writable project workspace", async () => {
    const record = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Read the diff.",
    });
    await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    // A model holding workspace write authority must not be able to reach
    // proposals, approvals, or settlements in order to forge one.
    expect(existsSync(join(tempDir, ".kiln", "mutations"))).toBe(false);
    const namespaces = readdirSync(join(globalHome, "kiln", "mutations", "config"));
    expect(namespaces).toHaveLength(1);
    expect(existsSync(join(globalHome, "kiln", "mutations", "config", namespaces[0]!, "settlements"))).toBe(true);
  });

  it("does not expose one project's proposal to another project", () => {
    const record = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Read the diff.",
    });

    const otherProject = mkdtempSync(join(tmpdir(), "kiln-other-project-"));
    try {
      // Approving from a different project must not find the proposal, or one
      // project could approve another project's pending configuration change.
      expect(() => approveConfigMutation({
        projectPath: otherProject,
        proposalId: record.proposal.proposalId,
      })).toThrow(/not found/u);
    } finally {
      rmSync(otherProject, { recursive: true, force: true });
    }
  });

  it("removes a created file when rolling back, restoring real non-existence", async () => {
    const path = join(tempDir, ".kiln", "skills", "repo-review", "SKILL.md");
    const created = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Newly created.",
    });
    const committed = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: created.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });
    expect(existsSync(path)).toBe(true);

    const rollback = propose("mutation.rollback", { token: committed.settlement.rollbackToken });
    const restored = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: rollback.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(restored.settlement.outcome).toBe("committed");
    expect(existsSync(path)).toBe(false);
  });

  it("requires approval for a rollback that would restore write authority", async () => {
    const granted = propose("agent.upsert", agentPayload(["read", "bash"]));
    const grantApproval = approveConfigMutation({ projectPath: tempDir, proposalId: granted.proposal.proposalId });
    await applyConfigMutation({
      projectPath: tempDir,
      proposalId: granted.proposal.proposalId,
      approvalId: grantApproval.approvalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    // Narrowing authority needs no approval.
    const narrowed = propose("agent.upsert", agentPayload(["read"]));
    expect(narrowed.proposal.approvalRequired).toBe(false);
    const narrowedResult = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: narrowed.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });
    expect(narrowedResult.settlement.outcome).toBe("committed");

    // Rolling that back re-grants bash, so it must be treated as an expansion.
    const rollback = propose("mutation.rollback", { token: narrowedResult.settlement.rollbackToken });
    expect(rollback.proposal.authorityImpact).toBe("expands-write");
    expect(rollback.proposal.approvalRequired).toBe(true);

    const unapproved = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: rollback.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });
    expect(unapproved.settlement.outcome).toBe("rejected");
    expect(readFileSync(join(tempDir, ".kiln", "agents", "reviewer.md"), "utf-8")).not.toContain("bash");
  });

  it("settles an interrupted commit instead of reporting a stale conflict", async () => {
    const record = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Read the diff.",
    });
    const path = join(tempDir, ".kiln", "skills", "repo-review", "SKILL.md");
    const write = record.writes[0]!;
    const intended = write.nextContent;

    // Simulate a crash after the canonical rename but before settlement: the
    // marker this proposal wrote on entering its commit window is still there.
    mkdirSync(join(tempDir, ".kiln", "skills", "repo-review"), { recursive: true });
    writeFileSync(path, intended, "utf-8");
    new ConfigMutationStore(tempDir).writeProgressMarker({
      proposalId: record.proposal.proposalId,
      path: write.path,
      intendedRevision: `sha256:${createHash("sha256").update(intended).digest("hex")}`,
      startedAt: new Date().toISOString(),
    });

    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    expect(result.settlement.rollbackToken).toBe(record.proposal.proposalId);
    expect(readFileSync(path, "utf-8")).toBe(intended);
  });

  it("treats identical content with no progress marker as a conflict, not an interrupted commit", async () => {
    const record = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Read the diff.",
    });
    const path = join(tempDir, ".kiln", "skills", "repo-review", "SKILL.md");

    // Another writer produced byte-identical content. Without this proposal's
    // own marker there is no evidence it ever entered its commit window, so
    // recovery must not adopt someone else's write as its own.
    mkdirSync(join(tempDir, ".kiln", "skills", "repo-review"), { recursive: true });
    writeFileSync(path, record.writes[0]!.nextContent, "utf-8");

    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("rejected");
    expect(result.settlement.diagnostics[0]?.message).toContain("stale");
  });

  it("preserves every admitted agent field when attaching a skill", async () => {
    const agentPath = join(tempDir, ".kiln", "agents", "reviewer.md");
    mkdirSync(join(tempDir, ".kiln", "agents"), { recursive: true });
    writeFileSync(agentPath, [
      "---",
      "name: reviewer",
      "role: Reviewer",
      "goal: Review changes",
      "tier: reasoning",
      "economicPolicyId: policy-abc",
      "targetId: target-abc",
      "nicknameCandidates:",
      "  - rev",
      "instructionProfiles:",
      "  - sequel-engineering",
      "---",
      "",
      "Review carefully.",
      "",
    ].join("\n"), "utf-8");

    const record = propose("agent.attach_skills", { agent: "reviewer", skills: ["repo-review"] });
    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    const written = readFileSync(agentPath, "utf-8");
    expect(written).toContain("economicPolicyId: policy-abc");
    expect(written).toContain("targetId: target-abc");
    expect(written).toContain("rev");
    expect(written).toContain("sequel-engineering");
    expect(written).toContain("repo-review");
  });

  it("resolves the activation class the ownership ledger deferred to this authority", () => {
    seedGlobalConfig();
    const name = proposeConfigMutation({
      projectPath: tempDir,
      operation: "preference.set",
      payload: { key: "identity.name", value: "Operator" },
    });
    const timezone = proposeConfigMutation({
      projectPath: tempDir,
      operation: "preference.set",
      payload: { key: "identity.timezone", value: "America/Hermosillo" },
    });

    expect(name.proposal.activation).toBe("hot");
    expect(timezone.proposal.activation).toBe("hot");
  });

  it("refuses an unsupported preference and an unknown preference value", () => {
    seedGlobalConfig();
    const unsupportedKey = proposeConfigMutation({
      projectPath: tempDir,
      operation: "preference.set",
      payload: { key: "permissions.ceiling", value: "full" },
    });
    const unknownValue = proposeConfigMutation({
      projectPath: tempDir,
      operation: "preference.set",
      payload: { key: "ui.theme", value: "not-a-theme" },
    });

    expect(unsupportedKey.proposal.status).toBe("invalid");
    expect(unknownValue.proposal.status).toBe("invalid");
  });

  it("refuses a canonical path outside the admitted project configuration roots", () => {
    const record = proposeConfigMutation({
      projectPath: tempDir,
      operation: "skill.upsert",
      payload: {
        name: "repo-review",
        description: "Review",
        instructions: "Read.",
      },
      globalConfigPath: globalConfigPath(),
    });
    expect(record.proposal.status).toBe("valid");

    const escaped = proposeConfigMutation({
      projectPath: join(tempDir, "nested"),
      operation: "skill.upsert",
      payload: {
        name: "repo-review",
        description: "Review",
        instructions: "Read.",
      },
    });
    // A proposal built against a different root must not write into this project.
    expect(escaped.proposal.affectedCanonicalPaths[0]).toContain(join("nested", ".kiln"));
  });
});
