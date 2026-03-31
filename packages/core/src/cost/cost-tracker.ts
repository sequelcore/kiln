import type { AgentRole } from "../agents/index.js";
import type { RoleUsage, ModelPricing, CostSummary, SttPricing, EmbeddingPricing } from "./index.js";
import { MODEL_CATALOG } from "../agents/model-pricing.js";

/** Anthropic cache multipliers (other providers don't expose cache-aware pricing) */

/** Unified pricing derived from MODEL_CATALOG (single source of truth) */
export const MODEL_PRICING: ReadonlyMap<string, ModelPricing> = new Map(
  MODEL_CATALOG.map((entry) => [
    entry.model,
    {
      inputRate: entry.inputPer1M,
      outputRate: entry.outputPer1M,
      cacheReadMultiplier: entry.provider === "anthropic"
        ? 0.1
        : entry.cachedInputRatePer1M !== undefined
          ? entry.cachedInputRatePer1M / entry.inputPer1M
          : 1,
      cacheWriteMultiplier: entry.provider === "anthropic" ? 1.25 : 0,
    },
  ]),
);

/** STT pricing: rate per minute of audio */
export const STT_PRICING: ReadonlyMap<string, SttPricing> = new Map([
  ["gpt-4o-transcribe", { ratePerMinute: 0.006 }],
  ["nova-3", { ratePerMinute: 0.0043 }],
]);

/** Embedding pricing: rate per million tokens */
export const EMBEDDING_PRICING: ReadonlyMap<string, EmbeddingPricing> = new Map([
  ["text-embedding-3-small", { ratePerMToken: 0.02 }],
  ["text-embedding-3-large", { ratePerMToken: 0.13 }],
]);

interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/** Mutable accumulator for per-role usage */
interface MutableRoleUsage {
  role: AgentRole;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  calls: number;
}

/**
 * Tracks token usage and computes costs per role with cache-aware pricing.
 * Subscribes to EventBus cost_update events for automatic tracking.
 */
export class CostTracker {
  private readonly usageByRoleModel = new Map<string, MutableRoleUsage>();
  private embeddingCostUsd = 0;
  private sttCostUsd = 0;

  /** Record token usage for a specific role and model */
  record(
    role: AgentRole,
    model: string,
    usage: TokenUsage,
  ): void {
    const key = `${role}:${model}`;
    let entry = this.usageByRoleModel.get(key);
    if (!entry) {
      entry = {
        role,
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        calls: 0,
      };
      this.usageByRoleModel.set(key, entry);
    }
    entry.inputTokens += usage.inputTokens;
    entry.outputTokens += usage.outputTokens;
    entry.cacheReadTokens += usage.cacheReadTokens;
    entry.cacheWriteTokens += usage.cacheWriteTokens;
    entry.calls += 1;
  }

  /** Record embedding cost for a specific model */
  recordEmbedding(model: string, tokens: number): void {
    const pricing = EMBEDDING_PRICING.get(model);
    if (!pricing) return;
    this.embeddingCostUsd += (tokens * pricing.ratePerMToken) / 1_000_000;
  }

  /** Record STT cost for a specific model */
  recordStt(model: string, durationSeconds: number): void {
    const pricing = STT_PRICING.get(model);
    if (!pricing) return;
    this.sttCostUsd += (durationSeconds / 60) * pricing.ratePerMinute;
  }

  /** Compute USD cost for a specific role */
  costForRole(role: AgentRole): number {
    let total = 0;
    for (const [key, entry] of this.usageByRoleModel) {
      if (key.startsWith(`${role}:`)) {
        total += computeCost(entry);
      }
    }
    return total;
  }

  /** Get full cost summary with totals and per-role breakdown */
  get summary(): CostSummary {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;
    let totalToolCalls = 0;
    let totalCostUsd = 0;
    const byRoleModel: Record<string, RoleUsage> = {};

    for (const [key, entry] of this.usageByRoleModel) {
      totalInputTokens += entry.inputTokens;
      totalOutputTokens += entry.outputTokens;
      totalCacheReadTokens += entry.cacheReadTokens;
      totalCacheWriteTokens += entry.cacheWriteTokens;
      totalToolCalls += entry.calls;

      const entryCost = computeCost(entry);
      totalCostUsd += entryCost;

      byRoleModel[key] = {
        role: entry.role,
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheWriteTokens: entry.cacheWriteTokens,
        calls: entry.calls,
      };
    }

    // Include embedding and STT costs in total
    totalCostUsd += this.embeddingCostUsd + this.sttCostUsd;

    return {
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheWriteTokens,
      totalToolCalls,
      totalCostUsd,
      byRoleModel,
    };
  }

  /** Clear all accumulated usage */
  reset(): void {
    this.usageByRoleModel.clear();
    this.embeddingCostUsd = 0;
    this.sttCostUsd = 0;
  }
}

/** Compute USD cost for a usage entry using MODEL_PRICING */
function computeCost(entry: MutableRoleUsage): number {
  const pricing = MODEL_PRICING.get(entry.model);
  if (!pricing) return 0;

  const uncachedInput = Math.max(
    0,
    entry.inputTokens - entry.cacheReadTokens - entry.cacheWriteTokens,
  );

  return (
    (uncachedInput * pricing.inputRate +
      entry.outputTokens * pricing.outputRate +
      entry.cacheReadTokens * pricing.inputRate * pricing.cacheReadMultiplier +
      entry.cacheWriteTokens * pricing.inputRate * pricing.cacheWriteMultiplier) /
    1_000_000
  );
}
