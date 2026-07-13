import type { ContextUsageProjection as CanonicalContextUsageProjection } from "@kilnai/core";
import {
  ContextUsageProjectionSchema,
  type ContextUsageProjection as GatewayContextUsageProjection,
} from "@kilnai/gateway-contracts";

/**
 * The sole runtime transport boundary between the Core semantic projection and
 * the standalone Gateway wire DTO. Gateway contracts intentionally do not
 * depend on Core, so this adapter validates parity at the boundary.
 */
export function toGatewayContextUsageProjection(
  projection: CanonicalContextUsageProjection,
): GatewayContextUsageProjection {
  return ContextUsageProjectionSchema.parse(projection);
}

/**
 * Restored evidence retains its measurement and ratio, but must never present
 * as current or fresher than when it was persisted.
 */
export function restoreGatewayContextUsageProjection(
  value: unknown,
): GatewayContextUsageProjection | null {
  const parsed = ContextUsageProjectionSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return toGatewayContextUsageProjection({
    ...parsed.data,
    lifecycle: "restored",
    freshness: "historical",
  });
}
