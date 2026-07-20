import { describe, expect, it, vi } from "vitest";
import { ManagedJobApplicationService } from "@kilnai/runtime";

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
            credentials: { mode: "runtime-selected" },
          },
        ],
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
  createCodexAppManagedJobApplicationComposition,
  createCodexAppManagedJobApplicationService,
  summarizeCodexAppManagedAgents,
} from "../../src/application/codex-app-managed-jobs.js";

describe("Codex App managed-job production composition", () => {
  it("recovers persisted nonterminal jobs before exposing the application owner", async () => {
    const recoverInterrupted = vi
      .spyOn(ManagedJobApplicationService.prototype, "recoverInterrupted")
      .mockResolvedValue([]);

    await createCodexAppManagedJobApplicationComposition({ discoverProviderModels: async () => ({}) });

    expect(recoverInterrupted).toHaveBeenCalledOnce();
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

    expect(summarizeCodexAppManagedAgents(agents, undefined)).toMatchObject([{
      configuredAgentProfileId: "scout",
      availability: "unavailable",
      admissionProfileId: "foundation-readonly-plan",
      diagnostic: "route_unavailable",
    }, {
      configuredAgentProfileId: "researcher",
      availability: "unavailable",
    }]);
    expect(summarizeCodexAppManagedAgents(agents, { routes: [route("scout-route"), route("researcher-route")] } as never)).toMatchObject([{
      configuredAgentProfileId: "scout",
      availability: "admitted",
      providerFamily: "opencode-go",
      admissionProfileId: "foundation-readonly-plan",
    }, {
      configuredAgentProfileId: "researcher",
      availability: "admitted",
    }]);
    expect(summarizeCodexAppManagedAgents(agents, {
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
    const service = await createCodexAppManagedJobApplicationService({ discoverProviderModels: async () => ({}) });
    await expect(service.submit({
      objective: "Bounded production composition proof.",
      configuredAgentProfileId: "missing-agent",
      callerId: "codex-app",
      idempotencyKey: "production-composition-proof",
    })).rejects.toMatchObject({ code: "profile_unavailable" });
    await expect(service.getStatus({ project: { id: "trusted-project" }, callerId: "codex-app" }, "unknown-managed-job-0001")).rejects.toMatchObject({ code: "unknown_job" });
  });
});
