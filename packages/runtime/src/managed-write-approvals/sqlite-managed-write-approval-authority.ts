import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import type {
  ManagedWriteApprovalBinding,
  ManagedWriteApprovalReceipt,
  ManagedWriteApprovalState,
} from "./contracts.js";

export type { ManagedWriteApprovalBinding, ManagedWriteApprovalReceipt, ManagedWriteApprovalState } from "./contracts.js";

export const SQLITE_MANAGED_WRITE_APPROVAL_SCHEMA_VERSION = 2 as const;

export type ManagedWriteApprovalErrorCode =
  | "approval_not_found"
  | "approval_expired"
  | "approval_revoked"
  | "approval_replayed"
  | "approval_binding_mismatch";


export interface SqliteManagedWriteApprovalAuthorityOptions {
  readonly path: string;
  readonly now?: () => number;
  readonly idGenerator?: () => string;
}

export class ManagedWriteApprovalError extends Error {
  constructor(readonly code: ManagedWriteApprovalErrorCode) {
    super(code);
    this.name = "ManagedWriteApprovalError";
  }
}

type ApprovalRow = {
  approval_id: string;
  state: ManagedWriteApprovalState;
  binding_json: string;
  issued_at: string;
  expires_at: string;
  approver_id: string;
  revoked_at: string | null;
  consumed_at: string | null;
  consumed_by: string | null;
};

export class SqliteManagedWriteApprovalAuthority {
  readonly #db: Database;
  readonly #now: () => number;
  readonly #idGenerator: () => string;
  #closed = false;

