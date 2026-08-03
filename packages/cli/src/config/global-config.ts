import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "yaml";
import {
  compareManagedEconomicAmounts,
  deriveManagedEconomicMinimumReservation,
  parseGatewayYaml,
  validateManagedEconomicAmount,
  validateVoiceConfig,
  type ManagedEconomicAmount,
  type ModelGatewayConfig,
  type VoiceConfig,
} from "@kilnai/core";
import { KilnYamlError } from "../kiln-yaml.js";
import { DEFAULT_WORK_GOVERNANCE_CONFIG } from "../kiln-yaml-types.js";
import { readMcpConfigurationSource } from "./mcp-config.js";
import type {
  KilnManagedAgentsConfig,
  KilnHooksConfig,
  KilnDeliberationPolicyConfig,
  KilnModelTaskSuitabilityOverride,
  KilnYamlWebExtractProvider,
  KilnYamlWebSearchProvider,
  KilnYamlMcp,
  KilnYamlPermissions,
  KilnYamlSkillsConfig,
  KilnWorkGovernanceConfig,
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
  readonly providerSelection?: KilnGlobalUiProviderSelectionConfig;
}

export interface KilnGlobalUiProviderSelectionConfig {
  readonly provider: string;
  readonly model?: string;
}

export interface KilnGlobalComponentsConfig {
  readonly include?: readonly string[];
}

export interface KilnGlobalWebConfig {
  readonly searchProvider?: KilnYamlWebSearchProvider;
  readonly searchFallbackProviders?: readonly KilnYamlWebSearchProvider[];
  readonly extractProvider?: KilnYamlWebExtractProvider;
}

export const CANONICAL_GLOBAL_CONFIG_VERSION = "1" as const;

export interface KilnGlobalConfig {
  readonly version: typeof CANONICAL_GLOBAL_CONFIG_VERSION;
  readonly identity?: KilnGlobalIdentity;
  readonly activeInstructionProfiles?: readonly string[];
  readonly workGovernance?: KilnWorkGovernanceConfig;
  readonly engines?: Record<string, KilnGlobalEngineConfig>;
  readonly routing?: KilnGlobalRoutingConfig;
  readonly permissions?: KilnYamlPermissions;
  readonly mcp?: KilnYamlMcp;
  readonly hooks?: KilnHooksConfig;
  readonly models?: KilnGlobalModelsConfig;
  readonly managedAgents?: KilnManagedAgentsConfig;
  readonly modelTaskSuitability?: readonly KilnModelTaskSuitabilityOverride[];
  readonly deliberationPolicy?: KilnDeliberationPolicyConfig;
  readonly web?: KilnGlobalWebConfig;
  readonly ui?: KilnGlobalUiConfig;
  readonly skills?: KilnYamlSkillsConfig;
  readonly components?: KilnGlobalComponentsConfig;
  readonly operatorVoice?: VoiceConfig;
  readonly modelGateway?: ModelGatewayConfig;
}

const ROOT_FIELDS = new Set([
  "version",
  "identity",
  "activeInstructionProfiles",
  "workGovernance",
  "engines",
  "routing",
  "permissions",
  "mcp",
  "hooks",
  "models",
  "managedAgents",
  "modelTaskSuitability",
  "deliberationPolicy",
  "web",
  "ui",
  "skills",
  "components",
  "operatorVoice",
  "modelGateway",
]);

const IDENTITY_FIELDS = new Set([
  "name",
  "timezone",
]);

