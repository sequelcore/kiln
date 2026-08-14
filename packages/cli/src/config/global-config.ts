import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  fsyncSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "yaml";
import {
  compareManagedEconomicAmounts,
  deriveManagedEconomicMinimumReservation,
  parseGatewayYaml,
  validateManagedEconomicAmount,
  validateVoiceConfig,
  defineExecutionCatalog,
  isDirectProviderId,
  type ManagedEconomicAmount,
  type ModelGatewayConfig,
  type VoiceConfig,
  type ExecutionAccount,
  type ExecutionAccountPolicy,
  type ExecutionCatalog,
  type ExecutionRoute,
  type ExecutionRouteAccountSelection,
} from "@kilnai/core";
import { describeRunningCliBuild } from "../build-identity.js";
import { KilnYamlError } from "../kiln-yaml.js";
import { DEFAULT_WORK_GOVERNANCE_CONFIG } from "../kiln-yaml-types.js";
import { readMcpConfigurationSource } from "./mcp-config.js";
import { validateSkillVisibilityConfig } from "./skill-visibility.js";
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

export interface KilnExecutionRoutingConfig {
  readonly defaultRouteId: string;
}

export interface KilnSessionTurnBudgetConfig {
  readonly tokenLimit: number;
  readonly action: "stop";
}

export interface KilnWorkerRoutingRouteConfig {
  readonly provider: string;
  readonly model?: string;
}

/** Native worker-engine policy; distinct from account-backed executionRouting. */
export interface KilnWorkerRoutingConfig {
  readonly defaultWorker?: string;
  readonly fallback?: string;
  readonly routes?: readonly KilnWorkerRoutingRouteConfig[];
}

/** Per-native-worker model defaults; distinct from executionCatalog routes. */
export interface KilnWorkerModelsConfig {
  readonly default?: string;
  readonly [engine: string]: string | undefined;
}

/** CLI config names whose structure is owned by Core's execution-routing contract. */
export type KilnExecutionAccount = ExecutionAccount;
export type KilnExecutionAccountPolicy = ExecutionAccountPolicy;
export type KilnExecutionRouteAutomaticSelection = Extract<ExecutionRouteAccountSelection, { readonly mode: "automatic" }>;
export type KilnExecutionRouteExactSelection = Extract<ExecutionRouteAccountSelection, { readonly mode: "exact" }>;
export type KilnExecutionRoute = ExecutionRoute;
export type KilnExecutionCatalog = ExecutionCatalog;

export interface KilnGlobalUiConfig {
  readonly theme?: string;
  readonly executionRouteSelection?: KilnGlobalUiExecutionRouteSelectionConfig;
}

export interface KilnGlobalUiExecutionRouteSelectionConfig {
  readonly routeId: string;
  readonly accountOverrideId?: string;
}

export interface KilnGlobalComponentsConfig {
  readonly include?: readonly string[];
}

export interface KilnGlobalWebConfig {
  readonly searchProvider?: KilnYamlWebSearchProvider;
  readonly searchFallbackProviders?: readonly KilnYamlWebSearchProvider[];
  readonly extractProvider?: KilnYamlWebExtractProvider;
}

export const CANONICAL_GLOBAL_CONFIG_VERSION = "2" as const;

