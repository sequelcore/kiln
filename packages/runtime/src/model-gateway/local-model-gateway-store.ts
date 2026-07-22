import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createAccountRef, validateModelTurnResult, type ModelGatewayReplayFence, type ModelGatewayReplayKey, type ModelGatewayRoute } from "@kilnai/core";
import type { GovernedOneRoundAccountLease, GovernedOneRoundAffinityStore, GovernedOneRoundAttemptEvidence, GovernedOneRoundAttemptEvidenceSink } from "./governed-one-round-invocation.js";
import type { ModelGatewayReplayCompletedValue, ModelGatewayReplayDecision, ModelGatewayReplayFingerprintInput, ModelGatewayReplayGuard } from "./replay-guard.js";
import type { ModelGatewayCompatibilityEvidence } from "./governed-ingress-executor.js";

export interface LocalModelGatewayStoreAccount { readonly accountRef: string; readonly maxConcurrency: number; readonly reservedAffinitySlots: number }
export interface LocalModelGatewayStoreOptions {
  readonly path: string;
  readonly replaySecret: string | Uint8Array;
  readonly replayTtlMs: number;
  readonly replayMaxEntries: number;
  readonly accounts: readonly LocalModelGatewayStoreAccount[];
  readonly ownerId?: string;
  readonly now?: () => number;
  readonly ownerStaleMs?: number;
}

type ReplayRow = { status: "claimed" | "committed" | "committed-unknown" | "completed"; fence: string; expires_at: number | null; ciphertext: Uint8Array | null; nonce: Uint8Array | null; tag: Uint8Array | null };

/** Durable local authority for exactly one live runtime owner. */
export class LocalModelGatewayStore implements GovernedOneRoundAffinityStore, GovernedOneRoundAccountLease, GovernedOneRoundAttemptEvidenceSink, ModelGatewayReplayGuard {
  readonly compatibilityEvidence = { record: (evidence: ModelGatewayCompatibilityEvidence) => this.recordCompatibility(evidence) };
  readonly #db: Database;
  readonly #ownerId: string;
  readonly #now: () => number;
  readonly #ownerStaleMs: number;
  readonly #ttl: number;
  readonly #maxEntries: number;
  readonly #hmacKey: Buffer;
  readonly #encryptionKey: Buffer;
  readonly #accounts = new Map<string, LocalModelGatewayStoreAccount>();
  readonly #heartbeatTimer: ReturnType<typeof setInterval>;
  #closed = false;

