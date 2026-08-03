import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FilesystemManagedJobStore,
  InMemoryManagedJobStore,
  ManagedJobApplicationService,
  type ManagedJobApplicationOptions,
  type ManagedJobEconomicProfile,
  type ManagedJobEconomicAdoption,
} from "../../src/managed-jobs/index.js";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import {
  adoptManagedEconomicSnapshot,
  digestManagedEconomicValue,
  type ManagedEconomicPriceEvidence,
} from "@kilnai/core";
import type { ManagedEconomicCandidateSet } from "../../src/agents/managed-invocation/runtime-tool.js";
import { ManagedEconomicDispatchCoordinator } from "../../src/agents/managed-invocation/economic-dispatch-coordinator.js";

const now = new Date("2026-07-29T18:00:00.000Z");
const submission = {
  objective: "Inspect the policy-owned precommit boundary.",
  configuredAgentProfileId: "scout",
  callerId: "codex-app:caller-001",
  idempotencyKey: "caller-001",
};
const query = {
  project: { id: "kiln" },
  callerId: "codex-app:caller-001",
} as const;

function profile(
  constraints: ManagedJobEconomicProfile["constraints"] = {},
): ManagedJobEconomicProfile {
  return {
    id: "scout",
    economicPolicyId: "economy-policy",
    economicPolicyRevision: "revision-001",
    admissionProfileId: "foundation-readonly-plan",
    constraints,
  };
}

function candidateSet(
  constraints: ManagedJobEconomicProfile["constraints"] = {},
): ManagedEconomicCandidateSet {
  return {
    economicPolicyId: "economy-policy",
    economicPolicyRevision: "revision-001",
    admissionProfileId: "foundation-readonly-plan",
    constraints,
    candidates: [{
      routeId: "codex-primary",
      routeSource: "explicit-managed-route",
      providerId: "codex-oauth",
      model: "gpt-test",
      accountPolicyId: "codex-pool",
      surface: "direct-provider",
      adapterCapabilityId: "codex-oauth-direct",
      adapterCapabilityVersion: "1",
    }],
    rejections: [{
      stage: "managed-candidate-admission",
      routeId: "remote-fallback",
      reason: "economic-capability-unverified",
    }],
  };
}

function createOptions(input: {
  readonly currentProfile?: () => ManagedJobEconomicProfile;
  readonly currentCandidates?: () => ManagedEconomicCandidateSet;
  readonly store?: ManagedJobApplicationOptions["store"];
  readonly clock?: () => Date;
  readonly commitmentState?: "absent" | "committed" | "dispatch-fenced";
} = {}): ManagedJobApplicationOptions {
  return {
    project: { resolve: async () => ({ id: "kiln" }) },
    governance: {
      resolve: async () => ({
        version: 1,
        authority: "authoritative",
        source: "kiln-config-status",
        issuedAt: "2026-07-29T17:59:00.000Z",
        validUntil: "2026-07-29T18:01:00.000Z",
      }),
      admit: async () => ({
        admitted: true,
        admissionId: "admission-001",
        source: "kiln-work-governance",
      }),
    },
    profiles: {
      resolve: async (id) => id === "scout"
        ? (input.currentProfile?.() ?? profile())
        : undefined,
    },
    routes: {
      resolve: async () => input.currentCandidates?.() ?? candidateSet(),
    },
    store: input.store ?? new InMemoryManagedJobStore(),
    ...(input.commitmentState ? {
      commitmentRecovery: {
        query: () => input.commitmentState!,
      },
    } : {}),
    clock: input.clock ?? (() => now),
    idGenerator: () => "job-000000001",
    economicAttemptIdGenerator: () => "attempt-000000001",
  };
}

function adoptedEconomicEvidence(): ManagedJobEconomicAdoption {
  return {
    snapshot: {
      snapshotDigest: `sha256:${"d".repeat(64)}`,
      adoptedDecisionAt: now.toISOString(),
      routes: [],
    } as never,
    expectation: { candidateSetDigest: `sha256:${"c".repeat(64)}` } as never,
    routeCapacity: [],
  };
}