export interface KilnGlobalConfig {
  readonly version: typeof CANONICAL_GLOBAL_CONFIG_VERSION;
  readonly identity?: KilnGlobalIdentity;
  readonly activeInstructionProfiles?: readonly string[];
  readonly workGovernance?: KilnWorkGovernanceConfig;
  readonly engines?: Record<string, KilnGlobalEngineConfig>;
  readonly executionCatalog?: KilnExecutionCatalog;
  readonly executionRouting?: KilnExecutionRoutingConfig;
  readonly workerRouting?: KilnWorkerRoutingConfig;
  readonly sessionTurnBudget?: KilnSessionTurnBudgetConfig;
  readonly permissions?: KilnYamlPermissions;
  readonly mcp?: KilnYamlMcp;
  readonly hooks?: KilnHooksConfig;
  readonly workerModels?: KilnWorkerModelsConfig;
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

/**
 * Field allowlists are derived from the interfaces they guard: a field added to
 * an interface without a matching entry here fails typecheck instead of being
 * rejected at runtime as an unknown field.
 */
function fieldNamesOf<T>(fields: Record<keyof T, true>): readonly string[] {
  return Object.keys(fields);
}

const ROOT_FIELDS = fieldNamesOf<KilnGlobalConfig>({
  version: true,
  identity: true,
  activeInstructionProfiles: true,
  workGovernance: true,
  engines: true,
  executionCatalog: true,
  executionRouting: true,
  workerRouting: true,
  sessionTurnBudget: true,
  permissions: true,
  mcp: true,
  hooks: true,
  workerModels: true,
  managedAgents: true,
  modelTaskSuitability: true,
  deliberationPolicy: true,
  web: true,
  ui: true,
  skills: true,
  components: true,
  operatorVoice: true,
  modelGateway: true,
});

const IDENTITY_FIELDS = fieldNamesOf<KilnGlobalIdentity>({
  name: true,
  timezone: true,
});

const GLOBAL_WEB_FIELDS = fieldNamesOf<KilnGlobalWebConfig>({
  searchProvider: true,
  searchFallbackProviders: true,
  extractProvider: true,
});

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

export type GlobalConfigMutationErrorCode =
  | "GLOBAL_CONFIG_LOCK_UNAVAILABLE"
  | "GLOBAL_CONFIG_REVISION_CONFLICT"
  | "GLOBAL_CONFIG_WRITE_FAILED";

export interface GlobalConfigMutationEvidence {
  readonly configPath: string;
  readonly expectedRevision?: string;
  readonly actualRevision?: string;
  readonly lockOwnerPid?: number;
  readonly lockAcquiredAt?: string;
  readonly invalidBackupPath?: string;
}

function parseGlobalConfigRaw(raw: string | null): KilnGlobalConfig | null {
  if (raw === null) return null;
  try {
    const parsed = parse(raw);
    validateGlobalConfig(parsed);
    return parsed as KilnGlobalConfig;
  } catch (error) {
    if (error instanceof KilnYamlError) throw error;
    throw new KilnYamlError(
      `Failed to parse global config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function globalConfigRevision(raw: string | null): string {
  return raw === null ? "absent" : `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function globalConfigMutationMessage(
  code: GlobalConfigMutationErrorCode,
  evidence: GlobalConfigMutationEvidence,
): string {
  if (code === "GLOBAL_CONFIG_LOCK_UNAVAILABLE") {
    return `Global config mutation is already in progress: ${evidence.configPath}`;
  }
  if (code === "GLOBAL_CONFIG_REVISION_CONFLICT") {
    return `Global config revision conflict: expected ${evidence.expectedRevision}, found ${evidence.actualRevision}`;
  }
  return `Global config atomic write failed: ${evidence.configPath}`;
}

export class GlobalConfigMutationError extends Error {
  readonly name = "GlobalConfigMutationError";

  constructor(
    readonly code: GlobalConfigMutationErrorCode,
    readonly evidence: GlobalConfigMutationEvidence,
    cause?: unknown,
  ) {
    super(globalConfigMutationMessage(code, evidence));
    this.cause = cause;
  }
}

export interface GlobalConfigMutationOptions {
  readonly expectedRevision?: string;
  readonly invalidCurrent?: "backup-and-replace";
}

export interface GlobalConfigMutationResult {
  readonly config: KilnGlobalConfig;
  readonly previousRevision: string;
  readonly revision: string;
  readonly invalidBackupPath?: string;
}

export function mutateGlobalConfig(
  mutation: (current: KilnGlobalConfig | null) => KilnGlobalConfig,
  options: GlobalConfigMutationOptions = {},
): GlobalConfigMutationResult {
  const configPath = resolveGlobalConfigPath();
  const configDirectory = dirname(configPath);
  const lockPath = `${configPath}.lock`;
  mkdirSync(configDirectory, { recursive: true });
  const lock = acquireGlobalConfigLock(configPath, lockPath);
  const temporaryPath = `${configPath}.${lock.acquisitionId}.tmp`;

  try {
    const currentRaw = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null;
    const previousRevision = globalConfigRevision(currentRaw);
    if (options.expectedRevision !== undefined && options.expectedRevision !== previousRevision) {
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_REVISION_CONFLICT", {
        configPath,
        expectedRevision: options.expectedRevision,
        actualRevision: previousRevision,
      });
    }
    let current: KilnGlobalConfig | null;
    let invalidBackupPath: string | undefined;
    try {
      current = parseGlobalConfigRaw(currentRaw);
    } catch (error) {
      if (currentRaw === null || options.invalidCurrent !== "backup-and-replace") throw error;
      const mode = statSync(configPath).mode & 0o777;
      invalidBackupPath = `${configPath}.invalid-${lock.acquisitionId}.bak`;
      try {
        writeFileSync(invalidBackupPath, currentRaw, { encoding: "utf-8", flag: "wx", mode });
      } catch (backupError) {
        throw new GlobalConfigMutationError(
          "GLOBAL_CONFIG_WRITE_FAILED",
          { configPath, invalidBackupPath },
          backupError,
        );
      }
      current = null;
    }
    const next = mutation(current);
    validateGlobalConfig(next);
    const serialized = stringify(next);
    if (current !== null && JSON.stringify(current) === JSON.stringify(next)) {
      return {
        config: next,
        previousRevision,
        revision: previousRevision,
        ...(invalidBackupPath === undefined ? {} : { invalidBackupPath }),
      };
    }
    const mode = currentRaw === null ? 0o600 : statSync(configPath).mode & 0o777;
    try {
      writeFileSync(temporaryPath, serialized, { encoding: "utf-8", mode });
      if (currentRaw !== null) chmodSync(temporaryPath, mode);
      // Node replaces an existing destination on Windows and POSIX; never unlink
      // the canonical path first because that would expose a missing-config gap.
      renameSync(temporaryPath, configPath);
    } catch (error) {
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_WRITE_FAILED", {
        configPath,
        ...(invalidBackupPath === undefined ? {} : { invalidBackupPath }),
      }, error);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
    return {
      config: next,
      previousRevision,
      revision: globalConfigRevision(serialized),
      ...(invalidBackupPath === undefined ? {} : { invalidBackupPath }),
    };
  } finally {
    releaseGlobalConfigLock(lockPath, lock);
  }
}

interface GlobalConfigLockOwner {
  readonly pid: number;
  readonly acquiredAt: string;
  readonly acquisitionId: string;
}

interface AcquiredGlobalConfigLock extends GlobalConfigLockOwner {
  readonly descriptor: number;
}

function acquireGlobalConfigLock(configPath: string, lockPath: string): AcquiredGlobalConfigLock {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const owner: GlobalConfigLockOwner = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      acquisitionId: randomUUID(),
    };
    let descriptor: number;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (isNodeErrorWithCode(error, "EEXIST")) {
        const existingOwner = readGlobalConfigLockOwner(lockPath);
        if (existingOwner !== null && !isProcessAlive(existingOwner.pid)) {
          const recoveryPath = `${lockPath}.recovery-${randomUUID()}`;
          try {
            renameSync(lockPath, recoveryPath);
          } catch (claimError) {
            if (isNodeErrorWithCode(claimError, "ENOENT")) continue;
            throw new GlobalConfigMutationError("GLOBAL_CONFIG_LOCK_UNAVAILABLE", {
              configPath,
              lockOwnerPid: existingOwner.pid,
              lockAcquiredAt: existingOwner.acquiredAt,
            }, claimError);
          }
          try {
            const claimedOwner = readGlobalConfigLockOwner(recoveryPath);
            if (claimedOwner?.acquisitionId === existingOwner.acquisitionId) {
              rmSync(`${configPath}.${claimedOwner.acquisitionId}.tmp`, { force: true });
            }
          } finally {
            rmSync(recoveryPath, { force: true });
          }
          continue;
        }
        throw new GlobalConfigMutationError("GLOBAL_CONFIG_LOCK_UNAVAILABLE", {
          configPath,
          ...(existingOwner === null ? {} : {
            lockOwnerPid: existingOwner.pid,
            lockAcquiredAt: existingOwner.acquiredAt,
          }),
        }, error);
      }
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_LOCK_UNAVAILABLE", { configPath }, error);
    }
    try {
      writeFileSync(descriptor, JSON.stringify(owner), { encoding: "utf-8" });
      fsyncSync(descriptor);
      return { ...owner, descriptor };
    } catch (error) {
      try {
        releaseGlobalConfigLock(lockPath, { ...owner, descriptor });
      } catch {
        // The release path always closes the descriptor and never removes an
        // unclaimed canonical lock path.
      }
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_LOCK_UNAVAILABLE", { configPath }, error);
    }
  }
  throw new GlobalConfigMutationError("GLOBAL_CONFIG_LOCK_UNAVAILABLE", { configPath });
}

