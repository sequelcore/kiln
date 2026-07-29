import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { defineManagedAccountLeaseEvidence } from "@kilnai/core";
import {
  FilesystemManagedJobStore,
  ManagedJobApplicationService,
  RuntimeManagedAgentInvocationService,
} from "@kilnai/runtime";

vi.mock("../../src/config/config-merger.js", () => ({
  loadResolvedKilnMcpConfiguration: vi.fn(() => ({
    servers: {},
    diagnostics: [],
  })),
}));

vi.mock("../../src/application/config-status.js", () => ({
  readConfigStatusSnapshot: vi.fn(async () => {
    const effectiveConfig = {
      version: "1",
      workGovernance: {
        defaultPosture: "orchestrate",
        directExecution: { maxFiles: 1, maxRisk: "low" },
        requireDelegationFor: ["managed-agents"],
        requiredEvidence: ["surface-map", "tests"],
      },
      managedAgents: {
        enabled: true,
        routes: [
          {
            id: "test-readonly-route",
            kind: "direct",
            provider: "codex-oauth",
            model: "gpt-5.6-terra",
            profiles: ["foundation-readonly-plan"],
            workingDirectory: "project",
            tools: {
              allowed: ["read"],
              network: false,
              writes: false,
            },
            memory: { access: "read-only" },
            credentials: {
              mode: "runtime-selected",
              accountPolicyId: "managed-codex",
            },
          },
        ],
      },
      modelGateway: {
        port: 4819,
        accounts: [{
          id: "test-account",
          providerId: "codex-oauth",
          credentialId: "synthetic-test-credential",
          maxConcurrency: 1,
          reservedAffinitySlots: 0,
        }],
        replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
        surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
        principals: [],
        virtualModels: [{
          id: "managed-codex",
          providerId: "codex-oauth",
          providerModelId: "gpt-5.6-terra",
          accountIds: ["test-account"],
          capabilities: ["text"],
          affinity: { continuity: "none" },
        }],
      },
    };
    return {
      evidenceVersion: 1,
      generatedAt: new Date().toISOString(),
      project: {
        rootPath: "C:/workspace/kiln",
        projectName: "kiln",
        hasGitRoot: true,
        hasKilnYaml: true,
        kilnYaml: { path: "C:/workspace/kiln/.kiln/kiln.yaml", status: "valid" },
        projectContext: { path: "C:/workspace/kiln/.kiln/project-context.md", status: "valid" },
      },
      global: { path: "C:/Users/ExampleUser/.kiln/config.yaml", status: "valid" },
      effectiveConfigStatus: "valid",
      effectiveConfig,
      errors: [],
      projections: [],
      permissionIntegrity: [],
      mcp: { servers: [], diagnostics: [] },
      setup: {
        projectRoot: "C:/workspace/kiln",
        projectContext: {
          path: "C:/workspace/kiln/.kiln/project-context.md",
          status: "valid",
          recommendation: "none",
        },
        repoShims: [],
        globalInstructionShims: [],
        nativeProjections: [],
        permissionIntegrity: [],
        recommendedActions: ["none"],
      },
      harnessCapabilities: [],
    };
  }),
}));

import {
  createNativeHarnessManagedJobApplicationComposition,
  createNativeHarnessManagedJobApplicationService,
  summarizeNativeHarnessManagedAgents,
} from "../../src/application/codex-app-managed-jobs.js";

