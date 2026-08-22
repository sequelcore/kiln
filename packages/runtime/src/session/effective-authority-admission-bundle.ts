import { createHash } from "node:crypto";
import type {
  ActionEffectEnvelope,
  AdmittedExecutionRoute,
  AuthorityDescriptor,
  Capability,
  EffectiveTurnAuthoritySnapshot,
  ExecutionSessionBindingEvidence,
  OperatorAdoptionDecisionAuthority,
  SessionTokenUsageObservation,
} from "@kilnai/core";
import {
  deterministicOperatorAdoptionDecisionId,
  isValidNarrowing,
  normalizeActionEffectEnvelope,
} from "@kilnai/core";
import type { SanitizedExecutionRouteDataPolicyDecision } from "../execution-routing/execution-route-data-policy-authority.js";
import {
  normalizeRuntimeConfigurationRevision,
  type RuntimeConfigurationRevisionSnapshot,
} from "./runtime-configuration-revision-pin.js";
import type { EffectiveTurnAuthorityPolicyBound, PerCallToolConfig } from "./runtime-session-orchestrator.types.js";
import { effectiveTurnAuthorityRank, rollupAdmittedAuthority } from "./effective-turn-authority.js";

export interface SkillCatalogAdmission {
  readonly catalogId: string;
  readonly revision: string;
  readonly skillIds: readonly string[];
}

export type WorkGovernanceAdmission =
  | { readonly status: "not-required" }
  | {
      readonly status: "required";
      readonly kind: "goal" | "work-item";
      readonly subjectId: string;
      readonly authorityRevision: string;
    };

/**
 * The canonical operator-adoption authority for this turn.  Productive
 * governed turns must carry the Core-owned decision that was persisted before
 * the turn crossed into consequential execution; there is no Runtime-local
 * fallback authority.
 */
export type OperatorAdoptionAdmission =
  | { readonly status: "not-required" }
  | {
      readonly status: "admitted";
      readonly decision: OperatorAdoptionDecisionAuthority;
    };

export interface ToolPermissionAdmissionEntry {
  readonly toolName: string;
  readonly authority: AuthorityDescriptor;
  /** Core-declared maximum effect for this admitted tool. */
  readonly effectEnvelope: ActionEffectEnvelope;
}

/**
 * A caller-owned model tool contract is transported to the provider but is
 * never a Kiln-executable permission.  The names are retained for audit and
 * the digest binds the exact wire contract admitted for this turn.
 */
export interface CallerOwnedToolContractAdmission {
  readonly names: readonly string[];
  readonly digest: `sha256:${string}`;
}

export interface ToolPermissionAdmission {
  readonly allowedToolPermissions: readonly ToolPermissionAdmissionEntry[];
  readonly deniedToolNames: readonly string[];
  readonly callerOwnedToolContract?: CallerOwnedToolContractAdmission;
}

export interface ToolPermissionAdmissionProjectionInput {
  readonly candidateToolNames: readonly string[];
  readonly config: Pick<PerCallToolConfig, "toolAllowlist" | "toolAuthority" | "perCallCapabilities">;
}

/**
 * Projects the existing per-call owner maps once at the Runtime boundary.
 * The returned exact permission set is the bundle authority; executors must
 * not independently consult the source maps after this projection.
 */
