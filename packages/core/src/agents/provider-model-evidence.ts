export const PROVIDER_MODEL_EVIDENCE_STATES = [
  "advertised",
  "discovered",
  "configured",
  "authenticated",
  "entitled",
  "capabilityCompatible",
  "policyAdmitted",
  "routeHealthy",
  "probeVerified",
  "selectable",
] as const;

export type ProviderModelEvidenceState = (typeof PROVIDER_MODEL_EVIDENCE_STATES)[number];
export type ProviderModelEvidenceValue = "confirmed" | "denied" | "unknown" | "not-required";
export type ProviderModelEvidenceFreshness = "fresh" | "stale" | "expired" | "unknown";
export type ProviderModelEvidenceAuthority =
  | "provider-authoritative"
  | "harness-reported"
  | "operator-declared"
  | "runtime-observed"
  | "probe-verified"
  | "inferred";

const EVIDENCE_VALUES: readonly ProviderModelEvidenceValue[] = ["confirmed", "denied", "unknown", "not-required"];
const EVIDENCE_FRESHNESS_VALUES: readonly ProviderModelEvidenceFreshness[] = ["fresh", "stale", "expired", "unknown"];
const EVIDENCE_AUTHORITIES: readonly ProviderModelEvidenceAuthority[] = [
  "provider-authoritative",
  "harness-reported",
  "operator-declared",
  "runtime-observed",
  "probe-verified",
  "inferred",
];

export interface ProviderModelEvidenceSourceIdentity {
  readonly kind: string;
  readonly id: string;
  readonly version?: string;
}

export interface ProviderModelHarnessIdentity {
  readonly harnessId: string;
  readonly reportedProviderId: string;
  readonly reportedModelId: string;
}

export interface ProviderModelProviderIdentity {
  readonly providerId: string;
}

export interface ProviderModelNormalizedIdentity {
  readonly family: string;
  readonly version?: string;
}

export interface ProviderModelRouteIdentity {
  readonly providerId: string;
  readonly providerModelId: string;
  readonly scope: string;
}

/** Compares the complete execution-route identity without promoting any evidence. */
export function isSameProviderModelRoute(
  left: ProviderModelRouteIdentity,
  right: ProviderModelRouteIdentity,
): boolean {
  return left.providerId === right.providerId
    && left.providerModelId === right.providerModelId
    && left.scope === right.scope;
}

export interface ProviderModelIdentity {
  readonly harness?: ProviderModelHarnessIdentity;
  readonly provider: ProviderModelProviderIdentity;
  readonly normalizedModel: ProviderModelNormalizedIdentity;
  readonly route: ProviderModelRouteIdentity;
}

export interface ProviderModelAliasEvidence {
  readonly alias: string;
  readonly rawId: string;
  readonly provenance: string;
  readonly source: ProviderModelEvidenceSourceIdentity;
}

export type ProviderModelEvidenceStates = Readonly<Record<ProviderModelEvidenceState, ProviderModelEvidenceValue>>;

export interface ProviderModelEvidenceObservation {
  readonly state: ProviderModelEvidenceState;
  readonly value: ProviderModelEvidenceValue;
  readonly provenance: string;
  readonly authority: ProviderModelEvidenceAuthority;
  readonly source: ProviderModelEvidenceSourceIdentity;
  readonly observedAt: string;
  readonly expiresAt?: string;
  readonly freshness: ProviderModelEvidenceFreshness;
}

export interface ProviderModelEvidenceFailure {
  readonly classification: string;
  readonly source: ProviderModelEvidenceSourceIdentity;
  readonly observedAt: string;
  readonly retryable: boolean;
  readonly summary: string;
}

export interface ProviderModelEvidenceInput {
  readonly identity: ProviderModelIdentity;
  readonly aliases: readonly ProviderModelAliasEvidence[];
  readonly states: ProviderModelEvidenceStates;
  readonly observations: readonly ProviderModelEvidenceObservation[];
  readonly failures: readonly ProviderModelEvidenceFailure[];
}

export type ProviderModelEvidence = ProviderModelEvidenceInput;

const PROVIDER_MODEL_EVIDENCE_BRAND: unique symbol = Symbol("ProviderModelEvidence");

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

function requireMember<T extends string>(value: T, values: readonly T[], field: string): void {
  if (!values.includes(value)) {
    throw new TypeError(`${field} has an unsupported value.`);
  }
}

