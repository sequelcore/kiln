import { createHash, randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import {
  decideBoundedWorkAdmission,
  normalizeBoundedWorkContractRevision,
  normalizeBoundedWorkAccountingSnapshot,
  type AssessBoundedWorkScopeInput,
  type BoundedWorkAccountingSnapshot,
  type BoundedWorkAdmissionDecision,
  type BoundedWorkContractRevision,
  type BoundedWorkHarnessCapability,
  type BoundedWorkReservation,
} from "@kilnai/core";

export const SQLITE_BOUNDED_WORK_AUTHORITY_SCHEMA_VERSION = 1 as const;

export type BoundedWorkAuthorityErrorCode =
  | "idempotency_conflict"
  | "stale_contract_revision"
  | "reservation_not_found"
  | "reservation_revision_conflict"
  | "reservation_state_conflict"
  | "dispatch_identity_conflict"
  | "accounting_conflict";

export class BoundedWorkAuthorityError extends Error {
  constructor(readonly code: BoundedWorkAuthorityErrorCode) {
    super(code);
    this.name = "BoundedWorkAuthorityError";
  }
}

export interface BoundedWorkRouteIdentity {
  readonly routeId: string;
  readonly harnessId: string;
}

export type BoundedWorkReservationState =
  | "reserved"
  | "dispatched"
  | "released"
  | "settled"
  | "reconciliation_required";

export type BoundedWorkTerminalOutcome = "completed" | "failed" | "cancelled";

export interface BoundedWorkReservationReceipt {
  readonly reservationId: string;
  readonly projectRuntimeId: string;
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly accountingLineageId: string;
  readonly contractRevisionDigest: string;
  readonly requestFingerprint: string;
  readonly reservation: BoundedWorkReservation;
  readonly route: BoundedWorkRouteIdentity;
  readonly state: BoundedWorkReservationState;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dispatchId?: string;
  readonly reconciliationReason?: string;
  readonly terminalEvidenceDigest?: string;
  readonly terminalOutcome?: BoundedWorkTerminalOutcome;
}

export interface BoundedWorkReservationResult {
  readonly decision: BoundedWorkAdmissionDecision;
  readonly accounting: BoundedWorkAccountingSnapshot;
  readonly reservation?: BoundedWorkReservationReceipt;
}

export interface BoundedWorkAuthorityProjectionState {
  readonly accounting: BoundedWorkAccountingSnapshot;
  readonly decision?: BoundedWorkAdmissionDecision;
}

export interface SqliteBoundedWorkAuthorityOptions {
  readonly path: string;
  readonly now?: () => number;
  readonly idGenerator?: () => string;
}

type AccountRow = {
  project_runtime_id: string;
  accounting_lineage_id: string;
  contract_revision_digest: string;
  contract_revision_number: number;
  snapshot_json: string;
};

type AdmissionRow = {
  request_fingerprint: string;
  decision_json: string;
  accounting_json: string;
  reservation_id: string | null;
};

type ReservationRow = { receipt_json: string };

export class SqliteBoundedWorkAuthority {
  readonly #db: Database;
  readonly #now: () => number;
  readonly #idGenerator: () => string;
  #closed = false;

  constructor(options: SqliteBoundedWorkAuthorityOptions) {
    if (!options.path.trim()) throw new TypeError("Bounded-work authority database path is required.");
    this.#now = options.now ?? Date.now;
    this.#idGenerator = options.idGenerator ?? randomUUID;
    this.#db = new Database(options.path, { create: true, strict: true });
    try {
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
      this.#db.exec(`CREATE TABLE IF NOT EXISTS bounded_work_schema_metadata (
        component TEXT PRIMARY KEY,
        version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bounded_work_accounts (
        project_runtime_id TEXT NOT NULL,
        accounting_lineage_id TEXT NOT NULL,
        contract_revision_digest TEXT NOT NULL,
        contract_revision_number INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY(project_runtime_id, accounting_lineage_id)
      );
      CREATE TABLE IF NOT EXISTS bounded_work_reservations (
        reservation_id TEXT PRIMARY KEY,
        project_runtime_id TEXT NOT NULL,
        accounting_lineage_id TEXT NOT NULL,
        receipt_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS bounded_work_reservations_account
        ON bounded_work_reservations(project_runtime_id, accounting_lineage_id);
      CREATE TABLE IF NOT EXISTS bounded_work_admissions (
        project_runtime_id TEXT NOT NULL,
        accounting_lineage_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        decision_json TEXT NOT NULL,
        accounting_json TEXT NOT NULL,
        reservation_id TEXT,
        PRIMARY KEY(project_runtime_id, accounting_lineage_id, idempotency_key)
      );`);
      const existing = this.#db.query<{ version: number }, [string]>(
        "SELECT version FROM bounded_work_schema_metadata WHERE component=?",
      ).get("bounded-work-authority");
      if (existing && existing.version !== SQLITE_BOUNDED_WORK_AUTHORITY_SCHEMA_VERSION) {
        throw new Error(`Bounded-work authority schema version ${existing.version} is unsupported.`);
      }
      this.#db.query(
        "INSERT OR IGNORE INTO bounded_work_schema_metadata(component,version) VALUES(?,?)",
      ).run("bounded-work-authority", SQLITE_BOUNDED_WORK_AUTHORITY_SCHEMA_VERSION);
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  reserve(input: {
    readonly projectRuntimeId: string;
    readonly goalRunId: string;
    readonly workItemId: string;
    readonly contractRevision: BoundedWorkContractRevision;
    readonly idempotencyKey: string;
    readonly route: BoundedWorkRouteIdentity;
    readonly harnessCapability: BoundedWorkHarnessCapability;
    readonly scope?: Omit<AssessBoundedWorkScopeInput, "revision">;
    readonly reservation: BoundedWorkReservation;
  }): BoundedWorkReservationResult {
    this.#assertOpen();
    const revision = normalizeBoundedWorkContractRevision(input.contractRevision);
    const projectRuntimeId = requireIdentifier(input.projectRuntimeId, "projectRuntimeId");
    const goalRunId = requireIdentifier(input.goalRunId, "goalRunId");
    const workItemId = requireIdentifier(input.workItemId, "workItemId");
    if (input.scope && input.scope.workItemId !== workItemId) {
      throw new TypeError("Bounded-work scope attribution must match the reserved work item.");
    }
    if (!revision.contract.scope.allowedWorkItemIds.includes(workItemId)) {
      throw new TypeError(`Work item ${workItemId} is not bound to the bounded-work contract.`);
    }
    const accountingLineageId = requireIdentifier(revision.accountingLineageId, "accountingLineageId");
    if (accountingLineageId !== goalRunId) {
      throw new TypeError("Bounded-work accounting lineage must equal the owning goal run id.");
    }
    const idempotencyKey = requireIdentifier(input.idempotencyKey, "idempotencyKey");
    const route = normalizeRoute(input.route);
    const requestIdentity = {
      projectRuntimeId,
      goalRunId,
      workItemId,
      accountingLineageId,
      contractRevisionDigest: revision.revisionDigest,
      idempotencyKey,
      route,
      harnessCapability: input.harnessCapability,
      scope: input.scope,
      reservation: input.reservation,
    };
    const requestFingerprint = digest(requestIdentity);

    return this.#transaction(() => {
      const replay = this.#db.query<AdmissionRow, [string, string, string]>(`SELECT request_fingerprint,decision_json,accounting_json,reservation_id
        FROM bounded_work_admissions
        WHERE project_runtime_id=? AND accounting_lineage_id=? AND idempotency_key=?`).get(
        projectRuntimeId,
        accountingLineageId,
        idempotencyKey,
      );
      if (replay) {
        if (replay.request_fingerprint !== requestFingerprint) {
          throw new BoundedWorkAuthorityError("idempotency_conflict");
        }
        return {
          decision: JSON.parse(replay.decision_json) as BoundedWorkAdmissionDecision,
          accounting: parseSnapshot(replay.accounting_json),
          ...(replay.reservation_id ? { reservation: this.#requireReservation(replay.reservation_id) } : {}),
        };
      }

      let account = this.#account(projectRuntimeId, accountingLineageId);
      if (!account) {
        account = {
          project_runtime_id: projectRuntimeId,
          accounting_lineage_id: accountingLineageId,
          contract_revision_digest: revision.revisionDigest,
          contract_revision_number: revision.revision,
          snapshot_json: JSON.stringify(emptySnapshot(revision)),
        };
        this.#db.query(`INSERT INTO bounded_work_accounts(
          project_runtime_id,accounting_lineage_id,contract_revision_digest,contract_revision_number,snapshot_json
        ) VALUES(?,?,?,?,?)`).run(
          projectRuntimeId,
          accountingLineageId,
          revision.revisionDigest,
          revision.revision,
          account.snapshot_json,
        );
      } else if (account.contract_revision_digest !== revision.revisionDigest) {
        if (
          revision.parentRevisionDigest !== account.contract_revision_digest
          || revision.revision !== account.contract_revision_number + 1
        ) {
          throw new BoundedWorkAuthorityError("stale_contract_revision");
        }
        const rebound = {
          ...parseSnapshot(account.snapshot_json),
          contractRevisionDigest: revision.revisionDigest,
        };
        const changed = this.#db.query(`UPDATE bounded_work_accounts
          SET contract_revision_digest=?,contract_revision_number=?,snapshot_json=?
          WHERE project_runtime_id=? AND accounting_lineage_id=? AND contract_revision_digest=?`).run(
          revision.revisionDigest,
          revision.revision,
          JSON.stringify(rebound),
          projectRuntimeId,
          accountingLineageId,
          account.contract_revision_digest,
        );
        if (changed.changes !== 1) throw new BoundedWorkAuthorityError("accounting_conflict");
        account = { ...account, contract_revision_digest: revision.revisionDigest, contract_revision_number: revision.revision, snapshot_json: JSON.stringify(rebound) };
      }

      const snapshot = parseSnapshot(account.snapshot_json);
      const decision = decideBoundedWorkAdmission({
        revision,
        snapshot,
        harnessCapability: input.harnessCapability,
        scope: input.scope,
        reservation: input.reservation,
      });
      let receipt: BoundedWorkReservationReceipt | undefined;
      let accounting = snapshot;
      if (decision.kind === "admitted") {
        const updated = applyReservation(snapshot, decision.reserved);
        this.#writeSnapshot(projectRuntimeId, snapshot, updated);
        accounting = updated;
        const now = iso(this.#now());
        receipt = {
          reservationId: `bounded-work-reservation:${requireIdentifier(this.#idGenerator(), "reservationId")}`,
          projectRuntimeId,
          goalRunId,
          workItemId,
          accountingLineageId,
          contractRevisionDigest: revision.revisionDigest,
          requestFingerprint,
          reservation: input.reservation,
          route,
          state: "reserved",
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        this.#db.query(`INSERT INTO bounded_work_reservations(
          reservation_id,project_runtime_id,accounting_lineage_id,receipt_json
        ) VALUES(?,?,?,?)`).run(
          receipt.reservationId,
          projectRuntimeId,
          accountingLineageId,
          JSON.stringify(receipt),
        );
      }
      this.#db.query(`INSERT INTO bounded_work_admissions(
        project_runtime_id,accounting_lineage_id,idempotency_key,request_fingerprint,decision_json,accounting_json,reservation_id
      ) VALUES(?,?,?,?,?,?,?)`).run(
        projectRuntimeId,
        accountingLineageId,
        idempotencyKey,
        requestFingerprint,
        JSON.stringify(decision),
        JSON.stringify(accounting),
        receipt?.reservationId ?? null,
      );
      return { decision, accounting, ...(receipt ? { reservation: receipt } : {}) };
    });
  }

  inspect(input: {
    readonly projectRuntimeId: string;
    readonly accountingLineageId: string;
  }): BoundedWorkAccountingSnapshot | undefined {
    this.#assertOpen();
    const row = this.#account(
      requireIdentifier(input.projectRuntimeId, "projectRuntimeId"),
      requireIdentifier(input.accountingLineageId, "accountingLineageId"),
    );
    return row ? parseSnapshot(row.snapshot_json) : undefined;
  }

  inspectProjection(input: {
    readonly projectRuntimeId: string;
    readonly accountingLineageId: string;
  }): BoundedWorkAuthorityProjectionState | undefined {
    const accounting = this.inspect(input);
    if (!accounting) return undefined;
    const latest = this.#db.query<{ decision_json: string }, [string, string]>(`SELECT decision_json
      FROM bounded_work_admissions
      WHERE project_runtime_id=? AND accounting_lineage_id=?
      ORDER BY rowid DESC LIMIT 1`).get(input.projectRuntimeId, input.accountingLineageId);
    return {
      accounting,
      ...(latest ? { decision: JSON.parse(latest.decision_json) as BoundedWorkAdmissionDecision } : {}),
    };
  }

  markDispatched(input: {
    readonly reservationId: string;
    readonly expectedReservationRevision: number;
    readonly dispatchId: string;
  }): BoundedWorkReservationReceipt {
    return this.#transition(input.reservationId, (current) => {
      const dispatchId = requireIdentifier(input.dispatchId, "dispatchId");
      if (current.state === "dispatched" && current.dispatchId === dispatchId) return current;
      assertReservationRevision(current, input.expectedReservationRevision);
      if (current.state !== "reserved") throw new BoundedWorkAuthorityError("reservation_state_conflict");
      return { ...current, state: "dispatched", dispatchId, revision: current.revision + 1, updatedAt: iso(this.#now()) };
    });
  }

  releaseBeforeDispatch(input: {
    readonly reservationId: string;
    readonly expectedReservationRevision: number;
  }): BoundedWorkReservationReceipt {
    return this.#transition(input.reservationId, (current) => {
      if (current.state === "released") return current;
      assertReservationRevision(current, input.expectedReservationRevision);
      if (current.state !== "reserved") throw new BoundedWorkAuthorityError("reservation_state_conflict");
      const account = this.#requireAccount(current.projectRuntimeId, current.accountingLineageId);
      const snapshot = parseSnapshot(account.snapshot_json);
      this.#writeSnapshot(current.projectRuntimeId, snapshot, reverseReservation(snapshot, current.reservation));
      return { ...current, state: "released", revision: current.revision + 1, updatedAt: iso(this.#now()) };
    });
  }

  settleUnknown(input: {
    readonly reservationId: string;
    readonly expectedReservationRevision: number;
    readonly reason: string;
  }): BoundedWorkReservationReceipt {
    return this.#transition(input.reservationId, (current) => {
      const reason = requireText(input.reason, "reason");
      if (current.state === "reconciliation_required" && current.reconciliationReason === reason) return current;
      assertReservationRevision(current, input.expectedReservationRevision);
      if (current.state !== "dispatched") throw new BoundedWorkAuthorityError("reservation_state_conflict");
      return {
        ...current,
        state: "reconciliation_required",
        reconciliationReason: reason,
        revision: current.revision + 1,
        updatedAt: iso(this.#now()),
      };
    });
  }

  reconcileTerminal(input: {
    readonly reservationId: string;
    readonly expectedReservationRevision: number;
    readonly terminalEvidenceDigest: string;
    readonly terminalOutcome: BoundedWorkTerminalOutcome;
  }): BoundedWorkReservationReceipt {
    return this.#settleTerminal(input, "reconciliation_required");
  }

  settleTerminal(input: {
    readonly reservationId: string;
    readonly expectedReservationRevision: number;
    readonly terminalEvidenceDigest: string;
    readonly terminalOutcome: BoundedWorkTerminalOutcome;
  }): BoundedWorkReservationReceipt {
    return this.#settleTerminal(input, "dispatched");
  }

  #settleTerminal(input: {
    readonly reservationId: string;
    readonly expectedReservationRevision: number;
    readonly terminalEvidenceDigest: string;
    readonly terminalOutcome: BoundedWorkTerminalOutcome;
  }, requiredState: "dispatched" | "reconciliation_required"): BoundedWorkReservationReceipt {
    return this.#transition(input.reservationId, (current) => {
      const terminalEvidenceDigest = requireDigest(input.terminalEvidenceDigest, "terminalEvidenceDigest");
      const terminalOutcome = requireTerminalOutcome(input.terminalOutcome);
      if (
        current.state === "settled"
        && current.terminalEvidenceDigest === terminalEvidenceDigest
        && current.terminalOutcome === terminalOutcome
      ) return current;
      assertReservationRevision(current, input.expectedReservationRevision);
      if (current.state !== requiredState) {
        throw new BoundedWorkAuthorityError("reservation_state_conflict");
      }
      if (current.reservation.kind === "managed_invocation") {
        const account = this.#requireAccount(current.projectRuntimeId, current.accountingLineageId);
        const snapshot = parseSnapshot(account.snapshot_json);
        this.#writeSnapshot(current.projectRuntimeId, snapshot, {
          ...snapshot,
          revision: snapshot.revision + 1,
          activeManagedInvocations: checkedSubtract(snapshot.activeManagedInvocations, current.reservation.amount),
        });
      }
      return {
        ...current,
        state: "settled",
        terminalEvidenceDigest,
        terminalOutcome,
        revision: current.revision + 1,
        updatedAt: iso(this.#now()),
      };
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  #transition(
    reservationId: string,
    operation: (current: BoundedWorkReservationReceipt) => BoundedWorkReservationReceipt,
  ): BoundedWorkReservationReceipt {
    this.#assertOpen();
    return this.#transaction(() => {
      const current = this.#requireReservation(reservationId);
      const updated = operation(current);
      if (updated === current) return current;
      const changed = this.#db.query(`UPDATE bounded_work_reservations SET receipt_json=?
        WHERE reservation_id=? AND receipt_json=?`).run(
        JSON.stringify(updated),
        current.reservationId,
        JSON.stringify(current),
      );
      if (changed.changes !== 1) throw new BoundedWorkAuthorityError("reservation_revision_conflict");
      return updated;
    });
  }

  #writeSnapshot(
    projectRuntimeId: string,
    previous: BoundedWorkAccountingSnapshot,
    updated: BoundedWorkAccountingSnapshot,
  ): void {
    const changed = this.#db.query(`UPDATE bounded_work_accounts SET snapshot_json=?
      WHERE project_runtime_id=? AND accounting_lineage_id=? AND contract_revision_digest=? AND snapshot_json=?`).run(
      JSON.stringify(updated),
      projectRuntimeId,
      previous.accountingLineageId,
      previous.contractRevisionDigest,
      JSON.stringify(previous),
    );
    if (changed.changes !== 1) throw new BoundedWorkAuthorityError("accounting_conflict");
  }

  #account(projectRuntimeId: string, accountingLineageId: string): AccountRow | undefined {
    return this.#db.query<AccountRow, [string, string]>(`SELECT project_runtime_id,accounting_lineage_id,
      contract_revision_digest,contract_revision_number,snapshot_json FROM bounded_work_accounts
      WHERE project_runtime_id=? AND accounting_lineage_id=?`).get(projectRuntimeId, accountingLineageId) ?? undefined;
  }

  #requireAccount(projectRuntimeId: string, accountingLineageId: string): AccountRow {
    const account = this.#account(projectRuntimeId, accountingLineageId);
    if (!account) throw new BoundedWorkAuthorityError("accounting_conflict");
    return account;
  }

  #requireReservation(reservationId: string): BoundedWorkReservationReceipt {
    const normalized = requireReservationId(reservationId);
    const row = this.#db.query<ReservationRow, [string]>(
      "SELECT receipt_json FROM bounded_work_reservations WHERE reservation_id=?",
    ).get(normalized);
    if (!row) throw new BoundedWorkAuthorityError("reservation_not_found");
    return JSON.parse(row.receipt_json) as BoundedWorkReservationReceipt;
  }

  #transaction<T>(operation: () => T): T {
    return this.#db.transaction(operation).immediate();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Bounded-work authority is closed.");
  }
}

function emptySnapshot(revision: BoundedWorkContractRevision): BoundedWorkAccountingSnapshot {
  return {
    schema: "kiln.bounded-work-accounting/v1",
    accountingLineageId: revision.accountingLineageId,
    contractRevisionDigest: revision.revisionDigest,
    revision: 0,
    executionAttempts: 0,
    managedInvocations: 0,
    activeManagedInvocations: 0,
    reviewRounds: 0,
    remediationRounds: 0,
    toolCalls: { kind: "unavailable" },
    activeDurationMs: { kind: "unavailable" },
  };
}

function applyReservation(
  snapshot: BoundedWorkAccountingSnapshot,
  reserved: Extract<BoundedWorkAdmissionDecision, { kind: "admitted" }>["reserved"],
): BoundedWorkAccountingSnapshot {
  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    executionAttempts: snapshot.executionAttempts + (reserved.executionAttempts ?? 0),
    managedInvocations: snapshot.managedInvocations + (reserved.managedInvocations ?? 0),
    activeManagedInvocations: snapshot.activeManagedInvocations + (reserved.activeManagedInvocations ?? 0),
    reviewRounds: snapshot.reviewRounds + (reserved.reviewRounds ?? 0),
    remediationRounds: snapshot.remediationRounds + (reserved.remediationRounds ?? 0),
    toolCalls: addMeasured(snapshot.toolCalls, reserved.toolCalls ?? 0),
    activeDurationMs: addMeasured(snapshot.activeDurationMs, reserved.activeDurationMs ?? 0),
  };
}

function reverseReservation(
  snapshot: BoundedWorkAccountingSnapshot,
  reservation: BoundedWorkReservation,
): BoundedWorkAccountingSnapshot {
  const result = { ...snapshot, revision: snapshot.revision + 1 };
  switch (reservation.kind) {
    case "execution_attempt": return { ...result, executionAttempts: checkedSubtract(snapshot.executionAttempts, reservation.amount) };
    case "managed_invocation": return {
      ...result,
      managedInvocations: checkedSubtract(snapshot.managedInvocations, reservation.amount),
      activeManagedInvocations: checkedSubtract(snapshot.activeManagedInvocations, reservation.amount),
    };
    case "review_round": return { ...result, reviewRounds: checkedSubtract(snapshot.reviewRounds, reservation.amount) };
    case "remediation_round": return { ...result, remediationRounds: checkedSubtract(snapshot.remediationRounds, reservation.amount) };
    case "tool_call": return { ...result, toolCalls: subtractMeasured(snapshot.toolCalls, reservation.amount) };
    case "active_duration": return { ...result, activeDurationMs: subtractMeasured(snapshot.activeDurationMs, reservation.amount) };
  }
}

function addMeasured(value: BoundedWorkAccountingSnapshot["toolCalls"], amount: number) {
  return value.kind === "observed" ? { kind: "observed" as const, value: value.value + amount } : value;
}

function subtractMeasured(value: BoundedWorkAccountingSnapshot["toolCalls"], amount: number) {
  return value.kind === "observed"
    ? { kind: "observed" as const, value: checkedSubtract(value.value, amount) }
    : value;
}

function checkedSubtract(value: number, amount: number): number {
  const result = value - amount;
  if (!Number.isSafeInteger(result) || result < 0) throw new BoundedWorkAuthorityError("accounting_conflict");
  return result;
}

function parseSnapshot(value: string): BoundedWorkAccountingSnapshot {
  return normalizeBoundedWorkAccountingSnapshot(JSON.parse(value) as BoundedWorkAccountingSnapshot);
}

function normalizeRoute(route: BoundedWorkRouteIdentity): BoundedWorkRouteIdentity {
  return {
    routeId: requireIdentifier(route.routeId, "route.routeId"),
    harnessId: requireIdentifier(route.harnessId, "route.harnessId"),
  };
}

function assertReservationRevision(current: BoundedWorkReservationReceipt, expected: number): void {
  if (current.revision !== expected) throw new BoundedWorkAuthorityError("reservation_revision_conflict");
}

function requireReservationId(value: string): string {
  if (!value.startsWith("bounded-work-reservation:")) throw new BoundedWorkAuthorityError("reservation_not_found");
  requireIdentifier(value.slice("bounded-work-reservation:".length), "reservationId");
  return value;
}

function requireIdentifier(value: string, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value)) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function requireText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function requireDigest(value: string, field: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${field} is invalid`);
  return value;
}

function requireTerminalOutcome(value: BoundedWorkTerminalOutcome): BoundedWorkTerminalOutcome {
  if (value !== "completed" && value !== "failed" && value !== "cancelled") {
    throw new TypeError("terminalOutcome is invalid");
  }
  return value;
}

function iso(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Bounded-work authority clock is invalid.");
  return new Date(value).toISOString();
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
