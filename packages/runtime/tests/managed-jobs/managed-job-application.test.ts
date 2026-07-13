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
const request = { objective: "Inspect the managed job boundary.", agentProfileId: "reviewer", callerId: "codex-app:caller-001", idempotencyKey: "caller-001" };

function createOptions(overrides: Partial<ManagedJobApplicationOptions> = {}): ManagedJobApplicationOptions {
  return {
    project: { resolve: async () => ({ id: "kiln" }) },
    governance: {
      resolve: async () => ({ version: 1, authority: "authoritative", source: "kiln-config-status", issuedAt: "2026-07-13T21:59:00.000Z", validUntil: "2026-07-13T22:01:00.000Z" }),
      admit: async () => ({ admitted: true, admissionId: "admission-001", source: "kiln-config-status" }),
    },
    profiles: { resolve: async (id) => id === "reviewer" ? { id } : undefined },
    routes: { resolve: async () => ({ id: "managed-opencode-go", agentProfileId: "reviewer", providerId: "opencode-go", timeoutSource: "explicit-route" }) },
    runtime: { invoke: async () => ({ state: "succeeded" }) },
    store: new InMemoryManagedJobStore(),
    clock: () => now,
    idGenerator: () => "job-000000001",
    ...overrides,
  };
}

describe("ManagedJobApplicationService", () => {
  it("creates one admitted canonical job and exposes its durable status", async () => {
    const runtime = { invoke: vi.fn(async () => ({ state: "succeeded" as const })) };
    const service = new ManagedJobApplicationService(createOptions({ runtime }));
    const submitted = await service.submit(request);
    const status = await service.status(submitted.id);

    expect(submitted).toMatchObject({ id: "job-000000001", state: "succeeded", projectId: "kiln", agentProfileId: "reviewer", routeId: "managed-opencode-go", providerId: "opencode-go", governanceSource: "kiln-config-status", timeoutSource: "explicit-route" });
    expect(status).toEqual(submitted);
    expect(runtime.invoke).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-000000001", route: expect.objectContaining({ providerId: "opencode-go" }) }));
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
        return { request, adapter, capabilitySnapshot: { routeId: "managed-opencode-go", routeSource: "explicit-managed-route", capturedAt: now.toISOString() } };
      } },
    });
    const service = new ManagedJobApplicationService(createOptions({ runtime }));
    await expect(service.submit(request)).resolves.toMatchObject({ id: "job-000000001", providerId: "opencode-go", state: "succeeded" });
    expect(adapter.invoke).toHaveBeenCalledOnce();
    expect(runtimeService.status("job-000000001")?.record?.invocationId).toBe("job-000000001");
  });

  it("requires fresh authoritative governance and denies before provider invocation", async () => {
    const runtime = { invoke: vi.fn(async () => ({ state: "succeeded" as const })) };
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

  it("is idempotent for an identical retry and conflicts for a different request", async () => {
    const runtime = { invoke: vi.fn(async () => ({ state: "succeeded" as const })) };
    const service = new ManagedJobApplicationService(createOptions({ runtime }));
    const first = await service.submit(request);
    const retry = await service.submit(request);
    await expect(service.submit({ ...request, objective: "Different objective." })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(retry.id).toBe(first.id);
    expect(runtime.invoke).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent duplicate submissions at the job-owner store", async () => {
    const runtime = { invoke: vi.fn(async () => ({ state: "succeeded" as const })) };
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
  });

  it("recovers persisted nonterminal work as interrupted and preserves parent-child separation", async () => {
    const store = new InMemoryManagedJobStore();
    await store.reserve({ job: { version: 1, id: "job-running", state: "queued", projectId: "kiln", agentProfileId: "reviewer", routeId: "managed-opencode-go", providerId: "opencode-go", governanceSource: "kiln-config-status", admissionId: "admission-001", timeoutSource: "default", requestFingerprint: "a".repeat(64), idempotencyKeyHash: "b".repeat(64), createdAt: now.toISOString(), updatedAt: now.toISOString(), parent: { invocationId: "parent-invocation", turnId: "parent-turn" } } });
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
      await expect(corrupt.status(job.id)).rejects.toMatchObject({ code: "job_persistence_corrupt" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("does not leak errors or accept invalid lifecycle transitions", async () => {
    const store: ManagedJobStore = { reserve: async () => { throw new Error("C:/secret/token") }, get: async () => undefined, transition: async () => { throw new Error("C:/secret/token") }, listNonterminal: async () => [] };
    const service = new ManagedJobApplicationService(createOptions({ store }));
    await expect(service.submit(request)).rejects.toEqual(expect.objectContaining({ code: "job_persistence_unavailable", message: "job_persistence_unavailable" }));
    expect(() => { throw new ManagedJobApplicationError("invalid_transition", "Keep terminal managed-job states immutable."); }).toThrow("invalid_transition");
  });
});
