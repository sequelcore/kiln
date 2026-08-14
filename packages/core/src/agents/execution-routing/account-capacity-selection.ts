import {
  isSameProviderModelRoute,
  type ProviderModelRouteIdentity,
} from "../provider-model-evidence.js";
import {
  createExecutionAccountRef,
  type ExecutionAccountRef,
} from "./account-identity.js";
import type {
  ProviderUsageAvailability,
  ProviderUsageConfidence,
  ProviderUsageQuotaObservation,
  ProviderUsageSource,
} from "../provider-usage.js";
import { createProviderUsageQuotaObservation } from "../provider-usage.js";

export interface ExecutionAccountAffinity {
  readonly account: ExecutionAccountRef;
  readonly route: ProviderModelRouteIdentity;
}

export type ExecutionAccountCapacityHealth = "healthy" | "unhealthy";

export interface ExecutionAccountUsageEvidence {
  readonly health: ExecutionAccountCapacityHealth;
  readonly freshness: "fresh" | "stale" | "missing";
  readonly availability?: ProviderUsageAvailability;
  readonly observedAt?: string;
  readonly validUntil?: string;
  readonly source?: ProviderUsageSource;
  readonly confidence?: ProviderUsageConfidence;
  readonly quota?: ProviderUsageQuotaObservation;
}

export function defineExecutionAccountUsageEvidence(
  input: ExecutionAccountUsageEvidence,
): ExecutionAccountUsageEvidence {
  if (input.health !== "healthy" && input.health !== "unhealthy") {
    throw new TypeError("Model Gateway account usage health is invalid.");
  }
  if (!["fresh", "stale", "missing"].includes(input.freshness)) {
    throw new TypeError("Model Gateway account usage freshness is invalid.");
  }
  if (input.freshness === "missing") {
    if (
      input.health !== "healthy"
      || input.availability !== undefined
      || input.observedAt !== undefined
      || input.validUntil !== undefined
      || input.source !== undefined
      || input.confidence !== undefined
      || input.quota !== undefined
    ) {
      throw new TypeError("Missing Model Gateway usage evidence cannot contain an observation.");
    }
    return Object.freeze({ health: "healthy", freshness: "missing" });
  }
  if (
    input.availability === undefined
    || !["available", "exhausted", "unknown"].includes(input.availability)
    || input.observedAt === undefined
    || input.validUntil === undefined
    || input.source === undefined
    || !["provider-endpoint", "provider-response-headers", "unknown"].includes(input.source)
    || input.confidence === undefined
    || !["authoritative", "unknown"].includes(input.confidence)
  ) {
    throw new TypeError("Observed Model Gateway usage evidence is incomplete.");
  }
  const observedAt = Date.parse(input.observedAt);
  const validUntil = Date.parse(input.validUntil);
  if (!Number.isFinite(observedAt) || !Number.isFinite(validUntil) || validUntil < observedAt) {
    throw new TypeError("Observed Model Gateway usage timestamps are invalid.");
  }
  const expectedHealth = input.freshness === "fresh" && input.availability === "exhausted"
    ? "unhealthy"
    : "healthy";
  if (input.health !== expectedHealth) {
    throw new TypeError("Model Gateway usage health contradicts freshness and availability.");
  }
  return Object.freeze({
    health: input.health,
    freshness: input.freshness,
    availability: input.availability,
    observedAt: input.observedAt,
    validUntil: input.validUntil,
    source: input.source,
    confidence: input.confidence,
    ...(input.quota === undefined ? {} : { quota: createProviderUsageQuotaObservation(input.quota) }),
  });
}

export interface ExecutionAccountCapacityCandidate {
  readonly account: ExecutionAccountRef;
  readonly route: ProviderModelRouteIdentity;
  readonly health: ExecutionAccountCapacityHealth;
  /** Runtime lease capacity is independent from provider health and affinity reservation. */
  readonly leaseCapacity: "available" | "unavailable";
  /** Lower pressure is preferred. */
  readonly pressure: number;
  /** Reserved capacity cannot be claimed by unrelated new work. */
  readonly reservedForNewWork: boolean;
}

