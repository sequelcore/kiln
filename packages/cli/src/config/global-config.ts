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
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "yaml";
import {
  parseGatewayYaml,
  validateVoiceConfig,
  resolveCommunicationIntent,
  MANAGED_AGENT_ADMISSION_PROFILES,
  validateManagedEconomicAmount,
  type ManagedEconomicAmount,
  type ModelGatewayConfig,
  type VoiceConfig,
  type ExecutionCatalog,
  type CommunicationIntent,
} from "@kilnai/core";
import { describeRunningCliBuild } from "../build-identity.js";
import { KilnYamlError } from "../kiln-yaml.js";
import { DEFAULT_WORK_GOVERNANCE_CONFIG, validateAgentScopeInheritance } from "../kiln-yaml-types.js";
import { readMcpConfigurationSource } from "./mcp-config.js";
import { validateSkillVisibilityConfig } from "./skill-visibility.js";
import {
  projectExecutionCatalogFromIntent,
  readExecutionTargetEvidenceSnapshot,
  type ExecutionTargetEvidenceRevision,
  type ExecutionTargetEvidenceSnapshot,
} from "./execution-target-evidence-store.js";
import {
  CANONICAL_GLOBAL_CONFIG_VERSION,
  GLOBAL_CONFIG_SCHEMA,
  parseGlobalConfigStructure,
  type KilnEngineBilling,
  type KilnGlobalConfig,
  type KilnGlobalIdentity,
  type KilnGlobalUiConfig,
  type KilnGlobalWebConfig,
} from "./global-config-schema.js";
export { CANONICAL_GLOBAL_CONFIG_VERSION } from "./global-config-schema.js";
export type {
  KilnEngineBilling,
  KilnGlobalComponentsConfig,
  KilnGlobalConfig,
  KilnGlobalEngineConfig,
  KilnGlobalIdentity,
  KilnGlobalPermissionCeilingConfig,
  KilnGlobalUiConfig,
  KilnGlobalUiTargetSelectionConfig,
  KilnGlobalVerificationConfig,
  KilnGlobalWebConfig,
  KilnSessionTurnBudgetConfig,
  KilnTargetRoutingConfig,
} from "./global-config-schema.js";

/**
 * Field allowlists are derived from the interfaces they guard: a field added to
 * an interface without a matching entry here fails typecheck instead of being
 * rejected at runtime as an unknown field.
 */
function fieldNamesOf<T>(fields: Record<keyof T, true>): readonly string[] {
  return Object.keys(fields);
}

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
    const parsed: unknown = parse(raw);
    validateGlobalConfig(parsed);
    return parsed;
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
    const parsed: unknown = parse(raw);
    validateGlobalConfig(parsed);
    return parsed;
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

export interface GlobalConfigMutationResult {
  readonly config: KilnGlobalConfig;
  readonly previousRevision: string;
  readonly revision: string;
  readonly invalidBackupPath?: string;
}

/**
 * Commits exact canonical bytes for the global configuration file.
 *
 * The configuration mutation authority produces content by editing the YAML
 * document tree, which preserves operator comments, ordering, and scalar style.
 * Re-serializing that content from a plain object would discard exactly what
 * ADR-014 requires be kept, so this writer commits the admitted bytes verbatim
 * under the same lock, revision fence, validation, and atomic replacement as
 * every other global mutation.
 */
