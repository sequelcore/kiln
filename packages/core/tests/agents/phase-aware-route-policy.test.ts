import { describe, expect, it } from "vitest";
import {
  resolveNormalizedReasoningEffort,
  PhaseAwareModelRouter,
  selectPhaseAwareRoute,
  type PhaseAwareRouteCandidate,
} from "../../src/index.js";

const CHEAP: PhaseAwareRouteCandidate = {
  provider: "local",
  model: "fast",
  configuredRank: 0,
  eligible: true,
  health: "healthy",
  suitability: 0.8,
  quality: 0.6,
  supportsTools: true,
  preferredPhases: ["orient", "execute"],
  verificationContractId: "verified-change-v1",
  supportedReasoningEfforts: ["minimal", "low", "medium"],
  defaultReasoningEffort: "low",
  estimatedCostUsd: 0.01,
  retryRisk: 0.1,
  cacheInvalidationCostUsd: 0,
  verifierCostUsd: 0.01,
};

const CAPABLE: PhaseAwareRouteCandidate = {
  ...CHEAP,
  provider: "remote",
  model: "capable",
  configuredRank: 1,
  suitability: 0.9,
  quality: 1,
  preferredPhases: ["plan", "verify"],
  supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  defaultReasoningEffort: "high",
  estimatedCostUsd: 0.08,
  retryRisk: 0.05,
  verifierCostUsd: 0.02,
};

describe("phase-aware route policy", () => {
  it("selects cheap orientation and capable verification routes with escalation and static rollback", () => {
    const orient = selectPhaseAwareRoute({
      candidates: [CHEAP, CAPABLE],
      signals: {
        taskClass: "repository-orientation",
        phase: "orient",
        uncertainty: 0.1,
        toolNeed: 0.5,
        verificationNeed: 0.1,
      },
      requiredVerificationContractId: "verified-change-v1",
      effort: { unsupportedPolicy: "fail" },
    });
    expect(orient).toMatchObject({
      policyId: "phase-aware-route-v1",
      selected: { provider: "local", model: "fast" },
      rollbackPolicyId: "static-configured-order-v1",
      rollbackRoute: { provider: "local", model: "fast" },
      escalationRoutes: [{ provider: "remote", model: "capable" }],
    });

    const verify = selectPhaseAwareRoute({
      candidates: [CHEAP, CAPABLE],
      signals: {
        taskClass: "verified-change",
        phase: "verify",
        uncertainty: 0.9,
        toolNeed: 0.4,
        verificationNeed: 1,
      },
      requiredVerificationContractId: "verified-change-v1",
      requestedReasoningEffort: "high",
      effort: { unsupportedPolicy: "omit" },
    });
    expect(verify.selected).toMatchObject({
      provider: "remote",
      model: "capable",
      effortResolution: { status: "resolved", requested: "high", resolved: "high", source: "explicit" },
    });
    expect(verify.escalationRoutes[0]).toMatchObject({ provider: "local", model: "fast" });
  });

  it("implements the canonical model-router port with deterministic static rollback", () => {
    const request = {
      tenantId: "tenant",
      complexity: {
        score: 0.8,
        class: "complex" as const,
        signals: {
          tokenCount: 100,
          hasTools: true,
          toolCount: 2,
          hasCodeBlocks: true,
          hasReasoningMarkers: true,
          turnDepth: 2,
        },
      },
      hasTools: true,
      toolCount: 2,
      requiresStreaming: false,
      task: "verified-change",
      phase: "verify" as const,
      uncertainty: 0.9,
      verificationNeed: 1,
    };
    const candidate = new PhaseAwareModelRouter({
      candidates: [CHEAP, CAPABLE],
      requiredVerificationContractId: "verified-change-v1",
      effort: { unsupportedPolicy: "omit" },
    }).route(request);
    expect(candidate).toMatchObject({
      provider: "remote",
      model: "capable",
      routingTier: "cascade",
    });

    const rollback = new PhaseAwareModelRouter({
      candidates: [CHEAP, CAPABLE],
      requiredVerificationContractId: "verified-change-v1",
      effort: { unsupportedPolicy: "omit" },
      mode: "static-rollback",
    }).route(request);
    expect(rollback).toMatchObject({
      provider: "local",
      model: "fast",
      routingTier: "default",
    });
  });

  it("excludes unhealthy, over-budget, tool-incompatible, and verification-incompatible routes", () => {
    const decision = selectPhaseAwareRoute({
      candidates: [
        { ...CHEAP, health: "cooldown" },
        { ...CAPABLE, supportsTools: false },
        { ...CAPABLE, provider: "other", model: "wrong-verifier", verificationContractId: "weaker-v1" },
        { ...CAPABLE, provider: "expensive", model: "over-budget", estimatedCostUsd: 2 },
      ],
      signals: {
        taskClass: "tool-verification",
        phase: "verify",
        uncertainty: 0.7,
        toolNeed: 1,
        verificationNeed: 1,
        budgetUsd: 0.5,
      },
      requiredVerificationContractId: "verified-change-v1",
      effort: { unsupportedPolicy: "omit" },
    });

    expect(decision.selected).toBeUndefined();
    expect(decision.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "route-unhealthy",
      "tools-unsupported",
      "verification-contract-mismatch",
      "route-over-budget",
    ]));
  });

  it("fails closed on unknown health and penalizes degraded routes", () => {
    const decision = selectPhaseAwareRoute({
      candidates: [
        { ...CHEAP, health: "unknown" },
        { ...CHEAP, provider: "degraded", model: "degraded", health: "degraded", configuredRank: 0 },
        { ...CHEAP, provider: "healthy", model: "healthy", configuredRank: 1 },
      ],
      signals: {
        taskClass: "repository-orientation",
        phase: "orient",
        uncertainty: 0.1,
        toolNeed: 0.2,
        verificationNeed: 0.1,
      },
      requiredVerificationContractId: "verified-change-v1",
      effort: { unsupportedPolicy: "fail" },
    });

    expect(decision.selected).toMatchObject({ provider: "healthy", model: "healthy" });
    expect(decision.diagnostics).toContainEqual(expect.objectContaining({
      code: "route-unhealthy",
      provider: "local",
      model: "fast",
    }));
  });
});

