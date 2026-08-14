declare const REPLAY_KEY: unique symbol;
declare const REPLAY_FENCE: unique symbol;

/** Opaque replay vocabulary; construction, hashing, and durable storage stay with ingress adapters. */
export type ModelGatewayReplayKey = string & { readonly [REPLAY_KEY]: "ModelGatewayReplayKey" };
export type ModelGatewayReplayFence = string & { readonly [REPLAY_FENCE]: "ModelGatewayReplayFence" };

export type ModelGatewayReplayClaim<T> =
  | { readonly phase: "claimed"; readonly fence: ModelGatewayReplayFence }
  | { readonly phase: "committed"; readonly fence: ModelGatewayReplayFence }
  | { readonly phase: "committed-unknown"; readonly fence: ModelGatewayReplayFence }
  | { readonly phase: "completed"; readonly fence: ModelGatewayReplayFence; readonly value: T };

export function createModelGatewayReplayClaim<T>(fence: ModelGatewayReplayFence): ModelGatewayReplayClaim<T> {
  return { phase: "claimed", fence };
}

export function commitModelGatewayReplayClaim<T>(claim: ModelGatewayReplayClaim<T>, fence: ModelGatewayReplayFence): ModelGatewayReplayClaim<T> {
  requireFence(claim, fence);
  if (claim.phase !== "claimed") throw new Error("Replay claim cannot be committed from its current phase.");
  return { phase: "committed", fence };
}

export function settleModelGatewayReplayClaimUnknown<T>(claim: ModelGatewayReplayClaim<T>, fence: ModelGatewayReplayFence): ModelGatewayReplayClaim<T> {
  requireFence(claim, fence);
  if (claim.phase !== "committed") throw new Error("Only an active committed replay claim can settle unknown.");
  return { phase: "committed-unknown", fence };
}

export function completeModelGatewayReplayClaim<T>(claim: ModelGatewayReplayClaim<T>, fence: ModelGatewayReplayFence, value: T): ModelGatewayReplayClaim<T> {
  requireFence(claim, fence);
  if (claim.phase !== "committed") throw new Error("Replay claim cannot be completed from its current phase.");
  return { phase: "completed", fence, value };
}

/** Predispatch abandonment removes the claim; committed work cannot be abandoned. */
export function abandonModelGatewayReplayClaim<T>(claim: ModelGatewayReplayClaim<T>, fence: ModelGatewayReplayFence): undefined {
  requireFence(claim, fence);
  if (claim.phase !== "claimed") throw new Error("Only a predispatch replay claim can be abandoned.");
  return undefined;
}

function requireFence<T>(claim: ModelGatewayReplayClaim<T>, fence: ModelGatewayReplayFence): void {
  if (claim.fence !== fence) throw new Error("Stale replay fence.");
}
