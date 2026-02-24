import type { AgentRole } from "../agents/index.js";
import type { RoleUsage, ModelPricing, CostSummary } from "./index.js";

/** Built-in pricing per million tokens for Claude models */
export const MODEL_PRICING: ReadonlyMap<string, ModelPricing> = new Map([
  [
    "claude-opus-4-6",
    {
      inputRate: 15,
      outputRate: 75,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
    },
  ],
  [
    "claude-sonnet-4-6",
    {
      inputRate: 3,
      outputRate: 15,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
    },
  ],
  [
    "claude-haiku-4-5-20251001",
    {
      inputRate: 0.8,
      outputRate: 4,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
    },
  ],
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
  private readonly usageByRole = new Map<AgentRole, MutableRoleUsage>();

  constructor() {}

  /** Record token usage for a specific role and model */
  record(
    role: AgentRole,
    model: string,
    usage: TokenUsage,
  ): void {
    let entry = this.usageByRole.get(role);
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
      this.usageByRole.set(role, entry);
    }
    entry.model = model;
    entry.inputTokens += usage.inputTokens;
    entry.outputTokens += usage.outputTokens;
    entry.cacheReadTokens += usage.cacheReadTokens;
    entry.cacheWriteTokens += usage.cacheWriteTokens;
    entry.calls += 1;
  }

  /** Compute USD cost for a specific role */
  costForRole(role: AgentRole): number {
    const entry = this.usageByRole.get(role);
    if (!entry) return 0;
    return computeCost(entry);
  }

  /** Get full cost summary with totals and per-role breakdown */
  get summary(): CostSummary {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;
    let totalToolCalls = 0;
    let totalCostUsd = 0;
    const byRole: Record<string, RoleUsage> = {};

    for (const [role, entry] of this.usageByRole) {
      totalInputTokens += entry.inputTokens;
      totalOutputTokens += entry.outputTokens;
      totalCacheReadTokens += entry.cacheReadTokens;
      totalCacheWriteTokens += entry.cacheWriteTokens;
      totalToolCalls += entry.calls;

      const roleCost = computeCost(entry);
      totalCostUsd += roleCost;

      byRole[role] = {
        role: entry.role,
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheWriteTokens: entry.cacheWriteTokens,
        calls: entry.calls,
      };
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheWriteTokens,
      totalToolCalls,
      totalCostUsd,
      byRole,
    };
  }

  /** Clear all accumulated usage */
  reset(): void {
    this.usageByRole.clear();
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
