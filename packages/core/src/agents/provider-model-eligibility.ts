import type {
  ProviderModelAliasEvidence,
  ProviderModelEvidence,
  ProviderModelEvidenceAuthority,
  ProviderModelEvidenceFreshness,
  ProviderModelEvidenceObservation,
  ProviderModelEvidenceSourceIdentity,
  ProviderModelEvidenceState,
  ProviderModelNormalizedIdentity,
  ProviderModelRouteIdentity,
} from "./provider-model-evidence.js";
import { assertProviderModelEvidence, isSameProviderModelRoute } from "./provider-model-evidence.js";
import { isCanonicalModelCapability } from "./model-capability-registry.js";

export type ProviderModelEligibilityUse = "interactive" | "managed-agent";

export interface ProviderModelEligibilityRequirements {
  readonly use: ProviderModelEligibilityUse;
  readonly evaluatedAt: string;
  readonly requiredStates?: readonly ProviderModelEvidenceState[];
  readonly requiredCapabilities: readonly string[];
  readonly minimumCapabilityAuthority: ProviderModelEvidenceAuthority;
  readonly minimumStateAuthority?: ProviderModelEvidenceAuthority;
  readonly requireProbe: boolean;
}

export interface ProviderModelCapabilityClaim {
  readonly capability: string;
  readonly supported: boolean;
  readonly provenance: string;
  readonly authority: ProviderModelEvidenceAuthority;
  readonly source: ProviderModelEvidenceSourceIdentity;
  readonly observedAt: string;
  readonly expiresAt?: string;
  readonly freshness: ProviderModelEvidenceFreshness;
  readonly route: ProviderModelRouteIdentity;
}

export type ProviderModelEligibilityReason =
  | "missing-configured-evidence"
  | "missing-authentication-evidence"
  | "missing-entitlement-evidence"
  | "missing-capability-evidence"
  | "missing-policy-evidence"
  | "missing-route-health-evidence"
  | "missing-probe-evidence"
  | "configuration-denied"
  | "authentication-denied"
  | "entitlement-denied"
  | "capability-incompatible"
  | "policy-denied"
  | "route-unhealthy"
  | "probe-failed"
  | `insufficient-${string}-authority`
  | `stale-${string}-evidence`
  | `future-${string}-evidence`
  | `unknown-capability:${string}`
  | `missing-capability:${string}`
  | `unsupported-capability:${string}`
  | `stale-capability:${string}`
  | `insufficient-capability-authority:${string}`;

export interface ProviderModelEligibilityDecision {
  readonly eligible: boolean;
  readonly use: ProviderModelEligibilityUse;
  readonly reasons: readonly ProviderModelEligibilityReason[];
  readonly route: ProviderModelRouteIdentity;
  readonly normalizedModel: ProviderModelNormalizedIdentity;
  readonly aliases: readonly ProviderModelAliasEvidence[];
}

interface RequiredStateRule {
  readonly state: ProviderModelEvidenceState;
  readonly missingReason: ProviderModelEligibilityReason;
  readonly deniedReason: ProviderModelEligibilityReason;
  readonly staleLabel: string;
  readonly authorityLabel: string;
}

const DEFAULT_REQUIRED_STATES: readonly ProviderModelEvidenceState[] = [
  "configured",
  "authenticated",
  "entitled",
  "capabilityCompatible",
  "policyAdmitted",
  "routeHealthy",
];

const STATE_RULES: Readonly<Record<ProviderModelEvidenceState, RequiredStateRule | undefined>> = {
  advertised: { state: "advertised", missingReason: "missing-configured-evidence", deniedReason: "configuration-denied", staleLabel: "advertised", authorityLabel: "advertised" },
  discovered: { state: "discovered", missingReason: "missing-configured-evidence", deniedReason: "configuration-denied", staleLabel: "discovered", authorityLabel: "discovered" },
  configured: { state: "configured", missingReason: "missing-configured-evidence", deniedReason: "configuration-denied", staleLabel: "configured", authorityLabel: "configured" },
  authenticated: { state: "authenticated", missingReason: "missing-authentication-evidence", deniedReason: "authentication-denied", staleLabel: "authentication", authorityLabel: "authentication" },
  entitled: { state: "entitled", missingReason: "missing-entitlement-evidence", deniedReason: "entitlement-denied", staleLabel: "entitlement", authorityLabel: "entitlement" },
  capabilityCompatible: { state: "capabilityCompatible", missingReason: "missing-capability-evidence", deniedReason: "capability-incompatible", staleLabel: "capability", authorityLabel: "capability" },
  policyAdmitted: { state: "policyAdmitted", missingReason: "missing-policy-evidence", deniedReason: "policy-denied", staleLabel: "policy", authorityLabel: "policy" },
  routeHealthy: { state: "routeHealthy", missingReason: "missing-route-health-evidence", deniedReason: "route-unhealthy", staleLabel: "route-health", authorityLabel: "route-health" },
  probeVerified: { state: "probeVerified", missingReason: "missing-probe-evidence", deniedReason: "probe-failed", staleLabel: "probe", authorityLabel: "probe" },
  selectable: undefined,
};

