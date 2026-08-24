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
import { captureCanonicalReconciliationGeneration } from "../../src/application/config-reconciliation-generation.js";
import { defaultGlobalConfig, type KilnGlobalConfig } from "../../src/config/global-config.js";
import {
  executionTargetEvidenceRevision,
  writeExecutionTargetEvidenceSnapshot,
  type ExecutionTargetCatalogIntent,
} from "../../src/config/execution-target-evidence-store.js";
import { syntheticExecutionTargetEvidence } from "../config/execution-target-evidence-fixture.js";
import { makeOperatorSurfaceGlobalConfig, makeOperatorSurfaceTargetEvidence } from "../commands/operator-surface-v4-fixture.js";
import { type ProjectStateBinding, resolveProjectStateBinding } from "../../src/application/project-state-root.js";

let tempDir: string;
let globalHome: string;
let projectStateBinding!: ProjectStateBinding;
let previousXdgConfigHome: string | undefined;

/** Reconciliation is exercised separately; these specs assert lifecycle behavior. */
const reconcileOk = vi.fn(async () => []);

function isDigest(value: string): value is `sha256:${string}` {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function globalConfigPath(): string {
  return join(globalHome, "kiln", "config.yaml");
}

function mutationStore(): ConfigMutationStore {
  return new ConfigMutationStore(tempDir, {
    root: projectStateBinding.mutationsPath,
    globalConfigPath: globalConfigPath(),
  });
}

function seedGlobalConfig(): void {
  mkdirSync(join(globalHome, "kiln"), { recursive: true });
  writeFileSync(globalConfigPath(), stringify(defaultGlobalConfig()), "utf-8");
}

function seedGlobalConfigWithTargetCatalog(intent: ExecutionTargetCatalogIntent): void {
  mkdirSync(join(globalHome, "kiln"), { recursive: true });
  writeFileSync(globalConfigPath(), stringify({ ...defaultGlobalConfig(), targetCatalog: intent }), "utf-8");
}

function admittedTargetState() {
  const config = makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.6-terra", "selected-target");
  return {
    intent: config.targetCatalog!,
    evidence: makeOperatorSurfaceTargetEvidence("codex-oauth", "gpt-5.6-terra", "selected-target"),
  };
}

function emptyTargetState() {
  const admitted = admittedTargetState();
  const evidence = { ...admitted.evidence, targets: [] };
  return {
    evidence,
    intent: {
      ...admitted.intent,
      evidenceRevision: executionTargetEvidenceRevision(evidence),
      targets: [],
    } satisfies ExecutionTargetCatalogIntent,
  };
}

function targetWithRevision(current: ExecutionTargetCatalogIntent, targetId: string) {
  const template = admittedTargetState().intent.targets[0]!;
  const target = { ...template, id: targetId, label: "Created target" };
  return {
    intent: { ...current, targets: [target] } satisfies ExecutionTargetCatalogIntent,
  };
}

function propose(operation: Parameters<typeof proposeConfigMutation>[0]["operation"], payload: unknown) {
  const record = proposeConfigMutation({
    projectPath: tempDir,
    projectStateBinding,
    globalConfigPath: globalConfigPath(),
    operation,
    payload,
  });
  mutationStore().saveProposal(record);
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
    mkdirSync(join(tempDir, ".git"), { recursive: true });
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = globalHome;
    projectStateBinding = resolveProjectStateBinding(tempDir);
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

  it("fails closed for a settlement without current activation evidence", () => {
    const store = mutationStore();
    const historical = {
      proposalId: "historical-proposal",
      approvalId: null,
      scope: "project",
      operation: "project.adopt",
      settledAt: "2026-01-01T00:00:00.000Z",
      outcome: "committed",
      baseRevision: "absent",
      committedRevision: `sha256:${"a".repeat(64)}`,
      appliedWrites: [],
      reconciliationEffects: [],
      diagnostics: [],
      rollbackToken: null,
      activation: "next-session",
      restore: [],
    };

    expect(() => store.settle(historical as unknown as Parameters<typeof store.settle>[0]))
      .toThrow(/invalid activation observation evidence/iu);

    // A pre-cutover record must not become executable evidence through a raw
    // file write either. The current parser simply ignores it.
    const settlementPath = join(
      projectStateBinding.mutationsPath,
      store.projectIdentity,
      "settlements",
      "historical-proposal.json",
    );
    mkdirSync(join(projectStateBinding.mutationsPath, store.projectIdentity, "settlements"), { recursive: true });
    writeFileSync(settlementPath, JSON.stringify(historical), "utf-8");
    expect(store.readSettlement("historical-proposal")).toBeNull();
    expect(store.readLatestSettlement("project.adopt")).toBeNull();
  });

  it("uses the narrow effective-config view for default mutation readback", async () => {
    const readConfigStatusSnapshot = vi.fn(async () => ({ effectiveConfig: undefined }));
    vi.doMock("../../src/application/config-status.js", () => ({ readConfigStatusSnapshot }));
    try {
      const record = propose("skill.upsert", {
        name: "effective-readback",
        description: "Exercise the canonical readback boundary.",
        instructions: "Read effective configuration only.",
      });

      await applyConfigMutation({
        projectPath: tempDir,
        proposalId: record.proposal.proposalId,
        requester: "operator",
        reconcile: reconcileOk,
      });

      expect(readConfigStatusSnapshot).toHaveBeenCalledWith({ projectPath: tempDir, view: "effective" });
    } finally {
      vi.doUnmock("../../src/application/config-status.js");
    }
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
    expect(result.settlement.activationObservation).toEqual({
      state: "active",
      boundary: "reconcile",
      committedRevision: result.settlement.committedRevision,
      activeRevision: result.settlement.committedRevision,
      summary: "Owned projections converged on the committed revision.",
    });
    expect(existsSync(join(projectStateBinding.skillsPath, "repo-review", "SKILL.md"))).toBe(true);
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
    expect(existsSync(join(projectStateBinding.agentsPath, "reviewer.md"))).toBe(false);

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
    expect(readFileSync(join(projectStateBinding.agentsPath, "reviewer.md"), "utf-8")).toContain("bash");
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

    const path = join(projectStateBinding.skillsPath, "repo-review", "SKILL.md");
    mkdirSync(join(projectStateBinding.skillsPath, "repo-review"), { recursive: true });
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

  it("keeps reconciliation single-flight for concurrent recovery proposals", async () => {
    seedGlobalConfig();
    const initial = proposeConfigMutation({
      projectPath: tempDir,
      operation: "project.adopt",
      payload: { scope: "project", posture: "read-only" },
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const store = mutationStore();
    store.saveProposal(initial);
    const first = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: initial.proposal.proposalId,
      requester: "operator",
      reconcile: async () => [{
        target: "repo-shims",
        status: "failed",
        summary: "initial reconciliation failed",
        errors: ["fixture failure"],
      }],
      readEffectiveState: async () => undefined,
    });
    expect(first.settlement.outcome).toBe("committed-reconciliation-failed");

    const recoveryA = proposeConfigMutation({
      projectPath: tempDir,
      operation: "project.adopt",
      payload: { scope: "project", posture: "read-only" },
      now: new Date("2026-01-01T00:00:01.000Z"),
    });
    const recoveryB = proposeConfigMutation({
      projectPath: tempDir,
      operation: "project.adopt",
      payload: { scope: "project", posture: "read-only" },
      now: new Date("2026-01-01T00:00:02.000Z"),
    });
    store.saveProposal(recoveryA);
    store.saveProposal(recoveryB);

    let announceA!: () => void;
    let finishA!: () => void;
    const aStarted = new Promise<void>((resolve) => {
      announceA = resolve;
    });
    const aMayFinish = new Promise<void>((resolve) => {
      finishA = resolve;
    });
    const pendingA = applyConfigMutation({
      projectPath: tempDir,
      proposalId: recoveryA.proposal.proposalId,
      requester: "operator",
      reconcile: async () => {
        announceA();
        await aMayFinish;
        return [{
          target: "repo-shims",
          status: "failed",
          summary: "recovery A failed",
          errors: ["fixture failure A"],
        }];
      },
      readEffectiveState: async () => undefined,
    });
    await aStarted;

    const recoveryBResult = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: recoveryB.proposal.proposalId,
      requester: "operator",
      reconcile: async () => [{
        target: "repo-shims",
        status: "ok",
        summary: "recovery B succeeded",
        errors: [],
      }],
      readEffectiveState: async () => undefined,
    });
    expect(recoveryBResult.settlement.outcome).toBe("rejected");
    expect(recoveryBResult.settlement.diagnostics[0]?.message).toContain("already in progress");
    expect(recoveryBResult.settlement.diagnostics[0]?.message).not.toContain(store.lockPathFor(recoveryB.writes[0]!.path));
    expect(recoveryBResult.settlement.diagnostics[0]?.message).not.toMatch(/[\\/]/u);

    finishA();
    expect((await pendingA).settlement.outcome).toBe("committed-reconciliation-failed");
    expect(store.readLatestSettlement("project.adopt")?.outcome).toBe("committed-reconciliation-failed");
  });

  it("blocks every competing operation on a path until its interrupted proposal settles", async () => {
    seedGlobalConfig();
    const interrupted = proposeConfigMutation({
      projectPath: tempDir,
      operation: "project.adopt",
      payload: { scope: "project", posture: "read-only" },
    });
    const store = mutationStore();
    store.saveProposal(interrupted);
    const interruptedWrite = interrupted.writes[0]!;
    store.writeProgressMarker({
      proposalId: interrupted.proposal.proposalId,
      path: interruptedWrite.path,
      intendedRevision: `sha256:${createHash("sha256").update(interruptedWrite.nextContent).digest("hex")}`,
      startedAt: new Date().toISOString(),
    });
    writeFileSync(interruptedWrite.path, interruptedWrite.nextContent, "utf-8");

    const competitor = proposeConfigMutation({
      projectPath: tempDir,
      operation: "setting.set",
      payload: { scope: "project", key: "domain", value: "backend" },
    });
    store.saveProposal(competitor);
    const competitorReconcile = vi.fn(async () => []);
    const refused = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: competitor.proposal.proposalId,
      requester: "operator",
      reconcile: competitorReconcile,
      readEffectiveState: async () => undefined,
    });

    expect(refused.settlement.outcome).toBe("rejected");
    expect(refused.settlement.diagnostics[0]?.message).toContain("interrupted");
    expect(competitorReconcile).not.toHaveBeenCalled();
    expect(readFileSync(interruptedWrite.path, "utf-8")).toBe(interruptedWrite.nextContent);

    const recovered = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: interrupted.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });
    expect(recovered.settlement.outcome).toBe("committed");
    expect(store.readSettlement(interrupted.proposal.proposalId)).toMatchObject({
      baseRevision: "absent",
      restore: [{ path: interruptedWrite.path, previousContent: null }],
    });
  });

  it("rejects replay when the committed revision is no longer effective", async () => {
    const record = propose("skill.upsert", {
      name: "replay-guard",
      description: "Prove honest replay",
      instructions: "Keep replay bound to effective state.",
    });
    const first = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });
    rmSync(record.writes[0]!.path, { force: true });

    const replay = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(first.settlement.outcome).toBe("committed");
    expect(replay.settlement.outcome).toBe("rejected");
    expect(replay.settlement.diagnostics[0]?.message).toContain("no longer the effective canonical revision");
  });

  it("does not let a model replay an operator settlement without its matching approval", async () => {
    const record = propose("skill.upsert", {
      name: "model-replay-guard",
      description: "Prove requester replay checks",
      instructions: "Require operator approval for model callers.",
    });
    await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    const replay = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "model",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(replay.settlement.outcome).toBe("rejected");
    expect(replay.settlement.diagnostics[0]?.field).toBe("approvalId");
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
    expect(result.settlement.activationObservation).toMatchObject({
      state: "failed",
      boundary: "reconcile",
      committedRevision: result.settlement.committedRevision,
      activeRevision: null,
    });
    expect(existsSync(join(projectStateBinding.skillsPath, "repo-review", "SKILL.md"))).toBe(true);
    expect(result.settlement.diagnostics.map((entry) => entry.message)).toContain("harness unavailable");
  });

  it("does not report a superseded reconciliation revision as active", async () => {
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
        status: "skipped" as const,
        summary: "superseded",
        errors: [],
      }],
    });

    expect(result.settlement.activationObservation).toMatchObject({
      state: "superseded",
      boundary: "reconcile",
      committedRevision: result.settlement.committedRevision,
      activeRevision: null,
    });
  });

  it("settles the exact generation proven inside the target fence when canonical inputs change afterward", async () => {
    const record = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Read the diff.",
    });
    let fencedGeneration: `sha256:${string}` | undefined;

    await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      readEffectiveState: async () => undefined,
      reconcile: async () => {
        const captured = captureCanonicalReconciliationGeneration(tempDir, "native-skills");
        if (!isDigest(captured)) throw new Error("fixture generation was malformed");
        fencedGeneration = captured;
        const competitor = join(projectStateBinding.skillsPath, "competitor", "SKILL.md");
        mkdirSync(join(projectStateBinding.skillsPath, "competitor"), { recursive: true });
        writeFileSync(competitor, "---\nname: competitor\ndescription: changed\n---\n", "utf8");
        return [{
          target: "native-skills" as const,
          status: "ok" as const,
          summary: "fenced generation converged",
          errors: [],
          generation: fencedGeneration,
        }];
      },
    });

    expect(captureCanonicalReconciliationGeneration(tempDir, "native-skills")).not.toBe(fencedGeneration);
    expect(mutationStore().readSettlement(record.proposal.proposalId)?.reconciliationGenerations)
      .toEqual([{ target: "native-skills", generation: fencedGeneration }]);
  });

  it("restores the exact prior bytes through a governed rollback", async () => {
    const path = join(projectStateBinding.skillsPath, "repo-review", "SKILL.md");
    const original = "---\nname: repo-review\ndescription: Original\n---\n\nOriginal instructions.\n";
    mkdirSync(join(projectStateBinding.skillsPath, "repo-review"), { recursive: true });
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
    expect(restored.settlement.committedRevision).toBe(`sha256:${createHash("sha256").update(original).digest("hex")}`);
    expect(restored.settlement.committedRevision).not.toBe(committed.settlement.committedRevision);
    expect(mutationStore().readLatestSettlementForPath(
      path,
      restored.settlement.committedRevision ?? undefined,
    )?.proposalId).toBe(rollback.proposal.proposalId);
  });

  it("orders settlements by canonical path across different mutation operations", async () => {
    const now = new Date("2026-08-22T00:00:00.000Z");
    const change = propose("skill.upsert", {
      name: "path-ordering",
      description: "Original",
      instructions: "Original instructions.",
    });
    const committed = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: change.proposal.proposalId,
      requester: "operator",
      now,
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });
    const rollback = propose("mutation.rollback", { token: committed.settlement.rollbackToken });
    const restored = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: rollback.proposal.proposalId,
      requester: "operator",
      now,
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(Date.parse(restored.settlement.settledAt)).toBe(Date.parse(committed.settlement.settledAt) + 1);
    expect(restored.settlement.proposalId).not.toBe(committed.settlement.proposalId);
  });

  it("writes a global preference through the authority rather than the surface", async () => {
    seedGlobalConfig();
    const record = propose("setting.set", { scope: "global", key: "ui.theme", value: "vesper" });

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
    expect(result.settlement.activationObservation).toEqual({
      state: "failed",
      boundary: "hot",
      committedRevision: result.settlement.committedRevision,
      activeRevision: null,
      summary: "Canonical configuration committed, but owner read-back did not prove hot activation.",
    });
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

    const record = propose("setting.set", { scope: "global", key: "ui.theme", value: "vesper" });
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
    expect(existsSync(join(projectStateBinding.skillsPath, "repo-review", "SKILL.md"))).toBe(false);

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
    expect(existsSync(projectStateBinding.mutationsPath)).toBe(true);
    expect(existsSync(join(projectStateBinding.mutationsPath, mutationStore().projectIdentity, "settlements"))).toBe(true);
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
    const path = join(projectStateBinding.skillsPath, "repo-review", "SKILL.md");
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
    expect(readFileSync(join(projectStateBinding.agentsPath, "reviewer.md"), "utf-8")).not.toContain("bash");
  });

  it("preserves the complete admitted skill shape and supports user-global ownership", async () => {
    const record = propose("skill.upsert", {
      scope: "user",
      name: "portable-review",
      description: "Review a portable fixture.",
      license: "MIT",
      compatibility: "Kiln 3",
      metadata: { owner: "fixture", revision: 2 },
      handler: "review.handler",
      tools: ["read"],
      tags: ["review"],
      triggers: [{ event: "task_started", filter: { source: "fixture" } }],
      instructions: "Read the fixture and report findings.",
    });

    expect(record.proposal.scope).toBe("global");
    expect(record.proposal.affectedCanonicalPaths[0]).toBe(join(globalHome, "kiln", "skills", "portable-review", "SKILL.md"));
    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    const content = readFileSync(join(globalHome, "kiln", "skills", "portable-review", "SKILL.md"), "utf-8");
    expect(content).toContain("license: MIT");
    expect(content).toContain("compatibility: Kiln 3");
    expect(content).toContain("handler: review.handler");
    expect(content).toContain("task_started");
    expect(content).toContain("owner: fixture");
  });

  it("rolls back a newly created user-global skill through the same authority", async () => {
    const created = propose("skill.upsert", {
      scope: "user",
      name: "portable-review",
      description: "Review a portable fixture.",
      instructions: "Read the fixture and report findings.",
    });
    const committed = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: created.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });
    const path = join(globalHome, "kiln", "skills", "portable-review", "SKILL.md");
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

  it("fails closed when native import sees invalid canonical global configuration", async () => {
    mkdirSync(join(globalHome, "kiln"), { recursive: true });
    const invalid = "version: 'not-canonical'\npermissions: [invalid]\n";
    writeFileSync(globalConfigPath(), invalid, "utf-8");

    const record = propose("native.import", {
      target: "codex",
      permissions: { approval: "on-request", sandbox: "read-only" },
    });

    expect(record.proposal.status).toBe("invalid");
    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("rejected");
    expect(readFileSync(globalConfigPath(), "utf-8")).toBe(invalid);
    expect(readdirSync(join(globalHome, "kiln")).some((entry) => entry.includes("invalid-") && entry.endsWith(".bak"))).toBe(false);
  });

  it("rejects unknown native permission fields and scalar values", () => {
    seedGlobalConfig();

    const unknownField = propose("native.import", {
      target: "codex",
      permissions: { tools: [] },
    });
    const unknownValue = propose("native.import", {
      target: "codex",
      permissions: { approval: "yolo" },
    });

    expect(unknownField.proposal.status).toBe("invalid");
    expect(unknownField.proposal.diagnostics.some((entry) => entry.field === "permissions.tools")).toBe(true);
    expect(unknownValue.proposal.status).toBe("invalid");
    expect(unknownValue.proposal.diagnostics.some((entry) => entry.field === "permissions.approval")).toBe(true);
  });

  it("selects an admitted execution target and persists the GUI selection together", async () => {
    const state = admittedTargetState();
    seedGlobalConfigWithTargetCatalog(state.intent);
    writeExecutionTargetEvidenceSnapshot({ globalConfigPath: globalConfigPath(), snapshot: state.evidence });

    const record = propose("target.select", { targetId: "selected-target" });
    expect(record.proposal.status).toBe("valid");
    expect(record.proposal.authorityImpact).toBe("unknown");

    const approval = approveConfigMutation({ projectPath: tempDir, proposalId: record.proposal.proposalId });
    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      approvalId: approval.approvalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    const config = parse(readFileSync(globalConfigPath(), "utf-8")) as KilnGlobalConfig;
    expect(config.targetRouting).toEqual({ defaultTargetId: "selected-target" });
    expect(config.ui?.targetSelection).toEqual({ targetId: "selected-target" });
  });

  it("requires approval when routing and UI selection have drifted", () => {
    const state = admittedTargetState();
    const other = { ...state.intent.targets[0]!, id: "other-target", label: "Other target" };
    seedGlobalConfigWithTargetCatalog({ ...state.intent, targets: [...state.intent.targets, other] });
    const config = parse(readFileSync(globalConfigPath(), "utf-8")) as KilnGlobalConfig;
    writeFileSync(globalConfigPath(), stringify({
      ...config,
      targetRouting: { defaultTargetId: "other-target" },
      ui: { targetSelection: { targetId: "selected-target" } },
    }), "utf-8");

    const record = propose("target.select", { targetId: "selected-target" });

    expect(record.proposal.status).toBe("valid");
    expect(record.proposal.authorityImpact).toBe("unknown");
    expect(record.proposal.approvalRequired).toBe(true);
  });

  it("rejects selection of a target that is not in the admitted catalog", () => {
    seedGlobalConfigWithTargetCatalog(admittedTargetState().intent);
    const before = readFileSync(globalConfigPath(), "utf-8");
    const record = propose("target.select", { targetId: "missing-target" });

    expect(record.proposal.status).toBe("invalid");
    expect(record.proposal.diagnostics.some((entry) => entry.field === "targetId")).toBe(true);
    expect(readFileSync(globalConfigPath(), "utf-8")).toBe(before);
  });

  it("creates a target only from the exact expected config and published evidence revisions", async () => {
    const current = emptyTargetState();
    seedGlobalConfigWithTargetCatalog(current.intent);
    writeExecutionTargetEvidenceSnapshot({ globalConfigPath: globalConfigPath(), snapshot: current.evidence });
    const expectedRevision = `sha256:${createHash("sha256").update(readFileSync(globalConfigPath(), "utf-8")).digest("hex")}`;
    const next = targetWithRevision(current.intent, "created-target");
    const nextEvidence = syntheticExecutionTargetEvidence(next.intent);
    const nextEvidenceRevision = executionTargetEvidenceRevision(nextEvidence);
    writeExecutionTargetEvidenceSnapshot({ globalConfigPath: globalConfigPath(), snapshot: nextEvidence });

    const record = propose("target.create", {
      target: next.intent.targets[0],
      evidenceRevision: nextEvidenceRevision,
      expectedRevision,
    });
    expect(record.proposal.status).toBe("valid");
    expect(record.proposal.affectedCanonicalPaths).toEqual([globalConfigPath()]);

    const approval = approveConfigMutation({ projectPath: tempDir, proposalId: record.proposal.proposalId });
    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      approvalId: approval.approvalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    const config = parse(readFileSync(globalConfigPath(), "utf-8")) as KilnGlobalConfig;
    expect(config.targetCatalog?.targets.map((target) => target.id)).toEqual(["created-target"]);
    expect(config.targetCatalog?.evidenceRevision).toBe(nextEvidenceRevision);
  });

  it("rejects target creation when the fenced global revision is stale", () => {
    const current = emptyTargetState();
    seedGlobalConfigWithTargetCatalog(current.intent);
    writeExecutionTargetEvidenceSnapshot({ globalConfigPath: globalConfigPath(), snapshot: current.evidence });
    const next = targetWithRevision(current.intent, "stale-target");
    const nextEvidence = syntheticExecutionTargetEvidence(next.intent);
    const nextEvidenceRevision = executionTargetEvidenceRevision(nextEvidence);
    writeExecutionTargetEvidenceSnapshot({ globalConfigPath: globalConfigPath(), snapshot: nextEvidence });
    const before = readFileSync(globalConfigPath(), "utf-8");

    const record = propose("target.create", {
      target: next.intent.targets[0],
      evidenceRevision: nextEvidenceRevision,
      expectedRevision: `sha256:${"0".repeat(64)}`,
    });

    expect(record.proposal.status).toBe("invalid");
    expect(record.proposal.diagnostics.some((entry) => entry.field === "expectedRevision")).toBe(true);
    expect(readFileSync(globalConfigPath(), "utf-8")).toBe(before);
  });

  it("derives native import approval from the permission delta and preserves YAML comments", async () => {
    mkdirSync(join(globalHome, "kiln"), { recursive: true });
    const before = [
      "version: '4'",
      "engines:",
      "  codex:",
      "    enabled: false",
      "    billing: plus-quota",
      "permissions:",
      "  # operator rationale must survive typed import",
      "  approval: on-request",
      "  sandbox: read-only",
      "",
    ].join("\n");
    writeFileSync(globalConfigPath(), before, "utf-8");

    const record = propose("native.import", {
      target: "codex",
      permissions: { sandbox: "workspace-write" },
    });
    expect(record.proposal.status).toBe("valid");
    expect(record.proposal.authorityImpact).toBe("expands-write");
    expect(record.proposal.approvalRequired).toBe(true);
    expect(record.proposal.previewDiff).toContain("-  sandbox: read-only");
    expect(record.proposal.previewDiff).toContain("+  sandbox: workspace-write");

    const approval = approveConfigMutation({ projectPath: tempDir, proposalId: record.proposal.proposalId });
    const result = await applyConfigMutation({
      projectPath: tempDir,
      proposalId: record.proposal.proposalId,
      approvalId: approval.approvalId,
      requester: "operator",
      reconcile: reconcileOk,
      readEffectiveState: async () => undefined,
    });

    expect(result.settlement.outcome).toBe("committed");
    const after = readFileSync(globalConfigPath(), "utf-8");
    expect(after).toBe(record.writes[0]?.nextContent);
    expect(after).toContain("operator rationale must survive typed import");
    expect(parse(after)).toMatchObject({
      engines: { codex: { enabled: true } },
      permissions: { approval: "on-request", sandbox: "workspace-write" },
    });
  });

  it("settles an interrupted commit instead of reporting a stale conflict", async () => {
    const record = propose("skill.upsert", {
      name: "repo-review",
      description: "Review the repository",
      instructions: "Read the diff.",
    });
    const path = join(projectStateBinding.skillsPath, "repo-review", "SKILL.md");
    const write = record.writes[0]!;
    const intended = write.nextContent;

    // Simulate a crash after the canonical rename but before settlement: the
    // marker this proposal wrote on entering its commit window is still there.
    mkdirSync(join(projectStateBinding.skillsPath, "repo-review"), { recursive: true });
    writeFileSync(path, intended, "utf-8");
    mutationStore().writeProgressMarker({
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
    const path = join(projectStateBinding.skillsPath, "repo-review", "SKILL.md");

    // Another writer produced byte-identical content. Without this proposal's
    // own marker there is no evidence it ever entered its commit window, so
    // recovery must not adopt someone else's write as its own.
    mkdirSync(join(projectStateBinding.skillsPath, "repo-review"), { recursive: true });
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
    const agentPath = join(projectStateBinding.agentsPath, "reviewer.md");
    mkdirSync(projectStateBinding.agentsPath, { recursive: true });
    writeFileSync(agentPath, [
      "---",
      "name: reviewer",
      "role: Reviewer",
      "goal: Review changes",
      "tier: reasoning",
      "authorityProfileId: readonly-plan",
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
    expect(written).toContain("authorityProfileId: readonly-plan");
    expect(written).toContain("targetId: target-abc");
    expect(written).toContain("rev");
    expect(written).toContain("sequel-engineering");
    expect(written).toContain("repo-review");
  });

  it("resolves the activation class the ownership ledger deferred to this authority", () => {
    seedGlobalConfig();
    const name = proposeConfigMutation({
      projectPath: tempDir,
      operation: "setting.set",
      payload: { scope: "global", key: "identity.name", value: "Operator" },
    });
    const timezone = proposeConfigMutation({
      projectPath: tempDir,
      operation: "setting.set",
      payload: { scope: "global", key: "identity.timezone", value: "America/Hermosillo" },
    });

    expect(name.proposal.activation).toBe("hot");
    expect(timezone.proposal.activation).toBe("hot");
  });

  it("refuses an unsupported key and an inadmissible value", () => {
    seedGlobalConfig();
    const unsupportedKey = proposeConfigMutation({
      projectPath: tempDir,
      operation: "setting.set",
      payload: { scope: "global", key: "permissions.ceiling", value: "full" },
    });
    const unknownValue = proposeConfigMutation({
      projectPath: tempDir,
      operation: "setting.set",
      payload: { scope: "global", key: "ui.theme", value: "not-a-theme" },
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

    const nestedProject = join(tempDir, "nested");
    mkdirSync(join(nestedProject, ".git"), { recursive: true });
    const nestedBinding = resolveProjectStateBinding(nestedProject);
    const escaped = proposeConfigMutation({
      projectPath: nestedProject,
      projectStateBinding: nestedBinding,
      globalConfigPath: globalConfigPath(),
      operation: "skill.upsert",
      payload: {
        name: "repo-review",
        description: "Review",
        instructions: "Read.",
      },
    });
    // A proposal built against a different synthetic root must not write into
    // this project's private state namespace.
    expect(escaped.proposal.affectedCanonicalPaths[0]).toBe(
      join(nestedBinding.skillsPath, "repo-review", "SKILL.md"),
    );
    expect(escaped.proposal.affectedCanonicalPaths[0]).not.toBe(
      join(projectStateBinding.skillsPath, "repo-review", "SKILL.md"),
    );
  });
});
