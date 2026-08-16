import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import {
  createExecutionAccountPolicyId,
  createExecutionAccountRef,
  createManagedAccountAffinityKey,
  defineExecutionAccountCapacityRejection,
  defineExecutionAccountUsageEvidence,
  selectExecutionCapacityAccount,
  type ExecutionAccountPolicyId,
  type ExecutionAccountRef,
  type ManagedAccountAffinityCommitOutcome,
  type ManagedAccountAffinityKey,
  type ManagedAccountAffinityPolicy,
  type ManagedAccountLeaseEvidence,
  type ExecutionAccountCapacityCandidate,
  type ExecutionAccountAffinity,
  type ProviderModelRouteIdentity,
  type ManagedEconomicAdoptedSnapshot,
  type ManagedEconomicAdoptedSnapshotExpectation,
  type ManagedEconomicAmount,
  type ManagedEconomicCommitment,
  type ManagedEconomicExecutionAlternative,
  type ManagedEconomicSelectionDecision,
  type ManagedEconomicSettlement,
  type ManagedEconomicEvidenceIdentity,
  type SessionManagedEconomicRejection,
  validateManagedEconomicSettlement,
  selectManagedEconomicExecutionAlternative,
  validateManagedEconomicAdoptedSnapshot,
} from "@kilnai/core";
import { projectManagedEconomicDenialRejections } from "./managed-economic-denial-rejections.js";
import type { ManagedAgentProviderRoute } from "@kilnai/core";
import type {
  AccountCapacityAcquireInput,
  AccountCapacityAcquireResult,
  AccountCapacityRecord,
  AccountCapacitySettlement,
  ExecutionAccountAffinityRequest,
  ExecutionAccountCandidateBinding,
  ExecutionAccountCapacityObservation,
} from "../execution-kernel/execution-account-capacity-authority.js";

export interface ManagedAccountCandidateResolution {
  readonly route: ProviderModelRouteIdentity;
  readonly affinityPolicy: ManagedAccountAffinityPolicy;
  readonly candidates: readonly ExecutionAccountCandidateBinding[];
}

export interface ManagedAccountCandidatePort {
  resolve(input: {
    readonly accountPolicyId: ExecutionAccountPolicyId;
    readonly providerRoute: ManagedAgentProviderRoute;
  }): Promise<ManagedAccountCandidateResolution>;
}

export interface SqliteManagedAccountLeaseAuthorityOptions {
  readonly path: string;
  readonly ownerId?: string;
  readonly now?: () => number;
  readonly ownerStaleMs?: number;
  readonly participantKind?: SharedAccountCapacityParticipantKind;
  readonly recoveryDomain?: string;
  readonly configurationRevision?: string;
}

type LeaseRow = {
  lease_id: string;
  account_policy_id: string;
  account_ref: string;
  capacity_identity: string;
  provider_id: string;
  model_id: string;
  route_scope: string;
  job_id: string;
  runtime_invocation_id: string | null;
  economic_attempt_id: string | null;
  commitment_id: string | null;
  credential_revision_id: string;
  owner_id: string;
  acquired_at: string;
  lifecycle_state: ManagedAccountLeaseEvidence["lifecycleState"];
  released_at: string | null;
  selection_reason: ManagedAccountLeaseEvidence["selectionReason"];
  candidate_rejections: string;
  usage_evidence: string;
  affinity_outcome: ManagedAccountLeaseEvidence["affinityOutcome"] | null;
  purpose: "new" | "affinity";
  resource_uris: string;
  diagnostic_uris: string;
  affinity_key: string | null;
  affinity_expected_capacity_identity: string | null;
  affinity_commit_outcome: ManagedAccountAffinityCommitOutcome | null;
  participant_kind: string | null;
  recovery_domain: string | null;
  owner_generation: string | null;
  dispatch_fence_id: string | null;
  settlement_json: string | null;
  intent_fingerprint: string | null;
  configuration_revision: string | null;
};

type AccountOutcomeIncidentRow = Pick<LeaseRow,
  | "runtime_invocation_id"
  | "lifecycle_state"
  | "released_at"
  | "provider_id"
  | "model_id"
  | "route_scope"
  | "dispatch_fence_id"
  | "settlement_json"
>;

type AffinityRow = {
  affinity_key: string;
  capacity_identity: string;
};

type CommitmentRow = {
  commitment_id: string;
  reservation_id: string;
  job_id: string;
  economic_attempt_id: string;
  intent_fingerprint: string;
  policy_id: string;
  policy_revision: string;
  candidate_set_digest: string;
  snapshot_digest: string;
  decision_at: string;
  selected_route_id: string | null;
  capacity_identity: string | null;
  reserved_amounts: string;
  state: ManagedEconomicCommitmentState | "denied";
  owner_id: string;
  owner_generation: string;
  lease_id: string | null;
  dispatch_fence_id: string | null;
  decision_json: string;
  commitment_json: string | null;
  settlement_json: string | null;
  reconciliation_json: string | null;
};

const CAPACITY_CONSUMING_STATES = [
  "held",
  "dispatch-fenced",
  "settlement-pending",
  "release-failed",
  "leaked",
] as const;
const ACCOUNT_ONLY_CAPACITY_CONSUMING_STATES = ["held", "dispatch-fenced"] as const;

export interface AccountOutcomeIncidentInspectionOptions {
  readonly path: string;
  readonly participantKind: SharedAccountCapacityParticipantKind;
  readonly recoveryDomain: string;
}

/**
 * Reads retained unknown account-only outcomes without claiming participant ownership,
 * advancing a heartbeat, running recovery, or changing a lease generation.
 */
export function readAccountOutcomeIncidents(
  options: AccountOutcomeIncidentInspectionOptions,
): readonly AccountOutcomeIncident[] {
  if (!options.path.trim()) throw new TypeError("Managed account lease database path is required.");
  if (!existsSync(options.path)) return [];
  const participantKind = requireCanonicalText(
    options.participantKind,
    "Managed account participant kind is required.",
  );
  const recoveryDomain = requireCanonicalText(
    options.recoveryDomain,
    "Managed account recovery domain is required.",
  );
  const db = new Database(options.path, { readonly: true, strict: true });
  try {
    const openedVersion = Number(
      db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0,
    );
    if (openedVersion > SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(
        `Managed economic authority schema version ${openedVersion} is newer than supported version ${SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION}.`,
      );
    }
    const hasLeaseTable = db
      .query<{ present: number }, []>(
        "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='account_leases'",
      )
      .get();
    if (!hasLeaseTable) return [];
    return db
      .query<AccountOutcomeIncidentRow, [string, string]>(
        `SELECT runtime_invocation_id, lifecycle_state, released_at, provider_id, model_id,
                route_scope, dispatch_fence_id, settlement_json
         FROM account_leases
         WHERE economic_attempt_id IS NULL AND participant_kind=? AND recovery_domain=?
           AND settlement_json IS NOT NULL
         ORDER BY acquired_at, lease_id`,
      )
      .all(participantKind, recoveryDomain)
      .map(accountOutcomeIncident)
      .filter((incident): incident is AccountOutcomeIncident => incident !== undefined);
  } finally {
    db.close();
  }
}

export class SqliteManagedAccountLeaseAuthority {
  readonly #db: Database;
  readonly #ownerId: string;
  readonly #now: () => number;
  readonly #ownerStaleMs: number;
  readonly #participantKind: SharedAccountCapacityParticipantKind;
  readonly #recoveryDomain: string;
  readonly #configurationRevision: string;
  readonly #ownerGeneration = randomUUID();
  readonly #heartbeatTimer: ReturnType<typeof setInterval>;
  #closed = false;

