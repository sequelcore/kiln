import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateContextAllocationPromotion,
  evaluatePolicyAdaptationCandidate,
  generatePolicyAdaptationCandidate,
  projectCostUpdatedEventToLifecycleLedger,
  summarizeLifecycleAttributionLedger,
  type CanonicalCostUpdatedEvent,
  type PolicyAdaptationObservation,
} from "@kilnai/core";
import { parse } from "yaml";
import { approveConfigChangeProposal } from "../../src/application/config-approval.js";
import { applyConfigChange } from "../../src/application/config-apply.js";
import { ConfigMutationStore } from "../../src/application/config-mutation-store.js";
import { createConfigChangeProposalRecord } from "../../src/application/config-proposal.js";
import { syncNativeSkillProjections } from "../../src/config/native-skill-projection.js";

vi.mock("../../src/config/config-merger.js", () => ({
  loadKilnConfig: vi.fn(async () => ({
    version: "1",
    skills: { visibility: { overrides: { "repo-review": "explicit-only" } } },
  })),
}));

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
    expect(vi.mocked(syncNativeSkillProjections)).toHaveBeenCalledWith(tempDir, {
      disabledHarnesses: [],
      skillConfig: { visibility: { overrides: { "repo-review": "explicit-only" } } },
    });
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
        message: "Config apply can only write project .kiln/agents, .kiln/skills, or .kiln/kiln.yaml canonical configuration.",
      }),
    ]));
    expect(existsSync(join(tempDir, ".kiln", "config.yaml"))).toBe(false);
  });

  it("fails closed when a canonical path resolves through a junction outside the project", async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "kiln-config-outside-"));
    try {
      const skillsDir = join(tempDir, ".kiln", "skills");
      mkdirSync(skillsDir, { recursive: true });
      symlinkSync(outsideDir, join(skillsDir, "escaped-skill"), "junction");
      const record = createConfigChangeProposalRecord({
        projectPath: tempDir,
        operation: "skill.upsert",
        payload: {
          name: "escaped-skill",
          description: "Must remain project-local.",
          instructions: "# Escaped Skill",
        },
      });
      const store = new ConfigMutationStore(tempDir);
      store.saveProposal(record);
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
          message: "Config apply refused a canonical path whose physical target escapes the project root.",
        }),
      ]));
      expect(existsSync(join(outsideDir, "SKILL.md"))).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("applies approved context-policy promotion, freeze, and exact rollback through canonical config", async () => {
    const kilnYamlPath = join(tempDir, ".kiln", "kiln.yaml");
    writeFileSync(kilnYamlPath, "version: '1'\ncontextGovernance:\n  allocationMode: whole-block\n", "utf-8");
    const { candidate, evaluation } = adaptationEvidence();

    const promotion = createConfigChangeProposalRecord({
      projectPath: tempDir,
      operation: "context_governance.adapt",
      payload: { action: "promote", expectedRevision: 0, candidate, evaluation },
    });
    expect(promotion.proposal.status).toBe("valid");
    const store = new ConfigMutationStore(tempDir);
    store.saveProposal(promotion);
    const promotionApproval = approveConfigChangeProposal({ projectPath: tempDir, proposalId: promotion.proposal.proposalId, approvedBy: "operator" });
    expect((await applyConfigChange({ projectPath: tempDir, proposalId: promotion.proposal.proposalId, approvalId: promotionApproval.approvalId })).status).toBe("applied");
    let config = parse(readFileSync(kilnYamlPath, "utf-8")) as { contextGovernance: { allocationMode: string; adaptation: { revision: number; frozen: boolean; activePolicyId: string } } };
    expect(config.contextGovernance).toMatchObject({
      allocationMode: "segmented",
      adaptation: { revision: 1, frozen: false, activePolicyId: "context-segmented-v1" },
    });

    const stale = createConfigChangeProposalRecord({
      projectPath: tempDir,
      operation: "context_governance.adapt",
      payload: { action: "freeze", expectedRevision: 0, reason: "stale request" },
    });
    expect(stale.proposal.status).toBe("invalid");

    const freeze = createConfigChangeProposalRecord({
      projectPath: tempDir,
      operation: "context_governance.adapt",
      payload: { action: "freeze", expectedRevision: 1, reason: "monitor recommended freeze" },
    });
    store.saveProposal(freeze);
    const freezeApproval = approveConfigChangeProposal({ projectPath: tempDir, proposalId: freeze.proposal.proposalId });
    expect((await applyConfigChange({ projectPath: tempDir, proposalId: freeze.proposal.proposalId, approvalId: freezeApproval.approvalId })).status).toBe("applied");

    const rollback = createConfigChangeProposalRecord({
      projectPath: tempDir,
      operation: "context_governance.adapt",
      payload: { action: "rollback", expectedRevision: 2 },
    });
    store.saveProposal(rollback);
    const rollbackApproval = approveConfigChangeProposal({ projectPath: tempDir, proposalId: rollback.proposal.proposalId });
    expect((await applyConfigChange({ projectPath: tempDir, proposalId: rollback.proposal.proposalId, approvalId: rollbackApproval.approvalId })).status).toBe("applied");
    config = parse(readFileSync(kilnYamlPath, "utf-8"));
    expect(config.contextGovernance).toMatchObject({
      allocationMode: "whole-block",
      adaptation: { revision: 3, frozen: true, activePolicyId: "context-whole-block-v1" },
    });
  });
});

