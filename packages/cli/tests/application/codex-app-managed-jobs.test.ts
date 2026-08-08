import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  FilesystemManagedJobStore,
  ManagedJobApplicationService,
  RuntimeManagedAgentInvocationService,
  SqliteManagedAccountLeaseAuthority,
} from "@kilnai/runtime";

/**
 * Shared between the `config-status.js` mock (still the sole source of
 * `workGovernance` evidence, consulted by `inspection.inspectWorkGovernance()`)
 * and the `global-config.js` mock below (now the real source
 * `loadNativeHarnessManagedRouteConfig` reads `managedAgents`/`modelGateway`
 * global authority from). Kept in one place so both mocks describe the same
 * fixture route instead of two independently drifting copies.
 */
const TEST_MANAGED_AGENTS_CONFIG = {
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
};

const TEST_MODEL_GATEWAY_CONFIG = {
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
};

vi.mock("../../src/config/config-merger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/config-merger.js")>();
  return {
    ...actual,
    loadResolvedKilnMcpConfiguration: vi.fn(() => ({
      servers: {},
      diagnostics: [],
    })),
  };
});

vi.mock("../../src/config/global-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/global-config.js")>();
  return {
    ...actual,
    readGlobalConfig: vi.fn(() => ({
      version: "1",
      managedAgents: TEST_MANAGED_AGENTS_CONFIG,
      modelGateway: TEST_MODEL_GATEWAY_CONFIG,
    })),
  };
});

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
      managedAgents: TEST_MANAGED_AGENTS_CONFIG,
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers persisted jobs without constructing an execution owner", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "kiln-managed-job-recovery-"));
    mkdirSync(resolve(projectRoot, ".kiln"), { recursive: true });
    writeFileSync(resolve(projectRoot, ".kiln", "kiln.yaml"), "version: '1'\n", "utf8");
    const recoverInvocations = vi
      .spyOn(RuntimeManagedAgentInvocationService.prototype, "recoverPersistedInvocations")
      .mockResolvedValue({ recovered: [], accountLeases: [] });
    const recoveryOrder: string[] = [];
    const recoverCommitments = vi
      .spyOn(SqliteManagedAccountLeaseAuthority.prototype, "recoverCommitments")
      .mockImplementation(() => {
        recoveryOrder.push("authority");
        return [];
      });
    const recoverInterrupted = vi
      .spyOn(ManagedJobApplicationService.prototype, "recoverInterrupted")
      .mockImplementation(async () => {
        recoveryOrder.push("jobs");
        return [];
      });

    try {
      const composition = await createNativeHarnessManagedJobApplicationComposition({
        harness: "codex",
        discoverProviderModels: async () => ({}),
        projectPath: projectRoot,
      });
      composition.close();

      expect(recoverInvocations).not.toHaveBeenCalled();
      expect(recoverInterrupted).toHaveBeenCalledOnce();
      expect(recoveryOrder).toEqual(["authority", "jobs"]);
    } finally {
      recoverInvocations.mockRestore();
      recoverInterrupted.mockRestore();
      recoverCommitments.mockRestore();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("projects policy agents from candidate admission without selecting a route", () => {
    const route = (id: string, providerId: string) => ({
      routeId: id,
      providerId,
      economicPolicyIds: ["bounded-policy"],
      economicCapability: {
        status: "verified",
        adapterCapabilityId: `${providerId}-direct`,
        adapterCapabilityVersion: "1",
      },
      profiles: { "foundation-readonly-plan": {} },
    });
    const agents = [
      { name: "economic-worker", role: "Policy-only worker", economicPolicyId: "bounded-policy" },
    ];

    expect(summarizeNativeHarnessManagedAgents(agents, undefined)).toMatchObject([{
      configuredAgentProfileId: "economic-worker",
      availability: "unavailable",
      admissionProfileId: "foundation-readonly-plan",
      diagnostic: "route_unavailable",
    }]);
    expect(summarizeNativeHarnessManagedAgents(agents, {
      routes: [
        route("codex-route", "codex-oauth"),
        route("opencode-route", "opencode-go"),
      ],
      agentCatalog: [{
        name: "economic-worker",
        economicPolicyId: "bounded-policy",
        economicPolicyRevision: "revision-001",
        economicPolicyCandidateRouteIds: ["codex-route", "opencode-route"],
      }],
    } as never)).toMatchObject([{
      configuredAgentProfileId: "economic-worker",
      availability: "admitted",
      admissionProfileId: "foundation-readonly-plan",
    }]);
    expect(summarizeNativeHarnessManagedAgents(agents, {
      routes: [],
      agentCatalog: [{
        name: "economic-worker",
        economicPolicyId: "bounded-policy",
        economicPolicyRevision: "revision-001",
        economicPolicyCandidateRouteIds: ["codex-route"],
      }],
      unavailableRoutes: [{ routeId: "codex-route", providerId: "codex-oauth", profiles: ["foundation-readonly-plan"] }],
    } as never)[0]).toMatchObject({
      configuredAgentProfileId: "economic-worker",
      availability: "unresolved",
      admissionProfileId: "foundation-readonly-plan",
      diagnostic: "eligibility_unresolved",
    });
  });

  it("uses the real application owner and fails a missing configured profile before provider execution", async () => {
    const recoverInterrupted = vi
      .spyOn(ManagedJobApplicationService.prototype, "recoverInterrupted")
      .mockResolvedValue([]);
    const service = await createNativeHarnessManagedJobApplicationService({ harness: "codex", discoverProviderModels: async () => ({}) });
    await expect(service.submit({
      objective: "Bounded production composition proof.",
      configuredAgentProfileId: "missing-agent",
      callerId: "codex-app",
      idempotencyKey: "production-composition-proof",
    })).rejects.toMatchObject({ code: "profile_unavailable" });
    recoverInterrupted.mockRestore();
  });
});
