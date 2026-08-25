import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

const OWNER_TABLE = "runtime_action_claim_store_owner";
const DEFAULT_OWNER_STALE_MS = 30_000;

interface OwnerRow {
  readonly singleton: number;
  readonly owner_id: string;
  readonly owner_generation: string;
  readonly heartbeat: number;
}

export interface SqliteActionClaimStoreOwnerOptions {
  readonly database: Database;
  readonly storeName: string;
  readonly now: () => string;
  /** Re-check the private file boundary immediately before each store write. */
  readonly assertWritablePath?: () => void;
  readonly ownerId?: string;
  readonly ownerStaleMs?: number;
}

/**
 * Owns one fixed-path action-claim database for the lifetime of one process.
 *
 * Startup recovery is deliberately coupled to the owner transaction: a store
 * may tombstone claimed rows only after it has won the singleton owner row.
 * Every foreground transaction rechecks that row, so a stale process cannot
 * continue mutating evidence after a successor recovers the database.
 */
export class SqliteActionClaimStoreOwner {
  readonly #db: Database;
  readonly #storeName: string;
  readonly #now: () => string;
  readonly #assertWritablePath: (() => void) | undefined;
  readonly #ownerId: string;
  readonly #ownerGeneration = randomUUID();
  readonly #ownerStaleMs: number;
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #closed = false;
  #ownershipLost = false;

  constructor(options: SqliteActionClaimStoreOwnerOptions) {
    this.#db = options.database;
    this.#storeName = options.storeName;
    this.#now = options.now;
    this.#assertWritablePath = options.assertWritablePath;
    this.#ownerId = options.ownerId ?? randomUUID();
    this.#ownerStaleMs = options.ownerStaleMs ?? DEFAULT_OWNER_STALE_MS;
  }

  /** Claims the fixed-path owner and runs startup recovery under that claim. */
  claimAndRunStartupRecovery(recover: () => void): void {
    this.#validateOptions();
    this.#assertWritablePath?.();
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS ${OWNER_TABLE} (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        owner_id TEXT NOT NULL,
        owner_generation TEXT NOT NULL,
        heartbeat INTEGER NOT NULL
      );
    `);
    this.#transaction(() => {
      this.#claimOwner();
      this.#assertWritablePath?.();
      recover();
    });
    this.#heartbeatTimer = setInterval(
      () => {
        try {
          this.#heartbeat();
        } catch {
          // A heartbeat failure means ownership can no longer be proven;
          // foreground operations must fail closed until this store restarts.
          this.#ownershipLost = true;
        }
      },
      Math.max(250, Math.floor(this.#ownerStaleMs / 3)),
    );
    this.#heartbeatTimer.unref?.();
  }

  /** Runs a foreground operation only while this process still owns the DB. */
  runOwned<T>(operation: () => T): T {
    if (this.#closed) throw new Error(`${this.#storeName} store owner is closed.`);
    return this.#transaction(() => {
      this.#assertWritablePath?.();
      this.#assertOwned();
      this.#assertWritablePath?.();
      return operation();
    });
  }

  /** Checks ownership for an opaque permit before it crosses the effect boundary. */
  assertOwned(): void {
    this.runOwned(() => undefined);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
    try {
      this.#db
        .query(
          `DELETE FROM ${OWNER_TABLE}
           WHERE singleton=1 AND owner_id=? AND owner_generation=?`,
        )
        .run(this.#ownerId, this.#ownerGeneration);
    } catch {
      // A failed startup/schema operation may have happened before the owner
      // table existed. Closing the database remains safe; stale-owner recovery
      // is the fail-closed fallback when release itself cannot be recorded.
    }
  }

  #claimOwner(): void {
    const now = this.#nowMs();
    const current = this.#db
      .query<OwnerRow, []>(
        `SELECT singleton,owner_id,owner_generation,heartbeat
         FROM ${OWNER_TABLE} WHERE singleton=1`,
      )
      .get();
    if (current && current.heartbeat > now - this.#ownerStaleMs) {
      const retryInSeconds = Math.max(
        1,
        Math.ceil((current.heartbeat + this.#ownerStaleMs - now) / 1_000),
      );
      throw new Error(
        `${this.#storeName} action-claim store already has a live owner. `
        + `Close the active owner; after an abrupt exit, retry in ${retryInSeconds} seconds. `
        + "Do not delete action-claim state.",
      );
    }

    if (current) {
      const replaced = this.#db
        .query(
          `UPDATE ${OWNER_TABLE}
           SET owner_id=?,owner_generation=?,heartbeat=?
           WHERE singleton=1 AND owner_id=? AND owner_generation=? AND heartbeat<=?`,
        )
        .run(
          this.#ownerId,
          this.#ownerGeneration,
          now,
          current.owner_id,
          current.owner_generation,
          now - this.#ownerStaleMs,
        );
      if (replaced.changes !== 1) {
        throw new Error(`${this.#storeName} action-claim store ownership changed during stale-owner recovery.`);
      }
      return;
    }

    const inserted = this.#db
      .query(
        `INSERT INTO ${OWNER_TABLE}(singleton,owner_id,owner_generation,heartbeat)
         VALUES(1,?,?,?)`,
      )
      .run(this.#ownerId, this.#ownerGeneration, now);
    if (inserted.changes !== 1) {
      throw new Error(`${this.#storeName} action-claim store owner claim was not recorded.`);
    }
  }

  #heartbeat(): void {
    if (this.#closed) return;
    this.#transaction(() => {
      this.#assertOwned();
    });
  }

  #assertOwned(): void {
    if (this.#ownershipLost) {
      throw new Error(`${this.#storeName} action-claim store ownership was lost.`);
    }
    const now = this.#nowMs();
    const current = this.#db
      .query<OwnerRow, []>(
        `SELECT singleton,owner_id,owner_generation,heartbeat
         FROM ${OWNER_TABLE} WHERE singleton=1`,
      )
      .get();
    if (
      !current ||
      current.owner_id !== this.#ownerId ||
      current.owner_generation !== this.#ownerGeneration ||
      current.heartbeat <= now - this.#ownerStaleMs
    ) {
      this.#ownershipLost = true;
      throw new Error(`${this.#storeName} action-claim store ownership was lost or became stale.`);
    }
    const refreshed = this.#db
      .query(
        `UPDATE ${OWNER_TABLE}
         SET heartbeat=?
         WHERE singleton=1 AND owner_id=? AND owner_generation=? AND heartbeat>?`,
      )
      .run(now, this.#ownerId, this.#ownerGeneration, now - this.#ownerStaleMs);
    if (refreshed.changes !== 1) {
      this.#ownershipLost = true;
      throw new Error(`${this.#storeName} action-claim store ownership was lost during heartbeat.`);
    }
  }

  #transaction<T>(operation: () => T): T {
    return this.#db.transaction(operation).immediate();
  }

  #nowMs(): number {
    const value = this.#now();
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw new TypeError(`${this.#storeName} action-claim store clock must return a valid ISO timestamp.`);
    }
    return parsed;
  }

  #validateOptions(): void {
    if (!this.#storeName.trim()) throw new TypeError("Action-claim store name is required.");
    if (!this.#ownerId.trim()) throw new TypeError(`${this.#storeName} action-claim store owner id is required.`);
    if (!Number.isSafeInteger(this.#ownerStaleMs) || this.#ownerStaleMs < 1) {
      throw new TypeError(`${this.#storeName} action-claim store owner stale interval must be a positive integer.`);
    }
  }
}