const GLOBAL_WEB_FIELDS = new Set([
  "searchProvider",
  "searchFallbackProviders",
  "extractProvider",
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
    skills: {
      builtin: {
        enabled: true,
      },
    },
    workGovernance: DEFAULT_WORK_GOVERNANCE_CONFIG,
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
  validateRecordField(config, "workGovernance");
  validateRecordField(config, "engines");
  validateRecordField(config, "routing");
  validateRecordField(config, "permissions");
  validateRecordField(config, "mcp");
  validateRecordField(config, "hooks");
  validateRecordField(config, "models");
  validateRecordField(config, "managedAgents");
  validateRecordField(config, "deliberationPolicy");
  validateRecordField(config, "web");
  validateRecordField(config, "ui");
  validateRecordField(config, "skills");
  validateRecordField(config, "components");
  validateRecordField(config, "operatorVoice");
  validateRecordField(config, "modelGateway");
  validateIdentity(config.identity);
  validateStringArray(config.activeInstructionProfiles, "activeInstructionProfiles");
  validateWorkGovernance(config.workGovernance);
  validateEngines(config.engines);
  validateRouting(config.routing);
  validateComponents(config.components);
  validateOperatorVoice(config.operatorVoice);
  validateManagedAgents(config.managedAgents, config.operatorVoice as VoiceConfig | undefined);
  validateModelTaskSuitability(config.modelTaskSuitability);
  validateDeliberationPolicy(config.deliberationPolicy);
  validateSkills(config.skills);
  validateGlobalWeb(config.web);
  validateGlobalUi(config.ui);
  validateGlobalModelGateway(config.modelGateway);
  validateManagedAccountPolicyReferences(config.managedAgents, config.modelGateway);
  readMcpConfigurationSource({
    value: config.mcp,
    scope: "global",
    sourcePath: resolveGlobalConfigPath(),
  });
}

export function resolveGlobalModelGatewayConfig(config: KilnGlobalConfig | null | undefined): ModelGatewayConfig {
  if (!config?.modelGateway) throw new KilnYamlError("Global config does not declare modelGateway.");
  return config.modelGateway;
}

function validateGlobalModelGateway(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("modelGateway must be an object");
  const port = value.port === 4800 ? 4801 : 4800;
  try {
    parseGatewayYaml(stringify({ port, apps: [], modelGateway: value }));
  } catch (error) {
    throw new KilnYamlError(`Invalid global modelGateway: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateIdentity(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("identity must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!IDENTITY_FIELDS.has(key)) {
      throw new KilnYamlError(`Unknown identity field: ${key}`);
    }
  }
  validateOptionalNonEmptyString(value, "name", "identity.name");
  validateOptionalNonEmptyString(value, "timezone", "identity.timezone");
  if (typeof value.timezone === "string") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value.timezone.trim() }).format();
    } catch {
      throw new KilnYamlError("identity.timezone must be a valid IANA time zone");
    }
  }
}

function validateOptionalNonEmptyString(record: Record<string, unknown>, key: string, path: string): void {
  const value = record[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KilnYamlError(`${path} must be a non-empty string`);
  }
}

function validateStringArray(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new KilnYamlError(`${path} must be an array of non-empty strings`);
  }
}

function validateGlobalWeb(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("web must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!GLOBAL_WEB_FIELDS.has(key)) {
      throw new KilnYamlError(
        `Unknown global web field: ${key}. Put web authority in project .kiln/kiln.yaml.`,
      );
    }
  }
  validateOptionalRecord(value, "searchProvider", "web.searchProvider");
  if (value.searchFallbackProviders !== undefined && !Array.isArray(value.searchFallbackProviders)) {
    throw new KilnYamlError("web.searchFallbackProviders must be an array");
  }
  if (Array.isArray(value.searchFallbackProviders)) {
    value.searchFallbackProviders.forEach((provider, index) => {
      if (!isRecord(provider)) {
        throw new KilnYamlError(`web.searchFallbackProviders[${index}] must be an object`);
      }
    });
  }
  validateOptionalRecord(value, "extractProvider", "web.extractProvider");
}

function validateOperatorVoice(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("operatorVoice must be an object");
  }
  const validationErrors = validateVoiceConfig(value as unknown as VoiceConfig);
  if (validationErrors.length > 0) {
    const first = validationErrors[0]!;
    throw new KilnYamlError(`operatorVoice.${first.field} ${first.message}`);
  }
}

function validateWorkGovernance(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("workGovernance must be an object");
  }
  for (const key of Object.keys(value)) {
    if (
      key !== "defaultPosture"
      && key !== "directExecution"
      && key !== "requireDelegationFor"
      && key !== "requiredEvidence"
    ) {
      throw new KilnYamlError(`Unknown workGovernance field: ${key}`);
    }
  }
  if (value.defaultPosture !== undefined && value.defaultPosture !== "orchestrate" && value.defaultPosture !== "direct") {
    throw new KilnYamlError('workGovernance.defaultPosture must be "orchestrate" or "direct"');
  }
  if (value.directExecution !== undefined) {
    validateWorkGovernanceDirectExecution(value.directExecution);
  }
  const requireDelegationFor = value.requireDelegationFor as readonly unknown[] | undefined;
  validateOptionalStringArray(requireDelegationFor, "workGovernance.requireDelegationFor");
  for (const trigger of requireDelegationFor ?? []) {
    if (!isWorkGovernanceTrigger(trigger)) {
      throw new KilnYamlError(`workGovernance.requireDelegationFor contains unsupported trigger: ${trigger}`);
    }
  }
  const requiredEvidence = value.requiredEvidence as readonly unknown[] | undefined;
  validateOptionalStringArray(requiredEvidence, "workGovernance.requiredEvidence");
  for (const evidence of requiredEvidence ?? []) {
    if (!isWorkGovernanceEvidence(evidence)) {
      throw new KilnYamlError(`workGovernance.requiredEvidence contains unsupported evidence: ${evidence}`);
    }
  }
}

function validateWorkGovernanceDirectExecution(value: unknown): void {
  if (!isRecord(value)) {
    throw new KilnYamlError("workGovernance.directExecution must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "maxFiles" && key !== "maxRisk") {
      throw new KilnYamlError(`Unknown workGovernance.directExecution field: ${key}`);
    }
  }
  const maxFiles = value.maxFiles;
  if (maxFiles !== undefined && (typeof maxFiles !== "number" || !Number.isInteger(maxFiles) || maxFiles < 1)) {
    throw new KilnYamlError("workGovernance.directExecution.maxFiles must be a positive integer");
  }
  if (value.maxRisk !== undefined && !isWorkGovernanceRisk(value.maxRisk)) {
    throw new KilnYamlError('workGovernance.directExecution.maxRisk must be "low", "medium", or "high"');
  }
}

function validateOptionalRecord(record: Record<string, unknown>, key: string, path: string): void {
  const value = record[key];
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
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

const GLOBAL_UI_FIELDS = new Set([
  "theme",
  "providerSelection",
]);

function validateGlobalUi(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("ui must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!GLOBAL_UI_FIELDS.has(key)) {
      throw new KilnYamlError(`Unknown global ui field: ${key}`);
    }
  }
  if (value.theme !== undefined && typeof value.theme !== "string") {
    throw new KilnYamlError("ui.theme must be a string");
  }
  if (value.providerSelection === undefined) {
    return;
  }
  if (!isRecord(value.providerSelection)) {
    throw new KilnYamlError("ui.providerSelection must be an object");
  }
  const providerSelectionFields = new Set(["provider", "model"]);
  for (const key of Object.keys(value.providerSelection)) {
    if (!providerSelectionFields.has(key)) {
      throw new KilnYamlError(`Unknown global ui.providerSelection field: ${key}`);
    }
  }
  validateRequiredNonEmptyString(value.providerSelection, "provider", "ui.providerSelection.provider");
  if (value.providerSelection.model !== undefined && typeof value.providerSelection.model !== "string") {
    throw new KilnYamlError("ui.providerSelection.model must be a string");
  }
}

function validateSkills(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("skills must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "builtin" && key !== "selection") {
      throw new KilnYamlError(`Unknown skills field: ${key}`);
    }
  }
  if (value.builtin !== undefined) {
    if (!isRecord(value.builtin)) {
      throw new KilnYamlError("skills.builtin must be an object");
    }
    for (const key of Object.keys(value.builtin)) {
      if (key !== "enabled" && key !== "include" && key !== "exclude") {
        throw new KilnYamlError(`Unknown skills.builtin field: ${key}`);
      }
    }
    if (value.builtin.enabled !== undefined && typeof value.builtin.enabled !== "boolean") {
      throw new KilnYamlError("skills.builtin.enabled must be a boolean");
    }
    validateOptionalStringArray(value.builtin.include, "skills.builtin.include");
    validateOptionalStringArray(value.builtin.exclude, "skills.builtin.exclude");
  }
  if (value.selection !== undefined) {
    if (!isRecord(value.selection)) {
      throw new KilnYamlError("skills.selection must be an object");
    }
    for (const key of Object.keys(value.selection)) {
      if (key !== "mode") {
        throw new KilnYamlError(`Unknown skills.selection field: ${key}`);
      }
    }
    if (
      value.selection.mode !== undefined
      && value.selection.mode !== "advisory"
      && value.selection.mode !== "auto"
    ) {
      throw new KilnYamlError("skills.selection.mode must be advisory or auto");
    }
  }
}

function validateManagedAgents(value: unknown, operatorVoice: VoiceConfig | undefined): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("managedAgents must be an object");
  }
  rejectUnknownFields(value, [
    "schemaVersion",
    "enabled",
    "defaultProfile",
    "defaultProvider",
    "defaultVoiceProfile",
    "model",
    "worktreeLease",
    "requireApproval",
    "routes",
    "economicPolicies",
  ], "managedAgents");
  const hasRuntimeSelectedRoute = Array.isArray(value.routes) && value.routes.some(
    (route) => isRecord(route) && isRecord(route.credentials) && route.credentials.mode === "runtime-selected",
  );
  if (hasRuntimeSelectedRoute && value.schemaVersion !== 2) {
    throw new KilnYamlError(
      "managedAgents runtime-selected routes use the retired pre-v2 schema and must be re-authored as schemaVersion 2; no automatic migration can infer economic authority. See docs/guides/global-config.md#managed-economic-policy-schema-v2.",
    );
  }
  if (value.economicPolicies !== undefined && value.schemaVersion !== 2) {
    throw new KilnYamlError("managedAgents.schemaVersion must be 2 when economicPolicies are declared");
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== 2) {
    throw new KilnYamlError("managedAgents.schemaVersion must be 2");
  }
  if (value.schemaVersion === 2 && (!Array.isArray(value.economicPolicies) || value.economicPolicies.length === 0)) {
    throw new KilnYamlError("managedAgents.schemaVersion 2 requires non-empty economicPolicies");
  }
  validateManagedAgentWorktreeLease(value.worktreeLease);
  validateManagedAgentVoiceProfile(value.defaultVoiceProfile, "managedAgents.defaultVoiceProfile", operatorVoice);
  const routeIds = new Set<string>();
  if (value.routes !== undefined) {
    if (!Array.isArray(value.routes)) {
      throw new KilnYamlError("managedAgents.routes must be an array");
    }
    for (let index = 0; index < value.routes.length; index += 1) {
      validateManagedAgentRoute(value.routes[index], index, operatorVoice);
      const route = value.routes[index];
      if (isRecord(route) && routeIds.has(String(route.id))) {
        throw new KilnYamlError(`managedAgents.routes[${index}].id must be unique`);
      }
      if (isRecord(route)) routeIds.add(String(route.id));
    }
  }
  validateManagedEconomicPolicies(value.economicPolicies);
}

function validateManagedAgentRoute(value: unknown, index: number, operatorVoice: VoiceConfig | undefined): void {
  if (!isRecord(value)) {
    throw new KilnYamlError(`managedAgents.routes[${index}] must be an object`);
  }
  rejectUnknownFields(value, [
    "id",
    "kind",
    "provider",
    "model",
    "voiceProfile",
    "profiles",
    "workingDirectory",
    "timeoutMs",
    "tools",
    "memory",
    "readAuthority",
    "writeAuthority",
    "credentials",
    "remoteHarness",
    "externalRuntimeAttachment",
  ], `managedAgents.routes[${index}]`);
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
  if (
    value.workingDirectory !== undefined
    && value.workingDirectory !== "project"
    && value.workingDirectory !== "isolated-worktree"
    && value.workingDirectory !== "sandbox"
  ) {
    throw new KilnYamlError(`managedAgents.routes[${index}].workingDirectory must be "project", "isolated-worktree", or "sandbox"`);
  }
  validateManagedAgentVoiceProfile(value.voiceProfile, `managedAgents.routes[${index}].voiceProfile`, operatorVoice);
  validateManagedAgentReadAuthority(value.readAuthority, `managedAgents.routes[${index}].readAuthority`);
  validateManagedAgentWriteAuthority(value.writeAuthority, `managedAgents.routes[${index}].writeAuthority`);
  validateManagedAgentCredentials(value.credentials, `managedAgents.routes[${index}].credentials`);
  validateManagedAgentRemoteHarness(value.remoteHarness, value.kind, `managedAgents.routes[${index}].remoteHarness`);
}

function validateManagedEconomicPolicies(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    throw new KilnYamlError("managedAgents.economicPolicies must be a non-empty array");
  }
  const policyIds = new Set<string>();
  for (let policyIndex = 0; policyIndex < value.length; policyIndex += 1) {
    const path = `managedAgents.economicPolicies[${policyIndex}]`;
    const policy = value[policyIndex];
    if (!isRecord(policy)) throw new KilnYamlError(`${path} must be an object`);
    rejectUnknownFields(policy, ["id", "revision", "evidenceRequirements", "noRouteAction", "comparisonDomains", "candidates"], path);
    validateCanonicalId(policy.id, `${path}.id`);
    if (policyIds.has(String(policy.id))) throw new KilnYamlError(`${path}.id must be unique`);
    policyIds.add(String(policy.id));
    validateCanonicalId(policy.revision, `${path}.revision`);
    if (policy.noRouteAction !== "deny") throw new KilnYamlError(`${path}.noRouteAction must be "deny"`);
    validateEconomicEvidenceRequirements(policy.evidenceRequirements, `${path}.evidenceRequirements`);
    const domains = validateEconomicComparisonDomains(policy.comparisonDomains, `${path}.comparisonDomains`);
    validateEconomicCandidates(policy.candidates, domains, `${path}.candidates`);
  }
}

function validateEconomicEvidenceRequirements(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["quota", "price"], path);
  if (value.quota !== "optional" && value.quota !== "required-for-account-bound") {
    throw new KilnYamlError(`${path}.quota is invalid`);
  }
  if (value.price !== "optional" && value.price !== "required") {
    throw new KilnYamlError(`${path}.price is invalid`);
  }
}

function validateEconomicComparisonDomains(value: unknown, path: string): Map<string, Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) throw new KilnYamlError(`${path} must be a non-empty array`);
  const domains = new Map<string, Record<string, unknown>>();
  const ranks = new Set<number>();
  for (let index = 0; index < value.length; index += 1) {
    const domainPath = `${path}[${index}]`;
    const domain = value[index];
    if (!isRecord(domain)) throw new KilnYamlError(`${domainPath} must be an object`);
    rejectUnknownFields(domain, ["id", "rank", "unit", "scheme", "rateCardBasis", "envelopeSemantics"], domainPath);
    validateCanonicalId(domain.id, `${domainPath}.id`);
    validateCanonicalId(domain.unit, `${domainPath}.unit`);
    validateCanonicalId(domain.rateCardBasis, `${domainPath}.rateCardBasis`);
    validateCanonicalId(domain.envelopeSemantics, `${domainPath}.envelopeSemantics`);
    if (!Number.isSafeInteger(domain.rank) || Number(domain.rank) < 0) throw new KilnYamlError(`${domainPath}.rank must be a non-negative integer`);
    if (domains.has(String(domain.id))) throw new KilnYamlError(`${domainPath}.id must be unique`);
    if (ranks.has(Number(domain.rank))) throw new KilnYamlError(`${domainPath}.rank must be unique`);
    validateEconomicScheme(domain.scheme, `${domainPath}.scheme`);
    domains.set(String(domain.id), domain);
    ranks.add(Number(domain.rank));
  }
  return domains;
}

function validateEconomicCandidates(
  value: unknown,
  domains: ReadonlyMap<string, Record<string, unknown>>,
  path: string,
): void {
  if (!Array.isArray(value) || value.length === 0) throw new KilnYamlError(`${path} must be a non-empty array`);
  const routeIds = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const candidatePath = `${path}[${index}]`;
    const candidate = value[index];
    if (!isRecord(candidate)) throw new KilnYamlError(`${candidatePath} must be an object`);
    rejectUnknownFields(candidate, ["routeId", "comparisonDomainId", "priorityRank", "ceiling", "worstCaseReservation"], candidatePath);
    validateCanonicalId(candidate.routeId, `${candidatePath}.routeId`);
    validateCanonicalId(candidate.comparisonDomainId, `${candidatePath}.comparisonDomainId`);
    if (routeIds.has(String(candidate.routeId))) throw new KilnYamlError(`${candidatePath}.routeId must be unique within the policy`);
    routeIds.add(String(candidate.routeId));
    const domain = domains.get(String(candidate.comparisonDomainId));
    if (!domain) throw new KilnYamlError(`${candidatePath}.comparisonDomainId must reference a policy comparison domain`);
    if (!Number.isSafeInteger(candidate.priorityRank) || Number(candidate.priorityRank) < 0) {
      throw new KilnYamlError(`${candidatePath}.priorityRank must be a non-negative integer`);
    }
    validateEconomicCeiling(candidate.ceiling, domain, `${candidatePath}.ceiling`);
    validateEconomicReservation(candidate.worstCaseReservation, domain, `${candidatePath}.worstCaseReservation`);
    if (isRecord(candidate.ceiling) && candidate.ceiling.kind === "finite") {
      if (!isRecord(candidate.worstCaseReservation) || candidate.worstCaseReservation.kind !== "exact") {
        throw new KilnYamlError(`${candidatePath}.worstCaseReservation must be exact when ceiling is finite`);
      }
      const reservation = candidate.worstCaseReservation.amount as ManagedEconomicAmount;
      const ceiling = candidate.ceiling.amount as ManagedEconomicAmount;
      if (compareManagedEconomicAmounts(reservation, ceiling) > 0) {
        throw new KilnYamlError(`${candidatePath}.worstCaseReservation must not exceed its finite ceiling`);
      }
    }
  }
}

function validateEconomicReservation(
  value: unknown,
  domain: Readonly<Record<string, unknown>>,
  path: string,
): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  if (value.kind === "exact") {
    rejectUnknownFields(value, ["kind", "amount"], path);
    validateEconomicAmount(value.amount, `${path}.amount`);
    const amount = value.amount as ManagedEconomicAmount;
    if (amount.unit !== domain.unit || !economicSchemesEqual(amount.scheme, domain.scheme)) {
      throw new KilnYamlError(`${path}.amount must use the comparison domain unit and scheme`);
    }
    return;
  }
  if (value.kind !== "not-comparable") {
    throw new KilnYamlError(`${path}.kind must be "exact" or "not-comparable"`);
  }
  rejectUnknownFields(value, ["kind", "reason"], path);
  if (![
    "subscription-basis",
    "included-basis",
    "estimated-basis",
    "unknown-basis",
    "economic-basis-unavailable",
  ].includes(String(value.reason))) {
    throw new KilnYamlError(`${path}.reason is invalid`);
  }
}

function validateEconomicCeiling(
  value: unknown,
  domain: Readonly<Record<string, unknown>>,
  path: string,
): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  if (value.kind === "none") {
    rejectUnknownFields(value, ["kind"], path);
    return;
  }
  if (value.kind !== "finite") throw new KilnYamlError(`${path}.kind must be "none" or "finite"`);
  rejectUnknownFields(value, ["kind", "amount"], path);
  validateEconomicAmount(value.amount, `${path}.amount`);
  const amount = value.amount as ManagedEconomicAmount;
  if (amount.unit !== domain.unit || !economicSchemesEqual(amount.scheme, domain.scheme)) {
    throw new KilnYamlError(`${path}.amount must use the comparison domain unit and scheme`);
  }
}

function validateEconomicAmount(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["atoms", "scale", "unit", "scheme"], path);
  validateEconomicScheme(value.scheme, `${path}.scheme`);
  try {
    validateManagedEconomicAmount(value as unknown as ManagedEconomicAmount);
  } catch (error) {
    throw new KilnYamlError(`${path} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateEconomicScheme(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  if (value.kind === "currency") {
    rejectUnknownFields(value, ["kind", "currency"], path);
    validateCanonicalId(value.currency, `${path}.currency`);
    return;
  }
  if (value.kind === "credit") {
    rejectUnknownFields(value, ["kind", "creditSchemeId"], path);
    validateCanonicalId(value.creditSchemeId, `${path}.creditSchemeId`);
    return;
  }
  if (value.kind !== "unit") throw new KilnYamlError(`${path}.kind is invalid`);
  rejectUnknownFields(value, ["kind"], path);
}

function validateManagedAgentCredentials(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must explicitly select an account policy`);
  }
  if (value.mode === "credentialless") {
    if (Object.keys(value).some((key) => !["mode", "economicsRouteId"].includes(key))) {
      throw new KilnYamlError(`${path} credentialless mode does not accept account routing fields`);
    }
    if (
      value.economicsRouteId !== undefined
      && (typeof value.economicsRouteId !== "string" || value.economicsRouteId.trim().length === 0)
    ) {
      throw new KilnYamlError(`${path}.economicsRouteId must be a non-empty string`);
    }
    return;
  }
  if (value.mode !== "runtime-selected") {
    throw new KilnYamlError(`${path}.mode must be "runtime-selected" or "credentialless"`);
  }
  for (const key of Object.keys(value)) {
    if (!["mode", "routeId", "accountPolicyId"].includes(key)) {
      throw new KilnYamlError(`Unknown ${path} field: ${key}`);
    }
  }
  if (typeof value.accountPolicyId !== "string" || value.accountPolicyId.trim().length === 0) {
    throw new KilnYamlError(`${path}.accountPolicyId is required`);
  }
  if (value.routeId !== undefined && (typeof value.routeId !== "string" || value.routeId.trim().length === 0)) {
    throw new KilnYamlError(`${path}.routeId must be a non-empty string`);
  }
}

function validateManagedAccountPolicyReferences(managedAgents: unknown, modelGateway: unknown): void {
  if (!isRecord(managedAgents)) return;
  const routes = Array.isArray(managedAgents.routes) ? managedAgents.routes.filter(isRecord) : [];
  const policies = isRecord(modelGateway) && Array.isArray(modelGateway.virtualModels)
    ? modelGateway.virtualModels.filter(isRecord)
    : [];
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    if (!isRecord(route) || !isRecord(route.credentials) || route.credentials.mode !== "runtime-selected") {
      continue;
    }
    const credentials = route.credentials;
    if (route.kind !== "direct") {
      throw new KilnYamlError(
        `managedAgents.routes[${index}] runtime-selected credentials require a direct route`,
      );
    }
    const policy = policies.find((candidate) => candidate.id === credentials.accountPolicyId);
    if (!policy) {
      throw new KilnYamlError(
        `managedAgents.routes[${index}].credentials.accountPolicyId must reference modelGateway.virtualModels`,
      );
    }
    if (policy.providerId !== route.provider || policy.providerModelId !== route.model) {
      throw new KilnYamlError(
        `managedAgents.routes[${index}] provider and model must match its modelGateway account policy`,
      );
    }
  }
  if (!Array.isArray(managedAgents.economicPolicies)) return;
  const accounts = isRecord(modelGateway) && Array.isArray(modelGateway.accounts)
    ? modelGateway.accounts.filter(isRecord)
    : [];
  const directProviders = new Set(["codex-oauth", "opencode-go", "opencode-zen"]);
  for (let policyIndex = 0; policyIndex < managedAgents.economicPolicies.length; policyIndex += 1) {
    const economicPolicy = managedAgents.economicPolicies[policyIndex];
    if (!isRecord(economicPolicy) || !Array.isArray(economicPolicy.candidates)) continue;
    for (let candidateIndex = 0; candidateIndex < economicPolicy.candidates.length; candidateIndex += 1) {
      const candidate = economicPolicy.candidates[candidateIndex];
      if (!isRecord(candidate)) continue;
      const path = `managedAgents.economicPolicies[${policyIndex}].candidates[${candidateIndex}]`;
      const route = routes.find((entry) => entry.id === candidate.routeId);
      if (!route) throw new KilnYamlError(`${path}.routeId must reference managedAgents.routes`);
      if (route.kind !== "direct" || !directProviders.has(String(route.provider))) {
        throw new KilnYamlError(`${path}.routeId must reference a supported direct economic route`);
      }
      if (!isRecord(route.credentials)) {
        throw new KilnYamlError(`${path}.routeId must reference explicit route credentials`);
      }
      const economicsRouteId = route.credentials.mode === "runtime-selected"
        ? route.credentials.accountPolicyId
        : route.credentials.mode === "credentialless"
          ? route.credentials.economicsRouteId
          : undefined;
      if (typeof economicsRouteId !== "string") {
        throw new KilnYamlError(`${path}.routeId requires an explicit virtual economics route reference`);
      }
      const matchingVirtualModels = policies.filter((entry) => entry.id === economicsRouteId);
      if (matchingVirtualModels.length !== 1) {
        throw new KilnYamlError(`${path}.routeId must reference exactly one modelGateway virtual model`);
      }
      const virtualModel = matchingVirtualModels[0]!;
      if (!virtualModel || !isRecord(virtualModel.economics)) {
        throw new KilnYamlError(`${path}.routeId must reference a virtual model with economics`);
      }
      if (virtualModel.providerId !== route.provider || virtualModel.providerModelId !== route.model) {
        throw new KilnYamlError(`${path}.routeId provider and model must match its virtual economics route`);
      }
      const domain = Array.isArray(economicPolicy.comparisonDomains)
        ? economicPolicy.comparisonDomains.find((entry) =>
            isRecord(entry) && entry.id === candidate.comparisonDomainId)
        : undefined;
      if (!isRecord(domain)) {
        throw new KilnYamlError(`${path}.comparisonDomainId must reference a policy comparison domain`);
      }
      if (domain.rateCardBasis !== virtualModel.economics.rateCardBasis) {
        throw new KilnYamlError(`${path} comparison domain rateCardBasis must match route economics`);
      }
      if (domain.envelopeSemantics !== virtualModel.economics.envelopeSemantics) {
        throw new KilnYamlError(`${path} comparison domain envelopeSemantics must match route economics`);
      }
      validateReservationPriceClass(
        candidate.worstCaseReservation,
        isRecord(virtualModel.economics.priceEvidence)
          ? virtualModel.economics.priceEvidence.kind
          : undefined,
        path,
      );
      validateRouteEconomicSchemes(virtualModel.economics, domain, path);
      validateDerivedRouteReservation(candidate.worstCaseReservation, virtualModel.economics, domain, path);
      if (virtualModel.economics.fallbackPosture !== "disabled" || virtualModel.economics.overagePosture !== "disabled") {
        throw new KilnYamlError(`${path}.routeId cannot activate uncommitted fallback or overage`);
      }
      const accountIds = Array.isArray(virtualModel.accountIds) ? virtualModel.accountIds : [];
      if (route.credentials.mode === "credentialless" && accountIds.length !== 0) {
        throw new KilnYamlError(`${path}.routeId credentialless economics route must have zero accountIds`);
      }
      if (route.credentials.mode === "credentialless") continue;
      for (const accountId of accountIds) {
        const account = accounts.find((entry) => entry.id === accountId);
        if (!account || !isRecord(account.economics)) {
          throw new KilnYamlError(`${path}.routeId requires economics for every account candidate`);
        }
        if (account.economics.creditPosture !== "disabled" || account.economics.overagePosture !== "disabled") {
          throw new KilnYamlError(`${path}.routeId cannot activate account credit or overage subcommitments`);
        }
      }
    }
  }
}

function validateRouteEconomicSchemes(
  economics: Readonly<Record<string, unknown>>,
  domain: Readonly<Record<string, unknown>>,
  path: string,
): void {
  const priceEvidence = economics.priceEvidence;
  if (isRecord(priceEvidence) && Array.isArray(priceEvidence.unitPrices)) {
    for (const unitPrice of priceEvidence.unitPrices) {
      if (
        !isRecord(unitPrice)
        || !isRecord(unitPrice.price)
        || !economicSchemesEqual(unitPrice.price.scheme, domain.scheme)
      ) {
        throw new KilnYamlError(`${path} route price scheme must match its comparison domain`);
      }
    }
  }
  if (Array.isArray(economics.auxiliaryCharges)) {
    for (const charge of economics.auxiliaryCharges) {
      if (
        !isRecord(charge)
        || !isRecord(charge.amount)
        || charge.amount.unit !== domain.unit
        || !economicSchemesEqual(charge.amount.scheme, domain.scheme)
      ) {
        throw new KilnYamlError(`${path} auxiliary charge unit and scheme must match its comparison domain`);
      }
    }
  }
}

function validateDerivedRouteReservation(
  reservation: unknown,
  economics: Readonly<Record<string, unknown>>,
  domain: Readonly<Record<string, unknown>>,
  path: string,
): void {
  const priceEvidence = economics.priceEvidence;
  if (!isRecord(priceEvidence) || !isRecord(reservation)) return;
  const auxiliaryCharges = Array.isArray(economics.auxiliaryCharges) ? economics.auxiliaryCharges : [];
  if (priceEvidence.kind === "free") {
    if (auxiliaryCharges.length > 0) {
      throw new KilnYamlError(`${path} free route cannot declare separately charged auxiliary calls`);
    }
    if (reservation.kind !== "exact" || !isRecord(reservation.amount)) return;
    const amount = reservation.amount as unknown as ManagedEconomicAmount;
    const zero: ManagedEconomicAmount = {
      atoms: "0",
      scale: 0,
      unit: amount.unit,
      scheme: amount.scheme,
    };
    if (compareManagedEconomicAmounts(amount, zero) !== 0) {
      throw new KilnYamlError(`${path} free route requires an exact zero worst-case reservation`);
    }
    return;
  }
  if (priceEvidence.kind !== "metered" || reservation.kind !== "exact" || !isRecord(reservation.amount)) return;
  const envelope = economics.executionEnvelope;
  if (!isRecord(envelope) || !Array.isArray(envelope.limits) || !Array.isArray(priceEvidence.unitPrices)) return;
  try {
    const minimum = deriveManagedEconomicMinimumReservation({
      unitRates: priceEvidence.unitPrices.map((entry) => {
        if (!isRecord(entry) || !isRecord(entry.price)) throw new KilnYamlError(`${path} route unit price is invalid`);
        return {
          usageUnit: String(entry.usageUnit),
          price: entry.price as unknown as ManagedEconomicAmount,
        };
      }),
      usageLimits: envelope.limits as ManagedEconomicAmount[],
      auxiliaryCharges: auxiliaryCharges.map((entry) => {
        if (!isRecord(entry) || !isRecord(entry.amount)) throw new KilnYamlError(`${path} auxiliary charge is invalid`);
        return {
          id: String(entry.id),
          amount: entry.amount as unknown as ManagedEconomicAmount,
        };
      }),
      outputUnit: String(domain.unit),
      targetScheme: domain.scheme as Exclude<ManagedEconomicAmount["scheme"], { readonly kind: "unit" }>,
    });
    if (compareManagedEconomicAmounts(reservation.amount as unknown as ManagedEconomicAmount, minimum) < 0) {
      throw new KilnYamlError(`${path} worstCaseReservation must cover the derived minimum reservation`);
    }
  } catch (error) {
    if (error instanceof KilnYamlError) throw error;
    throw new KilnYamlError(`${path} cannot derive an exact minimum reservation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateReservationPriceClass(
  reservation: unknown,
  priceKind: unknown,
  path: string,
): void {
  if (!isRecord(reservation)) return;
  if (priceKind === "metered" || priceKind === "free") {
    if (reservation.kind !== "exact") {
      throw new KilnYamlError(`${path} ${priceKind} route requires an exact worst-case reservation`);
    }
    return;
  }
  const expectedReason = priceKind === "subscription"
    ? "subscription-basis"
    : priceKind === "included"
      ? "included-basis"
      : priceKind === "estimated"
        ? "estimated-basis"
        : priceKind === "unknown"
          ? "unknown-basis"
          : undefined;
  if (expectedReason && (reservation.kind !== "not-comparable" || reservation.reason !== expectedReason)) {
    throw new KilnYamlError(`${path} ${priceKind} route requires not-comparable reason '${expectedReason}'`);
  }
}

function validateManagedAgentReadAuthority(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateManagedAgentWorkspaceReadConfig(value.workspace, `${path}.workspace`);
}

function validateManagedAgentWorkspaceReadConfig(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateOptionalStringArray(value.allowedPaths, `${path}.allowedPaths`);
  validateOptionalStringArray(value.deniedPaths, `${path}.deniedPaths`);
}

function validateManagedAgentRemoteHarness(value: unknown, routeKind: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (routeKind !== "harness") {
    throw new KilnYamlError(`${path} requires kind "harness"`);
  }
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!["invokeUrl", "cancelUrl", "authTokenEnv", "limitations"].includes(key)) {
      throw new KilnYamlError(`Unknown ${path} field: ${key}`);
    }
  }
  validateRequiredHttpsUrlString(value, "invokeUrl", `${path}.invokeUrl`);
  validateRequiredHttpsUrlString(value, "cancelUrl", `${path}.cancelUrl`);
  if (value.authTokenEnv !== undefined) {
    if (typeof value.authTokenEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value.authTokenEnv)) {
      throw new KilnYamlError(`${path}.authTokenEnv must be a portable environment variable name`);
    }
  }
  validateOptionalStringArray(value.limitations, `${path}.limitations`);
}

function validateManagedAgentWorktreeLease(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("managedAgents.worktreeLease must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!["mode", "rootPath", "ref", "gitBinary"].includes(key)) {
      throw new KilnYamlError(`Unknown managedAgents.worktreeLease field: ${key}`);
    }
  }
  if (value.mode !== "git") {
    throw new KilnYamlError("managedAgents.worktreeLease.mode must be \"git\"");
  }
  if (typeof value.rootPath !== "string" || value.rootPath.trim().length === 0) {
    throw new KilnYamlError("managedAgents.worktreeLease.rootPath is required");
  }
  if (value.ref !== undefined && (typeof value.ref !== "string" || value.ref.trim().length === 0)) {
    throw new KilnYamlError("managedAgents.worktreeLease.ref must be a non-empty string");
  }
  if (value.gitBinary !== undefined && (typeof value.gitBinary !== "string" || value.gitBinary.trim().length === 0)) {
    throw new KilnYamlError("managedAgents.worktreeLease.gitBinary must be a non-empty string");
  }
}

function validateManagedAgentVoiceProfile(
  value: unknown,
  path: string,
  operatorVoice: VoiceConfig | undefined,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KilnYamlError(`${path} must be a non-empty string`);
  }
  if (!operatorVoice?.ttsProfiles?.[value.trim()]) {
    throw new KilnYamlError(`${path} references unknown operatorVoice.ttsProfiles entry "${value.trim()}"`);
  }
}

