import { createHash } from "node:crypto";
import {
  deriveAuthorityFromEffect,
  type ResolvedInvocationEffect,
} from "../engine/domain/action-effect.js";

export type AssistantOutputVerbosity = "concise" | "standard" | "detailed";
export type StructuredExecutionStatus = "completed" | "blocked" | "failed" | "cancelled";
export type StructuredExecutionEvidenceKind = "artifact" | "citation" | "diagnostic" | "verification";
export type StructuredApprovalStatus = "pending" | "approved" | "denied";
export type VerificationMethod = "deterministic" | "model-judge" | "human-review";
export type VerificationResultStatus = "passed" | "failed" | "skipped" | "inconclusive";
export type VerificationReviewDepth = "none" | "focused" | "deep";

export interface StructuredExecutionDecision {
  readonly id: string;
  readonly summary: string;
  readonly rationale?: string;
}

export interface StructuredExecutionEvidence {
  readonly uri: string;
  readonly kind: StructuredExecutionEvidenceKind;
  readonly label?: string;
}

export interface StructuredExecutionCitation {
  readonly uri: string;
  readonly label: string;
}

export interface StructuredApprovalRequirement {
  readonly id: string;
  readonly status: StructuredApprovalStatus;
  readonly summary: string;
}

export interface StructuredVerificationResult {
  readonly requirementId: string;
  readonly method: VerificationMethod;
  readonly status: VerificationResultStatus;
  readonly summary: string;
  readonly evidenceUris: readonly string[];
}

export interface StructuredExecutionResult {
  readonly version: "structured-execution-result-v1";
  readonly status: StructuredExecutionStatus;
  readonly summary: string;
  readonly details?: string;
  readonly uncertainty?: number;
  readonly limitations: readonly string[];
  readonly operatorDecisions: readonly StructuredExecutionDecision[];
  readonly evidence: readonly StructuredExecutionEvidence[];
  readonly citations: readonly StructuredExecutionCitation[];
  readonly warnings: readonly string[];
  readonly failures: readonly string[];
  readonly approvalRequirements: readonly StructuredApprovalRequirement[];
  readonly residualRisks: readonly string[];
  readonly verificationResults: readonly StructuredVerificationResult[];
}