function copySource(source: ProviderModelEvidenceSourceIdentity, field: string): ProviderModelEvidenceSourceIdentity {
  requireText(source.kind, `${field}.kind`);
  requireText(source.id, `${field}.id`);
  if (source.version !== undefined) requireText(source.version, `${field}.version`);
  return Object.freeze({ ...source });
}

/**
 * Validates and snapshots provider-model evidence without deriving or promoting
 * any state. Eligibility is intentionally owned by a separate domain service.
 */
export function createProviderModelEvidence(input: ProviderModelEvidenceInput): ProviderModelEvidence {
  if (input.identity.harness !== undefined) {
    requireText(input.identity.harness.harnessId, "identity.harness.harnessId");
    requireText(input.identity.harness.reportedProviderId, "identity.harness.reportedProviderId");
    requireText(input.identity.harness.reportedModelId, "identity.harness.reportedModelId");
  }
  requireText(input.identity.provider.providerId, "identity.provider.providerId");
  requireText(input.identity.normalizedModel.family, "identity.normalizedModel.family");
  if (input.identity.normalizedModel.version !== undefined) {
    requireText(input.identity.normalizedModel.version, "identity.normalizedModel.version");
  }
  requireText(input.identity.route.providerId, "identity.route.providerId");
  requireText(input.identity.route.providerModelId, "identity.route.providerModelId");
  requireText(input.identity.route.scope, "identity.route.scope");
  if (input.identity.provider.providerId !== input.identity.route.providerId) {
    throw new TypeError("identity.provider.providerId must match identity.route.providerId");
  }

  for (const state of PROVIDER_MODEL_EVIDENCE_STATES) {
    if (input.states[state] === undefined) {
      throw new TypeError(`states.${state} is required.`);
    }
    requireMember(input.states[state], EVIDENCE_VALUES, `states.${state}`);
  }

  const identity = Object.freeze({
    ...(input.identity.harness === undefined
      ? {}
      : { harness: Object.freeze({ ...input.identity.harness }) }),
    provider: Object.freeze({ ...input.identity.provider }),
    normalizedModel: Object.freeze({ ...input.identity.normalizedModel }),
    route: Object.freeze({ ...input.identity.route }),
  });
  const aliases = Object.freeze(input.aliases.map((alias, index) => {
    requireText(alias.alias, `aliases[${index}].alias`);
    requireText(alias.rawId, `aliases[${index}].rawId`);
    requireText(alias.provenance, `aliases[${index}].provenance`);
    return Object.freeze({ ...alias, source: copySource(alias.source, `aliases[${index}].source`) });
  }));
  const observations = Object.freeze(input.observations.map((observation, index) => {
    requireMember(observation.state, PROVIDER_MODEL_EVIDENCE_STATES, `observations[${index}].state`);
    requireMember(observation.value, EVIDENCE_VALUES, `observations[${index}].value`);
    requireMember(observation.authority, EVIDENCE_AUTHORITIES, `observations[${index}].authority`);
    requireMember(observation.freshness, EVIDENCE_FRESHNESS_VALUES, `observations[${index}].freshness`);
    requireText(observation.provenance, `observations[${index}].provenance`);
    const observedAt = parseTimestamp(observation.observedAt, `observations[${index}].observedAt`);
    if (observation.expiresAt !== undefined) {
      const expiresAt = parseTimestamp(observation.expiresAt, `observations[${index}].expiresAt`);
      if (expiresAt < observedAt) {
        throw new TypeError(`observations[${index}].expiresAt must not precede observedAt`);
      }
    }
    return Object.freeze({
      ...observation,
      source: copySource(observation.source, `observations[${index}].source`),
    });
  }));
  const failures = Object.freeze(input.failures.map((failure, index) => {
    requireText(failure.classification, `failures[${index}].classification`);
    requireText(failure.summary, `failures[${index}].summary`);
    parseTimestamp(failure.observedAt, `failures[${index}].observedAt`);
    return Object.freeze({
      ...failure,
      source: copySource(failure.source, `failures[${index}].source`),
    });
  }));

  const evidence = {
    identity,
    aliases,
    states: Object.freeze({ ...input.states }),
    observations,
    failures,
  } as ProviderModelEvidence;
  Object.defineProperty(evidence, PROVIDER_MODEL_EVIDENCE_BRAND, {
    value: true,
    enumerable: false,
  });
  return Object.freeze(evidence);
}

export function assertProviderModelEvidence(value: ProviderModelEvidence): void {
  if ((value as unknown as Record<PropertyKey, unknown>)[PROVIDER_MODEL_EVIDENCE_BRAND] !== true) {
    throw new TypeError("Provider-model evidence must be created by createProviderModelEvidence");
  }
}
