import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
} from "@kilnai/core";
import {
  createRuntimeManagedJobInvocationPort,
  FilesystemManagedJobStore,
  InMemoryManagedJobStore,
  ManagedJobApplicationError,
  ManagedJobApplicationService,
} from "../../src/managed-jobs/index.js";
import { RuntimeManagedAgentInvocationService } from "../../src/agents/managed-invocation/index.js";
import type { ManagedJobApplicationOptions, ManagedJobStore } from "../../src/managed-jobs/index.js";

const now = new Date("2026-07-13T22:00:00.000Z");
const request = { objective: "Inspect the managed job boundary.", configuredAgentProfileId: "scout", callerId: "codex-app:caller-001", idempotencyKey: "caller-001" };
const scope = { project: "validated", read: "validated", tools: "validated", network: "validated", write: "validated" } as const;
const eligibility = { authority: "authoritative", observedAt: "2026-07-13T21:59:00.000Z", validUntil: "2026-07-13T22:01:00.000Z" } as const;
const authority = {
  authorityProfileId: "authority-readonly",
  permissionProfile: "read-only",
  toolAuthority: { allowedToolNames: ["read"], writeAllowed: false, networkAllowed: false },
  workingDirectory: { path: "C:/workspace", mode: "read-only" },
  timeoutMs: 300000,
  credentialRoute: { mode: "credentialless" },
  memoryScope: { scope: { kind: "project", id: "kiln" }, access: "read-only" },
} as const;

const query = { project: { id: "kiln" }, callerId: "codex-app:caller-001" } as const;

function successfulRuntimeResult(input: {
  readonly jobId: string;
  readonly profile: { readonly id: string; };
  readonly route: { readonly id: string; readonly admissionProfileId: string; readonly providerId: string; };
}) {
  return {
    state: "succeeded" as const,
    result: {
      runtimeInvocationId: input.jobId,
      configuredAgentProfileId: input.profile.id,
      admissionProfileId: input.route.admissionProfileId,
      routeId: input.route.id,
      providerId: input.route.providerId,
      terminalState: "completed" as const,
      resultHandoff: { summary: "done", resourceUris: [], memoryWriteProposalUris: [] },
    },
  };
}

async function observeAccountLease(
  input: {
    readonly jobId: string;
    readonly route: { readonly accountPolicyId: string; readonly providerId: string };
    readonly accountLeaseObserver: ManagedJobApplicationOptions["runtime"]["invoke"] extends (input: infer T) => unknown
      ? T extends { readonly accountLeaseObserver: infer O } ? O : never
      : never;
  },
  lifecycleState: "held" | "settlement-pending" | "released" = "released",
): Promise<void> {
  await input.accountLeaseObserver({
    leaseId: `lease-${input.jobId}`,
    accountPolicyId: input.route.accountPolicyId,
    accountRef: "configured:account-a",
    route: {
      providerId: input.route.providerId,
      providerModelId: "qwen3.6-plus",
      scope: `virtual:${input.route.accountPolicyId}`,
    },
    jobId: input.jobId,
    runtimeInvocationId: input.jobId,
    credentialRevisionId: "a".repeat(64),
    selectionReason: "least-pressure",
    acquiredAt: now.toISOString(),
    lifecycleState,
    ...(lifecycleState === "released" ? { releasedAt: now.toISOString() } : {}),
    ...(lifecycleState === "released" ? { affinityCommitOutcome: "won" as const } : {}),
    resourceUris: [`kiln://managed-accounts/leases/lease-${input.jobId}`],
    diagnosticUris: lifecycleState === "settlement-pending"
      ? [`kiln://managed-accounts/leases/lease-${input.jobId}/settlement-pending`]
      : [],
  });
}

function admittedRoute(routeId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: routeId,
    accountPolicyId: "managed-opencode",
    admissionProfileId: "foundation-readonly-plan",
    supportedAdmissionProfileIds: ["foundation-readonly-plan"],
    providerId: "opencode-go",
    timeoutSource: "explicit-route" as const,
    scope,
    eligibility,
    authority,
    ...overrides,
  };
}

