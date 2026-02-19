// Engine loader: ModeBLoader -- parses Mode B config from App YAML
// Extracts runtime, provider, and billing fields from the same YAML as parseAppYaml()

import { parse } from "yaml";
import type { ModeBConfig, ModeBValidationError, ProviderConfig, BillingConfig, BillingTier } from "./mode-b-config.js";
import { validateModeBConfig } from "./mode-b-config.js";

/** Error class for Mode B YAML loader failures */
export class ModeBLoaderError extends Error {
  constructor(readonly errors: readonly ModeBValidationError[]) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    super(`Invalid Mode B config:\n${msg}`);
    this.name = "ModeBLoaderError";
  }
}

// ---------------------------------------------------------------------------
// Internal YAML shape types (unvalidated raw structure from parse())
// ---------------------------------------------------------------------------

interface RawProvider {
  name?: unknown;
  model?: unknown;
  apiKeyEnv?: unknown;
}

interface RawBillingTier {
  agents?: unknown;
}

interface RawBilling {
  budgetEndpoint?: unknown;
  usageEndpoint?: unknown;
  overBudgetMessage?: unknown;
  tiers?: unknown;
}

interface RawModeB {
  runtime?: unknown;
  provider?: unknown;
  billing?: unknown;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapProvider(raw: RawProvider): ProviderConfig {
  const provider: { name: string; model?: string; apiKeyEnv?: string } = {
    name: typeof raw.name === "string" ? raw.name : "",
  };
  if (typeof raw.model === "string") provider.model = raw.model;
  if (typeof raw.apiKeyEnv === "string") provider.apiKeyEnv = raw.apiKeyEnv;
  return provider;
}

function mapBillingTier(raw: RawBillingTier): BillingTier {
  const agents: string[] = [];
  if (Array.isArray(raw.agents)) {
    for (const agent of raw.agents) {
      if (typeof agent === "string") agents.push(agent);
    }
  }
  return { agents };
}

function mapBilling(raw: RawBilling): BillingConfig {
  const billing: {
    budgetEndpoint: string;
    usageEndpoint: string;
    overBudgetMessage: string;
    tiers?: Record<string, BillingTier>;
  } = {
    budgetEndpoint: typeof raw.budgetEndpoint === "string" ? raw.budgetEndpoint : "",
    usageEndpoint: typeof raw.usageEndpoint === "string" ? raw.usageEndpoint : "",
    overBudgetMessage: typeof raw.overBudgetMessage === "string" ? raw.overBudgetMessage : "",
  };

  if (raw.tiers && typeof raw.tiers === "object" && !Array.isArray(raw.tiers)) {
    const tiers: Record<string, BillingTier> = {};
    for (const [tierName, tierValue] of Object.entries(raw.tiers as Record<string, unknown>)) {
      if (tierValue && typeof tierValue === "object" && !Array.isArray(tierValue)) {
        tiers[tierName] = mapBillingTier(tierValue as RawBillingTier);
      }
    }
    billing.tiers = tiers;
  }

  return billing;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a YAML string and extract Mode B config fields.
 * Returns null if the YAML does not have runtime: "provider-adapter" (it's a Mode A app).
 * Throws ModeBLoaderError if runtime is "provider-adapter" but config is invalid.
 */
export function parseModeBConfig(content: string): ModeBConfig | null {
  let data: unknown;
  try {
    data = parse(content);
  } catch (err) {
    throw new ModeBLoaderError([{ field: "yaml", message: String(err) }]);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ModeBLoaderError([{ field: "root", message: "must be a YAML object" }]);
  }

  const raw = data as RawModeB;

  // runtime defaults to "claude-code"
  const runtime = typeof raw.runtime === "string" ? raw.runtime : "claude-code";

  // if not Mode B, return null
  if (runtime !== "provider-adapter") {
    return null;
  }

  // extract provider
  const provider: ProviderConfig =
    raw.provider && typeof raw.provider === "object" && !Array.isArray(raw.provider)
      ? mapProvider(raw.provider as RawProvider)
      : { name: "" };

  // extract billing if present
  let billing: BillingConfig | undefined;
  if (raw.billing && typeof raw.billing === "object" && !Array.isArray(raw.billing)) {
    billing = mapBilling(raw.billing as RawBilling);
  }

  const config: ModeBConfig = {
    runtime: "provider-adapter",
    provider,
    ...(billing !== undefined ? { billing } : {}),
  };

  const errors = validateModeBConfig(config);
  if (errors.length > 0) throw new ModeBLoaderError(errors);

  return config;
}