function releaseGlobalConfigLock(lockPath: string, lock: AcquiredGlobalConfigLock): void {
  const releasePath = `${lockPath}.release-${lock.acquisitionId}`;
  let claimed = false;
  try {
    renameSync(lockPath, releasePath);
    claimed = true;
  } finally {
    closeSync(lock.descriptor);
    if (claimed) rmSync(releasePath, { force: true });
  }
}

function readGlobalConfigLockOwner(lockPath: string): GlobalConfigLockOwner | null {
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf-8")) as unknown;
    if (!isRecord(value)
      || typeof value.pid !== "number"
      || !Number.isSafeInteger(value.pid)
      || value.pid <= 0
      || typeof value.acquiredAt !== "string"
      || Number.isNaN(Date.parse(value.acquiredAt))
      || typeof value.acquisitionId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.acquisitionId)
    ) return null;
    return value as unknown as GlobalConfigLockOwner;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeErrorWithCode(error, "ESRCH");
  }
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export function defaultGlobalConfig(): KilnGlobalConfig {
  return {
    version: CANONICAL_GLOBAL_CONFIG_VERSION,
    engines: {
      claude: { enabled: true, billing: "subscription" },
      codex: { enabled: false, billing: "plus-quota" },
      opencode: { enabled: false, billing: "free" },
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
  const routeId = config.executionRouting?.defaultRouteId;
  return config.executionCatalog?.routes.find((route) => route.id === routeId)?.providerId;
}

export function resolveGlobalDefaultModel(config: KilnGlobalConfig | null | undefined): string | undefined {
  if (!config) {
    return undefined;
  }
  const routeId = config.executionRouting?.defaultRouteId;
  return config.executionCatalog?.routes.find((route) => route.id === routeId)?.providerModelId;
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
  rejectUnknownFields(config, ROOT_FIELDS, "global config");
  validateRecordField(config, "identity");
  validateRecordField(config, "workGovernance");
  validateRecordField(config, "engines");
  validateRecordField(config, "executionCatalog");
  validateRecordField(config, "workerRouting");
  validateRecordField(config, "permissions");
  validateRecordField(config, "mcp");
  validateRecordField(config, "hooks");
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
  validateExecutionCatalog(config.executionCatalog, config.executionRouting);
  validateExecutionRouting(config.executionRouting, config.executionCatalog);
  validateWorkerRouting(config.workerRouting);
  validateSessionTurnBudget(config.sessionTurnBudget);
  validateComponents(config.components);
  validateOperatorVoice(config.operatorVoice);
  validateManagedAgents(config.managedAgents, config.operatorVoice as VoiceConfig | undefined);
  validateModelTaskSuitability(config.modelTaskSuitability);
  validateDeliberationPolicy(config.deliberationPolicy);
  validateSkills(config.skills);
  validateGlobalWeb(config.web);
  validateGlobalUi(config.ui, config.executionCatalog);
  validateGlobalModelGateway(config.modelGateway);
  validateManagedAccountPolicyReferences(config.managedAgents, config.executionCatalog);
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
  rejectUnknownFields(value, IDENTITY_FIELDS, "identity");
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
  rejectUnknownFields(
    value,
    GLOBAL_WEB_FIELDS,
    "global web",
    "Put web authority in project .kiln/kiln.yaml.",
  );
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
      && key !== "boundedWorkCeiling"
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
  validateBoundedWorkCeiling(value.boundedWorkCeiling);
}

function validateBoundedWorkCeiling(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("workGovernance.boundedWorkCeiling must be an object");
  rejectUnknownFields(value, ["allowedEffects", "allowedRoots", "deniedRoots", "maximumLimits", "minimumHarnessCapability"], "workGovernance.boundedWorkCeiling");
  validateOptionalStringArray(value.allowedEffects, "workGovernance.boundedWorkCeiling.allowedEffects");
  for (const effect of value.allowedEffects as readonly unknown[] ?? []) {
    if (!isBoundedWorkEffect(effect)) throw new KilnYamlError(`workGovernance.boundedWorkCeiling.allowedEffects contains unsupported effect: ${String(effect)}`);
  }
  validateOptionalStringArray(value.allowedRoots, "workGovernance.boundedWorkCeiling.allowedRoots");
  validateOptionalStringArray(value.deniedRoots, "workGovernance.boundedWorkCeiling.deniedRoots");
  if (value.minimumHarnessCapability !== undefined
    && value.minimumHarnessCapability !== "authoritative"
    && value.minimumHarnessCapability !== "partially_enforced"
    && value.minimumHarnessCapability !== "advisory_only") {
    throw new KilnYamlError("workGovernance.boundedWorkCeiling.minimumHarnessCapability is invalid");
  }
  if (value.maximumLimits !== undefined) {
    if (!isRecord(value.maximumLimits)) throw new KilnYamlError("workGovernance.boundedWorkCeiling.maximumLimits must be an object");
    const allowed = ["maxExecutionAttempts", "maxManagedInvocations", "maxConcurrentManagedInvocations", "maxChildDepth", "maxReviewRounds", "maxRemediationRounds", "maxToolCalls", "maxActiveDurationMs"];
    rejectUnknownFields(value.maximumLimits, allowed, "workGovernance.boundedWorkCeiling.maximumLimits");
    for (const [key, limit] of Object.entries(value.maximumLimits)) {
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0 || (key === "maxExecutionAttempts" && limit < 1)) {
        throw new KilnYamlError(`workGovernance.boundedWorkCeiling.maximumLimits.${key} must be ${key === "maxExecutionAttempts" ? "a positive" : "a non-negative"} safe integer`);
      }
    }
  }
}

function isBoundedWorkEffect(value: unknown): boolean {
  return value === "inspect" || value === "modify_source" || value === "modify_tests"
    || value === "modify_documentation" || value === "modify_configuration"
    || value === "run_verification" || value === "invoke_managed_agent" || value === "external_write";
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

function validateExecutionCatalog(value: unknown, routing: unknown): void {
  if (value === undefined) {
    if (routing !== undefined) throw new KilnYamlError("executionRouting requires executionCatalog");
    return;
  }
  if (!isRecord(value)) throw new KilnYamlError("executionCatalog must be an object");
  rejectUnknownFields(value, ["accounts", "accountPolicies", "routes"], "executionCatalog");
  if (!Array.isArray(value.accounts) || !Array.isArray(value.accountPolicies) || !Array.isArray(value.routes)) {
    throw new KilnYamlError("executionCatalog.accounts, executionCatalog.accountPolicies, and executionCatalog.routes must be arrays");
  }

  const accounts = new Map<string, Record<string, unknown>>();
  value.accounts.forEach((account, index) => {
    const path = `executionCatalog.accounts[${index}]`;
    if (!isRecord(account)) throw new KilnYamlError(`${path} must be an object`);
    rejectUnknownFields(account, ["id", "providerId", "credentialId", "maxConcurrency", "reservedAffinitySlots", "economics"], path);
    validateCanonicalId(account.id, `${path}.id`);
    validateCanonicalId(account.providerId, `${path}.providerId`);
    validateCanonicalId(account.credentialId, `${path}.credentialId`);
    if (accounts.has(account.id)) throw new KilnYamlError(`${path}.id must be unique`);
    if (typeof account.maxConcurrency !== "number" || !Number.isSafeInteger(account.maxConcurrency) || account.maxConcurrency < 1) {
      throw new KilnYamlError(`${path}.maxConcurrency must be a positive integer`);
    }
    if (!Number.isSafeInteger(account.reservedAffinitySlots) || Number(account.reservedAffinitySlots) < 0 || Number(account.reservedAffinitySlots) > account.maxConcurrency) {
      throw new KilnYamlError(`${path}.reservedAffinitySlots must be a non-negative integer no greater than maxConcurrency`);
    }
    validateExecutionAccountEconomics(account.economics, `${path}.economics`);
    accounts.set(account.id, account);
  });

  const policies = new Map<string, Record<string, unknown>>();
  value.accountPolicies.forEach((policy, index) => {
    const path = `executionCatalog.accountPolicies[${index}]`;
    if (!isRecord(policy)) throw new KilnYamlError(`${path} must be an object`);
    rejectUnknownFields(policy, ["id", "accountIds", "strategy"], path);
    validateCanonicalId(policy.id, `${path}.id`);
    if (policies.has(policy.id)) throw new KilnYamlError(`${path}.id must be unique`);
    if (!Array.isArray(policy.accountIds) || policy.accountIds.length === 0) throw new KilnYamlError(`${path}.accountIds must be a non-empty array`);
    if (policy.strategy !== "economic-least-pressure") throw new KilnYamlError(`${path}.strategy must be "economic-least-pressure"`);
    const policyAccountIds = new Set<string>();
    let providerId: string | undefined;
    policy.accountIds.forEach((accountId, accountIndex) => {
      validateCanonicalId(accountId, `${path}.accountIds[${accountIndex}]`);
      if (!accounts.has(accountId)) throw new KilnYamlError(`${path}.accountIds[${accountIndex}] references an unknown account`);
      if (policyAccountIds.has(accountId)) throw new KilnYamlError(`${path}.accountIds[${accountIndex}] must be unique`);
      policyAccountIds.add(accountId);
      const accountProviderId = accounts.get(accountId)!.providerId as string;
      if (providerId !== undefined && providerId !== accountProviderId) throw new KilnYamlError(`${path}.accountIds must all reference accounts from one provider`);
      providerId = accountProviderId;
    });
    policies.set(policy.id, policy);
  });

  const routeIds = new Set<string>();
  value.routes.forEach((route, index) => {
    const path = `executionCatalog.routes[${index}]`;
    if (!isRecord(route)) throw new KilnYamlError(`${path} must be an object`);
    rejectUnknownFields(route, ["id", "label", "providerId", "providerModelId", "accountSelection", "dataClassification", "dataPolicyEvidence", "economics"], path);
    validateCanonicalId(route.id, `${path}.id`);
    if (routeIds.has(route.id)) throw new KilnYamlError(`${path}.id must be unique`);
    routeIds.add(route.id);
    validateRequiredNonEmptyString(route, "label", `${path}.label`);
    validateCanonicalId(route.providerId, `${path}.providerId`);
    validateRequiredNonEmptyString(route, "providerModelId", `${path}.providerModelId`);
    if (!["public", "internal", "confidential", "restricted"].includes(String(route.dataClassification))) {
      throw new KilnYamlError(`${path}.dataClassification is invalid`);
    }
    validateExecutionRouteDataPolicyEvidence(route.dataPolicyEvidence, `${path}.dataPolicyEvidence`);
    validateRouteAccountSelection(route.accountSelection, path, route.providerId, accounts, policies);
    validateExecutionRouteEconomics(route.economics, `${path}.economics`);
  });
  try {
    defineExecutionCatalog(value as unknown as ExecutionCatalog);
  } catch (error) {
    throw new KilnYamlError(`Invalid executionCatalog: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Atomically reads validated global configuration and its optimistic-write revision. */
export function readGlobalConfigSnapshot(): { readonly config: KilnGlobalConfig | null; readonly revision: string } {
  const configPath = resolveGlobalConfigPath();
  const raw = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null;
  return { config: parseGlobalConfigRaw(raw), revision: globalConfigRevision(raw) };
}

function validateExecutionRouteDataPolicyEvidence(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, [
    "providerId", "providerModelId", "dataUse", "trainingPosture", "retention",
    "permittedMaximumClassification", "permittedClassifications", "sourceIdentity", "sourceRevision",
    "sourceDigest", "observedAt", "expiresAt",
  ], path);
  validateCanonicalId(value.providerId, `${path}.providerId`);
  validateRequiredNonEmptyString(value, "providerModelId", `${path}.providerModelId`);
  if (value.dataUse !== "not-used" && value.dataUse !== "service-operation") throw new KilnYamlError(`${path}.dataUse is invalid`);
  if (value.trainingPosture !== "prohibited" && value.trainingPosture !== "permitted") throw new KilnYamlError(`${path}.trainingPosture is invalid`);
  if (!isRecord(value.retention)) throw new KilnYamlError(`${path}.retention must be an object`);
  rejectUnknownFields(value.retention, ["posture", "days"], `${path}.retention`);
  if (value.retention.posture !== "zero" && value.retention.posture !== "bounded") throw new KilnYamlError(`${path}.retention.posture is invalid`);
  if (!Number.isSafeInteger(value.retention.days) || Number(value.retention.days) < 0) throw new KilnYamlError(`${path}.retention.days is invalid`);
  if (!["public", "internal", "confidential", "restricted"].includes(String(value.permittedMaximumClassification))) throw new KilnYamlError(`${path}.permittedMaximumClassification is invalid`);
  if (!Array.isArray(value.permittedClassifications) || value.permittedClassifications.length === 0) throw new KilnYamlError(`${path}.permittedClassifications must be a non-empty array`);
  validateCanonicalId(value.sourceIdentity, `${path}.sourceIdentity`);
  validateCanonicalId(value.sourceRevision, `${path}.sourceRevision`);
  if (typeof value.sourceDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.sourceDigest)) throw new KilnYamlError(`${path}.sourceDigest must be a sha256 digest`);
  validateRequiredNonEmptyString(value, "observedAt", `${path}.observedAt`);
  validateRequiredNonEmptyString(value, "expiresAt", `${path}.expiresAt`);
}

function validateExecutionAccountEconomics(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["capacityIdentity", "subscriptionClass", "quotaClassId", "creditPosture", "overagePosture"], path);
  validateRequiredNonEmptyString(value, "capacityIdentity", `${path}.capacityIdentity`);
  if (!["subscription", "included", "free", "metered", "unknown"].includes(String(value.subscriptionClass))) throw new KilnYamlError(`${path}.subscriptionClass is invalid`);
  validateRequiredNonEmptyString(value, "quotaClassId", `${path}.quotaClassId`);
  if (value.creditPosture !== "disabled" && value.creditPosture !== "committed") throw new KilnYamlError(`${path}.creditPosture is invalid`);
  if (value.overagePosture !== "disabled" && value.overagePosture !== "committed") throw new KilnYamlError(`${path}.overagePosture is invalid`);
}

function validateExecutionRouteEconomics(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["adapterCapabilityId", "adapterCapabilityVersion", "authBillingChannel", "executionMode", "serviceTier", "rateCardBasis", "envelopeSemantics", "fallbackPosture", "overagePosture", "contextClass", "cacheClass", "priceEvidence", "auxiliaryCharges", "executionEnvelope"], path);
  for (const field of ["adapterCapabilityId", "adapterCapabilityVersion", "authBillingChannel", "executionMode", "serviceTier", "rateCardBasis", "envelopeSemantics", "contextClass", "cacheClass"]) validateRequiredNonEmptyString(value, field, `${path}.${field}`);
  if (value.fallbackPosture !== "disabled" && value.fallbackPosture !== "committed") throw new KilnYamlError(`${path}.fallbackPosture is invalid`);
  if (value.overagePosture !== "disabled" && value.overagePosture !== "committed") throw new KilnYamlError(`${path}.overagePosture is invalid`);
  validateExecutionPriceEvidence(value.priceEvidence, `${path}.priceEvidence`);
  if (!Array.isArray(value.auxiliaryCharges)) throw new KilnYamlError(`${path}.auxiliaryCharges must be an array`);
  value.auxiliaryCharges.forEach((charge, index) => {
    const chargePath = `${path}.auxiliaryCharges[${index}]`;
    if (!isRecord(charge)) throw new KilnYamlError(`${chargePath} must be an object`);
    rejectUnknownFields(charge, ["id", "amount"], chargePath);
    validateCanonicalId(charge.id, `${chargePath}.id`);
    validateEconomicAmount(charge.amount, `${chargePath}.amount`);
  });
  if (!isRecord(value.executionEnvelope)) throw new KilnYamlError(`${path}.executionEnvelope must be an object`);
  rejectUnknownFields(value.executionEnvelope, ["limits"], `${path}.executionEnvelope`);
  if (!Array.isArray(value.executionEnvelope.limits)) throw new KilnYamlError(`${path}.executionEnvelope.limits must be an array`);
  value.executionEnvelope.limits.forEach((limit, index) => validateEconomicAmount(limit, `${path}.executionEnvelope.limits[${index}]`));
}

function validateExecutionPriceEvidence(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  const kind = value.kind;
  if (!["subscription", "included", "free", "metered", "unknown", "estimated"].includes(String(kind))) throw new KilnYamlError(`${path}.kind is invalid`);
  const fields = kind === "included" ? ["kind", "allowanceId", "rateCardId", "rateCardRevision", "evidence"]
    : kind === "metered" || kind === "estimated" ? ["kind", ...(kind === "estimated" ? ["estimationMethod"] : []), "rateCardId", "rateCardRevision", "unitPrices", "evidence"]
      : kind === "unknown" ? ["kind", "reason", "rateCardId", "rateCardRevision", "evidence"]
        : ["kind", "rateCardId", "rateCardRevision", "evidence"];
  rejectUnknownFields(value, fields, path);
  for (const field of fields.filter((field) => !["kind", "evidence", "unitPrices"].includes(field))) validateRequiredNonEmptyString(value, field, `${path}.${field}`);
  validateExecutionEconomicEvidence(value.evidence, `${path}.evidence`);
  if (kind === "metered" || kind === "estimated") {
    if (!Array.isArray(value.unitPrices)) throw new KilnYamlError(`${path}.unitPrices must be an array`);
    value.unitPrices.forEach((unitPrice, index) => {
      const unitPath = `${path}.unitPrices[${index}]`;
      if (!isRecord(unitPrice)) throw new KilnYamlError(`${unitPath} must be an object`);
      rejectUnknownFields(unitPrice, ["usageUnit", "price"], unitPath);
      validateRequiredNonEmptyString(unitPrice, "usageUnit", `${unitPath}.usageUnit`);
      validateEconomicAmount(unitPrice.price, `${unitPath}.price`);
    });
  }
}

function validateExecutionEconomicEvidence(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["sourceIdentity", "sourceRevision", "sourceDigest", "observedAt", "validUntil", "confidence", "authority"], path);
  for (const field of ["sourceIdentity", "sourceRevision", "sourceDigest", "observedAt", "validUntil"]) validateRequiredNonEmptyString(value, field, `${path}.${field}`);
  if (!["high", "medium", "low"].includes(String(value.confidence))) throw new KilnYamlError(`${path}.confidence is invalid`);
  if (!["provider-reported", "configured", "calculated-estimate"].includes(String(value.authority))) throw new KilnYamlError(`${path}.authority is invalid`);
}

function validateRouteAccountSelection(
  value: unknown,
  routePath: string,
  providerId: unknown,
  accounts: ReadonlyMap<string, Record<string, unknown>>,
  policies: ReadonlyMap<string, Record<string, unknown>>,
): void {
  const path = `${routePath}.accountSelection`;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["mode", "accountPolicyId", "accountId"], path);
  if (value.mode === "automatic") {
    validateCanonicalId(value.accountPolicyId, `${path}.accountPolicyId`);
    if (value.accountId !== undefined) throw new KilnYamlError(`${path}.automatic mode cannot set accountId`);
    const policy = policies.get(value.accountPolicyId);
    if (!policy) throw new KilnYamlError(`${path}.accountPolicyId references an unknown account policy`);
    const policyProviderId = accounts.get((policy.accountIds as readonly string[])[0]!)!.providerId;
    if (policyProviderId !== providerId) throw new KilnYamlError(`${path}.accountPolicyId provider must match route providerId`);
    return;
  }
  if (value.mode === "exact") {
    validateCanonicalId(value.accountId, `${path}.accountId`);
    if (value.accountPolicyId !== undefined) throw new KilnYamlError(`${path}.exact mode cannot set accountPolicyId`);
    const account = accounts.get(value.accountId);
    if (!account) throw new KilnYamlError(`${path}.accountId references an unknown account`);
    if (account.providerId !== providerId) throw new KilnYamlError(`${path}.accountId provider must match route providerId`);
    return;
  }
  throw new KilnYamlError(`${path}.mode must be "automatic" or "exact"`);
}

function validateExecutionRouting(value: unknown, executionCatalog: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("executionRouting must be an object");
  rejectUnknownFields(value, ["defaultRouteId"], "executionRouting");
  validateCanonicalId(value.defaultRouteId, "executionRouting.defaultRouteId");
  if (!isRecord(executionCatalog) || !Array.isArray(executionCatalog.routes)) throw new KilnYamlError("executionRouting requires executionCatalog.routes");
  const routeIds = new Set(executionCatalog.routes.map((route) => isRecord(route) ? route.id : undefined));
  if (!routeIds.has(value.defaultRouteId)) throw new KilnYamlError("executionRouting.defaultRouteId references an unknown route");
}

function validateWorkerRouting(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("workerRouting must be an object");
  rejectUnknownFields(value, ["defaultWorker", "fallback", "routes"], "workerRouting");
  if (value.defaultWorker !== undefined && typeof value.defaultWorker !== "string") throw new KilnYamlError("workerRouting.defaultWorker must be a string");
  if (value.fallback !== undefined && typeof value.fallback !== "string") throw new KilnYamlError("workerRouting.fallback must be a string");
  if (value.routes !== undefined) {
    if (!Array.isArray(value.routes)) throw new KilnYamlError("workerRouting.routes must be an array");
    value.routes.forEach((route, index) => validateWorkerRoutingRoute(route, index));
  }
}

function validateSessionTurnBudget(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("sessionTurnBudget must be an object");
  rejectUnknownFields(value, ["tokenLimit", "action"], "sessionTurnBudget");
  if (!Number.isSafeInteger(value.tokenLimit) || (value.tokenLimit as number) <= 0) throw new KilnYamlError("sessionTurnBudget.tokenLimit must be a positive safe integer");
  if (value.action !== "stop") throw new KilnYamlError("sessionTurnBudget.action must be \"stop\"");
}

function validateWorkerRoutingRoute(value: unknown, index: number): void {
  if (!isRecord(value)) throw new KilnYamlError(`workerRouting.routes[${index}] must be an object`);
  if (typeof value.provider !== "string" || value.provider.trim().length === 0) throw new KilnYamlError(`workerRouting.routes[${index}].provider must be a non-empty string`);
  if (value.model !== undefined && typeof value.model !== "string") throw new KilnYamlError(`workerRouting.routes[${index}].model must be a string`);
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

const GLOBAL_UI_FIELDS = fieldNamesOf<KilnGlobalUiConfig>({
  theme: true,
  executionRouteSelection: true,
});

function validateGlobalUi(value: unknown, executionCatalog: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("ui must be an object");
  }
  rejectUnknownFields(value, GLOBAL_UI_FIELDS, "global ui");
  if (value.theme !== undefined && typeof value.theme !== "string") {
    throw new KilnYamlError("ui.theme must be a string");
  }
  if (value.executionRouteSelection === undefined) {
    return;
  }
  if (!isRecord(value.executionRouteSelection)) {
    throw new KilnYamlError("ui.executionRouteSelection must be an object");
  }
  const selection = value.executionRouteSelection;
  const executionRouteSelectionFields = new Set(["routeId", "accountOverrideId"]);
  for (const key of Object.keys(selection)) {
    if (!executionRouteSelectionFields.has(key)) {
      throw new KilnYamlError(`Unknown global ui.executionRouteSelection field: ${key}`);
    }
  }
  validateCanonicalId(selection.routeId, "ui.executionRouteSelection.routeId");
  if (!isRecord(executionCatalog) || !Array.isArray(executionCatalog.routes)) {
    throw new KilnYamlError("ui.executionRouteSelection requires executionCatalog.routes");
  }
  const selectedRoute = executionCatalog.routes.find((route) => isRecord(route) && route.id === selection.routeId);
  if (!isRecord(selectedRoute)) {
    throw new KilnYamlError("ui.executionRouteSelection.routeId references an unknown route");
  }
  if (selection.accountOverrideId !== undefined) {
    validateCanonicalId(selection.accountOverrideId, "ui.executionRouteSelection.accountOverrideId");
    const routeSelection = selectedRoute.accountSelection;
    if (!isRecord(routeSelection) || routeSelection.mode !== "automatic") {
      throw new KilnYamlError("ui.executionRouteSelection.accountOverrideId requires an automatic route");
    }
    if (!Array.isArray(executionCatalog.accountPolicies)) {
      throw new KilnYamlError("ui.executionRouteSelection.accountOverrideId requires executionCatalog.accountPolicies");
    }
    const policy = executionCatalog.accountPolicies.find((entry) => isRecord(entry) && entry.id === routeSelection.accountPolicyId);
    if (!isRecord(policy) || !Array.isArray(policy.accountIds) || !policy.accountIds.includes(selection.accountOverrideId)) {
      throw new KilnYamlError("ui.executionRouteSelection.accountOverrideId is not eligible for the selected route");
    }
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
    if (key !== "builtin" && key !== "selection" && key !== "visibility" && key !== "externalCatalog") {
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
  if (value.visibility !== undefined) {
    validateSkillVisibilityConfig(value.visibility);
  }
  if (value.externalCatalog !== undefined) validateExternalCatalogPolicy(value.externalCatalog);
}

function validateExternalCatalogPolicy(value: unknown): void {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.harnesses)) {
    throw new KilnYamlError("skills.externalCatalog must declare version: 1 and a harnesses object");
  }
  for (const key of Object.keys(value)) if (key !== "version" && key !== "harnesses") throw new KilnYamlError(`Unknown skills.externalCatalog field: ${key}`);
  for (const key of Object.keys(value.harnesses)) {
    if (key !== "codex" && key !== "claude" && key !== "opencode") throw new KilnYamlError(`Unknown skills.externalCatalog harness: ${key}`);
    if (key !== "codex") throw new KilnYamlError(`skills.externalCatalog.${key} is unsupported by this build`);
  }
  if (!isRecord(value.harnesses.codex) || !Array.isArray(value.harnesses.codex.keepImplicit)
    || typeof value.harnesses.codex.expectedFingerprint !== "string"
    || !/^sha256:[a-f0-9]{64}$/u.test(value.harnesses.codex.expectedFingerprint)) {
    throw new KilnYamlError("skills.externalCatalog.harnesses.codex requires expectedFingerprint and keepImplicit array");
  }
  for (const key of Object.keys(value.harnesses.codex)) if (key !== "keepImplicit" && key !== "expectedFingerprint") throw new KilnYamlError(`Unknown skills.externalCatalog.harnesses.codex field: ${key}`);
  const sourceIds = new Set<string>();
  for (const decision of value.harnesses.codex.keepImplicit) {
    if (!isRecord(decision) || typeof decision.sourceId !== "string" || decision.sourceId.length === 0
      || typeof decision.packageDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(decision.packageDigest)) {
      throw new KilnYamlError("skills.externalCatalog.harnesses.codex.keepImplicit entries require sourceId and sha256 packageDigest");
    }
    for (const key of Object.keys(decision)) if (key !== "sourceId" && key !== "packageDigest") throw new KilnYamlError(`Unknown external catalog decision field: ${key}`);
    if (sourceIds.has(decision.sourceId)) throw new KilnYamlError(`Duplicate external catalog sourceId: ${decision.sourceId}`);
    sourceIds.add(decision.sourceId);
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
  const hasDirectRoute = Array.isArray(value.routes) && value.routes.some(
    (route) => isRecord(route) && route.kind === "direct",
  );
  if (hasDirectRoute && value.schemaVersion !== 2) {
    throw new KilnYamlError(
      "managedAgents direct routes require schemaVersion 2; no automatic migration can infer execution-route authority. See docs/guides/global-config.md#managed-economic-policy-schema-v2.",
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
    "executionRouteId",
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
    "remoteHarness",
    "externalRuntimeAttachment",
  ], `managedAgents.routes[${index}]`);
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new KilnYamlError(`managedAgents.routes[${index}].id is required`);
  }
  if (value.kind !== "harness" && value.kind !== "direct") {
    throw new KilnYamlError(`managedAgents.routes[${index}].kind must be "harness" or "direct"`);
  }
  if (value.kind === "direct") {
    if (typeof value.executionRouteId !== "string" || value.executionRouteId.trim().length === 0) {
      throw new KilnYamlError(`managedAgents.routes[${index}].executionRouteId is required`);
    }
    validateCanonicalId(value.executionRouteId, `managedAgents.routes[${index}].executionRouteId`);
    if (value.provider !== undefined || value.model !== undefined || value.remoteHarness !== undefined) {
      throw new KilnYamlError(
        `managedAgents.routes[${index}] direct routes may only select an executionRouteId; provider, model, and remoteHarness belong to harness routes`,
      );
    }
  } else {
    if (typeof value.provider !== "string" || value.provider.trim().length === 0) {
      throw new KilnYamlError(`managedAgents.routes[${index}].provider is required`);
    }
    if (value.executionRouteId !== undefined) {
      throw new KilnYamlError(`managedAgents.routes[${index}] harness routes cannot declare executionRouteId`);
    }
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

function validateManagedAccountPolicyReferences(managedAgents: unknown, executionCatalog: unknown): void {
  if (!isRecord(managedAgents) || !Array.isArray(managedAgents.economicPolicies)) return;
  if (!isRecord(executionCatalog)) {
    throw new KilnYamlError("managedAgents.economicPolicies require executionCatalog");
  }
  const routes = Array.isArray(managedAgents.routes) ? managedAgents.routes.filter(isRecord) : [];
  const executionRoutes = Array.isArray(executionCatalog.routes)
    ? executionCatalog.routes.filter(isRecord)
    : [];
  const accounts = Array.isArray(executionCatalog.accounts)
    ? executionCatalog.accounts.filter(isRecord)
    : [];
  const accountPolicies = Array.isArray(executionCatalog.accountPolicies)
    ? executionCatalog.accountPolicies.filter(isRecord)
    : [];
  for (let policyIndex = 0; policyIndex < managedAgents.economicPolicies.length; policyIndex += 1) {
    const economicPolicy = managedAgents.economicPolicies[policyIndex];
    if (!isRecord(economicPolicy) || !Array.isArray(economicPolicy.candidates)) continue;
    for (let candidateIndex = 0; candidateIndex < economicPolicy.candidates.length; candidateIndex += 1) {
      const candidate = economicPolicy.candidates[candidateIndex];
      if (!isRecord(candidate)) continue;
      const path = `managedAgents.economicPolicies[${policyIndex}].candidates[${candidateIndex}]`;
      const route = routes.find((entry) => entry.id === candidate.routeId);
      if (!route) throw new KilnYamlError(`${path}.routeId must reference managedAgents.routes`);
      if (route.kind !== "direct" || typeof route.executionRouteId !== "string") {
        throw new KilnYamlError(`${path}.routeId must reference a direct managed route with executionRouteId`);
      }
      const executionRoute = executionRoutes.find((entry) => entry.id === route.executionRouteId);
      if (!executionRoute || !isDirectProviderId(String(executionRoute.providerId))) {
        throw new KilnYamlError(`${path}.routeId must reference a supported direct execution route`);
      }
      const selection = isRecord(executionRoute.accountSelection) ? executionRoute.accountSelection : undefined;
      if (!selection || selection.mode !== "automatic" || typeof selection.accountPolicyId !== "string") {
        throw new KilnYamlError(`${path}.routeId must reference an automatic execution route for managed economics`);
      }
      const accountPolicy = accountPolicies.find((entry) => entry.id === selection.accountPolicyId);
      if (!accountPolicy || !Array.isArray(accountPolicy.accountIds)) {
        throw new KilnYamlError(`${path}.routeId must reference an execution route with a valid account policy`);
      }
      const economics = isRecord(executionRoute.economics) ? executionRoute.economics : undefined;
      if (!economics) throw new KilnYamlError(`${path}.routeId must reference execution route economics`);
      const domain = Array.isArray(economicPolicy.comparisonDomains)
        ? economicPolicy.comparisonDomains.find((entry) =>
            isRecord(entry) && entry.id === candidate.comparisonDomainId)
        : undefined;
      if (!isRecord(domain)) {
        throw new KilnYamlError(`${path}.comparisonDomainId must reference a policy comparison domain`);
      }
      if (domain.rateCardBasis !== economics.rateCardBasis) {
        throw new KilnYamlError(`${path} comparison domain rateCardBasis must match route economics`);
      }
      if (domain.envelopeSemantics !== economics.envelopeSemantics) {
        throw new KilnYamlError(`${path} comparison domain envelopeSemantics must match route economics`);
      }
      validateReservationPriceClass(
        candidate.worstCaseReservation,
        isRecord(economics.priceEvidence) ? economics.priceEvidence.kind : undefined,
        path,
      );
      validateRouteEconomicSchemes(economics, domain, path);
      validateDerivedRouteReservation(candidate.worstCaseReservation, economics, domain, path);
      if (economics.fallbackPosture !== "disabled" || economics.overagePosture !== "disabled") {
        throw new KilnYamlError(`${path}.routeId cannot activate uncommitted fallback or overage`);
      }
      for (const accountId of accountPolicy.accountIds) {
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

/**
 * Single emission point for unknown-field rejections.
 *
 * The diagnostic names the build that produced it because an unknown field is
 * ambiguous on its own: it means either the operator wrote a field that does
 * not exist, or the running build predates a field that does.
 */
function rejectUnknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
  hint?: string,
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) {
      continue;
    }
    throw new KilnYamlError(
      `Unknown ${path} field: ${key}.${hint === undefined ? "" : ` ${hint}`}`
      + ` Validated by ${describeRunningCliBuild()};`
      + " if this field exists at HEAD, the running build predates it.",
    );
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
