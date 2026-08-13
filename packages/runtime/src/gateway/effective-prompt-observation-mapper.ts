import type { EffectivePromptObservation as CanonicalEffectivePromptObservation } from "@kilnai/core";
import {
  EffectivePromptObservationSchema,
  type EffectivePromptObservation as GatewayEffectivePromptObservation,
} from "@kilnai/gateway-contracts";

/** Validates the content-free Core observation at the standalone wire boundary. */
export function toGatewayEffectivePromptObservation(
  observation: CanonicalEffectivePromptObservation,
): GatewayEffectivePromptObservation {
  return EffectivePromptObservationSchema.parse(observation);
}