export function commitGlobalConfigBytes(input: {
  readonly content: string;
  readonly expectedRevision: string;
  /**
   * Retains the existing bytes before replacing a configuration that no longer
   * validates. Recovery from an unreadable config must never silently discard
   * what the operator had.
   */
  readonly invalidCurrent?: "backup-and-replace";
}): GlobalConfigMutationResult {
  const configPath = resolveGlobalConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  const lockPath = `${configPath}.lock`;
  const lock = acquireGlobalConfigLock(configPath, lockPath);
  const temporaryPath = `${configPath}.${lock.acquisitionId}.tmp`;

  try {
    const currentRaw = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null;
    const previousRevision = globalConfigRevision(currentRaw);
    if (input.expectedRevision !== previousRevision) {
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_REVISION_CONFLICT", {
        configPath,
        expectedRevision: input.expectedRevision,
        actualRevision: previousRevision,
      });
    }

    const next = parseGlobalConfigRaw(input.content);
    if (next === null) {
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_WRITE_FAILED", { configPath });
    }
    validateGlobalConfig(next);

    let invalidBackupPath: string | undefined;
    if (currentRaw !== null && input.invalidCurrent === "backup-and-replace" && !isValidGlobalConfigRaw(currentRaw)) {
      invalidBackupPath = `${configPath}.invalid-${lock.acquisitionId}.bak`;
      try {
        writeFileSync(invalidBackupPath, currentRaw, {
          encoding: "utf-8",
          flag: "wx",
          mode: statSync(configPath).mode & 0o777,
        });
      } catch (backupError) {
        throw new GlobalConfigMutationError("GLOBAL_CONFIG_WRITE_FAILED", { configPath, invalidBackupPath }, backupError);
      }
    }

    const mode = currentRaw === null ? 0o600 : statSync(configPath).mode & 0o777;
    try {
      writeFileSync(temporaryPath, input.content, { encoding: "utf-8", mode });
      if (currentRaw !== null) chmodSync(temporaryPath, mode);
      renameSync(temporaryPath, configPath);
    } catch (error) {
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_WRITE_FAILED", { configPath }, error);
    } finally {
      rmSync(temporaryPath, { force: true });
    }

    return {
      config: next,
      previousRevision,
      revision: globalConfigRevision(input.content),
      ...(invalidBackupPath === undefined ? {} : { invalidBackupPath }),
    };
  } finally {
    releaseGlobalConfigLock(lockPath, lock);
  }
}

