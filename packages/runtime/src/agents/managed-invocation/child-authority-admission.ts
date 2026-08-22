import type {
  ActionEffectEnvelope,
  AuthorityDescriptor,
  Capability,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import { isValidNarrowing, normalizeActionEffectEnvelope } from "@kilnai/core";
import { assertPersistableAuthorityAdmissionBundle } from "../../session/authority-admission-evidence.js";
import {
  type EffectiveAuthorityAdmissionBundle,
  type ToolPermissionAdmissionEntry,
} from "../../session/effective-authority-admission-bundle.js";
import { effectiveTurnAuthorityRank, rollupAdmittedAuthority } from "../../session/effective-turn-authority.js";

/** The exact child facets projected under a parent turn's committed bundle. */
export interface ManagedChildAuthorityAdmission {
  readonly bundle: EffectiveAuthorityAdmissionBundle;
  readonly allowedToolPermissions: readonly ToolPermissionAdmissionEntry[];
  readonly deniedToolNames: readonly string[];
  readonly effectCeiling: ActionEffectEnvelope;
}

/**
 * Narrow authority contract owned by managed-child dispatch.  The optional
 * lifecycle field on the legacy runtime adapter is deliberately not a
 * generic per-call authority channel; committed child dispatch supplies this
 * contract before it can acquire leases or invoke a provider.
 */
export interface ManagedChildAuthorityAdmissionContract {
  readonly bundle: EffectiveAuthorityAdmissionBundle;
}

export interface ManagedChildAuthorityAdmissionInput {
  readonly bundle: EffectiveAuthorityAdmissionBundle;
  readonly request: ManagedAgentInvocationRequest;
  readonly candidateToolNames: readonly string[];
  readonly capabilities: ReadonlyMap<string, Capability>;
  readonly toolAuthority: ReadonlyMap<string, AuthorityDescriptor>;
}

/** Validates the parent facet before resource leases or adapter dispatch begin. */
export function assertManagedChildAuthorityAdmissionBoundary(input: {
  readonly bundle: EffectiveAuthorityAdmissionBundle;
  readonly request: ManagedAgentInvocationRequest;
  readonly economicCommitmentId?: string;
}): EffectiveAuthorityAdmissionBundle {
  const bundle = assertPersistableAuthorityAdmissionBundle(input.bundle);
  if (bundle.sessionId !== input.request.parentSessionId) {
    throw new Error("Managed child authority admission session does not match its parent session.");
  }
  if (bundle.turnId !== input.request.parentTurnId) {
    throw new Error("Managed child authority admission turn does not match its parent turn.");
  }
  const parentRank = effectiveTurnAuthorityRank(bundle.turn.authority.admittedAuthority);
  const requestedRank = input.request.requestedAuthority === "destructive"
    ? 4
    : input.request.requestedAuthority === "audited" || input.request.authority.toolAuthority.writeAllowed
      ? 2
      : 1;
  if (requestedRank > parentRank) {
    throw new Error("Managed child requested authority exceeds the parent authority admission.");
  }
  const bundleCommitment = bundle.turn.execution.status === "routed"
    ? bundle.turn.execution.economicCommitment
    : undefined;
  if (bundleCommitment && input.economicCommitmentId !== bundleCommitment.commitmentId) {
    throw new Error("Managed child economic commitment does not match the parent authority admission.");
  }
  if (!bundleCommitment && input.economicCommitmentId !== undefined) {
    throw new Error("Managed child economic commitment is not admitted by the parent authority bundle.");
  }
  return bundle;
}

/**
 * Re-authorizes a child immediately before its adapter can cause provider or
 * tool effects. The parent bundle is the only upper bound; the child request
 * may narrow it but cannot select a broader authority or effect envelope.
 */
export function admitManagedChildAuthority(
  input: ManagedChildAuthorityAdmissionInput,
): ManagedChildAuthorityAdmission {
  const bundle = assertPersistableAuthorityAdmissionBundle(input.bundle);
  if (bundle.sessionId !== input.request.parentSessionId) {
    throw new Error("Managed child authority admission session does not match its parent session.");
  }
  if (bundle.turnId !== input.request.parentTurnId) {
    throw new Error("Managed child authority admission turn does not match its parent turn.");
  }
  const candidateToolNames = uniqueNames(input.candidateToolNames);
  const requestedNames = new Set(input.request.authority.toolAuthority.allowedToolNames);
  const allowedNames = candidateToolNames.filter((name) => requestedNames.has(name));
  const deniedToolNames = candidateToolNames.filter((name) => !requestedNames.has(name));
  const allowedToolPermissions = allowedNames.map((toolName) => {
    const authority = input.toolAuthority.get(toolName);
    if (!authority) {
      throw new Error(`Managed child authority admission is missing a descriptor for tool "${toolName}".`);
    }
    const capability = input.capabilities.get(toolName);
    if (!capability?.effectEnvelope) {
      throw new Error(`Managed child authority admission is missing an effect ceiling for tool "${toolName}".`);
    }
    const effectEnvelope = normalizedEffect(capability.effectEnvelope, toolName);
    if (!isValidNarrowing(effectEnvelope, bundle.turn.effectCeiling)) {
      throw new Error(`Managed child tool "${toolName}" exceeds the parent authority effect ceiling.`);
    }
    return {
      toolName,
      authority: clonePlain(authority),
      effectEnvelope: clonePlain(effectEnvelope),
    };
  });
  const parentRank = effectiveTurnAuthorityRank(bundle.turn.authority.admittedAuthority);
  const childRank = effectiveTurnAuthorityRank(rollupAdmittedAuthority(
    new Set(allowedNames),
    new Map(allowedToolPermissions.map((entry) => [entry.toolName, entry.authority])),
  ));
  if (childRank > parentRank) {
    throw new Error("Managed child authority exceeds the parent authority admission.");
  }
  const effectCeiling = deriveEffectCeiling(allowedToolPermissions, bundle.turn.effectCeiling);
  return {
    bundle,
    allowedToolPermissions: deepFreeze(allowedToolPermissions),
    deniedToolNames: deepFreeze(deniedToolNames),
    effectCeiling: deepFreeze(effectCeiling),
  };
}

function deriveEffectCeiling(
  permissions: readonly ToolPermissionAdmissionEntry[],
  parent: ActionEffectEnvelope,
): ActionEffectEnvelope {
  if (permissions.length === 0) {
    return {
      operation: "observe",
      boundaries: [],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    };
  }
  const maximum = <T extends string>(values: readonly T[], order: readonly T[]): T =>
    values.reduce((left, right) => order.indexOf(left) >= order.indexOf(right) ? left : right);
  const candidate: ActionEffectEnvelope = {
    operation: permissions.some(({ effectEnvelope }) => effectEnvelope.operation === "mutate") ? "mutate" : "observe",
    boundaries: [...new Set(permissions.flatMap(({ effectEnvelope }) => effectEnvelope.boundaries))].sort(compare),
    reversibility: maximum(permissions.map(({ effectEnvelope }) => effectEnvelope.reversibility), ["reversible", "compensatable", "irreversible"]),
    dataEgress: maximum(permissions.map(({ effectEnvelope }) => effectEnvelope.dataEgress), ["none", "metadata", "project-data", "sensitive-data"]),
    identityUse: maximum(permissions.map(({ effectEnvelope }) => effectEnvelope.identityUse), ["none", "authenticated", "privileged"]),
    consequences: [...new Set(permissions.flatMap(({ effectEnvelope }) => effectEnvelope.consequences))].sort(compare),
    idempotency: maximum(permissions.map(({ effectEnvelope }) => effectEnvelope.idempotency), ["idempotent", "conditionally-idempotent", "non-idempotent"]),
  };
  if (!isValidNarrowing(candidate, parent)) {
    throw new Error("Managed child effect ceiling exceeds the parent authority effect ceiling.");
  }
  return candidate;
}

function normalizedEffect(value: unknown, toolName: string): ActionEffectEnvelope {
  const effect = normalizeActionEffectEnvelope(value);
  if (!effect || effect.reversibility === "unknown" || effect.dataEgress === "unknown"
    || effect.identityUse === "unknown" || effect.idempotency === "unknown"
    || effect.consequences.includes("unknown")) {
    throw new Error(`Managed child tool "${toolName}" has an unknown effect ceiling.`);
  }
  return effect;
}

function uniqueNames(values: readonly string[]): readonly string[] {
  const normalized = values.map((value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("Managed child authority admission requires non-empty tool names.");
    }
    return value;
  }).sort(compare);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Managed child authority admission contains duplicate tool names.");
  }
  return normalized;
}

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clonePlain(entry)) as T;
  if (value !== null && typeof value === "object") {
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

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
