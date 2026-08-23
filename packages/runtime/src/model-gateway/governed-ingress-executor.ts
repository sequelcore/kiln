import type { ProviderModelRouteIdentity, ModelTurn, ModelTurnResult } from "@kilnai/core";
import {
  GovernedOneRoundInvocationError,
  type GovernedOneRoundAffinityPolicy,
  type GovernedOneRoundAuthorityEvidence,
  type GovernedOneRoundBudgetEvidence,
  type GovernedOneRoundInvocationPorts,
  invokeGovernedOneRound,
} from "../execution-kernel/governed-one-round-invocation.js";
import type { ModelGatewayReplayDecision, ModelGatewayReplayGuard } from "./replay-guard.js";
import type { EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";

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
  readonly route: ProviderModelRouteIdentity & { readonly routeId: string };
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

/** Base runtime ports; the executor binds the durable per-attempt claim ports. */
export type GovernedIngressInvocationPorts = Omit<GovernedOneRoundInvocationPorts, "admissionEvidence" | "dispatchClaim">;

export interface GovernedIngressExecutorInput<T> {
  readonly protocol: ModelGatewayIngressId;
  readonly rawBody: string;
  readonly identity: { readonly tenantId: string; readonly applicationId: string; readonly callerId: string; readonly sessionId: string; readonly turnId: string };
  readonly route: ProviderModelRouteIdentity & { readonly routeId: string };
  readonly affinity: GovernedOneRoundAffinityPolicy;
  readonly authority: GovernedOneRoundAuthorityEvidence;
  readonly budget: GovernedOneRoundBudgetEvidence;
  readonly toolExecutionMode: "caller-owned";
  readonly turn: ModelTurn;
  readonly signal: AbortSignal;
  readonly invocationPorts: GovernedIngressInvocationPorts;
  readonly createResponseId: () => string;
  readonly replayGuard: ModelGatewayReplayGuard;
  readonly projectSuccess: (input: { readonly responseId: string; readonly result: ModelTurnResult; readonly replayed: boolean }) => T;
}

/**
 * Owns the irreversible replay/dispatch transition for every native ingress.
 * Protocol adapters only authenticate, normalize, and project its result.
 */
export async function executeGovernedIngress<T>(input: GovernedIngressExecutorInput<T>): Promise<GovernedIngressExecution<T>> {
  let dispatch: Extract<ModelGatewayReplayDecision, { kind: "dispatch" }> | undefined;
  let actionClaimed = false;
  let dispatched = false;
  try {
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

    if (input.signal.aborted) throw new GovernedOneRoundInvocationError("aborted", "Request aborted.");
    const responseId = input.createResponseId();
    const invocationPorts: GovernedOneRoundInvocationPorts = {
      ...input.invocationPorts,
      admissionEvidence: {
        persistAndReadback: (bundle: EffectiveAuthorityAdmissionBundle) =>
          input.replayGuard.persistAdmission(dispatch!.key, dispatch!.fence, bundle),
      },
      dispatchClaim: {
        claim: (claim: { readonly admissionId: `sha256:${string}`; readonly effectIdentity: string }) => {
          const permit = input.replayGuard.claimAction(dispatch!.key, dispatch!.fence, claim);
          actionClaimed = true;
          return permit;
        },
      },
    };
    const result = await invokeGovernedOneRound({
      attemptId: dispatch.attemptId, identity: input.identity, route: input.route,
      authority: input.authority, budget: input.budget, affinity: input.affinity,
      toolExecutionMode: input.toolExecutionMode, turn: input.turn, signal: input.signal,
    }, invocationPorts);
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
        if (actionClaimed) input.replayGuard.settleUnknown(dispatch.key, dispatch.fence);
        else input.replayGuard.abandon(dispatch.key, dispatch.fence);
      } catch { /* stale/incompatible transitions preserve their conservative state */ }
    }
    if (dispatched && !(error instanceof GovernedIngressCommittedExecutionError)) {
      throw new GovernedIngressCommittedExecutionError(error);
    }
    throw error;
  }
}
