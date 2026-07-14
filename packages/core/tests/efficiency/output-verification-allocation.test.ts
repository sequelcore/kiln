import { describe, expect, it } from "vitest";
import {
  allocateVerificationPlan,
  defineStructuredExecutionResult,
  defineVerificationUsageReport,
  evaluateOutputVerificationPromotion,
  projectStructuredExecutionResult,
  type OutputVerificationObservation,
  type StructuredExecutionResult,
} from "../../src/efficiency/index.js";
import type { ResolvedInvocationEffect } from "../../src/engine/domain/action-effect.js";

const observeEffect: ResolvedInvocationEffect = {
  operation: "observe",
  boundaries: ["workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

function result(overrides: Partial<StructuredExecutionResult> = {}): StructuredExecutionResult {
  return defineStructuredExecutionResult({
    version: "structured-execution-result-v1",
    status: "blocked",
    summary: "The change is blocked pending approval.",
    details: "Long implementation narrative that concise output may omit.",
    limitations: ["Live deployment was not exercised."],
    operatorDecisions: [{ id: "decision-1", summary: "Do not publish", rationale: "Approval is pending." }],
    evidence: [{ uri: "kiln://artifacts/run/proof/content", kind: "verification", label: "focused test" }],
    citations: [{ uri: "https://example.test/source", label: "source" }],
    warnings: ["The route is degraded."],
    failures: ["Typecheck failed."],
    approvalRequirements: [{ id: "approval-1", status: "pending", summary: "Operator approval required." }],
    residualRisks: ["External behavior remains unverified."],
    verificationResults: [{
      requirementId: "typecheck",
      method: "deterministic",
      status: "failed",
      summary: "Typecheck failed.",
      evidenceUris: ["kiln://artifacts/run/typecheck/content"],
    }],
    ...overrides,
  });
}

describe("output and verification allocation", () => {
  it("keeps every control field in concise projections while reducing narrative", () => {
    const canonical = result();
    const concise = projectStructuredExecutionResult(canonical, "concise");
    const detailed = projectStructuredExecutionResult(canonical, "detailed");

    expect(concise).toMatchObject({
      status: "blocked",
      summary: canonical.summary,
      operatorDecisions: [{ id: "decision-1", summary: "Do not publish" }],
      warnings: canonical.warnings,
      failures: canonical.failures,
      approvalRequirements: canonical.approvalRequirements,
      residualRisks: canonical.residualRisks,
      evidence: canonical.evidence,
      citations: canonical.citations,
      verificationResults: canonical.verificationResults,
    });
    expect(concise).not.toHaveProperty("details");
    expect(concise.operatorDecisions[0]).not.toHaveProperty("rationale");
    expect(detailed.details).toBe(canonical.details);
  });

  it("does not infer success or verification state from prose", () => {
    expect(() => result({
      status: "completed",
      summary: "Everything passed.",
    })).toThrow("Completed structured results cannot contain failures, pending approvals, or failed verification");
  });

  it("uses deterministic verification before admitting a semantic judge", () => {
    const deterministic = allocateVerificationPlan({
      effect: observeEffect,
      uncertainty: 0.1,
      blastRadius: 0.1,
      requirements: [{ id: "schema", kind: "deterministic", deterministicCheckAvailable: true }],
    });
    expect(deterministic.reviewDepth).toBe("none");
    expect(deterministic.steps.map((step) => step.method)).toEqual(["deterministic"]);

    const semantic = allocateVerificationPlan({
      effect: observeEffect,
      uncertainty: 0.4,
      blastRadius: 0.2,
      requirements: [
        { id: "schema", kind: "deterministic", deterministicCheckAvailable: true },
        { id: "faithfulness", kind: "semantic", deterministicCheckAvailable: false },
      ],
    });
    expect(semantic.steps.map((step) => step.method)).toEqual(["deterministic", "model-judge", "human-review"]);
  });

  it("fails toward deep review for unknown or high-impact effects", () => {
    const external: ResolvedInvocationEffect = {
      operation: "mutate",
      boundaries: ["external-system"],
      reversibility: "irreversible",
      dataEgress: "project-data",
      identityUse: "authenticated",
      consequences: ["external-state"],
      idempotency: "non-idempotent",
    };
    expect(allocateVerificationPlan({
      effect: external,
      uncertainty: 0.1,
      blastRadius: 0.1,
      requirements: [],
    }).reviewDepth).toBe("deep");
    expect(allocateVerificationPlan({
      effect: observeEffect,
      uncertainty: 0.9,
      blastRadius: 0.9,
      requirements: [],
    }).reviewDepth).toBe("deep");
    expect(allocateVerificationPlan({
      uncertainty: 0.1,
      blastRadius: 0.1,
      requirements: [],
    }).reviewDepth).toBe("deep");
  });

  it("keeps incomplete verification economics unknown instead of coercing them to zero", () => {
    const report = defineVerificationUsageReport({
      version: "verification-usage-v1",
      attempts: [{
        requirementId: "faithfulness",
        method: "model-judge",
        status: "passed",
        providerTokenClass: "input",
        tokens: { value: 120, source: "provider-reported" },
        costUsd: { value: "unknown", source: "unknown" },
        latencyMs: { value: 75, source: "estimated" },
        evidenceUris: ["kiln://artifacts/run/judge/content"],
      }],
    });
    expect(report.totals).toEqual({ tokens: 120, costUsd: "unknown", latencyMs: 75 });
  });

  it("requires five paired tasks and preserves output and verification proof before promotion", () => {
    const observations: OutputVerificationObservation[] = [];
    for (let index = 1; index <= 5; index += 1) {
      for (const policy of ["static-baseline", "candidate"] as const) {
        observations.push({
          taskId: `task-${index}`,
          taskClass: "verified-change",
          policy,
          verifiedSuccess: true,
          requiredControlFieldsPreserved: true,
          verificationContractId: "verified-change-v1",
          outputTokens: policy === "candidate" ? 50 : 100,
          verificationCostUsd: policy === "candidate" ? 0.01 : 0.02,
          verificationCostKnown: true,
          verificationEvidenceId: `evidence-${policy}-${index}`,
        });
      }
    }
    const report = evaluateOutputVerificationPromotion(observations);
    expect(report.promotionEligible).toBe(true);
    expect(report.outputTokenDelta).toBe(-250);
    expect(report.verificationCostDeltaUsd).toBeCloseTo(-0.05);
  });
});
