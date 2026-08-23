// Engine type: RuntimeModeConfig -- provider-adapter runtime configuration

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

/** Maps the already structurally admitted app document into its optional provider runtime. */
export function mapRuntimeModeConfig(raw: {
  readonly runtime?: unknown;
  readonly provider?: unknown;
  readonly billing?: unknown;
}): { readonly config?: RuntimeModeConfig; readonly errors: readonly RuntimeModeValidationError[] } {
  const runtime = typeof raw.runtime === "string" ? raw.runtime : "claude-code";
  if (runtime !== "claude-code" && runtime !== "provider-adapter") {
    return { errors: [{ field: "runtime", message: 'must be "claude-code" or "provider-adapter"' }] };
  }
  if (runtime === "claude-code") {
    const errors: RuntimeModeValidationError[] = [];
    if (raw.provider !== undefined) errors.push({ field: "provider", message: "requires runtime: provider-adapter" });
    if (raw.billing !== undefined) errors.push({ field: "billing", message: "requires runtime: provider-adapter" });
    return { errors };
  }

  const providerRaw = isRecord(raw.provider) ? raw.provider : {};
  const provider: ProviderConfig = {
    name: typeof providerRaw.name === "string" ? providerRaw.name : "",
    ...(typeof providerRaw.model === "string" ? { model: providerRaw.model } : {}),
    ...(typeof providerRaw.apiKeyEnv === "string" ? { apiKeyEnv: providerRaw.apiKeyEnv } : {}),
  };
  const billing = isRecord(raw.billing) ? mapBilling(raw.billing) : undefined;
  const config: RuntimeModeConfig = {
    runtime: "provider-adapter",
    provider,
    ...(billing ? { billing } : {}),
  };
  const errors = validateRuntimeModeConfig(config);
  return errors.length > 0 ? { errors } : { config, errors: [] };
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

function mapBilling(raw: Readonly<Record<string, unknown>>): BillingConfig {
  const headers = isRecord(raw.headers)
    ? Object.fromEntries(Object.entries(raw.headers).map(([key, value]) => [
        key,
        typeof value === "string" && value.startsWith("$") ? process.env[value.slice(1)] ?? "" : "",
      ]))
    : undefined;
  const tiers = isRecord(raw.tiers)
    ? Object.fromEntries(Object.entries(raw.tiers).map(([name, value]) => [
        name,
        { agents: isRecord(value) && Array.isArray(value.agents) ? value.agents.filter((agent): agent is string => typeof agent === "string") : [] },
      ]))
    : undefined;
  return {
    budgetEndpoint: typeof raw.budgetEndpoint === "string" ? raw.budgetEndpoint : "",
    overBudgetMessage: typeof raw.overBudgetMessage === "string" ? raw.overBudgetMessage : "",
    ...(headers ? { headers } : {}),
    ...(tiers ? { tiers } : {}),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
