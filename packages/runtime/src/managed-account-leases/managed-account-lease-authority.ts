import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  createAccountPolicyId,
  createAccountRef,
  createManagedAccountAffinityKey,
  defineManagedAccountLeaseEvidence,
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
} from "@kilnai/core";
import type { ManagedAgentProviderRoute } from "@kilnai/core";
import type { ModelGatewayBoundUsageEvidence } from "../model-gateway/model-gateway-account-binding.js";

export interface ManagedAccountCandidateBinding {
  readonly candidate: ModelGatewayAccountCandidate;
  /** Stable configured account identity used for capacity across credential revisions. */
  readonly capacityIdentity: string;
  readonly credentialRevisionId: string;
  readonly usageEvidence: ModelGatewayBoundUsageEvidence;
  readonly capacity: {
    readonly maxConcurrency: number;
    readonly reservedAffinitySlots: number;
  };
}

export interface ManagedAccountLeaseIdentity {
  readonly leaseId: string;
  readonly accountPolicyId: AccountPolicyId;
  readonly accountRef: ModelGatewayAccountCandidate["account"];
  readonly route: ModelGatewayRoute;
  readonly jobId: string;
  readonly runtimeInvocationId: string;
}

export type ManagedAccountAffinityRequest =
  | { readonly continuity: "none" }
  | {
    readonly continuity: "prefer" | "require";
    readonly scope: "session" | "turn";
    readonly allowRebind?: boolean;
    readonly key: ManagedAccountAffinityKey;
  };

export interface ManagedAccountLeaseAcquireInput {
  readonly accountPolicyId: AccountPolicyId;
  readonly route: ModelGatewayRoute;
  readonly jobId: string;
  readonly runtimeInvocationId: string;
  readonly affinityRequest: ManagedAccountAffinityRequest;
  readonly candidates: readonly ManagedAccountCandidateBinding[];
}

export type ManagedAccountLeaseAcquireResult =
  | {
    readonly status: "acquired";
    readonly identity: ManagedAccountLeaseIdentity;
    readonly lease: ManagedAccountLeaseEvidence;
  }
  | {
    readonly status: "unavailable";
    readonly rejections: ReturnType<typeof selectModelGatewayAccount>["rejections"];
    readonly affinity?: ReturnType<typeof selectModelGatewayAccount>["affinity"];
  };

export interface ManagedAccountLeaseRecoveryInput {
  readonly reconcilableRuntimeInvocationIds: readonly string[];
  readonly settlementPendingRuntimeInvocationIds: readonly string[];
}

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

export interface ManagedAccountLeaseAuthority {
  acquire(input: ManagedAccountLeaseAcquireInput): Promise<ManagedAccountLeaseAcquireResult>;
  finalizeSuccessful(input: ManagedAccountLeaseIdentity): ManagedAccountLeaseSuccessfulFinalization;
  markSettlementPending(
    input: ManagedAccountLeaseIdentity & { readonly diagnosticUri?: string },
  ): ManagedAccountLeaseEvidence;
  release(input: ManagedAccountLeaseIdentity): ManagedAccountLeaseEvidence;
  recordReleaseFailure(
    input: ManagedAccountLeaseIdentity & { readonly diagnosticUri: string },
  ): ManagedAccountLeaseEvidence;
  recover(input: ManagedAccountLeaseRecoveryInput): readonly ManagedAccountLeaseEvidence[];
  get(leaseId: string): ManagedAccountLeaseEvidence | undefined;
}

