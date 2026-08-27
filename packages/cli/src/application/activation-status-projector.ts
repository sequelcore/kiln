import type { EffectiveAuthorityAdmissionBundle, RuntimeConfigurationRevisionSnapshot } from "@kilnai/runtime";
import type {
  KilnConfigActivationClass,
  KilnConfigMutationScope,
  KilnConfigReconciliationTarget,
} from "@kilnai/gateway-contracts";
import type {
  ConfigMutationProgressMarker,
  ConfigMutationProposalRecord,
  ConfigMutationReconciliationGeneration,
  StoredConfigMutationSettlement,
} from "./config-mutation-store.js";
import { TranscriptStore } from "../wrapper/session-store.js";

/** A persisted admission boundary reduced to the evidence this projector needs. */
export type ActivationAdmissionBoundary = Pick<
  EffectiveAuthorityAdmissionBundle,
  "sessionId" | "turnId" | "admittedAt"
> & {
  readonly configuration: Pick<EffectiveAuthorityAdmissionBundle["configuration"], "sessionRevision" | "turnRevision">;
};

export type ActivationStatusState =
  | "not-started"
  | "pending"
  | "scheduled"
  | "active"
  | "failed"
  | "superseded"
  | "unsupported";

export type ActivationStatusEvidence =
  | "none"
  | "progress"
  | "scheduled"
  | "read-back"
  | "reconciliation"
  | "turn-boundary"
  | "session-boundary"
  | "mismatched-generations"
  | "superseded"
  | "unsupported";

export interface ActivationStatusEntry {
  readonly proposalId: string;
  readonly scope: KilnConfigMutationScope;
  readonly path: string;
  readonly committedRevision: string;
  readonly boundary: KilnConfigActivationClass;
  readonly state: ActivationStatusState;
  readonly activeRevision: string | null;
  readonly evidence: ActivationStatusEvidence;
  readonly reconciliationGenerations: readonly ConfigMutationReconciliationGeneration[];
  readonly settledAt?: string;
  readonly summary: string;
}

export interface ActivationStatusProjection {
  /** The exact canonical desired revision set currently read by Runtime. */
  readonly desiredRevisionSetId: string;
  readonly state: ActivationStatusState;
  readonly boundary: KilnConfigActivationClass | null;
  /** Set only when every current lineage has qualifying activation evidence. */
  readonly activeRevision: string | null;
  readonly entries: readonly ActivationStatusEntry[];
  readonly summary: string;
}

export interface ActivationStatusProjectionInput {
  readonly desiredRevision: RuntimeConfigurationRevisionSnapshot;
  readonly settlements: readonly StoredConfigMutationSettlement[];
  readonly progress: readonly ConfigMutationProgressMarker[];
  readonly proposals?: readonly ConfigMutationProposalRecord[];
  readonly admittedBundles: readonly ActivationAdmissionBoundary[];
}

/** Reads only secret-free persisted bundle boundaries; no live configuration is consulted. */
export async function readPersistedActivationAdmissionBoundaries(
  projectPath: string,
): Promise<readonly ActivationAdmissionBoundary[]> {
  const records = await new TranscriptStore(projectPath).readAllAuthorityAdmissions();
  return records.map((record) => ({
    sessionId: record.bundle.sessionId,
    turnId: record.bundle.turnId,
    admittedAt: record.bundle.admittedAt,
    configuration: {
      sessionRevision: record.bundle.configuration.sessionRevision,
      turnRevision: record.bundle.configuration.turnRevision,
    },
  }));
}

/**
 * Projects activation from immutable canonical evidence and boundary proof.
 *
 * The projector deliberately does not read configuration values or persist a
 * status record. A next-turn/session settlement remains scheduled until a
 * persisted authority bundle carries the exact desired revision and its
 * latest activation lineage across the named boundary.
 */