export function projectToolPermissionAdmissionFromPerCallConfig(
  input: ToolPermissionAdmissionProjectionInput,
): ToolPermissionAdmission {
  const candidateToolNames = normalizedUniqueNames(input.candidateToolNames, "candidateToolNames");
  if (!input.config.toolAllowlist) {
    throw new TypeError("A tool allowlist is required to project an exact permission admission.");
  }
  const candidates = new Set(candidateToolNames);
  for (const name of input.config.toolAllowlist) {
    if (!candidates.has(name)) throw new TypeError(`Tool allowlist contains unknown tool "${name}".`);
  }
  const allowedNames = candidateToolNames.filter((name) => input.config.toolAllowlist?.has(name));
  const allowedToolPermissions = allowedNames.map((toolName) => {
    const authority = input.config.toolAuthority?.get(toolName);
    if (!authority) throw new TypeError(`Missing canonical authority descriptor for admitted tool "${toolName}".`);
    validateAuthorityDescriptor(authority, `toolAuthority.${toolName}`);
    const capability = input.config.perCallCapabilities?.get(toolName);
    if ((authority.requiresApproval || !authority.allowed) && !capability?.tags?.includes("operator-approval")) {
      throw new TypeError(`Approval-gated tool "${toolName}" is missing the canonical operator-approval capability tag.`);
    }
    const effectEnvelope = capability?.effectEnvelope;
    if (!effectEnvelope) throw new TypeError(`Missing declared effect ceiling for admitted tool "${toolName}".`);
    return {
      toolName,
      authority: clonePlain(authority),
      effectEnvelope: normalizeDeclaredEffectEnvelope(effectEnvelope, toolName),
    };
  });
  return deepFreeze({
    allowedToolPermissions,
    deniedToolNames: candidateToolNames.filter((name) => !input.config.toolAllowlist?.has(name)),
  });
}

/**
 * Migration seam for Runtime execution: the persisted bundle is authoritative
 * and legacy per-call authority fields may only corroborate it. Callers must
 * delete those legacy fields after every production path supplies the bundle.
 */
export function applyEffectiveAuthorityAdmissionBundleToPerCallConfig(
  bundle: EffectiveAuthorityAdmissionBundle,
  config: PerCallToolConfig = {},
): PerCallToolConfig {
  const admitted = defineEffectiveAuthorityAdmissionBundle(bundle);
  const allowed = admitted.turn.tools.allowedToolPermissions;
  const allowedNames = new Set(allowed.map((entry) => entry.toolName));
  if (config.toolAllowlist && !sameStringSet(config.toolAllowlist, allowedNames)) {
    throw new TypeError("Legacy tool allowlist mismatch with the committed authority admission bundle.");
  }
  if (config.toolAuthority) {
    const projectedAuthority = new Map(allowed.map((entry) => [entry.toolName, entry.authority]));
    if (!sameMapValue(config.toolAuthority, projectedAuthority)) {
      throw new TypeError("Legacy tool authority mismatch with the committed authority admission bundle.");
    }
  }
  if (config.effectiveTurnAuthority
    && stableStringify(config.effectiveTurnAuthority) !== stableStringify(admitted.turn.authority)) {
    throw new TypeError("Legacy turn authority mismatch with the committed authority admission bundle.");
  }
  if (config.runtimeConfigurationRevision
    && stableStringify(normalizeRuntimeConfigurationRevision(config.runtimeConfigurationRevision))
      !== stableStringify(admitted.configuration.turnRevision)) {
    throw new TypeError("Legacy configuration revision mismatch with the committed authority admission bundle.");
  }
  const executionBinding = admitted.turn.execution.status === "routed"
    ? admitted.turn.execution.binding
    : undefined;
  const admittedExecutionRoute = admitted.turn.execution.status === "routed"
    ? admitted.turn.execution.route
    : undefined;
  if (config.executionBinding && stableStringify(config.executionBinding) !== stableStringify(executionBinding)) {
    throw new TypeError("Legacy execution binding mismatch with the committed authority admission bundle.");
  }
  if (config.admittedExecutionRoute
    && stableStringify(config.admittedExecutionRoute) !== stableStringify(admittedExecutionRoute)) {
    throw new TypeError("Execution route mismatch with the committed authority admission bundle.");
  }
  if (config.turnId && config.turnId !== admitted.turnId) {
    throw new TypeError("Legacy canonical turn identity mismatch with the committed authority admission bundle.");
  }
  const adoptionDecision = admitted.turn.operatorAdoption.status === "admitted"
    ? admitted.turn.operatorAdoption.decision
    : undefined;
  if (config.operatorAdoptionDecision
    && stableStringify(config.operatorAdoptionDecision) !== stableStringify(adoptionDecision)) {
    throw new TypeError("Legacy operator-adoption decision mismatch with the committed authority admission bundle.");
  }
  const capabilities = new Map<string, Capability>();
  const authority = new Map<string, AuthorityDescriptor>();
  for (const entry of allowed) {
    const capability = config.perCallCapabilities?.get(entry.toolName);
    if (!capability) throw new TypeError(`Missing execution capability for admitted tool "${entry.toolName}".`);
    capabilities.set(entry.toolName, { ...capability, effectEnvelope: entry.effectEnvelope });
    authority.set(entry.toolName, entry.authority);
  }
  return {
    ...config,
    toolAllowlist: allowedNames,
    toolAuthority: authority,
    perCallCapabilities: capabilities,
    additionalTools: config.additionalTools?.filter((tool) => allowedNames.has(tool.name)),
    toolCallMetadata: filterReadonlyMap(config.toolCallMetadata, allowedNames),
    effectiveTurnAuthority: admitted.turn.authority,
    turnId: admitted.turnId,
    runtimeConfigurationRevision: admitted.configuration.turnRevision,
    ...(adoptionDecision ? { operatorAdoptionDecision: adoptionDecision } : {}),
    ...(executionBinding ? {
      executionBinding,
      admittedExecutionRoute,
    } : {}),
  };
}

