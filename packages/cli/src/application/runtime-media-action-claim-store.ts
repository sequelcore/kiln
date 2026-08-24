import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import {
  defineRuntimeMediaActionClaim,
  type RuntimeMediaActionClaim,
  type RuntimeMediaActionClaimPermit,
  type RuntimeMediaActionClaimRecord,
  type RuntimeMediaActionClaimSettlement,
  type RuntimeMediaActionClaimStore,
} from "@kilnai/runtime";
import { assertPrivateStateFileTargetSync } from "./private-project-state-filesystem.js";
import { SqliteActionClaimStoreOwner } from "./sqlite-action-claim-store-owner.js";

export interface RuntimeMediaActionClaimStoreOptions {
  readonly path: string;
  /** Canonical project-private root when this store is project-owned. */
  readonly privateStateRoot?: string;
  readonly now?: () => string;
  readonly ownerId?: string;
  readonly ownerStaleMs?: number;
}

type ClaimRow = {
  claim_id: string;
  admission_id: `sha256:${string}`;
  session_id: string;
  turn_id: string;
  attempt_id: string;
  owner_generation: string;
  caller_id: string;
  idempotency_key: string;
  action_kind: RuntimeMediaActionClaim["actionKind"];
  source_identity: string;
  adapter_identity: string;
  logical_send_slot: string;
  intent_fingerprint: `sha256:${string}`;
  payload_fingerprint: `sha256:${string}`;
  effect_identity: `sha256:${string}`;
  status: RuntimeMediaActionClaimRecord["status"];
  claimed_at: string;
  settled_at: string | null;
  outcome: RuntimeMediaActionClaimRecord["outcome"] | null;
  reason: string | null;
};

/** Workload-local durable owner for Runtime STT/TTS and consequential media transforms. */
export class SqliteRuntimeMediaActionClaimStore implements RuntimeMediaActionClaimStore {
  readonly #db: Database;
  readonly #owner: SqliteActionClaimStoreOwner;
  readonly #now: () => string;
  readonly #permits = new WeakMap<object, { readonly claimId: string; consumed: boolean }>();
  #closed = false;

