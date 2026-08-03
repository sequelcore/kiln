import {
  resolveDeliberation,
  type DeliberationIntent,
  type DeliberationResolution,
  type DeliberationSource,
  type ModelDeliberationCapabilities,
} from "./deliberation-policy.js";

export type ModelRoutingPhase = "orient" | "plan" | "execute" | "verify" | "handoff";
export type RouteHealthState = "healthy" | "degraded" | "cooldown" | "unknown";

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
  readonly deliberationCapabilities?: ModelDeliberationCapabilities;
  readonly estimatedCostUsd: number;
  readonly estimatedDeliberationCostUsd?: number;
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
    | "deliberation-unresolved";
  readonly provider: string;
  readonly model: string;
  readonly message: string;
  readonly deliberationResolution?: DeliberationResolution;
}

export interface PhaseAwareRouteProjection {
  readonly provider: string;
  readonly model: string;
  readonly score: number;
  readonly totalEstimatedCostUsd: number;
  readonly verificationContractId: string;
  readonly deliberationResolution: DeliberationResolution;
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
  readonly deliberation?: {
    readonly intent: DeliberationIntent;
    readonly source: Exclude<DeliberationSource, "provider-default">;
  };
}

export interface PhaseAwareModelRouterOptions {
  readonly candidates: readonly PhaseAwareRouteCandidate[];
  readonly requiredVerificationContractId: string;
  readonly deliberation?: SelectPhaseAwareRouteInput["deliberation"];
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
      deliberation: request.deliberationIntent
        ? {
            intent: request.deliberationIntent,
            source: request.deliberationSource ?? "operator",
          }
        : this.options.deliberation,
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
      deliberationResolution: selected.deliberationResolution,
    };
  }
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
    const deliberationResolution = input.deliberation
      ? resolveDeliberation({
          ...input.deliberation,
          capabilities: candidate.deliberationCapabilities,
        })
      : resolveDeliberation({});
    if (deliberationResolution.status === "denied") {
      diagnostics.push({
        code: "deliberation-unresolved",
        provider: candidate.provider,
        model: candidate.model,
        message: `Deliberation denied: ${deliberationResolution.reason}`,
        deliberationResolution,
      });
      continue;
    }
    if (deliberationResolution.status === "omitted" && deliberationResolution.reason !== "not-requested") {
      diagnostics.push({
        code: "deliberation-unresolved",
        provider: candidate.provider,
        model: candidate.model,
        message: `Deliberation omitted: ${deliberationResolution.reason}`,
        deliberationResolution,
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
        deliberationResolution,
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
    + (candidate.estimatedDeliberationCostUsd ?? 0)
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
  if (candidate.deliberationCapabilities
    && (candidate.deliberationCapabilities.provider !== candidate.provider
      || candidate.deliberationCapabilities.model !== candidate.model)) {
    throw new Error("Phase-aware route deliberation capabilities must match the candidate provider and model.");
  }
  for (const value of [
    candidate.estimatedCostUsd,
    candidate.estimatedDeliberationCostUsd ?? 0,
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
