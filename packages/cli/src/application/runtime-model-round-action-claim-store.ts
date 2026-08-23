import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { PerCallToolConfig } from "@kilnai/runtime";
import { SqliteActionClaimStoreOwner } from "./sqlite-action-claim-store-owner.js";

type RuntimeModelRoundDispatchContext = NonNullable<PerCallToolConfig["runtimeModelRoundDispatch"]>;
type RuntimeModelRoundActionClaimStore = RuntimeModelRoundDispatchContext["store"];
type RuntimeModelRoundActionClaim = Parameters<RuntimeModelRoundActionClaimStore["claim"]>[0];
type RuntimeModelRoundActionClaimPermit = ReturnType<RuntimeModelRoundActionClaimStore["claim"]> & {
  readonly consume: () => void;
};
type RuntimeModelRoundActionClaimSettlement = Parameters<RuntimeModelRoundActionClaimStore["settle"]>[1];

const CANONICAL_SHA256_ID = /^sha256:[a-f0-9]{64}$/u;

export interface RuntimeModelRoundActionClaimStoreOptions {
  readonly path: string;
  readonly now?: () => string;
  readonly idGenerator?: () => string;
  readonly ownerId?: string;
  readonly ownerStaleMs?: number;
}

export type RuntimeModelRoundActionClaimRecord = RuntimeModelRoundActionClaim;

type ClaimRow = {
  claim_id: string;
  admission_id: string;
  session_id: string;
  turn_id: string;
  attempt_id: string;
  round: number;
  intent_fingerprint: string;
  effect_identity: string;
  provider_request_id: string;
  route_id: string;
  account_id: string;
  credential_revision: string;
  permit_id: string;
  status: "claimed" | "settled" | "unknown";
  claimed_at: string;
  settled_at: string | null;
  outcome: "success" | "unknown" | null;
  unknown_reason: string | null;
};

/**
 * Durable owner for one workload's direct-provider model-round action boundary.
 * Each workload composes a separate database from account capacity;
 * a capacity row cannot be used as evidence that a provider effect was claimed.
 */
export class SqliteRuntimeModelRoundActionClaimStore implements RuntimeModelRoundActionClaimStore {
  readonly #db: Database;
  readonly #owner: SqliteActionClaimStoreOwner;
  readonly #now: () => string;
  readonly #idGenerator: () => string;
  readonly #permits = new WeakMap<RuntimeModelRoundActionClaimPermit, { readonly claimId: string; consumed: boolean }>();
  #closed = false;