  constructor(options: SqliteManagedWriteApprovalAuthorityOptions) {
    if (!options.path.trim()) throw new TypeError("Managed write approval database path is required.");
    this.#now = options.now ?? Date.now;
    this.#idGenerator = options.idGenerator ?? randomUUID;
    this.#db = new Database(options.path, { create: true, strict: true });
    try {
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
      const version = Number(this.#db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0);
      if (version !== 0 && version !== SQLITE_MANAGED_WRITE_APPROVAL_SCHEMA_VERSION) {
        throw new Error(`Managed write approval schema version ${version} is unsupported.`);
      }
      this.#db.exec(`CREATE TABLE IF NOT EXISTS managed_write_approvals (
        approval_id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK(state IN ('issued','revoked','consumed')),
        binding_json TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        approver_id TEXT NOT NULL,
        revoked_at TEXT,
        consumed_at TEXT,
        consumed_by TEXT
      );
      CREATE INDEX IF NOT EXISTS managed_write_approvals_project ON managed_write_approvals(approval_id, state);
      PRAGMA user_version=${SQLITE_MANAGED_WRITE_APPROVAL_SCHEMA_VERSION};`);
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  issue(input: {
    readonly binding: ManagedWriteApprovalBinding;
    readonly approverId: string;
    readonly expiresAt: string;
  }): ManagedWriteApprovalReceipt {
    this.#assertOpen();
    const binding = normalizeBinding(input.binding);
    const approverId = requireIdentifier(input.approverId, "Managed write approval approver id is invalid.");
    const expiresAt = requireFutureIso(input.expiresAt, this.#now(), "Managed write approval expiry is invalid.");
    const approvalId = `managed-write-approval:${requireIdentifier(this.#idGenerator(), "Managed write approval id is invalid.")}`;
    const issuedAt = iso(this.#now());
    this.#db.query(`INSERT INTO managed_write_approvals(
      approval_id,state,binding_json,issued_at,expires_at,approver_id,revoked_at,consumed_at,consumed_by
    ) VALUES(?,?,?,?,?,?,NULL,NULL,NULL)`).run(
      approvalId, "issued", JSON.stringify(binding), issuedAt, expiresAt, approverId,
    );
    return { approvalId, state: "issued", binding, issuedAt, expiresAt, approverId };
  }

  inspect(approvalId: string): ManagedWriteApprovalReceipt | undefined {
    this.#assertOpen();
    const row = this.#row(approvalId);
    return row ? receipt(row) : undefined;
  }

  revoke(input: { readonly approvalId: string; readonly projectId: string }): ManagedWriteApprovalReceipt {
    this.#assertOpen();
    const approvalId = requireApprovalId(input.approvalId);
    const projectId = requireIdentifier(input.projectId, "Managed write approval project id is invalid.");
    const row = this.#requireRow(approvalId);
    const current = receipt(row);
    if (current.binding.projectId !== projectId) throw new ManagedWriteApprovalError("approval_binding_mismatch");
    if (current.state === "consumed") throw new ManagedWriteApprovalError("approval_replayed");
    if (current.state === "revoked") return current;
    const revokedAt = iso(this.#now());
    this.#db.query("UPDATE managed_write_approvals SET state='revoked',revoked_at=? WHERE approval_id=? AND state='issued'")
      .run(revokedAt, approvalId);
    return this.#requireReceipt(approvalId);
  }

  consume(input: {
    readonly approvalId: string;
    readonly binding: ManagedWriteApprovalBinding;
    readonly consumerId: string;
  }): ManagedWriteApprovalReceipt {
    this.#assertOpen();
    const approvalId = requireApprovalId(input.approvalId);
    const binding = normalizeBinding(input.binding);
    const consumerId = requireIdentifier(input.consumerId, "Managed write approval consumer id is invalid.");
    const row = this.#requireRow(approvalId);
    const current = receipt(row);
    if (!sameBinding(current.binding, binding)) throw new ManagedWriteApprovalError("approval_binding_mismatch");
    if (current.state === "revoked") throw new ManagedWriteApprovalError("approval_revoked");
    if (Date.parse(current.expiresAt) <= this.#now()) throw new ManagedWriteApprovalError("approval_expired");
    if (current.state === "consumed") {
      if (current.consumedBy === consumerId) return current;
      throw new ManagedWriteApprovalError("approval_replayed");
    }
    const consumedAt = iso(this.#now());
    const changed = this.#db.query(`UPDATE managed_write_approvals
      SET state='consumed',consumed_at=?,consumed_by=?
      WHERE approval_id=? AND state='issued' AND binding_json=? AND expires_at>?`).run(
      consumedAt, consumerId, approvalId, JSON.stringify(binding), iso(this.#now()),
    );
    if (changed.changes === 1) return this.#requireReceipt(approvalId);
    const observed = this.#requireReceipt(approvalId);
    if (!sameBinding(observed.binding, binding)) throw new ManagedWriteApprovalError("approval_binding_mismatch");
    if (observed.state === "revoked") throw new ManagedWriteApprovalError("approval_revoked");
    if (Date.parse(observed.expiresAt) <= this.#now()) throw new ManagedWriteApprovalError("approval_expired");
    if (observed.state === "consumed" && observed.consumedBy === consumerId) return observed;
    throw new ManagedWriteApprovalError("approval_replayed");
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  #row(approvalId: string): ApprovalRow | undefined {
    return this.#db.query<ApprovalRow, [string]>(`SELECT approval_id,state,binding_json,issued_at,expires_at,approver_id,revoked_at,consumed_at,consumed_by
      FROM managed_write_approvals WHERE approval_id=?`).get(requireApprovalId(approvalId)) ?? undefined;
  }

  #requireRow(approvalId: string): ApprovalRow {
    const row = this.#row(approvalId);
    if (!row) throw new ManagedWriteApprovalError("approval_not_found");
    return row;
  }

  #requireReceipt(approvalId: string): ManagedWriteApprovalReceipt {
    return receipt(this.#requireRow(approvalId));
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Managed write approval authority is closed.");
  }
}

function receipt(row: ApprovalRow): ManagedWriteApprovalReceipt {
  const binding = normalizeBinding(JSON.parse(row.binding_json) as ManagedWriteApprovalBinding);
  return {
    approvalId: requireApprovalId(row.approval_id), state: row.state, binding,
    issuedAt: requireIso(row.issued_at, "Managed write approval issued time is corrupt."),
    expiresAt: requireIso(row.expires_at, "Managed write approval expiry is corrupt."),
    approverId: requireIdentifier(row.approver_id, "Managed write approval approver id is corrupt."),
    ...(row.revoked_at ? { revokedAt: requireIso(row.revoked_at, "Managed write approval revocation time is corrupt.") } : {}),
    ...(row.consumed_at ? { consumedAt: requireIso(row.consumed_at, "Managed write approval consumption time is corrupt.") } : {}),
    ...(row.consumed_by ? { consumedBy: requireIdentifier(row.consumed_by, "Managed write approval consumer id is corrupt.") } : {}),
  };
}

function normalizeBinding(value: ManagedWriteApprovalBinding): ManagedWriteApprovalBinding {
  return {
    projectId: requireIdentifier(value.projectId, "Managed write approval project id is invalid."),
    jobId: requireIdentifier(value.jobId, "Managed write approval job id is invalid."),
    callerId: requireIdentifier(value.callerId, "Managed write approval caller id is invalid."),
    workItemFingerprint: requireDigest(value.workItemFingerprint),
    configuredAgentProfileId: requireIdentifier(value.configuredAgentProfileId, "Managed write approval agent profile id is invalid."),
    access: requireApprovedAccess(value.access),
    routeId: requireIdentifier(value.routeId, "Managed write approval route id is invalid."),
    providerId: requireIdentifier(value.providerId, "Managed write approval provider id is invalid."),
    model: requireOpaque(value.model, "Managed write approval model is invalid."),
    adapterCapabilityId: requireIdentifier(value.adapterCapabilityId, "Managed write approval adapter capability id is invalid."),
    adapterCapabilityVersion: requireIdentifier(value.adapterCapabilityVersion, "Managed write approval adapter capability version is invalid."),
    authorityDigest: requireDigest(value.authorityDigest),
    effectDigest: requireDigest(value.effectDigest),
    revisionDigest: requireDigest(value.revisionDigest),
  };
}

function sameBinding(left: ManagedWriteApprovalBinding, right: ManagedWriteApprovalBinding): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function requireApprovalId(value: string): string {
  if (!value.startsWith("managed-write-approval:")) throw new ManagedWriteApprovalError("approval_not_found");
  return `managed-write-approval:${requireIdentifier(value.slice("managed-write-approval:".length), "Managed write approval id is invalid.")}`;
}
function requireApprovedAccess(value: string): "approved-write" {
  if (value !== "approved-write") throw new TypeError("Managed write approval must use approved-write.");
  return value;
}
function requireIdentifier(value: string, message: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value)) throw new TypeError(message);
  return value;
}
function requireOpaque(value: string, message: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 300 || value.trim() !== value || /[\u0000-\u001F\u007F]/u.test(value)) throw new TypeError(message);
  return value;
}
function requireDigest(value: string): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) throw new TypeError("Managed write approval digest is invalid.");
  return value;
}
function requireIso(value: string, message: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(message);
  return value;
}
function requireFutureIso(value: string, now: number, message: string): string {
  const normalized = requireIso(value, message);
  if (Date.parse(normalized) <= now) throw new TypeError(message);
  return normalized;
}
function iso(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Managed write approval clock is invalid.");
  return new Date(value).toISOString();
}
