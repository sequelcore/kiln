import type { ProviderModelRouteIdentity } from "../provider-model-evidence.js";
import type { ExecutionAccountRef } from "./account-identity.js";
import type { ModelTurn, ModelTurnResult } from "./model-turn.js";

/** Secret-free, protocol-neutral request for exactly one model-provider round. */
export interface OneRoundModelDispatchInput {
  readonly account: ExecutionAccountRef;
  readonly route: ProviderModelRouteIdentity;
  readonly sessionId: string;
  readonly turn: ModelTurn;
  readonly signal?: AbortSignal;
}

/** Adapter boundary for one provider round. Implementations must not retry. */
export interface OneRoundModelDispatcher {
  dispatchOneRound(input: OneRoundModelDispatchInput): Promise<ModelTurnResult>;
}
