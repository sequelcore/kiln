import {
  decideExecutionRouteDataPolicy,
  type ExecutionCatalog,
  type ExecutionDataClassification,
  type ExecutionRouteDataPolicyEvidence,
  type ExecutionRouteDataPolicyDecision,
} from "@kilnai/core";

export interface ExecutionRouteDataPolicyIdentity {
  readonly routeId: string;
  readonly providerId: string;
  readonly providerModelId: string;
}

export interface SanitizedExecutionRouteDataPolicyEvidence {
  readonly providerId: string;
  readonly providerModelId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly sourceDigest: `sha256:${string}`;
  readonly trainingPosture: "prohibited" | "permitted";
  readonly retentionPosture: "zero" | "bounded";
  readonly retentionDays: number;
  readonly maximumClassification: ExecutionDataClassification;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface SanitizedExecutionRouteDataPolicyDecision {
  readonly decision: Pick<ExecutionRouteDataPolicyDecision, "status" | "freshness" | "reason">;
  readonly evidence?: SanitizedExecutionRouteDataPolicyEvidence;
}

export interface ExecutionTargetDataPolicyInput extends ExecutionRouteDataPolicyIdentity {
  readonly requestedClassification: ExecutionDataClassification;
  readonly evidence?: ExecutionRouteDataPolicyEvidence;
  readonly now?: Date;
}

/** Evaluates one physical target without requiring account-backed route fields. */
export function evaluateExecutionTargetDataPolicy(
  input: ExecutionTargetDataPolicyInput,
): SanitizedExecutionRouteDataPolicyDecision {
  const evaluated = decideExecutionRouteDataPolicy({
    evidence: input.evidence,
    providerId: input.providerId,
    providerModelId: input.providerModelId,
    requestedClassification: input.requestedClassification,
    now: input.now ?? new Date(),
  });
  const decision = { status: evaluated.status, freshness: evaluated.freshness, reason: evaluated.reason };
  if (!input.evidence) return Object.freeze({ decision: Object.freeze(decision) });
  const evidence = input.evidence;
  return Object.freeze({
    decision: Object.freeze(decision),
    evidence: Object.freeze({
      providerId: evidence.providerId,
      providerModelId: evidence.providerModelId,
      sourceIdentity: evidence.sourceIdentity,
      sourceRevision: evidence.sourceRevision,
      sourceDigest: evidence.sourceDigest,
      trainingPosture: evidence.trainingPosture,
      retentionPosture: evidence.retention.posture,
      retentionDays: evidence.retention.days,
      maximumClassification: evidence.permittedMaximumClassification,
      observedAt: evidence.observedAt,
      expiresAt: evidence.expiresAt,
    }),
  });
}

/** Runtime-owned fail-closed authority. Requested classification is read only from the admitted catalog route. */
export class ExecutionRouteDataPolicyAuthority {
  #catalog: ExecutionCatalog;
  readonly #now: () => Date;

  constructor(input: { readonly catalog: ExecutionCatalog; readonly now?: () => Date }) {
    this.#catalog = input.catalog;
    this.#now = input.now ?? (() => new Date());
  }

  updateCatalog(catalog: ExecutionCatalog): void {
    this.#catalog = catalog;
  }

  evaluate(identity: ExecutionRouteDataPolicyIdentity): SanitizedExecutionRouteDataPolicyDecision {
    const route = this.#catalog.routes.find(({ id }) => id === identity.routeId);
    return evaluateExecutionTargetDataPolicy({
      routeId: identity.routeId,
      evidence: route?.dataPolicyEvidence,
      providerId: identity.providerId,
      providerModelId: identity.providerModelId,
      requestedClassification: route?.dataClassification ?? "restricted",
      now: this.#now(),
    });
  }

  assertAdmitted(identity: ExecutionRouteDataPolicyIdentity): SanitizedExecutionRouteDataPolicyDecision {
    const result = this.evaluate(identity);
    if (result.decision.status === "denied") throw new ExecutionRouteDataPolicyDeniedError(result);
    return result;
  }
}

export class ExecutionRouteDataPolicyDeniedError extends Error {
  override readonly name = "ExecutionRouteDataPolicyDeniedError";
  constructor(readonly result: SanitizedExecutionRouteDataPolicyDecision) {
    super(`Execution route data policy denied execution: ${result.decision.reason}.`);
  }
}