function validateManagedAgentWriteAuthority(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  if (!isRecord(value.approval)) {
    throw new KilnYamlError(`${path}.approval is required`);
  }
  if (value.approval.mode !== "required-before-apply" && value.approval.mode !== "policy-approved") {
    throw new KilnYamlError(`${path}.approval.mode must be "required-before-apply" or "policy-approved"`);
  }
  validateOptionalStringArray(value.approval.evidenceUris, `${path}.approval.evidenceUris`);
  validateManagedAgentWorkspaceWriteConfig(value.workspace, `${path}.workspace`);
  validateManagedAgentMemoryWriteConfig(value.memory, `${path}.memory`);
  validateManagedAgentArtifactWriteConfig(value.artifacts, `${path}.artifacts`);
  validateManagedAgentToolWriteConfig(value.tools, `${path}.tools`);
}

function validateManagedAgentWorkspaceWriteConfig(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateOptionalWriteMode(value.mode, `${path}.mode`);
  validateOptionalStringArray(value.allowedPaths, `${path}.allowedPaths`);
  validateOptionalStringArray(value.deniedPaths, `${path}.deniedPaths`);
}

function validateManagedAgentMemoryWriteConfig(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateOptionalWriteMode(value.mode, `${path}.mode`);
  if (value.operations !== undefined) {
    if (!Array.isArray(value.operations) || value.operations.some((item) => !isManagedAgentMemoryWriteOperation(item))) {
      throw new KilnYamlError(`${path}.operations contains an unsupported memory write operation`);
    }
  }
}