function isValidGlobalConfigRaw(raw: string): boolean {
  try {
    return parseGlobalConfigRaw(raw) !== null;
  } catch {
    return false;
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
    permissionCeiling: {
      approval: "on-request",
      sandbox: "workspace-write",
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
  const targetId = config.targetRouting?.defaultTargetId;
  return config.targetCatalog?.targets.find((target) => target.id === targetId)?.providerId;
}

export function resolveGlobalDefaultModel(config: KilnGlobalConfig | null | undefined): string | undefined {
  if (!config) {
    return undefined;
  }
  const targetId = config.targetRouting?.defaultTargetId;
  return config.targetCatalog?.targets.find((target) => target.id === targetId)?.providerModelId;
}

export function resolveGlobalUiTheme(config: KilnGlobalConfig | null | undefined): string | undefined {
  return config?.ui?.theme;
}

export function validateGlobalConfig(config: unknown): asserts config is KilnGlobalConfig {
  if (!isRecord(config)) {
    throw new KilnYamlError("Global config must be an object");
  }
  if (config.version !== CANONICAL_GLOBAL_CONFIG_VERSION) {
    throw new KilnYamlError(
      `Global config version must be "${CANONICAL_GLOBAL_CONFIG_VERSION}". Recreate the canonical config through an explicit adoption flow.`,
    );
  }
  rejectUnknownFields(config, Object.keys(GLOBAL_CONFIG_SCHEMA.properties), "global config");
  validateRecordField(config, "identity");
  validateRecordField(config, "workGovernance");
  validateRecordField(config, "engines");
  validateRecordField(config, "targetCatalog");
  validateRecordField(config, "targetRouting");
  validateRecordField(config, "permissions");
  validateAgentScopeInheritance(config.permissions, "permissions");
  validateRecordField(config, "permissionCeiling");
  validateRecordField(config, "mcp");
  validateRecordField(config, "hooks");
  validateRecordField(config, "managedAgents");
  validateRecordField(config, "deliberationPolicy");
  validateRecordField(config, "communication");
  validateRecordField(config, "web");
  validateRecordField(config, "verification");
  validateRecordField(config, "ui");
  validateRecordField(config, "skills");
  validateRecordField(config, "components");
  validateRecordField(config, "operatorVoice");
  validateRecordField(config, "modelGateway");
  validateIdentity(config.identity);
  validateStringArray(config.activeInstructionProfiles, "activeInstructionProfiles");
  validateWorkGovernance(config.workGovernance);
  validateEngines(config.engines);
  validatePermissionCeiling(config.permissionCeiling);
  validateTargetCatalog(config.targetCatalog);
  validateTargetRouting(config.targetRouting, config.targetCatalog);
  validateAuthorityProfiles(config.authorityProfiles, config.operatorVoice as VoiceConfig | undefined);
  validateSessionTurnBudget(config.sessionTurnBudget);
  validateComponents(config.components);
  validateOperatorVoice(config.operatorVoice);
  validateManagedAgents(config.managedAgents, config.operatorVoice as VoiceConfig | undefined);
  validateModelTaskSuitability(config.modelTaskSuitability);
  validateDeliberationPolicy(config.deliberationPolicy);
  validateCommunication(config.communication, "communication", "global");
  validateSkills(config.skills);
  validateGlobalWeb(config.web);
  validateGlobalVerification(config.verification);
  validateGlobalUi(config.ui, config.targetCatalog);
  validateGlobalModelGateway(config.modelGateway);
  validateManagedTargetReferences(config.managedAgents, config.targetCatalog, config.authorityProfiles);
  readMcpConfigurationSource({
    value: config.mcp,
    scope: "global",
    sourcePath: resolveGlobalConfigPath(),
  });
  parseGlobalConfigStructure(config, resolveGlobalConfigPath());
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
    parseGatewayYaml(
      stringify({ port, apps: [], modelGateway: value }),
      `${resolveGlobalConfigPath()}#modelGateway`,
    );
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

function validateGlobalVerification(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("verification must be an object");
  rejectUnknownFields(value, ["formal"], "verification");
  if (!isRecord(value.formal)) throw new KilnYamlError("verification.formal must be an object");
  rejectUnknownFields(value.formal, ["dafny", "screening"], "verification.formal");
  if (!isRecord(value.formal.dafny)) {
    throw new KilnYamlError("verification.formal.dafny must be an object");
  }
  rejectUnknownFields(value.formal.dafny, ["executable", "expectedVersion"], "verification.formal.dafny");
  if (typeof value.formal.dafny.executable !== "string" || value.formal.dafny.executable.trim().length === 0) {
    throw new KilnYamlError("verification.formal.dafny.executable must be a non-empty string");
  }
  if (typeof value.formal.dafny.expectedVersion !== "string"
    || !isCanonicalDafnyVersion(value.formal.dafny.expectedVersion)) {
    throw new KilnYamlError("verification.formal.dafny.expectedVersion must be a canonical version");
  }
  const screening = value.formal.screening;
  if (screening === undefined) return;
  if (!isRecord(screening)) {
    throw new KilnYamlError("verification.formal.screening must be an object");
  }
  rejectUnknownFields(screening, ["packagePath", "lemmaScript"], "verification.formal.screening");
  validateAbsolutePath(screening.packagePath, "verification.formal.screening.packagePath");
  if (!isRecord(screening.lemmaScript)) {
    throw new KilnYamlError("verification.formal.screening.lemmaScript must be an object");
  }
  rejectUnknownFields(
    screening.lemmaScript,
    ["packageRoot", "entrypoint", "expectedVersion"],
    "verification.formal.screening.lemmaScript",
  );
  validateAbsolutePath(
    screening.lemmaScript.packageRoot,
    "verification.formal.screening.lemmaScript.packageRoot",
  );
  validateAbsolutePath(
    screening.lemmaScript.entrypoint,
    "verification.formal.screening.lemmaScript.entrypoint",
  );
  if (typeof screening.lemmaScript.expectedVersion !== "string"
    || !isCanonicalDafnyVersion(screening.lemmaScript.expectedVersion)) {
    throw new KilnYamlError(
      "verification.formal.screening.lemmaScript.expectedVersion must be a canonical version",
    );
  }
}

function validateAbsolutePath(value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || !isAbsolute(value)) {
    throw new KilnYamlError(`${path} must be an absolute path`);
  }
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

function validateOptionalRecord(record: Record<string, unknown>, key: string, path: string): void {
  const value = record[key];
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
}

function validatePermissionCeiling(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("permissionCeiling must be an object");
  rejectUnknownFields(value, ["approval", "sandbox"], "permissionCeiling");
  if (value.approval !== undefined
    && !["never", "on-request", "on-failure", "untrusted"].includes(String(value.approval))) {
    throw new KilnYamlError("permissionCeiling.approval is invalid");
  }
  if (value.sandbox !== undefined
    && !["read-only", "workspace-write", "danger-full-access"].includes(String(value.sandbox))) {
    throw new KilnYamlError("permissionCeiling.sandbox is invalid");
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

function validateTargetCatalog(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("targetCatalog must be an object");
  rejectUnknownFields(value, ["evidenceRevision", "accounts", "accountPolicies", "targets"], "targetCatalog");
  if (typeof value.evidenceRevision !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.evidenceRevision)) {
    throw new KilnYamlError("targetCatalog.evidenceRevision must be a sha256 digest");
  }
  if (!Array.isArray(value.accounts) || !Array.isArray(value.accountPolicies) || !Array.isArray(value.targets)) {
    throw new KilnYamlError("targetCatalog.accounts, targetCatalog.accountPolicies, and targetCatalog.targets must be arrays");
  }

  const accounts = new Map<string, Record<string, unknown>>();
  value.accounts.forEach((account, index) => {
    const path = `targetCatalog.accounts[${index}]`;
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
    validateExecutionAccountIntentEconomics(account.economics, `${path}.economics`);
    accounts.set(account.id, account);
  });

  const policies = new Map<string, Record<string, unknown>>();
  value.accountPolicies.forEach((policy, index) => {
    const path = `targetCatalog.accountPolicies[${index}]`;
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

  const targetIds = new Set<string>();
  value.targets.forEach((target, index) => {
    const path = `targetCatalog.targets[${index}]`;
    if (!isRecord(target)) throw new KilnYamlError(`${path} must be an object`);
    const common = ["id", "kind", "label", "providerId", "providerModelId"];
    rejectUnknownFields(target, target.kind === "direct"
      ? [...common, "accountSelection", "dataClassification", "economics"]
      : [...common, "dataClassification", "remoteHarness", "externalRuntimeAttachment"], path);
    validateCanonicalId(target.id, `${path}.id`);
    if (targetIds.has(target.id)) throw new KilnYamlError(`${path}.id must be unique`);
    targetIds.add(target.id);
    validateRequiredNonEmptyString(target, "label", `${path}.label`);
    validateCanonicalId(target.providerId, `${path}.providerId`);
    validateRequiredNonEmptyString(target, "providerModelId", `${path}.providerModelId`);
    if (!["public", "internal", "confidential", "restricted"].includes(String(target.dataClassification))) {
      throw new KilnYamlError(`${path}.dataClassification is invalid`);
    }
    if (target.kind === "harness") {
      validateManagedAgentRemoteHarness(target.remoteHarness, "harness", `${path}.remoteHarness`);
      if (isRecord(target.remoteHarness) && target.remoteHarness.limitations !== undefined) {
        throw new KilnYamlError(`${path}.remoteHarness.limitations is managed evidence and cannot be declared as intent`);
      }
      validateExternalRuntimeAttachment(target.externalRuntimeAttachment, `${path}.externalRuntimeAttachment`);
      return;
    }
    if (target.kind !== "direct") throw new KilnYamlError(`${path}.kind must be "direct" or "harness"`);
    validateRouteAccountSelection(target.accountSelection, path, target.providerId, accounts, policies);
    validateExecutionRouteIntentEconomics(target.economics, `${path}.economics`);
  });
}

/** Projects direct targets into Core's account-backed execution boundary. */
export function projectDirectExecutionCatalog(
  config: KilnGlobalConfig | null | undefined,
  evidence: ExecutionTargetEvidenceSnapshot | undefined,
  evidenceRevision: ExecutionTargetEvidenceRevision | undefined,
): ExecutionCatalog | undefined {
  const catalog = config?.targetCatalog;
  if (!catalog) return undefined;
  if (!evidence || !evidenceRevision) {
    throw new KilnYamlError(`Execution target catalog requires managed evidence revision ${catalog.evidenceRevision}.`);
  }
  try {
    const executionCatalog = projectExecutionCatalogFromIntent(catalog, evidence, evidenceRevision);
    validateManagedTargetReferences(
      config?.managedAgents,
      catalog,
      config?.authorityProfiles,
    );
    return executionCatalog;
  } catch (error) {
    throw new KilnYamlError(`Invalid execution target catalog: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Reads the exact managed-evidence revision referenced by operator intent and resolves Core runtime authority. */
export function readGlobalExecutionTargetAuthority(
  config: KilnGlobalConfig | null | undefined,
  options: { readonly globalConfigPath?: string } = {},
): {
  readonly evidence: ExecutionTargetEvidenceSnapshot;
  readonly executionCatalog: ExecutionCatalog;
} | undefined {
  const intent = config?.targetCatalog;
  if (!intent) return undefined;
  const evidence = readExecutionTargetEvidenceSnapshot({
    globalConfigPath: options.globalConfigPath ?? resolveGlobalConfigPath(),
    revision: intent.evidenceRevision,
  });
  const executionCatalog = projectDirectExecutionCatalog(config, evidence, intent.evidenceRevision);
  if (!executionCatalog) return undefined;
  return { evidence, executionCatalog };
}

export function readGlobalExecutionCatalog(
  config: KilnGlobalConfig | null | undefined,
  options: { readonly globalConfigPath?: string } = {},
): ExecutionCatalog | undefined {
  return readGlobalExecutionTargetAuthority(config, options)?.executionCatalog;
}

/** Atomically reads validated global configuration and its optimistic-write revision. */
export function readGlobalConfigSnapshot(): { readonly config: KilnGlobalConfig | null; readonly revision: string } {
  const configPath = resolveGlobalConfigPath();
  const raw = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null;
  return { config: parseGlobalConfigRaw(raw), revision: globalConfigRevision(raw) };
}

function validateExecutionAccountIntentEconomics(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["creditPosture", "overagePosture"], path);
  if (value.creditPosture !== "disabled" && value.creditPosture !== "committed") throw new KilnYamlError(`${path}.creditPosture is invalid`);
  if (value.overagePosture !== "disabled" && value.overagePosture !== "committed") throw new KilnYamlError(`${path}.overagePosture is invalid`);
}

function validateExecutionRouteIntentEconomics(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["authBillingChannel", "executionMode", "serviceTier", "fallbackPosture", "overagePosture", "executionEnvelope"], path);
  for (const field of ["authBillingChannel", "executionMode", "serviceTier"]) {
    validateRequiredNonEmptyString(value, field, `${path}.${field}`);
  }
  if (value.fallbackPosture !== "disabled" && value.fallbackPosture !== "committed") throw new KilnYamlError(`${path}.fallbackPosture is invalid`);
  if (value.overagePosture !== "disabled" && value.overagePosture !== "committed") throw new KilnYamlError(`${path}.overagePosture is invalid`);
  if (!isRecord(value.executionEnvelope)) throw new KilnYamlError(`${path}.executionEnvelope must be an object`);
  rejectUnknownFields(value.executionEnvelope, ["limits"], `${path}.executionEnvelope`);
  if (!Array.isArray(value.executionEnvelope.limits)) throw new KilnYamlError(`${path}.executionEnvelope.limits must be an array`);
  value.executionEnvelope.limits.forEach((limit, index) => validateEconomicAmount(limit, `${path}.executionEnvelope.limits[${index}]`));
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

function validateTargetRouting(value: unknown, targetCatalog: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("targetRouting must be an object");
  rejectUnknownFields(value, ["defaultTargetId"], "targetRouting");
  validateCanonicalId(value.defaultTargetId, "targetRouting.defaultTargetId");
  if (!isRecord(targetCatalog) || !Array.isArray(targetCatalog.targets)) throw new KilnYamlError("targetRouting requires targetCatalog.targets");
  const target = targetCatalog.targets.find((candidate) => isRecord(candidate) && candidate.id === value.defaultTargetId);
  if (!isRecord(target)) throw new KilnYamlError("targetRouting.defaultTargetId references an unknown target");
  if (target.kind !== "direct") throw new KilnYamlError("targetRouting.defaultTargetId must reference a direct target");
}

function validateAuthorityProfiles(value: unknown, operatorVoice: VoiceConfig | undefined): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new KilnYamlError("authorityProfiles must be an array");
  const ids = new Set<string>();
  value.forEach((profile, index) => {
    const path = `authorityProfiles[${index}]`;
    if (!isRecord(profile)) throw new KilnYamlError(`${path} must be an object`);
    rejectUnknownFields(profile, [
      "id", "admissionProfile", "voiceProfile", "workingDirectory", "timeoutMs", "tools", "memory",
      "readAuthority", "writeAuthority",
    ], path);
    validateCanonicalId(profile.id, `${path}.id`);
    if (ids.has(String(profile.id))) throw new KilnYamlError(`${path}.id must be unique`);
    ids.add(String(profile.id));
    if (!MANAGED_AGENT_ADMISSION_PROFILES.includes(profile.admissionProfile as never)) {
      throw new KilnYamlError(`${path}.admissionProfile is unsupported`);
    }
    if (profile.workingDirectory !== undefined && !["project", "isolated-worktree", "sandbox"].includes(String(profile.workingDirectory))) {
      throw new KilnYamlError(`${path}.workingDirectory is invalid`);
    }
    if (profile.timeoutMs !== undefined && (!Number.isSafeInteger(profile.timeoutMs) || Number(profile.timeoutMs) <= 0)) {
      throw new KilnYamlError(`${path}.timeoutMs must be a positive integer`);
    }
    validateManagedAgentVoiceProfile(profile.voiceProfile, `${path}.voiceProfile`, operatorVoice);
    validateAuthorityProfileTools(profile.tools, `${path}.tools`);
    validateAuthorityProfileMemory(profile.memory, `${path}.memory`);
    validateManagedAgentReadAuthority(profile.readAuthority, `${path}.readAuthority`);
    validateManagedAgentWriteAuthority(profile.writeAuthority, `${path}.writeAuthority`);
  });
}

function validateAuthorityProfileTools(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["allowed", "network", "writes"], path);
  validateOptionalStringArray(value.allowed, `${path}.allowed`);
  if (value.network !== undefined && typeof value.network !== "boolean") {
    throw new KilnYamlError(`${path}.network must be a boolean`);
  }
  if (value.writes !== undefined && typeof value.writes !== "boolean") {
    throw new KilnYamlError(`${path}.writes must be a boolean`);
  }
}

function validateAuthorityProfileMemory(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["access"], path);
  if (
    value.access !== undefined
    && value.access !== "none"
    && value.access !== "read-only"
    && value.access !== "write-proposals"
  ) {
    throw new KilnYamlError(`${path}.access must be "none", "read-only", or "write-proposals"`);
  }
}

function validateExternalRuntimeAttachment(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["runtimeId", "attachmentId"], path);
  validateCanonicalId(value.runtimeId, `${path}.runtimeId`);
  validateCanonicalId(value.attachmentId, `${path}.attachmentId`);
}

function validateSessionTurnBudget(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("sessionTurnBudget must be an object");
  rejectUnknownFields(value, ["tokenLimit", "action"], "sessionTurnBudget");
  if (!Number.isSafeInteger(value.tokenLimit) || (value.tokenLimit as number) <= 0) throw new KilnYamlError("sessionTurnBudget.tokenLimit must be a positive safe integer");
  if (value.action !== "stop") throw new KilnYamlError("sessionTurnBudget.action must be \"stop\"");
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
  targetSelection: true,
});

function validateGlobalUi(value: unknown, targetCatalog: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("ui must be an object");
  }
  rejectUnknownFields(value, GLOBAL_UI_FIELDS, "ui");
  if (value.theme !== undefined && typeof value.theme !== "string") {
    throw new KilnYamlError("ui.theme must be a string");
  }
  if (value.targetSelection === undefined) {
    return;
  }
  if (!isRecord(value.targetSelection)) {
    throw new KilnYamlError("ui.targetSelection must be an object");
  }
  const selection = value.targetSelection;
  const targetSelectionFields = new Set(["targetId", "accountOverrideId"]);
  for (const key of Object.keys(selection)) {
    if (!targetSelectionFields.has(key)) {
      throw new KilnYamlError(`Unknown ui.targetSelection field: ${key}`);
    }
  }
  validateCanonicalId(selection.targetId, "ui.targetSelection.targetId");
  if (!isRecord(targetCatalog) || !Array.isArray(targetCatalog.targets)) {
    throw new KilnYamlError("ui.targetSelection requires targetCatalog.targets");
  }
  const selectedTarget = targetCatalog.targets.find((target) => isRecord(target) && target.id === selection.targetId);
  if (!isRecord(selectedTarget)) {
    throw new KilnYamlError("ui.targetSelection.targetId references an unknown target");
  }
  if (selectedTarget.kind !== "direct") {
    throw new KilnYamlError("ui.targetSelection.targetId must reference a direct target");
  }
  if (selection.accountOverrideId !== undefined) {
    validateCanonicalId(selection.accountOverrideId, "ui.targetSelection.accountOverrideId");
    const routeSelection = selectedTarget.accountSelection;
    if (!isRecord(routeSelection) || routeSelection.mode !== "automatic") {
      throw new KilnYamlError("ui.targetSelection.accountOverrideId requires an automatic direct target");
    }
    if (!Array.isArray(targetCatalog.accountPolicies)) {
      throw new KilnYamlError("ui.targetSelection.accountOverrideId requires targetCatalog.accountPolicies");
    }
    const policy = targetCatalog.accountPolicies.find((entry) => isRecord(entry) && entry.id === routeSelection.accountPolicyId);
    if (!isRecord(policy) || !Array.isArray(policy.accountIds) || !policy.accountIds.includes(selection.accountOverrideId)) {
      throw new KilnYamlError("ui.targetSelection.accountOverrideId is not eligible for the selected target");
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
    "enabled",
    "defaultAuthorityProfileId",
    "defaultVoiceProfile",
    "worktreeLease",
    "requireApproval",
    "intents",
  ], "managedAgents");
  validateManagedAgentWorktreeLease(value.worktreeLease);
  validateManagedAgentVoiceProfile(value.defaultVoiceProfile, "managedAgents.defaultVoiceProfile", operatorVoice);
  validateManagedAgentIntents(value.intents);
}

function validateManagedAgentIntents(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    throw new KilnYamlError("managedAgents.intents must be a non-empty array");
  }
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const path = `managedAgents.intents[${index}]`;
    const intent = value[index];
    if (!isRecord(intent)) throw new KilnYamlError(`${path} must be an object`);
    rejectUnknownFields(intent, ["id", "purpose", "authorityProfileId", "target", "model", "workLimits", "paidUsage"], path);
    validateCanonicalId(intent.id, `${path}.id`);
    if (ids.has(String(intent.id))) throw new KilnYamlError(`${path}.id must be unique`);
    ids.add(String(intent.id));
    if (typeof intent.purpose !== "string" || intent.purpose.trim().length === 0 || intent.purpose.length > 2000) {
      throw new KilnYamlError(`${path}.purpose must be a non-empty string of at most 2000 characters`);
    }
    validateCanonicalId(intent.authorityProfileId, `${path}.authorityProfileId`);
    validateManagedAgentIntentSelection(intent.target, path, "target", "targetId");
    validateManagedAgentIntentSelection(intent.model, path, "model", "modelId");
    validateManagedAgentWorkLimits(intent.workLimits, `${path}.workLimits`);
    validateManagedAgentPaidUsage(intent.paidUsage, `${path}.paidUsage`);
  }
}

function validateManagedAgentIntentSelection(value: unknown, path: string, field: string, explicitKey: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError(`${path}.${field} must be an object`);
  rejectUnknownFields(value, ["mode", explicitKey], `${path}.${field}`);
  if (value.mode === "inherited") {
    if (Object.keys(value).length !== 1) throw new KilnYamlError(`${path}.${field}.inherited cannot carry explicit selection`);
    return;
  }
  if (value.mode !== "explicit") throw new KilnYamlError(`${path}.${field}.mode must be inherited or explicit`);
  validateCanonicalId(value[explicitKey], `${path}.${field}.${explicitKey}`);
}

function validateManagedAgentWorkLimits(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["maxTurns", "maxDurationMs", "maxConcurrency"], path);
  for (const key of ["maxTurns", "maxDurationMs", "maxConcurrency"] as const) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || Number(value[key]) <= 0)) {
      throw new KilnYamlError(`${path}.${key} must be a positive safe integer`);
    }
  }
}

function validateManagedAgentPaidUsage(value: unknown, path: string): void {
  if (value === undefined) return;
  if (value === "included-only" || value === "ask-before-spend" || value === "uncapped") return;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be included-only, ask-before-spend, uncapped, or a cap object`);
  rejectUnknownFields(value, ["kind", "amount"], path);
  if (value.kind !== "cap") throw new KilnYamlError(`${path}.kind must be cap`);
  validateManagedAgentSpendAmount(value.amount, `${path}.amount`);
}

function validateManagedAgentSpendAmount(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["atoms", "scale", "unit", "scheme"], path);
  if (typeof value.atoms !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value.atoms)) {
    throw new KilnYamlError(`${path}.atoms must be canonical non-negative base-10`);
  }
  if (!Number.isSafeInteger(value.scale) || Number(value.scale) < 0 || Number(value.scale) > 18) {
    throw new KilnYamlError(`${path}.scale must be an integer from 0 to 18`);
  }
  validateCanonicalId(value.unit, `${path}.unit`);
  if (!isRecord(value.scheme)) throw new KilnYamlError(`${path}.scheme must be an object`);
  if (value.scheme.kind === "currency") {
    rejectUnknownFields(value.scheme, ["kind", "currency"], `${path}.scheme`);
    validateCanonicalId(value.scheme.currency, `${path}.scheme.currency`);
  } else if (value.scheme.kind === "credit") {
    rejectUnknownFields(value.scheme, ["kind", "creditSchemeId"], `${path}.scheme`);
    validateCanonicalId(value.scheme.creditSchemeId, `${path}.scheme.creditSchemeId`);
  } else {
    throw new KilnYamlError(`${path}.scheme.kind must be currency or credit for an enforceable cap`);
  }
}

function validateManagedTargetReferences(
  managedAgents: unknown,
  targetCatalog: unknown,
  authorityProfiles: unknown,
): void {
  if (isRecord(managedAgents) && managedAgents.defaultAuthorityProfileId !== undefined) {
    const ids = new Set(Array.isArray(authorityProfiles)
      ? authorityProfiles.filter(isRecord).map((profile) => profile.id)
      : []);
    if (!ids.has(managedAgents.defaultAuthorityProfileId)) {
      throw new KilnYamlError("managedAgents.defaultAuthorityProfileId references an unknown authority profile");
    }
  }
  if (!isRecord(managedAgents) || !Array.isArray(managedAgents.intents)) return;
  const targets = isRecord(targetCatalog) && Array.isArray(targetCatalog.targets)
    ? targetCatalog.targets.filter(isRecord)
    : [];
  const authorityIds = new Set(Array.isArray(authorityProfiles)
    ? authorityProfiles.filter(isRecord).map((entry) => String(entry.id))
    : []);
  for (let index = 0; index < managedAgents.intents.length; index += 1) {
    const intent = managedAgents.intents[index];
    if (!isRecord(intent)) continue;
    const path = `managedAgents.intents[${index}]`;
    if (!authorityIds.has(String(intent.authorityProfileId))) {
      throw new KilnYamlError(`${path}.authorityProfileId references an unknown authority profile`);
    }
    const targetSelection = isRecord(intent.target) ? intent.target : undefined;
    const target = targetSelection?.mode === "explicit"
      ? targets.find((entry) => entry.id === targetSelection.targetId)
      : undefined;
    if (targetSelection?.mode === "explicit" && !target) {
      throw new KilnYamlError(`${path}.target.targetId references an unknown target`);
    }
    if (target && target.kind !== "direct") {
      throw new KilnYamlError(`${path}.target.targetId must reference an automatic direct target`);
    }
    if (target && target.kind === "direct") {
      const selection = isRecord(target.accountSelection) ? target.accountSelection : undefined;
      if (!selection || selection.mode !== "automatic" || typeof selection.accountPolicyId !== "string") {
        throw new KilnYamlError(`${path}.target.targetId must reference an automatic direct target`);
      }
      const economics = isRecord(target.economics) ? target.economics : undefined;
      if (!economics || economics.fallbackPosture !== "disabled" || economics.overagePosture !== "disabled") {
        throw new KilnYamlError(`${path}.target.targetId cannot activate fallback or overage without a new commitment`);
      }
    }
    const modelSelection = isRecord(intent.model) ? intent.model : undefined;
    if (modelSelection?.mode === "explicit") {
      const matchingTargets = target
        ? [target]
        : targets;
      if (!matchingTargets.some((candidate) => candidate.providerModelId === modelSelection.modelId)) {
        throw new KilnYamlError(`${path}.model.modelId does not match an admitted target model`);
      }
    }
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

function validateCommunication(value: unknown, path: string, source: "global" | "project"): void {
  if (value === undefined) return;
  try {
    resolveCommunicationIntent([{
      source,
      intent: value as CommunicationIntent,
    }]);
  } catch (error) {
    throw new KilnYamlError(`${path} is invalid: ${error instanceof Error ? error.message : String(error)}`);
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

function isWorkGovernanceTrigger(value: unknown): boolean {
  return value === "architecture"
    || value === "security"
    || value === "ui"
    || value === "runtime"
    || value === "provider-routing"
    || value === "managed-agents"
    || value === "config"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalDafnyVersion(value: string): boolean {
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value);
}
