import {
  createProviderModelEvidence,
  type ProviderModelEvidence,
  type ProviderModelEvidenceFailure,
  type ProviderModelEvidenceFreshness,
  type ProviderModelEvidenceObservation,
  type ProviderModelEvidenceSourceIdentity,
  type ProviderModelEvidenceState,
  type ProviderModelEvidenceValue,
  type ProviderModelEvidenceAuthority,
  type ProviderModelEvidenceStates,
} from "@kilnai/core";

export type ProviderCatalogObservationStatus = "available" | "partial" | "failed" | "unavailable";
export type ProviderCatalogObservationClassification =
  | ProviderCatalogObservationStatus
  | "stale";

export interface ProviderCatalogRawEntryInput {
  readonly rawId: string;
  readonly providerModelId: string;
  readonly scope: string;
  readonly normalizedFamily: string;
  readonly normalizedVersion?: string;
  readonly aliases: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ProviderCatalogFailureInput {
  readonly classification: string;
  readonly summary: string;
  readonly retryable: boolean;
}

export interface ProviderCatalogStateEvidenceInput {
  readonly state: ProviderModelEvidenceState;
  readonly value: ProviderModelEvidenceValue;
  readonly authority: ProviderModelEvidenceAuthority;
  readonly provenance?: string;
}

export interface ProviderCatalogObservationInput {
  readonly providerId: string;
  readonly harness?: {
    readonly harnessId: string;
    readonly reportedProviderId: string;
  };
  readonly source: ProviderModelEvidenceSourceIdentity;
  readonly observedAt: string;
  readonly expiresAt?: string;
  readonly freshness: ProviderModelEvidenceFreshness;
  readonly status: ProviderCatalogObservationStatus;
  readonly entries: readonly ProviderCatalogRawEntryInput[];
  readonly failures?: readonly ProviderCatalogFailureInput[];
  readonly stateEvidence?: readonly ProviderCatalogStateEvidenceInput[];
}

export interface NormalizedProviderCatalogRawEntry extends ProviderCatalogRawEntryInput {
  readonly index: number;
  readonly source: ProviderModelEvidenceSourceIdentity;
  readonly provenance: string;
}

export interface NormalizedProviderCatalogObservation {
  readonly providerId: string;
  readonly source: ProviderModelEvidenceSourceIdentity;
  readonly observedAt: string;
  readonly freshness: ProviderModelEvidenceFreshness;
  readonly classification: ProviderCatalogObservationClassification;
  readonly catalogEvidenceCurrent: boolean;
  readonly rawEntries: readonly NormalizedProviderCatalogRawEntry[];
  readonly routes: readonly ProviderModelEvidence[];
  readonly failures: readonly ProviderModelEvidenceFailure[];
}

const CATALOG_EVIDENCE_STATES: ProviderModelEvidenceStates = Object.freeze({
  advertised: "confirmed",
  discovered: "confirmed",
  configured: "unknown",
  authenticated: "unknown",
  entitled: "unknown",
  capabilityCompatible: "unknown",
  policyAdmitted: "unknown",
  routeHealthy: "unknown",
  probeVerified: "unknown",
  selectable: "unknown",
});

export function normalizeProviderCatalogObservation(
  input: ProviderCatalogObservationInput,
): NormalizedProviderCatalogObservation {
  const classification = classifyCatalog(input.status, input.freshness);
  const rawEntries = input.entries.map((entry, index) => Object.freeze({
    ...entry,
    index,
    source: input.source,
    provenance: input.source.id,
  }));
  const failures = Object.freeze((input.failures ?? []).map((failure) => Object.freeze({
    classification: failure.classification,
    source: input.source,
    observedAt: input.observedAt,
    retryable: failure.retryable,
    summary: failure.summary,
  })));
  const states = buildCatalogStates(input.stateEvidence);
  const routes = Object.freeze(Array.from(groupByRoute(rawEntries).values()).map((entries) => {
    const first = entries[0];
    if (!first) {
      throw new TypeError("provider catalog route groups must not be empty");
    }
    const observations = buildCatalogObservations(input, classification);
    return createProviderModelEvidence({
      identity: {
        ...(input.harness
          ? {
              harness: {
                harnessId: input.harness.harnessId,
                reportedProviderId: input.harness.reportedProviderId,
                reportedModelId: first.rawId,
              },
            }
          : {}),
        provider: { providerId: input.providerId },
        normalizedModel: {
          family: first.normalizedFamily,
          ...(first.normalizedVersion ? { version: first.normalizedVersion } : {}),
        },
        route: {
          providerId: input.providerId,
          providerModelId: first.providerModelId,
          scope: first.scope,
        },
      },
      aliases: Object.freeze(entries.flatMap((entry) => entry.aliases.map((alias) => Object.freeze({
        alias,
        rawId: entry.rawId,
        provenance: input.source.id,
        source: input.source,
      })))),
      states,
      observations,
      failures,
    });
  }));

  return Object.freeze({
    providerId: input.providerId,
    source: input.source,
    observedAt: input.observedAt,
    freshness: input.freshness,
    classification,
    catalogEvidenceCurrent: classification === "available",
    rawEntries: Object.freeze(rawEntries),
    routes,
    failures,
  });
}

function buildCatalogStates(
  stateEvidence: readonly ProviderCatalogStateEvidenceInput[] | undefined,
): ProviderModelEvidenceStates {
  const states: Record<ProviderModelEvidenceState, ProviderModelEvidenceValue> = {
    ...CATALOG_EVIDENCE_STATES,
  };
  for (const evidence of stateEvidence ?? []) {
    states[evidence.state] = evidence.value;
  }
  return Object.freeze(states);
}

function classifyCatalog(
  status: ProviderCatalogObservationStatus,
  freshness: ProviderModelEvidenceFreshness,
): ProviderCatalogObservationClassification {
  if (freshness !== "fresh") return "stale";
  return status;
}

function groupByRoute(
  entries: readonly NormalizedProviderCatalogRawEntry[],
): Map<string, readonly NormalizedProviderCatalogRawEntry[]> {
  const groups = new Map<string, NormalizedProviderCatalogRawEntry[]>();
  for (const entry of entries) {
    const key = `${entry.providerModelId}\u0000${entry.scope}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return groups;
}

function buildCatalogObservations(
  input: ProviderCatalogObservationInput,
  classification: ProviderCatalogObservationClassification,
): readonly ProviderModelEvidenceObservation[] {
  const value = classification === "available" || classification === "partial"
    ? "confirmed"
    : "unknown";
  return Object.freeze([
    Object.freeze({
      state: "advertised",
      value,
      provenance: input.source.id,
      authority: "harness-reported",
      source: input.source,
      observedAt: input.observedAt,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      freshness: input.freshness,
    }),
    Object.freeze({
      state: "discovered",
      value,
      provenance: input.source.id,
      authority: "harness-reported",
      source: input.source,
      observedAt: input.observedAt,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      freshness: input.freshness,
    }),
    ...(input.stateEvidence ?? []).map((evidence) => Object.freeze({
      state: evidence.state,
      value: evidence.value,
      provenance: evidence.provenance ?? input.source.id,
      authority: evidence.authority,
      source: input.source,
      observedAt: input.observedAt,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      freshness: input.freshness,
    })),
  ]);
}