/** Derives the least upper effect bound that contains every admitted tool. */
export function deriveTurnEffectCeiling(
  permissions: ToolPermissionAdmission,
): ActionEffectEnvelope {
  const effects = permissions.allowedToolPermissions.map((entry) =>
    normalizeDeclaredEffectEnvelope(entry.effectEnvelope, entry.toolName));
  if (effects.length === 0) {
    return deepFreeze({
      operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none",
      identityUse: "none", consequences: [], idempotency: "idempotent",
    });
  }
  const maximum = <T extends string>(values: readonly T[], order: readonly T[]): T =>
    values.reduce((left, right) => order.indexOf(left) >= order.indexOf(right) ? left : right);
  return deepFreeze({
    operation: effects.some((effect) => effect.operation === "mutate") ? "mutate" : "observe",
    boundaries: [...new Set(effects.flatMap((effect) => effect.boundaries))].sort(compareCodeUnits),
    reversibility: maximum(effects.map((effect) => effect.reversibility), ["reversible", "compensatable", "irreversible"]),
    dataEgress: maximum(effects.map((effect) => effect.dataEgress), ["none", "metadata", "project-data", "sensitive-data"]),
    identityUse: maximum(effects.map((effect) => effect.identityUse), ["none", "authenticated", "privileged"]),
    consequences: [...new Set(effects.flatMap((effect) => effect.consequences))].sort(compareCodeUnits),
    idempotency: maximum(effects.map((effect) => effect.idempotency), ["idempotent", "conditionally-idempotent", "non-idempotent"]),
  });
}

export type TurnBudgetAdmission =
  | { readonly status: "not-configured" }
  | {
      readonly status: "admitted";
      readonly reason: "observed-below-limit";
      readonly observation: SessionTokenUsageObservation;
    };

export interface EconomicCommitmentReference {
  readonly commitmentId: string;
  readonly authorityRevision: string;
}

export type ExecutionAdmission =
  | { readonly status: "not-routed" }
  | {
      readonly status: "routed";
      readonly route: AdmittedExecutionRoute;
      readonly dataPolicy: SanitizedExecutionRouteDataPolicyDecision;
      readonly binding: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>;
      readonly economicCommitment?: EconomicCommitmentReference;
    };

export interface EffectiveAuthorityAdmissionBundleInput {
  readonly sessionId: string;
  readonly turnId: string;
  readonly admittedAt: string;
  readonly configuration: {
    readonly sessionRevision: RuntimeConfigurationRevisionSnapshot;
    readonly turnRevision: RuntimeConfigurationRevisionSnapshot;
  };
  readonly session: {
    readonly skillCatalog: SkillCatalogAdmission;
    readonly authorityCeiling: EffectiveTurnAuthorityPolicyBound;
  };
  readonly turn: {
    readonly authority: EffectiveTurnAuthoritySnapshot;
    readonly workGovernance: WorkGovernanceAdmission;
    readonly operatorAdoption: OperatorAdoptionAdmission;
    readonly tools: ToolPermissionAdmission;
    /** Explicit normalized maximum effect for every admitted tool in this turn. */
    readonly effectCeiling: ActionEffectEnvelope;
    readonly budget: TurnBudgetAdmission;
    readonly execution: ExecutionAdmission;
  };
}

