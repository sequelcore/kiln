import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import {
  defineManagedExternalInvocationActionClaim,
  managedExternalInvocationDigest,
} from "../../../runtime/src/agents/managed-invocation/external-invocation-action-claim.js";
import { SqliteManagedExternalInvocationActionClaimStore } from "../../src/application/managed-external-invocation-action-claim-store.js";

function claim(routeAck = "route:provider:remote-harness:model") {
  return defineManagedExternalInvocationActionClaim({
    admissionId: managedExternalInvocationDigest("admission"),
    sessionId: "session",
    turnId: "turn",
    invocationId: "invocation",
    attemptId: "invocation",
    round: 0,
    ownerGeneration: "owner-1",
    routeAck,
    intentFingerprint: managedExternalInvocationDigest("intent"),
    effectIdentity: managedExternalInvocationDigest({ routeAck, effect: "invoke" }),
    effectKind: "remote-invoke",
  });
}

describe("SqliteManagedExternalInvocationActionClaimStore", () => {
  it("rejects an overlapping fixed-path owner without recovering its live claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-external-overlap-"));
    const path = join(root, "runtime", "claims.sqlite");
    const first = new SqliteManagedExternalInvocationActionClaimStore({ path, ownerId: "first-owner" });
    const pending = claim();
    const permit = first.claim(pending);

    expect(() => new SqliteManagedExternalInvocationActionClaimStore({ path, ownerId: "second-owner" })).toThrow(/live owner/iu);
    expect(first.read(pending.claimId)).toMatchObject({ status: "claimed" });
    permit.consume();
    first.settle(permit, { kind: "success" });
    first.close();
  });

  it("rejects a stale permit after a successor transactionally recovers the claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-external-stale-"));
    const path = join(root, "runtime", "claims.sqlite");
    const now = "2026-08-22T18:00:00.000Z";
    const first = new SqliteManagedExternalInvocationActionClaimStore({ path, now: () => now, ownerId: "first-owner" });
    const pending = claim();
    const permit = first.claim(pending);
    const inspection = new Database(path, { strict: true });
    inspection.query("UPDATE runtime_action_claim_store_owner SET heartbeat=0").run();
    inspection.close();

    const successor = new SqliteManagedExternalInvocationActionClaimStore({ path, now: () => now, ownerId: "second-owner" });
    expect(successor.read(pending.claimId)).toMatchObject({
      status: "unknown",
      outcome: "unknown",
      reason: "process-restarted-before-settlement",
    });
    expect(() => permit.consume()).toThrow(/ownership|stale/iu);
    first.close();
    expect(successor.read(pending.claimId)).toMatchObject({ status: "unknown" });
    successor.close();
  });

  it("binds one effect slot, requires a consumed opaque permit, and rejects mutated identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-external-claims-"));
    const store = new SqliteManagedExternalInvocationActionClaimStore({
      path: join(root, "runtime", "claims.sqlite"),
      idGenerator: () => "permit-1",
    });
    const first = claim();
    const permit = store.claim(first);
    expect(() => store.settle(permit, { kind: "success" })).toThrow(/consumed exactly/iu);
    permit.consume();
    const forgedPermit = {
      permitId: permit.permitId,
      claimId: permit.claimId,
      consume: () => undefined,
    } as typeof permit;
    expect(() => store.settle(forgedPermit, { kind: "success" })).toThrow(/unknown|invalid|permit/iu);
    store.settle(permit, { kind: "success" });
    expect(store.read(first.claimId)).toMatchObject({ status: "settled", outcome: "success" });

    expect(() => store.claim(claim("route:mutated:model"))).toThrow(/immutable identity mismatch/iu);
    store.close();
  });

  it("marks an unresolved claimed effect unknown when the owner restarts", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-external-claims-"));
    const path = join(root, "runtime", "claims.sqlite");
    const firstStore = new SqliteManagedExternalInvocationActionClaimStore({ path, now: () => "2026-08-22T18:00:00.000Z" });
    const first = claim();
    firstStore.claim(first).consume();
    firstStore.close();

    const restarted = new SqliteManagedExternalInvocationActionClaimStore({ path, now: () => "2026-08-22T18:01:00.000Z" });
    expect(restarted.read(first.claimId)).toMatchObject({
      status: "unknown",
      outcome: "unknown",
      reason: "process-restarted-before-settlement",
    });
    expect(() => restarted.claim(first)).toThrow(/already exists with status 'unknown'/iu);
    restarted.close();
  });
});
