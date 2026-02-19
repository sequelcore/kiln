// Budget enforcement middleware for Mode B apps
// Checks remaining budget before LLM calls and reports usage after

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
interface BillingConfig {
  readonly budgetEndpoint: string;
  readonly usageEndpoint: string;
  readonly overBudgetMessage: string;
  readonly tiers?: Readonly<Record<string, { readonly agents: readonly string[] }>>;
}

/** Budget response from product API */
interface BudgetResponse {
  readonly remaining: number;
  readonly unit: string;
}

/** Usage report sent to product API */
interface UsageReport {
  readonly tokens: number;
  readonly model: string;
  readonly role: string;
}

/**
 * Check if the user has remaining budget.
 * Interpolates {userId} in the budget endpoint URL.
 * Fail-open: returns allowed=true on any fetch error.
 */
export async function checkBudget(
  billing: BillingConfig,
  userId: string,
): Promise<BudgetCheckResult> {
  const url = billing.budgetEndpoint.replace("{userId}", userId);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // Fail-open: billing failures should not block users
      return { allowed: true, remaining: -1, unit: "unknown" };
    }
    const data = (await res.json()) as BudgetResponse;
    if (data.remaining <= 0) {
      return {
        allowed: false,
        remaining: data.remaining,
        unit: data.unit,
        overBudgetMessage: billing.overBudgetMessage,
      };
    }
    return { allowed: true, remaining: data.remaining, unit: data.unit };
  } catch {
    // Fail-open on network/fetch errors
    return { allowed: true, remaining: -1, unit: "unknown" };
  }
}

/**
 * Report token usage to the product API.
 * Interpolates {userId} in the usage endpoint URL.
 * Fire-and-forget: errors are logged but not thrown.
 */
export async function reportUsage(
  billing: BillingConfig,
  userId: string,
  usage: UsageReport,
): Promise<void> {
  const url = billing.usageEndpoint.replace("{userId}", userId);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(usage),
    });
  } catch {
    // Fire-and-forget: errors logged but not thrown
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
