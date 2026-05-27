import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "yaml";
import { validateVoiceConfig, type VoiceConfig } from "@kilnai/core";
import { KilnYamlError } from "../kiln-yaml.js";
import { DEFAULT_WORK_GOVERNANCE_CONFIG } from "../kiln-yaml-types.js";
import type {
  KilnManagedAgentsConfig,
  KilnHooksConfig,
  KilnModelTaskSuitabilityOverride,
  KilnReasoningPolicyConfig,
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
  readonly reasoningPolicy?: KilnReasoningPolicyConfig;
  readonly web?: KilnGlobalWebConfig;
  readonly ui?: KilnGlobalUiConfig;
  readonly skills?: KilnYamlSkillsConfig;
  readonly components?: KilnGlobalComponentsConfig;
  readonly operatorVoice?: VoiceConfig;
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
  "reasoningPolicy",
  "web",
  "ui",
  "skills",
  "components",
  "operatorVoice",
]);

const IDENTITY_FIELDS = new Set([
  "name",
  "timezone",
]);

const GLOBAL_WEB_FIELDS = new Set([
  "searchProvider",
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
  validateRecordField(config, "reasoningPolicy");
  validateRecordField(config, "web");
  validateRecordField(config, "ui");
  validateRecordField(config, "skills");
  validateRecordField(config, "components");
  validateRecordField(config, "operatorVoice");
  validateIdentity(config.identity);
  validateStringArray(config.activeInstructionProfiles, "activeInstructionProfiles");
  validateWorkGovernance(config.workGovernance);
  validateEngines(config.engines);
  validateRouting(config.routing);
  validateComponents(config.components);
  validateOperatorVoice(config.operatorVoice);
  validateManagedAgents(config.managedAgents, config.operatorVoice as VoiceConfig | undefined);
  validateModelTaskSuitability(config.modelTaskSuitability);
  validateReasoningPolicy(config.reasoningPolicy);
  validateSkills(config.skills);
  validateGlobalWeb(config.web);
  validateGlobalUi(config.ui);
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
  validateManagedAgentWorktreeLease(value.worktreeLease);
  validateManagedAgentVoiceProfile(value.defaultVoiceProfile, "managedAgents.defaultVoiceProfile", operatorVoice);
  if (value.routes !== undefined) {
    if (!Array.isArray(value.routes)) {
      throw new KilnYamlError("managedAgents.routes must be an array");
    }
    for (let index = 0; index < value.routes.length; index += 1) {
      validateManagedAgentRoute(value.routes[index], index, operatorVoice);
    }
  }
}

function validateManagedAgentRoute(value: unknown, index: number, operatorVoice: VoiceConfig | undefined): void {
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
  if (
    value.workingDirectory !== undefined
    && value.workingDirectory !== "project"
    && value.workingDirectory !== "isolated-worktree"
    && value.workingDirectory !== "sandbox"
  ) {
    throw new KilnYamlError(`managedAgents.routes[${index}].workingDirectory must be "project", "isolated-worktree", or "sandbox"`);
  }
  validateManagedAgentVoiceProfile(value.voiceProfile, `managedAgents.routes[${index}].voiceProfile`, operatorVoice);
  validateManagedAgentWriteAuthority(value.writeAuthority, `managedAgents.routes[${index}].writeAuthority`);
  validateManagedAgentRemoteHarness(value.remoteHarness, value.kind, `managedAgents.routes[${index}].remoteHarness`);
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

function validateReasoningPolicy(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("reasoningPolicy must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "default" && key !== "unsupported" && key !== "byTask") {
      throw new KilnYamlError(`Unknown reasoningPolicy field: ${key}`);
    }
  }
  validateOptionalReasoningEffort(value.default, "reasoningPolicy.default");
  if (value.unsupported !== undefined && value.unsupported !== "omit" && value.unsupported !== "fail") {
    throw new KilnYamlError('reasoningPolicy.unsupported must be "omit" or "fail"');
  }
  if (value.byTask === undefined) {
    return;
  }
  if (!isRecord(value.byTask)) {
    throw new KilnYamlError("reasoningPolicy.byTask must be an object");
  }
  for (const [task, effort] of Object.entries(value.byTask)) {
    if (!isModelTaskSuitabilityTask(task)) {
      throw new KilnYamlError(`reasoningPolicy.byTask.${task} is not a supported task`);
    }
    validateOptionalReasoningEffort(effort, `reasoningPolicy.byTask.${task}`);
  }
}

function validateOptionalReasoningEffort(value: unknown, path: string): void {
  if (value !== undefined && !isReasoningEffort(value)) {
    throw new KilnYamlError(`${path} must be a supported reasoning effort`);
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

function isReasoningEffort(value: unknown): boolean {
  return value === "minimal"
    || value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
