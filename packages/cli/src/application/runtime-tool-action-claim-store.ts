import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import {
  assertRuntimeToolActionClaim,
  type RuntimeToolActionClaim,
  type RuntimeToolActionClaimPermit,
  type RuntimeToolActionClaimStore,
} from "@kilnai/runtime";
import { SqliteActionClaimStoreOwner } from "./sqlite-action-claim-store-owner.js";

type Settlement = Parameters<RuntimeToolActionClaimStore["settle"]>[1];

export interface RuntimeToolActionClaimStoreOptions {
  readonly path: string;
  readonly now?: () => string;
  readonly idGenerator?: () => string;
  readonly ownerId?: string;
  readonly ownerStaleMs?: number;
}

export type RuntimeToolActionClaimRecord = RuntimeToolActionClaim;

type ClaimRow = {
  claim_id: string;
  admission_id: string;
  session_id: string;
  turn_id: string;
  attempt_id: string;
  tool_call_scope_id: string;
  tool_call_id: string;
  selector: string;
  normalized_input: string;
  resolved_effect_json: string;
  adapter_identity: string;
  permit_id: string;
  status: "claimed" | "settled" | "unknown";
  claimed_at: string;
  settled_at: string | null;
  outcome: "success" | null;
  unknown_reason: string | null;
};

/** Workload-local durable owner for consequential tool/MCP effects. */
export class SqliteRuntimeToolActionClaimStore implements RuntimeToolActionClaimStore {
  readonly #db: Database;
  readonly #owner: SqliteActionClaimStoreOwner;
  readonly #now: () => string;
  readonly #idGenerator: () => string;
  readonly #permits = new WeakMap<RuntimeToolActionClaimPermit, { readonly claimId: string; consumed: boolean }>();
  #closed = false;

