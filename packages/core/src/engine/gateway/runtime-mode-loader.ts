// Engine loader: RuntimeModeLoader -- parses runtime-variant config from App YAML
// Extracts runtime, provider, and billing fields from the same YAML as parseAppYaml()

import { parse } from "yaml";
import { KilnError } from "../errors.js";
import type { RuntimeModeConfig, RuntimeModeValidationError, ProviderConfig, BillingConfig, BillingTier } from "./runtime-mode-config.js";
import { validateRuntimeModeConfig } from "./runtime-mode-config.js";

/** Error class for runtime-mode YAML loader failures. */
export class RuntimeModeLoaderError extends KilnError {
  readonly errors: readonly RuntimeModeValidationError[];

  constructor(errors: readonly RuntimeModeValidationError[]) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    super("RUNTIME_MODE_CONFIG_INVALID", `Invalid runtime mode config:\n${msg}`, {
      context: { errors },
      retryable: false,
    });
    this.name = "RuntimeModeLoaderError";
    this.errors = errors;
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
  overBudgetMessage?: unknown;
  headers?: unknown;
  tiers?: unknown;
}

interface RawRuntimeMode {
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

/** Resolve a value: if it starts with $ treat it as an env var name */
function resolveEnvValue(value: string): string {
  if (value.startsWith("$")) {
    const envName = value.slice(1);
    return process.env[envName] ?? "";
  }
  return value;
}

function mapBilling(raw: RawBilling): BillingConfig {
  const billing: {
    budgetEndpoint: string;
    overBudgetMessage: string;
    headers?: Record<string, string>;
    tiers?: Record<string, BillingTier>;
  } = {
    budgetEndpoint: typeof raw.budgetEndpoint === "string" ? raw.budgetEndpoint : "",
    overBudgetMessage: typeof raw.overBudgetMessage === "string" ? raw.overBudgetMessage : "",
  };

  if (raw.headers && typeof raw.headers === "object" && !Array.isArray(raw.headers)) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.headers as Record<string, unknown>)) {
      if (typeof value === "string") {
        headers[key] = resolveEnvValue(value);
      }
    }
    billing.headers = headers;
  }

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
 * Parse a YAML string and extract runtime-variant config fields.
 * Returns null if the YAML does not have runtime: "provider-adapter"
 * (it is using the subprocess runtime variant).
 * Throws RuntimeModeLoaderError if runtime is "provider-adapter" but config is invalid.
 */
export function parseRuntimeModeConfig(content: string): RuntimeModeConfig | null {
  let data: unknown;
  try {
    data = parse(content);
  } catch (err) {
    throw new RuntimeModeLoaderError([{ field: "yaml", message: String(err) }]);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new RuntimeModeLoaderError([{ field: "root", message: "must be a YAML object" }]);
  }

  const raw = data as RawRuntimeMode;

  // runtime defaults to the subprocess variant
  const runtime = typeof raw.runtime === "string" ? raw.runtime : "claude-code";

  // provider-adapter is the only variant with extra runtime config fields
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

  const config: RuntimeModeConfig = {
    runtime: "provider-adapter",
    provider,
    ...(billing !== undefined ? { billing } : {}),
  };

  const errors = validateRuntimeModeConfig(config);
  if (errors.length > 0) throw new RuntimeModeLoaderError(errors);

  return config;
}
