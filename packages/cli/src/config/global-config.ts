import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "yaml";
import { KilnYamlError } from "../kiln-yaml.js";
import type {
  KilnManagedAgentsConfig,
  KilnHooksConfig,
  KilnYamlWebConfig,
  KilnYamlMcp,
  KilnYamlPermissions,
} from "../kiln-yaml-types.js";

export interface KilnGlobalIdentity {
  readonly name?: string;
  readonly timezone?: string;
}

export type KilnEngineBilling = "subscription" | "plus-quota" | "free" | "api-key" | "local";

export interface KilnGlobalEngineConfig {
  readonly enabled?: boolean;
  readonly billing?: KilnEngineBilling;
}

export interface KilnGlobalRoutingBudgetConfig {
  readonly dailyTokenCeiling?: number | null;
  readonly onCeiling?: "fallback" | "stop";
}

export interface KilnGlobalRoutingRouteConfig {
  readonly provider: string;
  readonly model?: string;
}

export interface KilnGlobalRoutingConfig {
  readonly defaultWorker?: string;
  readonly fallback?: string;
  readonly routes?: readonly KilnGlobalRoutingRouteConfig[];
  readonly budgetAware?: boolean;
  readonly budget?: Record<string, KilnGlobalRoutingBudgetConfig>;
}

export interface KilnGlobalModelsConfig {
  readonly default?: string;
  readonly [engine: string]: string | undefined;
}

export interface KilnGlobalUiConfig {
  readonly theme?: string;
}

export interface KilnGlobalComponentsConfig {
  readonly include?: readonly string[];
}

export const CANONICAL_GLOBAL_CONFIG_VERSION = "1" as const;

export interface KilnGlobalConfig {
  readonly version: typeof CANONICAL_GLOBAL_CONFIG_VERSION;
  readonly identity?: KilnGlobalIdentity;
  readonly engines?: Record<string, KilnGlobalEngineConfig>;
  readonly routing?: KilnGlobalRoutingConfig;
  readonly permissions?: KilnYamlPermissions;
  readonly mcp?: KilnYamlMcp;
  readonly hooks?: KilnHooksConfig;
  readonly models?: KilnGlobalModelsConfig;
  readonly managedAgents?: KilnManagedAgentsConfig;
  readonly web?: KilnYamlWebConfig;
  readonly ui?: KilnGlobalUiConfig;
  readonly components?: KilnGlobalComponentsConfig;
}

const ROOT_FIELDS = new Set([
  "version",
  "identity",
  "engines",
  "routing",
  "permissions",
  "mcp",
  "hooks",
  "models",
  "managedAgents",
  "web",
  "ui",
  "components",
]);

export function resolveGlobalConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return join(xdgConfigHome, "kiln", "config.yaml");
  }
  return join(homedir(), ".kiln", "config.yaml");
}

