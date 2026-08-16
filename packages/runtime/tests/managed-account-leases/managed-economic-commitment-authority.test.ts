import { afterEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutionAccountRef } from "@kilnai/core/agents";
import {
  adoptManagedEconomicSnapshot,
  digestManagedEconomicValue,
  type ManagedEconomicAdoptedSnapshot,
  type ManagedEconomicPriceEvidence,
} from "@kilnai/core/cost";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";

const roots: string[] = [];
const authorities: SqliteManagedAccountLeaseAuthority[] = [];

afterEach(() => {
  for (const authority of authorities.splice(0)) authority.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function amount(atoms: string) {
  return { atoms, scale: 2, unit: "currency", scheme: { kind: "currency" as const, currency: "USD" } };
}

function snapshot(): ManagedEconomicAdoptedSnapshot {
  const evidence = {
    sourceIdentity: "test-catalog", sourceRevision: "revision-1",
    sourceDigest: `sha256:${"a".repeat(64)}`,
    observedAt: "2026-07-31T10:00:00.000Z", validUntil: "2026-07-31T12:00:00.000Z",
    confidence: "high" as const, authority: "configured" as const,
  };
  const rates = [{ usageUnit: "input-token", price: {
    atoms: "1", scale: 2, unit: "input-token",
    scheme: { kind: "currency" as const, currency: "USD" },
  } }];
  const auxiliaryCharges: never[] = [];
  const unitScheduleDigest = digestManagedEconomicValue(rates);
  const auxiliaryScheduleDigest = digestManagedEconomicValue(auxiliaryCharges);
  const priceEvidence: ManagedEconomicPriceEvidence = { kind: "metered", identity: {
    providerId: "provider", modelId: "model", authBillingChannel: "direct",
    executionMode: "standard", serviceTier: "default", rateCardId: "rate-card",
    rateCardRevision: "1", unit: "currency", scheme: { kind: "currency", currency: "USD" },
    unitScheduleDigest, contextClass: "standard", cacheClass: "default",
    auxiliaryScheduleDigest, evidence,
  } };
  const domain = { id: "usd", rank: 0, basis: {
    unit: "currency", scheme: { kind: "currency" as const, currency: "USD" },
    rateCardBasis: "rate-card:1", envelopeSemantics: "worst-case-v1",
  } };
  const route = {
    routeId: "route-direct", providerId: "provider", modelId: "model",
    adapterCapabilityId: "direct", adapterCapabilityVersion: "1", authBillingChannel: "direct",
    executionMode: "standard", serviceTier: "default", accountPolicyId: null,
    fallbackPosture: "disabled" as const, overagePosture: "disabled" as const,
    rateCardId: "rate-card", rateCardRevision: "1", priceEvidenceDigest: evidence.sourceDigest,
    unit: "currency", scheme: { kind: "currency" as const, currency: "USD" },
    contextClass: "standard", cacheClass: "default", auxiliaryScheduleDigest,
    envelopeDigest: `sha256:${"f".repeat(64)}`,
  };
  return adoptManagedEconomicSnapshot({
    policy: { policyId: "policy", schemaVersion: 1, policyRevision: "revision-1",
      policyDigest: `sha256:${"1".repeat(64)}`, comparisonDomains: [domain], noRouteAction: "deny",
      evidenceRequirements: { quota: "required-for-account-bound", price: "required" } },
    adoptedAt: "2026-07-31T10:30:00.000Z", adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
    callerConstraints: {},
    routes: [{
      admittedIdentity: { routeId: route.routeId, sourceIdentity: "test-config",
        providerId: route.providerId, modelId: route.modelId,
        adapterCapabilityId: route.adapterCapabilityId,
        adapterCapabilityVersion: route.adapterCapabilityVersion,
        accountPolicy: { kind: "accountless" },
        profileAuthorityDigest: `sha256:${"9".repeat(64)}` },
      route, comparisonDomain: domain, priorityRank: 0, priceEvidence,
      rateSchedule: { unitRates: rates, auxiliaryCharges },
      executionEnvelope: { kind: "bounded", digest: route.envelopeDigest, limits: [{
        atoms: "10", scale: 0, unit: "input-token", scheme: { kind: "unit" },
      }] },
      worstCaseReservation: { kind: "exact", amount: amount("10") },
      ceiling: { kind: "finite", amount: amount("10") },
    }],
  });
}

function create(now: () => number = () => Date.parse("2026-07-31T11:00:00.000Z")) {
  const root = mkdtempSync(join(tmpdir(), "kiln-economic-"));
  roots.push(root);
  const authority = new SqliteManagedAccountLeaseAuthority({ path: join(root, "authority.sqlite"), ownerId: "owner-a", now });
  authorities.push(authority);
  return authority;
}

function createAt(
  path: string,
  ownerId: string,
  now: () => number,
  ownerStaleMs = 1_000,
) {
  const authority = new SqliteManagedAccountLeaseAuthority({ path, ownerId, now, ownerStaleMs });
  authorities.push(authority);
  return authority;
}

function input(adopted = snapshot()) {
  return {
    jobId: "job-a", economicAttemptId: "economic-attempt-a",
    intentFingerprint: `sha256:${"9".repeat(64)}`, snapshot: adopted,
    expectation: { policyId: adopted.policy.policyId, policyRevision: adopted.policy.policyRevision,
      candidateSetDigest: adopted.candidateSetDigest,
      admittedCandidates: adopted.routes.map((route) => route.admittedIdentity), callerConstraints: {} },
    routeCapacity: [{ routeId: "route-direct" }],
  } as const;
}

function accountSnapshot(): ManagedEconomicAdoptedSnapshot {
  const base = snapshot();
  const adopted = base.routes[0]!;
  return adoptManagedEconomicSnapshot({
    policy: base.policy, adoptedAt: base.adoptedAt, adoptedDecisionAt: base.adoptedDecisionAt,
    callerConstraints: base.callerConstraints,
    routes: [{
      ...adopted,
      admittedIdentity: { ...adopted.admittedIdentity, accountPolicy: {
        kind: "account-bound", accountPolicyId: "managed-policy",
      } },
      route: { ...adopted.route, accountPolicyId: "managed-policy" },
    }],
  });
}

function accountCapacity(adopted = accountSnapshot()) {
  const route = { providerId: "provider", providerModelId: "model", scope: "economic:route-direct" };
  const candidate = {
    candidate: { account: createExecutionAccountRef("configured:account-a"), route, health: "healthy" as const,
      leaseCapacity: "available" as const, pressure: 0, reservedForNewWork: false },
    capacityIdentity: "account-a", credentialRevisionId: "a".repeat(64),
    usageEvidence: { health: "healthy" as const, freshness: "missing" as const },
    accountEconomics: {
      capacityIdentity: "account-a", subscriptionClass: "metered" as const,
      quotaClassId: "quota", creditPosture: "disabled" as const, overagePosture: "disabled" as const,
    },
    quotaEvidence: { kind: "known" as const, capacityIdentity: "account-a",
      subscriptionClass: "metered" as const, quotaClassId: "quota",
      buckets: [{ bucketId: "money", dimension: "currency", remaining: amount("100"), resetsAt: null }],
      evidence: adopted.routes[0]!.priceEvidence.identity.evidence },
    capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 },
  };
  return { route, candidate };
}

describe("managed economic commitment authority", () => {
  it.each([
    "4e636150-4fe1-4bf2-a1a4-73847d759de8",
    "runtime-invocation-a",
    "attempt-goal-run-a",
  ])("rejects non-economic attempt identity %s", (economicAttemptId) => {
    expect(() => create().acquireCommitment({ ...input(), economicAttemptId }))
      .toThrow("economic-attempt namespace");
  });

  it("atomically commits accountless capacity, replays, conflicts without mutation, and releases pre-fence", () => {
    let clock = Date.parse("2026-07-31T11:00:00.000Z");
    const authority = create(() => clock);
    const acquired = authority.acquireCommitment(input());
    expect(acquired).toMatchObject({ status: "committed", replay: false, record: { state: "held" } });
    if (acquired.status !== "committed") throw new Error("fixture");
    expect(acquired.record.lease).toBeUndefined();

    clock += 60_000;
    expect(authority.acquireCommitment(input())).toEqual({ ...acquired, replay: true });
    expect(authority.acquireCommitment({ ...input(), intentFingerprint: `sha256:${"8".repeat(64)}` }))
      .toEqual({ status: "conflict", reason: "idempotency-conflict" });
    expect(authority.releaseCommitmentPreFence("job-a", "economic-attempt-a").state).toBe("released");
    expect(authority.acquireCommitment({ ...input(), jobId: "job-b", economicAttemptId: "economic-attempt-b" }))
      .toMatchObject({ status: "committed" });
  });

  it("makes the dispatch fence monotonic and forbids post-fence release", () => {
    const authority = create();
    authority.acquireCommitment(input());
    const fenced = authority.fenceDispatch("job-a", "economic-attempt-a", "fence-a");
    expect(fenced)
      .toMatchObject({ state: "dispatch-fenced", dispatchFenceId: "fence-a" });
    expect(authority.fenceDispatch("job-a", "economic-attempt-a", "fence-a")).toEqual(fenced);
    expect(() => authority.releaseCommitmentPreFence("job-a", "economic-attempt-a"))
      .toThrow("definitely pre-dispatch");
    expect(() => authority.fenceDispatch("job-a", "economic-attempt-a", "fence-b"))
      .toThrow("cannot be dispatch-fenced");
  });

  it("releases accountless capacity only after a matching typed execution settlement", async () => {
    const authority = create();
    const acquired = authority.acquireCommitment(input());
    if (acquired.status !== "committed") throw new Error("fixture");
    authority.fenceDispatch("job-a", "economic-attempt-a", "fence-a");

    expect(authority.recordExecutionSettlementPending(
      "job-a",
      "economic-attempt-a",
      "fence-a",
      "provider outcome is not authoritative",
    )).toMatchObject({ state: "settlement-pending", settlement: { kind: "unknown" } });
    expect(authority.acquireCommitment({
      ...input(),
      jobId: "job-b",
      economicAttemptId: "economic-attempt-b",
    })).toMatchObject({ status: "denied" });

    const settlement = {
      kind: "subscription" as const,
      reservationId: acquired.record.commitment.reservation.reservationId,
      dispatchFenceId: "fence-a",
      actualIdentity: acquired.record.commitment.reservation.selectedIdentity,
      units: [{ atoms: "7", scale: 0, unit: "input-token", scheme: { kind: "unit" as const } }],
      evidence: snapshot().routes[0]!.priceEvidence.identity.evidence,
    };
    const released = authority.settleExecution(
      "job-a",
      "economic-attempt-a",
      "fence-a",
      settlement,
    );
    expect(released).toMatchObject({ state: "released", settlement });
    expect(authority.settleExecution(
      "job-a",
      "economic-attempt-a",
      "fence-a",
      settlement,
    )).toMatchObject({ state: "released", settlement });
    expect(authority.recordExecutionSettlementPending(
      "job-a",
      "economic-attempt-a",
      "fence-a",
      "managed job observed execution failure after terminal settlement",
    )).toEqual(released);
    expect(() => authority.recordExecutionSettlementPending(
      "job-a",
      "economic-attempt-a",
      "fence-conflict",
      "conflicting durable fence",
    )).toThrow("does not own the durable dispatch fence");
    expect(authority.acquireCommitment({
      ...input(),
      jobId: "job-c",
      economicAttemptId: "economic-attempt-c",
    })).toMatchObject({ status: "committed" });
  });

  it("keeps account capacity consumed after an unknown post-fence outcome", () => {
    const authority = create();
    const adopted = accountSnapshot();
    const { route, candidate } = accountCapacity(adopted);
    authority.acquireCommitment({
      ...input(adopted),
      routeCapacity: [{
        routeId: "route-direct",
        route,
        affinityRequest: { continuity: "none" },
        candidates: [candidate],
      }],
    });
    authority.fenceDispatch("job-a", "economic-attempt-a", "fence-a");
    expect(authority.recordExecutionSettlementPending(
      "job-a",
      "economic-attempt-a",
      "fence-a",
      "execution settlement rejected",
    )).toMatchObject({
      state: "settlement-pending",
      lease: { lifecycleState: "held" },
    });
  });

  it("shares physical account capacity with account-only gateway acquisition in both orders", () => {
    const adopted = accountSnapshot(); const { route, candidate } = accountCapacity(adopted);
    const economic = create();
    expect(economic.acquireCommitment({ ...input(adopted), routeCapacity: [{ routeId: "route-direct", route, candidates: [candidate] }] })).toMatchObject({ status: "committed" });
    expect(economic.acquireAccountCapacity({ runtimeInvocationId: "gateway-after-economic", intentFingerprint: `sha256:${"a".repeat(64)}`, accountPolicyId: "managed-policy", route, candidates: [candidate] }))
      .toMatchObject({ status: "unavailable" });

    const gateway = create();
    expect(gateway.acquireAccountCapacity({ runtimeInvocationId: "gateway-before-economic", intentFingerprint: `sha256:${"b".repeat(64)}`, accountPolicyId: "managed-policy", route, candidates: [candidate] }))
      .toMatchObject({ status: "acquired" });
    expect(gateway.acquireCommitment({ ...input(adopted), routeCapacity: [{ routeId: "route-direct", route, candidates: [candidate] }] }))
      .toMatchObject({ status: "denied" });
  });

  it("persists exact final-unit denial evidence and replays it without partial reservation", () => {
    const authority = create();
    expect(authority.acquireCommitment(input())).toMatchObject({ status: "committed" });
    const deniedInput = { ...input(), jobId: "job-b", economicAttemptId: "economic-attempt-b" };
    const denied = authority.acquireCommitment(deniedInput);
    expect(denied).toMatchObject({
      status: "denied", replay: false,
      evidence: { authorityRejections: [{
        stage: "local-capacity", routeId: "route-direct", reason: "route-capacity-exhausted",
      }] },
    });
    expect(authority.acquireCommitment(deniedInput)).toEqual({ ...denied, replay: true });
    expect(authority.releaseCommitmentPreFence("job-a", "economic-attempt-a").state).toBe("released");
    expect(authority.acquireCommitment({ ...input(), jobId: "job-c", economicAttemptId: "economic-attempt-c" }))
      .toMatchObject({ status: "committed" });
  });

  it("serializes interleaved pre-transaction adoption at the exact final unit", async () => {
    const authority = create();
    let arrivals = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const prepare = async (jobId: string, economicAttemptId: string) => {
      const adopted = snapshot();
      arrivals += 1;
      if (arrivals === 2) releaseBarrier();
      await barrier;
      return { ...input(adopted), jobId, economicAttemptId };
    };
    const [firstInput, secondInput] = await Promise.all([
      prepare("job-interleaved-a", "economic-attempt-interleaved-a"),
      prepare("job-interleaved-b", "economic-attempt-interleaved-b"),
    ]);

    const first = authority.acquireCommitment(firstInput);
    const second = authority.acquireCommitment(secondInput);

    expect(first).toMatchObject({ status: "committed", record: { state: "held" } });
    expect(second).toMatchObject({
      status: "denied",
      evidence: { authorityRejections: [{
        stage: "local-capacity", routeId: "route-direct", reason: "route-capacity-exhausted",
      }] },
    });
  });

  it("commits account and route capacity together without fabricating accountless evidence", () => {
    const authority = create();
    const adopted = accountSnapshot();
    const { route, candidate } = accountCapacity(adopted);
    const request = input(adopted);
    const acquired = authority.acquireCommitment({ ...request, routeCapacity: [{
      routeId: "route-direct", route,
      affinityRequest: { continuity: "none" }, candidates: [candidate],
    }] });
    expect(acquired).toMatchObject({ status: "committed", record: {
      lease: {
        jobId: "job-a",
        economicAttemptId: "economic-attempt-a",
        accountRef: "configured:account-a",
        lifecycleState: "held",
      },
      commitment: { reservation: { selectedIdentity: { account: { kind: "account-bound" } } } },
    } });
    if (acquired.status !== "committed") throw new Error("Expected committed economic account lease.");
    expect(acquired.record.lease).not.toHaveProperty("runtimeInvocationId");
    expect(acquired.record.lease?.commitmentId).toBe(acquired.record.commitment.commitmentId);
    expect(authority.acquireCommitment({ ...request, jobId: "job-b", economicAttemptId: "economic-attempt-b",
      routeCapacity: [{ routeId: "route-direct", route,
        affinityRequest: { continuity: "none" }, candidates: [candidate] }] }))
      .toMatchObject({ status: "denied", evidence: { authorityRejections: [{
        stage: "account-selection", rejections: [{ reason: "lease-conflict" }],
      }] } });
  });

  it("projects real SQLite denied, held, fenced, pending, and released evidence without secrets", () => {
    const authority = create();
    const first = authority.acquireCommitment(input());
    if (first.status !== "committed") throw new Error("Expected a commitment.");
    const inspect = authority.createAgentTaskReplayInspectionPort();
    expect(inspect.inspect({ jobId: "job-a", economicAttemptId: "economic-attempt-a" })).toMatchObject({
      evidenceVersion: 1, status: "held", policyId: "policy", policyRevision: "revision-1",
      policyDigest: `sha256:${"1".repeat(64)}`, commitmentId: first.record.commitment.commitmentId,
      reservationId: first.record.commitment.reservation.reservationId,
      selectedRoute: { routeId: "route-direct", providerId: "provider", modelId: "model", adapterCapabilityId: "direct", adapterCapabilityVersion: "1" },
      selectedAccount: { kind: "accountless" },
    });
    authority.fenceDispatch("job-a", "economic-attempt-a", "fence-a");
    expect(inspect.inspect({ jobId: "job-a", economicAttemptId: "economic-attempt-a" })).toMatchObject({ status: "dispatch-fenced", dispatchFenceId: "fence-a" });
    authority.recordExecutionSettlementPending("job-a", "economic-attempt-a", "fence-a", "awaiting settlement");
    expect(inspect.inspect({ jobId: "job-a", economicAttemptId: "economic-attempt-a" })).toMatchObject({ status: "settlement-pending", settlementKind: "unknown" });
    authority.settleExecution("job-a", "economic-attempt-a", "fence-a", {
      kind: "free", reservationId: first.record.commitment.reservation.reservationId, dispatchFenceId: "fence-a",
      actualIdentity: first.record.commitment.reservation.selectedIdentity, units: [],
      evidence: snapshot().routes[0]!.priceEvidence.identity.evidence,
    });
    const released = inspect.inspect({ jobId: "job-a", economicAttemptId: "economic-attempt-a" });
    expect(released).toMatchObject({ status: "released", settlementKind: "free", settlementAuthority: "configured" });
    expect(JSON.stringify(released)).not.toMatch(/accountRef|credentialRevision|amount/iu);

    const denied = authority.acquireCommitment({ ...input(), jobId: "job-b", economicAttemptId: "economic-attempt-b" });
    expect(denied).toMatchObject({ status: "committed" });
    const capacityDenied = authority.acquireCommitment({ ...input(), jobId: "job-c", economicAttemptId: "economic-attempt-c" });
    expect(capacityDenied).toMatchObject({ status: "denied" });
    expect(inspect.inspect({ jobId: "job-c", economicAttemptId: "economic-attempt-c" })).toMatchObject({
      status: "denied", policyId: "policy", policyDigest: `sha256:${"1".repeat(64)}`,
      rejections: [{ stage: "local-capacity", routeId: "route-direct", reason: "route-capacity-exhausted" }],
    });
  });

  it("fails visibly for legacy or malformed durable decision evidence", () => {
    const authority = create();
    expect(authority.acquireCommitment(input())).toMatchObject({ status: "committed" });
    const database = new Database(join(roots.at(-1)!, "authority.sqlite"), { strict: true });
    database.query("UPDATE economic_commitments SET decision_json=? WHERE job_id=?").run(JSON.stringify({ decision: { kind: "selected" }, authorityRejections: [] }), "job-a");
    database.close();
    expect(() => authority.createAgentTaskReplayInspectionPort().inspect({ jobId: "job-a", economicAttemptId: "economic-attempt-a" }))
      .toThrow(/unprojectable/u);
  });

  it("fails closed rather than projecting injected route or account secrets", () => {
    const authority = create();
    expect(authority.acquireCommitment(input())).toMatchObject({ status: "committed" });
    const database = new Database(join(roots.at(-1)!, "authority.sqlite"), { strict: true });
    const row = database.query<{ commitment_json: string }, [string]>("SELECT commitment_json FROM economic_commitments WHERE job_id=?")
      .get("job-a");
    if (!row) throw new Error("Expected commitment row.");
    const corrupted = JSON.parse(row.commitment_json) as { reservation: { selectedIdentity: { route: Record<string, unknown>; account: Record<string, unknown> } } };
    corrupted.reservation.selectedIdentity.route.secret = "route-secret";
    corrupted.reservation.selectedIdentity.account.accountRef = "configured:injected";
    corrupted.reservation.selectedIdentity.account.credentialRevision = "revision-secret";
    database.query("UPDATE economic_commitments SET commitment_json=? WHERE job_id=?").run(JSON.stringify(corrupted), "job-a");
    database.close();
    expect(() => authority.createAgentTaskReplayInspectionPort().inspect({ jobId: "job-a", economicAttemptId: "economic-attempt-a" }))
      .toThrow(/unprojectable/u);
  });

  it("returns typed rejection evidence when an in-flight reservation is incompatible with the route ceiling", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-incompatible-capacity-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const authority = createAt(path, "owner-a", () => Date.parse("2026-07-31T11:00:00.000Z"));
    expect(authority.acquireCommitment(input())).toMatchObject({ status: "committed" });
    const database = new Database(path, { strict: true });
    database.query("UPDATE economic_commitments SET reserved_amounts=? WHERE job_id=?").run(
      JSON.stringify([{ atoms: "1", scale: 0, unit: "credit", scheme: { kind: "credit", creditSchemeId: "other" } }]),
      "job-a",
    );
    database.close();

    expect(authority.acquireCommitment({
      ...input(), jobId: "job-b", economicAttemptId: "economic-attempt-b",
    })).toMatchObject({
      status: "denied",
      evidence: { authorityRejections: [{
        stage: "local-capacity", routeId: "route-direct", reason: "comparison-domain-incompatible",
      }] },
    });
  });

  it("commits account credit and overage posture from configured account economics", () => {
    const authority = create();
    const adopted = accountSnapshot();
    const { route, candidate } = accountCapacity(adopted);
    const acquired = authority.acquireCommitment({
      ...input(adopted),
      routeCapacity: [{
        routeId: "route-direct",
        route,
        affinityRequest: { continuity: "none" },
        candidates: [{
          ...candidate,
          accountEconomics: {
            capacityIdentity: "account-a",
            subscriptionClass: "metered",
            quotaClassId: "quota",
            creditPosture: "committed",
            overagePosture: "committed",
          },
        }],
      }],
    });

    expect(acquired).toMatchObject({
      status: "committed",
      record: {
        commitment: {
          reservation: {
            selectedIdentity: {
              account: {
                kind: "account-bound",
                creditPosture: "committed",
                overagePosture: "committed",
              },
            },
          },
        },
      },
    });
  });

  it("fails closed when an account-bound commitment references a missing lease row", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-corrupt-lease-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const authority = createAt(path, "owner-a", () => Date.parse("2026-07-31T11:00:00.000Z"));
    const adopted = accountSnapshot();
    const { route, candidate } = accountCapacity(adopted);
    expect(authority.acquireCommitment({
      ...input(adopted),
      routeCapacity: [{
        routeId: "route-direct",
        route,
        affinityRequest: { continuity: "none" },
        candidates: [candidate],
      }],
    })).toMatchObject({ status: "committed" });
    authority.close();

    const database = new Database(path);
    database.exec("PRAGMA foreign_keys=OFF; DELETE FROM account_leases;");
    database.close();
    const reopened = createAt(path, "owner-b", () => Date.parse("2026-07-31T11:00:01.000Z"));

    expect(() => reopened.recoverCommitments())
      .toThrow("account lease reference is corrupt");
  });

  it("releases ownership on close so a restart reclaims the authority without waiting out the stale interval", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-owner-release-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const at = Date.parse("2026-07-31T11:00:00.000Z");
    const first = createAt(path, "owner-a", () => at);
    expect(() => createAt(path, "owner-b", () => at)).toThrow("already has a live owner");

    first.close();

    // Same instant: reclaim must come from the released claim, not from staleness.
    createAt(path, "owner-b", () => at);
  });

  it("undoes a newly won affinity and restores account capacity on pre-fence release", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-affinity-release-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const authority = createAt(path, "owner-a", () => Date.parse("2026-07-31T11:00:00.000Z"));
    const adopted = accountSnapshot();
    const { route, candidate } = accountCapacity(adopted);
    const affinityKey = "e".repeat(64);
    const request = input(adopted);
    const capacity = [{ routeId: "route-direct", route,
      affinityRequest: { continuity: "prefer" as const, scope: "session" as const, key: affinityKey as never },
      candidates: [candidate] }];

    expect(authority.acquireCommitment({ ...request, routeCapacity: capacity })).toMatchObject({
      status: "committed", record: { lease: { lifecycleState: "held", affinityCommitOutcome: "won" } },
    });
    const during = new Database(path, { strict: true });
    expect(during.query<{ count: number }, []>("SELECT COUNT(*) count FROM managed_account_affinities").get()?.count).toBe(1);
    during.close();

    expect(authority.releaseCommitmentPreFence("job-a", "economic-attempt-a")).toMatchObject({
      state: "released", lease: { lifecycleState: "released" },
    });
    const after = new Database(path, { strict: true });
    expect(after.query<{ count: number }, []>("SELECT COUNT(*) count FROM managed_account_affinities").get()?.count).toBe(0);
    after.close();
    expect(authority.acquireCommitment({ ...request, jobId: "job-after-release",
      economicAttemptId: "economic-attempt-after-release", routeCapacity: capacity }))
      .toMatchObject({ status: "committed" });
  });

  it("recovers a pre-fence restart as releasable and transfers ownership", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-restart-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const first = createAt(path, "owner-a", () => 1_000);
    first.acquireCommitment(input());
    first.close();
    authorities.splice(authorities.indexOf(first), 1);

    const restarted = createAt(path, "owner-b", () => 2_000);
    expect(restarted.recoverCommitments()).toMatchObject([{ state: "held" }]);
    expect(restarted.createAgentTaskCommitmentRecoveryPort().query({
      jobId: "job-a", economicAttemptId: "economic-attempt-a",
    })).toBe("committed");
    expect(restarted.releaseCommitmentPreFence("job-a", "economic-attempt-a").state).toBe("released");
  });

  it("does not replay a terminal settlement-pending report from a foreign owner", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-terminal-owner-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const first = createAt(path, "owner-a", () => 1_000);
    const acquired = first.acquireCommitment(input());
    if (acquired.status !== "committed") throw new Error("fixture");
    first.fenceDispatch("job-a", "economic-attempt-a", "fence-a");
    first.settleExecution("job-a", "economic-attempt-a", "fence-a", {
      kind: "free",
      reservationId: acquired.record.commitment.reservation.reservationId,
      dispatchFenceId: "fence-a",
      actualIdentity: acquired.record.commitment.reservation.selectedIdentity,
      units: [],
      evidence: snapshot().routes[0]!.priceEvidence.identity.evidence,
    });
    first.close();
    authorities.splice(authorities.indexOf(first), 1);

    const foreign = createAt(path, "owner-b", () => 2_000);
    expect(() => foreign.recordExecutionSettlementPending(
      "job-a",
      "economic-attempt-a",
      "fence-a",
      "foreign terminal replay",
    )).toThrow("terminal settlement is not owned");
  });

  it("recovers a post-fence restart conservatively without freeing capacity", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-fenced-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const first = createAt(path, "owner-a", () => 1_000);
    first.acquireCommitment(input());
    first.fenceDispatch("job-a", "economic-attempt-a", "fence-a");
    first.close();
    authorities.splice(authorities.indexOf(first), 1);

    const restarted = createAt(path, "owner-b", () => 2_000);
    expect(restarted.recoverCommitments()).toMatchObject([{
      state: "settlement-pending", settlement: { kind: "pending", dispatchFenceId: "fence-a" },
    }]);
    expect(restarted.createAgentTaskCommitmentRecoveryPort().query({
      jobId: "job-a", economicAttemptId: "economic-attempt-a",
    })).toBe("dispatch-fenced");
    expect(() => restarted.releaseCommitmentPreFence("job-a", "economic-attempt-a"))
      .toThrow("definitely pre-dispatch");
    expect(restarted.acquireCommitment({ ...input(), jobId: "job-b", economicAttemptId: "economic-attempt-b" }))
      .toMatchObject({ status: "denied" });
  });

  it("rejects every economic mutation from a stale owner generation", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-stale-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    let clock = 1_000;
    const stale = createAt(path, "owner-a", () => clock);
    stale.acquireCommitment(input());
    clock = 3_000;
    const current = createAt(path, "owner-b", () => clock);
    current.recoverCommitments();
    expect(() => stale.acquireCommitment({ ...input(), jobId: "job-b", economicAttemptId: "economic-attempt-b" }))
      .toThrow("ownership was lost");
    expect(() => stale.releaseCommitmentPreFence("job-a", "economic-attempt-a"))
      .toThrow("ownership was lost");
    expect(() => stale.fenceDispatch("job-a", "economic-attempt-a", "fence-stale"))
      .toThrow("ownership was lost");
  });

  it("refuses a second live owner before it can participate in capacity", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-live-owner-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    createAt(path, "owner-a", () => 1_000, 10_000);
    expect(() => createAt(path, "owner-b", () => 1_001, 10_000))
      .toThrow("already has a live owner");
  });

  it("refuses a second live generation that reuses the same owner id", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-authority-same-owner-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    createAt(path, "owner-a", () => 1_000, 10_000);

    expect(() => createAt(path, "owner-a", () => 1_001, 10_000))
      .toThrow("already has a live owner");
  });

  it.runIf(process.platform !== "win32")("creates database artifacts owner-only", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-mode-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    createAt(path, "owner-a", () => 1_000);
    const artifacts = [path, `${path}-wal`, `${path}-shm`].filter(existsSync);
    expect(artifacts).toContain(path);
    for (const artifact of artifacts) {
      expect(statSync(artifact).mode & 0o777).toBe(0o600);
    }
  });

  it("statically excludes async transaction callbacks and transaction-time external ports", () => {
    const source = readFileSync(new URL(
      "../../src/managed-account-leases/managed-account-lease-authority.ts",
      import.meta.url,
    ), "utf8");
    expect(source).toContain("T extends PromiseLike<unknown> ? never : unknown");
    expect(source).not.toMatch(/#transaction[^]*?await /u);
    expect(input()).not.toHaveProperty("provider");
    expect(input()).not.toHaveProperty("config");
    expect(input()).not.toHaveProperty("filesystem");
  });

  it("consumes only completed immutable adoption data and cannot invoke external callbacks", async () => {
    let authorityStarted = false;
    const calls: string[] = [];
    const external = (name: string, value: unknown) => async () => {
      if (authorityStarted) throw new Error(`${name} callback crossed the transaction boundary`);
      calls.push(name);
      return value;
    };
    const resolveSnapshot = external("snapshot", snapshot());
    const resolveCandidates = external("candidates", [{ routeId: "route-direct" }] as const);
    const resolveProvider = external("provider", Object.freeze({ ready: true }));
    const readConfig = external("config", Object.freeze({ revision: "one" }));
    const readFilesystem = external("filesystem", Object.freeze({ available: true }));
    const [adopted, routeCapacity] = await Promise.all([
      resolveSnapshot(), resolveCandidates(), resolveProvider(), readConfig(), readFilesystem(),
    ]).then(([snapshotValue, capacity]) => [snapshotValue, capacity] as const);
    const prepared = Object.freeze({ ...input(adopted as ManagedEconomicAdoptedSnapshot), routeCapacity });
    expect(calls).toEqual(["snapshot", "candidates", "provider", "config", "filesystem"]);

    authorityStarted = true;
    expect(create().acquireCommitment(prepared)).toMatchObject({ status: "committed" });
    expect(calls).toEqual(["snapshot", "candidates", "provider", "config", "filesystem"]);
  });

  it("refuses a database created by a newer authority version", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-newer-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const db = new Database(path, { create: true });
    db.exec("PRAGMA user_version=999;");
    db.close();
    expect(() => new SqliteManagedAccountLeaseAuthority({ path, ownerId: "owner-a" }))
      .toThrow("newer than supported");
  });
});
