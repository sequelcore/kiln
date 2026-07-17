import { z } from "zod";

/**
 * Wire projection for the canonical core contract. This runtime validator is
 * deliberately structural: gateway-contracts cannot depend on core because
 * it is published as a standalone boundary package. Contract tests keep its
 * serialization aligned with the core-owned semantic definition.
 */
export interface ContextUsageProjection {
  readonly state: "unavailable" | "partial" | "authoritative";
  readonly usedTokens?: number;
  readonly contextWindowTokens?: number;
  readonly remainingTokens?: number;
  readonly usedPercentage?: number;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly turnId?: string;
  readonly observedAt: string;
  readonly measurement: "provider_reported" | "runtime_estimate";
  readonly lifecycle: "streaming" | "completed" | "restored";
  readonly contextWindowAuthority: "provider_reported" | "runtime_observed" | "inferred" | "unknown";
  readonly freshness: "fresh" | "stale" | "historical" | "unknown";
  readonly reason?: string;
  readonly caveat?: "compacted" | "summarized" | "cache_semantics_unknown" | "usage_exceeds_window";
}

const nonNegativeInteger = z.number().int().nonnegative();

export const ContextUsageProjectionSchema: z.ZodType<ContextUsageProjection> = z.object({
  state: z.enum(["unavailable", "partial", "authoritative"]),
  usedTokens: nonNegativeInteger.optional(),
  contextWindowTokens: nonNegativeInteger.positive().optional(),
  remainingTokens: nonNegativeInteger.optional(),
  usedPercentage: z.number().min(0).max(100).optional(),
  providerId: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
  turnId: z.string().trim().min(1).optional(),
  observedAt: z.string().datetime({ offset: true }),
  measurement: z.enum(["provider_reported", "runtime_estimate"]),
  lifecycle: z.enum(["streaming", "completed", "restored"]),
  contextWindowAuthority: z.enum(["provider_reported", "runtime_observed", "inferred", "unknown"]),
  freshness: z.enum(["fresh", "stale", "historical", "unknown"]),
  reason: z.string().trim().min(1).optional(),
  caveat: z.enum(["compacted", "summarized", "cache_semantics_unknown", "usage_exceeds_window"]).optional(),
}).superRefine((value, ctx) => {
  const hasRatio = value.usedTokens !== undefined || value.contextWindowTokens !== undefined
    || value.remainingTokens !== undefined || value.usedPercentage !== undefined;
  if (value.state === "authoritative" && (!value.usedTokens && value.usedTokens !== 0 || !value.contextWindowTokens || value.remainingTokens === undefined || value.usedPercentage === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Authoritative context usage requires a complete ratio." });
  }
  if (value.state === "authoritative") {
    const lifecycleAllowsAuthority = value.lifecycle === "completed"
      ? value.freshness === "fresh"
      : value.lifecycle === "restored" && value.freshness === "historical";
    if (
      value.measurement !== "provider_reported"
      || value.contextWindowAuthority !== "provider_reported"
      || !lifecycleAllowsAuthority
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Authoritative context usage requires completed provider-reported evidence and an authoritative compatible window." });
    }
  }
  if (value.state === "unavailable" && hasRatio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unavailable context usage cannot expose a ratio." });
  }
  if (value.usedPercentage !== undefined) {
    if (value.usedTokens === undefined || !value.contextWindowTokens || value.remainingTokens === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A percentage requires used, window, and remaining tokens." });
    } else {
      const expectedRemaining = Math.max(0, value.contextWindowTokens - value.usedTokens);
      const expectedPercentage = Math.min(100, (value.usedTokens / value.contextWindowTokens) * 100);
      if (value.remainingTokens !== expectedRemaining || Math.abs(value.usedPercentage - expectedPercentage) > 0.000001) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Context ratio values must agree." });
      }
    }
  }
  if (value.lifecycle === "restored" && value.freshness !== "historical") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Restored context usage must be historical." });
  }
});

function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k` : String(tokens);
}

export function formatContextUsageProjection(projection: ContextUsageProjection): string {
  if (projection.state === "unavailable") return "Context usage unavailable";
  if (projection.usedTokens === undefined) return "Context partial";
  if (projection.usedPercentage === undefined || projection.contextWindowTokens === undefined) {
    return `Context partial: ${formatTokens(projection.usedTokens)} tokens`;
  }
  const qualifier = projection.state === "partial" ? "partial " : "";
  return `Context ${qualifier}${Math.round(projection.usedPercentage)}%: ${formatTokens(projection.usedTokens)} / ${formatTokens(projection.contextWindowTokens)} tokens`;
}
