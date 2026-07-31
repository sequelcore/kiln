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
  type ManagedJobRecordV3,
  type ManagedJobRecordV4,
  type ManagedJobRecordV5,
} from "../../src/managed-jobs/index.js";
import type { ManagedEconomicCandidateSet } from "../../src/agents/managed-invocation/runtime-tool.js";

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
    clock: () => now,
    idGenerator: () => "job-000000001",
  };
}

describe("ManagedJobApplicationService V5 precommit", () => {
  it("persists policy identity and candidates without selecting an execution route", async () => {
    const service = new ManagedJobApplicationService(createOptions());

    const job = await service.submit(submission);

    expect(job).toMatchObject({
      version: 5,
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
    });
    expect(job).not.toHaveProperty("routeId");
    expect(job).not.toHaveProperty("providerId");
    expect(job).not.toHaveProperty("accountLease");
    await expect(service.getResult(query, job.id)).resolves.toMatchObject({
      availability: "failed",
      diagnostic: "economic_commitment_unavailable",
    });
    await expect(service.getReplay(query, job.id)).resolves.toMatchObject({
      availability: "unavailable",
      diagnostic: "replay_unavailable",
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

  it("recovers a persisted V5 precommit crash as commitment unavailable", async () => {
    const queued: ManagedJobRecordV5 = {
      version: 5,
      id: "job-precommit-001",
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
      requestFingerprint: "a".repeat(64),
      idempotencyKeyHash: "b".repeat(64),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lifecycle: [{ sequence: 1, state: "queued", observedAt: now.toISOString() }],
    };
    const store = new InMemoryManagedJobStore([queued]);
    const service = new ManagedJobApplicationService(createOptions({ store }));

    await expect(service.recoverInterrupted()).resolves.toEqual([
      expect.objectContaining({
        version: 5,
        state: "failed",
        diagnostic: "economic_commitment_unavailable",
      }),
    ]);
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

  it("keeps terminal V5 records immutable and cancellation honest", async () => {
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

  it("preserves V5 idempotency across a filesystem restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-jobs-v5-"));
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
      expect(persisted[0]).toMatchObject({ version: 5 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed for corrupt V5 candidate evidence", async () => {
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
        recordAccountLease: async () => {
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

describe("Managed job historical readers", () => {
  const historicalBase = {
    id: "job-historical-001",
    state: "failed" as const,
    projectId: "kiln",
    callerId: "codex-app:caller-001",
    configuredAgentProfileId: "scout",
    admissionProfileId: "foundation-readonly-plan",
    routeId: "historical-route",
    providerId: "opencode-go",
    governanceSource: "kiln-config-status",
    admissionId: "admission-historical",
    timeoutSource: "explicit-route" as const,
    requestFingerprint: "a".repeat(64),
    idempotencyKeyHash: "b".repeat(64),
    createdAt: "2026-07-29T17:00:00.000Z",
    updatedAt: "2026-07-29T17:01:00.000Z",
    diagnostic: "provider_rejected" as const,
    lifecycle: [
      {
        sequence: 1,
        state: "queued" as const,
        observedAt: "2026-07-29T17:00:00.000Z",
      },
      {
        sequence: 2,
        state: "failed" as const,
        observedAt: "2026-07-29T17:01:00.000Z",
        diagnostic: "provider_rejected" as const,
      },
    ],
  };

  it.each([
    { ...historicalBase, version: 3 as const } satisfies ManagedJobRecordV3,
    {
      ...historicalBase,
      version: 4 as const,
      accountLeaseHistory: [],
    } satisfies ManagedJobRecordV4,
  ])("reads V$version without rewriting it", async (fixture) => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-jobs-"));
    const path = join(root, "managed-jobs.json");
    const serialized = `${JSON.stringify([fixture])}\n`;
    try {
      await writeFile(path, serialized, "utf8");
      const store = new FilesystemManagedJobStore(root);

      await expect(store.get(fixture.id)).resolves.toEqual(fixture);
      expect(await readFile(path, "utf8")).toBe(serialized);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers historical nonterminal records through their original lifecycle", async () => {
    const running: ManagedJobRecordV4 = {
      ...historicalBase,
      version: 4,
      state: "running",
      updatedAt: "2026-07-29T17:00:30.000Z",
      diagnostic: undefined,
      lifecycle: [
        {
          sequence: 1,
          state: "queued",
          observedAt: "2026-07-29T17:00:00.000Z",
        },
        {
          sequence: 2,
          state: "running",
          observedAt: "2026-07-29T17:00:30.000Z",
        },
      ],
      accountLeaseHistory: [],
    };
    const store = new InMemoryManagedJobStore([running]);
    const service = new ManagedJobApplicationService(createOptions({ store }));

    await expect(service.recoverInterrupted()).resolves.toEqual([
      expect.objectContaining({
        version: 4,
        state: "interrupted",
        diagnostic: "invocation_failed",
      }),
    ]);
  });
});