function createOptions(overrides: Partial<ManagedJobApplicationOptions> = {}): ManagedJobApplicationOptions {
  const runtime = overrides.runtime ?? {
    invoke: async (input: Parameters<ManagedJobApplicationOptions["runtime"]["invoke"]>[0]) => successfulRuntimeResult(input),
  };
  const { runtime: _runtime, ...remainingOverrides } = overrides;
  return {
    project: { resolve: async () => ({ id: "kiln" }) },
    governance: {
      resolve: async () => ({ version: 1, authority: "authoritative", source: "kiln-config-status", issuedAt: "2026-07-13T21:59:00.000Z", validUntil: "2026-07-13T22:01:00.000Z" }),
      admit: async () => ({ admitted: true, admissionId: "admission-001", source: "kiln-config-status" }),
    },
    profiles: { resolve: async (id) => id === "scout" ? { id, routeId: "opencode-go-scout-readonly" } : id === "researcher" ? { id, routeId: "opencode-go-researcher-readonly" } : undefined },
    routes: { resolve: async (profile) => admittedRoute(profile.routeId) },
    runtime: {
      invoke: async (input) => {
        const result = await runtime.invoke(input);
        await observeAccountLease(input, result.state === "timed_out" ? "settlement-pending" : "released");
        return result;
      },
      ...(runtime.cancel ? { cancel: runtime.cancel.bind(runtime) } : {}),
    },
    store: new InMemoryManagedJobStore(),
    clock: () => now,
    idGenerator: () => "job-000000001",
    ...remainingOverrides,
  };
}