describe("normalized reasoning effort", () => {
  it("records truthful omission and gates xhigh on capability, budget, and promotion evidence", () => {
    expect(resolveNormalizedReasoningEffort({
      requested: "high",
      supportEvidence: "unknown",
      unsupportedPolicy: "omit",
    })).toEqual({ status: "omitted", requested: "high", reason: "capability-unknown" });

    expect(resolveNormalizedReasoningEffort({
      requested: "xhigh",
      supportEvidence: "known",
      supported: ["high", "xhigh"],
      unsupportedPolicy: "omit",
      allowExperimentalXhigh: true,
      xhighPromotionEligible: false,
      budgetUsd: 1,
      estimatedEffortCostUsd: 0.2,
    })).toEqual({ status: "omitted", requested: "xhigh", reason: "xhigh-not-promoted" });

    expect(resolveNormalizedReasoningEffort({
      requested: "xhigh",
      supportEvidence: "known",
      supported: ["xhigh"],
      unsupportedPolicy: "omit",
      allowExperimentalXhigh: true,
      xhighPromotionEligible: true,
      budgetUsd: 0.1,
      estimatedEffortCostUsd: 0.2,
    })).toEqual({ status: "omitted", requested: "xhigh", reason: "budget-exceeded" });

    expect(() => resolveNormalizedReasoningEffort({
      requested: "high",
      supportEvidence: "known",
      supported: ["low"],
      unsupportedPolicy: "fail",
    })).toThrow("Requested reasoning effort 'high' is unsupported");
  });

  it("allows xhigh only for budgeted benchmark evidence before promotion", () => {
    expect(resolveNormalizedReasoningEffort({
      requested: "xhigh",
      supportEvidence: "known",
      supported: ["xhigh"],
      unsupportedPolicy: "omit",
      allowExperimentalXhigh: true,
      purpose: "benchmark",
      estimatedEffortCostUsd: 0.2,
    })).toEqual({ status: "omitted", requested: "xhigh", reason: "budget-required" });

    expect(resolveNormalizedReasoningEffort({
      requested: "xhigh",
      supportEvidence: "known",
      supported: ["xhigh"],
      unsupportedPolicy: "fail",
      allowExperimentalXhigh: true,
      purpose: "benchmark",
      budgetUsd: 0.3,
      estimatedEffortCostUsd: 0.2,
    })).toEqual({
      status: "resolved",
      requested: "xhigh",
      resolved: "xhigh",
      source: "explicit",
    });
  });
});