describe("Codex App managed-job production composition", () => {
  it("recovers persisted nonterminal jobs before exposing the application owner", async () => {
    const accountLease = defineManagedAccountLeaseEvidence({
      leaseId: "lease-job-recovered",
      accountPolicyId: "managed-codex",
      accountRef: "configured:test-account",
      route: { providerId: "codex-oauth", providerModelId: "gpt-5.6-terra", scope: "virtual:managed-codex" },
      jobId: "job-recovered",
      runtimeInvocationId: "job-recovered",
      credentialRevisionId: "a".repeat(64),
      selectionReason: "least-pressure",
      acquiredAt: "2026-07-28T20:00:00.000Z",
      lifecycleState: "leaked",
      resourceUris: ["kiln://managed-accounts/leases/lease-job-recovered"],
      diagnosticUris: ["kiln://managed-accounts/leases/lease-job-recovered/recovery-unmatchable"],
    });
    const foreignAccountLease = defineManagedAccountLeaseEvidence({
      ...accountLease,
      leaseId: "lease-foreign-job",
      jobId: "foreign-job",
      runtimeInvocationId: "foreign-job",
      resourceUris: ["kiln://managed-accounts/leases/lease-foreign-job"],
      diagnosticUris: ["kiln://managed-accounts/leases/lease-foreign-job/recovery-unmatchable"],
    });
    const projectId = `project-${createHash("sha256").update(process.cwd()).digest("hex").slice(0, 32)}`;
    const recoverInvocations = vi
      .spyOn(RuntimeManagedAgentInvocationService.prototype, "recoverPersistedInvocations")
      .mockResolvedValue({
        recovered: [],
        accountLeases: [accountLease, foreignAccountLease],
      });
    const get = vi.spyOn(FilesystemManagedJobStore.prototype, "get")
      .mockImplementation(async (id) => ({
        version: 4,
        projectId: id === "job-recovered" ? projectId : "foreign-project",
      } as never));
    const recordAccountLease = vi.spyOn(FilesystemManagedJobStore.prototype, "recordAccountLease")
      .mockResolvedValue({ version: 4 } as never);
    const recoverInterrupted = vi
      .spyOn(ManagedJobApplicationService.prototype, "recoverInterrupted")
      .mockResolvedValue([]);

    await createNativeHarnessManagedJobApplicationComposition({ harness: "codex", discoverProviderModels: async () => ({}) });

    expect(recoverInvocations).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith("job-recovered");
    expect(get).toHaveBeenCalledWith("foreign-job");
    expect(recordAccountLease).toHaveBeenCalledWith("job-recovered", accountLease);
    expect(recordAccountLease).not.toHaveBeenCalledWith("foreign-job", foreignAccountLease);
    expect(recoverInterrupted).toHaveBeenCalledOnce();
    expect(recoverInvocations.mock.invocationCallOrder[0]).toBeLessThan(recoverInterrupted.mock.invocationCallOrder[0]!);
    recoverInvocations.mockRestore();
    get.mockRestore();
    recordAccountLease.mockRestore();
    recoverInterrupted.mockRestore();
  });

  it("projects configured agents through their explicit route hints without exposing route internals", () => {
    const route = (id: string) => ({
      routeId: id,
      providerId: "opencode-go",
      profiles: { "foundation-readonly-plan": {} },
    });
    const agents = [
      { name: "scout", displayName: "Scout", role: "Read-only scout", routeId: "scout-route" },
      { name: "researcher", role: "Researcher", routeId: "researcher-route" },
    ];

    expect(summarizeNativeHarnessManagedAgents(agents, undefined)).toMatchObject([{
      configuredAgentProfileId: "scout",
      availability: "unavailable",
      admissionProfileId: "foundation-readonly-plan",
      diagnostic: "route_unavailable",
    }, {
      configuredAgentProfileId: "researcher",
      availability: "unavailable",
    }]);
    expect(summarizeNativeHarnessManagedAgents(agents, { routes: [route("scout-route"), route("researcher-route")] } as never)).toMatchObject([{
      configuredAgentProfileId: "scout",
      availability: "admitted",
      providerFamily: "opencode-go",
      admissionProfileId: "foundation-readonly-plan",
    }, {
      configuredAgentProfileId: "researcher",
      availability: "admitted",
    }]);
    expect(summarizeNativeHarnessManagedAgents(agents, {
      routes: [],
      unavailableRoutes: [{ routeId: "scout-route", providerId: "opencode-go", profiles: ["foundation-readonly-plan"] }],
    } as never)[0]).toMatchObject({
      configuredAgentProfileId: "scout",
      availability: "unresolved",
      admissionProfileId: "foundation-readonly-plan",
      diagnostic: "eligibility_unresolved",
    });
  });

  it("uses the real application owner and fails a missing configured profile before provider execution", async () => {
    const service = await createNativeHarnessManagedJobApplicationService({ harness: "codex", discoverProviderModels: async () => ({}) });
    await expect(service.submit({
      objective: "Bounded production composition proof.",
      configuredAgentProfileId: "missing-agent",
      callerId: "codex-app",
      idempotencyKey: "production-composition-proof",
    })).rejects.toMatchObject({ code: "profile_unavailable" });
    await expect(service.getStatus({ project: { id: "trusted-project" }, callerId: "codex-app" }, "unknown-managed-job-0001")).rejects.toMatchObject({ code: "unknown_job" });
  });
});