function sqliteAdoptedEconomicEvidence(): ManagedJobEconomicAdoption {
  const economicAmount = { atoms: "1", scale: 0, unit: "request",
    scheme: { kind: "currency" as const, currency: "USD" } };
  const evidence = {
    sourceIdentity: "managed-job-test", sourceRevision: "revision-001",
    sourceDigest: `sha256:${"a".repeat(64)}`,
    observedAt: "2026-07-29T17:00:00.000Z", validUntil: "2026-07-29T19:00:00.000Z",
    confidence: "high" as const, authority: "configured" as const,
  };
  const unitRates = [{ usageUnit: "request", price: economicAmount }];
  const auxiliaryCharges: never[] = [];
  const domain = { id: "usd", rank: 0, basis: { unit: "request",
    scheme: { kind: "currency" as const, currency: "USD" },
    rateCardBasis: "test-rate-card", envelopeSemantics: "bounded-test" } };
  const priceEvidence: ManagedEconomicPriceEvidence = { kind: "metered", identity: {
    providerId: "codex-oauth", modelId: "gpt-test", authBillingChannel: "oauth",
    executionMode: "managed", serviceTier: "test", rateCardId: "test-rate-card",
    rateCardRevision: "revision-001", unit: "request",
    scheme: { kind: "currency", currency: "USD" },
    unitScheduleDigest: digestManagedEconomicValue(unitRates), contextClass: "test",
    cacheClass: "none", auxiliaryScheduleDigest: digestManagedEconomicValue(auxiliaryCharges), evidence,
  } };
  const route = {
    routeId: "codex-primary", providerId: "codex-oauth", modelId: "gpt-test",
    adapterCapabilityId: "codex-oauth-direct", adapterCapabilityVersion: "1",
    authBillingChannel: "oauth", executionMode: "managed", serviceTier: "test",
    accountPolicyId: null, fallbackPosture: "disabled" as const, overagePosture: "disabled" as const,
    rateCardId: "test-rate-card", rateCardRevision: "revision-001",
    priceEvidenceDigest: evidence.sourceDigest, unit: "request",
    scheme: { kind: "currency" as const, currency: "USD" }, contextClass: "test", cacheClass: "none",
    auxiliaryScheduleDigest: priceEvidence.identity.auxiliaryScheduleDigest,
    envelopeDigest: `sha256:${"e".repeat(64)}`,
  };
  const snapshot = adoptManagedEconomicSnapshot({
    policy: { policyId: "economy-policy", schemaVersion: 1, policyRevision: "revision-001",
      policyDigest: `sha256:${"b".repeat(64)}`, comparisonDomains: [domain], noRouteAction: "deny",
      evidenceRequirements: { quota: "optional", price: "required" } },
    adoptedAt: now.toISOString(), adoptedDecisionAt: now.toISOString(), callerConstraints: {},
    routes: [{
      admittedIdentity: { routeId: "codex-primary", sourceIdentity: "explicit-managed-route",
        providerId: "codex-oauth", modelId: "gpt-test", adapterCapabilityId: "codex-oauth-direct",
        adapterCapabilityVersion: "1", accountPolicy: { kind: "accountless" } },
      route, comparisonDomain: domain, priorityRank: 0, priceEvidence,
      rateSchedule: { unitRates, auxiliaryCharges },
      executionEnvelope: { kind: "bounded", digest: route.envelopeDigest, limits: [{
        atoms: "1", scale: 0, unit: "request", scheme: { kind: "unit" },
      }] },
      worstCaseReservation: { kind: "exact", amount: economicAmount },
      ceiling: { kind: "finite", amount: economicAmount },
    }],
  });
  return {
    snapshot,
    expectation: {
      policyId: "economy-policy", policyRevision: "revision-001",
      candidateSetDigest: snapshot.candidateSetDigest,
      admittedCandidates: snapshot.routes.map((entry) => entry.admittedIdentity), callerConstraints: {},
    },
    routeCapacity: [{ routeId: "codex-primary" }],
  };
}

