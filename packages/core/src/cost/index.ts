import type { AgentRole } from "../agents/index.js";

/** Per-role usage tracking */
export interface RoleUsage {
  readonly role: AgentRole;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly calls: number;
}

/** Model pricing rates (per million tokens) */
export interface ModelPricing {
  readonly inputRate: number;
  readonly outputRate: number;
  readonly cacheReadMultiplier: number;
  readonly cacheWriteMultiplier: number;
}

/** STT pricing (per minute of audio) */
export interface SttPricing {
  readonly ratePerMinute: number;
}

/** Embedding pricing (per million tokens) */
export interface EmbeddingPricing {
  readonly ratePerMToken: number;
}

/** Cost tracking summary */
export interface CostSummary {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheReadTokens: number;
  readonly totalCacheWriteTokens: number;
  readonly totalToolCalls: number;
  readonly totalCostUsd: number;
  /** Per role:model tuple breakdown */
  readonly byRoleModel: Record<string, RoleUsage>;
}

export { CostTracker, MODEL_PRICING, STT_PRICING, EMBEDDING_PRICING } from "./cost-tracker.js";