export interface EffectiveAuthorityAdmissionBundle extends EffectiveAuthorityAdmissionBundleInput {
  readonly schemaRevision: 1;
  /** Digest of the canonical bundle body; never of credential material. */
  readonly admissionId: `sha256:${string}`;
}

/**
 * Defines the immutable, secret-free authority value that crosses a Runtime
 * admission boundary. Owner adapters decide their facets before this function;
 * this function validates composition invariants and content-addresses the result.
 */
export function defineEffectiveAuthorityAdmissionBundle(
  input: EffectiveAuthorityAdmissionBundleInput,
): EffectiveAuthorityAdmissionBundle {
  assertSerializableAdmissionValue(input, "bundle");
  required(input.sessionId, "sessionId");
  required(input.turnId, "turnId");
  instant(input.admittedAt, "admittedAt");

  const sessionRevision = normalizeRuntimeConfigurationRevision(input.configuration.sessionRevision);
  const turnRevision = normalizeRuntimeConfigurationRevision(input.configuration.turnRevision);
  const allowedToolPermissions = normalizedToolPermissions(input.turn.tools.allowedToolPermissions);
  const deniedToolNames = normalizedUniqueNames(input.turn.tools.deniedToolNames, "turn.tools.deniedToolNames");
  const effectCeiling = normalizeDeclaredEffectEnvelope(input.turn.effectCeiling, "turn");
  const callerOwnedToolContract = input.turn.tools.callerOwnedToolContract === undefined
    ? undefined
    : normalizeCallerOwnedToolContract(input.turn.tools.callerOwnedToolContract);
  validateAuthorityAttenuation(input);
  validateOperatorAdoption(input);
  validateToolPermissions(input.turn.authority, allowedToolPermissions, deniedToolNames, effectCeiling);
  validateOwnerReferences(input);
  const execution = input.turn.execution;
  if (execution.status === "routed") {
    if (execution.dataPolicy.decision.status !== "admitted") {
      throw new TypeError("A routed authority admission bundle requires an admitted data-policy decision.");
    }
    if (execution.route.routeId !== execution.binding.routeId) {
      throw new TypeError("The admitted route and execution binding route must match.");
    }
    required(execution.binding.accountId, "execution.binding.accountId");
    required(execution.binding.credentialId, "execution.binding.credentialId");
    required(execution.binding.credentialRevision, "execution.binding.credentialRevision");
  }

  const body: EffectiveAuthorityAdmissionBundleInput & { readonly schemaRevision: 1 } = {
    schemaRevision: 1,
    sessionId: required(input.sessionId, "sessionId"),
    turnId: required(input.turnId, "turnId"),
    admittedAt: input.admittedAt,
    configuration: {
      sessionRevision,
      turnRevision,
    },
    session: {
      skillCatalog: {
        catalogId: required(input.session.skillCatalog.catalogId, "session.skillCatalog.catalogId"),
        revision: required(input.session.skillCatalog.revision, "session.skillCatalog.revision"),
        skillIds: normalizedUniqueNames(input.session.skillCatalog.skillIds, "session.skillCatalog.skillIds"),
      },
      authorityCeiling: input.session.authorityCeiling,
    },
    turn: {
      authority: input.turn.authority,
      workGovernance: input.turn.workGovernance,
      operatorAdoption: input.turn.operatorAdoption,
      tools: {
        allowedToolPermissions,
        deniedToolNames,
        ...(callerOwnedToolContract === undefined ? {} : { callerOwnedToolContract }),
      },
      effectCeiling,
      budget: input.turn.budget,
      execution,
    },
  };
  const detached = clonePlain(body);
  const admissionId = `sha256:${createHash("sha256").update(stableStringify(detached), "utf8").digest("hex")}` as const;
  return deepFreeze({ admissionId, ...detached });
}