export interface SelectExecutionCapacityAccountInput {
  readonly route: ProviderModelRouteIdentity;
  readonly work: "new" | "existing";
  readonly affinity?: ExecutionAccountAffinity;
  /** Explicitly permits a new account only when an existing affinity cannot be honored. */
  readonly allowAffinityRebind?: boolean;
  readonly candidates: readonly ExecutionAccountCapacityCandidate[];
}

export type ExecutionAccountCapacityRejectionReason = "unhealthy" | "incompatible-route" | "reserved-for-new-work" | "lease-conflict" | "dispatcher-unavailable";

export interface ExecutionAccountCapacityRejection {
  readonly account: ExecutionAccountRef;
  readonly reason: ExecutionAccountCapacityRejectionReason;
}

export function defineExecutionAccountCapacityRejection(input: {
  readonly account: string;
  readonly reason: string;
}): ExecutionAccountCapacityRejection {
  if (![
    "unhealthy",
    "incompatible-route",
    "reserved-for-new-work",
    "lease-conflict",
    "dispatcher-unavailable",
  ].includes(input.reason)) {
    throw new TypeError("Model Gateway account rejection reason is invalid.");
  }
  return Object.freeze({
    account: createExecutionAccountRef(input.account),
    reason: input.reason as ExecutionAccountCapacityRejectionReason,
  });
}

export interface ExecutionAccountCapacitySelection {
  readonly account: ExecutionAccountRef;
  readonly route: ProviderModelRouteIdentity;
  readonly reason: "existing-affinity" | "least-pressure" | "affinity-rebind";
}

export type ExecutionAccountAffinityOutcome = "honored" | "missing" | "rejected" | "rebound";

export interface ExecutionAccountAffinityEvidence {
  readonly requested: ExecutionAccountAffinity;
  readonly outcome: ExecutionAccountAffinityOutcome;
  readonly reason?: "missing-affinity-account" | ExecutionAccountCapacityRejectionReason;
  readonly reboundTo?: ExecutionAccountRef;
}

export interface ExecutionAccountCapacitySelectionResult {
  readonly selected?: ExecutionAccountCapacitySelection;
  readonly rejections: readonly ExecutionAccountCapacityRejection[];
  readonly affinity?: ExecutionAccountAffinityEvidence;
}

/**
 * Selects only from the current capacity snapshot. It does not mutate capacity
 * or attempt provider work; the runtime authority persists the result atomically.
 */
export function selectExecutionCapacityAccount(input: SelectExecutionCapacityAccountInput): ExecutionAccountCapacitySelectionResult {
  validateSelectionInput(input);
  const candidates = [...input.candidates].sort((left, right) => left.account.localeCompare(right.account));
  if (input.work === "existing") {
    return selectExistingAffinityAccount(input, input.affinity!, candidates);
  }

  return selectLeastPressureAccount(input, candidates);
}

function selectExistingAffinityAccount(
  input: SelectExecutionCapacityAccountInput,
  affinity: ExecutionAccountAffinity,
  candidates: readonly ExecutionAccountCapacityCandidate[],
): ExecutionAccountCapacitySelectionResult {
  const affinityCandidate = candidates.find((candidate) => candidate.account === affinity.account);
  if (affinityCandidate !== undefined && isEligible(affinityCandidate, input)) {
    return Object.freeze({
      selected: Object.freeze({
        account: affinityCandidate.account,
        route: affinityCandidate.route,
        reason: "existing-affinity",
      }),
      rejections: Object.freeze([]),
      affinity: Object.freeze({ requested: affinity, outcome: "honored" }),
    });
  }

  const reason = affinityCandidate === undefined ? "missing-affinity-account" as const : rejectionReason(affinityCandidate, input);
  const affinityRejections = affinityCandidate === undefined
    ? Object.freeze([] as ExecutionAccountCapacityRejection[])
    : Object.freeze([Object.freeze({ account: affinityCandidate.account, reason: rejectionReason(affinityCandidate, input) })]);
  if (!input.allowAffinityRebind) {
    return Object.freeze({
      rejections: affinityRejections,
      affinity: Object.freeze({
        requested: affinity,
        outcome: affinityCandidate === undefined ? "missing" : "rejected",
        reason,
      }),
    });
  }

  const rebound = selectLeastPressureAccount(input, candidates, affinityRejections);
  if (rebound.selected === undefined) {
    return Object.freeze({
      ...rebound,
      affinity: Object.freeze({
        requested: affinity,
        outcome: affinityCandidate === undefined ? "missing" : "rejected",
        reason,
      }),
    });
  }
  return Object.freeze({
    selected: Object.freeze({ ...rebound.selected, reason: "affinity-rebind" }),
    rejections: rebound.rejections,
    affinity: Object.freeze({ requested: affinity, outcome: "rebound", reason, reboundTo: rebound.selected.account }),
  });
}

