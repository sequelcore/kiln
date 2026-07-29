import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAccountPolicyId,
  createAccountRef,
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
      readonly work?: "new" | "existing";
      readonly affinityAccount?: string;
      readonly allowAffinityRebind?: boolean;
    } = {},
  ) => authority.acquire({
    accountPolicyId: policyId,
    route,
    jobId,
    runtimeInvocationId: `invocation-${jobId}`,
    work: overrides.work ?? "new",
    ...(overrides.affinityAccount
      ? {
          affinity: {
            account: createAccountRef(`configured:${overrides.affinityAccount}`),
            route,
          },
        }
      : {}),
    ...(overrides.allowAffinityRebind === true ? { allowAffinityRebind: true } : {}),
    candidates,
  });

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
    const reserved = binding("account-a", {
      capacity: { maxConcurrency: 2, reservedAffinitySlots: 1 },
    });

    await expect(acquire(authority, "new-a", [reserved])).resolves.toMatchObject({ status: "acquired" });
    await expect(acquire(authority, "new-b", [reserved])).resolves.toMatchObject({ status: "unavailable" });
    await expect(acquire(authority, "existing", [reserved], {
      work: "existing",
      affinityAccount: "account-a",
    })).resolves.toMatchObject({
      status: "acquired",
      lease: {
        selectionReason: "existing-affinity",
        affinityOutcome: "honored",
      },
    });
  });

  it("never lets existing affinity exceed total account concurrency", async () => {
    const authority = create("owner-a");
    const bounded = binding("account-a", {
      capacity: { maxConcurrency: 2, reservedAffinitySlots: 1 },
    });

    await expect(acquire(authority, "new", [bounded])).resolves.toMatchObject({ status: "acquired" });
    await expect(acquire(authority, "existing-a", [bounded], {
      work: "existing",
      affinityAccount: "account-a",
    })).resolves.toMatchObject({ status: "acquired" });
    await expect(acquire(authority, "existing-b", [bounded], {
      work: "existing",
      affinityAccount: "account-a",
    })).resolves.toMatchObject({
      status: "unavailable",
      rejections: [{ account: "configured:account-a", reason: "lease-conflict" }],
    });
  });

  it("requires explicit affinity rebind and records the rebound", async () => {
    const authority = create("owner-a");
    const candidates = [binding("account-b")];

    await expect(acquire(authority, "strict", candidates, {
      work: "existing",
      affinityAccount: "account-a",
    })).resolves.toMatchObject({ status: "unavailable" });
    await expect(acquire(authority, "rebound", candidates, {
      work: "existing",
      affinityAccount: "account-a",
      allowAffinityRebind: true,
    })).resolves.toMatchObject({
      status: "acquired",
      lease: {
        accountRef: "configured:account-b",
        selectionReason: "affinity-rebind",
        affinityOutcome: "rebound",
      },
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
