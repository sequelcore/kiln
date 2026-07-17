import type { VerifiedEfficiencyEvidenceProjection as CanonicalVerifiedEfficiencyEvidenceProjection } from "@kilnai/core";
import {
  VerifiedEfficiencyEvidenceProjectionSchema,
  type VerifiedEfficiencyEvidenceProjection as GatewayVerifiedEfficiencyEvidenceProjection,
} from "@kilnai/gateway-contracts";

/**
 * Sole transport boundary from Core efficiency semantics to the standalone
 * gateway DTO. Surfaces consume this validated object and never recompute it.
 */
export function toGatewayVerifiedEfficiencyEvidence(
  projection: CanonicalVerifiedEfficiencyEvidenceProjection,
): GatewayVerifiedEfficiencyEvidenceProjection {
  return VerifiedEfficiencyEvidenceProjectionSchema.parse(projection);
}