function selectLeastPressureAccount(
  input: SelectExecutionCapacityAccountInput,
  candidates: readonly ExecutionAccountCapacityCandidate[],
  retainedRejections: readonly ExecutionAccountCapacityRejection[] = [],
): ExecutionAccountCapacitySelectionResult {
  const eligible = candidates.filter((candidate) => isEligible(candidate, input));
  const rejections = Object.freeze([...retainedRejections, ...candidates
    .filter((candidate) =>
      !isEligible(candidate, input)
      && !retainedRejections.some((rejection) => rejection.account === candidate.account))
    .map((candidate) => Object.freeze({
      account: candidate.account,
      reason: rejectionReason(candidate, input),
    }))]);
  if (eligible.length > 0) {
    const selected = [...eligible].sort((left, right) => left.pressure - right.pressure || left.account.localeCompare(right.account))[0]!;
    return Object.freeze({
      selected: Object.freeze({ account: selected.account, route: selected.route, reason: "least-pressure" }),
      rejections,
    });
  }

  return Object.freeze({
    rejections,
  });
}

function isEligible(candidate: ExecutionAccountCapacityCandidate, input: SelectExecutionCapacityAccountInput): boolean {
  return candidate.health === "healthy"
    && candidate.leaseCapacity === "available"
    && isSameProviderModelRoute(candidate.route, input.route)
    && !(input.work === "new" && candidate.reservedForNewWork);
}

function rejectionReason(candidate: ExecutionAccountCapacityCandidate, input: SelectExecutionCapacityAccountInput): ExecutionAccountCapacityRejectionReason {
  if (candidate.health !== "healthy") return "unhealthy";
  if (candidate.leaseCapacity !== "available") return "lease-conflict";
  if (!isSameProviderModelRoute(candidate.route, input.route)) return "incompatible-route";
  return "reserved-for-new-work";
}

function validateSelectionInput(input: SelectExecutionCapacityAccountInput): void {
  requireRoute(input.route, "route");
  if (input.work === "existing" && input.affinity === undefined) {
    throw new TypeError("Existing work requires an affinity.");
  }
  const accounts = new Set<ExecutionAccountRef>();
  for (const [index, candidate] of input.candidates.entries()) {
    requireCanonicalExecutionAccountRef(candidate.account, `candidates[${index}].account`);
    if (accounts.has(candidate.account)) {
      throw new TypeError("candidates must not contain duplicate accounts.");
    }
    accounts.add(candidate.account);
    requireRoute(candidate.route, `candidates[${index}].route`);
    if (!Number.isFinite(candidate.pressure) || candidate.pressure < 0) {
      throw new TypeError(`candidates[${index}].pressure must be a non-negative finite number.`);
    }
    if (candidate.leaseCapacity !== "available" && candidate.leaseCapacity !== "unavailable") {
      throw new TypeError(`candidates[${index}].leaseCapacity must be available or unavailable.`);
    }
  }
  if (input.affinity !== undefined) {
    requireCanonicalExecutionAccountRef(input.affinity.account, "affinity.account");
    requireRoute(input.affinity.route, "affinity.route");
    if (!isSameProviderModelRoute(input.affinity.route, input.route)) {
      throw new TypeError("affinity.route must match route.");
    }
  }
}

function requireRoute(route: ProviderModelRouteIdentity, field: string): void {
  for (const [name, value] of Object.entries({
    providerId: route.providerId,
    providerModelId: route.providerModelId,
    scope: route.scope,
  })) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`${field}.${name} must not be empty.`);
    }
  }
}

function requireCanonicalExecutionAccountRef(value: ExecutionAccountRef, field: string): void {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${field} must be canonical.`);
  }
}
