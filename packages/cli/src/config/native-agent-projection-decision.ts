import type { KilnAgentDefinition } from "../application/agent-loader.js";
import {
  encodeNativeAgentModel,
  type HarnessIntegrationId,
} from "./harness-integration-capabilities.js";

export type NativeAgentProjectionDecision =
  | {
    readonly kind: "project";
    readonly harness: HarnessIntegrationId;
    readonly nativeModel?: string;
  }
  | {
    readonly kind: "omit";
    readonly harness: HarnessIntegrationId;
    readonly reason: "unsupported-model" | "unsupported-provider";
  };

export interface DecideNativeAgentProjectionInput {
  readonly agent: KilnAgentDefinition;
  readonly harness: HarnessIntegrationId;
}

export function decideNativeAgentProjection(
  input: DecideNativeAgentProjectionInput,
): NativeAgentProjectionDecision {
  const { agent, harness } = input;
  if (!agent.providerRoute) {
    return { kind: "project", harness };
  }

  const model = agent.providerRoute.model?.trim();
  if (!model) {
    return { kind: "omit", harness, reason: "unsupported-model" };
  }

  const nativeModel = encodeNativeAgentModel(harness, agent.providerRoute.providerId, model);
  if (!nativeModel) {
    return { kind: "omit", harness, reason: "unsupported-provider" };
  }

  return { kind: "project", harness, nativeModel };
}
