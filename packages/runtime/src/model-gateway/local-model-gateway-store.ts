import { Database, constants } from "bun:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  validateModelTurnResult,
  type ModelGatewayReplayFence,
  type ModelGatewayReplayKey,
  type ModelGatewayRoute,
} from "@kilnai/core";
import type {
  GovernedOneRoundAttemptEvidence,
  GovernedOneRoundAttemptEvidenceSink,
} from "./governed-one-round-invocation.js";
import type {
  ModelGatewayReplayCompletedValue,
  ModelGatewayReplayDecision,
  ModelGatewayReplayFingerprintInput,
  ModelGatewayReplayGuard,
} from "./replay-guard.js";
import type { ModelGatewayCompatibilityEvidence } from "./governed-ingress-executor.js";

export interface LocalModelGatewayStoreOptions {
  readonly path: string;
  readonly replaySecret: string | Uint8Array;
  readonly replayTtlMs: number;
  readonly replayMaxEntries: number;
  readonly now?: () => number;
}
type ReplayRow = {
  status: "claimed" | "committed" | "committed-unknown" | "completed";
  fence: string;
  expires_at: number | null;
  ciphertext: Uint8Array | null;
  nonce: Uint8Array | null;
  tag: Uint8Array | null;
};

/** Replay, cooldown, and portable evidence storage. Capacity and affinity are owned by the managed-account authority. */
export class LocalModelGatewayStore
  implements GovernedOneRoundAttemptEvidenceSink, ModelGatewayReplayGuard
{
  readonly compatibilityEvidence = {
    record: (evidence: ModelGatewayCompatibilityEvidence) =>
      this.recordCompatibility(evidence),
  };
  readonly #db: Database;
  readonly #now: () => number;
  readonly #ttl: number;
  readonly #maxEntries: number;
  readonly #hmacKey: Buffer;
  readonly #encryptionKey: Buffer;
  #closed = false;
  constructor(options: LocalModelGatewayStoreOptions) {
    const secret =
      typeof options.replaySecret === "string"
        ? Buffer.from(options.replaySecret, "utf8")
        : Buffer.from(options.replaySecret);
    if (secret.byteLength < 32)
      throw new TypeError(
        "Local model gateway replay secret must contain at least 32 bytes.",
      );
    if (!Number.isSafeInteger(options.replayTtlMs) || options.replayTtlMs < 1)
      throw new TypeError("Replay TTL must be a positive integer.");
    if (
      !Number.isSafeInteger(options.replayMaxEntries) ||
      options.replayMaxEntries < 1
    )
      throw new TypeError("Replay capacity must be a positive integer.");
    this.#now = options.now ?? Date.now;
    this.#ttl = options.replayTtlMs;
    this.#maxEntries = options.replayMaxEntries;
    this.#hmacKey = secret;
    this.#encryptionKey = createHmac("sha256", secret)
      .update("kiln:model-gateway:completed:v1")
      .digest();
    this.#db = new Database(options.path, { create: true, strict: true });
    try {
      this.#db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS attempt_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS compatibility_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS route_cooldowns (route_key TEXT PRIMARY KEY, cooldown_until INTEGER NOT NULL, reason TEXT NOT NULL); CREATE TABLE IF NOT EXISTS replay (fingerprint TEXT PRIMARY KEY, status TEXT NOT NULL, fence TEXT NOT NULL, expires_at INTEGER, ciphertext BLOB, nonce BLOB, tag BLOB);",
      );
      this.#db.query("DELETE FROM replay WHERE status='claimed'").run();
      this.#db
        .query(
          "UPDATE replay SET status='committed-unknown',expires_at=? WHERE status='committed'",
        )
        .run(this.#now() + this.#ttl);
    } catch (error) {
      this.#db.close(true);
      throw error;
    }
  }
  fingerprint(
    input: ModelGatewayReplayFingerprintInput,
  ): ModelGatewayReplayKey {
    const h = createHmac("sha256", this.#hmacKey);
    for (const value of [
      "kiln-replay-v1",
      input.ingress,
      input.tenantId,
      input.applicationId,
      input.callerId,
      input.sessionId,
      input.turnId,
      input.route.providerId,
      input.route.providerModelId,
      input.route.scope,
      input.toolExecutionMode,
      input.affinityKey ?? "",
      input.rawBody,
    ]) {
      const bytes = Buffer.from(value, "utf8");
      h.update(`${bytes.byteLength}:`);
      h.update(bytes);
      h.update(";");
    }
    return h.digest("hex") as ModelGatewayReplayKey;
  }
  claim(key: ModelGatewayReplayKey): ModelGatewayReplayDecision {
    return this.#transaction(() => {
      const now = this.#now();
      this.#db
        .query(
          "DELETE FROM replay WHERE expires_at IS NOT NULL AND expires_at<=?",
        )
        .run(now);
      const row = this.#db
        .query<ReplayRow, [string]>(
          "SELECT status,fence,expires_at,ciphertext,nonce,tag FROM replay WHERE fingerprint=?",
        )
        .get(key);
      if (row?.status === "claimed")
        return {
          kind: "join-inflight",
          retryAfterSeconds: Math.max(
            1,
            Math.min(60, Math.ceil(((row.expires_at ?? now) - now) / 1000)),
          ),
        };
      if (row?.status === "committed" || row?.status === "committed-unknown")
        return { kind: "committed-unknown" };
      if (row?.status === "completed")
        return { kind: "replay-completed", value: this.#decrypt(key, row) };
      if (
        this.#db
          .query<{ count: number }, []>("SELECT COUNT(*) count FROM replay")
          .get()!.count >= this.#maxEntries
      )
        throw new Error("Replay guard capacity is exhausted.");
      const fence = randomUUID() as ModelGatewayReplayFence;
      this.#db
        .query(
          "INSERT INTO replay(fingerprint,status,fence,expires_at) VALUES(?,?,?,?)",
        )
        .run(key, "claimed", fence, now + this.#ttl);
      return { kind: "dispatch", key, fence };
    });
  }
  markCommitted(
    key: ModelGatewayReplayKey,
    fence: ModelGatewayReplayFence,
  ): void {
    this.#transition(key, fence, "claimed", "committed", null);
  }
  settleUnknown(
    key: ModelGatewayReplayKey,
    fence: ModelGatewayReplayFence,
  ): void {
    this.#transition(
      key,
      fence,
      "committed",
      "committed-unknown",
      this.#now() + this.#ttl,
    );
  }
  abandon(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void {
    this.#transaction(() => {
      if (
        this.#db
          .query(
            "DELETE FROM replay WHERE fingerprint=? AND fence=? AND status='claimed'",
          )
          .run(key, fence).changes !== 1
      )
        throw new Error("Replay claim cannot be abandoned.");
    });
  }
  complete(
    key: ModelGatewayReplayKey,
    fence: ModelGatewayReplayFence,
    value: ModelGatewayReplayCompletedValue,
  ): void {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#encryptionKey, nonce);
    cipher.setAAD(Buffer.from(key, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    this.#transaction(() => {
      if (
        this.#db
          .query(
            "UPDATE replay SET status='completed',expires_at=?,ciphertext=?,nonce=?,tag=? WHERE fingerprint=? AND fence=? AND status='committed'",
          )
          .run(this.#now() + this.#ttl, ciphertext, nonce, tag, key, fence)
          .changes !== 1
      )
        throw new Error("Replay claim cannot be completed.");
    });
  }
  coolRoute(
    route: ModelGatewayRoute,
    cooldownUntil: number,
    reason: "rate-limited" | "upstream-transient",
  ): void {
    this.#transaction(() =>
      this.#db
        .query(
          "INSERT OR REPLACE INTO route_cooldowns(route_key,cooldown_until,reason) VALUES(?,?,?)",
        )
        .run(this.#routeKey(route), cooldownUntil, reason),
    );
  }
  isRouteCooling(route: ModelGatewayRoute): boolean {
    return this.#transaction(() => {
      const now = this.#now();
      this.#db
        .query("DELETE FROM route_cooldowns WHERE cooldown_until<=?")
        .run(now);
      return (
        this.#db
          .query<{ found: number }, [string, number]>(
            "SELECT 1 found FROM route_cooldowns WHERE route_key=? AND cooldown_until>?",
          )
          .get(this.#routeKey(route), now)?.found === 1
      );
    });
  }
  async record(evidence: GovernedOneRoundAttemptEvidence): Promise<void> {
    this.#db
      .query("INSERT INTO attempt_evidence(payload) VALUES(?)")
      .run(JSON.stringify(evidence));
  }
  async recordCompatibility(
    evidence: ModelGatewayCompatibilityEvidence,
  ): Promise<void> {
    this.#db
      .query("INSERT INTO compatibility_evidence(payload) VALUES(?)")
      .run(JSON.stringify(evidence));
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
      this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } finally {
      this.#db.close(true);
    }
  }
  #transition(
    key: ModelGatewayReplayKey,
    fence: ModelGatewayReplayFence,
    from: string,
    to: string,
    expires: number | null,
  ): void {
    this.#transaction(() => {
      if (
        this.#db
          .query(
            "UPDATE replay SET status=?,expires_at=? WHERE fingerprint=? AND fence=? AND status=?",
          )
          .run(to, expires, key, fence, from).changes !== 1
      )
        throw new Error("Stale replay fence.");
    });
  }
  #decrypt(
    key: ModelGatewayReplayKey,
    row: ReplayRow,
  ): ModelGatewayReplayCompletedValue {
    if (!row.ciphertext || !row.nonce || !row.tag)
      throw new Error("Replay payload is corrupt.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#encryptionKey,
      row.nonce,
    );
    decipher.setAAD(Buffer.from(key, "utf8"));
    decipher.setAuthTag(row.tag);
    const value: unknown = JSON.parse(
      Buffer.concat([
        decipher.update(row.ciphertext),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (
      !isObject(value) ||
      typeof value.responseId !== "string" ||
      !isObject(value.result)
    )
      throw new Error("Replay payload schema is invalid.");
    try {
      validateModelTurnResult(value.result as never);
    } catch {
      throw new Error("Replay payload schema is invalid.");
    }
    return value as unknown as ModelGatewayReplayCompletedValue;
  }
  #routeKey(route: ModelGatewayRoute): string {
    const h = createHmac("sha256", this.#hmacKey);
    for (const value of [
      "kiln-route-cooldown-v1",
      route.providerId,
      route.providerModelId,
      route.scope,
    ]) {
      const bytes = Buffer.from(value, "utf8");
      h.update(`${bytes.byteLength}:`);
      h.update(bytes);
      h.update(";");
    }
    return h.digest("hex");
  }
  #transaction<T>(operation: () => T): T {
    return this.#db.transaction(operation).immediate();
  }
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