  constructor(options: RuntimeMediaActionClaimStoreOptions) {
    if (!options.path.trim()) throw new TypeError("Runtime media action claim database path is required.");
    const assertWritablePath = options.privateStateRoot === undefined
      ? undefined
      : () => assertPrivateStateFileTargetSync(options.privateStateRoot!, options.path);
    assertWritablePath?.();
    mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#db = new Database(options.path, { create: true, strict: true });
    this.#owner = new SqliteActionClaimStoreOwner({
      database: this.#db,
      storeName: "Runtime media",
      now: this.#now,
      ...(assertWritablePath ? { assertWritablePath } : {}),
      ...(options.ownerId !== undefined ? { ownerId: options.ownerId } : {}),
      ...(options.ownerStaleMs !== undefined ? { ownerStaleMs: options.ownerStaleMs } : {}),
    });
    try {
      assertWritablePath?.();
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
      this.#ensureSchema();
      this.#owner.claimAndRunStartupRecovery(() => {
        // A process that died after claiming has no valid permit to complete
        // its effect. Preserve the claim as an unknown tombstone; never
        // redispatch, and only after owning this fixed path.
        this.#db.query(`
          UPDATE runtime_media_action_claims
          SET status='unknown', settled_at=?, outcome='unknown', reason=?
          WHERE status='claimed'
        `).run(this.#now(), "process-restarted-before-settlement");
      });
    } catch (error) {
      this.#owner.close();
      this.#db.close(true);
      throw error;
    }
  }

  claim(input: RuntimeMediaActionClaim): RuntimeMediaActionClaimPermit {
    this.#assertOpen();
    assertClaim(input);
    return this.#transaction(() => {
      const existing = this.#db.query<ClaimRow, [string, string, string]>(`
        SELECT claim_id,admission_id,session_id,turn_id,attempt_id,owner_generation,
          caller_id,idempotency_key,action_kind,source_identity,adapter_identity,logical_send_slot,
          intent_fingerprint,payload_fingerprint,effect_identity,status,claimed_at,settled_at,outcome,reason
        FROM runtime_media_action_claims
        WHERE caller_id=? AND idempotency_key=? AND logical_send_slot=?
      `).get(input.callerId, input.idempotencyKey, input.logicalSendSlot);
      if (existing) {
        const mismatches = claimIdentityMismatches(existing, input);
        if (mismatches.length > 0) {
          throw new Error(`Runtime media action claim slot is already bound; immutable identity mismatch: ${mismatches.join(", ")}.`);
        }
        throw new Error(`Runtime media action claim already exists with status '${existing.status}'; no redispatch is permitted.`);
      }

      this.#db.query(`
        INSERT INTO runtime_media_action_claims(
          claim_id,admission_id,session_id,turn_id,attempt_id,owner_generation,
          caller_id,idempotency_key,action_kind,source_identity,adapter_identity,logical_send_slot,
          intent_fingerprint,payload_fingerprint,effect_identity,status,claimed_at,
          settled_at,outcome,reason
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'claimed',?,NULL,NULL,NULL)
      `).run(
        input.claimId,
        input.admissionId,
        input.sessionId,
        input.turnId,
        input.attemptId,
        input.ownerGeneration,
        input.callerId,
        input.idempotencyKey,
        input.actionKind,
        input.sourceIdentity,
        input.adapterIdentity,
        input.logicalSendSlot,
        input.intentFingerprint,
        input.payloadFingerprint,
        input.effectIdentity,
        input.claimedAt ?? this.#now(),
      );

      const state = { claimId: input.claimId, consumed: false };
      const permit = {
        claimId: input.claimId,
        consume: () => {
          this.#assertOpen();
          this.#owner.assertOwned();
          if (state.consumed) throw new Error("Runtime media action permit has already been consumed.");
          state.consumed = true;
        },
      } as RuntimeMediaActionClaimPermit;
      this.#permits.set(permit, state);
      return permit;
    });
  }

  settle(permit: RuntimeMediaActionClaimPermit, settlement: RuntimeMediaActionClaimSettlement): void {
    this.#assertOpen();
    if (!permit || typeof permit !== "object" || typeof permit.claimId !== "string") {
      throw new Error("Invalid Runtime media action claim permit.");
    }
    const state = this.#permits.get(permit);
    if (!state || state.claimId !== permit.claimId || !state.consumed) {
      throw new Error("Runtime media action permit is unknown or unconsumed; it must be consumed exactly at the effect boundary.");
    }
    this.#transaction(() => {
      const row = this.#db.query<Pick<ClaimRow, "claim_id" | "status">, [string]>(`
        SELECT claim_id,status FROM runtime_media_action_claims WHERE claim_id=?
      `).get(permit.claimId);
      if (!row || row.claim_id !== permit.claimId) throw new Error("Unknown Runtime media action claim permit.");
      if (row.status !== "claimed") throw new Error(`Runtime media action claim is already settled (${row.status}).`);
      const settledAt = settlement.settledAt ?? this.#now();
      if (settlement.kind === "success") {
        this.#db.query(`
          UPDATE runtime_media_action_claims
          SET status='settled',settled_at=?,outcome='success',reason=NULL
          WHERE claim_id=? AND status='claimed'
        `).run(settledAt, permit.claimId);
      } else {
        if (!settlement.reason.trim()) throw new TypeError("Runtime media unknown settlement requires a reason.");
        this.#db.query(`
          UPDATE runtime_media_action_claims
          SET status='unknown',settled_at=?,outcome='unknown',reason=?
          WHERE claim_id=? AND status='claimed'
        `).run(settledAt, settlement.reason, permit.claimId);
      }
    });
    this.#permits.delete(permit);
  }

  read(claimId: RuntimeMediaActionClaim["claimId"]): RuntimeMediaActionClaimRecord | undefined {
    this.#assertOpen();
    const row = this.#db.query<ClaimRow, [string]>(`
      SELECT claim_id,admission_id,session_id,turn_id,attempt_id,owner_generation,
        caller_id,idempotency_key,action_kind,source_identity,adapter_identity,logical_send_slot,
        intent_fingerprint,payload_fingerprint,effect_identity,status,claimed_at,settled_at,outcome,reason
      FROM runtime_media_action_claims WHERE claim_id=?
    `).get(claimId);
    return row ? toRecord(row) : undefined;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#owner.close();
      this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } finally {
      this.#db.close(true);
    }
  }

  #ensureSchema(): void {
    const columns = this.#db.query<{ name: string }, []>(
      "SELECT name FROM pragma_table_info('runtime_media_action_claims')",
    ).all().map((row) => row.name);
    const required = [
      "claim_id", "admission_id", "session_id", "turn_id", "attempt_id", "owner_generation",
      "caller_id", "idempotency_key", "action_kind", "source_identity", "adapter_identity",
      "logical_send_slot", "intent_fingerprint", "payload_fingerprint", "effect_identity",
      "status", "claimed_at", "settled_at", "outcome", "reason",
    ];
    if (columns.length > 0 && (columns.length !== required.length || required.some((column) => !columns.includes(column)))) {
      // This workload-local database has no compatibility consumers. Reject
      // an obsolete schema without deleting or rewriting its evidence.
      throw new Error("Runtime media action claim database schema predates the canonical action-claim schema; remove the obsolete workload-local database before restart.");
    }
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_media_action_claims (
        claim_id TEXT PRIMARY KEY,
        admission_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        owner_generation TEXT NOT NULL,
        caller_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        action_kind TEXT NOT NULL CHECK(action_kind IN ('stt-transcribe','tts-synthesize','multimodal-process')),
        source_identity TEXT NOT NULL,
        adapter_identity TEXT NOT NULL,
        logical_send_slot TEXT NOT NULL,
        intent_fingerprint TEXT NOT NULL,
        payload_fingerprint TEXT NOT NULL,
        effect_identity TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('claimed','settled','unknown')),
        claimed_at TEXT NOT NULL,
        settled_at TEXT,
        outcome TEXT CHECK(outcome IS NULL OR outcome IN ('success','unknown')),
        reason TEXT,
        UNIQUE(caller_id,idempotency_key,logical_send_slot)
      );
      CREATE INDEX IF NOT EXISTS runtime_media_action_claims_admission
        ON runtime_media_action_claims(admission_id,attempt_id);
    `);
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Runtime media action claim store is closed.");
  }

  #transaction<T>(operation: () => T): T {
    return this.#owner.runOwned(operation);
  }
}

