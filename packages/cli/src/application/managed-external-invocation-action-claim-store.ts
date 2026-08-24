import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { ManagedAgentRuntimeInvocationInput } from "@kilnai/runtime";
import { assertPrivateStateFileTargetSync } from "./private-project-state-filesystem.js";
import { SqliteActionClaimStoreOwner } from "./sqlite-action-claim-store-owner.js";

type ExternalClaimContext = NonNullable<ManagedAgentRuntimeInvocationInput["externalActionClaim"]>;
type ExternalClaimStore = ExternalClaimContext["store"];
type ExternalClaim = Parameters<ExternalClaimStore["claim"]>[0];
type ExternalClaimPermit = ReturnType<ExternalClaimStore["claim"]>;
type ExternalClaimSettlement = Parameters<ExternalClaimStore["settle"]>[1];

const CANONICAL_SHA256_ID = /^sha256:[a-f0-9]{64}$/u;

export interface ManagedExternalInvocationActionClaimStoreOptions {
  readonly path: string;
  /** Canonical project-private root when this store is project-owned. */
  readonly privateStateRoot?: string;
  readonly now?: () => string;
  readonly idGenerator?: () => string;
  readonly ownerId?: string;
  readonly ownerStaleMs?: number;
}

export type ManagedExternalInvocationActionClaimRecord = ExternalClaim & {
  readonly status: "claimed" | "settled" | "unknown" | "interrupted";
  readonly settledAt?: string;
  readonly outcome?: "success" | "unknown" | "interrupted";
  readonly reason?: string;
};

type ClaimRow = {
  claim_id: string;
  admission_id: string;
  session_id: string;
  turn_id: string;
  invocation_id: string;
  attempt_id: string;
  round: number;
  owner_generation: string;
  route_ack: string;
  intent_fingerprint: string;
  effect_identity: string;
  effect_kind: ExternalClaim["effectKind"];
  status: ManagedExternalInvocationActionClaimRecord["status"];
  permit_id: string;
  claimed_at: string;
  settled_at: string | null;
  outcome: ManagedExternalInvocationActionClaimRecord["outcome"] | null;
  reason: string | null;
};

/**
 * Durable owner for external managed CLI and remote-harness effects.  It is
 * intentionally separate from account capacity and invocation recovery: a
 * lease or recovery checkpoint never proves that an external effect ran.
 */
export class SqliteManagedExternalInvocationActionClaimStore implements ExternalClaimStore {
  readonly #db: Database;
  readonly #owner: SqliteActionClaimStoreOwner;
  readonly #now: () => string;
  readonly #idGenerator: () => string;
  readonly #permits = new Map<ExternalClaimPermit, { readonly claimId: string; consumed: boolean }>();
  #closed = false;