export const STRUCTURED_EXECUTION_RESULT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    version: { type: "string", const: "structured-execution-result-v1" },
    status: { type: "string", enum: ["completed", "blocked", "failed", "cancelled"] },
    summary: { type: "string", minLength: 1 },
    details: { type: "string", minLength: 1 },
    uncertainty: { type: "number", minimum: 0, maximum: 1 },
    limitations: { type: "array", items: { type: "string", minLength: 1 } },
    operatorDecisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          summary: { type: "string", minLength: 1 },
          rationale: { type: "string", minLength: 1 },
        },
        required: ["id", "summary"],
        additionalProperties: false,
      },
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          uri: { type: "string", minLength: 1 },
          kind: { type: "string", enum: ["artifact", "citation", "diagnostic", "verification"] },
          label: { type: "string", minLength: 1 },
        },
        required: ["uri", "kind"],
        additionalProperties: false,
      },
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          uri: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
        },
        required: ["uri", "label"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string", minLength: 1 } },
    failures: { type: "array", items: { type: "string", minLength: 1 } },
    approvalRequirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["pending", "approved", "denied"] },
          summary: { type: "string", minLength: 1 },
        },
        required: ["id", "status", "summary"],
        additionalProperties: false,
      },
    },
    residualRisks: { type: "array", items: { type: "string", minLength: 1 } },
    verificationResults: {
      type: "array",
      items: {
        type: "object",
        properties: {
          requirementId: { type: "string", minLength: 1 },
          method: { type: "string", enum: ["deterministic", "model-judge", "human-review"] },
          status: { type: "string", enum: ["passed", "failed", "skipped", "inconclusive"] },
          summary: { type: "string", minLength: 1 },
          evidenceUris: { type: "array", items: { type: "string", minLength: 1 } },
        },
        required: ["requirementId", "method", "status", "summary", "evidenceUris"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "version",
    "status",
    "summary",
    "limitations",
    "operatorDecisions",
    "evidence",
    "citations",
    "warnings",
    "failures",
    "approvalRequirements",
    "residualRisks",
    "verificationResults",
  ],
  additionalProperties: false,
};

export interface StructuredExecutionResultProjection extends Omit<StructuredExecutionResult, "details"> {
  readonly verbosity: AssistantOutputVerbosity;
  readonly details?: string;
}

export function defineStructuredExecutionResult(input: StructuredExecutionResult): StructuredExecutionResult {
  if (input.version !== "structured-execution-result-v1") {
    throw new Error("Structured execution result version is unsupported.");
  }
  const result: StructuredExecutionResult = {
    version: input.version,
    status: requireMember(input.status, ["completed", "blocked", "failed", "cancelled"], "status"),
    summary: requireText(input.summary, "Structured execution result summary is required."),
    ...(input.details != null ? { details: requireText(input.details, "Structured execution result details are required.") } : {}),
    ...(input.uncertainty != null
      ? { uncertainty: requireNormalizedValue(input.uncertainty, "Structured execution uncertainty") }
      : {}),
    limitations: input.limitations.map((limitation) => requireText(limitation, "Structured execution limitation is required.")),
    operatorDecisions: input.operatorDecisions.map((decision) => ({
      id: requireText(decision.id, "Structured execution decision id is required."),
      summary: requireText(decision.summary, "Structured execution decision summary is required."),
      ...(decision.rationale != null
        ? { rationale: requireText(decision.rationale, "Structured execution decision rationale is required.") }
        : {}),
    })),
    evidence: input.evidence.map((evidence) => ({
      uri: requireText(evidence.uri, "Structured execution evidence uri is required."),
      kind: requireMember(evidence.kind, ["artifact", "citation", "diagnostic", "verification"], "evidence kind"),
      ...(evidence.label != null ? { label: requireText(evidence.label, "Structured execution evidence label is required.") } : {}),
    })),
    citations: input.citations.map((citation) => ({
      uri: requireText(citation.uri, "Structured execution citation uri is required."),
      label: requireText(citation.label, "Structured execution citation label is required."),
    })),
    warnings: input.warnings.map((warning) => requireText(warning, "Structured execution warning is required.")),
    failures: input.failures.map((failure) => requireText(failure, "Structured execution failure is required.")),
    approvalRequirements: input.approvalRequirements.map((approval) => ({
      id: requireText(approval.id, "Structured execution approval id is required."),
      status: requireMember(approval.status, ["pending", "approved", "denied"], "approval status"),
      summary: requireText(approval.summary, "Structured execution approval summary is required."),
    })),
    residualRisks: input.residualRisks.map((risk) => requireText(risk, "Structured execution residual risk is required.")),
    verificationResults: input.verificationResults.map(defineStructuredVerificationResult),
  };
  if (
    result.status === "completed"
    && (
      result.failures.length > 0
      || result.approvalRequirements.some((approval) => approval.status !== "approved")
      || result.verificationResults.some((verification) => verification.status === "failed")
    )
  ) {
    throw new Error("Completed structured results cannot contain failures, pending approvals, or failed verification.");
  }
  return result;
}

export function projectStructuredExecutionResult(
  input: StructuredExecutionResult,
  verbosity: AssistantOutputVerbosity,
): StructuredExecutionResultProjection {
  const result = defineStructuredExecutionResult(input);
  const normalizedVerbosity = requireMember(verbosity, ["concise", "standard", "detailed"], "output verbosity");
  const { details, ...controlFields } = result;
  return {
    ...controlFields,
    verbosity: normalizedVerbosity,
    operatorDecisions: result.operatorDecisions.map((decision) => normalizedVerbosity === "concise"
      ? { id: decision.id, summary: decision.summary }
      : decision),
    ...(normalizedVerbosity === "detailed" && details !== undefined ? { details } : {}),
  };
}

function defineStructuredVerificationResult(input: StructuredVerificationResult): StructuredVerificationResult {
  return {
    requirementId: requireText(input.requirementId, "Structured verification requirement id is required."),
    method: requireMember(input.method, ["deterministic", "model-judge", "human-review"], "verification method"),
    status: requireMember(input.status, ["passed", "failed", "skipped", "inconclusive"], "verification status"),
    summary: requireText(input.summary, "Structured verification summary is required."),
    evidenceUris: input.evidenceUris.map((uri) => requireText(uri, "Structured verification evidence uri is required.")),
  };
}

export type VerificationRequirementKind = "deterministic" | "semantic";

export interface VerificationRequirement {
  readonly id: string;
  readonly kind: VerificationRequirementKind;
  readonly deterministicCheckAvailable: boolean;
}

export interface VerificationAllocationInput {
  readonly effect?: ResolvedInvocationEffect;
  readonly uncertainty: number;
  readonly blastRadius: number;
  readonly requirements: readonly VerificationRequirement[];
}

export interface VerificationPlanStep {
  readonly requirementId: string;
  readonly method: VerificationMethod;
  readonly order: number;
}

export interface VerificationAllocationPlan {
  readonly policyId: "verification-allocation-v1";
  readonly reviewDepth: VerificationReviewDepth;
  readonly approvalRequired: boolean;
  readonly steps: readonly VerificationPlanStep[];
}

export function allocateVerificationPlan(input: VerificationAllocationInput): VerificationAllocationPlan {
  requireNormalized(input.uncertainty, "Verification uncertainty");
  requireNormalized(input.blastRadius, "Verification blast radius");
  const requirements = input.requirements.map((requirement) => ({
    id: requireText(requirement.id, "Verification requirement id is required."),
    kind: requireMember(requirement.kind, ["deterministic", "semantic"], "verification requirement kind"),
    deterministicCheckAvailable: requirement.deterministicCheckAvailable === true,
  }));
  const reviewDepth = deriveReviewDepth(input);
  const authority = input.effect ? deriveAuthorityFromEffect(input.effect) : undefined;
  const deterministicSteps = requirements
    .filter((requirement) => requirement.deterministicCheckAvailable)
    .map((requirement) => ({ requirementId: requirement.id, method: "deterministic" as const }));
  const modelJudgeSteps = requirements
    .filter((requirement) => requirement.kind === "semantic" && !requirement.deterministicCheckAvailable)
    .map((requirement) => ({ requirementId: requirement.id, method: "model-judge" as const }));
  const reviewSteps = reviewDepth === "none"
    ? []
    : [{ requirementId: `review:${reviewDepth}`, method: "human-review" as const }];
  return {
    policyId: "verification-allocation-v1",
    reviewDepth,
    approvalRequired: authority?.requiresApproval ?? true,
    steps: [...deterministicSteps, ...modelJudgeSteps, ...reviewSteps]
      .map((step, index) => ({ ...step, order: index + 1 })),
  };
}

function deriveReviewDepth(input: VerificationAllocationInput): VerificationReviewDepth {
  if (!input.effect) return "deep";
  const effect = input.effect;
  const unknownEffect = effect.reversibility === "unknown"
    || effect.dataEgress === "unknown"
    || effect.identityUse === "unknown"
    || effect.idempotency === "unknown"
    || effect.consequences.includes("unknown");
  const highImpact = effect.reversibility === "irreversible"
    || effect.boundaries.includes("external-system")
    || effect.consequences.some((consequence) =>
      consequence === "external-state"
      || consequence === "financial"
      || consequence === "legal"
      || consequence === "security");
  if (unknownEffect || highImpact || input.uncertainty >= 0.67 || input.blastRadius >= 0.67) return "deep";
  if (effect.operation === "mutate" || input.uncertainty >= 0.34 || input.blastRadius >= 0.34) return "focused";
  return "none";
}

export type VerificationMetricSource = "provider-reported" | "estimated" | "unknown";

export interface VerificationMetric {
  readonly value: number | "unknown";
  readonly source: VerificationMetricSource;
}

export interface VerificationUsageAttempt {
  readonly requirementId: string;
  readonly method: VerificationMethod;
  readonly status: VerificationResultStatus;
  readonly providerTokenClass: "input" | "output";
  readonly tokens: VerificationMetric;
  readonly costUsd: VerificationMetric;
  readonly latencyMs: VerificationMetric;
  readonly evidenceUris: readonly string[];
}

export interface VerificationUsageReport {
  readonly version: "verification-usage-v1";
  readonly attempts: readonly VerificationUsageAttempt[];
  readonly totals: {
    readonly tokens: number | "unknown";
    readonly costUsd: number | "unknown";
    readonly latencyMs: number | "unknown";
  };
}

export function defineVerificationUsageReport(
  input: Omit<VerificationUsageReport, "totals">,
): VerificationUsageReport {
  if (input.version !== "verification-usage-v1") throw new Error("Verification usage version is unsupported.");
  const attempts = input.attempts.map((attempt) => ({
    requirementId: requireText(attempt.requirementId, "Verification usage requirement id is required."),
    method: requireMember(attempt.method, ["deterministic", "model-judge", "human-review"], "verification usage method"),
    status: requireMember(attempt.status, ["passed", "failed", "skipped", "inconclusive"], "verification usage status"),
    providerTokenClass: requireMember(attempt.providerTokenClass, ["input", "output"], "verification provider token class"),
    tokens: defineMetric(attempt.tokens, true),
    costUsd: defineMetric(attempt.costUsd, false),
    latencyMs: defineMetric(attempt.latencyMs, false),
    evidenceUris: attempt.evidenceUris.map((uri) => requireText(uri, "Verification usage evidence uri is required.")),
  }));
  return {
    version: input.version,
    attempts,
    totals: {
      tokens: totalMetric(attempts.map((attempt) => attempt.tokens)),
      costUsd: totalMetric(attempts.map((attempt) => attempt.costUsd)),
      latencyMs: totalMetric(attempts.map((attempt) => attempt.latencyMs)),
    },
  };
}

function defineMetric(metric: VerificationMetric, integer: boolean): VerificationMetric {
  const source = requireMember(metric.source, ["provider-reported", "estimated", "unknown"], "verification metric source");
  if (source === "unknown" || metric.value === "unknown") {
    if (source !== "unknown" || metric.value !== "unknown") {
      throw new Error("Unknown verification metrics must use both unknown value and source.");
    }
    return { value: "unknown", source: "unknown" };
  }
  if (!Number.isFinite(metric.value) || metric.value < 0 || (integer && !Number.isSafeInteger(metric.value))) {
    throw new Error("Verification metrics must be non-negative finite values.");
  }
  return { value: metric.value, source };
}

function totalMetric(metrics: readonly VerificationMetric[]): number | "unknown" {
  if (metrics.some((metric) => metric.value === "unknown")) return "unknown";
  return Number(metrics.reduce<number>((total, metric) => total + (metric.value as number), 0).toFixed(12));
}

export type OutputVerificationPolicy = "static-baseline" | "candidate";

export interface OutputVerificationObservation {
  readonly taskId: string;
  readonly taskClass: string;
  readonly policy: OutputVerificationPolicy;
  readonly verifiedSuccess: boolean;
  readonly requiredControlFieldsPreserved: boolean;
  readonly verificationContractId: string;
  readonly outputTokens: number;
  readonly verificationCostUsd: number;
  readonly verificationCostKnown: boolean;
  readonly verificationEvidenceId: string;
}

export interface OutputVerificationPromotionReport {
  readonly policyId: "output-verification-promotion-v1";
  readonly comparisonHash: string;
  readonly taskCount: number;
  readonly promotionEligible: boolean;
  readonly issues: readonly string[];
  readonly outputTokenDelta: number;
  readonly verificationCostDeltaUsd: number;
}

export function evaluateOutputVerificationPromotion(
  observations: readonly OutputVerificationObservation[],
  minimumTaskCount = 5,
): OutputVerificationPromotionReport {
  const pairs = new Map<string, Partial<Record<OutputVerificationPolicy, OutputVerificationObservation>>>();
  const issues: string[] = [];
  for (const observation of observations) {
    validateObservation(observation);
    const taskId = observation.taskId.trim();
    const pair = pairs.get(taskId) ?? {};
    if (pair[observation.policy]) issues.push(`duplicate ${observation.policy} observation for task ${taskId}`);
    pair[observation.policy] = { ...observation, taskId, taskClass: observation.taskClass.trim() };
    pairs.set(taskId, pair);
  }
  const complete = [...pairs.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([taskId, pair]) => {
    if (!pair["static-baseline"] || !pair.candidate) {
      issues.push(`task ${taskId} is missing a paired observation`);
      return [];
    }
    return [{ taskId, baseline: pair["static-baseline"], candidate: pair.candidate }];
  });
  if (complete.length < minimumTaskCount) issues.push(`requires at least ${minimumTaskCount} paired tasks; received ${complete.length}`);
  for (const pair of complete) {
    if (pair.baseline.taskClass !== pair.candidate.taskClass) issues.push(`task ${pair.taskId} changes task class`);
    if (pair.candidate.verifiedSuccess && !pair.candidate.requiredControlFieldsPreserved) {
      issues.push(`candidate suppressed required control fields for task ${pair.taskId}`);
    }
    if (!pair.candidate.requiredControlFieldsPreserved) issues.push(`candidate did not preserve required control fields for task ${pair.taskId}`);
    if (pair.baseline.verifiedSuccess && !pair.candidate.verifiedSuccess) issues.push(`candidate verified success regressed for task ${pair.taskId}`);
    if (pair.baseline.verificationContractId !== pair.candidate.verificationContractId) issues.push(`verification contract changed for task ${pair.taskId}`);
    for (const observation of [pair.baseline, pair.candidate]) {
      if (!observation.verificationCostKnown) issues.push(`verification cost is unknown for task ${pair.taskId} under ${observation.policy}`);
      if (!observation.verificationEvidenceId.trim()) issues.push(`verification evidence is missing for task ${pair.taskId} under ${observation.policy}`);
    }
  }
  const outputTokenDelta = complete.reduce((total, pair) => total + pair.candidate.outputTokens - pair.baseline.outputTokens, 0);
  const verificationCostDeltaUsd = Number(complete.reduce((total, pair) =>
    total + pair.candidate.verificationCostUsd - pair.baseline.verificationCostUsd, 0).toFixed(12));
  if (outputTokenDelta >= 0) issues.push("candidate did not reduce generated output tokens");
  if (verificationCostDeltaUsd >= 0) issues.push("candidate did not reduce verification cost");
  return {
    policyId: "output-verification-promotion-v1",
    comparisonHash: `sha256:${createHash("sha256").update(JSON.stringify(complete)).digest("hex")}`,
    taskCount: complete.length,
    promotionEligible: issues.length === 0,
    issues,
    outputTokenDelta,
    verificationCostDeltaUsd,
  };
}

function validateObservation(observation: OutputVerificationObservation): void {
  requireText(observation.taskId, "Output verification task id is required.");
  requireText(observation.taskClass, "Output verification task class is required.");
  requireText(observation.verificationContractId, "Output verification contract id is required.");
  if (!Number.isSafeInteger(observation.outputTokens) || observation.outputTokens < 0) {
    throw new Error("Output verification tokens must be a non-negative safe integer.");
  }
  if (!Number.isFinite(observation.verificationCostUsd) || observation.verificationCostUsd < 0) {
    throw new Error("Output verification cost must be a non-negative finite number.");
  }
}

function requireText(value: string, message: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function requireMember<T extends string>(value: T, members: readonly T[], field: string): T {
  if (!members.includes(value)) throw new Error(`Unsupported ${field}: ${String(value)}`);
  return value;
}

function requireNormalized(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1.`);
}

function requireNormalizedValue(value: number, field: string): number {
  requireNormalized(value, field);
  return value;
}