function validateAuthorityAttenuation(input: EffectiveAuthorityAdmissionBundleInput): void {
  required(input.session.authorityCeiling.reason, "session.authorityCeiling.reason");
  const ceilingRank = { read_only: 1, audited: 3, destructive: 4 }[input.session.authorityCeiling.maximumAuthority];
  const admittedRank = {
    fail_closed: 0,
    read_only: 1,
    idempotent: 2,
    audited: 3,
    destructive: 4,
    unknown: Number.POSITIVE_INFINITY,
  }[input.turn.authority.admittedAuthority];
  if (ceilingRank === undefined || admittedRank === undefined || admittedRank > ceilingRank) {
    throw new TypeError("Turn authority must not exceed the admitted session authority ceiling.");
  }
}

function validateToolPermissions(
  authority: EffectiveTurnAuthoritySnapshot,
  allowedToolPermissions: readonly ToolPermissionAdmissionEntry[],
  deniedToolNames: readonly string[],
  effectCeiling: ActionEffectEnvelope,
): void {
  const allowedToolNames = allowedToolPermissions.map((entry) => entry.toolName);
  const denied = new Set(deniedToolNames);
  if (allowedToolNames.some((name) => denied.has(name))) {
    throw new TypeError("A tool cannot be both allowed and denied in one admission bundle.");
  }
  if (!Number.isSafeInteger(authority.toolCount) || authority.toolCount !== allowedToolNames.length
    || !Number.isSafeInteger(authority.deniedToolCount) || authority.deniedToolCount !== deniedToolNames.length) {
    throw new TypeError("Authority tool counts must match the admitted tool permission lists.");
  }
  if ((authority.admittedAuthority === "fail_closed" || authority.admittedAuthority === "unknown") && allowedToolNames.length > 0) {
    throw new TypeError("Fail-closed or unknown authority cannot admit tools.");
  }
  const authorityByTool = new Map(allowedToolPermissions.map((entry) => [entry.toolName, entry.authority]));
  const rolledUpAuthority = rollupAdmittedAuthority(new Set(allowedToolNames), authorityByTool);
  if (effectiveTurnAuthorityRank(rolledUpAuthority) > effectiveTurnAuthorityRank(authority.admittedAuthority)) {
    throw new TypeError("A tool descriptor authority exceeds the admitted turn authority.");
  }
  for (const entry of allowedToolPermissions) {
    validateAuthorityDescriptor(entry.authority, `turn.tools.allowedToolPermissions.${entry.toolName}.authority`);
    const effectEnvelope = normalizeDeclaredEffectEnvelope(entry.effectEnvelope, entry.toolName);
    if (!isValidNarrowing(effectEnvelope, effectCeiling)) {
      throw new TypeError(`Declared effect ceiling for admitted tool "${entry.toolName}" exceeds the turn effect ceiling.`);
    }
  }
}

function normalizedToolPermissions(
  values: readonly ToolPermissionAdmissionEntry[],
): readonly ToolPermissionAdmissionEntry[] {
  if (!Array.isArray(values)) throw new TypeError("turn.tools.allowedToolPermissions must be an array.");
  const normalized = values.map((entry, index) => {
    if (!isPlainRecord(entry)) throw new TypeError(`turn.tools.allowedToolPermissions[${index}] must be a plain record.`);
    const toolName = required(entry.toolName, `turn.tools.allowedToolPermissions[${index}].toolName`);
    validateAuthorityDescriptor(entry.authority, `turn.tools.allowedToolPermissions[${index}].authority`);
    return {
      toolName,
      authority: clonePlain(entry.authority),
      effectEnvelope: normalizeDeclaredEffectEnvelope(entry.effectEnvelope, toolName),
    };
  }).sort((left, right) => compareCodeUnits(left.toolName, right.toolName));
  if (new Set(normalized.map((entry) => entry.toolName)).size !== normalized.length) {
    throw new TypeError("turn.tools.allowedToolPermissions must not contain duplicate tool names.");
  }
  return normalized;
}

