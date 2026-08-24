import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import {
  defineChannelEgressActionClaim,
  type ChannelEgressActionClaim,
  type ChannelEgressActionClaimContext,
  type ChannelEgressActionClaimPermit,
  type ChannelEgressActionClaimRecord,
  type ChannelEgressActionClaimSettlement,
  type ChannelEgressActionClaimStore,
} from "@kilnai/runtime";
import { assertPrivateStateFileTargetSync } from "./private-project-state-filesystem.js";
import { SqliteActionClaimStoreOwner } from "./sqlite-action-claim-store-owner.js";

export interface ChannelEgressActionClaimStoreOptions {
  readonly path: string;
  /** Canonical project-private root when this store is project-owned. */
  readonly privateStateRoot?: string;
  readonly now?: () => string;
  readonly idGenerator?: () => string;
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
  channel: string;
  destination: string;
  adapter_identity: string;
  logical_send_slot: string;
  intent_fingerprint: `sha256:${string}`;
  payload_fingerprint: `sha256:${string}`;
  effect_identity: `sha256:${string}`;
  status: ChannelEgressActionClaimRecord["status"];
  permit_id: string;
  claimed_at: string;
  settled_at: string | null;
  outcome: ChannelEgressActionClaimRecord["outcome"] | null;
  reason: string | null;
};

/**
 * Durable owner for channel sends. This store is workload-local to the CLI
 * App Gateway and deliberately separate from model replay, account capacity,
 * and managed-agent action claims.
 */
export class SqliteChannelEgressActionClaimStore implements ChannelEgressActionClaimStore {
  readonly #db: Database;
  readonly #owner: SqliteActionClaimStoreOwner;
  readonly #now: () => string;
  readonly #idGenerator: () => string;
  readonly #permits = new WeakMap<object, { readonly claimId: string; readonly permitId: string; consumed: boolean }>();
  #closed = false;

  constructor(options: ChannelEgressActionClaimStoreOptions) {
    if (!options.path.trim()) throw new TypeError("Channel egress action claim database path is required.");
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
      storeName: "Channel egress",
      now: this.#now,
      ...(assertWritablePath ? { assertWritablePath } : {}),
      ...(options.ownerId !== undefined ? { ownerId: options.ownerId } : {}),
      ...(options.ownerStaleMs !== undefined ? { ownerStaleMs: options.ownerStaleMs } : {}),
    });
    try {
      assertWritablePath?.();
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS channel_egress_action_claims (
          claim_id TEXT PRIMARY KEY,
          admission_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          owner_generation TEXT NOT NULL,
          caller_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          channel TEXT NOT NULL,
          destination TEXT NOT NULL,
          adapter_identity TEXT NOT NULL,
          logical_send_slot TEXT NOT NULL,
          intent_fingerprint TEXT NOT NULL,
          payload_fingerprint TEXT NOT NULL,
          effect_identity TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('claimed','settled','unknown')),
          permit_id TEXT NOT NULL UNIQUE,
          claimed_at TEXT NOT NULL,
          settled_at TEXT,
          outcome TEXT CHECK(outcome IS NULL OR outcome IN ('success','unknown')),
          reason TEXT,
          UNIQUE(caller_id, idempotency_key, logical_send_slot)
        );
        CREATE INDEX IF NOT EXISTS channel_egress_action_claims_admission
          ON channel_egress_action_claims(admission_id, attempt_id);
      `);
      this.#owner.claimAndRunStartupRecovery(() => {
        // A process that died after claiming has no valid permit to complete
        // the send. Preserve the tombstone as unknown; never redispatch it,
        // and only after owning this fixed path.
        this.#db.query(`
          UPDATE channel_egress_action_claims
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

  claim(input: ChannelEgressActionClaim): ChannelEgressActionClaimPermit {
    this.#assertOpen();
    assertClaim(input);
    return this.#transaction(() => {
      const existing = this.#db.query<ClaimRow, [string, string, string]>(`
        SELECT claim_id,admission_id,session_id,turn_id,attempt_id,owner_generation,
          caller_id,idempotency_key,channel,destination,adapter_identity,logical_send_slot,
          intent_fingerprint,payload_fingerprint,effect_identity,status,permit_id,claimed_at,
          settled_at,outcome,reason
        FROM channel_egress_action_claims
        WHERE caller_id=? AND idempotency_key=? AND logical_send_slot=?
      `).get(input.callerId, input.idempotencyKey, input.logicalSendSlot);
      if (existing) {
        const mismatches = claimIdentityMismatches(existing, input);
        if (mismatches.length > 0) {
          throw new Error(`Channel egress action claim slot is already bound; immutable identity mismatch: ${mismatches.join(", ")}.`);
        }
        throw new Error(`Channel egress action claim already exists with status '${existing.status}'; no redispatch is permitted.`);
      }

      const permitId = `channel-egress:${this.#idGenerator()}`;
      this.#db.query(`
        INSERT INTO channel_egress_action_claims(
          claim_id,admission_id,session_id,turn_id,attempt_id,owner_generation,
          caller_id,idempotency_key,channel,destination,adapter_identity,logical_send_slot,
          intent_fingerprint,payload_fingerprint,effect_identity,status,permit_id,claimed_at,
          settled_at,outcome,reason
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'claimed',?,?,NULL,NULL,NULL)
      `).run(
        input.claimId,
        input.admissionId,
        input.sessionId,
        input.turnId,
        input.attemptId,
        input.ownerGeneration,
        input.callerId,
        input.idempotencyKey,
        input.channel,
        input.destination,
        input.adapterIdentity,
        input.logicalSendSlot,
        input.intentFingerprint,
        input.payloadFingerprint,
        input.effectIdentity,
        permitId,
        input.claimedAt ?? this.#now(),
      );
      const state = { claimId: input.claimId, permitId, consumed: false };
      const permit = {
        permitId,
        claimId: input.claimId,
        consume: () => {
          this.#assertOpen();
          this.#owner.assertOwned();
          if (state.consumed) throw new Error("Channel egress action permit has already been consumed.");
          state.consumed = true;
        },
      } as ChannelEgressActionClaimPermit;
      this.#permits.set(permit, state);
      return permit;
    });
  }

  settle(permit: ChannelEgressActionClaimPermit, settlement: ChannelEgressActionClaimSettlement): void {
    this.#assertOpen();
    if (!permit || typeof permit !== "object" || typeof permit.permitId !== "string" || typeof permit.claimId !== "string") {
      throw new Error("Invalid channel egress action claim permit.");
    }
    const state = this.#permits.get(permit);
    if (!state || state.permitId !== permit.permitId || state.claimId !== permit.claimId || !state.consumed) {
      throw new Error("Channel egress action permit is unknown or already consumed; it must be consumed exactly at the effect boundary.");
    }
    this.#transaction(() => {
      const row = this.#db.query<Pick<ClaimRow, "claim_id" | "status">, [string]>(`
        SELECT claim_id,status FROM channel_egress_action_claims WHERE permit_id=?
      `).get(permit.permitId);
      if (!row || row.claim_id !== permit.claimId) throw new Error("Unknown channel egress action claim permit.");
      if (row.status !== "claimed") throw new Error(`Channel egress action claim permit is already consumed (${row.status}).`);
      const settledAt = settlement.settledAt ?? this.#now();
      if (settlement.kind === "success") {
        this.#db.query(`
          UPDATE channel_egress_action_claims
          SET status='settled',settled_at=?,outcome='success',reason=NULL
          WHERE permit_id=? AND claim_id=? AND status='claimed'
        `).run(settledAt, permit.permitId, permit.claimId);
      } else {
        if (!settlement.reason.trim()) throw new TypeError("Channel egress unknown settlement requires a reason.");
        this.#db.query(`
          UPDATE channel_egress_action_claims
          SET status=?,settled_at=?,outcome=?,reason=?
          WHERE permit_id=? AND claim_id=? AND status='claimed'
        `).run(settlement.kind, settledAt, settlement.kind, settlement.reason, permit.permitId, permit.claimId);
      }
    });
    this.#permits.delete(permit);
  }

  read(claimId: ChannelEgressActionClaim["claimId"]): ChannelEgressActionClaimRecord | undefined {
    this.#assertOpen();
    const row = this.#db.query<ClaimRow, [string]>(`
      SELECT claim_id,admission_id,session_id,turn_id,attempt_id,owner_generation,
        caller_id,idempotency_key,channel,destination,adapter_identity,logical_send_slot,
        intent_fingerprint,payload_fingerprint,effect_identity,status,permit_id,claimed_at,
        settled_at,outcome,reason
      FROM channel_egress_action_claims WHERE claim_id=?
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

  #assertOpen(): void {
    if (this.#closed) throw new Error("Channel egress action claim store is closed.");
  }

  #transaction<T>(operation: () => T): T {
    return this.#owner.runOwned(operation);
  }
}

