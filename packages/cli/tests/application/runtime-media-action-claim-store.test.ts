import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  defineRuntimeMediaActionClaim,
  type RuntimeMediaActionClaim,
} from "@kilnai/runtime";
import { SqliteRuntimeMediaActionClaimStore } from "../../src/application/runtime-media-action-claim-store.js";

function claim(overrides: Partial<Omit<RuntimeMediaActionClaim, "claimId" | "status">> = {}): RuntimeMediaActionClaim {
  return defineRuntimeMediaActionClaim({
    admissionId: `sha256:${"a".repeat(64)}`,
    sessionId: "session-1",
    turnId: "turn-1",
    attemptId: "attempt-1",
    ownerGeneration: "process-1",
    callerId: "voice-input",
    idempotencyKey: "message-1",
    actionKind: "stt-transcribe",
    sourceIdentity: "artifact:audio-1",
    adapterIdentity: "stt:whisper",
    logicalSendSlot: "inbound-stt:0",
    intentFingerprint: `sha256:${"b".repeat(64)}`,
    payloadFingerprint: `sha256:${"c".repeat(64)}`,
    effectIdentity: `sha256:${"d".repeat(64)}`,
    claimedAt: "2026-08-22T18:00:00.000Z",
    ...overrides,
  });
}

function path(): string {
  return join(mkdtempSync(join(tmpdir(), "kiln-runtime-media-")), "claims.sqlite");
}

describe("SqliteRuntimeMediaActionClaimStore", () => {
  it("rejects a fixed-path overlap before invalidating the live owner's permit", () => {
    const databasePath = path();
    const first = new SqliteRuntimeMediaActionClaimStore({ path: databasePath, ownerId: "first-owner" });
    const original = claim();
    const permit = first.claim(original);
    expect(() => new SqliteRuntimeMediaActionClaimStore({ path: databasePath, ownerId: "second-owner" }))
      .toThrow(/live owner/iu);
    expect(first.read(original.claimId)).toMatchObject({ status: "claimed" });
    permit.consume();
    first.settle(permit, { kind: "success" });
    first.close();
  });

  it("rejects a stale owner's permit after fail-closed successor recovery", () => {
    const databasePath = path();
    const now = "2026-01-01T00:00:00.000Z";
    const first = new SqliteRuntimeMediaActionClaimStore({ path: databasePath, now: () => now, ownerId: "first-owner" });
    const original = claim();
    const permit = first.claim(original);
    const inspection = new Database(databasePath, { strict: true });
    inspection.query("UPDATE runtime_action_claim_store_owner SET heartbeat=0").run();
    inspection.close();

    const successor = new SqliteRuntimeMediaActionClaimStore({ path: databasePath, now: () => now, ownerId: "second-owner" });
    expect(successor.read(original.claimId)).toMatchObject({ status: "unknown", outcome: "unknown" });
    expect(() => permit.consume()).toThrow(/ownership|stale/iu);
    successor.close();
    first.close();
  });

  it("rejects an obsolete schema without dropping its claimed evidence", () => {
    const databasePath = path();
    const legacy = new Database(databasePath, { create: true, strict: true });
    legacy.exec(`
      CREATE TABLE runtime_media_action_claims (
        claim_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        source_identity TEXT NOT NULL
      );
      INSERT INTO runtime_media_action_claims(claim_id,status,source_identity)
      VALUES('legacy-claim','claimed','artifact:audio-legacy');
    `);
    legacy.close();

    expect(() => new SqliteRuntimeMediaActionClaimStore({ path: databasePath }))
      .toThrow(/predates the canonical action-claim schema/iu);
    const retained = new Database(databasePath, { readonly: true, strict: true });
    expect(retained.query<{ claim_id: string; status: string; source_identity: string }, []>(
      "SELECT claim_id,status,source_identity FROM runtime_media_action_claims",
    ).get()).toEqual({ claim_id: "legacy-claim", status: "claimed", source_identity: "artifact:audio-legacy" });
    retained.close();
  });

  it("releases ownership before shutdown recovery and invalidates the old permit", () => {
    const databasePath = path();
    const first = new SqliteRuntimeMediaActionClaimStore({ path: databasePath });
    const original = claim();
    const permit = first.claim(original);
    first.close();

    const successor = new SqliteRuntimeMediaActionClaimStore({ path: databasePath });
    expect(successor.read(original.claimId)).toMatchObject({ status: "unknown" });
    expect(() => permit.consume()).toThrow(/closed/iu);
    successor.close();
  });

  it("preserves a claimed row as an unknown no-redispatch tombstone after reopen", () => {
    const databasePath = path();
    const first = new SqliteRuntimeMediaActionClaimStore({ path: databasePath, now: () => "2026-08-22T18:00:00.000Z" });
    const original = claim();
    const permit = first.claim(original);
    expect(first.read(original.claimId)).toMatchObject({ status: "claimed", sourceIdentity: original.sourceIdentity });
    first.close();

    const reopened = new SqliteRuntimeMediaActionClaimStore({ path: databasePath, now: () => "2026-08-22T18:01:00.000Z" });
    expect(reopened.read(original.claimId)).toMatchObject({ status: "unknown", outcome: "unknown" });
    expect(() => reopened.claim(original)).toThrow(/already exists|no redispatch|unknown/iu);
    expect(() => permit.consume()).toThrow(/closed/iu);
    reopened.close();
  });

  it("binds a stable caller/idempotency/slot and rejects payload mutation while allowing a new slot", () => {
    const store = new SqliteRuntimeMediaActionClaimStore({ path: path() });
    const first = claim();
    const permit = store.claim(first);
    permit.consume();
    store.settle(permit, { kind: "success" });

    expect(() => store.claim(claim({
      payloadFingerprint: `sha256:${"e".repeat(64)}`,
      effectIdentity: `sha256:${"f".repeat(64)}`,
    }))).toThrow(/already exists|immutable identity mismatch/iu);

    const second = store.claim(claim({ logicalSendSlot: "inbound-stt:1" }));
    expect(second.claimId).not.toBe(first.claimId);
    second.consume();
    store.settle(second, { kind: "unknown", reason: "provider response lost" });
    expect(store.read(second.claimId)).toMatchObject({ status: "unknown", reason: "provider response lost" });
    store.close();
  });

  it("enforces exact object identity and one-use permit settlement", () => {
    const store = new SqliteRuntimeMediaActionClaimStore({ path: path() });
    const permit = store.claim(claim());
    expect(() => store.settle(permit, { kind: "success" })).toThrow(/unknown|unconsumed/iu);
    permit.consume();
    expect(() => permit.consume()).toThrow(/already been consumed/iu);
    const forgedCopy = { ...permit } as typeof permit;
    expect(() => store.settle(forgedCopy, { kind: "success" })).toThrow(/unknown|unconsumed/iu);
    store.settle(permit, { kind: "success" });
    expect(() => store.settle(permit, { kind: "success" })).toThrow(/unknown|settled/iu);
    store.close();
  });
});