function validateManagedAgentArtifactWriteConfig(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateOptionalWriteMode(value.mode, `${path}.mode`);
  validateOptionalStringArray(value.resourceUris, `${path}.resourceUris`);
  if (
    value.retention !== undefined
    && value.retention !== "none"
    && value.retention !== "session"
    && value.retention !== "durable"
    && value.retention !== "external"
  ) {
    throw new KilnYamlError(`${path}.retention must be "none", "session", "durable", or "external"`);
  }
}

function validateManagedAgentToolWriteConfig(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateOptionalStringArray(value.allowed, `${path}.allowed`);
  validateOptionalStringArray(value.denied, `${path}.denied`);
}

function validateModelTaskSuitability(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new KilnYamlError("modelTaskSuitability must be an array");
  }
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      throw new KilnYamlError(`modelTaskSuitability[${index}] must be an object`);
    }
    validateRequiredNonEmptyString(entry, "provider", `modelTaskSuitability[${index}].provider`);
    validateRequiredNonEmptyString(entry, "model", `modelTaskSuitability[${index}].model`);
    validateRequiredNonEmptyString(entry, "reason", `modelTaskSuitability[${index}].reason`);
    if (!isModelTaskSuitabilityTask(entry.task)) {
      throw new KilnYamlError(`modelTaskSuitability[${index}].task is not supported`);
    }
    if (!isModelTaskSuitabilityLevel(entry.level)) {
      throw new KilnYamlError(`modelTaskSuitability[${index}].level must be "preferred", "capable", or "limited"`);
    }
  }
}