function normalizeCallerOwnedToolContract(value: unknown): CallerOwnedToolContractAdmission {
  if (!isPlainRecord(value) || !Array.isArray(value.names) || typeof value.digest !== "string"
    || !/^sha256:[a-f0-9]{64}$/u.test(value.digest)) {
    throw new TypeError("turn.tools.callerOwnedToolContract must contain canonical names and a SHA-256 digest.");
  }
  const names = value.names.map((name, index) => required(name, `turn.tools.callerOwnedToolContract.names[${index}]`)).sort(compareCodeUnits);
  if (new Set(names).size !== names.length) throw new TypeError("turn.tools.callerOwnedToolContract.names must not contain duplicates.");
  return {
    names,
    digest: value.digest as `sha256:${string}`,
  };
}

function validateAuthorityDescriptor(value: unknown, label: string): asserts value is AuthorityDescriptor {
  if (!isPlainRecord(value)
    || ![1, 2, 3, 4].includes(value.level as number)
    || typeof value.allowed !== "boolean"
    || typeof value.requiresApproval !== "boolean"
    || typeof value.reason !== "string" || value.reason.trim().length === 0) {
    throw new TypeError(`${label} must be a complete canonical authority descriptor.`);
  }
  if (!value.allowed && !value.requiresApproval) throw new TypeError(`${label} cannot admit a denied tool without an approval gate.`);
}

function normalizeDeclaredEffectEnvelope(value: unknown, toolName: string): ActionEffectEnvelope {
  const normalized = normalizeActionEffectEnvelope(value);
  if (!normalized) throw new TypeError(`Missing or malformed declared effect ceiling for admitted tool "${toolName}".`);
  if (normalized.reversibility === "unknown"
    || normalized.dataEgress === "unknown"
    || normalized.identityUse === "unknown"
    || normalized.idempotency === "unknown"
    || normalized.consequences.includes("unknown")) {
    throw new TypeError(`Unknown declared effect ceiling for admitted tool "${toolName}".`);
  }
  return clonePlain(normalized);
}

function validateOwnerReferences(input: EffectiveAuthorityAdmissionBundleInput): void {
  const governance = input.turn.workGovernance;
  if (governance.status === "required") {
    required(governance.subjectId, "turn.workGovernance.subjectId");
    required(governance.authorityRevision, "turn.workGovernance.authorityRevision");
  }
  const budget = input.turn.budget;
  if (budget.status === "admitted") {
    if (!Number.isSafeInteger(budget.observation.observedTokens) || budget.observation.observedTokens < 0) {
      throw new TypeError("turn.budget.observation.observedTokens must be a non-negative safe integer.");
    }
    required(budget.observation.source, "turn.budget.observation.source");
    if (budget.observation.capturedAt !== undefined) instant(budget.observation.capturedAt, "turn.budget.observation.capturedAt");
  }
  const execution = input.turn.execution;
  if (execution.status === "routed") {
    required(execution.route.routeId, "turn.execution.route.routeId");
    required(execution.route.providerId, "turn.execution.route.providerId");
    required(execution.route.providerModelId, "turn.execution.route.providerModelId");
    if (execution.economicCommitment) {
      required(execution.economicCommitment.commitmentId, "turn.execution.economicCommitment.commitmentId");
      required(execution.economicCommitment.authorityRevision, "turn.execution.economicCommitment.authorityRevision");
    }
  }
}