function adaptationEvidence() {
  const owningPromotionReport = evaluateContextAllocationPromotion(Array.from({ length: 5 }, (_, index) => [
    { taskId: `owner-${index}`, taskClass: "rare", policy: "whole-block-baseline" as const, verifiedSuccess: true, modelFacingTokens: 100, requiredContextPreserved: true, auditEvidenceId: `baseline-${index}` },
    { taskId: `owner-${index}`, taskClass: "rare", policy: "candidate" as const, verifiedSuccess: true, modelFacingTokens: 90, requiredContextPreserved: true, auditEvidenceId: `candidate-${index}` },
  ]).flat());
  const event: CanonicalCostUpdatedEvent = {
    eventId: "adaptation-event",
    kilnSessionId: "adaptation-session",
    sequence: 1,
    timestamp: new Date("2026-07-14T00:00:00.000Z"),
    kind: "cost_updated",
    provider: { provider: "codex-oauth", model: "gpt-test" },
    usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    cost: { currency: "USD", deltaUsd: 0.01 },
  };
  const ledger = projectCostUpdatedEventToLifecycleLedger(event);
  const commitments = (["replay", "shadow", "holdout"] as const).map((cohort, index) => ({
    cohort,
    cohortId: `${cohort}-v1`,
    fixtureSetHash: hash(`${cohort}-fixture`),
    inputConfigurationHash: hash(`${cohort}-input`),
    frozenAt: `2026-07-14T00:0${index}:00.000Z`,
    evidenceUri: artifact(`${cohort}-commitment`),
    referenceTaskClassCounts: { rare: 5 },
    requiredRareTasks: [{ taskClass: "rare", minimumSamples: 5 }],
  }));
  const candidate = generatePolicyAdaptationCandidate({
    candidateId: "context-segmented-candidate-1",
    policyFamily: "context-allocation",
    basePolicyId: "context-whole-block-v1",
    candidatePolicyId: "context-segmented-v1",
    rollbackPolicyId: "context-whole-block-v1",
    baseConfiguration: { contextAllocationMode: "whole-block" },
    candidateConfiguration: { contextAllocationMode: "segmented" },
    owningPromotionReport,
    owningPromotionArtifactUri: artifact("owning-report"),
    committedCohorts: commitments,
    lifecycleEvidence: [{
      replay: { costEvent: event, ledger, summary: summarizeLifecycleAttributionLedger(ledger) },
      artifactUri: artifact("lifecycle"),
    }],
    generatedAt: "2026-07-14T01:00:00.000Z",
  });
  const observations: PolicyAdaptationObservation[] = [];
  for (const cohort of ["replay", "shadow", "holdout"] as const) {
    const commitment = commitments.find((entry) => entry.cohort === cohort)!;
    for (let index = 1; index <= 5; index += 1) {
      for (const policy of ["baseline", "candidate"] as const) observations.push({
        cohort,
        cohortId: commitment.cohortId,
        fixtureSetHash: commitment.fixtureSetHash,
        taskId: `${cohort}-${index}`,
        taskClass: "rare",
        inputHash: hash(`${cohort}-${index}`),
        policy,
        policyId: policy === "baseline" ? "context-whole-block-v1" : "context-segmented-v1",
        verifiedSuccess: true,
        hardInvariantsPassed: true,
        tokens: policy === "baseline" ? 100 : 90,
        costUsd: policy === "baseline" ? 0.01 : 0.009,
        cachePartitionHash: hash(`${policy}-partition`),
        cacheIsolationVerified: true,
        invalidCacheReuseObserved: false,
        cacheInvalidationTokens: 0,
        ...(cohort === "replay" && policy === "candidate" ? { replayDivergenceRecorded: true } : {}),
        ...(cohort === "shadow" && policy === "candidate" ? { shadowUserVisible: false, shadowExternalSideEffectsSuppressed: true } : {}),
        evidenceUri: artifact(`${cohort}-${index}-${policy}`),
      });
    }
  }
  const evaluation = evaluatePolicyAdaptationCandidate({
    candidate,
    observations,
    minimumSampleSize: 5,
    confidenceLevel: 0.95,
    nonInferiorityMargin: 0.6,
    maximumDistributionShift: 0,
    maximumCacheInvalidationTokenIncrease: 0,
  });
  return { candidate, evaluation };
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function artifact(id: string): string {
  return `kiln://artifacts/adaptation/${id}/content`;
}
