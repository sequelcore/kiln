// Budget enforcement middleware for Mode B apps
// Checks remaining budget before LLM calls and reports usage after
//
// DESIGN RATIONALE (Fail-Closed):
// This middleware intentionally fails CLOSED (blocks requests when budget API is unavailable).
// Strict budget enforcement: billing infrastructure issues block user access to prevent
// runaway costs. If the budget API is down, requests are rejected until it recovers.
//
// Use case: Strict budget enforcement where cost control is prioritized over service
// availability. For availability-first, use a different pattern.

import { CircuitBreaker } from "@kilnai/core";

/** Budget check result */
export interface BudgetCheckResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly unit: string;
  readonly overBudgetMessage?: string;
}

/** Tier enforcement check result */
export interface TierCheckResult {
  readonly allowed: boolean;
  readonly requestedTier: string;
  readonly allowedTiers: readonly string[];
}

/** Billing configuration (matches ModeBConfig.billing from @kilnai/core) */
export interface BillingConfig {
  readonly budgetEndpoint: string;
  readonly usageEndpoint: string;
  readonly overBudgetMessage: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly tiers?: Readonly<Record<string, { readonly agents: readonly string[] }>>;
}

/** Budget response from product API */
interface BudgetResponse {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly unit: string;
  readonly reason?: string;
}

/** Usage report sent to product API */
interface UsageReport {
  readonly tenantId: string;
  readonly messages: number;
  readonly tokens: number;
  readonly model: string;
}

/** Shared circuit breaker for budget API calls */
const budgetCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxAttempts: 1,
});

/** Build request headers: merge billing.headers with Content-Type */
function buildHeaders(billing: BillingConfig, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (billing.headers) {
    for (const [key, value] of Object.entries(billing.headers)) {
      if (value) headers[key] = value;
    }
  }
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

/**
 * Check if the tenant has remaining budget.
 * Interpolates {userId} in the budget endpoint URL.
 * Fail-closed: returns allowed=false on any fetch error or when circuit is open.
 */
export async function checkBudget(
  billing: BillingConfig,
  tenantId: string,
): Promise<BudgetCheckResult> {
  if (budgetCircuitBreaker.currentState === "open") {
    return { allowed: false, remaining: -1, unit: "unknown" };
  }

  try {
    return await budgetCircuitBreaker.execute(async () => {
      const url = billing.budgetEndpoint.replace("{userId}", tenantId);
      const res = await fetch(url, { headers: buildHeaders(billing) });
      if (!res.ok) {
        console.error(`[billing] checkBudget failed: ${res.status} ${res.statusText} (tenant=${tenantId})`);
        return { allowed: false, remaining: -1, unit: "unknown" };
      }
      const data = (await res.json()) as BudgetResponse;
      if (data.allowed === false) {
        return {
          allowed: false,
          remaining: data.remaining ?? 0,
          unit: data.unit ?? "tokens",
          overBudgetMessage: billing.overBudgetMessage,
        };
      }
      return { allowed: true, remaining: data.remaining ?? -1, unit: data.unit ?? "tokens" };
    });
  } catch {
    return { allowed: false, remaining: -1, unit: "unknown" };
  }
}

/**
 * Report token usage to the product API.
 * Fire-and-forget: errors are logged but not thrown.
 */
export async function reportUsage(
  billing: BillingConfig,
  usage: UsageReport,
): Promise<void> {
  const url = billing.usageEndpoint;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: buildHeaders(billing, "application/json"),
      body: JSON.stringify(usage),
    });
    if (!res.ok) {
      console.warn(`[billing] reportUsage failed: ${res.status} ${res.statusText} (tenant=${usage.tenantId})`);
    }
  } catch (err) {
    console.warn(`[billing] reportUsage error (tenant=${usage.tenantId}):`, err);
  }
}

/**
 * Check if the requested agent tier is allowed for the user's plan.
 * Fail-open: returns allowed=true if no tiers configured or plan not found.
 */
export function checkTier(
  billing: BillingConfig,
  userPlan: string,
  requestedTier: string,
): TierCheckResult {
  if (!billing.tiers) {
    return { allowed: true, requestedTier, allowedTiers: [] };
  }
  const tier = billing.tiers[userPlan];
  if (!tier) {
    // Fail-open: unknown plan allows everything
    return { allowed: true, requestedTier, allowedTiers: [] };
  }
  const allowed = tier.agents.includes(requestedTier);
  return { allowed, requestedTier, allowedTiers: tier.agents };
}
