import { randomUUID } from "node:crypto";

declare const REPLAY_KEY: unique symbol;
declare const REPLAY_FENCE: unique symbol;

/** Opaque replay vocabulary; construction, hashing, and durable storage stay with ingress adapters. */
export type ModelGatewayReplayKey = string & { readonly [REPLAY_KEY]: "ModelGatewayReplayKey" };
export type ModelGatewayReplayFence = string & { readonly [REPLAY_FENCE]: "ModelGatewayReplayFence" };

export type ModelGatewayReplayClaim<T> =
  | { readonly phase: "claimed"; readonly fence: ModelGatewayReplayFence; readonly attemptId: string }
  | { readonly phase: "admitted"; readonly fence: ModelGatewayReplayFence; readonly attemptId: string; readonly admissionId: `sha256:${string}` }
  | { readonly phase: "committed"; readonly fence: ModelGatewayReplayFence; readonly attemptId: string; readonly admissionId: `sha256:${string}`; readonly effectIdentity: string }
  | { readonly phase: "committed-unknown"; readonly fence: ModelGatewayReplayFence; readonly attemptId: string; readonly admissionId: `sha256:${string}`; readonly effectIdentity: string }
  | { readonly phase: "completed"; readonly fence: ModelGatewayReplayFence; readonly attemptId: string; readonly admissionId: `sha256:${string}`; readonly effectIdentity: string; readonly value: T };

export function createModelGatewayReplayClaim<T>(fence: ModelGatewayReplayFence, attemptId = `attempt-${randomUUID()}`): ModelGatewayReplayClaim<T> {
  return { phase: "claimed", fence, attemptId };
}

export function persistModelGatewayReplayAdmission<T>(claim: ModelGatewayReplayClaim<T>, fence: ModelGatewayReplayFence, admissionId: `sha256:${string}`): ModelGatewayReplayClaim<T> {
  requireFence(claim, fence);
  if (claim.phase !== "claimed") throw new Error("Replay claim cannot be committed from its current phase.");
  return { phase: "admitted", fence, attemptId: claim.attemptId, admissionId };
}

export function claimModelGatewayReplayAction<T>(claim: ModelGatewayReplayClaim<T>, fence: ModelGatewayReplayFence, input: { readonly admissionId: `sha256:${string}`; readonly effectIdentity: string }): ModelGatewayReplayClaim<T> {
  requireFence(claim, fence);
  if (claim.phase !== "admitted") throw new Error("Replay action cannot be claimed from its current phase.");
  if (claim.admissionId !== input.admissionId) throw new Error("Replay action admission identity conflicts with the persisted admission.");
  if (!input.effectIdentity) throw new Error("Replay action effect identity is required.");
  return { phase: "committed", fence, attemptId: claim.attemptId, admissionId: claim.admissionId, effectIdentity: input.effectIdentity };
}

export function settleModelGatewayReplayClaimUnknown<T>(claim: ModelGatewayReplayClaim<T>, fence: ModelGatewayReplayFence): ModelGatewayReplayClaim<T> {
  requireFence(claim, fence);
  if (claim.phase !== "committed") throw new Error("Only an active committed replay claim can settle unknown.");
  return { phase: "committed-unknown", fence, attemptId: claim.attemptId, admissionId: claim.admissionId, effectIdentity: claim.effectIdentity };
}

export function completeModelGatewayReplayClaim<T>(claim: ModelGatewayReplayClaim<T>, fence: ModelGatewayReplayFence, value: T): ModelGatewayReplayClaim<T> {
  requireFence(claim, fence);
  if (claim.phase !== "committed") throw new Error("Replay claim cannot be completed from its current phase.");
  return { phase: "completed", fence, attemptId: claim.attemptId, admissionId: claim.admissionId, effectIdentity: claim.effectIdentity, value };
}

/** Predispatch abandonment removes the claim; committed work cannot be abandoned. */
export function abandonModelGatewayReplayClaim<T>(claim: ModelGatewayReplayClaim<T>, fence: ModelGatewayReplayFence): undefined {
  requireFence(claim, fence);
  if (claim.phase !== "claimed" && claim.phase !== "admitted") throw new Error("Only a predispatch replay claim can be abandoned.");
  return undefined;
}

function requireFence<T>(claim: ModelGatewayReplayClaim<T>, fence: ModelGatewayReplayFence): void {
  if (claim.fence !== fence) throw new Error("Stale replay fence.");
}