function validateOperatorAdoption(input: EffectiveAuthorityAdmissionBundleInput): void {
  const adoption = input.turn.operatorAdoption;
  if (!isPlainRecord(adoption) || (adoption.status !== "not-required" && adoption.status !== "admitted")) {
    throw new TypeError("turn.operatorAdoption must be an explicit not-required or admitted decision.");
  }
  if (adoption.status !== "admitted") {
    if (input.turn.workGovernance.status === "required") {
      throw new TypeError("Required work governance must reference an admitted operator-adoption decision.");
    }
    return;
  }
  const decision = adoption.decision;
  const contractAuthority = isPlainRecord(decision) ? decision.contractAuthority : undefined;
  if (!isPlainRecord(decision)
    || typeof decision.ownerSessionId !== "string"
    || decision.ownerSessionId.trim().length === 0
    || typeof decision.operatorTurnId !== "string"
    || decision.operatorTurnId.trim().length === 0
    || !isPlainRecord(contractAuthority)
    || contractAuthority.kind !== "operator"
    || typeof contractAuthority.actorId !== "string"
    || contractAuthority.actorId.trim().length === 0
    || contractAuthority.decisionId !== decision.decisionId
    || typeof decision.decisionId !== "string"
    || decision.decisionId.trim().length === 0) {
    throw new TypeError("turn.operatorAdoption.decision must be a complete Core operator-adoption authority.");
  }
  if (decision.ownerSessionId !== input.sessionId) {
    throw new TypeError("turn.operatorAdoption.decision owner session must match the admission session.");
  }
  if (decision.operatorTurnId !== input.turnId) {
    throw new TypeError("turn.operatorAdoption.decision canonical turn must match the admission turn.");
  }
  const expectedDecisionId = deterministicOperatorAdoptionDecisionId(
    input.sessionId,
    decision.operatorTurnId,
  );
  if (decision.decisionId !== expectedDecisionId) {
    throw new TypeError("turn.operatorAdoption.decision identity is not the canonical Core decision identity.");
  }
  if (input.turn.workGovernance.status === "required"
    && (input.turn.workGovernance.subjectId !== decision.decisionId
      || input.turn.workGovernance.authorityRevision !== decision.decisionId)) {
    throw new TypeError("Required work governance must reference the admitted operator-adoption decision.");
  }
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function sameMapValue<T>(left: ReadonlyMap<string, T>, right: ReadonlyMap<string, T>): boolean {
  if (left.size !== right.size) return false;
  return [...left].every(([key, value]) => {
    const other = right.get(key);
    return other !== undefined && stableStringify(value) === stableStringify(other);
  });
}

function filterReadonlyMap<T>(
  values: ReadonlyMap<string, T> | undefined,
  allowedNames: ReadonlySet<string>,
): ReadonlyMap<string, T> | undefined {
  if (!values) return undefined;
  return new Map([...values].filter(([name]) => allowedNames.has(name)));
}

const SECRET_KEY = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|credential|credentialMaterial)$/iu;
const PATH_KEY = /^(?:cwd|workingDirectory|canonicalRoot|filePath|path)$/u;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u;

function assertSerializableAdmissionValue(value: unknown, label: string, key?: string): void {
  if (key && SECRET_KEY.test(key) && key !== "credentialId" && key !== "credentialRevision") {
    throw new TypeError(`${label} contains secret material.`);
  }
  if (key && PATH_KEY.test(key)) throw new TypeError(`${label} contains a filesystem path.`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (ABSOLUTE_PATH.test(value)) throw new TypeError(`${label} contains a filesystem path.`);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be JSON-serializable.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSerializableAdmissionValue(entry, `${label}[${index}]`));
    return;
  }
  if (!isPlainRecord(value)) throw new TypeError(`${label} must contain only plain JSON-serializable values.`);
  for (const [childKey, child] of Object.entries(value)) {
    if (child === undefined) throw new TypeError(`${label}.${childKey} must be JSON-serializable.`);
    assertSerializableAdmissionValue(child, `${label}.${childKey}`, childKey);
  }
}

function normalizedUniqueNames(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array.`);
  const normalized = values.map((value, index) => required(value, `${label}[${index}]`)).sort(compareCodeUnits);
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} must not contain duplicates.`);
  return normalized;
}

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}

function instant(value: string, label: string): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new TypeError(`${label} must be an ISO timestamp.`);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clonePlain(entry)) as T;
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clonePlain(entry)])) as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
