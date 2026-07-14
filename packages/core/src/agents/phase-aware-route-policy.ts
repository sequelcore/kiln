export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type ModelRoutingPhase = "orient" | "plan" | "execute" | "verify" | "handoff";
export type RouteHealthState = "healthy" | "degraded" | "cooldown" | "unknown";
export type ReasoningEffortSupportEvidence = "known" | "unknown";
export type UnsupportedReasoningEffortPolicy = "fail" | "omit";

export type ReasoningEffortOmissionReason =
  | "not-requested"
  | "capability-unknown"
  | "unsupported"
  | "xhigh-disabled"
  | "xhigh-not-promoted"
  | "budget-required"
  | "budget-exceeded";

export type NormalizedReasoningEffortResolution =
  | {
    readonly status: "resolved";
    readonly requested?: ReasoningEffort;
    readonly resolved: ReasoningEffort;
    readonly source: "explicit" | "policy" | "provider-default";
  }
  | {
    readonly status: "omitted";
    readonly requested?: ReasoningEffort;
    readonly reason: ReasoningEffortOmissionReason;
  };

export interface ResolveNormalizedReasoningEffortInput {
  readonly requested?: ReasoningEffort;
  readonly requestedSource?: "explicit" | "policy";
  readonly providerDefault?: ReasoningEffort;
  readonly supportEvidence: ReasoningEffortSupportEvidence;
  readonly supported?: readonly ReasoningEffort[];
  readonly unsupportedPolicy: UnsupportedReasoningEffortPolicy;
  readonly allowExperimentalXhigh?: boolean;
  readonly xhighPromotionEligible?: boolean;
  readonly purpose?: "production" | "benchmark";
  readonly budgetUsd?: number;
  readonly estimatedEffortCostUsd?: number;
}

export interface PhaseAwareRouteCandidate {
  readonly provider: string;
  readonly model: string;
  readonly configuredRank: number;
  readonly eligible: boolean;
  readonly health: RouteHealthState;
  readonly suitability: number;
  readonly quality: number;
  readonly supportsTools: boolean;
  readonly preferredPhases: readonly ModelRoutingPhase[];
  readonly verificationContractId: string;
  readonly supportedReasoningEfforts?: readonly ReasoningEffort[];
  readonly defaultReasoningEffort?: ReasoningEffort;
  readonly estimatedCostUsd: number;
  readonly estimatedEffortCostUsd?: number;
  readonly retryRisk: number;
  readonly cacheInvalidationCostUsd: number;
  readonly verifierCostUsd: number;
}

export interface PhaseAwareRoutingSignals {
  readonly taskClass: string;
  readonly phase: ModelRoutingPhase;
  readonly uncertainty: number;
  readonly toolNeed: number;
  readonly verificationNeed: number;
  readonly budgetUsd?: number;
}

export interface PhaseAwareRouteDiagnostic {
  readonly code:
    | "route-ineligible"
    | "route-unhealthy"
    | "tools-unsupported"
    | "verification-contract-mismatch"
    | "route-over-budget"
    | "reasoning-effort-omitted";
  readonly provider: string;
  readonly model: string;
  readonly message: string;
}

export interface PhaseAwareRouteProjection {
  readonly provider: string;
  readonly model: string;
  readonly score: number;
  readonly totalEstimatedCostUsd: number;
  readonly verificationContractId: string;
  readonly effortResolution: NormalizedReasoningEffortResolution;
}

export interface PhaseAwareRouteDecision {
  readonly policyId: "phase-aware-route-v1";
  readonly signals: PhaseAwareRoutingSignals;
  readonly selected?: PhaseAwareRouteProjection;
  readonly rankedRoutes: readonly PhaseAwareRouteProjection[];
  readonly escalationRoutes: readonly PhaseAwareRouteProjection[];
  readonly rollbackPolicyId: "static-configured-order-v1";
  readonly rollbackRoute?: PhaseAwareRouteProjection;
  readonly diagnostics: readonly PhaseAwareRouteDiagnostic[];
}

export interface SelectPhaseAwareRouteInput {
  readonly candidates: readonly PhaseAwareRouteCandidate[];
  readonly signals: PhaseAwareRoutingSignals;
  readonly requiredVerificationContractId: string;
  readonly requestedReasoningEffort?: ReasoningEffort;
  readonly effort: {
    readonly unsupportedPolicy: UnsupportedReasoningEffortPolicy;
    readonly allowExperimentalXhigh?: boolean;
    readonly xhighPromotionEligible?: boolean;
  };
}

export interface PhaseAwareModelRouterOptions {
  readonly candidates: readonly PhaseAwareRouteCandidate[];
  readonly requiredVerificationContractId: string;
  readonly effort: SelectPhaseAwareRouteInput["effort"];
  readonly mode?: "candidate" | "static-rollback";
}

export class PhaseAwareModelRouter implements ModelRouter {
  constructor(private readonly options: PhaseAwareModelRouterOptions) {}