export function readGlobalConfig(): KilnGlobalConfig | null {
  const configPath = resolveGlobalConfigPath();
  if (!existsSync(configPath)) {
    return null;
  }
  const raw = readFileSync(configPath, "utf-8");
  try {
    const parsed = parse(raw);
    validateGlobalConfig(parsed);
    return parsed as KilnGlobalConfig;
  } catch (err) {
    if (err instanceof KilnYamlError) {
      throw err;
    }
    throw new KilnYamlError(
      `Failed to parse global config: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function writeGlobalConfig(config: KilnGlobalConfig): void {
  validateGlobalConfig(config);
  const configPath = resolveGlobalConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, stringify(config), "utf-8");
}

export function defaultGlobalConfig(): KilnGlobalConfig {
  return {
    version: CANONICAL_GLOBAL_CONFIG_VERSION,
    engines: {
      claude: { enabled: true, billing: "subscription" },
      codex: { enabled: false, billing: "plus-quota" },
      opencode: { enabled: false, billing: "free" },
    },
    routing: {
      defaultWorker: "claude",
      budgetAware: false,
    },
    permissions: {
      approval: "on-request",
      sandbox: "read-only",
    },
    components: {
      include: ["baseline:core"],
    },
  };
}

export function resolveGlobalDefaultProvider(config: KilnGlobalConfig | null | undefined): string | undefined {
  if (!config) {
    return undefined;
  }
  const firstRouteProvider = config.routing?.routes?.find((route) => route.provider.trim().length > 0)?.provider;
  if (firstRouteProvider) {
    return firstRouteProvider;
  }
  return config.routing?.defaultWorker
    ?? Object.entries(config.engines ?? {}).find(([, engine]) => engine.enabled === true)?.[0];
}

export function resolveGlobalDefaultModel(config: KilnGlobalConfig | null | undefined): string | undefined {
  if (!config) {
    return undefined;
  }
  const firstRoute = config.routing?.routes?.find((route) => route.provider.trim().length > 0);
  if (firstRoute?.model) {
    return firstRoute.model;
  }
  const provider = resolveGlobalDefaultProvider(config);
  return (provider ? config.models?.[provider] : undefined) ?? config.models?.default;
}

export function resolveGlobalUiTheme(config: KilnGlobalConfig | null | undefined): string | undefined {
  return config?.ui?.theme;
}

export function validateGlobalConfig(config: unknown): void {
  if (!isRecord(config)) {
    throw new KilnYamlError("Global config must be an object");
  }
  if (config.version !== CANONICAL_GLOBAL_CONFIG_VERSION) {
    throw new KilnYamlError(
      `Global config version must be "${CANONICAL_GLOBAL_CONFIG_VERSION}". Recreate the canonical config through an explicit adoption flow.`,
    );
  }
  for (const key of Object.keys(config)) {
    if (!ROOT_FIELDS.has(key)) {
      throw new KilnYamlError(`Unknown global config field: ${key}`);
    }
  }
  validateRecordField(config, "identity");
  validateRecordField(config, "engines");
  validateRecordField(config, "routing");
  validateRecordField(config, "permissions");
  validateRecordField(config, "mcp");
  validateRecordField(config, "hooks");
  validateRecordField(config, "models");
  validateRecordField(config, "managedAgents");
  validateRecordField(config, "web");
  validateRecordField(config, "ui");
  validateRecordField(config, "components");
  validateEngines(config.engines);
  validateRouting(config.routing);
  validateComponents(config.components);
  validateManagedAgents(config.managedAgents);
}

function validateEngines(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("engines must be an object");
  }
  for (const [engineId, engine] of Object.entries(value)) {
    if (!isRecord(engine)) {
      throw new KilnYamlError(`engines.${engineId} must be an object`);
    }
    if (engine.enabled !== undefined && typeof engine.enabled !== "boolean") {
      throw new KilnYamlError(`engines.${engineId}.enabled must be a boolean`);
    }
    if (engine.billing !== undefined && !isEngineBilling(engine.billing)) {
      throw new KilnYamlError(`engines.${engineId}.billing has an unknown billing mode`);
    }
  }
}

function validateRouting(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("routing must be an object");
  }
  if (value.defaultWorker !== undefined && typeof value.defaultWorker !== "string") {
    throw new KilnYamlError("routing.defaultWorker must be a string");
  }
  if (value.fallback !== undefined && typeof value.fallback !== "string") {
    throw new KilnYamlError("routing.fallback must be a string");
  }
  if (value.routes !== undefined) {
    if (!Array.isArray(value.routes)) {
      throw new KilnYamlError("routing.routes must be an array");
    }
    for (let index = 0; index < value.routes.length; index += 1) {
      validateRoutingRoute(value.routes[index], index);
    }
  }
  if (value.budgetAware !== undefined && typeof value.budgetAware !== "boolean") {
    throw new KilnYamlError("routing.budgetAware must be a boolean");
  }
  if (value.budget !== undefined) {
    if (!isRecord(value.budget)) {
      throw new KilnYamlError("routing.budget must be an object");
    }
    for (const [engineId, budget] of Object.entries(value.budget)) {
      if (!isRecord(budget)) {
        throw new KilnYamlError(`routing.budget.${engineId} must be an object`);
      }
      const ceiling = budget.dailyTokenCeiling;
      if (ceiling !== undefined && ceiling !== null && typeof ceiling !== "number") {
        throw new KilnYamlError(`routing.budget.${engineId}.dailyTokenCeiling must be a number or null`);
      }
      if (budget.onCeiling !== undefined && budget.onCeiling !== "fallback" && budget.onCeiling !== "stop") {
        throw new KilnYamlError(`routing.budget.${engineId}.onCeiling must be "fallback" or "stop"`);
      }
    }
  }
}

function validateRoutingRoute(value: unknown, index: number): void {
  if (!isRecord(value)) {
    throw new KilnYamlError(`routing.routes[${index}] must be an object`);
  }
  if (typeof value.provider !== "string" || value.provider.trim().length === 0) {
    throw new KilnYamlError(`routing.routes[${index}].provider must be a non-empty string`);
  }
  if (value.model !== undefined && typeof value.model !== "string") {
    throw new KilnYamlError(`routing.routes[${index}].model must be a string`);
  }
}

function validateComponents(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("components must be an object");
  }
  if (value.include !== undefined) {
    if (!Array.isArray(value.include) || value.include.some((item) => typeof item !== "string")) {
      throw new KilnYamlError("components.include must be an array of strings");
    }
  }
}

function validateManagedAgents(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("managedAgents must be an object");
  }
  if (value.routes !== undefined) {
    if (!Array.isArray(value.routes)) {
      throw new KilnYamlError("managedAgents.routes must be an array");
    }
    for (let index = 0; index < value.routes.length; index += 1) {
      validateManagedAgentRoute(value.routes[index], index);
    }
  }
}

function validateManagedAgentRoute(value: unknown, index: number): void {
  if (!isRecord(value)) {
    throw new KilnYamlError(`managedAgents.routes[${index}] must be an object`);
  }
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new KilnYamlError(`managedAgents.routes[${index}].id is required`);
  }
  if (value.kind !== "harness" && value.kind !== "direct") {
    throw new KilnYamlError(`managedAgents.routes[${index}].kind must be "harness" or "direct"`);
  }
  if (typeof value.provider !== "string" || value.provider.trim().length === 0) {
    throw new KilnYamlError(`managedAgents.routes[${index}].provider is required`);
  }
  if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== "number" || value.timeoutMs <= 0)) {
    throw new KilnYamlError(`managedAgents.routes[${index}].timeoutMs must be positive`);
  }
}

function validateRecordField(config: Record<string, unknown>, field: string): void {
  const value = config[field];
  if (value !== undefined && !isRecord(value)) {
    throw new KilnYamlError(`${field} must be an object`);
  }
}

function isEngineBilling(value: unknown): value is KilnEngineBilling {
  return value === "subscription"
    || value === "plus-quota"
    || value === "free"
    || value === "api-key"
    || value === "local";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
