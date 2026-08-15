import type {
  RouteAdmissionDecision,
  RouteAdmissionRejection,
} from "@kilnai/core";
import type { KilnAgentDefinition } from "../application/agent-loader.js";
import {
  encodeNativeAgentModel,
  type HarnessIntegrationId,
} from "./harness-integration-capabilities.js";

export type NativeProjectionUnavailableReason =
  | {
    readonly kind: "route-admission";
    readonly reasons: readonly RouteAdmissionRejection[];
  }
  | {
    readonly kind: "transport";
    readonly code: "missing-model" | "native-encoder-unavailable";
  };

export type NativeAgentProjectionDecision =
  | {
    readonly kind: "project";
    readonly harness: HarnessIntegrationId;
    readonly admission?: RouteAdmissionDecision;
    readonly nativeModel?: string;
  }
  | {
    readonly kind: "unavailable" | "unresolved";
    readonly harness: HarnessIntegrationId;
    readonly admission: RouteAdmissionDecision;
    readonly reason: NativeProjectionUnavailableReason;
  };

export interface DecideNativeAgentProjectionInput {
  readonly agent: KilnAgentDefinition;
  readonly harness: HarnessIntegrationId;
  /** Canonical admission is supplied by managed route resolution, never inferred from a harness. */
  readonly admission?: RouteAdmissionDecision;
}

function unresolvedAdmission(agent: KilnAgentDefinition): RouteAdmissionDecision {
  return {
    status: "unresolved",
    routeId: agent.targetId ?? "unresolved",
    reasons: [{ code: "proof-unknown" }],
  };
}

export function decideNativeAgentProjection(
  input: DecideNativeAgentProjectionInput,
): NativeAgentProjectionDecision {
  const { agent, harness } = input;
  if (!agent.targetId) {
    return { kind: "project", harness };
  }

  const admission = input.admission ?? unresolvedAdmission(agent);
  if (admission.status === "admitted" && admission.route.identity.routeId !== agent.targetId) {
    const mismatch: RouteAdmissionDecision = {
      status: "unresolved",
      routeId: agent.targetId,
      reasons: [{ code: "proof-unknown" }],
    };
    return { kind: "unresolved", harness, admission: mismatch, reason: { kind: "route-admission", reasons: mismatch.reasons } };
  }
  if (admission.status === "admitted" && admission.route.capacity.kind !== "accountless") {
    const unavailable: RouteAdmissionDecision = {
      status: "unavailable",
      routeId: admission.route.identity.routeId,
      reasons: [{ code: "capacity-policy-mismatch" }],
    };
    return { kind: "unavailable", harness, admission: unavailable, reason: { kind: "route-admission", reasons: unavailable.reasons } };
  }
  if (admission.status !== "admitted") {
    return {
      kind: admission.status,
      harness,
      admission,
      reason: { kind: "route-admission", reasons: admission.reasons },
    };
  }

  const model = admission.route.target.modelId.trim();
  if (!model) {
    return {
      kind: "unavailable",
      harness,
      admission,
      reason: { kind: "transport", code: "missing-model" },
    };
  }
  const nativeModel = encodeNativeAgentModel(harness, admission.route.target.providerId, model);
  if (!nativeModel) {
    return {
      kind: "unavailable",
      harness,
      admission,
      reason: { kind: "transport", code: "native-encoder-unavailable" },
    };
  }
  return { kind: "project", harness, admission, nativeModel };
}