function assertClaim(input: ChannelEgressActionClaim): void {
  const normalized = defineChannelEgressActionClaim(input as Omit<ChannelEgressActionClaim, "claimId" | "status">);
  if (normalized.claimId !== input.claimId) {
    throw new TypeError("Channel egress action claim immutable identity mismatch: claim id does not match its canonical identity.");
  }
}

function claimIdentityMismatches(existing: ClaimRow, input: ChannelEgressActionClaim): string[] {
  const mismatches: string[] = [];
  for (const [left, right, label] of [
    [existing.channel, input.channel, "channel"],
    [existing.destination, input.destination, "destination"],
    [existing.adapter_identity, input.adapterIdentity, "adapter identity"],
    [existing.intent_fingerprint, input.intentFingerprint, "intent fingerprint"],
    [existing.payload_fingerprint, input.payloadFingerprint, "payload fingerprint"],
    [existing.effect_identity, input.effectIdentity, "effect identity"],
  ] as const) {
    if (left !== right) mismatches.push(label);
  }
  return mismatches;
}

function toRecord(row: ClaimRow): ChannelEgressActionClaimRecord {
  return {
    claimId: row.claim_id as ChannelEgressActionClaim["claimId"],
    admissionId: row.admission_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    attemptId: row.attempt_id,
    ownerGeneration: row.owner_generation,
    callerId: row.caller_id,
    idempotencyKey: row.idempotency_key,
    channel: row.channel,
    destination: row.destination,
    adapterIdentity: row.adapter_identity,
    logicalSendSlot: row.logical_send_slot,
    intentFingerprint: row.intent_fingerprint,
    payloadFingerprint: row.payload_fingerprint,
    effectIdentity: row.effect_identity,
    status: row.status,
    ...(row.settled_at ? { settledAt: row.settled_at } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  };
}

/** Context factory used by the App Gateway composition. */
export function createChannelEgressActionClaimContext(input: {
  readonly ownerGeneration: string;
  readonly store: ChannelEgressActionClaimStore;
  readonly readAdmission: ChannelEgressActionClaimContext["readAdmission"];
}): ChannelEgressActionClaimContext {
  return {
    ownerGeneration: input.ownerGeneration,
    store: input.store,
    readAdmission: input.readAdmission,
  };
}