  route(request: RoutingRequest): RoutingDecision {
    if (!request.task?.trim() || !request.phase
      || request.uncertainty === undefined || request.verificationNeed === undefined) {
      throw new Error("Phase-aware model routing requires task, phase, uncertainty, and verification need signals.");
    }
    const decision = selectPhaseAwareRoute({
      candidates: this.options.candidates,
      signals: {
        taskClass: request.task,
        phase: request.phase,
        uncertainty: request.uncertainty,
        toolNeed: request.hasTools ? 1 : 0,
        verificationNeed: request.verificationNeed,
        ...(request.budgetRemainingCents !== undefined
          ? { budgetUsd: request.budgetRemainingCents / 100 }
          : {}),
      },
      requiredVerificationContractId: this.options.requiredVerificationContractId,
      requestedReasoningEffort: request.requestedReasoningEffort,
      effort: this.options.effort,
    });
    const rollback = this.options.mode === "static-rollback";
    const selected = rollback ? decision.rollbackRoute : decision.selected;
    if (!selected) {
      throw new Error("Phase-aware model routing found no eligible route that preserves policy constraints.");
    }
    return {
      provider: selected.provider,
      model: selected.model,
      reasoning: rollback
        ? `Static rollback selected configured route ${selected.provider}/${selected.model}`
        : `Phase-aware policy selected ${selected.provider}/${selected.model}`,
      confidence: normalizedConfidence(selected.score),
      routingTier: rollback ? "default" : "cascade",
      estimatedCostUsd: selected.totalEstimatedCostUsd,
      ...(selected.effortResolution.status === "resolved"
        ? { reasoningEffort: selected.effortResolution.resolved }
        : {}),
    };
  }
}

export function resolveNormalizedReasoningEffort(
  input: ResolveNormalizedReasoningEffortInput,
): NormalizedReasoningEffortResolution {
  const desired = input.requested ?? input.providerDefault;
  if (!desired) return { status: "omitted", reason: "not-requested" };
  const requested = input.requested;
  if (input.supportEvidence === "unknown") {
    return omitted(requested, "capability-unknown", input.unsupportedPolicy, desired);
  }
  if (!input.supported?.includes(desired)) {
    return omitted(requested, "unsupported", input.unsupportedPolicy, desired);
  }
  if (desired === "xhigh") {
    if (!input.allowExperimentalXhigh) return omitted(requested, "xhigh-disabled", input.unsupportedPolicy, desired);
    if ((input.purpose ?? "production") === "production" && !input.xhighPromotionEligible) {
      return omitted(requested, "xhigh-not-promoted", input.unsupportedPolicy, desired);
    }
    if (input.purpose === "benchmark" && input.budgetUsd === undefined) {
      return omitted(requested, "budget-required", input.unsupportedPolicy, desired);
    }
  }
  if (input.budgetUsd !== undefined
    && (input.estimatedEffortCostUsd ?? 0) > input.budgetUsd) {
    return omitted(requested, "budget-exceeded", input.unsupportedPolicy, desired);
  }
  return {
    status: "resolved",
    ...(requested ? { requested } : {}),
    resolved: desired,
    source: requested ? input.requestedSource ?? "explicit" : "provider-default",
  };
}

export function selectPhaseAwareRoute(input: SelectPhaseAwareRouteInput): PhaseAwareRouteDecision {
  validateSignals(input.signals);
  const diagnostics: PhaseAwareRouteDiagnostic[] = [];
  const admitted: Array<{ readonly candidate: PhaseAwareRouteCandidate; readonly projection: PhaseAwareRouteProjection }> = [];

  for (const candidate of input.candidates) {
    validateCandidate(candidate);
    const diagnostic = exclusionDiagnostic(candidate, input);
    if (diagnostic) {
      diagnostics.push(diagnostic);
      continue;
    }
    const effortResolution = resolveNormalizedReasoningEffort({
      requested: input.requestedReasoningEffort,
      providerDefault: candidate.defaultReasoningEffort,
      supportEvidence: candidate.supportedReasoningEfforts ? "known" : "unknown",
      supported: candidate.supportedReasoningEfforts,
      unsupportedPolicy: input.effort.unsupportedPolicy,
      allowExperimentalXhigh: input.effort.allowExperimentalXhigh,
      xhighPromotionEligible: input.effort.xhighPromotionEligible,
      budgetUsd: input.signals.budgetUsd,
      estimatedEffortCostUsd: candidate.estimatedEffortCostUsd,
    });
    if (effortResolution.status === "omitted" && effortResolution.reason !== "not-requested") {
      diagnostics.push({
        code: "reasoning-effort-omitted",
        provider: candidate.provider,
        model: candidate.model,
        message: `Reasoning effort omitted: ${effortResolution.reason}`,
      });
    }
    const totalEstimatedCostUsd = routeCost(candidate);
    admitted.push({
      candidate,
      projection: {
        provider: candidate.provider,
        model: candidate.model,
        score: routeScore(candidate, input.signals, totalEstimatedCostUsd),
        totalEstimatedCostUsd,
        verificationContractId: candidate.verificationContractId,
        effortResolution,
      },
    });
  }

  const rankedRoutes = admitted
    .map((entry) => entry.projection)
    .sort((left, right) => right.score - left.score
      || routeKey(left).localeCompare(routeKey(right)));
  const rollbackRoute = admitted
    .sort((left, right) => left.candidate.configuredRank - right.candidate.configuredRank
      || routeKey(left.projection).localeCompare(routeKey(right.projection)))[0]?.projection;
  const selected = rankedRoutes[0];
  return {
    policyId: "phase-aware-route-v1",
    signals: input.signals,
    ...(selected ? { selected } : {}),
    rankedRoutes,
    escalationRoutes: selected ? rankedRoutes.slice(1) : [],
    rollbackPolicyId: "static-configured-order-v1",
    ...(rollbackRoute ? { rollbackRoute } : {}),
    diagnostics,
  };
}