export function projectActivationStatus(
  input: ActivationStatusProjectionInput,
): ActivationStatusProjection {
  const lineages = input.desiredRevision.activationLineage ?? [];
  const lineageProposalIds = new Set(lineages.map((lineage) => lineage.proposalId));
  const entries = [
    ...lineages.map((lineage) => projectLineage(input, lineage)),
    ...input.progress
      .filter((marker) => !lineageProposalIds.has(marker.proposalId)
        && !input.settlements.some((settlement) => settlement.proposalId === marker.proposalId))
      .map((marker) => projectUnmatchedProgress(input, marker, lineages)),
  ];
  if (entries.length === 0) {
    return {
      desiredRevisionSetId: input.desiredRevision.revisionSetId,
      state: "not-started",
      boundary: null,
      activeRevision: null,
      entries: [],
      summary: "No terminal activation lineage proves the current canonical revision.",
    };
  }

  const state = aggregateState(entries);
  const representative = latestEntryForState(entries, state);
  return {
    desiredRevisionSetId: input.desiredRevision.revisionSetId,
    state,
    boundary: representative?.boundary ?? null,
    activeRevision: state === "active" ? input.desiredRevision.revisionSetId : null,
    entries,
    summary: summaryForState(state, representative),
  };
}

function projectUnmatchedProgress(
  input: ActivationStatusProjectionInput,
  marker: ConfigMutationProgressMarker,
  currentLineages: readonly ActivationLineage[],
): ActivationStatusEntry {
  const proposal = input.proposals?.find((candidate) => candidate.proposal.proposalId === marker.proposalId)?.proposal;
  const scope = proposal?.scope ?? (logicalPath(marker.path) === "config.yaml" ? "global" : "project");
  const path = logicalPath(proposal?.affectedCanonicalPaths[0] ?? marker.path);
  const currentAtPath = currentLineages.find((lineage) => lineage.scope === scope && lineage.path === path);
  const currentSettlement = currentAtPath === undefined
    ? undefined
    : input.settlements.find((settlement) => settlement.proposalId === currentAtPath.proposalId);
  const superseded = currentAtPath !== undefined
    && currentAtPath.proposalId !== marker.proposalId
    && currentSettlement !== undefined
    && Date.parse(currentSettlement.settledAt) > Date.parse(marker.startedAt);
  return {
    proposalId: marker.proposalId,
    scope,
    path,
    committedRevision: marker.intendedRevision,
    boundary: proposal?.activation ?? "restart-required",
    state: superseded ? "superseded" : "pending",
    activeRevision: null,
    evidence: superseded ? "superseded" : "progress",
    reconciliationGenerations: [],
    summary: superseded
      ? "An in-flight mutation was superseded by a newer canonical lineage."
      : "A canonical mutation is still in progress before its terminal settlement.",
  };
}

type ActivationLineage = NonNullable<RuntimeConfigurationRevisionSnapshot["activationLineage"]>[number];

function projectLineage(
  input: ActivationStatusProjectionInput,
  lineage: ActivationLineage,
): ActivationStatusEntry {
  const matching = input.settlements
    .filter((settlement) => settlement.proposalId === lineage.proposalId)
    .sort((left, right) => left.settledAt.localeCompare(right.settledAt))
    .at(-1);
  const exact = matching !== undefined && settlementMatchesLineage(matching, lineage);

  if (matching !== undefined && !exact) {
    return entryFromSettlement(matching, lineage, {
      state: "failed",
      evidence: "mismatched-generations",
      summary: "A terminal settlement exists, but its reconciliation generations do not match the current desired lineage.",
    });
  }

  if (matching === undefined) {
    const marker = input.progress.find((candidate) => candidate.proposalId === lineage.proposalId);
    if (marker !== undefined) {
      const proposal = input.proposals?.find((candidate) => candidate.proposal.proposalId === marker.proposalId)?.proposal;
      const boundary = proposal?.activation ?? "restart-required";
      return {
        proposalId: lineage.proposalId,
        scope: lineage.scope,
        path: lineage.path,
        committedRevision: lineage.committedRevision,
        boundary,
        state: "pending",
        activeRevision: null,
        evidence: "progress",
        reconciliationGenerations: normalizeGenerations(lineage.reconciliationGenerations),
        summary: "The canonical mutation is still in progress; activation is not proven.",
      };
    }
    return {
      proposalId: lineage.proposalId,
      scope: lineage.scope,
      path: lineage.path,
      committedRevision: lineage.committedRevision,
      boundary: "restart-required",
      state: "unsupported",
      activeRevision: null,
      evidence: "unsupported",
      reconciliationGenerations: normalizeGenerations(lineage.reconciliationGenerations),
      summary: "The current desired revision has no matching terminal settlement evidence.",
    };
  }

  return projectTerminalSettlement(input, matching, lineage);
}

