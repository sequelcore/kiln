import { describe, expect, it } from "vitest";
import {
  evaluateDelegationEfficiencyPromotion,
  selectDelegationEfficiencyCandidate,
  type DelegationEfficiencyObservation,
} from "../../src/index.js";

describe("delegation efficiency decision", () => {
  it("selects direct, fresh-context, and shared-artifact candidates by declared task shape", () => {
    const base = {
      taskClass: "verified-change",
      breadth: 0.2,
      coupling: 0.9,
      isolationNeed: 0.1,
      uncertainty: 0.2,
      directExecutionAllowed: true,
      parentAuthority: 2,
      childAuthority: 2,
      routeIdentityComplete: true,
      verificationContractId: "verified-change-v1",
      childVerificationContractId: "verified-change-v1",
      canonicalArtifactUris: [] as string[],
      terminalEvidenceAvailable: true,
      replayEvidenceAvailable: true,
      recoveryEvidenceAvailable: true,
    } as const;

    expect(selectDelegationEfficiencyCandidate(base).selected).toBe("direct");
    expect(selectDelegationEfficiencyCandidate({
      ...base,
      taskClass: "isolated-review",
      breadth: 0.7,
      coupling: 0.2,
      isolationNeed: 1,
      directExecutionAllowed: false,
    }).selected).toBe("fresh-context");
    expect(selectDelegationEfficiencyCandidate({
      ...base,
      taskClass: "breadth-research",
      breadth: 1,
      coupling: 0.1,
      canonicalArtifactUris: ["kiln://artifacts/research/source-bundle/content"],
    }).selected).toBe("shared-artifact");
  });

  it("fails closed on authority widening, contract drift, incomplete identity, and noncanonical resources", () => {
    const decision = selectDelegationEfficiencyCandidate({
      taskClass: "breadth-research",
      breadth: 1,
      coupling: 0.1,
      isolationNeed: 0.5,
      uncertainty: 0.8,
      directExecutionAllowed: false,
      parentAuthority: 1,
      childAuthority: 2,
      routeIdentityComplete: false,
      verificationContractId: "verified-change-v1",
      childVerificationContractId: "weaker-v1",
      canonicalArtifactUris: ["kiln://managed-invocations/child/transcript"],
      terminalEvidenceAvailable: false,
      replayEvidenceAvailable: false,
      recoveryEvidenceAvailable: false,
    });

    expect(decision.selected).toBeUndefined();
    expect(decision.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "authority-widening",
      "route-identity-incomplete",
      "verification-contract-mismatch",
      "noncanonical-resource",
      "terminal-evidence-missing",
      "replay-evidence-missing",
      "recovery-evidence-missing",
    ]));
  });
});

function observations(candidateOverrides: Partial<DelegationEfficiencyObservation> = {}): DelegationEfficiencyObservation[] {
  return Array.from({ length: 5 }, (_, index) => {
    const common = {
      taskId: `task-${index}`,
      taskClass: "breadth-research",
      verifiedSuccess: true,
      verificationContractId: "verified-change-v1",
      childAuthorityNoWider: true,
      terminalHandoffComplete: true,
      recoveryEvidenceAvailable: true,
      coordinationEvidenceId: `coordination-${index}`,
      coordinationCostKnown: true,
    } as const;
    return [
      { ...common, policy: "static-baseline" as const, coordinationTokens: 1_000, coordinationCostUsd: 0.1 },
      {
        ...common,
        policy: "candidate" as const,
        coordinationTokens: 700,
        coordinationCostUsd: 0.07,
        ...candidateOverrides,
      },
    ];
  }).flat();
}

describe("delegation efficiency promotion", () => {
  it("promotes a non-inferior task class with lower known coordination cost", () => {
    const report = evaluateDelegationEfficiencyPromotion(observations());
    expect(report).toMatchObject({
      policyId: "delegation-efficiency-promotion-v1",
      taskCount: 5,
      promotionEligible: true,
      issues: [],
    });
    expect(report.comparisonHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(report.taskClasses[0]).toMatchObject({
      taskClass: "breadth-research",
      baselineSuccessRate: 1,
      candidateSuccessRate: 1,
      tokenDelta: -1_500,
      costDeltaUsd: -0.15,
    });
  });

  it("blocks unknown economics, authority widening, incomplete handoff, and recovery gaps", () => {
    const report = evaluateDelegationEfficiencyPromotion(observations({
      coordinationCostKnown: false,
      childAuthorityNoWider: false,
      terminalHandoffComplete: false,
      recoveryEvidenceAvailable: false,
      coordinationEvidenceId: "",
    }));
    expect(report.promotionEligible).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("coordination cost is unknown"),
      expect.stringContaining("widened child authority"),
      expect.stringContaining("incomplete terminal handoff"),
      expect.stringContaining("missing recovery evidence"),
      expect.stringContaining("missing coordination evidence"),
    ]));
  });
});