  constructor(options: LocalModelGatewayStoreOptions) {
    const secret = typeof options.replaySecret === "string" ? Buffer.from(options.replaySecret, "utf8") : Buffer.from(options.replaySecret);
    if (secret.byteLength < 32) throw new TypeError("Local model gateway replay secret must contain at least 32 bytes.");
    if (!Number.isSafeInteger(options.replayTtlMs) || options.replayTtlMs < 1) throw new TypeError("Replay TTL must be a positive integer.");
    if (!Number.isSafeInteger(options.replayMaxEntries) || options.replayMaxEntries < 1) throw new TypeError("Replay capacity must be a positive integer.");
    this.#ownerId = options.ownerId ?? randomUUID(); this.#now = options.now ?? Date.now; this.#ownerStaleMs = options.ownerStaleMs ?? 30_000;
    this.#ttl = options.replayTtlMs; this.#maxEntries = options.replayMaxEntries; this.#hmacKey = secret;
    this.#encryptionKey = createHmac("sha256", secret).update("kiln:model-gateway:completed:v1").digest();
    for (const account of options.accounts) this.#accounts.set(account.accountRef, account);
    this.#db = new Database(options.path, { create: true, strict: true });
    try {
      this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
      this.#db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner_id TEXT NOT NULL, heartbeat INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS affinities (key TEXT PRIMARY KEY, account_ref TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, scope TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leases (
        lease_id TEXT PRIMARY KEY, account_ref TEXT NOT NULL, purpose TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        tenant_id TEXT NOT NULL, application_id TEXT NOT NULL, caller_id TEXT NOT NULL, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
        provider_id TEXT NOT NULL, model_id TEXT NOT NULL, route_scope TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempt_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS compatibility_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS route_cooldowns (route_key TEXT PRIMARY KEY, cooldown_until INTEGER NOT NULL, reason TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS replay (fingerprint TEXT PRIMARY KEY, status TEXT NOT NULL, fence TEXT NOT NULL, expires_at INTEGER, ciphertext BLOB, nonce BLOB, tag BLOB);
      `);
      this.#claimOwnerAndRecover();
    } catch (error) { this.#db.close(); throw error; }
    this.#heartbeatTimer = setInterval(() => { try { this.#heartbeat(); } catch { /* foreground operations fail closed on lost ownership */ } }, Math.max(250, Math.floor(this.#ownerStaleMs / 3)));
    this.#heartbeatTimer.unref?.();
  }

  fingerprint(input: ModelGatewayReplayFingerprintInput): ModelGatewayReplayKey {
    const h = createHmac("sha256", this.#hmacKey);
    for (const value of ["kiln-replay-v1", input.ingress, input.tenantId, input.applicationId, input.callerId, input.sessionId, input.turnId, input.route.providerId, input.route.providerModelId, input.route.scope, input.toolExecutionMode, input.affinityKey ?? "", input.rawBody]) {
      const bytes = Buffer.from(value, "utf8"); h.update(`${bytes.byteLength}:`); h.update(bytes); h.update(";");
    }
    return h.digest("hex") as ModelGatewayReplayKey;
  }

  claim(key: ModelGatewayReplayKey): ModelGatewayReplayDecision {
    return this.#transaction(() => {
      this.#heartbeat(); const now = this.#now();
      this.#db.query("DELETE FROM replay WHERE expires_at IS NOT NULL AND expires_at <= ?").run(now);
      const row = this.#db.query<ReplayRow, [string]>("SELECT status,fence,expires_at,ciphertext,nonce,tag FROM replay WHERE fingerprint=?").get(key);
      if (row?.status === "claimed") return { kind: "join-inflight", retryAfterSeconds: Math.max(1, Math.min(60, Math.ceil(((row.expires_at ?? now) - now) / 1000))) };
      if (row?.status === "committed" || row?.status === "committed-unknown") return { kind: "committed-unknown" };
      if (row?.status === "completed") return { kind: "replay-completed", value: this.#decrypt(key, row) };
      const count = this.#db.query<{ count: number }, []>("SELECT COUNT(*) count FROM replay").get()!.count;
      if (count >= this.#maxEntries) throw new Error("Replay guard capacity is exhausted.");
      const fence = randomUUID() as ModelGatewayReplayFence;
      this.#db.query("INSERT INTO replay(fingerprint,status,fence,expires_at) VALUES(?,?,?,?)").run(key, "claimed", fence, now + this.#ttl);
      return { kind: "dispatch", key, fence };
    });
  }

  markCommitted(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void { this.#transition(key, fence, "claimed", "committed", null); }
  settleUnknown(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void { this.#transition(key, fence, "committed", "committed-unknown", this.#now() + this.#ttl); }
  abandon(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void {
    this.#transaction(() => { this.#heartbeat(); const result = this.#db.query("DELETE FROM replay WHERE fingerprint=? AND fence=? AND status='claimed'").run(key, fence); if (result.changes !== 1) throw new Error("Replay claim cannot be abandoned."); });
  }
  complete(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence, value: ModelGatewayReplayCompletedValue): void {
    const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.#encryptionKey, nonce); cipher.setAAD(Buffer.from(key, "utf8")); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); const tag = cipher.getAuthTag();
    this.#transaction(() => { this.#heartbeat(); const result = this.#db.query("UPDATE replay SET status='completed',expires_at=?,ciphertext=?,nonce=?,tag=? WHERE fingerprint=? AND fence=? AND status='committed'").run(this.#now() + this.#ttl, ciphertext, nonce, tag, key, fence); if (result.changes !== 1) throw new Error("Replay claim cannot be completed."); });
  }

  async read(input: { readonly identity: { readonly tenantId: string; readonly applicationId: string; readonly callerId: string }; readonly route: ModelGatewayRoute; readonly key: string }) { this.#heartbeat(); const affinityKey = this.#affinityKey(input); const row = this.#db.query<{ account_ref: string; provider_id: string; model_id: string; scope: string }, [string]>("SELECT account_ref,provider_id,model_id,scope FROM affinities WHERE key=?").get(affinityKey); return row ? { account: createAccountRef(row.account_ref), route: { providerId: row.provider_id, providerModelId: row.model_id, scope: row.scope } } : undefined; }
  async write(input: { readonly identity: { readonly tenantId: string; readonly applicationId: string; readonly callerId: string }; readonly route: ModelGatewayRoute; readonly key: string; readonly affinity: { readonly account: string } }): Promise<void> { this.#transaction(() => { this.#heartbeat(); this.#db.query("INSERT OR REPLACE INTO affinities(key,account_ref,provider_id,model_id,scope) VALUES(?,?,?,?,?)").run(this.#affinityKey(input), input.affinity.account, input.route.providerId, input.route.providerModelId, input.route.scope); }); }
  async acquire(input: { readonly identity: { readonly tenantId: string; readonly applicationId: string; readonly callerId: string; readonly sessionId: string; readonly turnId: string }; readonly route: ModelGatewayRoute; readonly account: string; readonly purpose: "new" | "affinity" }): Promise<{ readonly leaseId: string } | undefined> {
    return this.#transaction(() => {
      this.#heartbeat(); const config = this.#accounts.get(input.account); if (!config) return undefined;
      const counts = this.#db.query<{ total: number; new_work: number }, [string]>("SELECT COUNT(*) total, SUM(CASE WHEN purpose='new' THEN 1 ELSE 0 END) new_work FROM leases WHERE account_ref=?").get(input.account)!;
      const newWorkLimit = config.maxConcurrency - config.reservedAffinitySlots;
      if (counts.total >= config.maxConcurrency || (input.purpose === "new" && counts.new_work >= newWorkLimit)) return undefined;
      const leaseId = randomUUID();
      this.#db.query("INSERT INTO leases VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(leaseId, input.account, input.purpose, this.#ownerId, this.#now(), input.identity.tenantId, input.identity.applicationId, input.identity.callerId, input.identity.sessionId, input.identity.turnId, input.route.providerId, input.route.providerModelId, input.route.scope);
      return { leaseId };
    });
  }
  async release(input: { readonly leaseId: string }): Promise<void> { this.#transaction(() => { this.#heartbeat(); this.#db.query("DELETE FROM leases WHERE lease_id=? AND owner_id=?").run(input.leaseId, this.#ownerId); }); }
  pressure(accountRef: string): number { this.#heartbeat(); const config = this.#accounts.get(accountRef); if (!config) return 1; const count = this.#db.query<{ count: number }, [string]>("SELECT COUNT(*) count FROM leases WHERE account_ref=?").get(accountRef)?.count ?? 0; return count / config.maxConcurrency; }
  isNewWorkReserved(accountRef: string): boolean { this.#heartbeat(); const config = this.#accounts.get(accountRef); if (!config) return true; const counts = this.#db.query<{ total: number; new_work: number }, [string]>("SELECT COUNT(*) total, SUM(CASE WHEN purpose='new' THEN 1 ELSE 0 END) new_work FROM leases WHERE account_ref=?").get(accountRef)!; return counts.total >= config.maxConcurrency || counts.new_work >= config.maxConcurrency - config.reservedAffinitySlots; }
  coolRoute(route: ModelGatewayRoute, cooldownUntil: number, reason: "rate-limited" | "upstream-transient"): void { this.#transaction(() => { this.#heartbeat(); this.#db.query("INSERT OR REPLACE INTO route_cooldowns(route_key,cooldown_until,reason) VALUES(?,?,?)").run(this.#routeKey(route), cooldownUntil, reason); }); }
  isRouteCooling(route: ModelGatewayRoute): boolean { return this.#transaction(() => { this.#heartbeat(); const now = this.#now(); this.#db.query("DELETE FROM route_cooldowns WHERE cooldown_until<=?").run(now); return this.#db.query<{ found: number }, [string, number]>("SELECT 1 found FROM route_cooldowns WHERE route_key=? AND cooldown_until>?").get(this.#routeKey(route), now)?.found === 1; }); }
  configureAccount(account: LocalModelGatewayStoreAccount): void { this.#accounts.set(account.accountRef, account); }
  verifyLease(input: { readonly leaseId: string; readonly accountRef: string; readonly identity: { readonly tenantId: string; readonly applicationId: string; readonly callerId: string; readonly sessionId: string; readonly turnId: string }; readonly route: ModelGatewayRoute }): boolean { this.#heartbeat(); return this.#db.query<{ ok: number }, [string, string, string, string, string, string, string, string, string, string, string]>("SELECT 1 ok FROM leases WHERE lease_id=? AND account_ref=? AND owner_id=? AND tenant_id=? AND application_id=? AND caller_id=? AND session_id=? AND turn_id=? AND provider_id=? AND model_id=? AND route_scope=?").get(input.leaseId, input.accountRef, this.#ownerId, input.identity.tenantId, input.identity.applicationId, input.identity.callerId, input.identity.sessionId, input.identity.turnId, input.route.providerId, input.route.providerModelId, input.route.scope)?.ok === 1; }
  async record(evidence: GovernedOneRoundAttemptEvidence): Promise<void> { this.#transaction(() => { this.#heartbeat(); this.#db.query("INSERT INTO attempt_evidence(payload) VALUES(?)").run(JSON.stringify(evidence)); }); }
  async recordCompatibility(evidence: ModelGatewayCompatibilityEvidence): Promise<void> { this.#transaction(() => { this.#heartbeat(); this.#db.query("INSERT INTO compatibility_evidence(payload) VALUES(?)").run(JSON.stringify(evidence)); }); }

  close(): void { if (this.#closed) return; this.#closed = true; clearInterval(this.#heartbeatTimer); try { this.#db.query("DELETE FROM runtime_owner WHERE singleton=1 AND owner_id=?").run(this.#ownerId); this.#db.query("DELETE FROM leases WHERE owner_id=?").run(this.#ownerId); } finally { this.#db.close(); } }

  #transition(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence, from: string, to: string, expires: number | null): void { this.#transaction(() => { this.#heartbeat(); const result = this.#db.query("UPDATE replay SET status=?,expires_at=? WHERE fingerprint=? AND fence=? AND status=?").run(to, expires, key, fence, from); if (result.changes !== 1) throw new Error("Stale replay fence."); }); }
  #decrypt(key: ModelGatewayReplayKey, row: ReplayRow): ModelGatewayReplayCompletedValue { if (!row.ciphertext || !row.nonce || !row.tag) throw new Error("Replay payload is corrupt."); const decipher = createDecipheriv("aes-256-gcm", this.#encryptionKey, row.nonce); decipher.setAAD(Buffer.from(key, "utf8")); decipher.setAuthTag(Buffer.from(row.tag)); const value: unknown = JSON.parse(Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8")); if (!isObject(value) || typeof value.responseId !== "string" || value.responseId.length === 0 || !isObject(value.result)) throw new Error("Replay payload schema is invalid."); try { validateModelTurnResult(value.result as never); } catch { throw new Error("Replay payload schema is invalid."); } return value as unknown as ModelGatewayReplayCompletedValue; }
  #affinityKey(input: { readonly identity: { readonly tenantId: string; readonly applicationId: string; readonly callerId: string }; readonly route: ModelGatewayRoute; readonly key: string }): string { const h = createHmac("sha256", this.#hmacKey); for (const value of ["kiln-affinity-v1", input.identity.tenantId, input.identity.applicationId, input.identity.callerId, input.route.providerId, input.route.providerModelId, input.route.scope, input.key]) { const bytes = Buffer.from(value, "utf8"); h.update(`${bytes.byteLength}:`); h.update(bytes); h.update(";"); } return h.digest("hex"); }
  #routeKey(route: ModelGatewayRoute): string { const h = createHmac("sha256", this.#hmacKey); for (const value of ["kiln-route-cooldown-v1", route.providerId, route.providerModelId, route.scope]) { const bytes = Buffer.from(value, "utf8"); h.update(`${bytes.byteLength}:`); h.update(bytes); h.update(";"); } return h.digest("hex"); }
  #heartbeat(): void { const result = this.#db.query("UPDATE runtime_owner SET heartbeat=? WHERE singleton=1 AND owner_id=?").run(this.#now(), this.#ownerId); if (result.changes !== 1) throw new Error("Local model gateway runtime ownership was lost."); }
  #claimOwnerAndRecover(): void { this.#transaction(() => { const now = this.#now(); const owner = this.#db.query<{ owner_id: string; heartbeat: number }, []>("SELECT owner_id,heartbeat FROM runtime_owner WHERE singleton=1").get(); if (owner && owner.owner_id !== this.#ownerId && owner.heartbeat > now - this.#ownerStaleMs) throw new Error("Local model gateway already has a live runtime owner."); this.#db.query("INSERT OR REPLACE INTO runtime_owner VALUES(1,?,?)").run(this.#ownerId, now); this.#db.query("DELETE FROM leases").run(); this.#db.query("DELETE FROM replay WHERE status='claimed'").run(); this.#db.query("UPDATE replay SET status='committed-unknown',expires_at=? WHERE status='committed'").run(now + this.#ttl); }); }
  #transaction<T>(operation: () => T): T { return this.#db.transaction(operation).immediate(); }
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
