import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import {
  createAccountPolicyId,
  createAccountRef,
  createManagedAccountAffinityKey,
  defineModelGatewayAccountRejection,
  defineModelGatewayAccountUsageEvidence,
  selectModelGatewayAccount,
  type AccountPolicyId,
  type AccountRef,
  type ManagedAccountAffinityCommitOutcome,
  type ManagedAccountAffinityKey,
  type ManagedAccountAffinityPolicy,
  type ManagedAccountLeaseEvidence,
  type ModelGatewayAccountCandidate,
  type ModelGatewayAffinity,
  type ModelGatewayRoute,
  type ManagedEconomicAdoptedSnapshot,
  type ManagedEconomicAdoptedSnapshotExpectation,
  type ManagedEconomicAmount,
  type ManagedEconomicCommitment,
  type ManagedEconomicExecutionAlternative,
  type ManagedEconomicQuotaEvidence,
  type ManagedEconomicSelectionDecision,
  type ManagedEconomicSettlement,
  selectManagedEconomicExecutionAlternative,
  validateManagedEconomicAdoptedSnapshot,
} from "@kilnai/core";
import type { ManagedAgentProviderRoute } from "@kilnai/core";
import type { ModelGatewayBoundUsageEvidence } from "../model-gateway/model-gateway-account-binding.js";

export interface ManagedAccountCandidateBinding {
  readonly candidate: ModelGatewayAccountCandidate;
  /** Stable configured account identity used for capacity across credential revisions. */
  readonly capacityIdentity: string;
  readonly credentialRevisionId: string;
  readonly usageEvidence: ModelGatewayBoundUsageEvidence;
  readonly quotaEvidence?: ManagedEconomicQuotaEvidence | null;
  readonly capacity: {
    readonly maxConcurrency: number;
    readonly reservedAffinitySlots: number;
  };
}

export type ManagedAccountAffinityRequest =
  | { readonly continuity: "none" }
  | {
    readonly continuity: "prefer" | "require";
    readonly scope: "session" | "turn";
    readonly allowRebind?: boolean;
    readonly key: ManagedAccountAffinityKey;
  };

export interface ManagedAccountCandidateResolution {
  readonly route: ModelGatewayRoute;
  readonly affinityPolicy: ManagedAccountAffinityPolicy;
  readonly candidates: readonly ManagedAccountCandidateBinding[];
}

export interface ManagedAccountCandidatePort {
  resolve(input: {
    readonly accountPolicyId: AccountPolicyId;
    readonly providerRoute: ManagedAgentProviderRoute;
  }): Promise<ManagedAccountCandidateResolution>;
}

export interface SqliteManagedAccountLeaseAuthorityOptions {
  readonly path: string;
  readonly ownerId?: string;
  readonly now?: () => number;
  readonly ownerStaleMs?: number;
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
};

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
  "settlement-pending",
  "release-failed",
  "leaked",
] as const;

export class SqliteManagedAccountLeaseAuthority {
  readonly #db: Database;
  readonly #ownerId: string;
  readonly #now: () => number;
  readonly #ownerStaleMs: number;
  readonly #ownerGeneration = randomUUID();
  readonly #heartbeatTimer: ReturnType<typeof setInterval>;
  #closed = false;