function omitted(
  requested: ReasoningEffort | undefined,
  reason: ReasoningEffortOmissionReason,
  policy: UnsupportedReasoningEffortPolicy,
  desired: ReasoningEffort,
): NormalizedReasoningEffortResolution {
  if (policy === "fail") {
    throw new Error(`Requested reasoning effort '${desired}' is unsupported or unavailable: ${reason}`);
  }
  return { status: "omitted", ...(requested ? { requested } : {}), reason };
}

function exclusionDiagnostic(
  candidate: PhaseAwareRouteCandidate,
  input: SelectPhaseAwareRouteInput,
): PhaseAwareRouteDiagnostic | undefined {
  const identity = { provider: candidate.provider, model: candidate.model };
  if (!candidate.eligible) return { code: "route-ineligible", ...identity, message: "Canonical eligibility denied this route." };
  if (candidate.health === "cooldown" || candidate.health === "unknown") {
    return {
      code: "route-unhealthy",
      ...identity,
      message: candidate.health === "cooldown" ? "Route is in cooldown." : "Route health is unknown.",
    };
  }
  if (input.signals.toolNeed > 0 && !candidate.supportsTools) {
    return { code: "tools-unsupported", ...identity, message: "Task requires tools that this route does not support." };
  }
  if (input.signals.verificationNeed > 0
    && candidate.verificationContractId !== input.requiredVerificationContractId) {
    return { code: "verification-contract-mismatch", ...identity, message: "Route does not preserve the required verification contract." };
  }
  if (input.signals.budgetUsd !== undefined && routeCost(candidate) > input.signals.budgetUsd) {
    return { code: "route-over-budget", ...identity, message: "Projected route, retry, cache, and verifier cost exceeds budget." };
  }
  return undefined;
}

function routeScore(
  candidate: PhaseAwareRouteCandidate,
  signals: PhaseAwareRoutingSignals,
  totalCostUsd: number,
): number {
  const phaseMatch = candidate.preferredPhases.includes(signals.phase) ? 1 : 0;
  return (30 * candidate.suitability)
    + candidate.quality * ((25 * signals.uncertainty) + (25 * signals.verificationNeed))
    + (10 * phaseMatch)
    + (10 * signals.toolNeed * (candidate.supportsTools ? 1 : 0))
    - (100 * totalCostUsd)
    - (10 * candidate.retryRisk)
    - (candidate.health === "degraded" ? 5 : 0)
    - (0.01 * candidate.configuredRank);
}

function routeCost(candidate: PhaseAwareRouteCandidate): number {
  return candidate.estimatedCostUsd
    + (candidate.estimatedEffortCostUsd ?? 0)
    + candidate.cacheInvalidationCostUsd
    + candidate.verifierCostUsd;
}

function validateSignals(signals: PhaseAwareRoutingSignals): void {
  if (signals.taskClass.trim().length === 0) throw new Error("Phase-aware routing requires a task class.");
  for (const value of [signals.uncertainty, signals.toolNeed, signals.verificationNeed]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("Phase-aware route signals must be finite values between 0 and 1.");
    }
  }
  if (signals.budgetUsd !== undefined && (!Number.isFinite(signals.budgetUsd) || signals.budgetUsd < 0)) {
    throw new Error("Phase-aware route budget must be non-negative.");
  }
}

function validateCandidate(candidate: PhaseAwareRouteCandidate): void {
  if (!candidate.provider.trim() || !candidate.model.trim() || !candidate.verificationContractId.trim()) {
    throw new Error("Phase-aware route candidates require provider, model, and verification contract identity.");
  }
  for (const value of [candidate.suitability, candidate.quality, candidate.retryRisk]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("Phase-aware route candidate scores must be finite values between 0 and 1.");
    }
  }
  for (const value of [
    candidate.estimatedCostUsd,
    candidate.estimatedEffortCostUsd ?? 0,
    candidate.cacheInvalidationCostUsd,
    candidate.verifierCostUsd,
  ]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("Phase-aware route costs must be non-negative.");
  }
}

function routeKey(route: Pick<PhaseAwareRouteProjection, "provider" | "model">): string {
  return `${route.provider}/${route.model}`;
}

function normalizedConfidence(score: number): number {
  return Math.max(0, Math.min(1, score / 100));
}
import type {
  ModelRouter,
  RoutingDecision,
  RoutingRequest,
} from "../engine/domain/model-router.js";