  constructor(options: RuntimeModelRoundActionClaimStoreOptions) {
    if (!options.path.trim()) throw new TypeError("Runtime model-round claim database path is required.");
    mkdirSync(dirname(options.path), { recursive: true });
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idGenerator = options.idGenerator ?? randomUUID;
    this.#db = new Database(options.path, { create: true, strict: true });
    this.#owner = new SqliteActionClaimStoreOwner({
      database: this.#db,
      storeName: "Runtime model-round",
      now: this.#now,
      ...(options.ownerId !== undefined ? { ownerId: options.ownerId } : {}),
      ...(options.ownerStaleMs !== undefined ? { ownerStaleMs: options.ownerStaleMs } : {}),
    });
    try {
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS runtime_model_round_action_claims (
          claim_id TEXT PRIMARY KEY,
          admission_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          round INTEGER NOT NULL CHECK(round >= 0),
          intent_fingerprint TEXT NOT NULL,
          effect_identity TEXT NOT NULL,
          provider_request_id TEXT NOT NULL,
          route_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          credential_revision TEXT NOT NULL,
          permit_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('claimed','settled','unknown')),
          claimed_at TEXT NOT NULL,
          settled_at TEXT,
          outcome TEXT CHECK(outcome IS NULL OR outcome IN ('success','unknown')),
          unknown_reason TEXT,
          UNIQUE(admission_id, attempt_id, round, intent_fingerprint, effect_identity)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS runtime_model_round_action_claims_slot
          ON runtime_model_round_action_claims(admission_id, attempt_id, round);
        CREATE INDEX IF NOT EXISTS runtime_model_round_action_claims_permit
          ON runtime_model_round_action_claims(permit_id);
      `);
      this.#owner.claimAndRunStartupRecovery(() => {
        // A process can die after the provider call and before settlement. The
        // successor must own the fixed path before preserving that uncertainty.
        this.#db.query(`
          UPDATE runtime_model_round_action_claims
          SET status='unknown', settled_at=?, outcome='unknown', unknown_reason=?
          WHERE status='claimed'
        `).run(this.#now(), "process-restarted-before-settlement");
      });
    } catch (error) {
      this.#owner.close();
      this.#db.close();
      throw error;
    }
  }

  claim(input: RuntimeModelRoundActionClaim): RuntimeModelRoundActionClaimPermit {
    this.#assertOpen();
    assertClaim(input);
    return this.#transaction(() => {
      const existing = this.#db.query<ClaimRow, [string, string, number]>(`
        SELECT claim_id,admission_id,session_id,turn_id,attempt_id,round,intent_fingerprint,
          effect_identity,provider_request_id,route_id,account_id,credential_revision,permit_id,
          status,claimed_at,settled_at,outcome,unknown_reason
        FROM runtime_model_round_action_claims
        WHERE admission_id=? AND attempt_id=? AND round=?
      `).get(input.admissionId, input.attemptId, input.round);
      if (existing) {
        const mismatches = claimIdentityMismatches(existing, input);
        if (mismatches.length > 0) {
          throw new Error(`Runtime model-round action claim slot is already bound; immutable identity mismatch: ${mismatches.join(", ")}.`);
        }
        throw new Error(`Runtime model-round action claim already exists with status '${existing.status}'.`);
      }

      const permitId = `runtime-model-round:${this.#idGenerator()}`;
      this.#db.query(`
        INSERT INTO runtime_model_round_action_claims(
          claim_id,admission_id,session_id,turn_id,attempt_id,round,intent_fingerprint,effect_identity,
          provider_request_id,route_id,account_id,credential_revision,permit_id,status,claimed_at,
          settled_at,outcome,unknown_reason
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'claimed',?,NULL,NULL,NULL)
      `).run(
        input.claimId,
        input.admissionId,
        input.sessionId,
        input.turnId,
        input.attemptId,
        input.round,
        input.intentFingerprint,
        input.effectIdentity,
        input.providerRequestId,
        input.routeId,
        input.accountId,
        input.credentialRevision,
        permitId,
        input.claimedAt ?? this.#now(),
      );
      const state = { claimId: input.claimId, consumed: false };
      const permit = Object.freeze({
        claimId: input.claimId,
        permitId,
        consume: (): void => {
          this.#assertOpen();
          this.#owner.assertOwned();
          if (state.consumed) throw new Error("Runtime model-round action permit has already been consumed.");
          state.consumed = true;
        },
      }) as unknown as RuntimeModelRoundActionClaimPermit;
      this.#permits.set(permit, state);
      return permit;
    });
  }

  settle(
    permit: RuntimeModelRoundActionClaimPermit,
    settlement: RuntimeModelRoundActionClaimSettlement,
  ): void {
    this.#assertOpen();
    if (!permit || typeof permit.permitId !== "string" || typeof permit.claimId !== "string" || typeof permit.consume !== "function") {
      throw new Error("Invalid Runtime model-round claim permit.");
    }
    const state = this.#permits.get(permit);
    if (!state || state.claimId !== permit.claimId || !state.consumed) {
      throw new Error("Runtime model-round action permit must be consumed exactly at the effect boundary.");
    }
    this.#transaction(() => {
      const row = this.#db.query<Pick<ClaimRow, "claim_id" | "status">, [string]>(`
        SELECT claim_id,status
        FROM runtime_model_round_action_claims
        WHERE permit_id=?
      `).get(permit.permitId);
      if (!row || row.claim_id !== permit.claimId) {
        throw new Error("Unknown Runtime model-round claim permit.");
      }
      if (row.status !== "claimed") {
        throw new Error(`Runtime model-round claim permit is already consumed (${row.status}).`);
      }

      const settledAt = settlement.settledAt ?? this.#now();
      if (settlement.kind === "success") {
        this.#db.query(`
          UPDATE runtime_model_round_action_claims
          SET status='settled',settled_at=?,outcome='success',unknown_reason=NULL
          WHERE permit_id=? AND claim_id=? AND status='claimed'
        `).run(settledAt, permit.permitId, permit.claimId);
      } else {
        if (!settlement.reason.trim()) throw new TypeError("Unknown Runtime model-round settlement requires a reason.");
        this.#db.query(`
          UPDATE runtime_model_round_action_claims
          SET status='unknown',settled_at=?,outcome='unknown',unknown_reason=?
          WHERE permit_id=? AND claim_id=? AND status='claimed'
        `).run(settledAt, settlement.reason, permit.permitId, permit.claimId);
      }
    });
    this.#permits.delete(permit);
  }

  read(claimId: string): RuntimeModelRoundActionClaimRecord | undefined {
    this.#assertOpen();
    const row = this.#db.query<ClaimRow, [string]>(`
      SELECT claim_id,admission_id,session_id,turn_id,attempt_id,round,intent_fingerprint,
        effect_identity,provider_request_id,route_id,account_id,credential_revision,permit_id,
        status,claimed_at,settled_at,outcome,unknown_reason
      FROM runtime_model_round_action_claims
      WHERE claim_id=?
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
    if (this.#closed) throw new Error("Runtime model-round claim store is closed.");
  }
}

function assertClaim(input: RuntimeModelRoundActionClaim): void {
  for (const [label, value] of [
    ["claimId", input.claimId],
    ["admissionId", input.admissionId],
    ["intentFingerprint", input.intentFingerprint],
    ["effectIdentity", input.effectIdentity],
  ] as const) {
    if (!CANONICAL_SHA256_ID.test(value)) {
      throw new TypeError(`${label} must be a canonical sha256:<64 lowercase hex> id.`);
    }
  }
  for (const [label, value] of [
    ["sessionId", input.sessionId],
    ["turnId", input.turnId],
    ["attemptId", input.attemptId],
    ["providerRequestId", input.providerRequestId],
    ["routeId", input.routeId],
    ["accountId", input.accountId],
    ["credentialRevision", input.credentialRevision],
  ] as const) {
    if (!value.trim()) throw new TypeError(`${label} is required.`);
  }
  if (!Number.isInteger(input.round) || input.round < 0) throw new TypeError("round must be a non-negative integer.");
  if (input.status !== "claimed") throw new TypeError("A new Runtime model-round claim must be claimed.");
  if (input.claimId !== claimIdFor(input)) {
    throw new TypeError("claimId must be the canonical digest of the immutable Runtime model-round identity.");
  }
}

function claimIdentityMismatches(
  existing: ClaimRow,
  input: RuntimeModelRoundActionClaim,
): readonly string[] {
  const comparisons: readonly [string, string | number, string | number][] = [
    ["claimId", existing.claim_id, input.claimId],
    ["sessionId", existing.session_id, input.sessionId],
    ["turnId", existing.turn_id, input.turnId],
    ["intentFingerprint", existing.intent_fingerprint, input.intentFingerprint],
    ["effectIdentity", existing.effect_identity, input.effectIdentity],
    ["providerRequestId", existing.provider_request_id, input.providerRequestId],
    ["routeId", existing.route_id, input.routeId],
    ["accountId", existing.account_id, input.accountId],
    ["credentialRevision", existing.credential_revision, input.credentialRevision],
  ];
  return comparisons.filter(([, stored, proposed]) => stored !== proposed).map(([label]) => label);
}

function claimIdFor(input: RuntimeModelRoundActionClaim): string {
  const identity = {
    admissionId: input.admissionId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    attemptId: input.attemptId,
    round: input.round,
    intentFingerprint: input.intentFingerprint,
    effectIdentity: input.effectIdentity,
    providerRequestId: input.providerRequestId,
    routeId: input.routeId,
    accountId: input.accountId,
    credentialRevision: input.credentialRevision,
  } as const;
  return `sha256:${createHash("sha256").update(stableStringify(identity), "utf8").digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function toRecord(row: ClaimRow): RuntimeModelRoundActionClaimRecord {
  return {
    claimId: row.claim_id as RuntimeModelRoundActionClaim["claimId"],
    admissionId: row.admission_id as RuntimeModelRoundActionClaim["admissionId"],
    sessionId: row.session_id,
    turnId: row.turn_id,
    attemptId: row.attempt_id,
    round: row.round,
    intentFingerprint: row.intent_fingerprint as RuntimeModelRoundActionClaim["intentFingerprint"],
    effectIdentity: row.effect_identity as RuntimeModelRoundActionClaim["effectIdentity"],
    providerRequestId: row.provider_request_id,
    routeId: row.route_id,
    accountId: row.account_id,
    credentialRevision: row.credential_revision,
    status: row.status,
    claimedAt: row.claimed_at,
    ...(row.settled_at ? { settledAt: row.settled_at } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.unknown_reason ? { unknownReason: row.unknown_reason } : {}),
  };
}