export interface ManagedAccountLeaseSuccessfulFinalization {
  readonly lease: ManagedAccountLeaseEvidence;
  readonly affinityCommitOutcome?: ManagedAccountAffinityCommitOutcome;
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
  runtime_invocation_id: string;
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

const CAPACITY_CONSUMING_STATES = [
  "held",
  "settlement-pending",
  "release-failed",
  "leaked",
] as const;

export class SqliteManagedAccountLeaseAuthority implements ManagedAccountLeaseAuthority {
  readonly #db: Database;
  readonly #ownerId: string;
  readonly #now: () => number;
  readonly #ownerStaleMs: number;
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
    try {
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS runtime_owner (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          owner_id TEXT NOT NULL,
          heartbeat INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS account_leases (
          lease_id TEXT PRIMARY KEY,
          account_policy_id TEXT NOT NULL,
          account_ref TEXT NOT NULL,
          capacity_identity TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          route_scope TEXT NOT NULL,
          job_id TEXT NOT NULL UNIQUE,
          runtime_invocation_id TEXT NOT NULL UNIQUE,
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
      this.#migrateLeaseSchema();
      this.#claimOwner();
    } catch (error) {
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

  async acquire(input: ManagedAccountLeaseAcquireInput): Promise<ManagedAccountLeaseAcquireResult> {
    return this.#transaction(() => {
      this.#heartbeat();
      validateAcquireInput(input);
      if (this.#rowForJob(input.jobId) !== null) {
        throw new Error("Managed account lease job already has an account selection.");
      }
      const bindings = new Map(input.candidates.map((binding) => [binding.candidate.account, binding]));
      const affinity = this.#resolveAffinity(input);
      if (affinity.status === "unavailable") return affinity.result;
      const candidates = input.candidates.map((binding) =>
        this.#candidateWithCurrentCapacity(binding, affinity.work));
      const selection = selectModelGatewayAccount({
        route: input.route,
        work: affinity.work,
        ...(affinity.accountAffinity !== undefined ? { affinity: affinity.accountAffinity } : {}),
        ...(affinity.allowRebind ? { allowAffinityRebind: true } : {}),
        candidates,
      });
      if (selection.selected === undefined) {
        return {
          status: "unavailable",
          rejections: selection.rejections,
          ...(selection.affinity !== undefined ? { affinity: selection.affinity } : {}),
        };
      }
      const binding = bindings.get(selection.selected.account);
      if (binding === undefined) throw new Error("Selected managed account binding is unavailable.");
      const leaseId = randomUUID();
      const acquiredAt = new Date(this.#now()).toISOString();
      const affinityOutcome = selection.affinity?.outcome;
      const selectionReason = selection.selected.reason;
      const resourceUris = [`kiln://managed-accounts/leases/${encodeURIComponent(leaseId)}`];
      this.#db.query(`
        INSERT INTO account_leases (
          lease_id, account_policy_id, account_ref, capacity_identity, provider_id, model_id,
          route_scope, job_id, runtime_invocation_id, credential_revision_id,
          owner_id, acquired_at, lifecycle_state, released_at, selection_reason,
          candidate_rejections, usage_evidence, affinity_outcome, purpose, resource_uris,
          diagnostic_uris, affinity_key, affinity_expected_capacity_identity,
          affinity_commit_outcome
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        leaseId,
        input.accountPolicyId,
        selection.selected.account,
        binding.capacityIdentity,
        input.route.providerId,
        input.route.providerModelId,
        input.route.scope,
        input.jobId,
        input.runtimeInvocationId,
        binding.credentialRevisionId,
        this.#ownerId,
        acquiredAt,
        "held",
        null,
        selectionReason,
        JSON.stringify(selection.rejections),
        JSON.stringify(defineModelGatewayAccountUsageEvidence(binding.usageEvidence)),
        affinityOutcome ?? null,
        affinity.work === "existing" ? "affinity" : "new",
        JSON.stringify(resourceUris),
        "[]",
        affinity.key ?? null,
        affinity.expectedCapacityIdentity,
        null,
      );
      const row = this.#rowForLease(leaseId);
      if (row === null) throw new Error("Managed account lease persistence failed.");
      return {
        status: "acquired",
        identity: identityFromRow(row),
        lease: evidenceFromRow(row),
      };
    });
  }

  finalizeSuccessful(input: ManagedAccountLeaseIdentity): ManagedAccountLeaseSuccessfulFinalization {
    return this.#transaction(() => {
      this.#heartbeat();
      const row = this.#requireOwnedIdentity(input);
      if (row.lifecycle_state === "released") {
        return {
          lease: evidenceFromRow(row),
          ...(row.affinity_commit_outcome !== null
            ? { affinityCommitOutcome: row.affinity_commit_outcome }
            : {}),
        };
      }
      if (row.lifecycle_state !== "held") {
        throw new Error(
          `Managed account successful finalization requires held state, received ${row.lifecycle_state}.`,
        );
      }

      const affinityCommitOutcome = row.affinity_key === null
        ? undefined
        : this.#commitAffinity(row);
      const releasedAt = new Date(this.#now()).toISOString();
      const released = this.#db.query(`
        UPDATE account_leases
        SET lifecycle_state='released', released_at=?, affinity_commit_outcome=?
        WHERE lease_id=? AND owner_id=? AND lifecycle_state!='released'
      `).run(releasedAt, affinityCommitOutcome ?? null, row.lease_id, this.#ownerId);
      if (released.changes !== 1) {
        throw new Error("Managed account lease successful finalization lost its release fence.");
      }
      return {
        lease: evidenceFromRow(this.#requiredRow(row.lease_id)),
        ...(affinityCommitOutcome !== undefined ? { affinityCommitOutcome } : {}),
      };
    });
  }

  markSettlementPending(
    input: ManagedAccountLeaseIdentity & { readonly diagnosticUri?: string },
  ): ManagedAccountLeaseEvidence {
    return this.#transaction(() => {
      this.#heartbeat();
      const row = this.#requireOwnedIdentity(input);
      if (row.lifecycle_state === "released") {
        throw new Error("Released managed account lease cannot become settlement-pending.");
      }
      if (row.lifecycle_state === "release-failed" || row.lifecycle_state === "leaked") {
        throw new Error(`Managed account lease cannot become settlement-pending from ${row.lifecycle_state}.`);
      }
      const diagnostics = uniqueStrings([
        ...parseStringArray(row.diagnostic_uris),
        ...(input.diagnosticUri ? [requireCanonicalText(input.diagnosticUri, "Managed account lease diagnostic URI is required.")] : []),
      ]);
      this.#db.query(`
        UPDATE account_leases
        SET lifecycle_state='settlement-pending', diagnostic_uris=?
        WHERE lease_id=? AND owner_id=?
      `).run(JSON.stringify(diagnostics), row.lease_id, this.#ownerId);
      return evidenceFromRow(this.#requiredRow(row.lease_id));
    });
  }

  release(input: ManagedAccountLeaseIdentity): ManagedAccountLeaseEvidence {
    return this.#transaction(() => {
      this.#heartbeat();
      const row = this.#requireOwnedIdentity(input);
      if (row.lifecycle_state === "released") return evidenceFromRow(row);
      if (row.lifecycle_state === "leaked") {
        throw new Error("Leaked managed account lease requires explicit reconciliation.");
      }
      const releasedAt = new Date(this.#now()).toISOString();
      this.#db.query(`
        UPDATE account_leases
        SET lifecycle_state='released', released_at=?
        WHERE lease_id=? AND owner_id=?
      `).run(releasedAt, row.lease_id, this.#ownerId);
      return evidenceFromRow(this.#requiredRow(row.lease_id));
    });
  }

  recordReleaseFailure(
    input: ManagedAccountLeaseIdentity & { readonly diagnosticUri: string },
  ): ManagedAccountLeaseEvidence {
    return this.#transaction(() => {
      this.#heartbeat();
      const row = this.#requireOwnedIdentity(input);
      if (row.lifecycle_state === "released") return evidenceFromRow(row);
      const diagnostics = uniqueStrings([
        ...parseStringArray(row.diagnostic_uris),
        requireCanonicalText(input.diagnosticUri, "Managed account lease release diagnostic URI is required."),
      ]);
      this.#db.query(`
        UPDATE account_leases
        SET lifecycle_state='release-failed', diagnostic_uris=?
        WHERE lease_id=? AND owner_id=?
      `).run(JSON.stringify(diagnostics), row.lease_id, this.#ownerId);
      return evidenceFromRow(this.#requiredRow(row.lease_id));
    });
  }

  recover(input: ManagedAccountLeaseRecoveryInput): readonly ManagedAccountLeaseEvidence[] {
    return this.#transaction(() => {
      this.#heartbeat();
      const reconcilable = new Set(input.reconcilableRuntimeInvocationIds);
      const settlementPending = new Set(input.settlementPendingRuntimeInvocationIds);
      const rows = this.#activeRows();
      for (const row of rows) {
        let lifecycleState: ManagedAccountLeaseEvidence["lifecycleState"] = row.lifecycle_state;
        const diagnostics = [...parseStringArray(row.diagnostic_uris)];
        if (reconcilable.has(row.runtime_invocation_id)) {
          lifecycleState = row.lifecycle_state;
        } else if (settlementPending.has(row.runtime_invocation_id)) {
          lifecycleState = "settlement-pending";
          diagnostics.push(recoveryDiagnosticUri(row.lease_id, "settlement-unknown"));
        } else {
          lifecycleState = "leaked";
          diagnostics.push(recoveryDiagnosticUri(row.lease_id, "recovery-unmatchable"));
        }
        this.#db.query(`
          UPDATE account_leases
          SET owner_id=?, lifecycle_state=?, diagnostic_uris=?
          WHERE lease_id=?
        `).run(this.#ownerId, lifecycleState, JSON.stringify(uniqueStrings(diagnostics)), row.lease_id);
      }
      return this.#activeRows().map(evidenceFromRow);
    });
  }

  get(leaseId: string): ManagedAccountLeaseEvidence | undefined {
    this.#heartbeat();
    const row = this.#rowForLease(leaseId);
    return row === null ? undefined : evidenceFromRow(row);
  }

  list(): readonly ManagedAccountLeaseEvidence[] {
    this.#heartbeat();
    return this.#db.query<LeaseRow, []>("SELECT * FROM account_leases ORDER BY acquired_at, lease_id").all()
      .map(evidenceFromRow);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#heartbeatTimer);
    try {
      this.#db.query("DELETE FROM runtime_owner WHERE singleton=1 AND owner_id=?").run(this.#ownerId);
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

  #resolveAffinity(input: ManagedAccountLeaseAcquireInput):
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
      readonly result: ManagedAccountLeaseAcquireResult & { readonly status: "unavailable" };
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

  #requireOwnedIdentity(input: ManagedAccountLeaseIdentity): LeaseRow {
    const row = this.#rowForLease(input.leaseId);
    if (row === null || row.owner_id !== this.#ownerId || !sameIdentity(row, input)) {
      throw new Error("Managed account lease identity does not match the active lease owner.");
    }
    return row;
  }

  #rowForJob(jobId: string): LeaseRow | null {
    return this.#db.query<LeaseRow, [string]>("SELECT * FROM account_leases WHERE job_id=?").get(jobId) ?? null;
  }

  #rowForLease(leaseId: string): LeaseRow | null {
    return this.#db.query<LeaseRow, [string]>("SELECT * FROM account_leases WHERE lease_id=?").get(leaseId) ?? null;
  }

  #requiredRow(leaseId: string): LeaseRow {
    const row = this.#rowForLease(leaseId);
    if (row === null) throw new Error("Managed account lease persistence failed.");
    return row;
  }

  #activeRows(): LeaseRow[] {
    const placeholders = CAPACITY_CONSUMING_STATES.map(() => "?").join(",");
    return this.#db.query<LeaseRow, string[]>(`
      SELECT * FROM account_leases
      WHERE lifecycle_state IN (${placeholders})
      ORDER BY acquired_at, lease_id
    `).all(...CAPACITY_CONSUMING_STATES);
  }

  #migrateLeaseSchema(): void {
    this.#db.transaction(() => {
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
    }).immediate();
  }

  #claimOwner(): void {
    this.#transaction(() => {
      const now = this.#now();
      const owner = this.#db.query<{ owner_id: string; heartbeat: number }, []>(
        "SELECT owner_id, heartbeat FROM runtime_owner WHERE singleton=1",
      ).get();
      if (owner && owner.owner_id !== this.#ownerId && owner.heartbeat > now - this.#ownerStaleMs) {
        throw new Error("Managed account lease authority already has a live owner.");
      }
      this.#db.query("INSERT OR REPLACE INTO runtime_owner VALUES(1,?,?)").run(this.#ownerId, now);
    });
  }

  #heartbeat(): void {
    if (this.#closed) throw new Error("Managed account lease authority is closed.");
    const result = this.#db.query(
      "UPDATE runtime_owner SET heartbeat=? WHERE singleton=1 AND owner_id=?",
    ).run(this.#now(), this.#ownerId);
    if (result.changes !== 1) throw new Error("Managed account lease authority ownership was lost.");
  }

  #transaction<T>(operation: () => T): T {
    return this.#db.transaction(operation).immediate();
  }
}

function validateAcquireInput(input: ManagedAccountLeaseAcquireInput): void {
  createAccountPolicyId(input.accountPolicyId);
  requireRoute(input.route);
  requireCanonicalText(input.jobId, "Managed account lease job id is required.");
  requireCanonicalText(input.runtimeInvocationId, "Managed account lease runtime invocation id is required.");
  if (input.affinityRequest.continuity !== "none") {
    createManagedAccountAffinityKey(input.affinityRequest.key);
    if (input.affinityRequest.scope !== "session" && input.affinityRequest.scope !== "turn") {
      throw new TypeError("Managed account affinity scope must be session or turn.");
    }
  }
  if (input.candidates.length === 0) return;
  const accounts = new Set<string>();
  for (const binding of input.candidates) {
    validateCandidateBinding(binding);
    if (accounts.has(binding.candidate.account)) {
      throw new TypeError("Managed account lease candidates must not contain duplicate accounts.");
    }
    accounts.add(binding.candidate.account);
  }
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

function identityFromRow(row: LeaseRow): ManagedAccountLeaseIdentity {
  return {
    leaseId: row.lease_id,
    accountPolicyId: createAccountPolicyId(row.account_policy_id),
    accountRef: createAccountRef(row.account_ref),
    route: {
      providerId: row.provider_id,
      providerModelId: row.model_id,
      scope: row.route_scope,
    },
    jobId: row.job_id,
    runtimeInvocationId: row.runtime_invocation_id,
  };
}

function evidenceFromRow(row: LeaseRow): ManagedAccountLeaseEvidence {
  return defineManagedAccountLeaseEvidence({
    ...identityFromRow(row),
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
  });
}

function sameIdentity(row: LeaseRow, input: ManagedAccountLeaseIdentity): boolean {
  return row.account_policy_id === input.accountPolicyId
    && row.account_ref === input.accountRef
    && row.provider_id === input.route.providerId
    && row.model_id === input.route.providerModelId
    && row.route_scope === input.route.scope
    && row.job_id === input.jobId
    && row.runtime_invocation_id === input.runtimeInvocationId;
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

function recoveryDiagnosticUri(leaseId: string, kind: string): string {
  return `kiln://managed-accounts/leases/${encodeURIComponent(leaseId)}/${kind}`;
}