function validateDeliberationPolicy(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("deliberationPolicy must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "default" && key !== "byTask" && key !== "byRoute") {
      throw new KilnYamlError(`Unknown deliberationPolicy field: ${key}`);
    }
  }
  if (value.default !== undefined) {
    validateDeliberationRule(value.default, "deliberationPolicy.default", false);
  }
  if (value.byTask !== undefined) {
    if (!isRecord(value.byTask)) {
      throw new KilnYamlError("deliberationPolicy.byTask must be an object");
    }
    for (const [task, rule] of Object.entries(value.byTask)) {
      if (!isModelTaskSuitabilityTask(task)) {
        throw new KilnYamlError(`deliberationPolicy.byTask.${task} is not a supported task`);
      }
      validateDeliberationRule(rule, `deliberationPolicy.byTask.${task}`, false);
    }
  }
  if (value.byRoute !== undefined) {
    if (!Array.isArray(value.byRoute)) {
      throw new KilnYamlError("deliberationPolicy.byRoute must be an array");
    }
    const identities = new Set<string>();
    for (let index = 0; index < value.byRoute.length; index += 1) {
      const path = `deliberationPolicy.byRoute[${index}]`;
      const rule = value.byRoute[index];
      validateDeliberationRule(rule, path, true);
      const route = rule as Record<string, unknown>;
      validateRequiredNonEmptyString(route, "provider", `${path}.provider`);
      validateRequiredNonEmptyString(route, "model", `${path}.model`);
      const identity = `${route.provider}/${route.model}`;
      if (identities.has(identity)) {
        throw new KilnYamlError(`${path} duplicates route ${identity}`);
      }
      identities.add(identity);
    }
  }
}

