import type {
  ContextUsageCaveat,
  ContextUsageCacheSemantics,
  ContextUsageFreshness,
  ContextUsageLifecycle,
  ContextUsageMeasurement,
  ContextUsageProjection,
  ContextWindowAuthority,
} from "@kilnai/core";

export interface ContextUsageRawUsage {
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cacheSemantics: ContextUsageCacheSemantics;
}

export interface ContextUsageWindowEvidence {
  readonly providerId: string;
  readonly modelId: string;
  readonly tokens: number;
  readonly authority: ContextWindowAuthority;
  readonly freshness: Exclude<ContextUsageFreshness, "historical" | "unknown">;
}

export interface NormalizeContextUsageProjectionInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly turnId: string;
  readonly observedAt: string;
  readonly usage?: ContextUsageRawUsage;
  readonly contextWindow?: ContextUsageWindowEvidence;
  readonly measurement: ContextUsageMeasurement;
  readonly lifecycle: Exclude<ContextUsageLifecycle, "restored">;
  readonly scope?: "parent" | "managed_child";
  readonly caveat?: Extract<ContextUsageCaveat, "compacted" | "summarized">;
}

function unavailable(input: NormalizeContextUsageProjectionInput, reason: string): ContextUsageProjection {
  return {
    state: "unavailable",
    providerId: input.providerId,
    modelId: input.modelId,
    turnId: input.turnId,
    observedAt: input.observedAt,
    measurement: input.measurement,
    lifecycle: input.lifecycle,
    contextWindowAuthority: input.contextWindow?.authority ?? "unknown",
    freshness: input.contextWindow?.freshness ?? "unknown",
    reason,
  };
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function normalizeContextUsageProjection(input: NormalizeContextUsageProjectionInput): ContextUsageProjection {
  if (input.scope === "managed_child") return unavailable(input, "Managed-child usage is not parent-turn context usage.");
  if (!input.usage) return unavailable(input, "No provider or runtime context-usage numerator is available.");
  if (!input.contextWindow) return unavailable(input, "No compatible model context window is available.");
  if (input.contextWindow.providerId !== input.providerId || input.contextWindow.modelId !== input.modelId) {
    return unavailable(input, "Context window evidence does not match the producing provider/model route.");
  }
  if (!isNonNegativeInteger(input.contextWindow.tokens) || input.contextWindow.tokens === 0) {
    return unavailable(input, "Model context window is invalid.");
  }
  if (![input.usage.inputTokens, input.usage.cacheReadTokens, input.usage.cacheWriteTokens].every(isNonNegativeInteger)) {
    return unavailable(input, "Provider usage contains invalid token values.");
  }

  const hasUnknownCacheSemantics = input.usage.cacheSemantics === "unknown"
    && (input.usage.cacheReadTokens > 0 || input.usage.cacheWriteTokens > 0);
  const usedTokens = input.usage.cacheSemantics === "additive_to_input"
    ? input.usage.inputTokens + input.usage.cacheReadTokens + input.usage.cacheWriteTokens
    : input.usage.inputTokens;
  const authoritative = input.measurement === "provider_reported"
    && input.lifecycle === "completed"
    && input.contextWindow.authority === "provider_reported"
    && input.contextWindow.freshness === "fresh"
    && !hasUnknownCacheSemantics;
  const usedPercentage = Math.min(100, (usedTokens / input.contextWindow.tokens) * 100);
  const caveat = hasUnknownCacheSemantics ? "cache_semantics_unknown" : input.caveat
    ?? (usedTokens > input.contextWindow.tokens ? "usage_exceeds_window" : undefined);

  return {
    state: authoritative ? "authoritative" : "partial",
    usedTokens,
    contextWindowTokens: input.contextWindow.tokens,
    remainingTokens: Math.max(0, input.contextWindow.tokens - usedTokens),
    usedPercentage,
    providerId: input.providerId,
    modelId: input.modelId,
    turnId: input.turnId,
    observedAt: input.observedAt,
    measurement: input.measurement,
    lifecycle: input.lifecycle,
    contextWindowAuthority: input.contextWindow.authority,
    freshness: input.contextWindow.freshness,
    ...(caveat ? { caveat } : {}),
  };
}

export function restoreContextUsageProjection(projection: ContextUsageProjection): ContextUsageProjection {
  return {
    ...projection,
    lifecycle: "restored",
    freshness: "historical",
  };
}
