import {
  decideExecutionRouteDataPolicy,
  type ExecutionCatalog,
  type ExecutionDataClassification,
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
    const evaluated = decideExecutionRouteDataPolicy({
      evidence: route?.dataPolicyEvidence,
      providerId: identity.providerId,
      providerModelId: identity.providerModelId,
      requestedClassification: route?.dataClassification ?? "restricted",
      now: this.#now(),
    });
    const decision = { status: evaluated.status, freshness: evaluated.freshness, reason: evaluated.reason };
    if (!route?.dataPolicyEvidence) return Object.freeze({ decision: Object.freeze(decision) });
    const evidence = route.dataPolicyEvidence;
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