  constructor(options: SqliteManagedAccountLeaseAuthorityOptions) {
    if (!options.path.trim()) throw new TypeError("Managed account lease database path is required.");
    this.#ownerId = requireCanonicalText(options.ownerId ?? randomUUID(), "Managed account lease owner id is required.");
    this.#now = options.now ?? Date.now;
    this.#ownerStaleMs = options.ownerStaleMs ?? 30000;
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
        throw new Error(`Managed economic authority schema version ${openedVersion} is newer than supported version ${SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION}.`);
      }
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS runtime_owner (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          owner_id TEXT NOT NULL,
          heartbeat INTEGER NOT NULL,
          owner_generation TEXT
        );
      `);
      this.#claimOwner();
      ownerClaimed = true;
      this.#migrateLeaseSchema();
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
    this.#heartbeatTimer = setInterval(() => {
      try {
        this.#heartbeat();
      } catch {
        // Foreground operations fail closed after ownership loss.
      }
    }, Math.max(250, Math.floor(this.#ownerStaleMs / 3)));
    this.#heartbeatTimer.unref?.();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#heartbeatTimer);
    try {
      this.#db.query("DELETE FROM runtime_owner WHERE singleton=1 AND owner_id=? AND owner_generation=?")
        .run(this.#ownerId, this.#ownerGeneration);
    } finally {
      this.#db.close();
    }
  }

  #candidateWithCurrentCapacity(
    binding: ManagedAccountCandidateBinding,
    work: "new" | "existing",
  ): ModelGatewayAccountCandidate {
    validateCandidateBinding(binding);
    const placeholders = CAPACITY_CONSUMING_STATES.map(() => "?").join(",");
    const counts = this.#db.query<{ total: number; new_work: number | null }, [string, ...string[]]>(`
      SELECT COUNT(*) total, SUM(CASE WHEN purpose='new' THEN 1 ELSE 0 END) new_work
      FROM account_leases
      WHERE capacity_identity=? AND lifecycle_state IN (${placeholders})
    `).get(binding.capacityIdentity, ...CAPACITY_CONSUMING_STATES);
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
    readonly route: ModelGatewayRoute;
    readonly affinityRequest: ManagedAccountAffinityRequest;
    readonly candidates: readonly ManagedAccountCandidateBinding[];
  }):
    | {
      readonly status: "ready";
      readonly work: "new" | "existing";
      readonly key?: ManagedAccountAffinityKey;
      readonly expectedCapacityIdentity: string | null;
      readonly accountAffinity?: ModelGatewayAffinity;
      readonly allowRebind: boolean;
    }
    | {
      readonly status: "unavailable";
      readonly result: {
        readonly status: "unavailable";
        readonly rejections: ReturnType<typeof selectModelGatewayAccount>["rejections"];
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
    const affinity = this.#db.query<AffinityRow, [string]>(`
      SELECT affinity_key, capacity_identity
      FROM managed_account_affinities
      WHERE affinity_key=?
    `).get(key);
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

    const binding = input.candidates.find((candidate) =>
      candidate.capacityIdentity === affinity.capacity_identity);
    if (!binding) {
      return {
        status: "ready",
        work: "existing",
        key,
        expectedCapacityIdentity: affinity.capacity_identity,
        accountAffinity: {
          account: missingAffinityAccountRef(affinity.capacity_identity),
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
    const current = this.#db.query<AffinityRow, [string]>(`
      SELECT affinity_key, capacity_identity
      FROM managed_account_affinities
      WHERE affinity_key=?
    `).get(key);
    if (current?.capacity_identity === row.capacity_identity) {
      return "already-matched";
    }
    if ((current?.capacity_identity ?? null) !== row.affinity_expected_capacity_identity) {
      return "conflict";
    }

    const now = new Date(this.#now()).toISOString();
    if (!current) {
      const inserted = this.#db.query(`
        INSERT INTO managed_account_affinities(
          affinity_key, capacity_identity, created_at, updated_at
        ) VALUES(?,?,?,?)
      `).run(key, row.capacity_identity, now, now);
      if (inserted.changes !== 1) {
        throw new Error("Managed account affinity first-bind fence was lost.");
      }
    } else {
      const updated = this.#db.query(`
        UPDATE managed_account_affinities
        SET capacity_identity=?, updated_at=?
        WHERE affinity_key=? AND capacity_identity=?
      `).run(
        row.capacity_identity,
        now,
        key,
        row.affinity_expected_capacity_identity,
      );
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
    route: ModelGatewayRoute,
    affinityRequest: ManagedAccountAffinityRequest,
    candidates: readonly ManagedAccountCandidateBinding[],
  ) {
    return this.#resolveAffinity({
      route,
      affinityRequest,
      candidates,
    });
  }

  #commitmentRow(jobId: string, economicAttemptId: string): CommitmentRow | null {
    requireEconomicAttemptId(economicAttemptId);
    return this.#db.query<CommitmentRow, [string, string]>(
      "SELECT * FROM economic_commitments WHERE job_id=? AND economic_attempt_id=?",
    ).get(jobId, economicAttemptId) ?? null;
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
    this.#db.query(`INSERT INTO economic_commitments(
      commitment_id,reservation_id,job_id,economic_attempt_id,intent_fingerprint,
      policy_id,policy_revision,candidate_set_digest,snapshot_digest,decision_at,
      selected_route_id,capacity_identity,reserved_amounts,state,owner_id,owner_generation,
      lease_id,dispatch_fence_id,decision_json,commitment_json,settlement_json,reconciliation_json
    ) VALUES(?,?,?,?,?,?,?,?,?, ?,NULL,NULL,'[]','denied',?,?,NULL,NULL,?,NULL,NULL,NULL)`).run(
      randomUUID(), randomUUID(), input.jobId, input.economicAttemptId, input.intentFingerprint,
      input.snapshot.policy.policyId, input.snapshot.policy.policyRevision,
      input.snapshot.candidateSetDigest, input.snapshot.snapshotDigest, input.snapshot.adoptedDecisionAt,
      this.#ownerId, this.#ownerGeneration, JSON.stringify(evidence),
    );
  }

  #hasEconomicCapacity(
    routeId: string,
    ceiling: ManagedEconomicAmount,
    requested: readonly ManagedEconomicAmount[],
  ): boolean {
    const rows = this.#db.query<{ reserved_amounts: string }, [string, ...string[]]>(`
      SELECT reserved_amounts FROM economic_commitments
      WHERE selected_route_id=? AND state IN (${ECONOMIC_CAPACITY_CONSUMING_STATES.map(() => "?").join(",")})
    `).all(routeId, ...ECONOMIC_CAPACITY_CONSUMING_STATES);
    let used = 0n;
    for (const row of rows) {
      for (const amount of parseEconomicAmounts(row.reserved_amounts)) {
        used += amountInScale(amount, ceiling);
      }
    }
    for (const amount of requested) used += amountInScale(amount, ceiling);
    return used <= BigInt(ceiling.atoms);
  }

  #insertEconomicLease(
    input: ManagedEconomicCommitmentAcquireInput,
    commitmentId: string,
    selected: ManagedEconomicExecutionAlternative,
    account: {
      readonly binding: ManagedAccountCandidateBinding;
      readonly resolution: {
        readonly status: "ready";
        readonly work: "new" | "existing";
        readonly key?: ManagedAccountAffinityKey;
        readonly expectedCapacityIdentity: string | null;
      };
      readonly selection: Exclude<ReturnType<typeof selectModelGatewayAccount>["selected"], undefined>;
      readonly rejections: ReturnType<typeof selectModelGatewayAccount>["rejections"];
    },
  ): string {
    if (selected.identity.account.kind !== "account-bound") throw new Error("fixture");
    const leaseId = randomUUID();
    const route = economicModelGatewayRoute(selected.identity.route);
    const acquiredAt = new Date(this.#now()).toISOString();
    this.#db.query(`INSERT INTO account_leases(
      lease_id,account_policy_id,account_ref,capacity_identity,provider_id,model_id,route_scope,
      job_id,runtime_invocation_id,economic_attempt_id,commitment_id,credential_revision_id,owner_id,acquired_at,lifecycle_state,
      released_at,selection_reason,candidate_rejections,usage_evidence,affinity_outcome,purpose,
      resource_uris,diagnostic_uris,affinity_key,affinity_expected_capacity_identity,affinity_commit_outcome
    ) VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?,?,?, 'held',NULL,?,?,?,?,?,?,?,?,?,NULL)`).run(
      leaseId, selected.identity.route.accountPolicyId, selected.identity.account.accountRef,
      account.binding.capacityIdentity, route.providerId, route.providerModelId, route.scope,
      input.jobId, input.economicAttemptId, commitmentId, account.binding.credentialRevisionId,
      this.#ownerId, acquiredAt, account.selection.reason, JSON.stringify(account.rejections),
      JSON.stringify(defineModelGatewayAccountUsageEvidence(account.binding.usageEvidence)), null,
      account.resolution.work === "existing" ? "affinity" : "new",
      JSON.stringify([`kiln://managed-accounts/leases/${encodeURIComponent(leaseId)}`]), "[]",
      account.resolution.key ?? null, account.resolution.expectedCapacityIdentity,
    );
    const row = this.#requiredRow(leaseId);
    if (row.affinity_key !== null) {
      const outcome = this.#commitAffinity(row);
      this.#db.query("UPDATE account_leases SET affinity_commit_outcome=? WHERE lease_id=?")
        .run(outcome, leaseId);
    }
    return leaseId;
  }

  #releaseEconomicLeaseAndAffinity(leaseId: string): void {
    const row = this.#requiredRow(leaseId);
    if (row.lifecycle_state !== "held") throw new Error("Managed economic account lease is not releasable.");
    this.#rollbackWinningAffinity(row);
    this.#db.query("UPDATE account_leases SET lifecycle_state='released',released_at=? WHERE lease_id=? AND lifecycle_state='held'")
      .run(new Date(this.#now()).toISOString(), leaseId);
  }

  #rollbackWinningAffinity(row: LeaseRow): void {
    if (row.affinity_key === null || row.affinity_commit_outcome !== "won") return;
    if (row.affinity_expected_capacity_identity === null) {
      this.#db.query("DELETE FROM managed_account_affinities WHERE affinity_key=? AND capacity_identity=?")
        .run(row.affinity_key, row.capacity_identity);
    } else {
      this.#db.query("UPDATE managed_account_affinities SET capacity_identity=?,updated_at=? WHERE affinity_key=? AND capacity_identity=?")
        .run(row.affinity_expected_capacity_identity, new Date(this.#now()).toISOString(), row.affinity_key, row.capacity_identity);
    }
  }

  #releaseReconciledLease(leaseId: string, evidenceUri: string, rollbackAffinity: boolean): void {
    const row = this.#requiredRow(leaseId);
    if (row.lifecycle_state === "released") return;
    if (rollbackAffinity) this.#rollbackWinningAffinity(row);
    const diagnostics = uniqueStrings([...parseStringArray(row.diagnostic_uris), evidenceUri]);
    this.#db.query(`UPDATE account_leases
      SET lifecycle_state='released',released_at=?,diagnostic_uris=? WHERE lease_id=?`)
      .run(new Date(this.#now()).toISOString(), JSON.stringify(diagnostics), leaseId);
  }

  #migrateLeaseSchema(): void {
    const version = Number(this.#db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0);
    if (version > SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(`Managed economic authority schema version ${version} is newer than supported version ${SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION}.`);
    }
    // SQLite only honors foreign_keys changes outside transactions; rebuilding
    // the canonical lease table must not leave enforcement disabled afterward.
    this.#db.exec("PRAGMA foreign_keys=OFF;");
    try {
      this.#db.transaction(() => {
      const ownerColumns = new Set(
        this.#db.query<{ name: string }, []>("PRAGMA table_info(runtime_owner)").all().map((column) => column.name),
      );
      if (!ownerColumns.has("owner_generation")) {
        this.#db.exec("ALTER TABLE runtime_owner ADD COLUMN owner_generation TEXT;");
      }
      this.#db.query("UPDATE runtime_owner SET owner_generation=? WHERE singleton=1 AND owner_id=?")
        .run(this.#ownerGeneration, this.#ownerId);

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

      const leaseTable = this.#db.query<{ sql: string | null }, []>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='account_leases'",
      ).get();
      const leaseColumns = this.#db.query<{ name: string; notnull: number }, []>(
        "PRAGMA table_info(account_leases)",
      ).all();
      const runtimeInvocationColumn = leaseColumns.find((column) => column.name === "runtime_invocation_id");
      if (
        leaseTable?.sql
        && (
          /(?:job_id|runtime_invocation_id)\s+TEXT\s+NOT\s+NULL\s+UNIQUE/iu.test(leaseTable.sql)
          || runtimeInvocationColumn?.notnull === 1
          || !leaseColumns.some((column) => column.name === "economic_attempt_id")
          || !leaseColumns.some((column) => column.name === "commitment_id")
        )
      ) {
        this.#rebuildLeaseTable();
      }
      const columns = new Set(
        this.#db.query<{ name: string }, []>("PRAGMA table_info(account_leases)").all()
          .map((column) => column.name),
      );
      if (!columns.has("affinity_key")) {
        this.#db.exec("ALTER TABLE account_leases ADD COLUMN affinity_key TEXT;");
      }
      if (!columns.has("affinity_expected_capacity_identity")) {
        this.#db.exec(
          "ALTER TABLE account_leases ADD COLUMN affinity_expected_capacity_identity TEXT;",
        );
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
        CREATE TABLE IF NOT EXISTS legacy_lease_reconciliations (
          lease_id TEXT PRIMARY KEY, operator_identity TEXT NOT NULL,
          reason TEXT NOT NULL, evidence_uri TEXT NOT NULL,
          reconciled_at TEXT NOT NULL, previous_state TEXT NOT NULL
        );
      `);
      this.#db.exec(`PRAGMA user_version=${SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION};`);
      }).immediate();
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
      const accountSelections = new Map<string, {
        readonly binding: ManagedAccountCandidateBinding;
        readonly resolution: {
          readonly status: "ready";
          readonly work: "new" | "existing";
          readonly key?: ManagedAccountAffinityKey;
          readonly expectedCapacityIdentity: string | null;
          readonly accountAffinity?: ModelGatewayAffinity;
          readonly allowRebind: boolean;
        };
        readonly selection: Exclude<ReturnType<typeof selectModelGatewayAccount>["selected"], undefined>;
        readonly rejections: ReturnType<typeof selectModelGatewayAccount>["rejections"];
      }>();
      const alternatives: ManagedEconomicExecutionAlternative[] = [];
      const authorityRejections: ManagedEconomicAuthorityRejection[] = [];
      for (const adopted of input.snapshot.routes) {
        const local = capacities.get(adopted.route.routeId);
        if (!local) throw new TypeError(`Missing local capacity for economic route ${adopted.route.routeId}.`);
        if (adopted.route.accountPolicyId === null) {
          if (adopted.ceiling.kind === "finite" && !this.#hasEconomicCapacity(
            adopted.route.routeId,
            adopted.ceiling.amount,
            reservationAmounts(adopted),
          )) {
            authorityRejections.push({
              stage: "local-capacity", routeId: adopted.route.routeId, reason: "route-capacity-exhausted",
            });
            continue;
          }
          alternatives.push({
            ...adopted,
            identity: { route: adopted.route, account: { kind: "accountless" } },
            accountSelectionReason: "accountless",
            observedAffinityRevision: null,
          });
          continue;
        }
        const route = local.route ?? economicModelGatewayRoute(adopted.route);
        const affinityRequest = local.affinityRequest ?? { continuity: "none" as const };
        const candidates = local.candidates ?? [];
        const resolution = this.#economicAffinityResolution(route, affinityRequest, candidates);
        if (resolution.status === "unavailable") {
          authorityRejections.push({ stage: "account-selection", routeId: adopted.route.routeId, rejections: resolution.result.rejections });
          continue;
        }
        const selection = selectModelGatewayAccount({
          route,
          work: resolution.work,
          ...(resolution.accountAffinity ? { affinity: resolution.accountAffinity } : {}),
          ...(resolution.allowRebind ? { allowAffinityRebind: true } : {}),
          candidates: candidates.map((binding) => this.#candidateWithCurrentCapacity(binding, resolution.work)),
        });
        authorityRejections.push({ stage: "account-selection", routeId: adopted.route.routeId, rejections: selection.rejections });
        if (!selection.selected) continue;
        if (adopted.ceiling.kind === "finite" && !this.#hasEconomicCapacity(
          adopted.route.routeId,
          adopted.ceiling.amount,
          reservationAmounts(adopted),
        )) {
          authorityRejections.push({
            stage: "local-capacity", routeId: adopted.route.routeId, reason: "route-capacity-exhausted",
          });
          continue;
        }
        const binding = candidates.find((candidate) => candidate.candidate.account === selection.selected!.account);
        if (!binding) throw new Error("Selected managed economic account binding is unavailable.");
        accountSelections.set(adopted.route.routeId, {
          binding, resolution, selection: selection.selected, rejections: selection.rejections,
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
              creditPosture: "disabled",
              overagePosture: adopted.route.overagePosture,
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
        const evidence = { decision, authorityRejections } satisfies ManagedEconomicAuthorityDecisionEvidence;
        this.#insertCommitmentDecision(input, evidence);
        return { status: "denied", decision, evidence, replay: false };
      }
      const selected = decision.selected;
      if (selected.executionEnvelope.kind !== "bounded") {
        throw new Error("Managed economic selector returned an unbounded selected alternative.");
      }
      const amounts = selected.worstCaseReservation.kind === "exact"
        ? [selected.worstCaseReservation.amount]
        : [];
      if (selected.ceiling.kind === "finite" && !this.#hasEconomicCapacity(
        selected.identity.route.routeId,
        selected.ceiling.amount,
        amounts,
      )) {
        throw new Error("Managed economic route capacity changed inside one transaction.");
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
      this.#db.query(`INSERT INTO economic_commitments(
        commitment_id,reservation_id,job_id,economic_attempt_id,intent_fingerprint,
        policy_id,policy_revision,candidate_set_digest,snapshot_digest,decision_at,
        selected_route_id,capacity_identity,reserved_amounts,state,owner_id,owner_generation,
        lease_id,dispatch_fence_id,decision_json,commitment_json,settlement_json,reconciliation_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'held',?,?,?,?,?,?,NULL,NULL)`).run(
        commitmentId, reservationId, input.jobId, input.economicAttemptId, input.intentFingerprint,
        input.snapshot.policy.policyId, input.snapshot.policy.policyRevision,
        input.snapshot.candidateSetDigest, input.snapshot.snapshotDigest, input.snapshot.adoptedDecisionAt,
        selected.identity.route.routeId,
        selected.identity.account.kind === "account-bound" ? selected.identity.account.capacityIdentity : null,
        JSON.stringify(amounts), this.#ownerId, this.#ownerGeneration, leaseId, null,
        JSON.stringify({ decision, authorityRejections }), JSON.stringify(commitment),
      );
      return resultFromCommitmentRow(this.#requiredCommitmentRow(input.jobId, input.economicAttemptId), this.#rowForOptionalLease(leaseId), false);
    });
  }

  queryCommitment(jobId: string, economicAttemptId?: string): ManagedEconomicCommitmentRecord | "absent" | "committed" | "dispatch-fenced" {
    this.#heartbeat();
    const row = economicAttemptId === undefined
      ? this.#db.query<CommitmentRow, [string]>("SELECT * FROM economic_commitments WHERE job_id=? ORDER BY rowid DESC LIMIT 1").get(jobId) ?? null
      : this.#commitmentRow(jobId, economicAttemptId);
    if (row === null || row.state === "denied") return "absent";
    if (economicAttemptId !== undefined) return recordFromCommitmentRow(row, this.#rowForOptionalLease(row.lease_id));
    return row.state === "dispatch-fenced" || row.state === "settlement-pending" || row.state === "release-failed" || row.state === "leaked"
      ? "dispatch-fenced" : "committed";
  }

  releaseCommitmentPreFence(jobId: string, economicAttemptId: string): ManagedEconomicCommitmentRecord {
    return this.#transaction(() => {
      this.#heartbeat();
      const row = this.#requiredCommitmentRow(jobId, economicAttemptId);
      if (row.state === "released") return recordFromCommitmentRow(row, this.#rowForOptionalLease(row.lease_id));
      if (row.state !== "held") throw new Error("Only a definitely pre-dispatch commitment may be released.");
      if (row.lease_id) this.#releaseEconomicLeaseAndAffinity(row.lease_id);
      const changed = this.#db.query("UPDATE economic_commitments SET state='released' WHERE commitment_id=? AND state='held' AND owner_generation=?")
        .run(row.commitment_id, this.#ownerGeneration);
      if (changed.changes !== 1) throw new Error("Managed economic pre-dispatch release lost its owner fence.");
      return recordFromCommitmentRow(this.#requiredCommitmentRow(jobId, economicAttemptId), this.#rowForOptionalLease(row.lease_id));
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
      if (row.state !== "held") throw new Error("Managed economic commitment cannot be dispatch-fenced from its current state.");
      const changed = this.#db.query("UPDATE economic_commitments SET state='dispatch-fenced',dispatch_fence_id=? WHERE commitment_id=? AND state='held' AND owner_generation=?")
        .run(dispatchFenceId, row.commitment_id, this.#ownerGeneration);
      if (changed.changes !== 1) throw new Error("Managed economic dispatch fence was lost.");
      return recordFromCommitmentRow(this.#requiredCommitmentRow(jobId, economicAttemptId), this.#rowForOptionalLease(row.lease_id));
    });
  }

  createManagedJobCommitmentRecoveryPort(): ManagedEconomicCommitmentRecoveryPort {
    return {
      query: ({ jobId, economicAttemptId }) => {
        this.#heartbeat();
        const row = this.#commitmentRow(jobId, economicAttemptId);
        if (row === null || row.state === "denied" || row.state === "released") return "absent";
        return row.state === "held" ? "committed" : "dispatch-fenced";
      },
    };
  }

  recoverCommitments(
    input: ManagedEconomicCommitmentRecoveryInput = {},
  ): readonly ManagedEconomicCommitmentRecord[] {
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
      const legacyRows = this.#db.query<LeaseRow, string[]>(`
        SELECT leases.* FROM account_leases leases
        WHERE lifecycle_state IN (${CAPACITY_CONSUMING_STATES.map(() => "?").join(",")})
          AND NOT EXISTS (
            SELECT 1 FROM economic_commitments commitments
            WHERE commitments.lease_id=leases.lease_id
          )
        ORDER BY leases.rowid
      `).all(...CAPACITY_CONSUMING_STATES);
      for (const row of legacyRows) {
        const historicalIdentity = row.runtime_invocation_id !== null
          && row.economic_attempt_id === null && row.commitment_id === null;
        const orphanedEconomicIdentity = row.runtime_invocation_id === null
          && row.economic_attempt_id !== null && row.commitment_id !== null;
        if (!historicalIdentity && !orphanedEconomicIdentity) {
          throw new Error("Orphaned managed account lease identity is corrupt.");
        }
        const evidenceUri = `kiln://managed-accounts/leases/${encodeURIComponent(row.lease_id)}/legacy-recovery`;
        const diagnostics = uniqueStrings([...parseStringArray(row.diagnostic_uris), evidenceUri]);
        this.#db.query(`UPDATE account_leases
          SET owner_id=?,lifecycle_state='leaked',diagnostic_uris=? WHERE lease_id=?`)
          .run(this.#ownerId, JSON.stringify(diagnostics), row.lease_id);
      }
      const rows = this.#db.query<CommitmentRow, string[]>(`
        SELECT * FROM economic_commitments
        WHERE state IN (${ECONOMIC_CAPACITY_CONSUMING_STATES.map(() => "?").join(",")})
        ORDER BY rowid
      `).all(...ECONOMIC_CAPACITY_CONSUMING_STATES);
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
            kind: "pending", reservationId: row.reservation_id,
            dispatchFenceId: requirePersistedFence(row),
          } satisfies ManagedEconomicSettlement);
        }
        if (leak && row.state !== "leaked") {
          state = "leaked";
          settlement = JSON.stringify({
            kind: "leaked", reservationId: row.reservation_id,
            dispatchFenceId: requirePersistedFence(row), reason: leak.reason,
          } satisfies ManagedEconomicSettlement);
          lifecycleEvidence = JSON.stringify({
            kind: "leak-classification", reason: leak.reason, evidenceUri: leak.evidenceUri,
          });
        }
        this.#db.query(`UPDATE economic_commitments
          SET owner_id=?,owner_generation=?,state=?,settlement_json=?,reconciliation_json=? WHERE commitment_id=?`)
          .run(this.#ownerId, this.#ownerGeneration, state, settlement, lifecycleEvidence, row.commitment_id);
        if (row.lease_id !== null) {
          this.#db.query("UPDATE account_leases SET owner_id=? WHERE lease_id=?")
            .run(this.#ownerId, row.lease_id);
        }
      }
      return rows.map((row) => {
        const recovered = this.#requiredCommitmentRow(row.job_id, row.economic_attempt_id);
        return recordFromCommitmentRow(recovered, this.#rowForOptionalLease(recovered.lease_id));
      });
    });
  }

  recordCommitmentReleaseFailure(
    input: ManagedEconomicCommitmentReleaseFailureInput,
  ): ManagedEconomicCommitmentRecord {
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
      this.#db.query("UPDATE economic_commitments SET state='release-failed',reconciliation_json=? WHERE commitment_id=? AND owner_generation=?")
        .run(JSON.stringify({ kind: "release-failure", reason: input.reason, evidenceUri: input.evidenceUri }), row.commitment_id, this.#ownerGeneration);
      if (row.lease_id !== null) {
        const lease = this.#requiredRow(row.lease_id);
        this.#db.query("UPDATE account_leases SET lifecycle_state='release-failed',diagnostic_uris=? WHERE lease_id=?")
          .run(JSON.stringify(uniqueStrings([...parseStringArray(lease.diagnostic_uris), input.evidenceUri])), row.lease_id);
      }
      const failed = this.#requiredCommitmentRow(input.jobId, input.economicAttemptId);
      return recordFromCommitmentRow(failed, this.#rowForOptionalLease(failed.lease_id));
    });
  }

  reconcileCommitment(
    input: ManagedEconomicCommitmentReconciliationInput,
  ): ManagedEconomicCommitmentRecord {
    return this.#transaction(() => {
      this.#heartbeat();
      requireAuditIdentity(input.operatorIdentity);
      requireAuditReason(input.reason, "Managed economic reconciliation reason is invalid.");
      requireKilnEvidenceUri(input.evidenceUri);
      const row = this.#requiredCommitmentRow(input.jobId, input.economicAttemptId);
      if (row.state === "released") return recordFromCommitmentRow(row, this.#rowForOptionalLease(row.lease_id));
      if (row.state !== "release-failed" && row.state !== "leaked") {
        throw new Error("Only release-failed or leaked managed economic commitments may be reconciled.");
      }
      if (row.lease_id !== null) {
        this.#releaseReconciledLease(row.lease_id, input.evidenceUri, row.state === "release-failed");
      }
      const reconciliation = {
        operatorIdentity: input.operatorIdentity,
        reason: input.reason,
        evidenceUri: input.evidenceUri,
        reconciledAt: new Date(this.#now()).toISOString(),
        previousState: row.state,
        commitmentId: row.commitment_id,
      };
      const changed = this.#db.query(`UPDATE economic_commitments
        SET state='released',reconciliation_json=?
        WHERE commitment_id=? AND state=? AND owner_generation=?`)
        .run(JSON.stringify(reconciliation), row.commitment_id, row.state, this.#ownerGeneration);
      if (changed.changes !== 1) throw new Error("Managed economic reconciliation lost its owner fence.");
      const reconciled = this.#requiredCommitmentRow(input.jobId, input.economicAttemptId);
      return recordFromCommitmentRow(reconciled, this.#rowForOptionalLease(reconciled.lease_id));
    });
  }

  reconcileLegacyAccountLease(
    input: ManagedLegacyAccountLeaseReconciliationInput,
  ): ManagedLegacyAccountLeaseReconciliationEvidence {
    return this.#transaction(() => {
      this.#heartbeat();
      requireCanonicalText(input.leaseId, "Historical managed account lease id is required.");
      requireAuditIdentity(input.operatorIdentity);
      requireAuditReason(input.reason, "Historical lease reconciliation reason is invalid.");
      requireKilnEvidenceUri(input.evidenceUri);
      const row = this.#requiredRow(input.leaseId);
      if (row.lifecycle_state === "released") {
        const existing = this.#db.query<{
          lease_id: string;
          operator_identity: string;
          reason: string;
          evidence_uri: string;
          reconciled_at: string;
          previous_state: "release-failed" | "leaked";
        }, [string]>("SELECT * FROM legacy_lease_reconciliations WHERE lease_id=?").get(row.lease_id);
        if (!existing) throw new Error("Historical lease was released without legacy reconciliation evidence.");
        if (
          existing.operator_identity !== input.operatorIdentity
          || existing.reason !== input.reason
          || existing.evidence_uri !== input.evidenceUri
        ) {
          throw new Error("Historical lease reconciliation evidence conflicts with the durable record.");
        }
        return {
          leaseId: existing.lease_id,
          previousState: existing.previous_state,
          state: "released",
          operatorIdentity: existing.operator_identity,
          reason: existing.reason,
          evidenceUri: existing.evidence_uri,
          reconciledAt: existing.reconciled_at,
        };
      }
      const referenced = this.#db.query<{ present: number }, [string]>(
        "SELECT 1 present FROM economic_commitments WHERE lease_id=? LIMIT 1",
      ).get(row.lease_id);
      if (referenced) {
        throw new Error("A commitment-owned lease must use economic commitment reconciliation.");
      }
      const historicalIdentity = row.runtime_invocation_id !== null
        && row.economic_attempt_id === null && row.commitment_id === null;
      const orphanedEconomicIdentity = row.runtime_invocation_id === null
        && row.economic_attempt_id !== null && row.commitment_id !== null;
      if (!historicalIdentity && !orphanedEconomicIdentity) {
        throw new Error("Only a migrated or orphaned account lease may use legacy reconciliation.");
      }
      if (row.lifecycle_state !== "release-failed" && row.lifecycle_state !== "leaked") {
        throw new Error("Only release-failed or leaked historical leases may be reconciled.");
      }
      const previousState = row.lifecycle_state;
      const reconciledAt = new Date(this.#now()).toISOString();
      this.#releaseReconciledLease(row.lease_id, input.evidenceUri, false);
      const evidence: ManagedLegacyAccountLeaseReconciliationEvidence = {
        leaseId: row.lease_id,
        previousState,
        state: "released",
        operatorIdentity: input.operatorIdentity,
        reason: input.reason,
        evidenceUri: input.evidenceUri,
        reconciledAt,
      };
      this.#db.query(`INSERT INTO legacy_lease_reconciliations(
        lease_id,operator_identity,reason,evidence_uri,reconciled_at,previous_state
      ) VALUES(?,?,?,?,?,?)`).run(
        evidence.leaseId, evidence.operatorIdentity, evidence.reason,
        evidence.evidenceUri, evidence.reconciledAt, evidence.previousState,
      );
      return evidence;
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
        affinity_expected_capacity_identity TEXT, affinity_commit_outcome TEXT
      );
    `);
    const oldColumns = new Set(this.#db.query<{ name: string }, []>("PRAGMA table_info(account_leases)").all().map((c) => c.name));
    const columns = [
      "lease_id", "account_policy_id", "account_ref", "capacity_identity", "provider_id", "model_id",
      "route_scope", "job_id", "runtime_invocation_id", "economic_attempt_id", "commitment_id",
      "credential_revision_id", "owner_id", "acquired_at",
      "lifecycle_state", "released_at", "selection_reason", "candidate_rejections", "usage_evidence",
      "affinity_outcome", "purpose", "resource_uris", "diagnostic_uris", "affinity_key",
      "affinity_expected_capacity_identity", "affinity_commit_outcome",
    ];
    const select = columns.map((column) => oldColumns.has(column)
      ? column
      : column === "usage_evidence" ? "'{\"health\":\"healthy\",\"freshness\":\"missing\"}'"
      : "NULL");
    this.#db.exec(`INSERT INTO account_leases_rebuilt(${columns.join(",")}) SELECT ${select.join(",")} FROM account_leases; DROP TABLE account_leases; ALTER TABLE account_leases_rebuilt RENAME TO account_leases;`);
  }

  #claimOwner(): void {
    this.#transaction(() => {
      const now = this.#now();
      const owner = this.#db.query<{ owner_id: string; heartbeat: number }, []>(
        "SELECT owner_id, heartbeat FROM runtime_owner WHERE singleton=1",
      ).get();
      if (owner && owner.heartbeat > now - this.#ownerStaleMs) {
        throw new Error("Managed account lease authority already has a live owner.");
      }
      const columns = this.#db.query<{ name: string }, []>("PRAGMA table_info(runtime_owner)").all();
      if (columns.some((column) => column.name === "owner_generation")) {
        this.#db.query("INSERT OR REPLACE INTO runtime_owner(singleton,owner_id,heartbeat,owner_generation) VALUES(1,?,?,?)")
          .run(this.#ownerId, now, this.#ownerGeneration);
      } else {
        this.#db.query("INSERT OR REPLACE INTO runtime_owner(singleton,owner_id,heartbeat) VALUES(1,?,?)").run(this.#ownerId, now);
      }
    });
  }

  #releaseOwnerClaim(): void {
    try {
      const columns = this.#db.query<{ name: string }, []>("PRAGMA table_info(runtime_owner)").all();
      if (columns.some((column) => column.name === "owner_generation")) {
        this.#db.query("DELETE FROM runtime_owner WHERE singleton=1 AND owner_id=? AND owner_generation=?")
          .run(this.#ownerId, this.#ownerGeneration);
      } else {
        this.#db.query("DELETE FROM runtime_owner WHERE singleton=1 AND owner_id=?")
          .run(this.#ownerId);
      }
    } catch {
      // Preserve the original open/migration error; stale-owner timeout remains the fallback.
    }
  }

  #heartbeat(): void {
    if (this.#closed) throw new Error("Managed account lease authority is closed.");
    const result = this.#db.query(
      "UPDATE runtime_owner SET heartbeat=? WHERE singleton=1 AND owner_id=? AND owner_generation=?",
    ).run(this.#now(), this.#ownerId, this.#ownerGeneration);
    if (result.changes !== 1) throw new Error("Managed account lease authority ownership was lost.");
  }

  #transaction<T>(
    operation: () => T & (T extends PromiseLike<unknown> ? never : unknown),
  ): T {
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
  readonly route?: ModelGatewayRoute;
  readonly affinityRequest?: ManagedAccountAffinityRequest;
  readonly candidates?: readonly ManagedAccountCandidateBinding[];
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
  readonly accountPolicyId: AccountPolicyId;
  readonly accountRef: ModelGatewayAccountCandidate["account"];
  readonly route: ModelGatewayRoute;
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
  | { readonly stage: "account-selection"; readonly routeId: string; readonly rejections: ReturnType<typeof selectModelGatewayAccount>["rejections"] }
  | { readonly stage: "local-capacity"; readonly routeId: string; readonly reason: "route-capacity-exhausted" };

export interface ManagedEconomicAuthorityDecisionEvidence {
  readonly decision: ManagedEconomicSelectionDecision;
  readonly authorityRejections: readonly ManagedEconomicAuthorityRejection[];
}

export type ManagedEconomicCommitmentAcquireResult =
  | { readonly status: "committed"; readonly record: ManagedEconomicCommitmentRecord; readonly replay: boolean }
  | { readonly status: "denied"; readonly decision: Extract<ManagedEconomicSelectionDecision, { readonly kind: "denied" }>; readonly evidence: ManagedEconomicAuthorityDecisionEvidence; readonly replay: boolean }
  | { readonly status: "conflict"; readonly reason: "idempotency-conflict" | "identity-revision-conflict" };

export interface ManagedEconomicCommitmentReconciliationInput {
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly operatorIdentity: string;
  readonly reason: string;
  readonly evidenceUri: string;
}

export interface ManagedLegacyAccountLeaseReconciliationInput {
  readonly leaseId: string;
  readonly operatorIdentity: string;
  readonly reason: string;
  readonly evidenceUri: string;
}

export interface ManagedLegacyAccountLeaseReconciliationEvidence {
  readonly leaseId: string;
  readonly previousState: "release-failed" | "leaked";
  readonly state: "released";
  readonly operatorIdentity: string;
  readonly reason: string;
  readonly evidenceUri: string;
  readonly reconciledAt: string;
}

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

const SQLITE_MANAGED_AUTHORITY_SCHEMA_VERSION = 2;
const ECONOMIC_CAPACITY_CONSUMING_STATES = [
  "held", "dispatch-fenced", "settlement-pending", "release-failed", "leaked",
] as const;

function economicModelGatewayRoute(
  route: ManagedEconomicExecutionAlternative["identity"]["route"],
): ModelGatewayRoute {
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

function amountInScale(amount: ManagedEconomicAmount, target: ManagedEconomicAmount): bigint {
  if (amount.unit !== target.unit || !sameEconomicScheme(amount.scheme, target.scheme)) {
    throw new Error("Managed economic route capacity units are incompatible.");
  }
  if (amount.scale > target.scale) {
    const divisor = 10n ** BigInt(amount.scale - target.scale);
    const atoms = BigInt(amount.atoms);
    if (atoms % divisor !== 0n) throw new Error("Managed economic route capacity scale loses precision.");
    return atoms / divisor;
  }
  return BigInt(amount.atoms) * 10n ** BigInt(target.scale - amount.scale);
}

function sameEconomicScheme(
  left: ManagedEconomicAmount["scheme"],
  right: ManagedEconomicAmount["scheme"],
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "currency" && right.kind === "currency") return left.currency === right.currency;
  if (left.kind === "credit" && right.kind === "credit") return left.creditSchemeId === right.creditSchemeId;
  return left.kind === "unit" && right.kind === "unit";
}

function sameCommitmentRevision(
  row: CommitmentRow,
  input: ManagedEconomicCommitmentAcquireInput,
): boolean {
  return row.policy_id === input.snapshot.policy.policyId
    && row.policy_revision === input.snapshot.policy.policyRevision
    && row.candidate_set_digest === input.snapshot.candidateSetDigest
    && row.snapshot_digest === input.snapshot.snapshotDigest
    && row.decision_at === input.snapshot.adoptedDecisionAt;
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
  return { status: "committed", record: recordFromCommitmentRow(row, lease), replay };
}

function recordFromCommitmentRow(row: CommitmentRow, lease: LeaseRow | null): ManagedEconomicCommitmentRecord {
  if (row.state === "denied" || row.commitment_json === null) {
    throw new Error("Managed economic commitment record is unavailable for a denied decision.");
  }
  if (
    (row.lease_id === null) !== (lease === null)
    || (row.lease_id !== null && lease?.lease_id !== row.lease_id)
  ) {
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
      ? { settlement: JSON.parse(row.settlement_json) as ManagedEconomicSettlement }
      : {}),
    ...(row.reconciliation_json !== null
      ? { lifecycleEvidence: JSON.parse(row.reconciliation_json) as Readonly<Record<string, unknown>> }
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
  return JSON.parse(value) as ManagedEconomicAuthorityDecisionEvidence;
}

function reservationAmounts(
  alternative: Pick<ManagedEconomicExecutionAlternative, "worstCaseReservation">,
): readonly ManagedEconomicAmount[] {
  return alternative.worstCaseReservation.kind === "exact"
    ? [alternative.worstCaseReservation.amount]
    : [];
}

function missingAffinityAccountRef(capacityIdentity: string): AccountRef {
  const digest = createHash("sha256")
    .update("kiln-missing-managed-account-affinity-v1:")
    .update(capacityIdentity)
    .digest("hex");
  return createAccountRef(`configured:missing-affinity:${digest}`);
}

function validateCandidateBinding(binding: ManagedAccountCandidateBinding): void {
  createAccountRef(binding.candidate.account);
  requireCanonicalText(binding.capacityIdentity, "Managed account capacity identity is required.");
  requireRoute(binding.candidate.route);
  const usageEvidence = defineModelGatewayAccountUsageEvidence(binding.usageEvidence);
  if (usageEvidence.health === "unhealthy" && binding.candidate.health !== "unhealthy") {
    throw new TypeError("Managed account candidate health cannot contradict unhealthy usage evidence.");
  }
  if (!/^[a-f0-9]{64}$/.test(binding.credentialRevisionId)) {
    throw new TypeError("Managed account credential revision identity must be a SHA-256 digest.");
  }
  const { maxConcurrency, reservedAffinitySlots } = binding.capacity;
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new TypeError("Managed account max concurrency must be a positive integer.");
  }
  if (!Number.isSafeInteger(reservedAffinitySlots) || reservedAffinitySlots < 0 || reservedAffinitySlots > maxConcurrency) {
    throw new TypeError("Managed account reserved affinity slots must be between zero and max concurrency.");
  }
}

function requireRoute(route: ModelGatewayRoute): void {
  requireCanonicalText(route.providerId, "Managed account route provider id is required.");
  requireCanonicalText(route.providerModelId, "Managed account route model id is required.");
  requireCanonicalText(route.scope, "Managed account route scope is required.");
}

function requireCanonicalText(value: string, message: string): string {
  if (!value || value !== value.trim()) throw new TypeError(message);
  return value;
}

function requireAuditIdentity(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(value)) {
    throw new TypeError("Managed economic reconciliation operator identity is invalid.");
  }
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

function economicLeaseEvidenceFromRow(
  row: LeaseRow,
  commitment: CommitmentRow,
): ManagedEconomicAccountLeaseEvidence {
  if (
    row.runtime_invocation_id !== null
    || row.economic_attempt_id === null
    || row.commitment_id === null
    || row.job_id !== commitment.job_id
    || row.economic_attempt_id !== commitment.economic_attempt_id
    || row.commitment_id !== commitment.commitment_id
  ) {
    throw new Error("Managed economic account lease identity is corrupt.");
  }
  return {
    leaseId: row.lease_id,
    commitmentId: row.commitment_id,
    jobId: row.job_id,
    economicAttemptId: row.economic_attempt_id,
    accountPolicyId: createAccountPolicyId(row.account_policy_id),
    accountRef: createAccountRef(row.account_ref),
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
    ...(row.affinity_commit_outcome !== null
      ? { affinityCommitOutcome: row.affinity_commit_outcome }
      : {}),
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

function parseCandidateRejections(
  value: string,
): ManagedAccountLeaseEvidence["candidateRejections"] {
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
    return defineModelGatewayAccountRejection({
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
