import {
  decideExecutionTargetDataPolicy,
  type ExecutionTargetCatalog,
  type ExecutionDataClassification,
  type ExecutionTargetDataPolicyEvidence,
  type ExecutionTargetDataPolicyDecision,
} from "@kilnai/core";

export interface ExecutionTargetDataPolicyIdentity {
  readonly targetId: string;
  readonly providerId: string;
  readonly providerModelId: string;
}

export interface SanitizedExecutionTargetDataPolicyEvidence {
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

export interface SanitizedExecutionTargetDataPolicyDecision {
  readonly decision: Pick<ExecutionTargetDataPolicyDecision, "status" | "freshness" | "reason">;
  readonly evidence?: SanitizedExecutionTargetDataPolicyEvidence;
}

export interface ExecutionTargetDataPolicyInput extends ExecutionTargetDataPolicyIdentity {
  readonly requestedClassification: ExecutionDataClassification;
  readonly evidence?: ExecutionTargetDataPolicyEvidence;
  readonly now?: Date;
}

/** Evaluates one physical target without requiring account-backed route fields. */
export function evaluateExecutionTargetDataPolicy(
  input: ExecutionTargetDataPolicyInput,
): SanitizedExecutionTargetDataPolicyDecision {
  const evaluated = decideExecutionTargetDataPolicy({
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

/** Runtime-owned fail-closed authority. Requested classification is read only from the admitted catalog target. */
export class ExecutionTargetDataPolicyAuthority {
  #catalog: ExecutionTargetCatalog;
  readonly #now: () => Date;

  constructor(input: { readonly catalog: ExecutionTargetCatalog; readonly now?: () => Date }) {
    this.#catalog = input.catalog;
    this.#now = input.now ?? (() => new Date());
  }

  updateCatalog(catalog: ExecutionTargetCatalog): void {
    this.#catalog = catalog;
  }

  evaluate(identity: ExecutionTargetDataPolicyIdentity): SanitizedExecutionTargetDataPolicyDecision {
    const target = this.#catalog.targets.find(({ id }) => id === identity.targetId);
    return evaluateExecutionTargetDataPolicy({
      targetId: identity.targetId,
      evidence: target?.dataPolicyEvidence,
      providerId: identity.providerId,
      providerModelId: identity.providerModelId,
      requestedClassification: target?.dataClassification ?? "restricted",
      now: this.#now(),
    });
  }

  assertAdmitted(identity: ExecutionTargetDataPolicyIdentity): SanitizedExecutionTargetDataPolicyDecision {
    const result = this.evaluate(identity);
    if (result.decision.status === "denied") throw new ExecutionTargetDataPolicyDeniedError(result);
    return result;
  }
}

export class ExecutionTargetDataPolicyDeniedError extends Error {
  override readonly name = "ExecutionTargetDataPolicyDeniedError";
  constructor(readonly result: SanitizedExecutionTargetDataPolicyDecision) {
    super(`Execution target data policy denied execution: ${result.decision.reason}.`);
  }
}