const AUTHORITY_RANK: Readonly<Record<ProviderModelEvidenceAuthority, number>> = Object.freeze({
  inferred: 0,
  "harness-reported": 1,
  "operator-declared": 2,
  "runtime-observed": 3,
  "provider-authoritative": 4,
  "probe-verified": 5,
});

const STATE_AUTHORITY_OWNERS: Readonly<Record<ProviderModelEvidenceState, readonly ProviderModelEvidenceAuthority[]>> = Object.freeze({
  advertised: ["provider-authoritative", "harness-reported"],
  discovered: ["provider-authoritative", "harness-reported", "runtime-observed"],
  configured: ["operator-declared", "runtime-observed"],
  authenticated: ["harness-reported", "runtime-observed"],
  entitled: ["provider-authoritative"],
  capabilityCompatible: ["provider-authoritative", "harness-reported", "runtime-observed"],
  policyAdmitted: ["operator-declared", "runtime-observed"],
  routeHealthy: ["runtime-observed", "probe-verified"],
  probeVerified: ["probe-verified"],
  selectable: ["operator-declared", "runtime-observed"],
});

/**
 * Derives a use-specific admission decision from evidence without promoting one
 * evidence state into another. Catalog presence is deliberately not an input to
 * authorization: every required state must have its own fresh observation.
 */
export function deriveProviderModelEligibility(
  evidence: ProviderModelEvidence,
  requirements: ProviderModelEligibilityRequirements,
  capabilityClaims: readonly ProviderModelCapabilityClaim[],
): ProviderModelEligibilityDecision {
  assertProviderModelEvidence(evidence);
  const reasons: ProviderModelEligibilityReason[] = [];
  const evaluatedAt = Date.parse(requirements.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) {
    throw new TypeError("requirements.evaluatedAt must be an ISO-compatible timestamp.");
  }
  const minimumStateAuthority = requirements.minimumStateAuthority ?? "harness-reported";

  for (const state of requirements.requiredStates ?? DEFAULT_REQUIRED_STATES) {
    const rule = STATE_RULES[state];
    if (!rule) {
      continue;
    }
    evaluateRequiredState(evidence, rule, minimumStateAuthority, evaluatedAt, reasons);
  }

  if (requirements.requireProbe) {
    const probeRule = STATE_RULES.probeVerified;
    if (probeRule) {
      evaluateRequiredState(evidence, probeRule, minimumStateAuthority, evaluatedAt, reasons);
    }
  }

  for (const capability of requirements.requiredCapabilities) {
    evaluateCapability(capability, requirements.minimumCapabilityAuthority, capabilityClaims, evidence.identity.route, evaluatedAt, reasons);
  }

  return Object.freeze({
    eligible: reasons.length === 0,
    use: requirements.use,
    reasons: Object.freeze(reasons),
    route: evidence.identity.route,
    normalizedModel: evidence.identity.normalizedModel,
    aliases: evidence.aliases,
  });
}

function evaluateRequiredState(
  evidence: ProviderModelEvidence,
  rule: RequiredStateRule,
  minimumAuthority: ProviderModelEvidenceAuthority,
  evaluatedAt: number,
  reasons: ProviderModelEligibilityReason[],
): void {
  const value = evidence.states[rule.state];
  if (value === "denied") {
    reasons.push(rule.deniedReason);
    return;
  }
  if (value !== "confirmed") {
    reasons.push(rule.missingReason);
    return;
  }

  const observations = evidence.observations.filter(
    (observation) => observation.state === rule.state,
  );
  if (observations.length === 0) {
    reasons.push(rule.missingReason);
    return;
  }

  if (observations.some((observation) => isFuture(observation, evaluatedAt))) {
    reasons.push(`future-${rule.staleLabel}-evidence`);
    return;
  }

  const freshObservations = observations.filter((observation) => isFresh(observation, evaluatedAt));
  if (freshObservations.length === 0) {
    reasons.push(`stale-${rule.staleLabel}-evidence`);
    return;
  }
  const allowedObservations = freshObservations.filter(
    (observation) => STATE_AUTHORITY_OWNERS[rule.state].includes(observation.authority),
  );
  if (allowedObservations.length === 0) {
    reasons.push(`insufficient-${rule.authorityLabel}-authority`);
    return;
  }
  const confirmedObservations = allowedObservations.filter((observation) => observation.value === "confirmed");
  if (confirmedObservations.length === 0) {
    reasons.push(rule.deniedReason);
    return;
  }
  const highestAuthority = Math.max(...confirmedObservations.map(
    (observation) => AUTHORITY_RANK[observation.authority],
  ));
  if (highestAuthority < AUTHORITY_RANK[minimumAuthority]) {
    reasons.push(`insufficient-${rule.authorityLabel}-authority`);
    return;
  }
  const controllingObservations = allowedObservations.filter(
    (observation) => AUTHORITY_RANK[observation.authority] >= highestAuthority,
  );
  if (controllingObservations.some((observation) => observation.value === "denied")) {
    reasons.push(rule.deniedReason);
  }
}

