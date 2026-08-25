import { createHash } from "node:crypto";
import type {
  ActionEffectEnvelope,
  AdmittedExecutionRoute,
  AuthorityDescriptor,
  EffectiveTurnAuthoritySnapshot,
  ExecutionSessionBindingEvidence,
  OperatorAdoptionDecisionAuthority,
  SessionTokenUsageObservation,
} from "@kilnai/core";
import type { BoundHostToolSandboxAdmission } from "@kilnai/core/sandbox";
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
  /** Secret-free evidence for the exact process-local host enforcement capability. */
  readonly hostEnforcement?: BoundHostToolSandboxAdmission;
}

export interface ToolPermissionAdmissionProjectionInput {
  readonly candidateToolNames: readonly string[];
  readonly config: Pick<PerCallToolConfig,
    "toolAllowlist" | "toolAuthority" | "perCallCapabilities" | "hostToolSandboxAdmission">;
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
    ...(input.config.hostToolSandboxAdmission
      ? { hostEnforcement: normalizeHostToolEnforcement(input.config.hostToolSandboxAdmission) }
      : {}),
  });
}

/** Canonical execution projections. Consequential Runtime policy never reconstructs authority from per-call fields. */
export function readExecutionToolAllowlist(config: PerCallToolConfig | undefined): ReadonlySet<string> {
  const admission = requireExecutionAuthorityAdmission(config);
  return new Set(admission.turn.tools.allowedToolPermissions.map((entry) => entry.toolName));
}

export function readExecutionToolAuthority(
  config: PerCallToolConfig | undefined,
  toolName: string,
): AuthorityDescriptor | undefined {
  return requireExecutionAuthorityAdmission(config).turn.tools.allowedToolPermissions
    .find((entry) => entry.toolName === toolName)?.authority;
}

export function readExecutionTurnAuthority(
  config: PerCallToolConfig | undefined,
): EffectiveTurnAuthoritySnapshot {
  return requireExecutionAuthorityAdmission(config).turn.authority;
}

export function readExecutionConfigurationRevision(
  config: PerCallToolConfig | undefined,
): RuntimeConfigurationRevisionSnapshot {
  return requireExecutionAuthorityAdmission(config).configuration.turnRevision;
}

export function readExecutionBinding(
  config: PerCallToolConfig | undefined,
): Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }> | undefined {
  const admission = requireExecutionAuthorityAdmission(config);
  return admission.turn.execution.status === "routed"
    ? admission.turn.execution.binding
    : undefined;
}

export function readExecutionRoute(config: PerCallToolConfig | undefined): AdmittedExecutionRoute | undefined {
  const admission = requireExecutionAuthorityAdmission(config);
  return admission.turn.execution.status === "routed"
    ? admission.turn.execution.route
    : undefined;
}

export function readExecutionOperatorAdoptionDecision(
  config: PerCallToolConfig | undefined,
): OperatorAdoptionDecisionAuthority | undefined {
  const admission = requireExecutionAuthorityAdmission(config);
  return admission.turn.operatorAdoption.status === "admitted"
    ? admission.turn.operatorAdoption.decision
    : undefined;
}

export function readExecutionTurnId(config: PerCallToolConfig | undefined): string {
  return requireExecutionAuthorityAdmission(config).turnId;
}

export function requireExecutionAuthorityAdmission(
  config: PerCallToolConfig | undefined,
): EffectiveAuthorityAdmissionBundle {
  if (!config?.authorityAdmission) {
    throw new Error("EffectiveAuthorityAdmissionBundle is required for Runtime execution authority.");
  }
  return config.authorityAdmission;
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
  const hostEnforcement = input.turn.tools.hostEnforcement === undefined
    ? undefined
    : normalizeHostToolEnforcement(input.turn.tools.hostEnforcement);
  if (hostEnforcement && hostEnforcement.configurationRevisionId !== turnRevision.revisionSetId) {
    throw new TypeError("Host enforcement must bind the exact turn configuration revision.");
  }
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
        ...(hostEnforcement === undefined ? {} : { hostEnforcement }),
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

function normalizeHostToolEnforcement(value: unknown): BoundHostToolSandboxAdmission {
  if (!isPlainRecord(value)
    || value.schemaRevision !== 1
    || !isDigest(value.sandboxId)
    || !isDigest(value.configurationRevisionId)
    || !isDigest(value.permissionPolicyDigest)
    || !isDigest(value.policyDigest)
    || typeof value.leaseId !== "string" || value.leaseId.trim().length === 0
    || !["read-only", "read-write", "none"].includes(value.fsPolicy as string)
    || !["none", "package-managers", "documentation", "full"].includes(value.netPolicy as string)
    || !isCount(value.allowedPathCount)
    || !isCount(value.deniedPathCount)
    || !isCount(value.allowedDomainCount)) {
    throw new TypeError("turn.tools.hostEnforcement must contain canonical secret-free host sandbox evidence.");
  }
  return clonePlain(value) as unknown as BoundHostToolSandboxAdmission;
}

function isDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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

const SECRET_KEY = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|credential|credentialMaterial)$/iu;
const PATH_KEY = /^(?:cwd|workingDirectory|canonicalRoot|filePath|path)$/u;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u;
const ACTIVATION_LINEAGE_PATH_LABEL = /^bundle\.configuration\.(?:sessionRevision|turnRevision)\.activationLineage\[\d+\]\.path$/u;

function assertSerializableAdmissionValue(value: unknown, label: string, key?: string): void {
  if (key && SECRET_KEY.test(key) && key !== "credentialId" && key !== "credentialRevision") {
    throw new TypeError(`${label} contains secret material.`);
  }
  if (key && PATH_KEY.test(key) && !(key === "path" && ACTIVATION_LINEAGE_PATH_LABEL.test(label))) {
    throw new TypeError(`${label} contains a filesystem path.`);
  }
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