function projectTerminalSettlement(
  input: ActivationStatusProjectionInput,
  settlement: StoredConfigMutationSettlement,
  lineage: ActivationLineage,
): ActivationStatusEntry {
  const base = {
    proposalId: lineage.proposalId,
    scope: lineage.scope,
    path: lineage.path,
    committedRevision: lineage.committedRevision,
    boundary: settlement.activation,
    reconciliationGenerations: normalizeGenerations(lineage.reconciliationGenerations),
    settledAt: settlement.settledAt,
  } as const;

  if (!validActivationObservation(settlement)) {
    return {
      ...base,
      state: "failed",
      activeRevision: null,
      evidence: "none",
      summary: "The terminal settlement carries invalid activation observation evidence.",
    };
  }

  const observation = settlement.activationObservation;

  if (settlement.activation === "restart-required"
    || observation.state === "unsupported") {
    return {
      ...base,
      state: "unsupported",
      activeRevision: null,
      evidence: "unsupported",
      summary: observation.summary,
    };
  }
  if (observation.state === "superseded") {
    return {
      ...base,
      state: "superseded",
      activeRevision: null,
      evidence: "superseded",
      summary: observation.summary,
    };
  }
  if (settlement.outcome === "committed-reconciliation-failed"
    || observation.state === "failed") {
    return {
      ...base,
      state: "failed",
      activeRevision: null,
      evidence: "none",
      summary: observation.summary,
    };
  }

  if (settlement.activation === "hot") {
    return observation.state === "active"
      ? {
          ...base,
          state: "active",
          activeRevision: settlement.committedRevision,
          evidence: "read-back",
          summary: observation.summary,
        }
      : {
          ...base,
          state: "failed",
          activeRevision: null,
          evidence: "none",
          summary: "Hot activation has no qualifying owner read-back proof.",
        };
  }

  if (settlement.activation === "reconcile") {
    return observation.state === "active"
      ? {
          ...base,
          state: "active",
          activeRevision: settlement.committedRevision,
          evidence: "reconciliation",
          summary: observation.summary,
        }
      : {
          ...base,
          state: "failed",
          activeRevision: null,
          evidence: "none",
          summary: "Reconciliation did not provide a qualifying active observation.",
        };
  }

  const boundary = settlement.activation === "next-turn" ? "turnRevision" : "sessionRevision";
  const qualifyingBundle = input.admittedBundles
    .filter((bundle) => Date.parse(bundle.admittedAt) >= Date.parse(settlement.settledAt))
    .find((bundle) => sameRevision(bundle.configuration[boundary], input.desiredRevision));
  if (qualifyingBundle !== undefined) {
    return {
      ...base,
      state: "active",
      activeRevision: settlement.committedRevision,
      evidence: settlement.activation === "next-turn" ? "turn-boundary" : "session-boundary",
      summary: settlement.activation === "next-turn"
        ? "A persisted turn admission proves the desired revision crossed the next-turn boundary."
        : "A persisted session admission proves the desired revision crossed the next-session boundary.",
    };
  }
  return {
    ...base,
    state: "scheduled",
    activeRevision: null,
    evidence: "scheduled",
    summary: settlement.activation === "next-turn"
      ? "The committed revision remains scheduled until a matching turn admission is persisted."
      : "The committed revision remains scheduled until a matching session admission is persisted.",
  };
}

function entryFromSettlement(
  settlement: StoredConfigMutationSettlement,
  lineage: ActivationLineage,
  override: Pick<ActivationStatusEntry, "state" | "evidence" | "summary">,
): ActivationStatusEntry {
  return {
    proposalId: lineage.proposalId,
    scope: lineage.scope,
    path: lineage.path,
    committedRevision: lineage.committedRevision,
    boundary: settlement.activation,
    ...override,
    activeRevision: null,
    reconciliationGenerations: normalizeGenerations(settlement.reconciliationGenerations ?? []),
    settledAt: settlement.settledAt,
  };
}

function settlementMatchesLineage(
  settlement: StoredConfigMutationSettlement,
  lineage: ActivationLineage,
): boolean {
  return settlement.scope === lineage.scope
    && settlement.committedRevision === lineage.committedRevision
    && settlement.appliedWrites.some((write) => logicalPath(write.path) === lineage.path)
    && sameGenerations(settlement.reconciliationGenerations ?? [], lineage.reconciliationGenerations);
}