describe("ManagedJobApplicationService", () => {
  it("returns a durable background identity, cancels through Runtime, and replays monotonic lifecycle evidence", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const runtime = {
      invoke: vi.fn(async (input) => {
        await waiting;
        return successfulRuntimeResult(input);
      }),
      cancel: vi.fn(async () => { release?.(); }),
    };
    const service = new ManagedJobApplicationService(createOptions({ runtime }));

    const submitted = await service.start(request);
    expect(submitted).toMatchObject({ id: "job-000000001", state: "running" });

    const cancelled = await service.cancel(query, submitted.id);
    expect(cancelled).toMatchObject({ state: "cancelled", diagnostic: "cancelled" });
    expect(runtime.cancel).toHaveBeenCalledWith({ jobId: submitted.id, reason: "Operator cancelled managed work." });

    await vi.waitFor(async () => expect((await service.getStatus(query, submitted.id)).state).toBe("cancelled"));
    await expect(service.getReplay(query, submitted.id)).resolves.toMatchObject({
      availability: "available",
      jobId: submitted.id,
      lifecycle: [
        { sequence: 1, state: "queued" },
        { sequence: 2, state: "running" },
        { sequence: 3, state: "cancelled", diagnostic: "cancelled" },
      ],
      resultAvailability: "failed",
    });
  });

  it("creates one admitted canonical job and exposes its durable status", async () => {
    const runtime = { invoke: vi.fn(async (input) => successfulRuntimeResult(input)) };
    const service = new ManagedJobApplicationService(createOptions({ runtime }));
    const submitted = await service.submit(request);
    const status = await service.getStatus(query, submitted.id);
    const result = await service.getResult(query, submitted.id);
    const replay = await service.getReplay(query, submitted.id);

    expect(submitted).toMatchObject({ id: "job-000000001", state: "succeeded", projectId: "kiln", configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "opencode-go-scout-readonly", providerId: "opencode-go", governanceSource: "kiln-config-status", timeoutSource: "explicit-route" });
    expect(submitted).toMatchObject({
      version: 4,
      accountLease: {
        accountPolicyId: "managed-opencode",
        accountRef: "configured:account-a",
        lifecycleState: "released",
        affinityCommitOutcome: "won",
      },
      accountLeaseHistory: [{ lifecycleState: "released", affinityCommitOutcome: "won" }],
    });
    expect(status).toEqual(submitted);
    expect(result).toMatchObject({
      availability: "available",
      jobId: submitted.id,
      configuredAgentProfileId: "scout",
      provenance: { source: "runtime-managed-invocation", trust: "untrusted-child-output" },
      handoff: { summary: "done", resourceUris: [], memoryWriteProposalUris: [] },
      accountLease: { lifecycleState: "released", affinityCommitOutcome: "won" },
    });
    expect(replay).toMatchObject({
      accountLease: { lifecycleState: "released", affinityCommitOutcome: "won" },
      accountLeaseHistory: [{ lifecycleState: "released", affinityCommitOutcome: "won" }],
    });
    expect(runtime.invoke).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-000000001", route: expect.objectContaining({ providerId: "opencode-go" }) }));
  });

  it("fails closed when Runtime omits the required account lease observation", async () => {
    const options = createOptions();
    const service = new ManagedJobApplicationService({
      ...options,
      runtime: { invoke: async (input) => successfulRuntimeResult(input) },
    });

    await expect(service.submit(request)).resolves.toMatchObject({
      version: 4,
      state: "failed",
      diagnostic: "account_lease_unavailable",
      accountLeaseHistory: [],
    });
  });

  it("uses the existing Runtime invocation owner for a configured opencode-go direct route", async () => {
    const runtimeService = new RuntimeManagedAgentInvocationService();
    const adapter = {
      descriptor: defineManagedAgentAdapterDescriptor({
        adapterDescriptorId: "direct:opencode-go", providerId: "opencode-go", adapterKind: "direct",
        supportedProfiles: ["foundation-readonly-plan"], supportedExecutionModes: ["direct-provider"],
        lifecycle: { exposesStart: true, exposesTerminal: true, exposesCleanup: true }, cancellation: { supported: true },
        timeout: { supported: true, diagnosticArtifactOnTimeout: true }, transcript: { supported: true, redactionKnown: true, truncationKnown: true, persistenceKnown: true, retentionKnown: true },
        usage: { supported: true, preservesProviderTokenClasses: true, supportsExplicitUnknowns: true, tokenClasses: ["input"], semanticSourceGranularity: "unknown", evidenceBasis: "adapter" },
        resultHandoff: { boundedSummary: true, resourcePointers: true }, credentialRoute: { supported: true }, memoryContext: { governedAdmission: true }, unsupportedFieldPolicy: "reject", cleanup: { supported: true },
      }),
      invoke: vi.fn(async ({ request, admission }) => defineManagedAgentInvocationRecord({
        invocationId: request.invocationId, agentId: request.agentId, parentSessionId: request.parentSessionId, parentTurnId: request.parentTurnId,
        profile: request.profile, lifecycleState: "completed", providerRoute: request.providerRoute, adapterKind: request.adapterKind, executionMode: request.executionMode,
        authority: request.authority, capabilitySnapshot: admission.capabilitySnapshot, childSessionId: "child-session", resultHandoff: { summary: "done", resourceUris: [], memoryWriteProposalUris: [] },
      })),
    };
    const runtime = createRuntimeManagedJobInvocationPort({
      service: runtimeService,
      resolver: { resolve: async ({ jobId }) => {
        const request = defineManagedAgentInvocationRequest({ invocationId: jobId, agentId: "configured-reviewer", parentSessionId: "parent-session", parentTurnId: "parent-turn", profile: "foundation-readonly-plan", requestedBy: "kiln", requestSource: "managed-job", providerRoute: { providerId: "opencode-go", surface: "direct-provider", model: "configured-model" }, adapterKind: "direct", executionMode: "direct-provider", authority: { authorityProfileId: "read-only", permissionProfile: "read-only", toolAuthority: { allowedToolNames: ["read"], writeAllowed: false, networkAllowed: false }, workingDirectory: { path: "C:/workspace", mode: "read-only" }, timeoutMs: 300000, timeoutSource: "explicit-route", credentialRoute: { mode: "credentialless" }, memoryScope: { scope: { kind: "project", id: "kiln" }, access: "read-only" } }, input: { summary: "Inspect boundary" } });
        return { request, adapter, capabilitySnapshot: { routeId: "opencode-go-scout-readonly", routeSource: "explicit-managed-route", capturedAt: now.toISOString() } };
      } },
    });
    const service = new ManagedJobApplicationService(createOptions({ runtime }));
    const job = await service.submit(request);
    await expect(service.getResult(query, job.id)).resolves.toMatchObject({ availability: "available", handoff: { summary: "done" } });
    expect(job).toMatchObject({ id: "job-000000001", providerId: "opencode-go", state: "succeeded" });
    expect(adapter.invoke).toHaveBeenCalledOnce();
    expect(runtimeService.status("job-000000001")?.record?.invocationId).toBe("job-000000001");
  });

  it("requires fresh authoritative governance and denies before provider invocation", async () => {
    const runtime = { invoke: vi.fn(async (input) => successfulRuntimeResult(input)) };
    const service = new ManagedJobApplicationService(createOptions({
      runtime,
      governance: { resolve: async () => ({ version: 1, authority: "authoritative", source: "kiln-config-status", issuedAt: "2026-07-13T20:00:00.000Z", validUntil: "2026-07-13T21:00:00.000Z" }), admit: async () => ({ admitted: true, admissionId: "admission-001", source: "kiln-config-status" }) },
    }));
    await expect(service.submit(request)).rejects.toMatchObject({ code: "governance_not_authoritative" });
    expect(runtime.invoke).not.toHaveBeenCalled();

    const denied = new ManagedJobApplicationService(createOptions({ runtime, governance: { resolve: async () => ({ version: 1, authority: "authoritative", source: "kiln-config-status", issuedAt: "2026-07-13T21:59:00.000Z", validUntil: "2026-07-13T22:01:00.000Z" }), admit: async () => ({ admitted: false }) } }));
    await expect(denied.submit(request)).rejects.toMatchObject({ code: "admission_denied" });
    expect(runtime.invoke).not.toHaveBeenCalled();
  });

  it("rejects caller provider/model overrides and invalid parent lineage", async () => {
    const service = new ManagedJobApplicationService(createOptions());
    await expect(service.submit({ ...request, providerId: "opencode-go" })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(service.submit({ ...request, parent: { invocationId: "parent", turnId: "bad path/" } })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("selects the configured route even when agents share an admission profile", async () => {
    const routes = { resolve: vi.fn(async (profile: { routeId: string }) => admittedRoute(profile.routeId)) };
    const service = new ManagedJobApplicationService(createOptions({ routes }));
    await expect(service.submit(request)).resolves.toMatchObject({ configuredAgentProfileId: "scout", routeId: "opencode-go-scout-readonly", admissionProfileId: "foundation-readonly-plan" });
    await expect(service.submit({ ...request, configuredAgentProfileId: "researcher", idempotencyKey: "researcher-key" })).resolves.toMatchObject({ configuredAgentProfileId: "researcher", routeId: "opencode-go-researcher-readonly", admissionProfileId: "foundation-readonly-plan" });
    expect(routes.resolve).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "scout", routeId: "opencode-go-scout-readonly" }));
    expect(routes.resolve).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "researcher", routeId: "opencode-go-researcher-readonly" }));
  });

  it("fails closed when the route contradicts the configured agent or admission profile", async () => {
    const wrongRoute = new ManagedJobApplicationService(createOptions({ routes: { resolve: async () => admittedRoute("opencode-go-researcher-readonly") } }));
    await expect(wrongRoute.submit(request)).rejects.toMatchObject({ code: "route_unavailable" });
    const wrongAdmission = new ManagedJobApplicationService(createOptions({ routes: { resolve: async (profile) => admittedRoute(profile.routeId, { supportedAdmissionProfileIds: ["different-profile"] }) } }));
    await expect(wrongAdmission.submit(request)).rejects.toMatchObject({ code: "route_unavailable" });
  });

  it("rejects a configured agent without an explicit route hint before a job is created", async () => {
    const store = new InMemoryManagedJobStore();
    const reserve = vi.spyOn(store, "reserve");
    const runtime = { invoke: vi.fn(async (input) => successfulRuntimeResult(input)) };
    const service = new ManagedJobApplicationService(createOptions({
      store,
      runtime,
      profiles: { resolve: async () => ({ id: "scout", routeId: "" }) },
    }));

    await expect(service.submit(request)).rejects.toMatchObject({ code: "profile_unavailable" });
    expect(reserve).not.toHaveBeenCalled();
    expect(runtime.invoke).not.toHaveBeenCalled();
  });

  it.each(["project", "read", "tools", "network", "write"] as const)("rejects an unvalidated %s scope before a job is created", async (scopeName) => {
    const store = new InMemoryManagedJobStore();
    const reserve = vi.spyOn(store, "reserve");
    const runtime = { invoke: vi.fn(async (input) => successfulRuntimeResult(input)) };
    const scope = { project: "validated", read: "validated", tools: "validated", network: "validated", write: "validated", [scopeName]: "denied" };
    const service = new ManagedJobApplicationService(createOptions({
      store,
      runtime,
      routes: { resolve: async (profile) => ({
        id: profile.routeId,
        admissionProfileId: "foundation-readonly-plan",
        supportedAdmissionProfileIds: ["foundation-readonly-plan"],
        providerId: "opencode-go",
        timeoutSource: "explicit-route",
        scope,
        eligibility: { authority: "authoritative", observedAt: now.toISOString(), validUntil: "2026-07-13T22:01:00.000Z" },
      } as never) },
    }));

    await expect(service.submit(request)).rejects.toMatchObject({ code: "route_unavailable" });
    expect(reserve).not.toHaveBeenCalled();
    expect(runtime.invoke).not.toHaveBeenCalled();
  });

  it("rejects stale route eligibility before a job is created", async () => {
    const store = new InMemoryManagedJobStore();
    const reserve = vi.spyOn(store, "reserve");
    const runtime = { invoke: vi.fn(async (input) => successfulRuntimeResult(input)) };
    const service = new ManagedJobApplicationService(createOptions({
      store,
      runtime,
      routes: { resolve: async (profile) => ({
        id: profile.routeId,
        admissionProfileId: "foundation-readonly-plan",
        supportedAdmissionProfileIds: ["foundation-readonly-plan"],
        providerId: "opencode-go",
        timeoutSource: "explicit-route",
        scope: { project: "validated", read: "validated", tools: "validated", network: "validated", write: "validated" },
        eligibility: { authority: "authoritative", observedAt: "2026-07-13T21:58:00.000Z", validUntil: "2026-07-13T21:59:00.000Z" },
      } as never) },
    }));

    await expect(service.submit(request)).rejects.toMatchObject({ code: "route_unavailable" });
    expect(reserve).not.toHaveBeenCalled();
    expect(runtime.invoke).not.toHaveBeenCalled();
  });

  it("is idempotent for an identical retry and conflicts for a different request", async () => {
    const runtime = { invoke: vi.fn(async (input) => successfulRuntimeResult(input)) };
    const service = new ManagedJobApplicationService(createOptions({ runtime }));
    const first = await service.submit(request);
    const retry = await service.submit(request);
    await expect(service.submit({ ...request, objective: "Different objective." })).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(service.submit({ ...request, configuredAgentProfileId: "researcher" })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(retry.id).toBe(first.id);
    expect(runtime.invoke).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent duplicate submissions at the job-owner store", async () => {
    const runtime = { invoke: vi.fn(async (input) => successfulRuntimeResult(input)) };
    const service = new ManagedJobApplicationService(createOptions({ runtime }));
    const jobs = await Promise.all(Array.from({ length: 8 }, () => service.submit(request)));
    expect(new Set(jobs.map((job) => job.id))).toEqual(new Set(["job-000000001"]));
    expect(runtime.invoke).toHaveBeenCalledTimes(1);
  });

  it("maps provider failure and timeout to honest terminal states with safe diagnostics", async () => {
    const failed = new ManagedJobApplicationService(createOptions({ runtime: { invoke: async () => ({ state: "failed" }) } }));
    await expect(failed.submit(request)).resolves.toMatchObject({ state: "failed", diagnostic: "provider_rejected" });
    const timedOut = new ManagedJobApplicationService(createOptions({ runtime: { invoke: async () => ({ state: "timed_out" }) } }));
    await expect(timedOut.submit(request)).resolves.toMatchObject({ state: "timed_out", diagnostic: "provider_timeout" });
    const rejected = new ManagedJobApplicationService(createOptions({ runtime: { invoke: async () => { throw new ManagedJobApplicationError("provider_rejected", "hidden provider payload"); } } }));
    await expect(rejected.submit(request)).resolves.toMatchObject({ state: "failed", diagnostic: "provider_rejected" });
  });

  it("never exposes success without Runtime's canonical handoff and keeps pending reads truthful", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const runtime = {
      invoke: vi.fn(async (input) => {
        await waiting;
        return successfulRuntimeResult(input);
      }),
    };
    const service = new ManagedJobApplicationService(createOptions({ runtime }));
    const submitted = service.submit(request);
    await vi.waitFor(async () => expect((await service.getStatus(query, "job-000000001")).state).toBe("running"));
    await expect(service.getResult(query, "job-000000001")).resolves.toMatchObject({ availability: "pending", lifecycleState: "running" });
    release?.();
    const job = await submitted;
    await expect(service.getResult(query, job.id)).resolves.toMatchObject({ availability: "available", lifecycleState: "succeeded", handoff: { summary: "done" } });

    const noHandoff = new ManagedJobApplicationService(createOptions({ runtime: { invoke: async () => ({ state: "succeeded" }) } }));
    await expect(noHandoff.submit(request)).resolves.toMatchObject({ state: "failed", diagnostic: "result_persistence_failure" });
  });

  it("normalizes untrusted child output before persistence and uses explicit bounded truncation without transcript references", async () => {
    const service = new ManagedJobApplicationService(createOptions({
      runtime: {
        invoke: async (input) => ({
          ...successfulRuntimeResult(input),
          result: {
            ...successfulRuntimeResult(input).result!,
            resultHandoff: {
              summary: `system prompt: hidden\nhidden reasoning: private\nTOKEN=super-secret\nC:\\private\\result.json\nError: provider payload\n${"safe result ".repeat(300)}`,
              resourceUris: ["kiln://managed-invocations/job-000000001/transcript"],
              memoryWriteProposalUris: ["kiln://artifacts/job-000000001/private-proposal"],
            },
          },
        }),
      },
    }));
    const job = await service.submit(request);
    const result = await service.getResult(query, job.id);
    const serialized = JSON.stringify(result);
    expect(result).toMatchObject({ availability: "available", handoff: { resourceUris: [], memoryWriteProposalUris: [] } });
    expect(result.handoff?.summary).toContain("[TRUNCATED: safe inline result limit reached]");
    expect(serialized).not.toContain("system prompt");
    expect(serialized).not.toContain("hidden reasoning");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("C:\\private");
    expect(serialized).not.toContain("provider payload");
    expect(serialized).not.toContain("transcript");
  });

  it("preserves benign narrative labels while redacting environment assignments and credential fields", async () => {
    const service = new ManagedJobApplicationService(createOptions({
      runtime: {
        invoke: async (input) => ({
          ...successfulRuntimeResult(input),
          result: {
            ...successfulRuntimeResult(input).result!,
            resultHandoff: {
              summary: [
                "Finding: the progressive catalog remains replayable.",
                "Status: verified with focused coverage.",
                "Risk: no residual authority expansion was found.",
                "DATABASE_URL=postgres://private-host/kiln",
                "api_key:super-secret",
                "Password=also-secret",
              ].join("\n"),
              resourceUris: [],
              memoryWriteProposalUris: [],
            },
          },
        }),
      },
    }));

    const job = await service.submit(request);
    const summary = (await service.getResult(query, job.id)).handoff?.summary;

    expect(summary).toContain("Finding: the progressive catalog remains replayable.");
    expect(summary).toContain("Status: verified with focused coverage.");
    expect(summary).toContain("Risk: no residual authority expansion was found.");
    expect(summary).not.toContain("private-host");
    expect(summary).not.toContain("super-secret");
    expect(summary).not.toContain("also-secret");
    expect(summary?.match(/\[REDACTED:environment\]/gu)).toHaveLength(3);
  });

  it("fails closed for unlabelled provider JSON and strips the submitted objective if the child echoes it", async () => {
    const service = new ManagedJobApplicationService(createOptions({
      runtime: {
        invoke: async (input) => ({
          ...successfulRuntimeResult(input),
          result: {
            ...successfulRuntimeResult(input).result!,
            resultHandoff: { summary: `Provider output:\n\`\`\`json\n{"data":{"api_key":"super-secret","messages":[{"role":"system","content":"${request.objective}"}]}}\n\`\`\``, resourceUris: [], memoryWriteProposalUris: [] },
          },
        }),
      },
    }));
    const job = await service.submit(request);
    const serialized = JSON.stringify(await service.getResult(query, job.id));
    expect(serialized).toContain("[REDACTED:unsafe raw provider payload]");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain(request.objective);
  });

  it("binds result and status reads to the persisted caller and project owner", async () => {
    const service = new ManagedJobApplicationService(createOptions());
    const job = await service.submit(request);
    await expect(service.getStatus({ ...query, callerId: "codex-app:other" }, job.id)).rejects.toMatchObject({ code: "unauthorized_job" });
    await expect(service.getResult({ project: { id: "other-project" }, callerId: query.callerId }, job.id)).rejects.toMatchObject({ code: "unauthorized_job" });
  });

  it("returns safe failed diagnostics for failed, timed-out, and recovered interrupted jobs", async () => {
    const failed = new ManagedJobApplicationService(createOptions({ runtime: { invoke: async () => ({ state: "failed" }) } }));
    const failedJob = await failed.submit(request);
    await expect(failed.getResult(query, failedJob.id)).resolves.toMatchObject({ availability: "failed", lifecycleState: "failed", diagnostic: "provider_rejected" });

    const timedOut = new ManagedJobApplicationService(createOptions({ runtime: { invoke: async () => ({ state: "timed_out" }) } }));
    const timedOutJob = await timedOut.submit(request);
    await expect(timedOut.getResult(query, timedOutJob.id)).resolves.toMatchObject({ availability: "failed", lifecycleState: "timed_out", diagnostic: "provider_timeout" });

    const store = new InMemoryManagedJobStore();
    await store.reserve({ job: { version: 3, id: "job-interrupted", state: "running", projectId: "kiln", callerId: query.callerId, configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "opencode-go-scout-readonly", providerId: "opencode-go", governanceSource: "kiln-config-status", admissionId: "admission-001", timeoutSource: "default", requestFingerprint: "a".repeat(64), idempotencyKeyHash: "b".repeat(64), createdAt: now.toISOString(), updatedAt: now.toISOString(), lifecycle: [{ sequence: 1, state: "queued", observedAt: now.toISOString() }, { sequence: 2, state: "running", observedAt: now.toISOString() }] } });
    const recovered = new ManagedJobApplicationService(createOptions({ store }));
    await recovered.recoverInterrupted();
    await expect(recovered.getResult(query, "job-interrupted")).resolves.toMatchObject({ availability: "failed", lifecycleState: "interrupted", diagnostic: "invocation_failed" });
  });

  it("rejects a runtime result that mismatches the admitted route and cannot make success observable after result persistence failure", async () => {
    const mismatched = new ManagedJobApplicationService(createOptions({ runtime: { invoke: async (input) => ({ ...successfulRuntimeResult(input), result: { ...successfulRuntimeResult(input).result!, routeId: "other-route" } }) } }));
    await expect(mismatched.submit(request)).resolves.toMatchObject({ state: "failed", diagnostic: "result_corrupt" });

    const store = new InMemoryManagedJobStore();
    const completeSuccess = store.completeSuccess.bind(store);
    store.completeSuccess = async () => { throw new Error("persistence failed"); };
    const service = new ManagedJobApplicationService(createOptions({ store }));
    const job = await service.submit(request);
    expect(job).toMatchObject({ state: "failed", diagnostic: "job_persistence_unavailable" });
    store.completeSuccess = completeSuccess;
  });

  it("keeps persisted terminal results immutable", async () => {
    const store = new InMemoryManagedJobStore();
    const service = new ManagedJobApplicationService(createOptions({ store }));
    const job = await service.submit(request);
    await expect(store.completeSuccess(job.id, job.result!, now.toISOString())).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("reads the concrete V3 migration format without fabricating account evidence", async () => {
    const store = new InMemoryManagedJobStore();
    await store.reserve({ job: {
      version: 3, id: "cdb98e81-002b-44a4-aac9-e08b2f861a6b", state: "failed", projectId: "kiln", callerId: query.callerId, configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "opencode-go-scout-readonly", providerId: "opencode-go", governanceSource: "kiln-config-status", admissionId: "admission-001", timeoutSource: "default", requestFingerprint: "a".repeat(64), idempotencyKeyHash: "b".repeat(64), createdAt: now.toISOString(), updatedAt: now.toISOString(), diagnostic: "provider_rejected", lifecycle: [{ sequence: 1, state: "queued", observedAt: now.toISOString() }, { sequence: 2, state: "failed", observedAt: now.toISOString(), diagnostic: "provider_rejected" }],
    } });
    const service = new ManagedJobApplicationService(createOptions({ store }));
    await expect(service.getResult(query, "cdb98e81-002b-44a4-aac9-e08b2f861a6b")).resolves.toEqual(expect.objectContaining({
      availability: "failed",
      lifecycleState: "failed",
      diagnostic: "provider_rejected",
    }));
    await expect(service.getReplay(query, "cdb98e81-002b-44a4-aac9-e08b2f861a6b")).resolves.toMatchObject({
      availability: "available",
      accountLeaseHistory: [],
    });
  });

  it("persists lease-only aggregate updates without fabricating lifecycle transitions", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-job-lease-"));
    try {
      const store = new FilesystemManagedJobStore(root);
      const options = createOptions();
      const service = new ManagedJobApplicationService({
        ...options,
        store,
        runtime: { invoke: async (input) => successfulRuntimeResult(input) },
      });
      const job = await service.submit(request);
      const observedAt = new Date(now.getTime() + 1000).toISOString();
      await store.recordAccountLease(job.id, {
        leaseId: `lease-${job.id}`,
        accountPolicyId: "managed-opencode",
        accountRef: "configured:account-a",
        route: { providerId: "opencode-go", providerModelId: "qwen3.6-plus", scope: "virtual:managed-opencode" },
        jobId: job.id,
        runtimeInvocationId: job.id,
        credentialRevisionId: "a".repeat(64),
        selectionReason: "least-pressure",
        acquiredAt: now.toISOString(),
        lifecycleState: "held",
        resourceUris: [`kiln://managed-accounts/leases/lease-${job.id}`],
        diagnosticUris: [],
      }, observedAt);

      const restored = await new FilesystemManagedJobStore(root).get(job.id);
      expect(restored).toMatchObject({
        updatedAt: observedAt,
        accountLease: { lifecycleState: "held" },
      });
      expect(restored?.lifecycle.at(-1)?.observedAt).toBe(now.toISOString());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects lease evidence regression and immutable acquisition drift", async () => {
    const store = new InMemoryManagedJobStore();
    const options = createOptions();
    const service = new ManagedJobApplicationService({
      ...options,
      store,
      runtime: { invoke: async (input) => successfulRuntimeResult(input) },
    });
    const job = await service.submit(request);
    const base = {
      leaseId: `lease-${job.id}`,
      accountPolicyId: "managed-opencode",
      accountRef: "configured:account-a",
      route: { providerId: "opencode-go", providerModelId: "qwen3.6-plus", scope: "virtual:managed-opencode" },
      jobId: job.id,
      runtimeInvocationId: job.id,
      credentialRevisionId: "a".repeat(64),
      selectionReason: "least-pressure" as const,
      acquiredAt: now.toISOString(),
      resourceUris: [`kiln://managed-accounts/leases/lease-${job.id}`],
      diagnosticUris: [],
    };
    await store.recordAccountLease(job.id, { ...base, lifecycleState: "held" }, new Date(now.getTime() + 1000).toISOString());
    await expect(store.recordAccountLease(job.id, {
      ...base,
      lifecycleState: "held",
      diagnosticUris: [`kiln://managed-accounts/leases/lease-${job.id}/release-failed`],
    }, new Date(now.getTime() + 1500).toISOString())).rejects.toThrow("incompatible diagnostic evidence");
    const pendingUri = `kiln://managed-accounts/leases/lease-${job.id}/settlement-pending`;
    const unknownUri = `kiln://managed-accounts/leases/lease-${job.id}/settlement-unknown`;
    await store.recordAccountLease(job.id, {
      ...base,
      lifecycleState: "settlement-pending",
      diagnosticUris: [pendingUri],
    }, new Date(now.getTime() + 1600).toISOString());
    const enriched = await store.recordAccountLease(job.id, {
      ...base,
      lifecycleState: "settlement-pending",
      diagnosticUris: [pendingUri, unknownUri],
    }, new Date(now.getTime() + 1700).toISOString());
    const reordered = await store.recordAccountLease(job.id, {
      ...base,
      lifecycleState: "settlement-pending",
      diagnosticUris: [unknownUri, pendingUri],
    }, new Date(now.getTime() + 1800).toISOString());
    expect(reordered).toEqual(enriched);
    expect(reordered.accountLeaseHistory).toHaveLength(3);
    await store.recordAccountLease(job.id, {
      ...base,
      lifecycleState: "released",
      affinityCommitOutcome: "won",
      releasedAt: new Date(now.getTime() + 2000).toISOString(),
      diagnosticUris: [pendingUri, unknownUri],
    }, new Date(now.getTime() + 2000).toISOString());

    await expect(store.recordAccountLease(job.id, {
      ...base,
      lifecycleState: "held",
    }, new Date(now.getTime() + 3000).toISOString())).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(store.recordAccountLease(job.id, {
      ...base,
      acquiredAt: new Date(now.getTime() + 1).toISOString(),
      lifecycleState: "released",
      releasedAt: new Date(now.getTime() + 3000).toISOString(),
      diagnosticUris: [pendingUri, unknownUri],
    }, new Date(now.getTime() + 3000).toISOString())).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("persists the same immutable result across restart and fails closed for corrupt result evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-job-results-"));
    try {
      const first = new ManagedJobApplicationService(createOptions({ store: new FilesystemManagedJobStore(root) }));
      const job = await first.submit(request);
      const second = new ManagedJobApplicationService(createOptions({ store: new FilesystemManagedJobStore(root) }));
      await expect(second.getResult(query, job.id)).resolves.toMatchObject({ availability: "available", handoff: { summary: "done" } });
      await expect(second.getReplay(query, job.id)).resolves.toMatchObject({
        availability: "available",
        lifecycle: [
          { sequence: 1, state: "queued" },
          { sequence: 2, state: "running" },
          { sequence: 3, state: "succeeded" },
        ],
        resultAvailability: "available",
      });
      const payload = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, "managed-jobs.json"), "utf8")) as Array<Record<string, unknown>>;
      payload[0]!.result = { version: 1, jobId: "other-job" };
      await writeFile(join(root, "managed-jobs.json"), `${JSON.stringify(payload)}\n`, "utf8");
      await expect(second.getResult(query, job.id)).rejects.toMatchObject({ code: "job_persistence_corrupt" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("recovers persisted nonterminal work as interrupted and preserves parent-child separation", async () => {
    const store = new InMemoryManagedJobStore();
    await store.reserve({ job: { version: 3, id: "job-running", state: "queued", projectId: "kiln", callerId: query.callerId, configuredAgentProfileId: "scout", admissionProfileId: "foundation-readonly-plan", routeId: "opencode-go-scout-readonly", providerId: "opencode-go", governanceSource: "kiln-config-status", admissionId: "admission-001", timeoutSource: "default", requestFingerprint: "a".repeat(64), idempotencyKeyHash: "b".repeat(64), createdAt: now.toISOString(), updatedAt: now.toISOString(), lifecycle: [{ sequence: 1, state: "queued", observedAt: now.toISOString() }], parent: { invocationId: "parent-invocation", turnId: "parent-turn" } } });
    const service = new ManagedJobApplicationService(createOptions({ store }));
    const recovered = await service.recoverInterrupted();
    expect(recovered).toMatchObject([{ id: "job-running", state: "interrupted", parent: { invocationId: "parent-invocation", turnId: "parent-turn" } }]);
  });

  it("preserves idempotency across a filesystem-store restart and fails closed on corruption", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-managed-jobs-"));
    try {
      const first = new ManagedJobApplicationService(createOptions({ store: new FilesystemManagedJobStore(root) }));
      const job = await first.submit(request);
      const second = new ManagedJobApplicationService(createOptions({ store: new FilesystemManagedJobStore(root) }));
      await expect(second.submit(request)).resolves.toMatchObject({ id: job.id });
      await writeFile(join(root, "managed-jobs.json"), "{not-json", "utf8");
      const corrupt = new ManagedJobApplicationService(createOptions({ store: new FilesystemManagedJobStore(root) }));
      await expect(corrupt.getStatus(query, job.id)).rejects.toMatchObject({ code: "job_persistence_corrupt" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("does not leak errors or accept invalid lifecycle transitions", async () => {
    const store: ManagedJobStore = { reserve: async () => { throw new Error("C:/secret/token") }, get: async () => undefined, transition: async () => { throw new Error("C:/secret/token") }, completeSuccess: async () => { throw new Error("C:/secret/token") }, listNonterminal: async () => [] };
    const service = new ManagedJobApplicationService(createOptions({ store }));
    await expect(service.submit(request)).rejects.toEqual(expect.objectContaining({ code: "job_persistence_unavailable", message: "job_persistence_unavailable" }));
    expect(() => { throw new ManagedJobApplicationError("invalid_transition", "Keep terminal managed-job states immutable."); }).toThrow("invalid_transition");
  });
});
