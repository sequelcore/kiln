import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  defineChannelEgressActionClaim,
  type ChannelEgressActionClaim,
} from "@kilnai/runtime";
import { SqliteChannelEgressActionClaimStore } from "../../src/application/channel-egress-action-claim-store.js";

function claim(overrides: Partial<Omit<ChannelEgressActionClaim, "claimId" | "status">> = {}): ChannelEgressActionClaim {
  return defineChannelEgressActionClaim({
    admissionId: `sha256:${"a".repeat(64)}`,
    sessionId: "session-1",
    turnId: "turn-1",
    attemptId: "attempt-1",
    ownerGeneration: "process-1",
    callerId: "outbound-api",
    idempotencyKey: "caller-key-1",
    channel: "whatsapp",
    destination: "whatsapp:phone-1:user-1",
    adapterIdentity: "whatsapp-cloud:v21.0:phone-1",
    logicalSendSlot: "message-0",
    intentFingerprint: `sha256:${"b".repeat(64)}`,
    payloadFingerprint: `sha256:${"c".repeat(64)}`,
    effectIdentity: `sha256:${"d".repeat(64)}`,
    claimedAt: "2026-08-22T18:00:00.000Z",
    ...overrides,
  });
}

function options(path: string) {
  let counter = 0;
  return {
    path,
    now: () => "2026-08-22T18:00:00.000Z",
    idGenerator: () => `permit-${++counter}`,
  } as const;
}

describe("SqliteChannelEgressActionClaimStore", () => {
  it("rejects a fixed-path overlap before invalidating the live owner's permit", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiln-channel-egress-owner-"));
    const path = join(dir, "claims.sqlite");
    const first = new SqliteChannelEgressActionClaimStore({ ...options(path), ownerId: "first-owner" });
    const original = claim();
    const permit = first.claim(original);
    expect(() => new SqliteChannelEgressActionClaimStore({ ...options(path), ownerId: "second-owner" }))
      .toThrow(/live owner/iu);
    expect(first.read(original.claimId)).toMatchObject({ status: "claimed" });
    permit.consume();
    first.settle(permit, { kind: "success" });
    first.close();
  });

  it("rejects a stale owner's permit after fail-closed successor recovery", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiln-channel-egress-stale-"));
    const path = join(dir, "claims.sqlite");
    const now = "2026-01-01T00:00:00.000Z";
    const first = new SqliteChannelEgressActionClaimStore({ ...options(path), now: () => now, ownerId: "first-owner" });
    const original = claim();
    const permit = first.claim(original);
    const inspection = new Database(path, { strict: true });
    inspection.query("UPDATE runtime_action_claim_store_owner SET heartbeat=0").run();
    inspection.close();

    const successor = new SqliteChannelEgressActionClaimStore({ ...options(path), now: () => now, ownerId: "second-owner" });
    expect(successor.read(original.claimId)).toMatchObject({ status: "unknown", outcome: "unknown" });
    expect(() => permit.consume()).toThrow(/ownership|stale/iu);
    successor.close();
    first.close();
  });

  it("releases ownership before shutdown recovery and invalidates the old permit", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiln-channel-egress-shutdown-"));
    const path = join(dir, "claims.sqlite");
    const first = new SqliteChannelEgressActionClaimStore({ ...options(path) });
    const original = claim();
    const permit = first.claim(original);
    first.close();

    const successor = new SqliteChannelEgressActionClaimStore({ ...options(path) });
    expect(successor.read(original.claimId)).toMatchObject({ status: "unknown" });
    expect(() => permit.consume()).toThrow(/closed/iu);
    successor.close();
  });

  it("persists the exact secret-free claim and makes an unsettled claim unknown after restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiln-channel-egress-"));
    const path = join(dir, "claims.sqlite");
    const first = new SqliteChannelEgressActionClaimStore(options(path));
    const original = claim();
    const permit = first.claim(original);
    expect(first.read(original.claimId)).toMatchObject({
      claimId: original.claimId,
      destination: original.destination,
      adapterIdentity: original.adapterIdentity,
      payloadFingerprint: original.payloadFingerprint,
      status: "claimed",
    });
    expect(JSON.stringify(first.read(original.claimId))).not.toContain("accessToken");
    first.close();

    const restarted = new SqliteChannelEgressActionClaimStore(options(path));
    expect(restarted.read(original.claimId)).toMatchObject({ status: "unknown", outcome: "unknown" });
    expect(() => restarted.claim(original)).toThrow(/already exists|unknown|no redispatch/iu);
    expect(() => permit.consume()).toThrow(/closed/iu);
    restarted.close();
  });

  it("binds a stable caller/idempotency/slot once while permitting separate send slots", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiln-channel-egress-"));
    const store = new SqliteChannelEgressActionClaimStore(options(join(dir, "claims.sqlite")));
    const first = claim();
    const permit = store.claim(first);
    permit.consume();
    store.settle(permit, { kind: "success" });

    expect(() => store.claim({ ...first, payloadFingerprint: `sha256:${"e".repeat(64)}`, effectIdentity: `sha256:${"f".repeat(64)}` })).toThrow(/already exists|immutable identity mismatch/iu);

    const second = store.claim(claim({ logicalSendSlot: "message-1" }));
    expect(second.claimId).not.toBe(first.claimId);
    second.consume();
    store.settle(second, { kind: "unknown", reason: "provider response lost" });
    expect(store.read(second.claimId)).toMatchObject({ status: "unknown", reason: "provider response lost" });
    store.close();
  });

  it("enforces opaque one-use permits at settlement", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiln-channel-egress-"));
    const store = new SqliteChannelEgressActionClaimStore(options(join(dir, "claims.sqlite")));
    const permit = store.claim(claim());
    permit.consume();
    expect(() => permit.consume()).toThrow(/already been consumed/iu);
    const forgedCopy = { ...permit } as typeof permit;
    expect(() => store.settle(forgedCopy, { kind: "success" })).toThrow(/unknown|consumed/iu);
    store.settle(permit, { kind: "success" });
    expect(() => store.settle(permit, { kind: "success" })).toThrow(/already consumed|unknown/iu);
    store.close();
  });
});
