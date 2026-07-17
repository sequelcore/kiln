import type {
  OperatorCockpitActionTarget,
} from "./operator-cockpit-target.js";

export const OPERATOR_ATTENTION_REASONS = [
  "managed-agent-active",
  "managed-agent-review-required",
  "managed-agent-timed-out",
  "managed-agent-stale",
  "managed-agent-failed",
  "managed-agent-cancelled",
  "approval-required",
  "config-health",
  "route-health",
  "browser-takeover",
  "missing-capability",
] as const;

export type OperatorAttentionReason = typeof OPERATOR_ATTENTION_REASONS[number];

export const OPERATOR_ATTENTION_SEVERITIES = [
  "info",
  "action_required",
  "blocked",
  "failed",
] as const;

export type OperatorAttentionSeverity = typeof OPERATOR_ATTENTION_SEVERITIES[number];

export interface OperatorAttentionItem {
  readonly attentionId: string;
  readonly reason: OperatorAttentionReason;
  readonly severity: OperatorAttentionSeverity;
  readonly title: string;
  readonly target: OperatorCockpitActionTarget;
  readonly summary?: string;
  readonly resourceUris?: readonly string[];
}

export interface OperatorAttentionSummary {
  readonly items: readonly OperatorAttentionItem[];
  readonly totalCount: number;
  readonly actionRequiredCount: number;
  readonly blockedCount: number;
  readonly failedCount: number;
}

export function createOperatorAttentionSummary(
  items: readonly OperatorAttentionItem[],
): OperatorAttentionSummary {
  return {
    items,
    totalCount: items.length,
    actionRequiredCount: items.filter((item) => item.severity === "action_required").length,
    blockedCount: items.filter((item) => item.severity === "blocked").length,
    failedCount: items.filter((item) => item.severity === "failed").length,
  };
}
