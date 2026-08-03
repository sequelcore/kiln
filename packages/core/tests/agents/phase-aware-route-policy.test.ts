import { describe, expect, it } from "vitest";
import {
  KNOWN_DELIBERATION_LEVEL_IDS,
  PhaseAwareModelRouter,
  selectPhaseAwareRoute,
  type PhaseAwareRouteCandidate,
} from "../../src/index.js";

const LEVEL = KNOWN_DELIBERATION_LEVEL_IDS;

const capabilityEvidence = {
  sourceIdentity: "phase-router-fixture",
  sourceRevision: "1",
  observedAt: "2026-08-02T00:00:00.000Z",
} as const;

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
  deliberationCapabilities: {
    provider: "local",
    model: "fast",
    levels: [LEVEL.minimal, LEVEL.low, LEVEL.medium].map((id) => ({ id })),
    defaultLevel: LEVEL.low,
    supportsAdaptive: true,
    evidence: capabilityEvidence,
  },
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
  deliberationCapabilities: {
    provider: "remote",
    model: "capable",
    levels: [LEVEL.low, LEVEL.medium, LEVEL.high, LEVEL.xhigh].map((id) => ({ id })),
    defaultLevel: LEVEL.high,
    supportsAdaptive: true,
    evidence: capabilityEvidence,
  },
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
      deliberation: {
        intent: { mode: "provider-default", onUnsupported: "deny" },
        source: "project",
      },
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
      deliberation: {
        intent: { mode: "fixed", preferredLevel: LEVEL.high, onUnsupported: "omit" },
        source: "operator",
      },
    });
    expect(verify.selected).toMatchObject({
      provider: "remote",
      model: "capable",
      deliberationResolution: {
        status: "exact",
        selectedLevel: LEVEL.high,
        source: "operator",
      },
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
      deliberation: {
        intent: { mode: "provider-default", onUnsupported: "omit" },
        source: "project",
      },
    }).route(request);
    expect(candidate).toMatchObject({
      provider: "remote",
      model: "capable",
      routingTier: "cascade",
    });

    const rollback = new PhaseAwareModelRouter({
      candidates: [CHEAP, CAPABLE],
      requiredVerificationContractId: "verified-change-v1",
      deliberation: {
        intent: { mode: "provider-default", onUnsupported: "omit" },
        source: "project",
      },
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
        {
          ...CAPABLE,
          provider: "other",
          model: "wrong-verifier",
          verificationContractId: "weaker-v1",
          deliberationCapabilities: {
            ...CAPABLE.deliberationCapabilities!,
            provider: "other",
            model: "wrong-verifier",
          },
        },
        {
          ...CAPABLE,
          provider: "expensive",
          model: "over-budget",
          estimatedCostUsd: 2,
          deliberationCapabilities: {
            ...CAPABLE.deliberationCapabilities!,
            provider: "expensive",
            model: "over-budget",
          },
        },
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
      deliberation: {
        intent: { mode: "provider-default", onUnsupported: "omit" },
        source: "project",
      },
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
        {
          ...CHEAP,
          provider: "degraded",
          model: "degraded",
          health: "degraded",
          configuredRank: 0,
          deliberationCapabilities: {
            ...CHEAP.deliberationCapabilities!,
            provider: "degraded",
            model: "degraded",
          },
        },
        {
          ...CHEAP,
          provider: "healthy",
          model: "healthy",
          configuredRank: 1,
          deliberationCapabilities: {
            ...CHEAP.deliberationCapabilities!,
            provider: "healthy",
            model: "healthy",
          },
        },
      ],
      signals: {
        taskClass: "repository-orientation",
        phase: "orient",
        uncertainty: 0.1,
        toolNeed: 0.2,
        verificationNeed: 0.1,
      },
      requiredVerificationContractId: "verified-change-v1",
      deliberation: {
        intent: { mode: "provider-default", onUnsupported: "deny" },
        source: "project",
      },
    });

    expect(decision.selected).toMatchObject({ provider: "healthy", model: "healthy" });
    expect(decision.diagnostics).toContainEqual(expect.objectContaining({
      code: "route-unhealthy",
      provider: "local",
      model: "fast",
    }));
  });

  it("excludes routes denied by deliberation while preserving denial evidence", () => {
    const decision = selectPhaseAwareRoute({
      candidates: [CHEAP],
      signals: {
        taskClass: "deep-verification",
        phase: "verify",
        uncertainty: 1,
        toolNeed: 0,
        verificationNeed: 1,
      },
      requiredVerificationContractId: "verified-change-v1",
      deliberation: {
        intent: { mode: "fixed", preferredLevel: LEVEL.high, onUnsupported: "deny" },
        source: "operator",
      },
    });

    expect(decision.selected).toBeUndefined();
    expect(decision.diagnostics).toContainEqual(expect.objectContaining({
      code: "deliberation-unresolved",
      deliberationResolution: expect.objectContaining({
        status: "denied",
        reason: "preferred-level-unsupported",
        source: "operator",
      }),
    }));
  });
});