function evaluateCapability(
  capability: string,
  minimumAuthority: ProviderModelEvidenceAuthority,
  claims: readonly ProviderModelCapabilityClaim[],
  route: ProviderModelRouteIdentity,
  evaluatedAt: number,
  reasons: ProviderModelEligibilityReason[],
): void {
  if (!isCanonicalModelCapability(capability)) {
    reasons.push(`unknown-capability:${capability}`);
    return;
  }
  for (const [index, claim] of claims.entries()) {
    validateCapabilityClaim(claim, index);
  }

  const matchingClaims = claims.filter(
    (claim) => claim.capability === capability && isSameProviderModelRoute(claim.route, route),
  );
  if (matchingClaims.length === 0) {
    reasons.push(`missing-capability:${capability}`);
    return;
  }

  const freshClaims = matchingClaims.filter((claim) => isFresh(claim, evaluatedAt));
  if (freshClaims.length === 0) {
    reasons.push(`stale-capability:${capability}`);
    return;
  }

  const sufficientlyAuthoritative = freshClaims.filter(
    (claim) => AUTHORITY_RANK[claim.authority] >= AUTHORITY_RANK[minimumAuthority],
  );
  if (sufficientlyAuthoritative.length === 0) {
    reasons.push(`insufficient-capability-authority:${capability}`);
    return;
  }
  const highestAuthority = Math.max(
    ...sufficientlyAuthoritative.map((claim) => AUTHORITY_RANK[claim.authority]),
  );
  const controllingClaims = sufficientlyAuthoritative.filter(
    (claim) => AUTHORITY_RANK[claim.authority] === highestAuthority,
  );
  if (!controllingClaims.every((claim) => claim.supported)) {
    reasons.push(`unsupported-capability:${capability}`);
  }
}

function isFresh(
  evidence: ProviderModelEvidenceObservation | ProviderModelCapabilityClaim,
  evaluatedAt: number,
): boolean {
  if (evidence.freshness !== "fresh") return false;
  if (isFuture(evidence, evaluatedAt)) return false;
  return evidence.expiresAt === undefined || Date.parse(evidence.expiresAt) > evaluatedAt;
}

function isFuture(
  evidence: ProviderModelEvidenceObservation | ProviderModelCapabilityClaim,
  evaluatedAt: number,
): boolean {
  return Date.parse(evidence.observedAt) > evaluatedAt;
}

function validateCapabilityClaim(claim: ProviderModelCapabilityClaim, index: number): void {
  requireText(claim.capability, `capabilityClaims[${index}].capability`);
  requireText(claim.provenance, `capabilityClaims[${index}].provenance`);
  requireText(claim.source.kind, `capabilityClaims[${index}].source.kind`);
  requireText(claim.source.id, `capabilityClaims[${index}].source.id`);
  if (claim.source.version !== undefined) requireText(claim.source.version, `capabilityClaims[${index}].source.version`);
  requireText(claim.route.providerId, `capabilityClaims[${index}].route.providerId`);
  requireText(claim.route.providerModelId, `capabilityClaims[${index}].route.providerModelId`);
  requireText(claim.route.scope, `capabilityClaims[${index}].route.scope`);
  const observedAt = parseTimestamp(claim.observedAt, `capabilityClaims[${index}].observedAt`);
  if (claim.expiresAt !== undefined) {
    const expiresAt = parseTimestamp(claim.expiresAt, `capabilityClaims[${index}].expiresAt`);
    if (expiresAt < observedAt) {
      throw new TypeError(`capabilityClaims[${index}].expiresAt must not precede observedAt`);
    }
  }
}


function requireText(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} must not be empty.`);
  }
}

function parseTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${field} must be an ISO-compatible timestamp.`);
  }
  return timestamp;
}