  constructor(options: ManagedExternalInvocationActionClaimStoreOptions) {
    if (!options.path.trim()) throw new TypeError("Managed external action claim database path is required.");
    const assertWritablePath = options.privateStateRoot === undefined
      ? undefined
      : () => assertPrivateStateFileTargetSync(options.privateStateRoot!, options.path);
    assertWritablePath?.();
    mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idGenerator = options.idGenerator ?? randomUUID;
    this.#db = new Database(options.path, { create: true, strict: true });
    this.#owner = new SqliteActionClaimStoreOwner({
      database: this.#db,
      storeName: "Managed external invocation action-claim",
      now: this.#now,
      ...(assertWritablePath ? { assertWritablePath } : {}),
      ...(options.ownerId !== undefined ? { ownerId: options.ownerId } : {}),
      ...(options.ownerStaleMs !== undefined ? { ownerStaleMs: options.ownerStaleMs } : {}),
    });
    try {
      assertWritablePath?.();
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS managed_external_invocation_action_claims (
          claim_id TEXT PRIMARY KEY,
          admission_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          invocation_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          round INTEGER NOT NULL CHECK(round = 0),
          owner_generation TEXT NOT NULL,
          route_ack TEXT NOT NULL,
          intent_fingerprint TEXT NOT NULL,
          effect_identity TEXT NOT NULL,
          effect_kind TEXT NOT NULL CHECK(effect_kind IN ('cli-run','remote-invoke','remote-cancel')),
          status TEXT NOT NULL CHECK(status IN ('claimed','settled','unknown','interrupted')),
          permit_id TEXT NOT NULL UNIQUE,
          claimed_at TEXT NOT NULL,
          settled_at TEXT,
          outcome TEXT CHECK(outcome IS NULL OR outcome IN ('success','unknown','interrupted')),
          reason TEXT,
          UNIQUE(admission_id, attempt_id, round, effect_kind)
        );
        CREATE INDEX IF NOT EXISTS managed_external_invocation_action_claims_permit
          ON managed_external_invocation_action_claims(permit_id);
      `);
      this.#owner.claimAndRunStartupRecovery(() => {
        this.#db.query(`
          UPDATE managed_external_invocation_action_claims
          SET status='unknown', settled_at=?, outcome='unknown', reason=?
          WHERE status='claimed'
        `).run(this.#now(), "process-restarted-before-settlement");
      });
    } catch (error) {
      this.#owner.close();
      this.#db.close();
      throw error;
    }
  }

  claim(input: ExternalClaim): ExternalClaimPermit {
    this.#assertOpen();
    assertClaim(input);
    return this.#transaction(() => {
      const existing = this.#db.query<ClaimRow, [string, string, number, string]>(`
        SELECT claim_id,admission_id,session_id,turn_id,invocation_id,attempt_id,round,
          owner_generation,route_ack,intent_fingerprint,effect_identity,effect_kind,status,
          permit_id,claimed_at,settled_at,outcome,reason
        FROM managed_external_invocation_action_claims
        WHERE admission_id=? AND attempt_id=? AND round=? AND effect_kind=?
      `).get(input.admissionId, input.attemptId, input.round, input.effectKind);
      if (existing) {
        const mismatches = claimIdentityMismatches(existing, input);
        if (mismatches.length > 0) {
          throw new Error(`Managed external action claim slot is already bound; immutable identity mismatch: ${mismatches.join(", ")}.`);
        }
        throw new Error(`Managed external action claim already exists with status '${existing.status}'.`);
      }

      const permitId = `managed-external:${this.#idGenerator()}`;
      this.#db.query(`
        INSERT INTO managed_external_invocation_action_claims(
          claim_id,admission_id,session_id,turn_id,invocation_id,attempt_id,round,
          owner_generation,route_ack,intent_fingerprint,effect_identity,effect_kind,status,
          permit_id,claimed_at,settled_at,outcome,reason
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'claimed',?,?,NULL,NULL,NULL)
      `).run(
        input.claimId,
        input.admissionId,
        input.sessionId,
        input.turnId,
        input.invocationId,
        input.attemptId,
        input.round,
        input.ownerGeneration,
        input.routeAck,
        input.intentFingerprint,
        input.effectIdentity,
        input.effectKind,
        permitId,
        input.claimedAt ?? this.#now(),
      );
      let permit!: ExternalClaimPermit;
      permit = {
        permitId,
        claimId: input.claimId,
        consume: () => {
          this.#assertOpen();
          this.#owner.assertOwned();
          const state = this.#permits.get(permit);
          if (!state || state.claimId !== input.claimId) throw new Error("Unknown managed external action permit.");
          if (state.consumed) throw new Error("Managed external action permit has already been consumed.");
          state.consumed = true;
        },
      } as ExternalClaimPermit;
      this.#permits.set(permit, { claimId: input.claimId, consumed: false });
      return permit;
    });
  }

  settle(permit: ExternalClaimPermit, settlement: ExternalClaimSettlement): void {
    this.#assertOpen();
    if (!permit || typeof permit !== "object") {
      throw new Error("Invalid managed external action claim permit.");
    }
    const state = this.#permits.get(permit);
    if (!state || state.claimId !== permit.claimId || !state.consumed) {
      throw new Error("Managed external action permit must be consumed exactly at the effect boundary.");
    }
    this.#transaction(() => {
      const row = this.#db.query<Pick<ClaimRow, "claim_id" | "status">, [string]>(`
        SELECT claim_id,status FROM managed_external_invocation_action_claims WHERE permit_id=?
      `).get(permit.permitId);
      if (!row || row.claim_id !== permit.claimId) throw new Error("Unknown managed external action claim permit.");
      if (row.status !== "claimed") throw new Error(`Managed external action claim permit is already consumed (${row.status}).`);
      const settledAt = settlement.settledAt ?? this.#now();
      if (settlement.kind === "success") {
        this.#db.query(`
          UPDATE managed_external_invocation_action_claims
          SET status='settled',settled_at=?,outcome='success',reason=NULL
          WHERE permit_id=? AND claim_id=? AND status='claimed'
        `).run(settledAt, permit.permitId, permit.claimId);
      } else {
        if (!settlement.reason.trim()) throw new TypeError("Managed external unknown settlement requires a reason.");
        this.#db.query(`
          UPDATE managed_external_invocation_action_claims
          SET status=?,settled_at=?,outcome=?,reason=?
          WHERE permit_id=? AND claim_id=? AND status='claimed'
        `).run(settlement.kind, settledAt, settlement.kind, settlement.reason, permit.permitId, permit.claimId);
      }
    });
    this.#permits.delete(permit);
  }

  read(claimId: string): ManagedExternalInvocationActionClaimRecord | undefined {
    this.#assertOpen();
    const row = this.#db.query<ClaimRow, [string]>(`
      SELECT claim_id,admission_id,session_id,turn_id,invocation_id,attempt_id,round,
        owner_generation,route_ack,intent_fingerprint,effect_identity,effect_kind,status,
        permit_id,claimed_at,settled_at,outcome,reason
      FROM managed_external_invocation_action_claims WHERE claim_id=?
    `).get(claimId);
    return row ? toRecord(row) : undefined;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#owner.close();
    } finally {
      this.#db.close();
    }
  }

  #transaction<T>(operation: () => T): T {
    return this.#owner.runOwned(operation);
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Managed external action claim store is closed.");
  }
}

function assertClaim(input: ExternalClaim): void {
  for (const [label, value] of [
    ["claimId", input.claimId],
    ["admissionId", input.admissionId],
    ["intentFingerprint", input.intentFingerprint],
    ["effectIdentity", input.effectIdentity],
  ] as const) {
    if (typeof value !== "string" || !CANONICAL_SHA256_ID.test(value)) {
      throw new TypeError(`${label} must be a canonical sha256:<64 lowercase hex> id.`);
    }
  }
  for (const [label, value] of [
    ["sessionId", input.sessionId],
    ["turnId", input.turnId],
    ["invocationId", input.invocationId],
    ["attemptId", input.attemptId],
    ["ownerGeneration", input.ownerGeneration],
    ["routeAck", input.routeAck],
  ] as const) {
    if (!value.trim()) throw new TypeError(`${label} is required.`);
  }
  if (input.round !== 0 || input.status !== "claimed") throw new TypeError("A new managed external action claim must be round zero and claimed.");
  if (input.claimId !== claimIdFor(input)) throw new TypeError("claimId must be the canonical digest of the immutable external action identity.");
}

function claimIdentityMismatches(existing: ClaimRow, input: ExternalClaim): readonly string[] {
  const comparisons: readonly [string, string | number, string | number][] = [
    ["claimId", existing.claim_id, input.claimId],
    ["sessionId", existing.session_id, input.sessionId],
    ["turnId", existing.turn_id, input.turnId],
    ["invocationId", existing.invocation_id, input.invocationId],
    ["ownerGeneration", existing.owner_generation, input.ownerGeneration],
    ["routeAck", existing.route_ack, input.routeAck],
    ["intentFingerprint", existing.intent_fingerprint, input.intentFingerprint],
    ["effectIdentity", existing.effect_identity, input.effectIdentity],
  ];
  return comparisons.filter(([, stored, proposed]) => stored !== proposed).map(([label]) => label);
}

function claimIdFor(input: ExternalClaim): string {
  return `sha256:${createHash("sha256").update(stableStringify({
    admissionId: input.admissionId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    invocationId: input.invocationId,
    attemptId: input.attemptId,
    round: input.round,
    ownerGeneration: input.ownerGeneration,
    routeAck: input.routeAck,
    intentFingerprint: input.intentFingerprint,
    effectIdentity: input.effectIdentity,
    effectKind: input.effectKind,
  }), "utf8").digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function toRecord(row: ClaimRow): ManagedExternalInvocationActionClaimRecord {
  return {
    claimId: row.claim_id as ExternalClaim["claimId"],
    admissionId: row.admission_id as ExternalClaim["admissionId"],
    sessionId: row.session_id,
    turnId: row.turn_id,
    invocationId: row.invocation_id,
    attemptId: row.attempt_id,
    round: 0,
    ownerGeneration: row.owner_generation,
    routeAck: row.route_ack,
    intentFingerprint: row.intent_fingerprint as ExternalClaim["intentFingerprint"],
    effectIdentity: row.effect_identity as ExternalClaim["effectIdentity"],
    effectKind: row.effect_kind,
    status: row.status,
    ...(row.claimed_at ? { claimedAt: row.claimed_at } : {}),
    ...(row.settled_at ? { settledAt: row.settled_at } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  };
}