function validateDeliberationRule(value: unknown, path: string, route: boolean): void {
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  const allowed = new Set(["mode", "target", "preferredLevel", "bounds", "onUnsupported"]);
  if (route) {
    allowed.add("provider");
    allowed.add("model");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new KilnYamlError(`Unknown ${path} field: ${key}`);
    }
  }
  if (value.mode !== "provider-default" && value.mode !== "fixed" && value.mode !== "adaptive") {
    throw new KilnYamlError(`${path}.mode must be "provider-default", "fixed", or "adaptive"`);
  }
  if (value.onUnsupported !== undefined
    && value.onUnsupported !== "deny"
    && value.onUnsupported !== "omit"
    && value.onUnsupported !== "allow-clamp") {
    throw new KilnYamlError(`${path}.onUnsupported must be "deny", "omit", or "allow-clamp"`);
  }
  if (value.mode === "provider-default") {
    if (value.target !== undefined || value.preferredLevel !== undefined || value.bounds !== undefined) {
      throw new KilnYamlError(`${path} provider-default mode cannot set target, preferredLevel, or bounds`);
    }
    return;
  }
  if (value.mode === "fixed") {
    if (!isDeliberationLevelId(value.preferredLevel)) {
      throw new KilnYamlError(`${path}.preferredLevel is required when mode is fixed`);
    }
    if (value.target !== undefined) {
      throw new KilnYamlError(`${path} fixed mode cannot set target`);
    }
  } else {
    if (value.target !== "latency-first" && value.target !== "balanced" && value.target !== "quality-first") {
      throw new KilnYamlError(`${path}.target must be "latency-first", "balanced", or "quality-first"`);
    }
    if (value.preferredLevel !== undefined) {
      throw new KilnYamlError(`${path} adaptive mode cannot set preferredLevel`);
    }
  }
  if (value.bounds !== undefined) {
    if (!isRecord(value.bounds)) {
      throw new KilnYamlError(`${path}.bounds must be an object`);
    }
    for (const key of Object.keys(value.bounds)) {
      if (key !== "min" && key !== "max") {
        throw new KilnYamlError(`Unknown ${path}.bounds field: ${key}`);
      }
    }
    if (value.bounds.min !== undefined && !isDeliberationLevelId(value.bounds.min)) {
      throw new KilnYamlError(`${path}.bounds.min must be a portable deliberation level identifier`);
    }
    if (value.bounds.max !== undefined && !isDeliberationLevelId(value.bounds.max)) {
      throw new KilnYamlError(`${path}.bounds.max must be a portable deliberation level identifier`);
    }
  }
}