  constructor(options: SqliteManagedAccountLeaseAuthorityOptions) {
    if (!options.path.trim()) throw new TypeError("Managed account lease database path is required.");
    this.#ownerId = requireCanonicalText(
      options.ownerId ?? randomUUID(),
      "Managed account lease owner id is required.",
    );
    this.#now = options.now ?? Date.now;
    this.#ownerStaleMs = options.ownerStaleMs ?? 30000;
    this.#participantKind = options.participantKind ?? "agent-task-runtime";
    this.#recoveryDomain = requireCanonicalText(
      options.recoveryDomain ?? "agent-tasks",
      "Managed account recovery domain is required.",
    );
    this.#configurationRevision = requireCanonicalText(
      options.configurationRevision ?? "unversioned",
      "Managed account configuration revision is required.",
    );
    if (!Number.isSafeInteger(this.#ownerStaleMs) || this.#ownerStaleMs < 1) {
      throw new TypeError("Managed account lease owner stale interval must be a positive integer.");
    }
    this.#db = new Database(options.path, { create: true, strict: true });
    let ownerClaimed = false;
    try {
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
      const openedVersion = Number(
        this.#db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0,
      );
      if (openedVersion > SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION) {
        throw new Error(
          `Managed economic authority schema version ${openedVersion} is newer than supported version ${SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION}.`,
        );
      }
      this.#db.exec(`CREATE TABLE IF NOT EXISTS participants (
        participant_kind TEXT NOT NULL, recovery_domain TEXT NOT NULL,
        owner_id TEXT NOT NULL, owner_generation TEXT NOT NULL, heartbeat INTEGER NOT NULL,
        config_revision TEXT NOT NULL, PRIMARY KEY(participant_kind,recovery_domain)
      );`);
      this.#migrateLeaseSchema();
      this.#claimOwner();
      ownerClaimed = true;
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS account_leases (
          lease_id TEXT PRIMARY KEY,
          account_policy_id TEXT NOT NULL,
          account_ref TEXT NOT NULL,
          capacity_identity TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          route_scope TEXT NOT NULL,
          job_id TEXT NOT NULL,
          runtime_invocation_id TEXT,
          economic_attempt_id TEXT,
          commitment_id TEXT,
          credential_revision_id TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL,
          released_at TEXT,
          selection_reason TEXT NOT NULL,
          candidate_rejections TEXT NOT NULL,
          usage_evidence TEXT NOT NULL,
          affinity_outcome TEXT,
          purpose TEXT NOT NULL,
          resource_uris TEXT NOT NULL,
          diagnostic_uris TEXT NOT NULL,
          affinity_key TEXT,
          affinity_expected_capacity_identity TEXT,
          affinity_commit_outcome TEXT
        );
        CREATE TABLE IF NOT EXISTS managed_account_affinities (
          affinity_key TEXT PRIMARY KEY,
          capacity_identity TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      this.#hardenDatabaseFiles(options.path);
    } catch (error) {
      if (ownerClaimed) this.#releaseOwnerClaim();
      this.#db.close();
      throw error;
    }
    this.#heartbeatTimer = setInterval(
      () => {
        try {
          this.#heartbeat();
        } catch {
          // Foreground operations fail closed after ownership loss.
        }
      },
      Math.max(250, Math.floor(this.#ownerStaleMs / 3)),
    );
    this.#heartbeatTimer.unref?.();
  }

  /**
   * Reads shared SQLite capacity without acquiring a lease. Admission still
   * rechecks it transactionally when a lease is acquired.
   */
  observeCandidateCapacity(
    candidates: readonly ExecutionAccountCandidateBinding[],
    work: "new" | "existing" = "new",
  ): readonly ExecutionAccountCapacityObservation[] {
    if (this.#closed) throw new Error("Managed account lease authority is closed.");
    return candidates.map((binding) => {
      const candidate = this.#candidateWithCurrentCapacity(binding, work);
      return Object.freeze({
        account: candidate.account,
        capacityIdentity: binding.capacityIdentity,
        leaseCapacity: candidate.leaseCapacity,
        reservedForNewWork: candidate.reservedForNewWork,
      });
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#heartbeatTimer);
    try {
      this.#db
        .query(
          "DELETE FROM participants WHERE participant_kind=? AND recovery_domain=? AND owner_id=? AND owner_generation=?",
        )
        .run(this.#participantKind, this.#recoveryDomain, this.#ownerId, this.#ownerGeneration);
    } finally {
      this.#db.close();
    }
  }

  #candidateWithCurrentCapacity(
    binding: ExecutionAccountCandidateBinding,
    work: "new" | "existing",
  ): ExecutionAccountCapacityCandidate {
    validateCandidateBinding(binding);
    const accountOnlyPlaceholders = ACCOUNT_ONLY_CAPACITY_CONSUMING_STATES.map(() => "?").join(",");
    const economicPlaceholders = ECONOMIC_CAPACITY_CONSUMING_STATES.map(() => "?").join(",");
    const counts = this.#db
      .query<{ total: number; new_work: number | null }, [string, ...string[]]>(
        `
      SELECT COUNT(*) total, SUM(CASE WHEN purpose='new' THEN 1 ELSE 0 END) new_work
      FROM account_leases
      WHERE capacity_identity=? AND (
        (economic_attempt_id IS NULL AND lifecycle_state IN (${accountOnlyPlaceholders}))
        OR
        (economic_attempt_id IS NOT NULL AND lifecycle_state IN (${economicPlaceholders}))
      )
    `,
      )
      .get(
        binding.capacityIdentity,
        ...ACCOUNT_ONLY_CAPACITY_CONSUMING_STATES,
        ...ECONOMIC_CAPACITY_CONSUMING_STATES,
      );
    const total = counts?.total ?? 0;
    const newWork = counts?.new_work ?? 0;
    const newWorkLimit = binding.capacity.maxConcurrency - binding.capacity.reservedAffinitySlots;
    const capacityUnavailable = total >= binding.capacity.maxConcurrency;
    const reservedCapacityUnavailable = work === "new" && newWork >= newWorkLimit;
    return {
      ...binding.candidate,
      leaseCapacity: capacityUnavailable ? "unavailable" : "available",
      pressure: binding.candidate.pressure + total / binding.capacity.maxConcurrency,
      reservedForNewWork: binding.candidate.reservedForNewWork || reservedCapacityUnavailable,
    };
  }

  #resolveAffinity(input: {
    readonly route: ProviderModelRouteIdentity;
    readonly affinityRequest: ExecutionAccountAffinityRequest;
    readonly candidates: readonly ExecutionAccountCandidateBinding[];
  }):
    | {
        readonly status: "ready";
        readonly work: "new" | "existing";
        readonly key?: ManagedAccountAffinityKey;
        readonly expectedCapacityIdentity: string | null;
        readonly accountAffinity?: ExecutionAccountAffinity;
        readonly allowRebind: boolean;
      }
    | {
        readonly status: "unavailable";
        readonly result: {
          readonly status: "unavailable";
          readonly rejections: ReturnType<typeof selectExecutionCapacityAccount>["rejections"];
        };
      } {
    if (input.affinityRequest.continuity === "none") {
      return {
        status: "ready",
        work: "new",
        expectedCapacityIdentity: null,
        allowRebind: false,
      };
    }

    const key = createManagedAccountAffinityKey(input.affinityRequest.key);
    const affinity = this.#db
      .query<AffinityRow, [string]>(
        `
      SELECT affinity_key, capacity_identity
      FROM managed_account_affinities
      WHERE affinity_key=?
    `,
      )
      .get(key);
    if (!affinity) {
      if (input.affinityRequest.continuity === "require") {
        return {
          status: "unavailable",
          result: {
            status: "unavailable",
            rejections: [],
          },
        };
      }
      return {
        status: "ready",
        work: "new",
        key,
        expectedCapacityIdentity: null,
        allowRebind: false,
      };
    }

    const binding = input.candidates.find((candidate) => candidate.capacityIdentity === affinity.capacity_identity);
    if (!binding) {
      return {
        status: "ready",
        work: "existing",
        key,
        expectedCapacityIdentity: affinity.capacity_identity,
        accountAffinity: {
          account: missingAffinityExecutionAccountRef(affinity.capacity_identity),
          route: input.route,
        },
        allowRebind: input.affinityRequest.allowRebind === true,
      };
    }

    return {
      status: "ready",
      work: "existing",
      key,
      expectedCapacityIdentity: affinity.capacity_identity,
      accountAffinity: {
        account: binding.candidate.account,
        route: input.route,
      },
      allowRebind: input.affinityRequest.allowRebind === true,
    };
  }

  #commitAffinity(row: LeaseRow): ManagedAccountAffinityCommitOutcome {
    const key = createManagedAccountAffinityKey(row.affinity_key!);
    const current = this.#db
      .query<AffinityRow, [string]>(
        `
      SELECT affinity_key, capacity_identity
      FROM managed_account_affinities
      WHERE affinity_key=?
    `,
      )
      .get(key);
    if (current?.capacity_identity === row.capacity_identity) {
      return "already-matched";
    }
    if ((current?.capacity_identity ?? null) !== row.affinity_expected_capacity_identity) {
      return "conflict";
    }

    const now = new Date(this.#now()).toISOString();
    if (!current) {
      const inserted = this.#db
        .query(
          `
        INSERT INTO managed_account_affinities(
          affinity_key, capacity_identity, created_at, updated_at
        ) VALUES(?,?,?,?)
      `,
        )
        .run(key, row.capacity_identity, now, now);
      if (inserted.changes !== 1) {
        throw new Error("Managed account affinity first-bind fence was lost.");
      }
    } else {
      const updated = this.#db
        .query(
          `
        UPDATE managed_account_affinities
        SET capacity_identity=?, updated_at=?
        WHERE affinity_key=? AND capacity_identity=?
      `,
        )
        .run(row.capacity_identity, now, key, row.affinity_expected_capacity_identity);
      if (updated.changes !== 1) {
        throw new Error("Managed account affinity rebind fence was lost.");
      }
    }
    return "won";
  }

  #rowForLease(leaseId: string): LeaseRow | null {
    return this.#db.query<LeaseRow, [string]>("SELECT * FROM account_leases WHERE lease_id=?").get(leaseId) ?? null;
  }

  #requiredRow(leaseId: string): LeaseRow {
    const row = this.#rowForLease(leaseId);
    if (row === null) throw new Error("Managed account lease persistence failed.");
    return row;
  }

  #economicAffinityResolution(
    route: ProviderModelRouteIdentity,
    affinityRequest: ExecutionAccountAffinityRequest,
    candidates: readonly ExecutionAccountCandidateBinding[],
  ) {
    return this.#resolveAffinity({
      route,
      affinityRequest,
      candidates,
    });
  }

  #commitmentRow(jobId: string, economicAttemptId: string): CommitmentRow | null {
    requireEconomicAttemptId(economicAttemptId);
    return (
      this.#db
        .query<CommitmentRow, [string, string]>(
          "SELECT * FROM economic_commitments WHERE job_id=? AND economic_attempt_id=?",
        )
        .get(jobId, economicAttemptId) ?? null
    );
  }

  #requiredCommitmentRow(jobId: string, economicAttemptId: string): CommitmentRow {
    const row = this.#commitmentRow(jobId, economicAttemptId);
    if (!row) throw new Error("Managed economic commitment does not exist.");
    return row;
  }

  #rowForOptionalLease(leaseId: string | null): LeaseRow | null {
    return leaseId === null ? null : this.#rowForLease(leaseId);
  }

  #insertCommitmentDecision(
    input: ManagedEconomicCommitmentAcquireInput,
    evidence: ManagedEconomicAuthorityDecisionEvidence,
  ): void {
    this.#db
      .query(
        `INSERT INTO economic_commitments(
      commitment_id,reservation_id,job_id,economic_attempt_id,intent_fingerprint,
      policy_id,policy_revision,candidate_set_digest,snapshot_digest,decision_at,
      selected_route_id,capacity_identity,reserved_amounts,state,owner_id,owner_generation,
      lease_id,dispatch_fence_id,decision_json,commitment_json,settlement_json,reconciliation_json
    ) VALUES(?,?,?,?,?,?,?,?,?, ?,NULL,NULL,'[]','denied',?,?,NULL,NULL,?,NULL,NULL,NULL)`,
      )
      .run(
        randomUUID(),
        randomUUID(),
        input.jobId,
        input.economicAttemptId,
        input.intentFingerprint,
        input.snapshot.policy.policyId,
        input.snapshot.policy.policyRevision,
        input.snapshot.candidateSetDigest,
        input.snapshot.snapshotDigest,
        input.snapshot.adoptedDecisionAt,
        this.#ownerId,
        this.#ownerGeneration,
        JSON.stringify(evidence),
      );
  }

  #hasEconomicCapacity(
    routeId: string,
    ceiling: ManagedEconomicAmount,
    requested: readonly ManagedEconomicAmount[],
  ): "available" | "exhausted" | "comparison-domain-incompatible" {
    const rows = this.#db
      .query<{ reserved_amounts: string }, [string, ...string[]]>(
        `
      SELECT reserved_amounts FROM economic_commitments
      WHERE selected_route_id=? AND state IN (${ECONOMIC_CAPACITY_CONSUMING_STATES.map(() => "?").join(",")})
    `,
      )
      .all(routeId, ...ECONOMIC_CAPACITY_CONSUMING_STATES);
    let used = 0n;
    for (const row of rows) {
      for (const amount of parseEconomicAmounts(row.reserved_amounts)) {
        const scaled = amountInScale(amount, ceiling);
        if (scaled === null) return "comparison-domain-incompatible";
        used += scaled;
      }
    }
    for (const amount of requested) {
      const scaled = amountInScale(amount, ceiling);
      if (scaled === null) return "comparison-domain-incompatible";
      used += scaled;
    }
    return used <= BigInt(ceiling.atoms) ? "available" : "exhausted";
  }

  #reservationExceedsCeiling(requested: readonly ManagedEconomicAmount[], ceiling: ManagedEconomicAmount): boolean {
    let reserved = 0n;
    for (const amount of requested) {
      const scaled = amountInScale(amount, ceiling);
      if (scaled === null) return false;
      reserved += scaled;
    }
    return reserved > BigInt(ceiling.atoms);
  }

  #insertEconomicLease(
    input: ManagedEconomicCommitmentAcquireInput,
    commitmentId: string,
    selected: ManagedEconomicExecutionAlternative,
    account: {
      readonly binding: ExecutionAccountCandidateBinding;
      readonly resolution: {
        readonly status: "ready";
        readonly work: "new" | "existing";
        readonly key?: ManagedAccountAffinityKey;
        readonly expectedCapacityIdentity: string | null;
      };
      readonly selection: Exclude<ReturnType<typeof selectExecutionCapacityAccount>["selected"], undefined>;
      readonly rejections: ReturnType<typeof selectExecutionCapacityAccount>["rejections"];
    },
  ): string {
    if (selected.identity.account.kind !== "account-bound") {
      throw new Error("Managed economic account lease requires an account-bound selected identity.");
    }
    const leaseId = randomUUID();
    const route = economicProviderModelRouteIdentity(selected.identity.route);
    const acquiredAt = new Date(this.#now()).toISOString();
    this.#db
      .query(
        `INSERT INTO account_leases(
      lease_id,account_policy_id,account_ref,capacity_identity,provider_id,model_id,route_scope,
      job_id,runtime_invocation_id,economic_attempt_id,commitment_id,credential_revision_id,owner_id,acquired_at,lifecycle_state,
      released_at,selection_reason,candidate_rejections,usage_evidence,affinity_outcome,purpose,
      resource_uris,diagnostic_uris,affinity_key,affinity_expected_capacity_identity,affinity_commit_outcome
    ) VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?,?,?, 'held',NULL,?,?,?,?,?,?,?,?,?,NULL)`,
      )
      .run(
        leaseId,
        selected.identity.route.accountPolicyId,
        selected.identity.account.accountRef,
        account.binding.capacityIdentity,
        route.providerId,
        route.providerModelId,
        route.scope,
        input.jobId,
        input.economicAttemptId,
        commitmentId,
        account.binding.credentialRevisionId,
        this.#ownerId,
        acquiredAt,
        account.selection.reason,
        JSON.stringify(account.rejections),
        JSON.stringify(defineExecutionAccountUsageEvidence(account.binding.usageEvidence)),
        null,
        account.resolution.work === "existing" ? "affinity" : "new",
        JSON.stringify([`kiln://managed-accounts/leases/${encodeURIComponent(leaseId)}`]),
        "[]",
        account.resolution.key ?? null,
        account.resolution.expectedCapacityIdentity,
      );
    const row = this.#requiredRow(leaseId);
    if (row.affinity_key !== null) {
      const outcome = this.#commitAffinity(row);
      this.#db.query("UPDATE account_leases SET affinity_commit_outcome=? WHERE lease_id=?").run(outcome, leaseId);
    }
    return leaseId;
  }

  #releaseEconomicLeaseAndAffinity(leaseId: string): void {
    const row = this.#requiredRow(leaseId);
    if (row.lifecycle_state !== "held") throw new Error("Managed economic account lease is not releasable.");
    this.#rollbackWinningAffinity(row);
    this.#db
      .query(
        "UPDATE account_leases SET lifecycle_state='released',released_at=? WHERE lease_id=? AND lifecycle_state='held'",
      )
      .run(new Date(this.#now()).toISOString(), leaseId);
  }

  #rollbackWinningAffinity(row: LeaseRow): void {
    if (row.affinity_key === null || row.affinity_commit_outcome !== "won") return;
    if (row.affinity_expected_capacity_identity === null) {
      this.#db
        .query("DELETE FROM managed_account_affinities WHERE affinity_key=? AND capacity_identity=?")
        .run(row.affinity_key, row.capacity_identity);
    } else {
      this.#db
        .query(
          "UPDATE managed_account_affinities SET capacity_identity=?,updated_at=? WHERE affinity_key=? AND capacity_identity=?",
        )
        .run(
          row.affinity_expected_capacity_identity,
          new Date(this.#now()).toISOString(),
          row.affinity_key,
          row.capacity_identity,
        );
    }
  }

  #migrateLeaseSchema(): void {
    const version = Number(
      this.#db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0,
    );
    if (version > SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(
        `Managed economic authority schema version ${version} is newer than supported version ${SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION}.`,
      );
    }
    // SQLite only honors foreign_keys changes outside transactions; rebuilding
    // the canonical lease table must not leave enforcement disabled afterward.
    this.#db.exec("PRAGMA foreign_keys=OFF;");
    try {
      this.#db
        .transaction(() => {
          this.#db.exec(`
        CREATE TABLE IF NOT EXISTS account_leases (
          lease_id TEXT PRIMARY KEY, account_policy_id TEXT NOT NULL, account_ref TEXT NOT NULL,
          capacity_identity TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
          route_scope TEXT NOT NULL, job_id TEXT NOT NULL, runtime_invocation_id TEXT,
          economic_attempt_id TEXT, commitment_id TEXT,
          credential_revision_id TEXT NOT NULL, owner_id TEXT NOT NULL, acquired_at TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL, released_at TEXT, selection_reason TEXT NOT NULL,
          candidate_rejections TEXT NOT NULL, usage_evidence TEXT NOT NULL DEFAULT '{"health":"healthy","freshness":"missing"}',
          affinity_outcome TEXT, purpose TEXT NOT NULL, resource_uris TEXT NOT NULL,
          diagnostic_uris TEXT NOT NULL, affinity_key TEXT,
          affinity_expected_capacity_identity TEXT, affinity_commit_outcome TEXT
        );
        CREATE TABLE IF NOT EXISTS managed_account_affinities (
          affinity_key TEXT PRIMARY KEY, capacity_identity TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);

          const leaseTable = this.#db
            .query<{ sql: string | null }, []>(
              "SELECT sql FROM sqlite_master WHERE type='table' AND name='account_leases'",
            )
            .get();
          const leaseColumns = this.#db
            .query<{ name: string; notnull: number }, []>("PRAGMA table_info(account_leases)")
            .all();
          const runtimeInvocationColumn = leaseColumns.find((column) => column.name === "runtime_invocation_id");
          if (
            leaseTable?.sql &&
            (/(?:job_id|runtime_invocation_id)\s+TEXT\s+NOT\s+NULL\s+UNIQUE/iu.test(leaseTable.sql) ||
              runtimeInvocationColumn?.notnull === 1 ||
              !leaseColumns.some((column) => column.name === "economic_attempt_id") ||
              !leaseColumns.some((column) => column.name === "commitment_id"))
          ) {
            this.#rebuildLeaseTable();
          }
          const columns = new Set(
            this.#db
              .query<{ name: string }, []>("PRAGMA table_info(account_leases)")
              .all()
              .map((column) => column.name),
          );
          if (!columns.has("affinity_key")) {
            this.#db.exec("ALTER TABLE account_leases ADD COLUMN affinity_key TEXT;");
          }
          if (!columns.has("affinity_expected_capacity_identity")) {
            this.#db.exec("ALTER TABLE account_leases ADD COLUMN affinity_expected_capacity_identity TEXT;");
          }
          if (!columns.has("affinity_commit_outcome")) {
            this.#db.exec("ALTER TABLE account_leases ADD COLUMN affinity_commit_outcome TEXT;");
          }
          if (!columns.has("usage_evidence")) {
            this.#db.exec(
              `ALTER TABLE account_leases ADD COLUMN usage_evidence TEXT NOT NULL
           DEFAULT '{"health":"healthy","freshness":"missing"}';`,
            );
          }
          for (const column of [
            "participant_kind",
            "recovery_domain",
            "owner_generation",
            "dispatch_fence_id",
            "settlement_json",
            "intent_fingerprint",
            "configuration_revision",
          ]) {
            if (!columns.has(column)) this.#db.exec(`ALTER TABLE account_leases ADD COLUMN ${column} TEXT;`);
          }
          this.#db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS account_leases_runtime_invocation ON account_leases(runtime_invocation_id) WHERE runtime_invocation_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS account_leases_capacity_state ON account_leases(capacity_identity, lifecycle_state);`);
          this.#db.exec(`
        CREATE TABLE IF NOT EXISTS economic_commitments (
          commitment_id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL UNIQUE,
          job_id TEXT NOT NULL, economic_attempt_id TEXT NOT NULL,
          intent_fingerprint TEXT NOT NULL, policy_id TEXT NOT NULL,
          policy_revision TEXT NOT NULL, candidate_set_digest TEXT NOT NULL,
          snapshot_digest TEXT NOT NULL, decision_at TEXT NOT NULL,
          selected_route_id TEXT, capacity_identity TEXT, reserved_amounts TEXT NOT NULL,
          state TEXT NOT NULL, owner_id TEXT NOT NULL, owner_generation TEXT NOT NULL,
          lease_id TEXT, dispatch_fence_id TEXT, decision_json TEXT NOT NULL,
          commitment_json TEXT, settlement_json TEXT, reconciliation_json TEXT,
          UNIQUE(job_id, economic_attempt_id)
        );
        CREATE INDEX IF NOT EXISTS economic_commitments_route_state
        ON economic_commitments(selected_route_id, state);
      `);
          this.#db.exec(`PRAGMA user_version=${SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION};`);
        })
        .immediate();
    } finally {
      this.#db.exec("PRAGMA foreign_keys=ON;");
    }
  }

  acquireCommitment(input: ManagedEconomicCommitmentAcquireInput): ManagedEconomicCommitmentAcquireResult {
    return this.#transaction(() => {
      this.#heartbeat();
      requireCanonicalText(input.jobId, "Managed economic commitment job id is required.");
      requireEconomicAttemptId(input.economicAttemptId);
      if (!/^sha256:[a-f0-9]{64}$/u.test(input.intentFingerprint)) {
        throw new TypeError("Managed economic intent fingerprint must be a canonical SHA-256 digest.");
      }
      const existing = this.#commitmentRow(input.jobId, input.economicAttemptId);
      if (existing !== null) {
        if (existing.intent_fingerprint !== input.intentFingerprint) {
          return { status: "conflict", reason: "idempotency-conflict" };
        }
        if (!sameCommitmentRevision(existing, input)) {
          return { status: "conflict", reason: "identity-revision-conflict" };
        }
        return resultFromCommitmentRow(existing, this.#rowForOptionalLease(existing.lease_id), true);
      }

      try {
        validateManagedEconomicAdoptedSnapshot(input.snapshot, input.expectation);
      } catch (error) {
        if (error instanceof Error && error.message.includes("identity-revision-conflict")) {
          return { status: "conflict", reason: "identity-revision-conflict" };
        }
        throw error;
      }
      const capacities = new Map(input.routeCapacity.map((entry) => [entry.routeId, entry]));
      if (capacities.size !== input.routeCapacity.length) {
        throw new TypeError("Managed economic route capacities must have unique route ids.");
      }
      const accountSelections = new Map<
        string,
        {
          readonly binding: ExecutionAccountCandidateBinding;
          readonly resolution: {
            readonly status: "ready";
            readonly work: "new" | "existing";
            readonly key?: ManagedAccountAffinityKey;
            readonly expectedCapacityIdentity: string | null;
            readonly accountAffinity?: ExecutionAccountAffinity;
            readonly allowRebind: boolean;
          };
          readonly selection: Exclude<ReturnType<typeof selectExecutionCapacityAccount>["selected"], undefined>;
          readonly rejections: ReturnType<typeof selectExecutionCapacityAccount>["rejections"];
        }
      >();
      const alternatives: ManagedEconomicExecutionAlternative[] = [];
      const authorityRejections: ManagedEconomicAuthorityRejection[] = [];
      for (const adopted of input.snapshot.routes) {
        const local = capacities.get(adopted.route.routeId);
        if (!local) throw new TypeError(`Missing local capacity for economic route ${adopted.route.routeId}.`);
        if (adopted.route.accountPolicyId === null) {
          const reservationExceedsCeiling =
            adopted.ceiling.kind === "finite" &&
            this.#reservationExceedsCeiling(reservationAmounts(adopted), adopted.ceiling.amount);
          const capacity =
            adopted.ceiling.kind === "finite"
              ? this.#hasEconomicCapacity(adopted.route.routeId, adopted.ceiling.amount, reservationAmounts(adopted))
              : "available";
          if (capacity !== "available" && !reservationExceedsCeiling) {
            authorityRejections.push({
              stage: "local-capacity",
              routeId: adopted.route.routeId,
              reason: capacity === "exhausted" ? "route-capacity-exhausted" : "comparison-domain-incompatible",
            });
            continue;
          }
          alternatives.push({
            ...adopted,
            identity: {
              route: adopted.route,
              account: { kind: "accountless" },
            },
            accountSelectionReason: "accountless",
            observedAffinityRevision: null,
          });
          continue;
        }
        const route = local.route ?? economicProviderModelRouteIdentity(adopted.route);
        const affinityRequest = local.affinityRequest ?? {
          continuity: "none" as const,
        };
        const candidates = local.candidates ?? [];
        const resolution = this.#economicAffinityResolution(route, affinityRequest, candidates);
        if (resolution.status === "unavailable") {
          authorityRejections.push({
            stage: "account-selection",
            routeId: adopted.route.routeId,
            rejections: resolution.result.rejections,
          });
          continue;
        }
        const selection = selectExecutionCapacityAccount({
          route,
          work: resolution.work,
          ...(resolution.accountAffinity ? { affinity: resolution.accountAffinity } : {}),
          ...(resolution.allowRebind ? { allowAffinityRebind: true } : {}),
          candidates: candidates.map((binding) => this.#candidateWithCurrentCapacity(binding, resolution.work)),
        });
        authorityRejections.push({
          stage: "account-selection",
          routeId: adopted.route.routeId,
          rejections: selection.rejections,
        });
        if (!selection.selected) continue;
        const reservationExceedsCeiling =
          adopted.ceiling.kind === "finite" &&
          this.#reservationExceedsCeiling(reservationAmounts(adopted), adopted.ceiling.amount);
        const capacity =
          adopted.ceiling.kind === "finite"
            ? this.#hasEconomicCapacity(adopted.route.routeId, adopted.ceiling.amount, reservationAmounts(adopted))
            : "available";
        if (capacity !== "available" && !reservationExceedsCeiling) {
          authorityRejections.push({
            stage: "local-capacity",
            routeId: adopted.route.routeId,
            reason: capacity === "exhausted" ? "route-capacity-exhausted" : "comparison-domain-incompatible",
          });
          continue;
        }
        const binding = candidates.find((candidate) => candidate.candidate.account === selection.selected!.account);
        if (!binding) throw new Error("Selected managed economic account binding is unavailable.");
        if (binding.accountEconomics === undefined) {
          throw new TypeError("Managed economic account candidate requires configured account economics.");
        }
        accountSelections.set(adopted.route.routeId, {
          binding,
          resolution,
          selection: selection.selected,
          rejections: selection.rejections,
        });
        alternatives.push({
          ...adopted,
          identity: {
            route: adopted.route,
            account: {
              kind: "account-bound",
              capacityIdentity: binding.capacityIdentity,
              accountRef: binding.candidate.account,
              credentialRevision: binding.credentialRevisionId,
              creditPosture: binding.accountEconomics.creditPosture,
              overagePosture: binding.accountEconomics.overagePosture,
              ...(binding.quotaEvidence !== undefined ? { quotaEvidence: binding.quotaEvidence } : {}),
            },
          },
          accountSelectionReason: selection.selected.reason,
          observedAffinityRevision: resolution.expectedCapacityIdentity,
        });
      }

      const decision = selectManagedEconomicExecutionAlternative({
        decisionAt: input.snapshot.adoptedDecisionAt,
        evidenceRequirements: input.snapshot.policy.evidenceRequirements,
        alternatives,
      });
      if (decision.kind === "denied") {
        const evidence = {
          evidenceVersion: 1,
          policy: policyEvidence(input.snapshot),
          decision,
          authorityRejections,
        } satisfies ManagedEconomicAuthorityDecisionEvidence;
        this.#insertCommitmentDecision(input, evidence);
        return { status: "denied", decision, evidence, replay: false };
      }
      const selected = decision.selected;
      if (selected.executionEnvelope.kind !== "bounded") {
        throw new Error("Managed economic selector returned an unbounded selected alternative.");
      }
      const amounts = selected.worstCaseReservation.kind === "exact" ? [selected.worstCaseReservation.amount] : [];
      if (selected.ceiling.kind === "finite") {
        const capacity = this.#hasEconomicCapacity(selected.identity.route.routeId, selected.ceiling.amount, amounts);
        if (capacity !== "available") {
          throw new Error("Managed economic route capacity changed inside one transaction.");
        }
      }
      const commitmentId = randomUUID();
      const reservationId = randomUUID();
      const reservation = {
        reservationId,
        jobId: input.jobId,
        economicAttemptId: input.economicAttemptId,
        policy: input.snapshot.policy,
        selectedIdentity: selected.identity,
        priceIdentity: selected.priceEvidence?.identity ?? null,
        envelope: selected.executionEnvelope,
        amounts,
        authorityRevision: input.snapshot.snapshotDigest,
      };
      const commitment: ManagedEconomicCommitment = {
        commitmentId,
        reservation,
        rejected: decision.rejected,
        notSelected: decision.notSelected,
      };
      let leaseId: string | null = null;
      if (selected.identity.account.kind === "account-bound") {
        const account = accountSelections.get(selected.identity.route.routeId);
        if (!account) throw new Error("Selected managed economic account resolution was lost.");
        leaseId = this.#insertEconomicLease(input, commitmentId, selected, account);
      }
      this.#db
        .query(
          `INSERT INTO economic_commitments(
        commitment_id,reservation_id,job_id,economic_attempt_id,intent_fingerprint,
        policy_id,policy_revision,candidate_set_digest,snapshot_digest,decision_at,
        selected_route_id,capacity_identity,reserved_amounts,state,owner_id,owner_generation,
        lease_id,dispatch_fence_id,decision_json,commitment_json,settlement_json,reconciliation_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'held',?,?,?,?,?,?,NULL,NULL)`,
        )
        .run(
          commitmentId,
          reservationId,
          input.jobId,
          input.economicAttemptId,
          input.intentFingerprint,
          input.snapshot.policy.policyId,
          input.snapshot.policy.policyRevision,
          input.snapshot.candidateSetDigest,
          input.snapshot.snapshotDigest,
          input.snapshot.adoptedDecisionAt,
          selected.identity.route.routeId,
          selected.identity.account.kind === "account-bound" ? selected.identity.account.capacityIdentity : null,
          JSON.stringify(amounts),
          this.#ownerId,
          this.#ownerGeneration,
          leaseId,
          null,
          JSON.stringify({
            evidenceVersion: 1,
            policy: policyEvidence(input.snapshot),
            decision,
            authorityRejections,
          } satisfies ManagedEconomicAuthorityDecisionEvidence),
          JSON.stringify(commitment),
        );
      return resultFromCommitmentRow(
        this.#requiredCommitmentRow(input.jobId, input.economicAttemptId),
        this.#rowForOptionalLease(leaseId),
        false,
      );
    });
  }

  releaseCommitmentPreFence(jobId: string, economicAttemptId: string): ManagedEconomicCommitmentRecord {
    return this.#transaction(() => {
      this.#heartbeat();
      const row = this.#requiredCommitmentRow(jobId, economicAttemptId);
      if (row.state === "released") return recordFromCommitmentRow(row, this.#rowForOptionalLease(row.lease_id));
      if (row.state !== "held") throw new Error("Only a definitely pre-dispatch commitment may be released.");
      if (row.lease_id) this.#releaseEconomicLeaseAndAffinity(row.lease_id);
      const changed = this.#db
        .query(
          "UPDATE economic_commitments SET state='released' WHERE commitment_id=? AND state='held' AND owner_generation=?",
        )
        .run(row.commitment_id, this.#ownerGeneration);
      if (changed.changes !== 1) throw new Error("Managed economic pre-dispatch release lost its owner fence.");
      return recordFromCommitmentRow(
        this.#requiredCommitmentRow(jobId, economicAttemptId),
        this.#rowForOptionalLease(row.lease_id),
      );
    });
  }

  fenceDispatch(jobId: string, economicAttemptId: string, dispatchFenceId: string): ManagedEconomicCommitmentRecord {
    return this.#transaction(() => {
      this.#heartbeat();
      requireCanonicalText(dispatchFenceId, "Managed economic dispatch fence id is required.");
      const row = this.#requiredCommitmentRow(jobId, economicAttemptId);
      if (row.state === "dispatch-fenced" && row.dispatch_fence_id === dispatchFenceId) {
        return recordFromCommitmentRow(row, this.#rowForOptionalLease(row.lease_id));
      }
      if (row.state !== "held")
        throw new Error("Managed economic commitment cannot be dispatch-fenced from its current state.");
      const changed = this.#db
        .query(
          "UPDATE economic_commitments SET state='dispatch-fenced',dispatch_fence_id=? WHERE commitment_id=? AND state='held' AND owner_generation=?",
        )
        .run(dispatchFenceId, row.commitment_id, this.#ownerGeneration);
      if (changed.changes !== 1) throw new Error("Managed economic dispatch fence was lost.");
      return recordFromCommitmentRow(
        this.#requiredCommitmentRow(jobId, economicAttemptId),
        this.#rowForOptionalLease(row.lease_id),
      );
    });
  }

  recordExecutionSettlementPending(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    reason: string,
  ): ManagedEconomicCommitmentRecord {
    return this.#transaction(() => {
      this.#heartbeat();
      requireCanonicalText(dispatchFenceId, "Managed economic dispatch fence id is required.");
      requireAuditReason(reason, "Managed economic pending settlement reason is invalid.");
      const row = this.#requiredCommitmentRow(jobId, economicAttemptId);
      if (row.dispatch_fence_id !== dispatchFenceId) {
        throw new Error("Managed economic settlement does not own the durable dispatch fence.");
      }
      if (row.state === "released") {
        if (row.owner_id !== this.#ownerId || row.owner_generation !== this.#ownerGeneration) {
          throw new Error("Managed economic terminal settlement is not owned by this authority.");
        }
        return recordFromCommitmentRow(row, this.#rowForOptionalLease(row.lease_id));
      }
      if (row.state === "settlement-pending") {
        return recordFromCommitmentRow(row, this.#rowForOptionalLease(row.lease_id));
      }
      if (row.state !== "dispatch-fenced") {
        throw new Error("Managed economic settlement cannot become pending from its current state.");
      }
      const settlement: ManagedEconomicSettlement = {
        kind: "unknown",
        reservationId: row.reservation_id,
        dispatchFenceId,
        actualIdentity: null,
        reason,
        evidence: null,
      };
      const changed = this.#db
        .query(
          `UPDATE economic_commitments
        SET state='settlement-pending',settlement_json=?
        WHERE commitment_id=? AND state='dispatch-fenced' AND dispatch_fence_id=? AND owner_generation=?`,
        )
        .run(JSON.stringify(settlement), row.commitment_id, dispatchFenceId, this.#ownerGeneration);
      if (changed.changes !== 1) throw new Error("Managed economic pending settlement lost its dispatch fence.");
      const pending = this.#requiredCommitmentRow(jobId, economicAttemptId);
      return recordFromCommitmentRow(pending, this.#rowForOptionalLease(pending.lease_id));
    });
  }

  settleExecution(
    jobId: string,
    economicAttemptId: string,
    dispatchFenceId: string,
    settlement: ManagedEconomicSettlement,
  ): ManagedEconomicCommitmentRecord {
    return this.#transaction(() => {
      this.#heartbeat();
      requireCanonicalText(dispatchFenceId, "Managed economic dispatch fence id is required.");
      const row = this.#requiredCommitmentRow(jobId, economicAttemptId);
      if (row.dispatch_fence_id !== dispatchFenceId) {
        throw new Error("Managed economic settlement does not own the durable dispatch fence.");
      }
      const commitment = JSON.parse(row.commitment_json!) as ManagedEconomicCommitment;
      validateManagedEconomicSettlement(settlement, {
        reservationId: row.reservation_id,
        dispatchFenceId,
        selectedIdentity: commitment.reservation.selectedIdentity,
      });
      const serialized = JSON.stringify(settlement);
      if (row.settlement_json === serialized) {
        return recordFromCommitmentRow(row, this.#rowForOptionalLease(row.lease_id));
      }
      if (row.state === "released" || row.state === "leaked") {
        throw new Error("Managed economic settlement conflicts with the durable terminal settlement.");
      }
      if (row.state !== "dispatch-fenced" && row.state !== "settlement-pending") {
        throw new Error("Managed economic execution cannot settle from its current state.");
      }
      const terminal =
        settlement.kind === "charged" ||
        settlement.kind === "estimated" ||
        settlement.kind === "subscription" ||
        settlement.kind === "included" ||
        settlement.kind === "free";
      const nextState: ManagedEconomicCommitmentState = terminal
        ? "released"
        : settlement.kind === "leaked"
          ? "leaked"
          : "settlement-pending";
      if (terminal && row.lease_id) this.#releaseEconomicLeaseAndAffinity(row.lease_id);
      const changed = this.#db
        .query(
          `UPDATE economic_commitments
        SET state=?,settlement_json=?
        WHERE commitment_id=? AND state IN ('dispatch-fenced','settlement-pending')
          AND dispatch_fence_id=? AND owner_generation=?`,
        )
        .run(nextState, serialized, row.commitment_id, dispatchFenceId, this.#ownerGeneration);
      if (changed.changes !== 1) throw new Error("Managed economic settlement lost its dispatch fence.");
      const settled = this.#requiredCommitmentRow(jobId, economicAttemptId);
      return recordFromCommitmentRow(settled, this.#rowForOptionalLease(settled.lease_id));
    });
  }

  createAgentTaskCommitmentRecoveryPort(): ManagedEconomicCommitmentRecoveryPort {
    return {
      query: ({ jobId, economicAttemptId }) => {
        this.#heartbeat();
        const row = this.#commitmentRow(jobId, economicAttemptId);
        if (row === null || row.state === "denied" || row.state === "released") return "absent";
        return row.state === "held" ? "committed" : "dispatch-fenced";
      },
    };
  }

  createAgentTaskReplayInspectionPort(): ManagedEconomicReplayInspectionPort {
    return {
      inspect: ({ jobId, economicAttemptId }) =>
        this.#transaction(() => {
          this.#heartbeat();
          const row = this.#commitmentRow(jobId, economicAttemptId);
          if (row === null) return undefined;
          const decision = parseAuthorityDecisionEvidence(row.decision_json);
          if (row.state === "denied") {
            if (decision.decision.kind !== "denied")
              throw new Error("Managed economic denied replay evidence is unprojectable.");
            return {
              evidenceVersion: 1,
              status: "denied",
              policyId: decision.policy.policyId,
              policyRevision: decision.policy.policyRevision,
              policyDigest: decision.policy.policyDigest,
              rejections: projectManagedEconomicDenialRejections({
                status: "denied",
                decision: decision.decision,
                evidence: decision,
                replay: true,
              }),
            };
          }
          if (decision.decision.kind !== "selected" || row.commitment_json === null) {
            throw new Error("Managed economic replay evidence is unprojectable.");
          }
          const commitment = JSON.parse(row.commitment_json) as {
            commitmentId?: unknown;
            reservation?: {
              reservationId?: unknown;
              selectedIdentity?: { route?: unknown; account?: unknown };
            };
          };
          const route = commitment.reservation?.selectedIdentity?.route;
          const account = commitment.reservation?.selectedIdentity?.account;
          const selectedRoute = projectSanitizedReplayRoute(route);
          const selectedAccount = projectSanitizedReplayAccount(account);
          if (
            !selectedRoute ||
            !selectedAccount ||
            typeof commitment.commitmentId !== "string" ||
            typeof commitment.reservation?.reservationId !== "string"
          ) {
            throw new Error("Managed economic replay commitment evidence is unprojectable.");
          }
          const settlement =
            row.settlement_json === null ? undefined : (JSON.parse(row.settlement_json) as { kind?: unknown });
          if (settlement !== undefined && !isReplaySettlement(settlement))
            throw new Error("Managed economic replay settlement evidence is unprojectable.");
          return {
            evidenceVersion: 1,
            status: row.state,
            policyId: decision.policy.policyId,
            policyRevision: decision.policy.policyRevision,
            policyDigest: decision.policy.policyDigest,
            commitmentId: commitment.commitmentId,
            reservationId: commitment.reservation.reservationId,
            ...(row.dispatch_fence_id !== null ? { dispatchFenceId: row.dispatch_fence_id } : {}),
            selectedRoute,
            selectedAccount,
            ...(settlement
              ? {
                  settlementKind: settlement.kind,
                  ...(settlement.evidence ? { settlementAuthority: settlement.evidence.authority } : {}),
                }
              : {}),
          };
        }),
    };
  }

  recoverCommitments(input: ManagedEconomicCommitmentRecoveryInput = {}): readonly ManagedEconomicCommitmentRecord[] {
    return this.#transaction(() => {
      this.#heartbeat();
      const leaked = new Map<string, NonNullable<ManagedEconomicCommitmentRecoveryInput["leaked"]>[number]>();
      for (const evidence of input.leaked ?? []) {
        requireCanonicalText(evidence.jobId, "Recovered managed economic job id is required.");
        requireEconomicAttemptId(evidence.economicAttemptId);
        requireAuditReason(evidence.reason, "Managed economic leak reason is invalid.");
        requireKilnEvidenceUri(evidence.evidenceUri);
        leaked.set(`${evidence.jobId}\0${evidence.economicAttemptId}`, evidence);
      }
      const legacyRows = this.#db
        .query<LeaseRow, string[]>(
          `
        SELECT leases.* FROM account_leases leases
        WHERE lifecycle_state IN (${CAPACITY_CONSUMING_STATES.map(() => "?").join(",")})
          AND (
            (participant_kind=? AND recovery_domain=?)
            OR
            (?=? AND ?=? AND participant_kind IS NULL AND recovery_domain IS NULL)
          )
          AND NOT EXISTS (
            SELECT 1 FROM economic_commitments commitments
            WHERE commitments.lease_id=leases.lease_id
          )
        ORDER BY leases.rowid
      `,
        )
        .all(
          ...CAPACITY_CONSUMING_STATES,
          this.#participantKind,
          this.#recoveryDomain,
          this.#participantKind,
          AGENT_TASK_PARTICIPANT_KIND,
          this.#recoveryDomain,
          AGENT_TASK_RECOVERY_DOMAIN,
        );
      for (const row of legacyRows) {
        const historicalIdentity =
          row.runtime_invocation_id !== null && row.economic_attempt_id === null && row.commitment_id === null;
        const orphanedEconomicIdentity =
          row.runtime_invocation_id === null && row.economic_attempt_id !== null && row.commitment_id !== null;
        if (!historicalIdentity && !orphanedEconomicIdentity) {
          throw new Error("Orphaned managed account lease identity is corrupt.");
        }
        const evidenceUri = `kiln://managed-accounts/leases/${encodeURIComponent(row.lease_id)}/legacy-recovery`;
        const diagnostics = uniqueStrings([...parseStringArray(row.diagnostic_uris), evidenceUri]);
        this.#db
          .query(
            `UPDATE account_leases
          SET owner_id=?,lifecycle_state='leaked',diagnostic_uris=? WHERE lease_id=?`,
          )
          .run(this.#ownerId, JSON.stringify(diagnostics), row.lease_id);
      }
      const rows = this.#db
        .query<CommitmentRow, string[]>(
          `
        SELECT * FROM economic_commitments
        WHERE state IN (${ECONOMIC_CAPACITY_CONSUMING_STATES.map(() => "?").join(",")})
        ORDER BY rowid
      `,
        )
        .all(...ECONOMIC_CAPACITY_CONSUMING_STATES);
      for (const row of rows) {
        const leak = leaked.get(`${row.job_id}\0${row.economic_attempt_id}`);
        if (leak && row.state === "held") {
          throw new Error("A definitely pre-dispatch commitment cannot be classified as leaked.");
        }
        let state = row.state;
        let settlement = row.settlement_json;
        let lifecycleEvidence = row.reconciliation_json;
        if (row.state === "dispatch-fenced") {
          state = "settlement-pending";
          settlement = JSON.stringify({
            kind: "pending",
            reservationId: row.reservation_id,
            dispatchFenceId: requirePersistedFence(row),
          } satisfies ManagedEconomicSettlement);
        }
        if (leak && row.state !== "leaked") {
          state = "leaked";
          settlement = JSON.stringify({
            kind: "leaked",
            reservationId: row.reservation_id,
            dispatchFenceId: requirePersistedFence(row),
            reason: leak.reason,
          } satisfies ManagedEconomicSettlement);
          lifecycleEvidence = JSON.stringify({
            kind: "leak-classification",
            reason: leak.reason,
            evidenceUri: leak.evidenceUri,
          });
        }
        this.#db
          .query(
            `UPDATE economic_commitments
          SET owner_id=?,owner_generation=?,state=?,settlement_json=?,reconciliation_json=? WHERE commitment_id=?`,
          )
          .run(this.#ownerId, this.#ownerGeneration, state, settlement, lifecycleEvidence, row.commitment_id);
        if (row.lease_id !== null) {
          this.#db
            .query("UPDATE account_leases SET owner_id=?,owner_generation=? WHERE lease_id=?")
            .run(this.#ownerId, this.#ownerGeneration, row.lease_id);
        }
      }
      return rows.map((row) => {
        const recovered = this.#requiredCommitmentRow(row.job_id, row.economic_attempt_id);
        return recordFromCommitmentRow(recovered, this.#rowForOptionalLease(recovered.lease_id));
      });
    });
  }

  recordCommitmentReleaseFailure(input: ManagedEconomicCommitmentReleaseFailureInput): ManagedEconomicCommitmentRecord {
    return this.#transaction(() => {
      this.#heartbeat();
      requireAuditReason(input.reason, "Managed economic release failure reason is invalid.");
      requireKilnEvidenceUri(input.evidenceUri);
      const row = this.#requiredCommitmentRow(input.jobId, input.economicAttemptId);
      if (row.state === "leaked") {
        throw new Error("A leaked managed economic commitment cannot regress to release-failed.");
      }
      if (row.state === "release-failed") {
        return recordFromCommitmentRow(row, this.#rowForOptionalLease(row.lease_id));
      }
      if (row.state !== "held") {
        throw new Error("Managed economic release failure may only be recorded before dispatch.");
      }
      this.#db
        .query(
          "UPDATE economic_commitments SET state='release-failed',reconciliation_json=? WHERE commitment_id=? AND owner_generation=?",
        )
        .run(
          JSON.stringify({
            kind: "release-failure",
            reason: input.reason,
            evidenceUri: input.evidenceUri,
          }),
          row.commitment_id,
          this.#ownerGeneration,
        );
      if (row.lease_id !== null) {
        const lease = this.#requiredRow(row.lease_id);
        this.#db
          .query("UPDATE account_leases SET lifecycle_state='release-failed',diagnostic_uris=? WHERE lease_id=?")
          .run(
            JSON.stringify(uniqueStrings([...parseStringArray(lease.diagnostic_uris), input.evidenceUri])),
            row.lease_id,
          );
      }
      const failed = this.#requiredCommitmentRow(input.jobId, input.economicAttemptId);
      return recordFromCommitmentRow(failed, this.#rowForOptionalLease(failed.lease_id));
    });
  }

  acquireAccountCapacity(input: AccountCapacityAcquireInput): AccountCapacityAcquireResult {
    return this.#transaction(() => {
      this.#heartbeat();
      requireCanonicalText(input.runtimeInvocationId, "Gateway runtime invocation id is required.");
      if (!/^sha256:[a-f0-9]{64}$/u.test(input.intentFingerprint))
        throw new TypeError("Gateway capacity intent fingerprint must be a canonical SHA-256 digest.");
      requireRoute(input.route);
      const prior = this.#db
        .query<LeaseRow, [string]>("SELECT * FROM account_leases WHERE runtime_invocation_id=?")
        .get(input.runtimeInvocationId);
      if (prior)
        return prior.intent_fingerprint === input.intentFingerprint
          ? {
              status: "acquired",
              record: accountCapacityRecord(prior),
              replay: true,
            }
          : { status: "conflict", reason: "idempotency-conflict" };
      const affinity = this.#resolveAffinity({
        route: input.route,
        affinityRequest: input.affinityRequest ?? { continuity: "none" },
        candidates: input.candidates,
      });
      if (affinity.status === "unavailable")
        return {
          status: "unavailable",
          rejections: affinity.result.rejections,
        };
      const selected = selectExecutionCapacityAccount({
        route: input.route,
        work: affinity.work,
        ...(affinity.accountAffinity ? { affinity: affinity.accountAffinity } : {}),
        ...(affinity.allowRebind ? { allowAffinityRebind: true } : {}),
        candidates: input.candidates.map((x) => this.#candidateWithCurrentCapacity(x, affinity.work)),
      });
      if (!selected.selected) return { status: "unavailable", rejections: selected.rejections };
      const binding = input.candidates.find((x) => x.candidate.account === selected.selected!.account);
      if (!binding) throw new Error("Selected gateway account binding is unavailable.");
      const leaseId = randomUUID();
      this.#db
        .query(
          `INSERT INTO account_leases(lease_id,account_policy_id,account_ref,capacity_identity,provider_id,model_id,route_scope,job_id,runtime_invocation_id,economic_attempt_id,commitment_id,credential_revision_id,owner_id,acquired_at,lifecycle_state,released_at,selection_reason,candidate_rejections,usage_evidence,affinity_outcome,purpose,resource_uris,diagnostic_uris,affinity_key,affinity_expected_capacity_identity,affinity_commit_outcome,participant_kind,recovery_domain,owner_generation,dispatch_fence_id,settlement_json,intent_fingerprint,configuration_revision)
        VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,'held',NULL,?,?,?,?,?,?,?,?,?,NULL,?,?,?,NULL,NULL,?,?)`,
        )
        .run(
          leaseId,
          input.accountPolicyId,
          binding.candidate.account,
          binding.capacityIdentity,
          input.route.providerId,
          input.route.providerModelId,
          input.route.scope,
          input.runtimeInvocationId,
          input.runtimeInvocationId,
          binding.credentialRevisionId,
          this.#ownerId,
          new Date(this.#now()).toISOString(),
          selected.selected.reason,
          JSON.stringify(selected.rejections),
          JSON.stringify(defineExecutionAccountUsageEvidence(binding.usageEvidence)),
          null,
          affinity.work === "existing" ? "affinity" : "new",
          JSON.stringify([`kiln://managed-accounts/leases/${encodeURIComponent(leaseId)}`]),
          "[]",
          affinity.key ?? null,
          affinity.expectedCapacityIdentity,
          this.#participantKind,
          this.#recoveryDomain,
          this.#ownerGeneration,
          input.intentFingerprint,
          this.#configurationRevision,
        );
      const row = this.#requiredRow(leaseId);
      if (row.affinity_key)
        this.#db
          .query("UPDATE account_leases SET affinity_commit_outcome=? WHERE lease_id=?")
          .run(this.#commitAffinity(row), leaseId);
      return {
        status: "acquired",
        record: accountCapacityRecord(this.#requiredRow(leaseId)),
        replay: false,
      };
    });
  }

  releaseAccountCapacityPreFence(runtimeInvocationId: string): AccountCapacityRecord {
    return this.#accountTransition(runtimeInvocationId, (row) => {
      if (row.lifecycle_state === "released") return row;
      if (row.lifecycle_state !== "held" || row.dispatch_fence_id)
        throw new Error("Gateway capacity cannot be released after dispatch fencing.");
      this.#rollbackWinningAffinity(row);
      this.#db
        .query(
          "UPDATE account_leases SET lifecycle_state='released',released_at=? WHERE lease_id=? AND owner_generation=?",
        )
        .run(new Date(this.#now()).toISOString(), row.lease_id, this.#ownerGeneration);
      return this.#requiredRow(row.lease_id);
    });
  }

  fenceAccountCapacityDispatch(runtimeInvocationId: string, dispatchFenceId: string): AccountCapacityRecord {
    requireCanonicalText(dispatchFenceId, "Gateway capacity dispatch fence id is required.");
    return this.#accountTransition(runtimeInvocationId, (row) => {
      if ((row.lifecycle_state as string) === "dispatch-fenced" && row.dispatch_fence_id === dispatchFenceId)
        return row;
      if (row.lifecycle_state !== "held" || row.dispatch_fence_id)
        throw new Error("Gateway capacity dispatch fence conflicts with durable state.");
      if (
        this.#db
          .query(
            "UPDATE account_leases SET lifecycle_state='dispatch-fenced',dispatch_fence_id=? WHERE lease_id=? AND owner_generation=? AND lifecycle_state='held'",
          )
          .run(dispatchFenceId, row.lease_id, this.#ownerGeneration).changes !== 1
      )
        throw new Error("Gateway capacity dispatch fence was lost.");
      return this.#requiredRow(row.lease_id);
    });
  }

  settleAccountCapacity(
    runtimeInvocationId: string,
    dispatchFenceId: string,
    settlement: AccountCapacitySettlement,
  ): AccountCapacityRecord {
    validateAccountCapacitySettlement(settlement);
    return this.#accountTransition(runtimeInvocationId, (row) => {
      if (row.dispatch_fence_id !== dispatchFenceId)
        throw new Error("Gateway capacity settlement does not own the dispatch fence.");
      const serialized = JSON.stringify(settlement);
      if (row.settlement_json === serialized) {
        if (settlement.kind === "unknown" && row.released_at === null) {
          this.#db
            .query("UPDATE account_leases SET released_at=? WHERE lease_id=? AND owner_generation=?")
            .run(new Date(this.#now()).toISOString(), row.lease_id, this.#ownerGeneration);
          return this.#requiredRow(row.lease_id);
        }
        return row;
      }
      if (row.settlement_json !== null || !["dispatch-fenced", "settlement-pending"].includes(row.lifecycle_state))
        throw new Error("Gateway capacity settlement conflicts with durable state.");
      const state = settlement.kind === "unknown" ? "settlement-pending" : "released";
      this.#db
        .query(
          "UPDATE account_leases SET lifecycle_state=?,settlement_json=?,released_at=COALESCE(released_at,?) WHERE lease_id=? AND owner_generation=?",
        )
        .run(state, serialized, new Date(this.#now()).toISOString(), row.lease_id, this.#ownerGeneration);
      return this.#requiredRow(row.lease_id);
    });
  }

  recoverAccountCapacity(): readonly AccountCapacityRecord[] {
    return this.#transaction(() => {
      this.#heartbeat();
      const rows = this.#db
        .query<LeaseRow, [string, string]>(
          `SELECT * FROM account_leases
        WHERE economic_attempt_id IS NULL AND participant_kind=? AND recovery_domain=?
          AND lifecycle_state IN ('held','dispatch-fenced','settlement-pending','release-failed','leaked')
        ORDER BY rowid`,
        )
        .all(this.#participantKind, this.#recoveryDomain);
      for (const row of rows) {
        if (row.owner_generation === this.#ownerGeneration) continue;
        const releasedAt = new Date(this.#now()).toISOString();
        if (row.lifecycle_state === "held") {
          if (row.dispatch_fence_id !== null || row.settlement_json !== null) {
            throw new Error("Retained pre-dispatch account capacity evidence is corrupt.");
          }
          this.#rollbackWinningAffinity(row);
          const changed = this.#db
            .query(
              "UPDATE account_leases SET lifecycle_state='released',released_at=COALESCE(released_at,?) WHERE lease_id=? AND owner_generation IS ?",
            )
            .run(releasedAt, row.lease_id, row.owner_generation);
          if (changed.changes !== 1) throw new Error("Stale pre-dispatch account capacity recovery was lost.");
          continue;
        }
        let settlement = row.settlement_json;
        if (settlement === null) {
          if ((row.lifecycle_state as string) !== "dispatch-fenced") {
            throw new Error("Retained account capacity outcome is missing unknown settlement evidence.");
          }
          if (row.dispatch_fence_id === null) {
            throw new Error("Retained account capacity dispatch fence evidence is missing.");
          }
          settlement = JSON.stringify({
            kind: "unknown",
            reason: "gateway owner generation became stale after dispatch fencing",
            observedAt: releasedAt,
          } satisfies Extract<AccountCapacitySettlement, { readonly kind: "unknown" }>);
        } else {
          parseUnknownAccountCapacitySettlement(settlement);
        }
        const changed = this.#db
          .query(
            `UPDATE account_leases
             SET lifecycle_state='settlement-pending',settlement_json=?,released_at=COALESCE(released_at,?)
             WHERE lease_id=? AND owner_generation IS ?`,
          )
          .run(settlement, releasedAt, row.lease_id, row.owner_generation);
        if (changed.changes !== 1) throw new Error("Stale post-dispatch account capacity recovery was lost.");
      }
      return rows.map((row) => accountCapacityRecord(this.#requiredRow(row.lease_id)));
    });
  }

  #accountTransition(runtimeInvocationId: string, operation: (row: LeaseRow) => LeaseRow): AccountCapacityRecord {
    return this.#transaction(() => {
      this.#heartbeat();
      const row = this.#db
        .query<LeaseRow, [string]>("SELECT * FROM account_leases WHERE runtime_invocation_id=?")
        .get(runtimeInvocationId);
      if (
        !row ||
        row.economic_attempt_id !== null ||
        row.participant_kind !== this.#participantKind ||
        row.recovery_domain !== this.#recoveryDomain ||
        row.owner_generation !== this.#ownerGeneration
      )
        throw new Error("Gateway capacity participant generation is stale or unavailable.");
      return accountCapacityRecord(operation(row));
    });
  }

  #rebuildLeaseTable(): void {
    this.#db.exec(`
      CREATE TABLE account_leases_rebuilt (
        lease_id TEXT PRIMARY KEY, account_policy_id TEXT NOT NULL, account_ref TEXT NOT NULL,
        capacity_identity TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
        route_scope TEXT NOT NULL, job_id TEXT NOT NULL, runtime_invocation_id TEXT,
        economic_attempt_id TEXT, commitment_id TEXT,
        credential_revision_id TEXT NOT NULL, owner_id TEXT NOT NULL, acquired_at TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL, released_at TEXT, selection_reason TEXT NOT NULL,
        candidate_rejections TEXT NOT NULL, usage_evidence TEXT NOT NULL DEFAULT '{"health":"healthy","freshness":"missing"}',
        affinity_outcome TEXT, purpose TEXT NOT NULL, resource_uris TEXT NOT NULL,
        diagnostic_uris TEXT NOT NULL, affinity_key TEXT,
        affinity_expected_capacity_identity TEXT, affinity_commit_outcome TEXT,
        participant_kind TEXT, recovery_domain TEXT, owner_generation TEXT,
        dispatch_fence_id TEXT, settlement_json TEXT, intent_fingerprint TEXT,
        configuration_revision TEXT
      );
    `);
    const oldColumns = new Set(
      this.#db
        .query<{ name: string }, []>("PRAGMA table_info(account_leases)")
        .all()
        .map((c) => c.name),
    );
    const columns = [
      "lease_id",
      "account_policy_id",
      "account_ref",
      "capacity_identity",
      "provider_id",
      "model_id",
      "route_scope",
      "job_id",
      "runtime_invocation_id",
      "economic_attempt_id",
      "commitment_id",
      "credential_revision_id",
      "owner_id",
      "acquired_at",
      "lifecycle_state",
      "released_at",
      "selection_reason",
      "candidate_rejections",
      "usage_evidence",
      "affinity_outcome",
      "purpose",
      "resource_uris",
      "diagnostic_uris",
      "affinity_key",
      "affinity_expected_capacity_identity",
      "affinity_commit_outcome",
      "participant_kind",
      "recovery_domain",
      "owner_generation",
      "dispatch_fence_id",
      "settlement_json",
      "intent_fingerprint",
      "configuration_revision",
    ];
    const select = columns.map((column) =>
      oldColumns.has(column)
        ? column
        : column === "usage_evidence"
          ? '\'{"health":"healthy","freshness":"missing"}\''
          : "NULL",
    );
    this.#db.exec(
      `INSERT INTO account_leases_rebuilt(${columns.join(",")}) SELECT ${select.join(",")} FROM account_leases; DROP TABLE account_leases; ALTER TABLE account_leases_rebuilt RENAME TO account_leases;`,
    );
  }

  #claimOwner(): void {
    this.#transaction(() => {
      const now = this.#now();
      const owner = this.#db
        .query<{ owner_id: string; heartbeat: number; config_revision: string }, [string, string]>(
          "SELECT owner_id, heartbeat, config_revision FROM participants WHERE participant_kind=? AND recovery_domain=?",
        )
        .get(this.#participantKind, this.#recoveryDomain);
      if (owner && owner.heartbeat > now - this.#ownerStaleMs) {
        throw new Error("Managed account lease authority already has a live owner.");
      }
      if (owner && owner.config_revision !== this.#configurationRevision) {
        const placeholders = CAPACITY_CONSUMING_STATES.map(() => "?").join(",");
        const retained = this.#db
          .query<{ count: number }, [string, string, ...string[]]>(
            `SELECT COUNT(*) AS count FROM account_leases
             WHERE participant_kind=? AND recovery_domain=?
               AND economic_attempt_id IS NOT NULL
               AND lifecycle_state IN (${placeholders})`,
          )
          .get(this.#participantKind, this.#recoveryDomain, ...CAPACITY_CONSUMING_STATES);
        if ((retained?.count ?? 0) > 0) {
          throw new Error("Managed account lease authority configuration revision conflicts with retained capacity.");
        }
      }
      this.#db
        .query(
          "INSERT OR REPLACE INTO participants(participant_kind,recovery_domain,owner_id,owner_generation,heartbeat,config_revision) VALUES(?,?,?,?,?,?)",
        )
        .run(
          this.#participantKind,
          this.#recoveryDomain,
          this.#ownerId,
          this.#ownerGeneration,
          now,
          this.#configurationRevision,
        );
    });
  }

  #releaseOwnerClaim(): void {
    try {
      this.#db
        .query(
          "DELETE FROM participants WHERE participant_kind=? AND recovery_domain=? AND owner_id=? AND owner_generation=?",
        )
        .run(this.#participantKind, this.#recoveryDomain, this.#ownerId, this.#ownerGeneration);
    } catch {
      // Preserve the original open/migration error; stale-owner timeout remains the fallback.
    }
  }

  #heartbeat(): void {
    if (this.#closed) throw new Error("Managed account lease authority is closed.");
    const result = this.#db
      .query(
        "UPDATE participants SET heartbeat=? WHERE participant_kind=? AND recovery_domain=? AND owner_id=? AND owner_generation=?",
      )
      .run(this.#now(), this.#participantKind, this.#recoveryDomain, this.#ownerId, this.#ownerGeneration);
    if (result.changes !== 1) throw new Error("Managed account lease authority ownership was lost.");
  }

  #transaction<T>(operation: () => T & (T extends PromiseLike<unknown> ? never : unknown)): T {
    return this.#db.transaction(operation).immediate();
  }

  #hardenDatabaseFiles(path: string): void {
    if (process.platform === "win32" || path === ":memory:") return;
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(candidate)) chmodSync(candidate, 0o600);
    }
  }
}

export interface ManagedEconomicRouteCapacity {
  readonly routeId: string;
  readonly route?: ProviderModelRouteIdentity;
  readonly affinityRequest?: ExecutionAccountAffinityRequest;
  readonly candidates?: readonly ExecutionAccountCandidateBinding[];
}

export interface ManagedEconomicCommitmentAcquireInput {
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly intentFingerprint: string;
  readonly snapshot: ManagedEconomicAdoptedSnapshot;
  readonly expectation: ManagedEconomicAdoptedSnapshotExpectation;
  /** Current local account and route capacity, resolved before the transaction. */
  readonly routeCapacity: readonly ManagedEconomicRouteCapacity[];
}

export type ManagedEconomicCommitmentState =
  | "held"
  | "dispatch-fenced"
  | "settlement-pending"
  | "release-failed"
  | "leaked"
  | "released";

export interface ManagedEconomicCommitmentRecord {
  readonly commitment: ManagedEconomicCommitment;
  readonly state: ManagedEconomicCommitmentState;
  readonly decisionAt: string;
  readonly intentFingerprint: string;
  readonly lease?: ManagedEconomicAccountLeaseEvidence;
  readonly dispatchFenceId?: string;
  readonly settlement?: ManagedEconomicSettlement;
  readonly decisionEvidence: ManagedEconomicAuthorityDecisionEvidence;
  readonly lifecycleEvidence?: Readonly<Record<string, unknown>>;
}

export interface ManagedEconomicAccountLeaseEvidence {
  readonly leaseId: string;
  readonly commitmentId: string;
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly accountPolicyId: ExecutionAccountPolicyId;
  readonly accountRef: ExecutionAccountCapacityCandidate["account"];
  readonly route: ProviderModelRouteIdentity;
  readonly capacityIdentity: string;
  readonly credentialRevisionId: string;
  readonly selectionReason: ManagedAccountLeaseEvidence["selectionReason"];
  readonly candidateRejections: ManagedAccountLeaseEvidence["candidateRejections"];
  readonly usageEvidence: NonNullable<ManagedAccountLeaseEvidence["usageEvidence"]>;
  readonly affinityOutcome?: ManagedAccountLeaseEvidence["affinityOutcome"];
  readonly affinityCommitOutcome?: ManagedAccountAffinityCommitOutcome;
  readonly acquiredAt: string;
  readonly lifecycleState: ManagedAccountLeaseEvidence["lifecycleState"];
  readonly releasedAt?: string;
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
}

export type ManagedEconomicAuthorityRejection =
  | {
      readonly stage: "account-selection";
      readonly routeId: string;
      readonly rejections: ReturnType<typeof selectExecutionCapacityAccount>["rejections"];
    }
  | {
      readonly stage: "local-capacity";
      readonly routeId: string;
      readonly reason: "route-capacity-exhausted" | "comparison-domain-incompatible";
    };

export interface ManagedEconomicAuthorityDecisionEvidence {
  readonly evidenceVersion: 1;
  readonly policy: {
    readonly policyId: string;
    readonly policyRevision: string;
    readonly policyDigest: string;
  };
  readonly decision: ManagedEconomicSelectionDecision;
  readonly authorityRejections: readonly ManagedEconomicAuthorityRejection[];
}

/** Participants are intentionally named by the recovery protocol they own, not by a UI surface. */
export type SharedAccountCapacityParticipantKind =
  | "agent-task-runtime"
  | "model-gateway-ingress"
  | "operator-session";

export interface AccountOutcomeIncident {
  readonly runtimeInvocationId: string;
  readonly lifecycleState: ManagedAccountLeaseEvidence["lifecycleState"];
  readonly capacityState: "active" | "released";
  readonly route: AccountCapacityRecord["route"];
  readonly dispatchFenceId?: string;
  readonly settlement: Extract<AccountCapacitySettlement, { readonly kind: "unknown" }>;
}

/** Read-only authority evidence safe to expose through agent-task replay. */
export type ManagedEconomicReplayEvidence =
  | {
      readonly evidenceVersion: 1;
      readonly status: "denied";
      readonly policyId: string;
      readonly policyRevision: string;
      readonly policyDigest: string;
      readonly rejections: readonly SessionManagedEconomicRejection[];
    }
  | {
      readonly evidenceVersion: 1;
      readonly status: Exclude<ManagedEconomicCommitmentState, "denied">;
      readonly policyId: string;
      readonly policyRevision: string;
      readonly policyDigest: string;
      readonly commitmentId: string;
      readonly reservationId: string;
      readonly dispatchFenceId?: string;
      readonly selectedRoute: {
        readonly routeId: string;
        readonly providerId: string;
        readonly modelId: string;
        readonly adapterCapabilityId: string;
        readonly adapterCapabilityVersion: string;
      };
      readonly selectedAccount:
        | { readonly kind: "accountless" }
        | {
            readonly kind: "account-bound";
            readonly capacityIdentity: string;
            readonly creditPosture: "disabled" | "committed";
            readonly overagePosture: "disabled" | "committed";
          };
      readonly settlementKind?: ManagedEconomicSettlement["kind"];
      readonly settlementAuthority?: ManagedEconomicEvidenceIdentity["authority"];
    };

export interface ManagedEconomicReplayInspectionPort {
  inspect(input: {
    readonly jobId: string;
    readonly economicAttemptId: string;
  }): ManagedEconomicReplayEvidence | undefined;
}

export type ManagedEconomicCommitmentAcquireResult =
  | {
      readonly status: "committed";
      readonly record: ManagedEconomicCommitmentRecord;
      readonly replay: boolean;
    }
  | {
      readonly status: "denied";
      readonly decision: Extract<ManagedEconomicSelectionDecision, { readonly kind: "denied" }>;
      readonly evidence: ManagedEconomicAuthorityDecisionEvidence;
      readonly replay: boolean;
    }
  | {
      readonly status: "conflict";
      readonly reason: "idempotency-conflict" | "identity-revision-conflict";
    };

export interface ManagedEconomicCommitmentRecoveryInput {
  readonly leaked?: readonly {
    readonly jobId: string;
    readonly economicAttemptId: string;
    readonly reason: string;
    readonly evidenceUri: string;
  }[];
}

export interface ManagedEconomicCommitmentReleaseFailureInput {
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly reason: string;
  readonly evidenceUri: string;
}

export type ManagedEconomicCommitmentRecoveryState = "absent" | "committed" | "dispatch-fenced";

export interface ManagedEconomicCommitmentRecoveryPort {
  query(input: { readonly jobId: string; readonly economicAttemptId: string }): ManagedEconomicCommitmentRecoveryState;
}

const AGENT_TASK_PARTICIPANT_KIND = "agent-task-runtime";
const AGENT_TASK_RECOVERY_DOMAIN = "agent-tasks";
const SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION = 5;
const ECONOMIC_CAPACITY_CONSUMING_STATES = [
  "held",
  "dispatch-fenced",
  "settlement-pending",
  "release-failed",
  "leaked",
] as const;

function economicProviderModelRouteIdentity(route: ManagedEconomicExecutionAlternative["identity"]["route"]): ProviderModelRouteIdentity {
  return {
    providerId: route.providerId,
    providerModelId: route.modelId,
    scope: `economic:${route.routeId}`,
  };
}

function parseEconomicAmounts(value: string): ManagedEconomicAmount[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("Managed economic reservation evidence is corrupt.");
  return parsed as ManagedEconomicAmount[];
}

function amountInScale(amount: ManagedEconomicAmount, target: ManagedEconomicAmount): bigint | null {
  if (amount.unit !== target.unit || !sameEconomicScheme(amount.scheme, target.scheme)) {
    return null;
  }
  if (amount.scale > target.scale) {
    const divisor = 10n ** BigInt(amount.scale - target.scale);
    const atoms = BigInt(amount.atoms);
    if (atoms % divisor !== 0n) throw new Error("Managed economic route capacity scale loses precision.");
    return atoms / divisor;
  }
  return BigInt(amount.atoms) * 10n ** BigInt(target.scale - amount.scale);
}

function sameEconomicScheme(left: ManagedEconomicAmount["scheme"], right: ManagedEconomicAmount["scheme"]): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "currency" && right.kind === "currency") return left.currency === right.currency;
  if (left.kind === "credit" && right.kind === "credit") return left.creditSchemeId === right.creditSchemeId;
  return left.kind === "unit" && right.kind === "unit";
}

function sameCommitmentRevision(row: CommitmentRow, input: ManagedEconomicCommitmentAcquireInput): boolean {
  return (
    row.policy_id === input.snapshot.policy.policyId &&
    row.policy_revision === input.snapshot.policy.policyRevision &&
    row.candidate_set_digest === input.snapshot.candidateSetDigest &&
    row.snapshot_digest === input.snapshot.snapshotDigest &&
    row.decision_at === input.snapshot.adoptedDecisionAt
  );
}

function resultFromCommitmentRow(
  row: CommitmentRow,
  lease: LeaseRow | null,
  replay: boolean,
): ManagedEconomicCommitmentAcquireResult {
  if (row.state === "denied") {
    const evidence = parseAuthorityDecisionEvidence(row.decision_json);
    if (evidence.decision.kind !== "denied") throw new Error("Managed economic denied evidence is corrupt.");
    return { status: "denied", decision: evidence.decision, evidence, replay };
  }
  return {
    status: "committed",
    record: recordFromCommitmentRow(row, lease),
    replay,
  };
}

function recordFromCommitmentRow(row: CommitmentRow, lease: LeaseRow | null): ManagedEconomicCommitmentRecord {
  if (row.state === "denied" || row.commitment_json === null) {
    throw new Error("Managed economic commitment record is unavailable for a denied decision.");
  }
  if ((row.lease_id === null) !== (lease === null) || (row.lease_id !== null && lease?.lease_id !== row.lease_id)) {
    throw new Error("Managed economic commitment account lease reference is corrupt.");
  }
  return {
    commitment: JSON.parse(row.commitment_json) as ManagedEconomicCommitment,
    state: row.state,
    decisionAt: row.decision_at,
    intentFingerprint: row.intent_fingerprint,
    decisionEvidence: parseAuthorityDecisionEvidence(row.decision_json),
    ...(lease !== null ? { lease: economicLeaseEvidenceFromRow(lease, row) } : {}),
    ...(row.dispatch_fence_id !== null ? { dispatchFenceId: row.dispatch_fence_id } : {}),
    ...(row.settlement_json !== null
      ? {
          settlement: JSON.parse(row.settlement_json) as ManagedEconomicSettlement,
        }
      : {}),
    ...(row.reconciliation_json !== null
      ? {
          lifecycleEvidence: JSON.parse(row.reconciliation_json) as Readonly<Record<string, unknown>>,
        }
      : {}),
  };
}

function requirePersistedFence(row: CommitmentRow): string {
  if (row.dispatch_fence_id === null) {
    throw new Error("Post-dispatch managed economic state requires a durable dispatch fence.");
  }
  return row.dispatch_fence_id;
}

function parseAuthorityDecisionEvidence(value: string): ManagedEconomicAuthorityDecisionEvidence {
  const parsed: unknown = JSON.parse(value);
  if (!isManagedEconomicAuthorityDecisionEvidence(parsed)) {
    throw new Error("Managed economic authority decision evidence is unprojectable.");
  }

  return parsed;
}

function isManagedEconomicAuthorityDecisionEvidence(value: unknown): value is ManagedEconomicAuthorityDecisionEvidence {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { evidenceVersion?: unknown }).evidenceVersion === 1 &&
    isPolicyEvidence((value as { policy?: unknown }).policy) &&
    typeof (value as { decision?: unknown }).decision === "object" &&
    (value as { decision?: { kind?: unknown } }).decision?.kind !== undefined &&
    Array.isArray((value as { authorityRejections?: unknown }).authorityRejections)
  );
}

function isPolicyEvidence(value: unknown): value is ManagedEconomicAuthorityDecisionEvidence["policy"] {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { policyId?: unknown }).policyId === "string" &&
    typeof (value as { policyRevision?: unknown }).policyRevision === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(String((value as { policyDigest?: unknown }).policyDigest))
  );
}

function policyEvidence(snapshot: ManagedEconomicAdoptedSnapshot): ManagedEconomicAuthorityDecisionEvidence["policy"] {
  return {
    policyId: snapshot.policy.policyId,
    policyRevision: snapshot.policy.policyRevision,
    policyDigest: snapshot.policy.policyDigest,
  };
}

function projectSanitizedReplayRoute(
  value: unknown,
):
  | Extract<ManagedEconomicReplayEvidence, { readonly status: ManagedEconomicCommitmentState }>["selectedRoute"]
  | undefined {
  if (
    !isRecordWithExactKeys(value, MANAGED_ECONOMIC_ROUTE_IDENTITY_KEYS) ||
    ![
      "routeId",
      "providerId",
      "modelId",
      "adapterCapabilityId",
      "adapterCapabilityVersion",
      "authBillingChannel",
      "executionMode",
      "serviceTier",
      "rateCardId",
      "rateCardRevision",
      "priceEvidenceDigest",
      "unit",
      "contextClass",
      "cacheClass",
      "auxiliaryScheduleDigest",
      "envelopeDigest",
    ].every((key) => typeof value[key] === "string") ||
    (value.accountPolicyId !== null && typeof value.accountPolicyId !== "string") ||
    !isPosture(value.fallbackPosture) ||
    !isPosture(value.overagePosture) ||
    typeof value.scheme !== "object" ||
    value.scheme === null
  )
    return undefined;
  return {
    routeId: value.routeId as string,
    providerId: value.providerId as string,
    modelId: value.modelId as string,
    adapterCapabilityId: value.adapterCapabilityId as string,
    adapterCapabilityVersion: value.adapterCapabilityVersion as string,
  };
}

function projectSanitizedReplayAccount(
  value: unknown,
):
  | Extract<ManagedEconomicReplayEvidence, { readonly status: ManagedEconomicCommitmentState }>["selectedAccount"]
  | undefined {
  if (!isRecordWithExactKeys(value, ["kind"])) {
    if (
      !isRecordWithAllowedKeys(value, [
        "kind",
        "capacityIdentity",
        "accountRef",
        "credentialRevision",
        "creditPosture",
        "overagePosture",
        "quotaEvidence",
      ])
    )
      return undefined;
    if (
      value.kind !== "account-bound" ||
      typeof value.capacityIdentity !== "string" ||
      typeof value.accountRef !== "string" ||
      typeof value.credentialRevision !== "string" ||
      !isPosture(value.creditPosture) ||
      !isPosture(value.overagePosture)
    )
      return undefined;
    return {
      kind: "account-bound",
      capacityIdentity: value.capacityIdentity,
      creditPosture: value.creditPosture,
      overagePosture: value.overagePosture,
    };
  }
  return value.kind === "accountless" ? { kind: "accountless" } : undefined;
}

function isRecordWithExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function isRecordWithAllowedKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.keys(value).every((key) => keys.includes(key));
}

function isPosture(value: unknown): value is "disabled" | "committed" {
  return value === "disabled" || value === "committed";
}

const MANAGED_ECONOMIC_ROUTE_IDENTITY_KEYS = [
  "routeId",
  "providerId",
  "modelId",
  "adapterCapabilityId",
  "adapterCapabilityVersion",
  "authBillingChannel",
  "executionMode",
  "serviceTier",
  "accountPolicyId",
  "fallbackPosture",
  "overagePosture",
  "rateCardId",
  "rateCardRevision",
  "priceEvidenceDigest",
  "unit",
  "scheme",
  "contextClass",
  "cacheClass",
  "auxiliaryScheduleDigest",
  "envelopeDigest",
] as const;

function isReplaySettlement(value: unknown): value is Pick<ManagedEconomicSettlement, "kind"> & {
  readonly evidence?: ManagedEconomicEvidenceIdentity | null;
} {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (!isManagedEconomicSettlementKind(kind)) return false;
  if (
    typeof (value as { reservationId?: unknown }).reservationId !== "string" ||
    typeof (value as { dispatchFenceId?: unknown }).dispatchFenceId !== "string"
  )
    return false;
  const evidence = (value as { evidence?: unknown }).evidence;
  return (
    evidence === undefined ||
    evidence === null ||
    (typeof evidence === "object" &&
      evidence !== null &&
      isManagedEconomicEvidenceAuthority((evidence as { authority?: unknown }).authority))
  );
}

const MANAGED_ECONOMIC_SETTLEMENT_KINDS = new Set<string>([
  "charged",
  "estimated",
  "subscription",
  "included",
  "free",
  "unknown",
  "pending",
  "leaked",
]);

function isManagedEconomicSettlementKind(value: unknown): value is ManagedEconomicSettlement["kind"] {
  return typeof value === "string" && MANAGED_ECONOMIC_SETTLEMENT_KINDS.has(value);
}

function isManagedEconomicEvidenceAuthority(value: unknown): value is ManagedEconomicEvidenceIdentity["authority"] {
  return value === "provider-reported" || value === "configured" || value === "calculated-estimate";
}

function reservationAmounts(
  alternative: Pick<ManagedEconomicExecutionAlternative, "worstCaseReservation">,
): readonly ManagedEconomicAmount[] {
  return alternative.worstCaseReservation.kind === "exact" ? [alternative.worstCaseReservation.amount] : [];
}

function missingAffinityExecutionAccountRef(capacityIdentity: string): ExecutionAccountRef {
  const digest = createHash("sha256")
    .update("kiln-missing-managed-account-affinity-v1:")
    .update(capacityIdentity)
    .digest("hex");
  return createExecutionAccountRef(`configured:missing-affinity:${digest}`);
}

function validateCandidateBinding(binding: ExecutionAccountCandidateBinding): void {
  createExecutionAccountRef(binding.candidate.account);
  requireCanonicalText(binding.capacityIdentity, "Managed account capacity identity is required.");
  requireRoute(binding.candidate.route);
  const usageEvidence = defineExecutionAccountUsageEvidence(binding.usageEvidence);
  if (usageEvidence.health === "unhealthy" && binding.candidate.health !== "unhealthy") {
    throw new TypeError("Managed account candidate health cannot contradict unhealthy usage evidence.");
  }
  if (!/^[a-f0-9]{64}$/.test(binding.credentialRevisionId)) {
    throw new TypeError("Managed account credential revision identity must be a SHA-256 digest.");
  }
  if (binding.accountEconomics !== undefined) {
    if (binding.accountEconomics.capacityIdentity !== binding.capacityIdentity) {
      throw new TypeError("Managed account economics must match candidate capacity identity.");
    }
    requireCanonicalText(binding.accountEconomics.subscriptionClass, "Managed account subscription class is required.");
    requireCanonicalText(binding.accountEconomics.quotaClassId, "Managed account quota class id is required.");
    if (!["disabled", "committed"].includes(binding.accountEconomics.creditPosture)) {
      throw new TypeError("Managed account credit posture is invalid.");
    }
    if (!["disabled", "committed"].includes(binding.accountEconomics.overagePosture)) {
      throw new TypeError("Managed account overage posture is invalid.");
    }
  }
  const { maxConcurrency, reservedAffinitySlots } = binding.capacity;
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new TypeError("Managed account max concurrency must be a positive integer.");
  }
  if (
    !Number.isSafeInteger(reservedAffinitySlots) ||
    reservedAffinitySlots < 0 ||
    reservedAffinitySlots > maxConcurrency
  ) {
    throw new TypeError("Managed account reserved affinity slots must be between zero and max concurrency.");
  }
}

function requireRoute(route: ProviderModelRouteIdentity): void {
  requireCanonicalText(route.providerId, "Managed account route provider id is required.");
  requireCanonicalText(route.providerModelId, "Managed account route model id is required.");
  requireCanonicalText(route.scope, "Managed account route scope is required.");
}

function requireCanonicalText(value: string, message: string): string {
  if (!value || value !== value.trim()) throw new TypeError(message);
  return value;
}

function requireAuditReason(value: string, message: string): string {
  if (!value || value !== value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(message);
  }
  return value;
}

function requireKilnEvidenceUri(value: string): string {
  if (value.length > 512 || !/^kiln:\/\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/u.test(value)) {
    throw new TypeError("Managed economic evidence URI must be a sanitized kiln URI.");
  }
  return value;
}

function requireEconomicAttemptId(value: string): string {
  if (!/^economic-attempt[:-][A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value)) {
    throw new TypeError("Managed economic attempt id must use the economic-attempt namespace.");
  }
  return value;
}

function economicLeaseEvidenceFromRow(row: LeaseRow, commitment: CommitmentRow): ManagedEconomicAccountLeaseEvidence {
  if (
    row.runtime_invocation_id !== null ||
    row.economic_attempt_id === null ||
    row.commitment_id === null ||
    row.job_id !== commitment.job_id ||
    row.economic_attempt_id !== commitment.economic_attempt_id ||
    row.commitment_id !== commitment.commitment_id
  ) {
    throw new Error("Managed economic account lease identity is corrupt.");
  }
  return {
    leaseId: row.lease_id,
    commitmentId: row.commitment_id,
    jobId: row.job_id,
    economicAttemptId: row.economic_attempt_id,
    accountPolicyId: createExecutionAccountPolicyId(row.account_policy_id),
    accountRef: createExecutionAccountRef(row.account_ref),
    route: {
      providerId: row.provider_id,
      providerModelId: row.model_id,
      scope: row.route_scope,
    },
    capacityIdentity: row.capacity_identity,
    credentialRevisionId: row.credential_revision_id,
    selectionReason: row.selection_reason,
    candidateRejections: parseCandidateRejections(row.candidate_rejections),
    usageEvidence: parseUsageEvidence(row.usage_evidence),
    ...(row.affinity_outcome !== null ? { affinityOutcome: row.affinity_outcome } : {}),
    ...(row.affinity_commit_outcome !== null ? { affinityCommitOutcome: row.affinity_commit_outcome } : {}),
    acquiredAt: row.acquired_at,
    lifecycleState: row.lifecycle_state,
    ...(row.released_at !== null ? { releasedAt: row.released_at } : {}),
    resourceUris: parseStringArray(row.resource_uris),
    diagnosticUris: parseStringArray(row.diagnostic_uris),
  };
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error("Managed account lease URI evidence is corrupt.");
  }
  return parsed;
}

function parseCandidateRejections(value: string): ManagedAccountLeaseEvidence["candidateRejections"] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Managed account lease candidate rejection evidence is corrupt.");
  }
  return parsed.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Managed account lease candidate rejection evidence is corrupt.");
    }
    const rejection = entry as Record<string, unknown>;
    if (typeof rejection.account !== "string" || typeof rejection.reason !== "string") {
      throw new Error("Managed account lease candidate rejection evidence is corrupt.");
    }
    return defineExecutionAccountCapacityRejection({
      account: rejection.account,
      reason: rejection.reason,
    });
  });
}

function parseUsageEvidence(value: string): NonNullable<ManagedAccountLeaseEvidence["usageEvidence"]> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Managed account lease usage evidence is corrupt.");
  }
  return parsed as NonNullable<ManagedAccountLeaseEvidence["usageEvidence"]>;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function accountCapacityRecord(row: LeaseRow): AccountCapacityRecord {
  if (row.runtime_invocation_id === null || row.economic_attempt_id !== null) {
    throw new Error("Account-only capacity lease identity is corrupt.");
  }
  return {
    leaseId: row.lease_id,
    runtimeInvocationId: row.runtime_invocation_id,
    accountPolicyId: createExecutionAccountPolicyId(row.account_policy_id),
    accountRef: createExecutionAccountRef(row.account_ref),
    route: {
      providerId: row.provider_id,
      providerModelId: row.model_id,
      scope: row.route_scope,
    },
    capacityIdentity: row.capacity_identity,
    credentialRevisionId: row.credential_revision_id,
    state: row.lifecycle_state as AccountCapacityRecord["state"],
    selectionReason: row.selection_reason,
    candidateRejections: parseCandidateRejections(row.candidate_rejections),
    ...(row.affinity_commit_outcome ? { affinityCommitOutcome: row.affinity_commit_outcome } : {}),
    ...(row.dispatch_fence_id ? { dispatchFenceId: row.dispatch_fence_id } : {}),
  };
}

function accountOutcomeIncident(row: AccountOutcomeIncidentRow): AccountOutcomeIncident | undefined {
  if (row.runtime_invocation_id === null) {
    throw new Error("Account outcome incident identity is corrupt.");
  }
  if (row.settlement_json === null) throw new Error("Account outcome incident settlement is corrupt.");
  let parsed: unknown;
  try { parsed = JSON.parse(row.settlement_json); }
  catch { throw new Error("Account outcome incident settlement is corrupt."); }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as { kind?: unknown }).kind === "completed") {
    return undefined;
  }
  const settlement = parseUnknownAccountCapacitySettlement(row.settlement_json);
  return {
    runtimeInvocationId: row.runtime_invocation_id,
    lifecycleState: row.lifecycle_state,
    capacityState: row.released_at === null ? "active" : "released",
    route: { providerId: row.provider_id, providerModelId: row.model_id, scope: row.route_scope },
    ...(row.dispatch_fence_id ? { dispatchFenceId: row.dispatch_fence_id } : {}),
    settlement,
  };
}

function parseUnknownAccountCapacitySettlement(value: string): Extract<AccountCapacitySettlement, { readonly kind: "unknown" }> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("Account outcome incident settlement is corrupt."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Account outcome incident settlement is corrupt.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "kind,observedAt,reason"
    || record.kind !== "unknown"
    || typeof record.reason !== "string"
    || typeof record.observedAt !== "string"
  ) {
    throw new Error("Account outcome incident settlement is corrupt.");
  }
  const settlement = { kind: "unknown" as const, reason: record.reason, observedAt: record.observedAt };
  validateAccountCapacitySettlement(settlement);
  return settlement;
}

function validateAccountCapacitySettlement(settlement: AccountCapacitySettlement): void {
  if (settlement.kind === "unknown")
    requireAuditReason(settlement.reason, "Gateway capacity unknown settlement reason is invalid.");
  const observedAt = new Date(settlement.observedAt);
  if (Number.isNaN(observedAt.getTime()) || observedAt.toISOString() !== settlement.observedAt) {
    throw new TypeError("Gateway capacity settlement observedAt must be a canonical ISO timestamp.");
  }
}