describe("ManagedJobApplicationService V7 record", () => {
  it("persists policy identity and candidates without selecting an execution route", async () => {
    const service = new ManagedJobApplicationService(createOptions());

    const job = await service.submit(submission);

    expect(job).toMatchObject({
      version: 7,
      state: "failed",
      diagnostic: "economic_commitment_unavailable",
      economicPolicyId: "economy-policy",
      economicPolicyRevision: "revision-001",
      constraints: {},
      candidateSet: {
        candidates: [{ routeId: "codex-primary" }],
        rejections: [{ reason: "economic-capability-unverified" }],
      },
      lifecycle: [
        { sequence: 1, state: "queued" },
        {
          sequence: 2,
          state: "failed",
          diagnostic: "economic_commitment_unavailable",
        },
      ],
      economicAttemptId: "economic-attempt:attempt-000000001",
      adoptedDecisionAt: now.toISOString(),
    });
    expect(job.requestFingerprint).toBe(digestManagedEconomicValue({
      objective: submission.objective,
      configuredAgentProfileId: submission.configuredAgentProfileId,
      economicPolicyId: "economy-policy",
      economicPolicyRevision: "revision-001",
      constraints: {},
    }));
    expect(job.idempotencyKeyHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(job).not.toHaveProperty("routeId");
    expect(job).not.toHaveProperty("providerId");
    expect(job).not.toHaveProperty("accountLease");
    await expect(service.getResult(query, job.id)).resolves.toMatchObject({
      availability: "failed",
      diagnostic: "economic_commitment_unavailable",
    });
    await expect(service.getReplay(query, job.id)).resolves.toMatchObject({
      availability: "available",
      resultAvailability: "failed",
    });
  });

  it("never invokes an adapter, credential, lease, reservation, or provider port", async () => {
    const sideEffect = vi.fn();
    const options = createOptions();
    const service = new ManagedJobApplicationService({
      ...options,
      // The application contract deliberately has no execution-side port.
      routes: {
        resolve: async () => {
          expect(sideEffect).not.toHaveBeenCalled();
          return candidateSet();
        },
      },
    });

    await service.submit(submission);

    expect(sideEffect).not.toHaveBeenCalled();
    expect(Object.keys(options)).not.toContain("runtime");
  });

  it("persists one V7 terminal result after commitment, exact adapter construction, fence, and settlement", async () => {
    const fenceDispatch = vi.fn();
    const settleExecution = vi.fn();
    const selectedCommitment = {
      commitmentId: "commitment-managed-job",
      reservation: {
        reservationId: "reservation-managed-job",
        jobId: "job-000000001",
        economicAttemptId: "economic-attempt:attempt-000000001",
        policy: {} as never,
        selectedIdentity: {
          route: {
            routeId: "codex-primary",
            providerId: "codex-oauth",
            modelId: "gpt-test",
            adapterCapabilityId: "codex-oauth-direct",
            adapterCapabilityVersion: "1",
          } as never,
          account: { kind: "accountless" as const },
        },
        priceIdentity: null,
        envelope: { kind: "bounded" as const, digest: `sha256:${"e".repeat(64)}`, limits: [] },
        amounts: [],
        authorityRevision: `sha256:${"d".repeat(64)}`,
      },
      rejected: [],
      notSelected: [],
    };
    const coordinator = new ManagedEconomicDispatchCoordinator({
      authority: {
        acquire: () => ({
          status: "committed",
          replay: false,
          record: { commitment: selectedCommitment, state: "held" } as never,
        }),
        releasePreFence: vi.fn(),
        fenceDispatch,
        settleExecution,
        recordExecutionSettlementPending: vi.fn(),
      },
      resolveLifecycleTimeoutMs: () => 1_000,
      createAdapter: async () => ({ descriptor: {} }) as never,
    });
    const service = new ManagedJobApplicationService({
      ...createOptions(),
      economicAdoption: { adopt: async () => sqliteAdoptedEconomicEvidence() },
      economicDispatch: coordinator,
      economicExecution: {
        execute: async ({ preparation }) => {
          preparation.registerEconomicSettlement(Promise.resolve(
            preparation.createExecutionSettlement({
              actualIdentity: preparation.commitment.reservation.selectedIdentity,
              usage: {
                kind: "complete",
                units: [{ atoms: "3", scale: 0, unit: "request", scheme: { kind: "unit" } }],
              },
              evidence: sqliteAdoptedEconomicEvidence().snapshot.routes[0]!.priceEvidence.identity.evidence,
            }),
          ));
          return {
            runtimeInvocationId: "runtime-invocation-managed-job",
            completedAt: now.toISOString(),
            resultHandoff: {
              provenance: {
                delivery: "native-structured-output",
                configuredModelId: "gpt-test",
                primaryObservedModelId: "gpt-test",
                observedModelIds: ["gpt-test"],
              },
              summary: "Managed economic execution completed.",
              resourceUris: [],
              memoryWriteProposalUris: [],
            },
          };
        },
      },
    });

    const completed = await service.submit(submission);
    expect(completed).toMatchObject({
      version: 7,
      state: "succeeded",
      objective: submission.objective,
      result: {
        runtimeInvocationId: "runtime-invocation-managed-job",
        routeId: "codex-primary",
        providerId: "codex-oauth",
      },
    });
    await expect(service.getResult(query, completed.id)).resolves.toMatchObject({
      availability: "available",
      routeId: "codex-primary",
      providerId: "codex-oauth",
      handoff: { summary: "Managed economic execution completed." },
    });
    await expect(service.getReplay(query, completed.id)).resolves.toMatchObject({
      availability: "available",
      resultAvailability: "available",
      lifecycle: [
        { state: "queued" },
        { state: "running" },
        { state: "succeeded" },
      ],
    });
    expect(fenceDispatch).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(settleExecution).toHaveBeenCalledOnce());
  });

  it("binds idempotency to policy revision and normalized constraints", async () => {
    let constraints: ManagedJobEconomicProfile["constraints"] = {
      providerId: "codex-oauth",
      model: "openai/gpt-test",
    };
    const store = new InMemoryManagedJobStore();
    const service = new ManagedJobApplicationService(createOptions({
      store,
      currentProfile: () => profile(constraints),
      currentCandidates: () => candidateSet(constraints),
    }));

    const first = await service.submit(submission);
    await expect(service.submit(submission)).resolves.toEqual(first);
    expect(first).toMatchObject({ constraints: { model: "openai/gpt-test" } });

    constraints = { providerId: "codex-oauth" };
    await expect(service.submit(submission)).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
  });

  it("rejects pre-V7 managed-job records", () => {
    const queued = {
      version: 6,
      id: "job-precommit-006",
      economicAttemptId: "economic-attempt:attempt-precommit-006",
      adoptedDecisionAt: now.toISOString(),
      state: "queued",
      projectId: "kiln",
      callerId: "codex-app:caller-001",
      configuredAgentProfileId: "scout",
      admissionProfileId: "foundation-readonly-plan",
      economicPolicyId: "economy-policy",
      economicPolicyRevision: "revision-001",
      constraints: {},
      candidateSet: candidateSet(),
      governanceSource: "kiln-work-governance",
      admissionId: "admission-001",
      requestFingerprint: `sha256:${"a".repeat(64)}`,
      idempotencyKeyHash: `sha256:${"b".repeat(64)}`,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lifecycle: [{ sequence: 1, state: "queued", observedAt: now.toISOString() }],
    };
    expect(() => new InMemoryManagedJobStore([queued])).toThrowError(expect.objectContaining({
      code: "job_persistence_corrupt",
      operatorAction: "Reset the managed-job store; only canonical V7 records are supported.",
    }));
  });

  it("returns the persisted V7 attempt identity and decision time on a later replay", async () => {
    let currentTime = now;
    const store = new InMemoryManagedJobStore();
    const service = new ManagedJobApplicationService(createOptions({
      store,
      clock: () => currentTime,
    }));

    const first = await service.submit(submission);
    currentTime = new Date("2026-07-29T18:00:30.000Z");
    const replay = await service.submit(submission);

    expect(replay).toEqual(first);
    expect(replay).toMatchObject({
      version: 7,
      economicAttemptId: "economic-attempt:attempt-000000001",
      adoptedDecisionAt: now.toISOString(),
    });
  });

  it("rejects candidate evidence that does not bind the profile policy and constraints", async () => {
    const service = new ManagedJobApplicationService(createOptions({
      currentProfile: () => profile({ routeId: "codex-primary" }),
      currentCandidates: () => candidateSet(),
    }));

    await expect(service.submit(submission)).rejects.toMatchObject({
      code: "route_unavailable",
    });
  });

  it("fails before candidate admission and persistence when governance denies work", async () => {
    const store = new InMemoryManagedJobStore();
    const reserve = vi.spyOn(store, "reserve");
    const options = createOptions({ store });
    const resolveCandidates = vi.spyOn(options.routes, "resolve");
    const service = new ManagedJobApplicationService({
      ...options,
      governance: {
        ...options.governance,
        admit: async () => ({ admitted: false }),
      },
    });

    await expect(service.submit(submission)).rejects.toMatchObject({
      code: "admission_denied",
    });
    expect(resolveCandidates).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("serializes concurrent duplicate submissions at the store owner", async () => {
    const store = new InMemoryManagedJobStore();
    const service = new ManagedJobApplicationService(createOptions({ store }));

    const jobs = await Promise.all([
      service.submit(submission),
      service.submit(submission),
      service.submit(submission),
    ]);

    expect(new Set(jobs.map((job) => job.id))).toEqual(
      new Set(["job-000000001"]),
    );
    expect(store.all()).toHaveLength(1);
  });

  it("binds status and result queries to the persisted caller and project", async () => {
    const service = new ManagedJobApplicationService(createOptions());
    const job = await service.submit(submission);

    await expect(service.getStatus({
      ...query,
      callerId: "different-caller",
    }, job.id)).rejects.toMatchObject({ code: "unauthorized_job" });
    await expect(service.getResult({
      project: { id: "different-project" },
      callerId: query.callerId,
    }, job.id)).rejects.toMatchObject({ code: "unauthorized_job" });
  });

  it("keeps terminal records immutable and cancellation honest", async () => {
    const store = new InMemoryManagedJobStore();
    const service = new ManagedJobApplicationService(createOptions({ store }));
    const job = await service.submit(submission);

    await expect(service.cancel(query, job.id)).rejects.toMatchObject({
      code: "invalid_transition",
    });
    await expect(store.transition(job.id, "cancelled")).rejects.toMatchObject({
      code: "invalid_transition",
    });
  });

  it("preserves V7 idempotency across a filesystem restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-jobs-v7-"));
    try {
      const first = new ManagedJobApplicationService(createOptions({
        store: new FilesystemManagedJobStore(root),
      }));
      const created = await first.submit(submission);
      const second = new ManagedJobApplicationService({
        ...createOptions({ store: new FilesystemManagedJobStore(root) }),
        idGenerator: () => "job-000000002",
      });

      await expect(second.submit(submission)).resolves.toEqual(created);
      const persisted = JSON.parse(
        await readFile(join(root, "managed-jobs.json"), "utf8"),
      ) as unknown[];
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({ version: 7 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed for corrupt V7 candidate evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-jobs-corrupt-"));
    try {
      const service = new ManagedJobApplicationService(createOptions({
        store: new FilesystemManagedJobStore(root),
      }));
      const created = await service.submit(submission);
      const path = join(root, "managed-jobs.json");
      const records = JSON.parse(await readFile(path, "utf8")) as Array<
        Record<string, unknown>
      >;
      const candidateSetRecord = records[0]?.candidateSet as {
        rejections: Array<Record<string, unknown>>;
      };
      candidateSetRecord.rejections[0]!.reason = "unowned-reason";
      await writeFile(path, `${JSON.stringify(records)}\n`, "utf8");

      await expect(
        new FilesystemManagedJobStore(root).get(created.id),
      ).rejects.toMatchObject({ code: "job_persistence_corrupt" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes storage failures without leaking infrastructure errors", async () => {
    const service = new ManagedJobApplicationService(createOptions({
      store: {
        reserve: async () => {
          throw new Error("C:\\operator\\secret-provider-payload");
        },
        get: async () => undefined,
        transition: async () => {
          throw new Error("unused");
        },
        completeSuccess: async () => {
          throw new Error("unused");
        },
        listNonterminal: async () => [],
      },
    }));

    await expect(service.submit(submission)).rejects.toEqual(
      expect.objectContaining({
        code: "job_persistence_unavailable",
        message: "job_persistence_unavailable",
      }),
    );
  });
});
