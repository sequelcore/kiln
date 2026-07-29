import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAccountPolicyId,
  createAccountRef,
  createManagedAccountAffinityKey,
  type ManagedAccountAffinityKey,
  type ModelGatewayRoute,
} from "@kilnai/core";
import {
  SqliteManagedAccountLeaseAuthority,
  type ManagedAccountCandidateBinding,
} from "../../src/managed-account-leases/managed-account-lease-authority.js";

const route: ModelGatewayRoute = {
  providerId: "codex-oauth",
  providerModelId: "gpt-5.6-terra",
  scope: "virtual:managed-codex",
};
const policyId = createAccountPolicyId("managed-codex");

function binding(
  id: string,
  options: Partial<ManagedAccountCandidateBinding> = {},
): ManagedAccountCandidateBinding {
  return {
    candidate: {
      account: createAccountRef(`configured:${id}`),
      route,
      health: "healthy",
      leaseCapacity: "available",
      pressure: 0,
      reservedForNewWork: false,
    },
    capacityIdentity: id,
    credentialRevisionId: id === "account-a" ? "a".repeat(64) : "b".repeat(64),
    usageEvidence: {
      health: "healthy",
      freshness: "missing",
    },
    capacity: {
      maxConcurrency: 1,
      reservedAffinitySlots: 0,
    },
    ...options,
  };
}

