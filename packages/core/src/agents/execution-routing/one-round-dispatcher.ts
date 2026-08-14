import type { ProviderModelRouteIdentity } from "../provider-model-evidence.js";
import type { ExecutionAccountRef } from "./account-identity.js";
import {
  validateModelTurn,
  validateModelTurnResultAgainstTools,
  type ModelTurn,
  type ModelTurnResult,
} from "./model-turn.js";

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

/** Validates before and after the sole dispatcher call. */
export async function dispatchOneModelRound(
  dispatcher: OneRoundModelDispatcher,
  input: OneRoundModelDispatchInput,
): Promise<ModelTurnResult> {
  requireIdentifier(input.sessionId, "sessionId");
  validateModelTurn(input.turn);
  const result = await dispatcher.dispatchOneRound(input);
  validateModelTurnResultAgainstTools(result, input.turn.tools ?? []);
  return result;
}

function requireIdentifier(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value !== value.trim()) {
    throw new TypeError(`${path} must be a non-empty canonical identifier of at most 256 characters.`);
  }
}
