// Engine type: RuntimeModeConfig -- runtime-variant gateway configuration
// Parsed from the same App YAML as the App composite, by a separate parser

/** Runtime variant: subprocess ("claude-code") or provider-adapter runtime. */
export type RuntimeMode = "claude-code" | "provider-adapter";

/** Provider configuration for provider-adapter apps. */
export interface ProviderConfig {
  readonly name: string;
  readonly model?: string;
  readonly apiKeyEnv?: string;
}

/** Billing tier: which agent tiers a plan level allows */
export interface BillingTier {
  readonly agents: readonly string[];
}

/** Billing configuration for budget enforcement */
export interface BillingConfig {
  readonly budgetEndpoint: string;
  readonly usageEndpoint: string;
  readonly overBudgetMessage: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly tiers?: Readonly<Record<string, BillingTier>>;
}

/** Budget response from product API */
export interface BudgetResponse {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly unit: string;
  readonly reason?: string;
}

/** Usage report sent to product API */
export interface UsageReport {
  readonly tenantId: string;
  readonly messages: number;
  readonly tokens: number;
  readonly model: string;
}

/** Runtime-variant configuration parsed from App YAML. */
export interface RuntimeModeConfig {
  readonly runtime: RuntimeMode;
  readonly provider: ProviderConfig;
  readonly billing?: BillingConfig;
}

/** Validation error for runtime-mode configuration. */
export interface RuntimeModeValidationError {
  readonly field: string;
  readonly message: string;
}

/** Validate a RuntimeModeConfig. Returns array of errors; empty means valid. */
export function validateRuntimeModeConfig(config: RuntimeModeConfig): RuntimeModeValidationError[] {
  const errors: RuntimeModeValidationError[] = [];

  // runtime must be a valid value
  if (config.runtime !== "claude-code" && config.runtime !== "provider-adapter") {
    errors.push({ field: "runtime", message: 'must be "claude-code" or "provider-adapter"' });
  }

  // if runtime is "provider-adapter", provider.name must be non-empty
  if (config.runtime === "provider-adapter") {
    if (!config.provider.name || typeof config.provider.name !== "string") {
      errors.push({ field: "provider.name", message: "must be a non-empty string" });
    }
  }

  // billing validations
  if (config.billing !== undefined) {
    if (!config.billing.budgetEndpoint || typeof config.billing.budgetEndpoint !== "string") {
      errors.push({ field: "billing.budgetEndpoint", message: "must be a non-empty string" });
    }

    if (!config.billing.usageEndpoint || typeof config.billing.usageEndpoint !== "string") {
      errors.push({ field: "billing.usageEndpoint", message: "must be a non-empty string" });
    }

    if (!config.billing.overBudgetMessage || typeof config.billing.overBudgetMessage !== "string") {
      errors.push({ field: "billing.overBudgetMessage", message: "must be a non-empty string" });
    }

    if (config.billing.tiers !== undefined) {
      for (const [tierName, tier] of Object.entries(config.billing.tiers)) {
        if (!tier.agents || tier.agents.length === 0) {
          errors.push({ field: `billing.tiers.${tierName}.agents`, message: "must be a non-empty array" });
        } else {
          for (let i = 0; i < tier.agents.length; i++) {
            const agent = tier.agents[i];
            if (!agent || typeof agent !== "string") {
              errors.push({ field: `billing.tiers.${tierName}.agents[${i}]`, message: "must be a non-empty string" });
            }
          }
        }
      }
    }
  }

  return errors;
}