describe("SqliteManagedAccountLeaseAuthority", () => {
  let root: string | undefined;
  const authorities: SqliteManagedAccountLeaseAuthority[] = [];
  let clockMs = Date.parse("2026-07-28T22:30:00.000Z");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-account-lease-"));
  });

  afterEach(async () => {
    for (const authority of authorities.splice(0)) authority.close();
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
    clockMs = Date.parse("2026-07-28T22:30:00.000Z");
  });

  function create(
    ownerId: string,
    options: { readonly ownerStaleMs?: number } = {},
  ): SqliteManagedAccountLeaseAuthority {
    if (!root) throw new Error("fixture root is unavailable");
    const authority = new SqliteManagedAccountLeaseAuthority({
      path: join(root, "leases.sqlite"),
      ownerId,
      now: () => clockMs,
      ownerStaleMs: options.ownerStaleMs ?? 1000,
    });
    authorities.push(authority);
    return authority;
  }

  const acquire = (
    authority: SqliteManagedAccountLeaseAuthority,
    jobId: string,
    candidates: readonly ManagedAccountCandidateBinding[],
    overrides: {
      readonly affinity?: {
        readonly continuity: "prefer" | "require";
        readonly key: ManagedAccountAffinityKey;
        readonly scope?: "session" | "turn";
        readonly allowRebind?: boolean;
      };
    } = {},
  ) => authority.acquire({
    accountPolicyId: policyId,
    route,
    jobId,
    runtimeInvocationId: `invocation-${jobId}`,
    affinityRequest: overrides.affinity
      ? {
          ...overrides.affinity,
          scope: overrides.affinity.scope ?? "session",
        }
      : { continuity: "none" },
    candidates,
  });

  const affinityKey = (suffix: string) =>
    createManagedAccountAffinityKey(suffix.repeat(64).slice(0, 64));

  it("serializes concurrent acquisition and enforces max concurrency", async () => {
    const authority = create("owner-a");
    const candidates = [binding("account-a")];

    const results = await Promise.all([
      acquire(authority, "job-a", candidates),
      acquire(authority, "job-b", candidates),
    ]);

    expect(results.filter((result) => result.status === "acquired")).toHaveLength(1);
    expect(results.filter((result) => result.status === "unavailable")).toHaveLength(1);
    expect(authority.list()).toHaveLength(1);
  });

  it("selects another eligible account when a pre-dispatch lease consumes the first", async () => {
    const authority = create("owner-a");
    const candidates = [binding("account-a"), binding("account-b")];

    await expect(acquire(authority, "job-a", candidates)).resolves.toMatchObject({
      status: "acquired",
      lease: { accountRef: "configured:account-a" },
    });
    await expect(acquire(authority, "job-b", candidates)).resolves.toMatchObject({
      status: "acquired",
      lease: {
        accountRef: "configured:account-b",
        candidateRejections: [{
          account: "configured:account-a",
          reason: "lease-conflict",
        }],
      },
    });
  });

  it("does not reset configured-account capacity when credential revision identity changes", async () => {
    const authority = create("owner-a");
    await expect(acquire(authority, "job-a", [binding("account-a")])).resolves.toMatchObject({
      status: "acquired",
    });
    const refreshed = binding("account-a-revision-2", {
      capacityIdentity: "account-a",
      credentialRevisionId: "c".repeat(64),
    });

    await expect(acquire(authority, "job-b", [refreshed])).resolves.toMatchObject({
      status: "unavailable",
      rejections: [{
        account: "configured:account-a-revision-2",
        reason: "lease-conflict",
      }],
    });
  });

  it("persists sanitized rejected-candidate evidence with the selected lease", async () => {
    const authority = create("owner-a");
    const acquired = await acquire(authority, "job-a", [
      binding("account-a"),
      binding("account-b", {
        candidate: {
          account: createAccountRef("configured:account-b"),
          route,
          health: "unhealthy",
          leaseCapacity: "available",
          pressure: 0,
          reservedForNewWork: false,
        },
      }),
    ]);

    expect(acquired).toMatchObject({
      status: "acquired",
      lease: {
        accountRef: "configured:account-a",
        candidateRejections: [{
          account: "configured:account-b",
          reason: "unhealthy",
        }],
      },
    });
    expect(authority.list()[0]?.candidateRejections).toEqual([{
      account: "configured:account-b",
      reason: "unhealthy",
    }]);
  });

  it("preserves reserved affinity slots for existing work", async () => {
    const authority = create("owner-a");
    const key = affinityKey("a");
    const reserved = binding("account-a", {
      capacity: { maxConcurrency: 2, reservedAffinitySlots: 1 },
    });
    const bootstrap = await acquire(authority, "bootstrap", [reserved], {
      affinity: { continuity: "prefer", key },
    });
    if (bootstrap.status !== "acquired") throw new Error("fixture");
    authority.finalizeSuccessful(bootstrap.identity);

    await expect(acquire(authority, "new-a", [reserved])).resolves.toMatchObject({ status: "acquired" });
    await expect(acquire(authority, "new-b", [reserved])).resolves.toMatchObject({ status: "unavailable" });
    await expect(acquire(authority, "existing", [reserved], {
      affinity: {
        continuity: "prefer",
        key,
      },
    })).resolves.toMatchObject({
      status: "acquired",
      lease: {
        selectionReason: "existing-affinity",
        affinityOutcome: "honored",
      },
    });
  });

  it("atomically fills two accounts, rejects a third, and restores only the released slot", async () => {
    const authority = create("owner-a");
    const candidates = [binding("account-b"), binding("account-a")];
    const acquired = await Promise.all([
      acquire(authority, "job-a", candidates),
      acquire(authority, "job-b", candidates),
    ]);
    const leases = acquired.flatMap((result) =>
      result.status === "acquired" ? [result] : []);

    expect(leases.map((result) => result.lease.accountRef).sort()).toEqual([
      "configured:account-a",
      "configured:account-b",
    ]);
    clockMs += 60_000;
    await expect(acquire(authority, "job-c", candidates)).resolves.toMatchObject({
      status: "unavailable",
      rejections: [
        { account: "configured:account-a", reason: "lease-conflict" },
        { account: "configured:account-b", reason: "lease-conflict" },
      ],
    });

    const released = leases.find((result) =>
      result.lease.accountRef === "configured:account-a");
    if (!released) throw new Error("fixture");
    const firstRelease = authority.release(released.identity);
    expect(authority.release(released.identity)).toEqual(firstRelease);
    await expect(acquire(authority, "job-d", candidates)).resolves.toMatchObject({
      status: "acquired",
      lease: {
        accountRef: "configured:account-a",
        candidateRejections: [{
          account: "configured:account-b",
          reason: "lease-conflict",
        }],
      },
    });
    await expect(acquire(authority, "job-e", candidates)).resolves.toMatchObject({
      status: "unavailable",
      rejections: [
        { account: "configured:account-a", reason: "lease-conflict" },
        { account: "configured:account-b", reason: "lease-conflict" },
      ],
    });
  });

  it("never lets existing affinity exceed total account concurrency", async () => {
    const authority = create("owner-a");
    const key = affinityKey("a");
    const bounded = binding("account-a", {
      capacity: { maxConcurrency: 2, reservedAffinitySlots: 1 },
    });
    const bootstrap = await acquire(authority, "bootstrap", [bounded], {
      affinity: { continuity: "prefer", key },
    });
    if (bootstrap.status !== "acquired") throw new Error("fixture");
    authority.finalizeSuccessful(bootstrap.identity);

    await expect(acquire(authority, "new", [bounded])).resolves.toMatchObject({ status: "acquired" });
    await expect(acquire(authority, "existing-a", [bounded], {
      affinity: {
        continuity: "prefer",
        key,
      },
    })).resolves.toMatchObject({ status: "acquired" });
    await expect(acquire(authority, "existing-b", [bounded], {
      affinity: {
        continuity: "prefer",
        key,
      },
    })).resolves.toMatchObject({
      status: "unavailable",
      rejections: [{ account: "configured:account-a", reason: "lease-conflict" }],
    });
  });

  it("requires explicit affinity rebind and records the rebound", async () => {
    const authority = create("owner-a");
    const key = affinityKey("a");
    const initial = await acquire(authority, "initial", [binding("account-a")], {
      affinity: { continuity: "prefer", key },
    });
    if (initial.status !== "acquired") throw new Error("fixture");
    authority.finalizeSuccessful(initial.identity);
    const candidates = [
      binding("account-a", {
        candidate: {
          account: createAccountRef("configured:account-a"),
          route,
          health: "unhealthy",
          leaseCapacity: "available",
          pressure: 0,
          reservedForNewWork: false,
        },
      }),
      binding("account-b"),
    ];

    await expect(acquire(authority, "strict", candidates, {
      affinity: { continuity: "prefer", key },
    })).resolves.toMatchObject({ status: "unavailable" });
    await expect(acquire(authority, "rebound", candidates, {
      affinity: {
        continuity: "prefer",
        key,
        allowRebind: true,
      },
    })).resolves.toMatchObject({
      status: "acquired",
      lease: {
        accountRef: "configured:account-b",
        selectionReason: "affinity-rebind",
        affinityOutcome: "rebound",
        candidateRejections: [{
          account: "configured:account-a",
          reason: "unhealthy",
        }],
      },
    });
  });

  it("fails closed for required affinity without a durable mapping", async () => {
    const authority = create("owner-a");

    await expect(acquire(authority, "required", [binding("account-a")], {
      affinity: {
        continuity: "require",
        key: affinityKey("a"),
      },
    })).resolves.toEqual({
      status: "unavailable",
      rejections: [],
    });
    expect(authority.list()).toEqual([]);
  });

  it("resolves durable affinity by stable capacity identity after credential revision", async () => {
    const authority = create("owner-a");
    const key = affinityKey("a");
    const initial = await acquire(authority, "initial", [binding("account-a")], {
      affinity: { continuity: "prefer", key },
    });
    if (initial.status !== "acquired") throw new Error("fixture");
    authority.finalizeSuccessful(initial.identity);
    const refreshed = binding("account-a-revision-2", {
      capacityIdentity: "account-a",
      credentialRevisionId: "c".repeat(64),
    });

    await expect(acquire(authority, "continued", [refreshed], {
      affinity: { continuity: "require", key },
    })).resolves.toMatchObject({
      status: "acquired",
      lease: {
        accountRef: "configured:account-a-revision-2",
        credentialRevisionId: "c".repeat(64),
        selectionReason: "existing-affinity",
        affinityOutcome: "honored",
      },
    });
  });

  it("atomically commits first binding and records won, already-matched, and conflict", async () => {
    const authority = create("owner-a");
    const candidates = [
      binding("account-a", { capacity: { maxConcurrency: 3, reservedAffinitySlots: 0 } }),
      binding("account-b", { capacity: { maxConcurrency: 3, reservedAffinitySlots: 0 } }),
    ];
    const wonKey = affinityKey("a");
    const won = await acquire(authority, "won", [candidates[0]!], {
      affinity: { continuity: "prefer", key: wonKey },
    });
    const matched = await acquire(authority, "matched", [candidates[0]!], {
      affinity: { continuity: "prefer", key: wonKey },
    });
    const conflict = await acquire(authority, "conflict", [candidates[1]!], {
      affinity: { continuity: "prefer", key: wonKey },
    });
    if (won.status !== "acquired" || matched.status !== "acquired" || conflict.status !== "acquired") {
      throw new Error("fixture");
    }

    const wonFinalization = authority.finalizeSuccessful(won.identity);
    expect(wonFinalization).toMatchObject({
      affinityCommitOutcome: "won",
      lease: { lifecycleState: "released", affinityCommitOutcome: "won" },
    });
    expect(authority.finalizeSuccessful(won.identity)).toEqual(wonFinalization);
    expect(authority.finalizeSuccessful(matched.identity)).toMatchObject({
      affinityCommitOutcome: "already-matched",
      lease: { lifecycleState: "released", affinityCommitOutcome: "already-matched" },
    });
    expect(authority.finalizeSuccessful(conflict.identity)).toMatchObject({
      affinityCommitOutcome: "conflict",
      lease: { lifecycleState: "released", affinityCommitOutcome: "conflict" },
    });

    await expect(acquire(authority, "winner-check", candidates, {
      affinity: { continuity: "require", key: wonKey },
    })).resolves.toMatchObject({
      status: "acquired",
      lease: {
        accountRef: "configured:account-a",
        selectionReason: "existing-affinity",
        affinityOutcome: "honored",
      },
    });
  });

  it("rolls back release when affinity persistence fails", async () => {
    const authority = create("owner-a");
    const acquired = await acquire(authority, "job-a", [binding("account-a")], {
      affinity: { continuity: "prefer", key: affinityKey("a") },
    });
    if (acquired.status !== "acquired" || !root) throw new Error("fixture");
    const blocker = new Database(join(root, "leases.sqlite"), { strict: true });
    blocker.exec(`
      CREATE TRIGGER reject_affinity_insert
      BEFORE INSERT ON managed_account_affinities
      BEGIN
        SELECT RAISE(ABORT, 'synthetic affinity persistence failure');
      END;
    `);
    blocker.close();

    expect(() => authority.finalizeSuccessful(acquired.identity))
      .toThrow("synthetic affinity persistence failure");
    expect(authority.get(acquired.identity.leaseId)).toMatchObject({
      lifecycleState: "held",
    });
    await expect(acquire(authority, "job-b", [binding("account-a")]))
      .resolves.toMatchObject({ status: "unavailable" });
  });

  it("migrates a Slice 1 database before acquiring and finalizing affinity", async () => {
    if (!root) throw new Error("fixture");
    const path = join(root, "leases.sqlite");
    const legacy = new Database(path, { create: true, strict: true });
    legacy.exec(`
      CREATE TABLE runtime_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        owner_id TEXT NOT NULL,
        heartbeat INTEGER NOT NULL
      );
      CREATE TABLE account_leases (
        lease_id TEXT PRIMARY KEY,
        account_policy_id TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        capacity_identity TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        route_scope TEXT NOT NULL,
        job_id TEXT NOT NULL UNIQUE,
        runtime_invocation_id TEXT NOT NULL UNIQUE,
        credential_revision_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL,
        released_at TEXT,
        selection_reason TEXT NOT NULL,
        candidate_rejections TEXT NOT NULL,
        affinity_outcome TEXT,
        purpose TEXT NOT NULL,
        resource_uris TEXT NOT NULL,
        diagnostic_uris TEXT NOT NULL
      );
    `);
    legacy.close();

    const authority = create("owner-a");
    const acquired = await acquire(authority, "job-a", [binding("account-a")], {
      affinity: { continuity: "prefer", key: affinityKey("a") },
    });
    if (acquired.status !== "acquired") throw new Error("fixture");

    expect(authority.finalizeSuccessful(acquired.identity)).toMatchObject({
      affinityCommitOutcome: "won",
      lease: { lifecycleState: "released" },
    });
  });

  it("keeps settlement-pending work capacity-consuming until idempotent release", async () => {
    const authority = create("owner-a");
    const candidates = [binding("account-a")];
    const acquired = await acquire(authority, "job-a", candidates);
    if (acquired.status !== "acquired") throw new Error("fixture");

    const pending = authority.markSettlementPending({
      ...acquired.identity,
      diagnosticUri: `kiln://managed-accounts/leases/${acquired.identity.leaseId}/settlement-pending`,
    });
    expect(pending.lifecycleState).toBe("settlement-pending");
    expect(() => authority.finalizeSuccessful(acquired.identity))
      .toThrow("successful finalization requires held state");
    await expect(acquire(authority, "job-b", candidates)).resolves.toMatchObject({ status: "unavailable" });

    clockMs += 1000;
    const released = authority.release(acquired.identity);
    expect(released).toMatchObject({ lifecycleState: "released", releasedAt: "2026-07-28T22:30:01.000Z" });
    expect(authority.release(acquired.identity)).toEqual(released);
    await expect(acquire(authority, "job-b", candidates)).resolves.toMatchObject({ status: "acquired" });
    expect(authority.list()).toHaveLength(2);
  });

  it("fences release on the complete lease identity", async () => {
    const authority = create("owner-a");
    const acquired = await acquire(authority, "job-a", [binding("account-a")]);
    if (acquired.status !== "acquired") throw new Error("fixture");

    expect(() => authority.release({
      ...acquired.identity,
      jobId: "other-job",
    })).toThrow("Managed account lease identity does not match");
    expect(authority.get(acquired.identity.leaseId)?.lifecycleState).toBe("held");
  });

  it("persists release failure evidence and keeps capacity unavailable", async () => {
    const authority = create("owner-a");
    const candidates = [binding("account-a")];
    const acquired = await acquire(authority, "job-a", candidates);
    if (acquired.status !== "acquired") throw new Error("fixture");

    const failed = authority.recordReleaseFailure({
      ...acquired.identity,
      diagnosticUri: `kiln://managed-accounts/leases/${acquired.identity.leaseId}/release-failed`,
    });

    expect(failed).toMatchObject({
      lifecycleState: "release-failed",
      diagnosticUris: [`kiln://managed-accounts/leases/${acquired.identity.leaseId}/release-failed`],
    });
    expect(authority.list()[0]).toEqual(failed);
    await expect(acquire(authority, "job-b", candidates)).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it("retains unknown external work across owner recovery instead of deleting its lease", async () => {
    const first = create("owner-a");
    const candidates = [binding("account-a")];
    const acquired = await acquire(first, "job-a", candidates);
    if (acquired.status !== "acquired") throw new Error("fixture");
    first.close();
    authorities.splice(authorities.indexOf(first), 1);

    clockMs += 2000;
    const restarted = create("owner-b");
    const recovered = restarted.recover({
      reconcilableRuntimeInvocationIds: [],
      settlementPendingRuntimeInvocationIds: [acquired.identity.runtimeInvocationId],
    });

    expect(recovered).toMatchObject([{
      leaseId: acquired.identity.leaseId,
      lifecycleState: "settlement-pending",
    }]);
    await expect(acquire(restarted, "job-b", candidates)).resolves.toMatchObject({ status: "unavailable" });
  });

  it("recovers two occupied accounts without erasing or merging their lifecycle evidence", async () => {
    const first = create("owner-a");
    const candidates = [binding("account-a"), binding("account-b")];
    const pending = await acquire(first, "job-pending", candidates);
    const failed = await acquire(first, "job-release-failed", candidates);
    if (pending.status !== "acquired" || failed.status !== "acquired") throw new Error("fixture");
    first.markSettlementPending({
      ...pending.identity,
      diagnosticUri: `kiln://managed-accounts/leases/${pending.identity.leaseId}/settlement-pending`,
    });
    first.recordReleaseFailure({
      ...failed.identity,
      diagnosticUri: `kiln://managed-accounts/leases/${failed.identity.leaseId}/release-failed`,
    });
    first.close();
    authorities.splice(authorities.indexOf(first), 1);

    clockMs += 2000;
    const restarted = create("owner-b");
    const recovered = restarted.recover({
      reconcilableRuntimeInvocationIds: [failed.identity.runtimeInvocationId],
      settlementPendingRuntimeInvocationIds: [pending.identity.runtimeInvocationId],
    });

    expect(recovered).toEqual(expect.arrayContaining([
      expect.objectContaining({
        leaseId: pending.identity.leaseId,
        accountRef: pending.identity.accountRef,
        lifecycleState: "settlement-pending",
        diagnosticUris: expect.arrayContaining([
          expect.stringContaining("settlement-pending"),
          expect.stringContaining("settlement-unknown"),
        ]),
      }),
      expect.objectContaining({
        leaseId: failed.identity.leaseId,
        accountRef: failed.identity.accountRef,
        lifecycleState: "release-failed",
        diagnosticUris: [expect.stringContaining("release-failed")],
      }),
    ]));
    await expect(acquire(restarted, "job-after-recovery", candidates)).resolves.toMatchObject({
      status: "unavailable",
      rejections: [
        { account: "configured:account-a", reason: "lease-conflict" },
        { account: "configured:account-b", reason: "lease-conflict" },
      ],
    });
  });

  it("classifies unmatchable recovered work as leaked and keeps capacity unavailable", async () => {
    const first = create("owner-a");
    const candidates = [binding("account-a")];
    const acquired = await acquire(first, "job-a", candidates);
    if (acquired.status !== "acquired") throw new Error("fixture");
    first.close();
    authorities.splice(authorities.indexOf(first), 1);

    clockMs += 2000;
    const restarted = create("owner-b");
    const recovered = restarted.recover({
      reconcilableRuntimeInvocationIds: [],
      settlementPendingRuntimeInvocationIds: [],
    });

    expect(recovered).toMatchObject([{
      leaseId: acquired.identity.leaseId,
      lifecycleState: "leaked",
      diagnosticUris: [expect.stringContaining("recovery-unmatchable")],
    }]);
    await expect(acquire(restarted, "job-b", candidates)).resolves.toMatchObject({ status: "unavailable" });
  });
});
