import type { ModelGatewayRoute, ModelTurn, ModelTurnResult } from "@kilnai/core";
import {
  GovernedOneRoundInvocationError,
  type GovernedOneRoundAffinityPolicy,
  type GovernedOneRoundAuthorityEvidence,
  type GovernedOneRoundBudgetEvidence,
  type GovernedOneRoundInvocationPorts,
  invokeGovernedOneRound,
} from "./governed-one-round-invocation.js";
import type { ModelGatewayReplayDecision, ModelGatewayReplayGuard } from "./replay-guard.js";

/** Protocol-neutral compatibility evidence retained by the model-gateway authority. */
export type ModelGatewayIngressId = "openai-responses" | "anthropic-messages";

export interface ModelGatewayCompatibilityEvidence {
  readonly protocol: ModelGatewayIngressId;
  readonly stage: "request" | "response";
  readonly status: "compatible" | "degraded" | "rejected";
  readonly tenantId: string;
  readonly applicationId: string;
  readonly callerId: string;
  readonly requestedModel: string;
  readonly route: ModelGatewayRoute;
  readonly required: readonly string[];
  readonly optionalRequested: readonly string[];
  readonly unavailableOptional: readonly string[];
  readonly rejectedCapability?: string;
  readonly omissionCodes?: readonly string[];
}

export class GovernedIngressCommittedExecutionError extends Error {
  readonly code = "committed-execution-failure" as const;
  constructor(cause?: unknown) {
    super("The committed response could not be finalized.", { cause });
  }
}

export type GovernedIngressExecution<T> =
  | { readonly kind: "success"; readonly value: T; readonly replayed: boolean }
  | { readonly kind: "join-inflight"; readonly retryAfterSeconds: number }
  | { readonly kind: "committed-unknown" };

export interface GovernedIngressExecutorInput<T> {
  readonly protocol: ModelGatewayIngressId;
  readonly rawBody: string;
  readonly identity: { readonly tenantId: string; readonly applicationId: string; readonly callerId: string; readonly sessionId: string; readonly turnId: string };
  readonly route: ModelGatewayRoute;
  readonly affinity: GovernedOneRoundAffinityPolicy;
  readonly authority: GovernedOneRoundAuthorityEvidence;
  readonly budget: GovernedOneRoundBudgetEvidence;
  readonly toolExecutionMode: "caller-owned";
  readonly turn: ModelTurn;
  readonly signal: AbortSignal;
  readonly invocationPorts: GovernedOneRoundInvocationPorts;
  readonly createAttemptId: () => string;
  readonly createResponseId: () => string;
  readonly replayGuard?: ModelGatewayReplayGuard;
  readonly projectSuccess: (input: { readonly responseId: string; readonly result: ModelTurnResult; readonly replayed: boolean }) => T;
}

/**
 * Owns the irreversible replay/dispatch transition for every native ingress.
 * Protocol adapters only authenticate, normalize, and project its result.
 */
export async function executeGovernedIngress<T>(input: GovernedIngressExecutorInput<T>): Promise<GovernedIngressExecution<T>> {
  let dispatch: Extract<ModelGatewayReplayDecision, { kind: "dispatch" }> | undefined;
  let commitAttempted = false;
  let dispatched = false;
  try {
    if (input.replayGuard !== undefined) {
      const key = input.replayGuard.fingerprint({
        rawBody: input.rawBody,
        ingress: input.protocol,
        tenantId: input.identity.tenantId,
        applicationId: input.identity.applicationId,
        callerId: input.identity.callerId,
        sessionId: input.identity.sessionId,
        turnId: input.identity.turnId,
        route: input.route,
        toolExecutionMode: input.toolExecutionMode,
        ...(input.affinity.continuity === "none" ? {} : { affinityKey: input.affinity.key }),
      });
      const decision = input.replayGuard.claim(key);
      if (decision.kind === "join-inflight") return decision;
      if (decision.kind === "committed-unknown") return decision;
      if (decision.kind === "replay-completed") {
        return { kind: "success", value: input.projectSuccess({ responseId: decision.value.responseId, result: decision.value.result, replayed: true }), replayed: true };
      }
      dispatch = decision;
    }

    if (input.signal.aborted) throw new GovernedOneRoundInvocationError("aborted", "Request aborted.");
    const responseId = input.createResponseId();
    const result = await invokeGovernedOneRound({
      attemptId: input.createAttemptId(), identity: input.identity, route: input.route,
      authority: input.authority, budget: input.budget, affinity: input.affinity,
      toolExecutionMode: input.toolExecutionMode, turn: input.turn, signal: input.signal,
      ...(dispatch === undefined ? {} : { lifecycle: { afterCommittedBeforeDispatch: () => {
        commitAttempted = true;
        input.replayGuard!.markCommitted(dispatch!.key, dispatch!.fence);
      } } }),
    }, input.invocationPorts);
    dispatched = true;
    let value: T;
    try {
      value = input.projectSuccess({ responseId, result: result.result, replayed: false });
      if (dispatch !== undefined) input.replayGuard!.complete(dispatch.key, dispatch.fence, { result: result.result, responseId });
    } catch (error) {
      throw new GovernedIngressCommittedExecutionError(error);
    }
    return { kind: "success", value, replayed: false };
  } catch (error) {
    if (dispatch !== undefined) {
      try {
        if (commitAttempted) input.replayGuard!.settleUnknown(dispatch.key, dispatch.fence);
        else input.replayGuard!.abandon(dispatch.key, dispatch.fence);
      } catch { /* stale/incompatible transitions preserve their conservative state */ }
    }
    if (dispatched && !(error instanceof GovernedIngressCommittedExecutionError)) {
      throw new GovernedIngressCommittedExecutionError(error);
    }
    throw error;
  }
}