function validateRecordField(config: Record<string, unknown>, field: string): void {
  const value = config[field];
  if (value !== undefined && !isRecord(value)) {
    throw new KilnYamlError(`${field} must be an object`);
  }
}

function validateRequiredNonEmptyString(record: Record<string, unknown>, key: string, path: string): void {
  if (typeof record[key] !== "string" || record[key].trim().length === 0) {
    throw new KilnYamlError(`${path} must be a non-empty string`);
  }
}

function validateRequiredHttpsUrlString(record: Record<string, unknown>, key: string, path: string): void {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KilnYamlError(`${path} must be a non-empty HTTPS URL string`);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new KilnYamlError(`${path} must be a non-empty HTTPS URL string`);
    }
  } catch {
    throw new KilnYamlError(`${path} must be a non-empty HTTPS URL string`);
  }
}

function validateOptionalStringArray(value: unknown, path: string): void {
  if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0))) {
    throw new KilnYamlError(`${path} must be an array of non-empty strings`);
  }
}

function validateOptionalWriteMode(value: unknown, path: string): void {
  if (value !== undefined && value !== "none" && value !== "propose" && value !== "apply-approved") {
    throw new KilnYamlError(`${path} must be "none", "propose", or "apply-approved"`);
  }
}

function isManagedAgentMemoryWriteOperation(value: unknown): boolean {
  return value === "create"
    || value === "update"
    || value === "archive"
    || value === "forget"
    || value === "redact"
    || value === "promote";
}