/** A settlement is evidence only when its observation is internally exact. */
function validActivationObservation(settlement: StoredConfigMutationSettlement): boolean {
  const observation = settlement.activationObservation;
  if (observation.boundary !== settlement.activation
    || observation.committedRevision !== settlement.committedRevision
    || typeof observation.summary !== "string"
    || observation.summary.trim().length === 0) return false;
  if (observation.state === "not-started") {
    return settlement.outcome === "rejected"
      && settlement.committedRevision === null
      && observation.activeRevision === null;
  }
  if (observation.state !== "active" && observation.state !== "scheduled"
    && observation.state !== "failed" && observation.state !== "superseded"
    && observation.state !== "unsupported") return false;
  if (settlement.committedRevision === null) return false;
  if (observation.state === "active") {
    return (observation.boundary === "hot" || observation.boundary === "reconcile")
      && settlement.outcome === "committed"
      && observation.activeRevision === observation.committedRevision;
  }
  if (observation.state === "scheduled") {
    return (observation.boundary === "next-turn" || observation.boundary === "next-session")
      && settlement.outcome === "committed"
      && observation.activeRevision === null;
  }
  return observation.activeRevision === null;
}

function sameRevision(
  left: RuntimeConfigurationRevisionSnapshot,
  right: RuntimeConfigurationRevisionSnapshot,
): boolean {
  return left.revisionSetId === right.revisionSetId
    && left.revisions.global === right.revisions.global
    && left.revisions.project === right.revisions.project
    && left.revisions["execution-target-evidence"] === right.revisions["execution-target-evidence"]
    && sameLineages(left.activationLineage ?? [], right.activationLineage ?? []);
}

function sameLineages(
  left: readonly ActivationLineage[],
  right: readonly ActivationLineage[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((candidate, index) => {
    const other = right[index];
    return other !== undefined
      && candidate.proposalId === other.proposalId
      && candidate.scope === other.scope
      && candidate.path === other.path
      && candidate.committedRevision === other.committedRevision
      && sameGenerations(candidate.reconciliationGenerations, other.reconciliationGenerations);
  });
}

function sameGenerations(
  left: readonly { readonly target: string; readonly generation: string }[],
  right: readonly { readonly target: string; readonly generation: string }[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((candidate, index) => {
    const other = right[index];
    return other?.target === candidate.target && other.generation === candidate.generation;
  });
}

function normalizeGenerations(
  generations: readonly { readonly target: string; readonly generation: string }[],
): readonly ConfigMutationReconciliationGeneration[] {
  const targets: readonly KilnConfigReconciliationTarget[] = [
    "native-agents",
    "native-skills",
    "native-permissions",
    "repo-shims",
    "execution-targets",
  ];
  const normalized: ConfigMutationReconciliationGeneration[] = [];
  for (const entry of generations) {
    if (!targets.includes(entry.target as KilnConfigReconciliationTarget)
      || !/^sha256:[a-f0-9]{64}$/u.test(entry.generation)) continue;
    normalized.push({
      target: entry.target as KilnConfigReconciliationTarget,
      generation: entry.generation as `sha256:${string}`,
    });
  }
  return normalized;
}

function aggregateState(entries: readonly ActivationStatusEntry[]): ActivationStatusState {
  if (entries.length === 0) return "not-started";
  const precedence: readonly ActivationStatusState[] = [
    "unsupported",
    "failed",
    "superseded",
    "pending",
    "scheduled",
    "active",
    "not-started",
  ];
  return precedence.find((state) => entries.some((entry) => entry.state === state)) ?? "not-started";
}

function latestEntryForState(
  entries: readonly ActivationStatusEntry[],
  state: ActivationStatusState,
): ActivationStatusEntry | undefined {
  return entries
    .filter((entry) => entry.state === state)
    .sort((left, right) => (right.settledAt ?? "").localeCompare(left.settledAt ?? "")
      || right.proposalId.localeCompare(left.proposalId))[0];
}

function summaryForState(state: ActivationStatusState, representative: ActivationStatusEntry | undefined): string {
  if (representative === undefined) return "No activation evidence is available.";
  if (state === "not-started") return "No activation evidence is available.";
  return representative.summary;
}

function logicalPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.endsWith("/config.yaml")) return "config.yaml";
  return "canonical";
}
