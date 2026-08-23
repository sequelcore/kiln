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
  type ProviderModelRouteIdentity,
} from "@kilnai/core";
import type { ModelGatewayReplayFence, ModelGatewayReplayKey } from "./replay-claim.js";
import { createGovernedOneRoundDispatchPermit, type GovernedOneRoundDispatchPermit } from "../execution-kernel/dispatch-permit.js";
import {
  assertPersistableAuthorityAdmissionBundle,
} from "../session/authority-admission-evidence.js";
import { defineEffectiveAuthorityAdmissionBundle, type EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";
import {
  defineRuntimeSessionAuthorityFacet,
  type RuntimeSessionAuthorityFacet,
} from "../session/runtime-session-authority-facet.js";
import type {
  GovernedOneRoundAttemptEvidence,
  GovernedOneRoundAttemptEvidenceSink,
} from "../execution-kernel/governed-one-round-invocation.js";
import type {
  ModelGatewayAdmissionReceipt,
  ModelGatewayReplayActionInput,
  ModelGatewayReplayCompletedValue,
  ModelGatewayReplayDecision,
  ModelGatewayReplayFingerprintInput,
  ModelGatewayReplayGuard,
} from "./replay-guard.js";
import type { ModelGatewayCompatibilityEvidence } from "./governed-ingress-executor.js";
import type { CodexCompositeIngressCapacityEvidence } from "./codex-composite-router.js";

export interface LocalModelGatewayStoreOptions {
  readonly path: string;
  readonly replaySecret: string | Uint8Array;
  readonly replayTtlMs: number;
  readonly replayMaxEntries: number;
  readonly now?: () => number;
}
type ReplayRow = {
  status: "claimed" | "admitted" | "committed" | "committed-unknown" | "completed";
  attempt_id: string;
  fence: string;
  claim_expires_at: number | null;
  payload_expires_at: number | null;
  admission_id: `sha256:${string}` | null;
  effect_identity: string | null;
  ciphertext: Uint8Array | null;
  nonce: Uint8Array | null;
  tag: Uint8Array | null;
  authority_bundle_json: string | null;
};

/** Replay, cooldown, and portable evidence storage. Capacity and affinity are owned by the managed-account authority. */
export class LocalModelGatewayStore
  implements GovernedOneRoundAttemptEvidenceSink, ModelGatewayReplayGuard
{
  readonly compatibilityEvidence = {
    record: (evidence: ModelGatewayCompatibilityEvidence) =>
      this.recordCompatibility(evidence),
  };
  readonly ingressCapacityEvidence = {
    record: (evidence: CodexCompositeIngressCapacityEvidence) =>
      this.recordIngressCapacity(evidence),
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
        "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS attempt_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS compatibility_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS ingress_capacity_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS route_cooldowns (route_key TEXT PRIMARY KEY, cooldown_until INTEGER NOT NULL, reason TEXT NOT NULL); CREATE TABLE IF NOT EXISTS authority_session_facets (session_id TEXT PRIMARY KEY, facet_json TEXT NOT NULL);",
      );
      const replayColumns = this.#db.query<{ name: string }, []>("PRAGMA table_info(replay)").all();
      const replayColumnNames = new Set(replayColumns.map(({ name }) => name));
      const requiredReplayColumns = [
        "fingerprint", "status", "attempt_id", "fence", "claim_expires_at",
        "payload_expires_at", "admission_id", "effect_identity", "ciphertext",
        "nonce", "tag", "authority_bundle_json",
      ];
      const schemaIsUnsupported = replayColumns.length > 0 && (
        requiredReplayColumns.some((column) => !replayColumnNames.has(column))
        || replayColumnNames.has("tombstone_expires_at")
      );
      if (schemaIsUnsupported) {
        throw new Error(
          "Model Gateway replay schema predates canonical action claims; remove the obsolete workload-local database before restart.",
        );
      }
      this.#db.exec(
        "CREATE TABLE IF NOT EXISTS replay (fingerprint TEXT PRIMARY KEY, status TEXT NOT NULL, attempt_id TEXT NOT NULL, fence TEXT NOT NULL, claim_expires_at INTEGER, payload_expires_at INTEGER, admission_id TEXT, effect_identity TEXT, ciphertext BLOB, nonce BLOB, tag BLOB, authority_bundle_json TEXT)",
      );
      // A restart before the canonical action claim is safe to redispatch;
      // capacity recovery owns any stale held resource. Once committed, the
      // row is a no-redispatch tombstone and is never removed by TTL.
      this.#db.query("DELETE FROM replay WHERE status IN ('claimed','admitted')").run();
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
          "DELETE FROM replay WHERE status IN ('claimed','admitted') AND claim_expires_at IS NOT NULL AND claim_expires_at<=?",
        )
        .run(now);
      const row = this.#db
        .query<ReplayRow, [string]>(
          "SELECT status,attempt_id,fence,claim_expires_at,payload_expires_at,admission_id,effect_identity,ciphertext,nonce,tag,authority_bundle_json FROM replay WHERE fingerprint=?",
        )
        .get(key);
      if (row?.status === "claimed" || row?.status === "admitted")
        return {
          kind: "join-inflight",
          retryAfterSeconds: Math.max(
            1,
            Math.min(60, Math.ceil(((row.claim_expires_at ?? now) - now) / 1000)),
          ),
        };
      if (row?.status === "committed" || row?.status === "committed-unknown")
        return { kind: "committed-unknown" };
      if (row?.status === "completed") {
        if (row.payload_expires_at !== null && row.payload_expires_at <= now) return { kind: "committed-unknown" };
        return { kind: "replay-completed", value: this.#decrypt(key, row) };
      }
      if (
        this.#db
          .query<{ count: number }, []>("SELECT COUNT(*) count FROM replay WHERE status IN ('claimed','admitted')")
          .get()!.count >= this.#maxEntries
      )
        throw new Error("Replay guard capacity is exhausted.");
      const fence = randomUUID() as ModelGatewayReplayFence;
      const attemptId = `attempt-${randomUUID()}`;
      this.#db
        .query(
           "INSERT INTO replay(fingerprint,status,attempt_id,fence,claim_expires_at,payload_expires_at,admission_id,effect_identity) VALUES(?,?,?,?,?,?,?,?)",
         )
         .run(key, "claimed", attemptId, fence, now + this.#ttl, null, null, null);
      return { kind: "dispatch", key, fence, attemptId };
    });
  }
  /** Atomically binds the session facet, persists/readbacks the full bundle, and advances the pre-action claim. */
  persistAdmission(
    key: ModelGatewayReplayKey,
    fence: ModelGatewayReplayFence,
    bundle: EffectiveAuthorityAdmissionBundle,
  ): ModelGatewayAdmissionReceipt {
    const admitted = assertPersistableAuthorityAdmissionBundle(bundle);
    const facet = defineRuntimeSessionAuthorityFacet({
      sessionId: admitted.sessionId,
      sessionRevision: admitted.configuration.sessionRevision,
      ...admitted.session,
    });
    const bundleJson = JSON.stringify(admitted);
    const facetJson = JSON.stringify(facet);
    return this.#transaction(() => {
      const existing = this.#db
        .query<{ status: string; attempt_id: string; fence: string; authority_bundle_json: string | null }, [string]>(
          "SELECT status,attempt_id,fence,authority_bundle_json FROM replay WHERE fingerprint=?",
        )
        .get(key);
      if (!existing || existing.fence !== fence || existing.status !== "claimed") {
        throw new Error("Replay claim cannot be committed with authority admission.");
      }
      const existingFacet = this.#db
        .query<{ facet_json: string }, [string]>(
          "SELECT facet_json FROM authority_session_facets WHERE session_id=?",
        )
        .get(admitted.sessionId);
      if (existingFacet && existingFacet.facet_json !== facetJson) {
        throw new Error("Runtime session authority facet conflicts with the persisted session facet.");
      }
      this.#db
        .query("INSERT OR IGNORE INTO authority_session_facets(session_id,facet_json) VALUES(?,?)")
        .run(admitted.sessionId, facetJson);
      if (
        this.#db
          .query(
            "UPDATE replay SET status='admitted',claim_expires_at=?,admission_id=?,authority_bundle_json=? WHERE fingerprint=? AND fence=? AND status='claimed'",
          )
          .run(this.#now() + this.#ttl, admitted.admissionId, bundleJson, key, fence).changes !== 1
      ) throw new Error("Replay claim cannot be committed with authority admission.");
      const readback = this.#db
        .query<{ attempt_id: string; admission_id: `sha256:${string}`; authority_bundle_json: string }, [string, string]>(
          "SELECT attempt_id,admission_id,authority_bundle_json FROM replay WHERE fingerprint=? AND fence=? AND status='admitted'",
        )
        .get(key, fence);
      if (!readback || readback.admission_id !== admitted.admissionId) throw new Error("Persisted model gateway admission readback is unavailable.");
      let decoded: unknown;
      try { decoded = JSON.parse(readback.authority_bundle_json); } catch { throw new Error("Persisted model gateway admission is corrupt."); }
      const normalized = defineEffectiveAuthorityAdmissionBundle(decoded as EffectiveAuthorityAdmissionBundle);
      if (normalized.admissionId !== admitted.admissionId) throw new Error("Persisted model gateway admission digest is invalid.");
      return { attemptId: readback.attempt_id, admissionId: readback.admission_id, bundle: normalized };
    });
  }

  claimAction(
    key: ModelGatewayReplayKey,
    fence: ModelGatewayReplayFence,
    input: ModelGatewayReplayActionInput,
  ): GovernedOneRoundDispatchPermit {
    return this.#transaction(() => {
      const row = this.#db
        .query<{ status: string; attempt_id: string; admission_id: `sha256:${string}` | null }, [string, string]>(
          "SELECT status,attempt_id,admission_id FROM replay WHERE fingerprint=? AND fence=?",
        )
        .get(key, fence);
      if (!row || row.status !== "admitted" || row.admission_id !== input.admissionId) throw new Error("Replay action claim does not match the persisted admission.");
      if (!input.effectIdentity) throw new Error("Replay action effect identity is required.");
      if (
        this.#db
          .query("UPDATE replay SET status='committed',effect_identity=? WHERE fingerprint=? AND fence=? AND status='admitted' AND admission_id=?")
          .run(input.effectIdentity, key, fence, input.admissionId).changes !== 1
      ) throw new Error("Replay action claim is unavailable.");
      return createGovernedOneRoundDispatchPermit();
    });
  }

  loadSessionFacet(sessionId: string): RuntimeSessionAuthorityFacet | undefined {
    const row = this.#db
      .query<{ facet_json: string }, [string]>("SELECT facet_json FROM authority_session_facets WHERE session_id=?")
      .get(sessionId);
    if (!row) return undefined;
    let value: unknown;
    try { value = JSON.parse(row.facet_json); } catch { throw new Error("Persisted Runtime session authority facet is corrupt."); }
    if (!isObject(value)) throw new Error("Persisted Runtime session authority facet is corrupt.");
    const { facetId, ...input } = value as unknown as RuntimeSessionAuthorityFacet;
    const normalized = defineRuntimeSessionAuthorityFacet(input);
    if (normalized.facetId !== facetId) throw new Error("Persisted Runtime session authority facet digest is invalid.");
    return normalized;
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
      null,
    );
  }
  abandon(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void {
    this.#transaction(() => {
      if (
        this.#db
          .query(
            "DELETE FROM replay WHERE fingerprint=? AND fence=? AND status IN ('claimed','admitted')",
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
            "UPDATE replay SET status='completed',payload_expires_at=?,ciphertext=?,nonce=?,tag=? WHERE fingerprint=? AND fence=? AND status='committed'",
          )
          .run(this.#now() + this.#ttl, ciphertext, nonce, tag, key, fence)
          .changes !== 1
      )
        throw new Error("Replay claim cannot be completed.");
    });
  }
  coolRoute(
    route: ProviderModelRouteIdentity,
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
  isRouteCooling(route: ProviderModelRouteIdentity): boolean {
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
  async recordIngressCapacity(
    evidence: CodexCompositeIngressCapacityEvidence,
  ): Promise<void> {
    this.#db
      .query("INSERT INTO ingress_capacity_evidence(payload) VALUES(?)")
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
            "UPDATE replay SET status=?,payload_expires_at=? WHERE fingerprint=? AND fence=? AND status=?",
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
  #routeKey(route: ProviderModelRouteIdentity): string {
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