function assertClaim(input: RuntimeMediaActionClaim): void {
  const normalized = defineRuntimeMediaActionClaim(input as Omit<RuntimeMediaActionClaim, "claimId" | "status">);
  if (normalized.claimId !== input.claimId) {
    throw new TypeError("Runtime media action claim immutable identity mismatch: claim id does not match its canonical identity.");
  }
}

function claimIdentityMismatches(existing: ClaimRow, input: RuntimeMediaActionClaim): string[] {
  const mismatches: string[] = [];
  for (const [left, right, label] of [
    [existing.admission_id, input.admissionId, "admission"],
    [existing.session_id, input.sessionId, "session"],
    [existing.turn_id, input.turnId, "turn"],
    [existing.attempt_id, input.attemptId, "attempt"],
    [existing.owner_generation, input.ownerGeneration, "owner generation"],
    [existing.action_kind, input.actionKind, "action kind"],
    [existing.source_identity, input.sourceIdentity, "source identity"],
    [existing.adapter_identity, input.adapterIdentity, "adapter identity"],
    [existing.intent_fingerprint, input.intentFingerprint, "intent fingerprint"],
    [existing.payload_fingerprint, input.payloadFingerprint, "payload fingerprint"],
    [existing.effect_identity, input.effectIdentity, "effect identity"],
  ] as const) {
    if (left !== right) mismatches.push(label);
  }
  return mismatches;
}

function toRecord(row: ClaimRow): RuntimeMediaActionClaimRecord {
  return {
    claimId: row.claim_id as RuntimeMediaActionClaim["claimId"],
    admissionId: row.admission_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    attemptId: row.attempt_id,
    ownerGeneration: row.owner_generation,
    callerId: row.caller_id,
    idempotencyKey: row.idempotency_key,
    actionKind: row.action_kind,
    sourceIdentity: row.source_identity,
    adapterIdentity: row.adapter_identity,
    logicalSendSlot: row.logical_send_slot,
    intentFingerprint: row.intent_fingerprint,
    payloadFingerprint: row.payload_fingerprint,
    effectIdentity: row.effect_identity,
    status: row.status,
    ...(row.claimed_at ? { claimedAt: row.claimed_at } : {}),
    ...(row.settled_at ? { settledAt: row.settled_at } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  };
}
