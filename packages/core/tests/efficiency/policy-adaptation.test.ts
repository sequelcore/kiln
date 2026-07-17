import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileArtifactResourceStore,
  PolicyAdaptationEvidenceService,
  applyPolicyAdaptationControl,
  createPolicyAdaptationState,
  evaluateContextAllocationPromotion,
  evaluatePolicyAdaptationCandidate,
  evaluatePolicyAdaptationMonitor,
  generatePolicyAdaptationCandidate,
  projectCostUpdatedEventToLifecycleLedger,
  summarizeLifecycleAttributionLedger,
  type CanonicalCostUpdatedEvent,
  type PolicyAdaptationCohort,
  type PolicyAdaptationMonitorObservation,
  type PolicyAdaptationObservation,
} from "../../src/index.js";

describe("controlled policy adaptation", () => {
  it("commits cohorts and an owner-approved real configuration from replayed ledger evidence", () => {
    const candidate = validCandidate();

    expect(candidate).toMatchObject({
      version: "policy-adaptation-candidate-v1",
      owner: "ContextGovernor",
      generatedFrom: "replayed-lifecycle-ledger",
      baseConfiguration: { contextAllocationMode: "whole-block" },
      candidateConfiguration: { contextAllocationMode: "segmented" },
      owningPromotion: { policyId: "context-allocation-promotion-v1" },
      committedCohorts: [{ cohort: "replay" }, { cohort: "shadow" }, { cohort: "holdout" }],
    });
    expect(candidate.candidateRecordHash).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const evidence = lifecycleEvidence();
    expect(() => generatePolicyAdaptationCandidate({
      ...candidateInput(),
      lifecycleEvidence: [{
        ...evidence,
        replay: {
          ...evidence.replay,
          summary: { ...evidence.replay.summary, totalTokens: evidence.replay.summary.totalTokens + 1 },
        },
      }],
    })).toThrow("summary mismatch");
    expect(() => generatePolicyAdaptationCandidate({
      ...candidateInput(),
      committedCohorts: commitments().map((commitment) =>
        commitment.cohort === "holdout" ? { ...commitment, frozenAt: "2026-07-15T00:00:00.000Z" } : commitment),
    })).toThrow("before candidate generation");
  });

  it("requires conservative replay, isolated shadow, and fixed-holdout evidence", () => {
    const candidate = validCandidate();
    const report = evaluatePolicyAdaptationCandidate({
      candidate,
      observations: observations(),
      minimumSampleSize: 100,
      confidenceLevel: 0.95,
      nonInferiorityMargin: 0.15,
      maximumDistributionShift: 0.05,
      maximumCacheInvalidationTokenIncrease: 0,
    });

    expect(report).toMatchObject({
      version: "policy-adaptation-evaluation-v1",
      decision: "eligible-for-operator-promotion",
      sampleSizeByCohort: { replay: 100, shadow: 100, holdout: 100 },
      holdoutDistributionShift: 0,
      issues: [],
    });
    expect(report.cohorts.every((cohort) => cohort.verifiedSuccessLowerBound >= -0.15)).toBe(true);
    expect(report.cohorts.find((cohort) => cohort.cohort === "holdout")?.tokenDelta).toBe(-1000);

    const changedGate = evaluatePolicyAdaptationCandidate({
      candidate,
      observations: observations(),
      minimumSampleSize: 100,
      confidenceLevel: 0.95,
      nonInferiorityMargin: 0.2,
      maximumDistributionShift: 0.05,
      maximumCacheInvalidationTokenIncrease: 0,
    });
    expect(changedGate.evidenceHash).not.toBe(report.evidenceHash);
  });

  it("blocks holdout swaps, rare regressions, cache collisions, shadow effects, and small samples", () => {
    const broken = observations().filter((observation) =>
      !(observation.cohort === "replay" && observation.taskId === "replay-100"));
    const rareIndex = broken.findIndex((observation) =>
      observation.cohort === "holdout" && observation.taskId === "holdout-100" && observation.policy === "candidate");
    broken[rareIndex] = {
      ...broken[rareIndex]!,
      fixtureSetHash: sha("swapped-holdout"),
      verifiedSuccess: false,
      hardInvariantsPassed: false,
      cachePartitionHash: broken[rareIndex - 1]!.cachePartitionHash,
      invalidCacheReuseObserved: true,
    };
    const shadowIndex = broken.findIndex((observation) => observation.cohort === "shadow" && observation.policy === "candidate");
    broken[shadowIndex] = { ...broken[shadowIndex]!, shadowUserVisible: true, shadowExternalSideEffectsSuppressed: false };

    const report = evaluatePolicyAdaptationCandidate({
      candidate: validCandidate(),
      observations: broken,
      minimumSampleSize: 100,
      confidenceLevel: 0.95,
      nonInferiorityMargin: 0.15,
      maximumDistributionShift: 0.05,
      maximumCacheInvalidationTokenIncrease: 0,
    });

    expect(report.decision).toBe("blocked");
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("replay cohort requires"),
      expect.stringContaining("cohort commitment mismatch"),
      expect.stringContaining("rare task regression"),
      expect.stringContaining("cache partition collision"),
      expect.stringContaining("invalid cache reuse"),
      expect.stringContaining("shadow isolation"),
      expect.stringContaining("hard invariant"),
    ]));
  });

  it("requires exact operator approval, optimistic revisions, freeze, and configuration rollback", () => {
    const candidate = validCandidate();
    const evaluation = validEvaluation(candidate);
    const initial = createPolicyAdaptationState({
      policyId: candidate.basePolicyId,
      configurationHash: candidate.baseConfigurationHash,
    });
    const approval = {
      approvalId: "approval-1",
      proposalHash: sha("proposal"),
      candidateRecordHash: candidate.candidateRecordHash,
      evaluationEvidenceHash: evaluation.evidenceHash,
      approvedBy: "ricardo",
      surface: "cli",
    };

    expect(() => applyPolicyAdaptationControl(initial, {
      action: "promote",
      expectedRevision: 0,
      requestedBy: { kind: "agent", id: "candidate" },
      candidate,
      evaluation,
      approval,
      evidenceUris: [artifact("promotion")],
    })).toThrow("trusted operator");

    const frozen = applyPolicyAdaptationControl(initial, {
      action: "freeze",
      expectedRevision: 0,
      requestedBy: { kind: "operator", id: "ricardo" },
      reason: "Investigate shift.",
      approvalId: "approval-freeze",
      approvalHash: sha("freeze"),
      evidenceUris: [artifact("freeze")],
    });
    expect(() => applyPolicyAdaptationControl(frozen, {
      action: "promote",
      expectedRevision: 1,
      requestedBy: { kind: "operator", id: "ricardo" },
      candidate,
      evaluation,
      approval,
      evidenceUris: [artifact("promotion")],
    })).toThrow("frozen");

    const unfrozen = applyPolicyAdaptationControl(frozen, {
      action: "unfreeze",
      expectedRevision: 1,
      requestedBy: { kind: "operator", id: "ricardo" },
      approvalId: "approval-unfreeze",
      approvalHash: sha("unfreeze"),
      evidenceUris: [artifact("unfreeze")],
    });
    const promoted = applyPolicyAdaptationControl(unfrozen, {
      action: "promote",
      expectedRevision: 2,
      requestedBy: { kind: "operator", id: "ricardo" },
      candidate,
      evaluation,
      approval,
      evidenceUris: [artifact("promotion")],
    });
    expect(promoted.active).toEqual({ policyId: candidate.candidatePolicyId, configurationHash: candidate.candidateConfigurationHash });
    expect(() => applyPolicyAdaptationControl(promoted, {
      action: "rollback",
      expectedRevision: 2,
      requestedBy: { kind: "operator", id: "ricardo" },
      target: initial.active,
      dataMigrationRequired: false,
      approvalId: "approval-rollback",
      approvalHash: sha("rollback"),
      evidenceUris: [artifact("rollback")],
    })).toThrow("revision is stale");

    const rolledBack = applyPolicyAdaptationControl(promoted, {
      action: "rollback",
      expectedRevision: 3,
      requestedBy: { kind: "operator", id: "ricardo" },
      target: initial.active,
      dataMigrationRequired: false,
      approvalId: "approval-rollback",
      approvalHash: sha("rollback"),
      evidenceUris: [artifact("rollback")],
    });
    expect(rolledBack.active).toEqual(initial.active);
  });

  it("recommends freeze without mutating state and persists evidence under verification retention", () => {
    const candidate = validCandidate();
    const stable = evaluatePolicyAdaptationMonitor({
      candidate,
      observations: monitorObservations(),
      minimumSampleSize: 100,
      maximumDistributionShift: 0.05,
    });
    expect(stable.status).toBe("stable");
    const drifting = monitorObservations().map((observation, index) => index === 0
      ? { ...observation, invalidCacheReuseObserved: true }
      : observation);
    expect(evaluatePolicyAdaptationMonitor({
      candidate,
      observations: drifting,
      minimumSampleSize: 100,
      maximumDistributionShift: 0.05,
    }).status).toBe("freeze-recommended");

    const rootDir = mkdtempSync(join(tmpdir(), "kiln-adaptation-evidence-"));
    try {
      const first = new FileArtifactResourceStore({ rootDir });
      const persisted = new PolicyAdaptationEvidenceService(first).persist("monitor", stable);
      const [namespace, id] = persisted.artifactUri.replace("kiln://artifacts/", "").replace("/content", "").split("/");
      const reopened = new FileArtifactResourceStore({ rootDir });
      expect(reopened.get(namespace!, id!)?.retention.scope).toBe("verification");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

function candidateInput() {
  return {
    candidateId: "context-segmented-candidate-1",
    policyFamily: "context-allocation" as const,
    basePolicyId: "context-whole-block-v1",
    candidatePolicyId: "context-segmented-v1",
    rollbackPolicyId: "context-whole-block-v1",
    baseConfiguration: { contextAllocationMode: "whole-block" as const },
    candidateConfiguration: { contextAllocationMode: "segmented" as const },
    owningPromotionReport: owningPromotionReport(),
    owningPromotionArtifactUri: artifact("owning-promotion"),
    committedCohorts: commitments(),
    lifecycleEvidence: [lifecycleEvidence()],
    generatedAt: "2026-07-14T01:00:00.000Z",
  };
}

function validCandidate() {
  return generatePolicyAdaptationCandidate(candidateInput());
}

function owningPromotionReport() {
  return evaluateContextAllocationPromotion(Array.from({ length: 5 }, (_, index) => [
    { taskId: `owner-${index}`, taskClass: "common", policy: "whole-block-baseline" as const, verifiedSuccess: true, modelFacingTokens: 100, requiredContextPreserved: true, auditEvidenceId: `baseline-${index}` },
    { taskId: `owner-${index}`, taskClass: "common", policy: "candidate" as const, verifiedSuccess: true, modelFacingTokens: 90, requiredContextPreserved: true, auditEvidenceId: `candidate-${index}` },
  ]).flat());
}

function commitments() {
  return (["replay", "shadow", "holdout"] as const).map((cohort, index) => ({
    cohort,
    cohortId: `${cohort}-fixed-v1`,
    fixtureSetHash: sha(`${cohort}-fixtures`),
    inputConfigurationHash: sha(`${cohort}-input-config`),
    frozenAt: `2026-07-14T00:0${index}:00.000Z`,
    evidenceUri: artifact(`${cohort}-commitment`),
    referenceTaskClassCounts: { common: 95, rare: 5 },
    requiredRareTasks: [{ taskClass: "rare", minimumSamples: 5 }],
  }));
}

function observations(): PolicyAdaptationObservation[] {
  const result: PolicyAdaptationObservation[] = [];
  for (const cohort of ["replay", "shadow", "holdout"] as const) {
    const commitment = commitments().find((entry) => entry.cohort === cohort)!;
    for (let index = 1; index <= 100; index += 1) {
      for (const policy of ["baseline", "candidate"] as const) {
        result.push({
          cohort,
          cohortId: commitment.cohortId,
          fixtureSetHash: commitment.fixtureSetHash,
          taskId: `${cohort}-${index}`,
          taskClass: index > 95 ? "rare" : "common",
          inputHash: sha(`${cohort}-input-${index}`),
          policy,
          policyId: policy === "baseline" ? "context-whole-block-v1" : "context-segmented-v1",
          verifiedSuccess: true,
          hardInvariantsPassed: true,
          tokens: policy === "baseline" ? 100 : 90,
          costUsd: policy === "baseline" ? 0.01 : 0.009,
          cachePartitionHash: sha(`${policy}-partition`),
          cacheIsolationVerified: true,
          invalidCacheReuseObserved: false,
          cacheInvalidationTokens: 0,
          ...(cohort === "replay" && policy === "candidate" ? { replayDivergenceRecorded: true } : {}),
          ...(cohort === "shadow" && policy === "candidate" ? { shadowUserVisible: false, shadowExternalSideEffectsSuppressed: true } : {}),
          evidenceUri: artifact(`${cohort}-${index}-${policy}`),
        });
      }
    }
  }
  return result;
}

function validEvaluation(candidate: ReturnType<typeof validCandidate>) {
  return evaluatePolicyAdaptationCandidate({
    candidate,
    observations: observations(),
    minimumSampleSize: 100,
    confidenceLevel: 0.95,
    nonInferiorityMargin: 0.15,
    maximumDistributionShift: 0.05,
    maximumCacheInvalidationTokenIncrease: 0,
  });
}

function monitorObservations(): PolicyAdaptationMonitorObservation[] {
  return Array.from({ length: 100 }, (_, index) => ({
    taskId: `monitor-${index + 1}`,
    taskClass: index >= 95 ? "rare" : "common",
    verifiedSuccess: true,
    hardInvariantsPassed: true,
    invalidCacheReuseObserved: false,
    evidenceUri: artifact(`monitor-${index + 1}`),
  }));
}

function lifecycleEvidence() {
  const event: CanonicalCostUpdatedEvent = {
    eventId: "adaptation-cost-1",
    kilnSessionId: "session-1",
    sequence: 1,
    timestamp: new Date("2026-07-14T00:00:00.000Z"),
    kind: "cost_updated",
    provider: { provider: "codex-oauth", model: "gpt-test" },
    usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    cost: { currency: "USD", deltaUsd: 0.01 },
  };
  const ledger = projectCostUpdatedEventToLifecycleLedger(event, {
    context: { policyVersion: "context-whole-block-v1" },
    allocations: [
      { source: "knowledge", tokenClass: "admitted", tokens: 100, providerTokenClass: "input", quality: "provider_reported" },
      { source: "final_output", tokenClass: "generated", tokens: 10, providerTokenClass: "output", quality: "provider_reported" },
    ],
  });
  return {
    replay: { costEvent: event, ledger, summary: summarizeLifecycleAttributionLedger(ledger) },
    artifactUri: artifact("lifecycle-replay"),
  };
}

function sha(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function artifact(id: string): string {
  return `kiln://artifacts/adaptation/${id}/content`;
}
