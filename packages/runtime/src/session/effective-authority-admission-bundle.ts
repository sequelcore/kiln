import { createHash } from "node:crypto";
import type {
  AdmittedExecutionRoute,
  EffectiveTurnAuthoritySnapshot,
  ExecutionSessionBindingEvidence,
  SessionTokenUsageObservation,
} from "@kilnai/core";
import type { SanitizedExecutionRouteDataPolicyDecision } from "../execution-routing/execution-route-data-policy-authority.js";
import {
  normalizeRuntimeConfigurationRevision,
  type RuntimeConfigurationRevisionSnapshot,
} from "./runtime-configuration-revision-pin.js";
import type { EffectiveTurnAuthorityPolicyBound } from "./runtime-session-orchestrator.types.js";

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

export interface ToolPermissionAdmission {
  readonly allowedToolNames: readonly string[];
  readonly deniedToolNames: readonly string[];
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
    readonly tools: ToolPermissionAdmission;
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
  const allowedToolNames = normalizedUniqueNames(input.turn.tools.allowedToolNames, "turn.tools.allowedToolNames");
  const deniedToolNames = normalizedUniqueNames(input.turn.tools.deniedToolNames, "turn.tools.deniedToolNames");
  validateAuthorityAttenuation(input);
  validateToolPermissions(input.turn.authority, allowedToolNames, deniedToolNames);
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
      tools: {
        allowedToolNames,
        deniedToolNames,
      },
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
  allowedToolNames: readonly string[],
  deniedToolNames: readonly string[],
): void {
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

function required(value: string, label: string): string {
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
