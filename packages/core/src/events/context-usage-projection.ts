/**
 * A provider-neutral observation of the prompt context used by one Kiln turn.
 *
 * This deliberately does not represent cumulative billing or transcript size.
 * The runtime owns normalization; operator surfaces only project this evidence.
 */
export type ContextUsageState = "unavailable" | "partial" | "authoritative";
export type ContextUsageMeasurement = "provider_reported" | "runtime_estimate";
/** How provider cache fields relate to its reported input-token count. */
export type ContextUsageCacheSemantics = "included_in_input" | "additive_to_input" | "unknown";
export type ContextUsageLifecycle = "streaming" | "completed" | "restored";
export type ContextWindowAuthority = "provider_reported" | "runtime_observed" | "inferred" | "unknown";
export type ContextUsageFreshness = "fresh" | "stale" | "historical" | "unknown";
export type ContextUsageCaveat = "compacted" | "summarized" | "cache_semantics_unknown" | "usage_exceeds_window";

export interface ContextUsageProjection {
  readonly state: ContextUsageState;
  readonly usedTokens?: number;
  readonly contextWindowTokens?: number;
  readonly remainingTokens?: number;
  readonly usedPercentage?: number;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly turnId?: string;
  readonly observedAt: string;
  readonly measurement: ContextUsageMeasurement;
  readonly lifecycle: ContextUsageLifecycle;
  readonly contextWindowAuthority: ContextWindowAuthority;
  readonly freshness: ContextUsageFreshness;
  readonly reason?: string;
  readonly caveat?: ContextUsageCaveat;
}

/** Raw adapter evidence consumed only by the runtime normalizer. */
export interface ContextUsageRawEvidence {
  readonly measurement: ContextUsageMeasurement;
  readonly cacheSemantics: ContextUsageCacheSemantics;
}
