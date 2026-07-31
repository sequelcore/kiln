import type { AgentRole } from "../agents/index.js";
import type { ExecutionBillingMode } from "../agents/index.js";

/** Per-role usage tracking */
export interface RoleUsage {
  readonly role: AgentRole;
  readonly model: string;
  readonly provider?: string;
  readonly canonicalModel?: string;
  readonly billingMode?: ExecutionBillingMode;
  readonly costEvidence?: ExecutionCostEvidence;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly calls: number;
}

export type ExecutionCostEvidence =
  | {
      readonly kind: "metered";
      readonly currency: "USD";
      readonly amountUsd: number;
      readonly comparable: true;
      readonly reason: "metered pricing resolved";
    }
  | {
      readonly kind: "subscription";
      readonly currency: "USD";
      readonly amountUsd: 0;
      readonly comparable: false;
      readonly reason: "subscription billing does not expose per-call metered charges";
    }
  | {
      readonly kind: "free";
      readonly currency: "USD";
      readonly amountUsd: 0;
      readonly comparable: true;
      readonly reason: "free billing mode";
    }
  | {
      readonly kind: "unknown";
      readonly currency: "unknown";
      readonly amountUsd: 0;
      readonly comparable: false;
      readonly reason: "metered pricing is missing for provider/model";
    };

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

export {
  CostTracker,
  MODEL_PRICING,
  STT_PRICING,
  EMBEDDING_PRICING,
  computeUsageCostUsd,
  resolveExecutionCostEvidence,
  resolveExecutionPricing,
  resolveModelPricing,
} from "./cost-tracker.js";
export { ModelDevClient, createModelDevClient } from "./models-dev-client.js";
export type { ModelDevPricing } from "./models-dev-client.js";
export type {
  BudgetAdmissionDecision,
  BudgetAdmissionPolicy,
  BudgetAdmissionRequest,
  BudgetAdmissionRouteCandidate,
  BudgetAdmissionRouteDecision,
  BudgetAdmissionSubject,
  BudgetRouteBudget,
  BudgetUsageSnapshot,
} from "./budget-admission.js";
export * from "./managed-route-economics.js";