  constructor(options: RuntimeToolActionClaimStoreOptions) {
    if (!options.path.trim()) throw new TypeError("Runtime tool-action claim database path is required.");
    mkdirSync(dirname(options.path), { recursive: true });
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idGenerator = options.idGenerator ?? randomUUID;
    this.#db = new Database(options.path, { create: true, strict: true });
    this.#owner = new SqliteActionClaimStoreOwner({
      database: this.#db,
      storeName: "Runtime tool-action",
      now: this.#now,
      ...(options.ownerId !== undefined ? { ownerId: options.ownerId } : {}),
      ...(options.ownerStaleMs !== undefined ? { ownerStaleMs: options.ownerStaleMs } : {}),
    });
    try {
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS runtime_tool_action_claims (
          claim_id TEXT PRIMARY KEY,
          admission_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          tool_call_scope_id TEXT NOT NULL,
          tool_call_id TEXT NOT NULL,
          selector TEXT NOT NULL,
          normalized_input TEXT NOT NULL,
          resolved_effect_json TEXT NOT NULL,
          adapter_identity TEXT NOT NULL,
          permit_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('claimed','settled','unknown')),
          claimed_at TEXT NOT NULL,
          settled_at TEXT,
          outcome TEXT CHECK(outcome IS NULL OR outcome IN ('success')),
          unknown_reason TEXT,
          UNIQUE(admission_id, attempt_id, turn_id, tool_call_scope_id, tool_call_id)
        );
        CREATE INDEX IF NOT EXISTS runtime_tool_action_claims_permit
          ON runtime_tool_action_claims(permit_id);
      `);
      this.#owner.claimAndRunStartupRecovery(() => {
        this.#db.query(`
          UPDATE runtime_tool_action_claims
          SET status='unknown', settled_at=?, outcome=NULL, unknown_reason=?
          WHERE status='claimed'
        `).run(this.#now(), "process-restarted-before-settlement");
      });
    } catch (error) {
      this.#owner.close();
      this.#db.close();
      throw error;
    }
  }

  claim(input: RuntimeToolActionClaim): RuntimeToolActionClaimPermit {
    this.#assertOpen();
    assertRuntimeToolActionClaim(input);
    return this.#transaction(() => {
      const existing = this.#db.query<ClaimRow, [string, string, string, string, string]>(`
        SELECT claim_id,admission_id,session_id,turn_id,attempt_id,tool_call_scope_id,tool_call_id,
          selector,normalized_input,resolved_effect_json,adapter_identity,permit_id,status,claimed_at,
          settled_at,outcome,unknown_reason
        FROM runtime_tool_action_claims
        WHERE admission_id=? AND attempt_id=? AND turn_id=? AND tool_call_scope_id=? AND tool_call_id=?
      `).get(input.admissionId, input.attemptId, input.turnId, input.toolCallScopeId, input.toolCallId);
      if (existing) {
        const mismatches = claimIdentityMismatches(existing, input);
        if (mismatches.length > 0) {
          throw new Error(`Runtime tool-action claim slot is already bound; immutable identity mismatch: ${mismatches.join(", ")}.`);
        }
        throw new Error(`Runtime tool-action claim already exists with status '${existing.status}'.`);
      }

      const permitId = `runtime-tool-action:${this.#idGenerator()}`;
      this.#db.query(`
        INSERT INTO runtime_tool_action_claims(
          claim_id,admission_id,session_id,turn_id,attempt_id,tool_call_scope_id,tool_call_id,
          selector,normalized_input,resolved_effect_json,adapter_identity,permit_id,status,claimed_at,
          settled_at,outcome,unknown_reason
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'claimed',?,NULL,NULL,NULL)
      `).run(
        input.claimId,
        input.admissionId,
        input.sessionId,
        input.turnId,
        input.attemptId,
        input.toolCallScopeId,
        input.toolCallId,
        input.selector,
        input.normalizedInput,
        stableStringify(input.resolvedEffect),
        input.adapterIdentity,
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
          if (state.consumed) throw new Error("Runtime tool-action permit has already been consumed.");
          state.consumed = true;
        },
      }) as unknown as RuntimeToolActionClaimPermit;
      this.#permits.set(permit, state);
      return permit;
    });
  }

  settle(permit: RuntimeToolActionClaimPermit, settlement: Settlement): void {
    this.#assertOpen();
    if (!permit || typeof permit.permitId !== "string" || typeof permit.claimId !== "string" || typeof permit.consume !== "function") {
      throw new Error("Invalid Runtime tool-action claim permit.");
    }
    const state = this.#permits.get(permit);
    if (!state || state.claimId !== permit.claimId || !state.consumed) {
      throw new Error("Runtime tool-action permit must be consumed exactly at the effect boundary.");
    }
    this.#transaction(() => {
      const row = this.#db.query<Pick<ClaimRow, "claim_id" | "status">, [string]>(`
        SELECT claim_id,status FROM runtime_tool_action_claims WHERE permit_id=?
      `).get(permit.permitId);
      if (!row || row.claim_id !== permit.claimId) throw new Error("Unknown Runtime tool-action claim permit.");
      if (row.status !== "claimed") throw new Error(`Runtime tool-action claim permit is already settled (${row.status}).`);
      const settledAt = settlement.settledAt ?? this.#now();
      if (settlement.kind === "success") {
        this.#db.query(`
          UPDATE runtime_tool_action_claims
          SET status='settled',settled_at=?,outcome='success',unknown_reason=NULL
          WHERE permit_id=? AND claim_id=? AND status='claimed'
        `).run(settledAt, permit.permitId, permit.claimId);
      } else {
        if (!settlement.reason.trim()) throw new TypeError("Unknown Runtime tool-action settlement requires a reason.");
        this.#db.query(`
          UPDATE runtime_tool_action_claims
          SET status='unknown',settled_at=?,outcome=NULL,unknown_reason=?
          WHERE permit_id=? AND claim_id=? AND status='claimed'
        `).run(settledAt, settlement.reason, permit.permitId, permit.claimId);
      }
    });
    this.#permits.delete(permit);
  }

  read(claimId: string): RuntimeToolActionClaimRecord | undefined {
    this.#assertOpen();
    const row = this.#db.query<ClaimRow, [string]>(`
      SELECT claim_id,admission_id,session_id,turn_id,attempt_id,tool_call_scope_id,tool_call_id,
        selector,normalized_input,resolved_effect_json,adapter_identity,permit_id,status,claimed_at,
        settled_at,outcome,unknown_reason
      FROM runtime_tool_action_claims WHERE claim_id=?
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
    if (this.#closed) throw new Error("Runtime tool-action claim store is closed.");
  }
}

function claimIdentityMismatches(existing: ClaimRow, input: RuntimeToolActionClaim): readonly string[] {
  const comparisons: readonly [string, string, string][] = [
    ["claimId", existing.claim_id, input.claimId],
    ["sessionId", existing.session_id, input.sessionId],
    ["turnId", existing.turn_id, input.turnId],
    ["selector", existing.selector, input.selector],
    ["normalizedInput", existing.normalized_input, input.normalizedInput],
    ["resolvedEffect", existing.resolved_effect_json, stableStringify(input.resolvedEffect)],
    ["adapterIdentity", existing.adapter_identity, input.adapterIdentity],
  ];
  return comparisons.filter(([, stored, proposed]) => stored !== proposed).map(([label]) => label);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function toRecord(row: ClaimRow): RuntimeToolActionClaimRecord {
  return {
    claimId: row.claim_id as RuntimeToolActionClaim["claimId"],
    admissionId: row.admission_id as RuntimeToolActionClaim["admissionId"],
    sessionId: row.session_id,
    turnId: row.turn_id,
    attemptId: row.attempt_id,
    toolCallScopeId: row.tool_call_scope_id,
    toolCallId: row.tool_call_id,
    selector: row.selector,
    normalizedInput: row.normalized_input,
    resolvedEffect: JSON.parse(row.resolved_effect_json) as RuntimeToolActionClaim["resolvedEffect"],
    adapterIdentity: row.adapter_identity,
    status: row.status,
    claimedAt: row.claimed_at,
    ...(row.settled_at ? { settledAt: row.settled_at } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.unknown_reason ? { unknownReason: row.unknown_reason } : {}),
  };
}
