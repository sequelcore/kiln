import { describe, expect, it } from "vitest";
import {
  evaluatePhaseAwareRoutePromotion,
  evaluateDeliberationPromotion,
  type PhaseAwareRouteObservation,
  type DeliberationObservation,
} from "../../src/index.js";

function routeObservations(candidateOverrides: Partial<PhaseAwareRouteObservation> = {}): PhaseAwareRouteObservation[] {
  return Array.from({ length: 5 }, (_, index) => {
    const common = {
      taskId: `task-${index}`,
      taskClass: "verified-change",
      verifiedSuccess: true,
      verificationContractId: "verified-change-v1",
      routeEvidenceId: `route-${index}`,
    } as const;
    return [
      {
        ...common,
        policy: "static-baseline" as const,
        costUsd: 0.1,
        modelFacingTokens: 1_000,
        latencyMs: 1_000,
      },
      {
        ...common,
        policy: "phase-aware-candidate" as const,
        costUsd: 0.06,
        modelFacingTokens: 700,
        latencyMs: 800,
        ...candidateOverrides,
      },
    ];
  }).flat();
}

describe("phase-aware routing promotion", () => {
  it("publishes per-task-class Pareto evidence when verification is non-inferior", () => {
    const report = evaluatePhaseAwareRoutePromotion(routeObservations());

    expect(report).toMatchObject({
      policyId: "phase-aware-route-promotion-v1",
      taskCount: 5,
      promotionEligible: true,
      issues: [],
    });
    expect(report.comparisonHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(report.taskClasses).toEqual([expect.objectContaining({
      taskClass: "verified-change",
      paretoStatus: "dominates",
      verificationContractPreserved: true,
      costDeltaUsd: -0.2,
      tokenDelta: -1_500,
      latencyDeltaMs: -1_000,
    })]);
  });

  it("blocks promotion on success regression, contract drift, or missing route evidence", () => {
    const observations = routeObservations({
      verifiedSuccess: false,
      verificationContractId: "weaker-v1",
      routeEvidenceId: "",
    });
    const report = evaluatePhaseAwareRoutePromotion(observations);

    expect(report.promotionEligible).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("verified success regressed"),
      expect.stringContaining("verification contract changed"),
      expect.stringContaining("missing route evidence"),
    ]));
  });
});

function deliberationObservations(xhighOverrides: Partial<DeliberationObservation> = {}): DeliberationObservation[] {
  return Array.from({ length: 5 }, (_, index) => [
    {
      taskId: `task-${index}`,
      taskClass: "formal-proof",
      level: "high" as const,
      verifiedSuccess: true,
      modelFacingTokens: 1_000,
      costUsd: 0.1,
      budgetUsd: 0.2,
      deliberationEvidenceId: `high-${index}`,
    },
    {
      taskId: `task-${index}`,
      taskClass: "formal-proof",
      level: "xhigh" as const,
      verifiedSuccess: true,
      modelFacingTokens: 900,
      costUsd: 0.12,
      budgetUsd: 0.2,
      deliberationEvidenceId: `xhigh-${index}`,
      ...xhighOverrides,
    },
  ]).flat();
}

describe("deliberation promotion", () => {
  it("promotes budgeted xhigh only when value per token is non-inferior to high", () => {
    const report = evaluateDeliberationPromotion(deliberationObservations());
    expect(report).toMatchObject({
      policyId: "deliberation-promotion-v1",
      taskCount: 5,
      promotionEligible: true,
      issues: [],
    });
    expect(report.taskClasses[0]).toMatchObject({
      taskClass: "formal-proof",
      highSuccessRate: 1,
      xhighSuccessRate: 1,
    });
    expect(report.taskClasses[0]!.xhighValuePerToken).toBeGreaterThanOrEqual(
      report.taskClasses[0]!.highValuePerToken,
    );
  });

  it("blocks xhigh on regression, budget breach, or missing resolution evidence", () => {
    const report = evaluateDeliberationPromotion(deliberationObservations({
      verifiedSuccess: false,
      costUsd: 0.3,
      deliberationEvidenceId: "",
    }));
    expect(report.promotionEligible).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("xhigh verified success regressed"),
      expect.stringContaining("exceeded budget"),
      expect.stringContaining("missing deliberation evidence"),
    ]));
  });
});