function isEngineBilling(value: unknown): value is KilnEngineBilling {
  return value === "subscription"
    || value === "plus-quota"
    || value === "free"
    || value === "api-key"
    || value === "local";
}

function isModelTaskSuitabilityTask(value: unknown): boolean {
  return value === "architecture-review"
    || value === "backend-coding"
    || value === "frontend-design"
    || value === "mechanical-edit"
    || value === "research"
    || value === "test-writing";
}

function isDeliberationLevelId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(value);
}

function isModelTaskSuitabilityLevel(value: unknown): boolean {
  return value === "preferred" || value === "capable" || value === "limited";
}

function isWorkGovernanceRisk(value: unknown): boolean {
  return value === "low" || value === "medium" || value === "high";
}

function isWorkGovernanceTrigger(value: unknown): boolean {
  return value === "architecture"
    || value === "security"
    || value === "ui"
    || value === "runtime"
    || value === "provider-routing"
    || value === "managed-agents"
    || value === "config"
    || value === "multi-file"
    || value === "cross-surface"
    || value === "long-running"
    || value === "verification-heavy"
    || value === "formal-proof-candidate";
}

function isWorkGovernanceEvidence(value: unknown): boolean {
  return value === "surface-map"
    || value === "risk-hypothesis"
    || value === "spec"
    || value === "plan"
    || value === "tests"
    || value === "typecheck"
    || value === "visual-reference-research"
    || value === "browser-qa"
    || value === "managed-agent-review"
    || value === "formal-proof"
    || value === "residual-risk";
}

function rejectUnknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new KilnYamlError(`Unknown ${path} field: ${key}`);
  }
}

function validateCanonicalId(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw new KilnYamlError(`${path} must be a canonical id`);
  }
}

function economicSchemesEqual(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right) || left.kind !== right.kind) return false;
  if (left.kind === "unit") return true;
  if (left.kind === "currency") return left.currency === right.currency;
  if (left.kind === "credit") return left.creditSchemeId === right.creditSchemeId;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
