import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveProviderModelEligibility, type ProviderModelEligibilityRequirements } from "@kilnai/core";
import { normalizeRuntimeProviderDiscoveryCatalog, RuntimeManagedAgentInvocationService } from "@kilnai/runtime";
import { writeGlobalConfig, type KilnGlobalConfig } from "../../src/config/global-config.js";
import { createOperatorProjectManagedJobApplicationComposition } from "../../src/application/operator-project-managed-jobs.js";
import { createNativeHarnessInspectionService } from "../../src/application/native-harness-inspection.js";
import { NativeHarnessMcpTools } from "../../src/native-harness/native-harness-mcp-tools.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "../../src/config/managed-agent-provider-models.js";
import { economicConfig } from "../config/managed-economic-policy-config-fixture.js";

const routeCatalogTrace = vi.hoisted(() => ({
  contexts: [] as Array<{ readonly compositionMode?: "execution" | "candidate-admission"; readonly managedAccountComposition?: unknown }>,
  catalogs: [] as Array<{ readonly managedInvocation?: { readonly invocationService?: unknown } }>,
  mutateExecutionCapabilityVersion: false,
  mutateExecutionProfileAuthority: false,
  executionRefreshCount: 0,
}));
const adapterTrace = vi.hoisted(() => ({
  createCalls: 0,
  requests: [] as Array<{ readonly route: unknown; readonly accountBinding: unknown; readonly committedRequest: unknown }>,
  adapter: {
    descriptor: {
      adapterKind: "direct",
      supportedExecutionModes: ["direct-provider"],
    },
    invoke: vi.fn(),
  },
}));

vi.mock("../../src/config/managed-agent-route-catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/managed-agent-route-catalog.js")>();
  return {
    ...actual,
    createStagedManagedInvocationRouteCatalog: vi.fn(async (
      ...args: Parameters<typeof actual.createStagedManagedInvocationRouteCatalog>
    ) => {
      routeCatalogTrace.contexts.push(args[1]);
      const catalog = await actual.createStagedManagedInvocationRouteCatalog(...args);
      if (
        args[1].compositionMode === "execution"
        && (routeCatalogTrace.mutateExecutionCapabilityVersion || routeCatalogTrace.mutateExecutionProfileAuthority)
      ) {
        const tracedCatalog = {
          ...catalog,
          refreshNow: async () => {
            await catalog.refreshNow();
            routeCatalogTrace.executionRefreshCount += 1;
            const route = catalog.managedInvocation?.routes[0];
            if (routeCatalogTrace.mutateExecutionCapabilityVersion && route?.economicCapability) {
              Object.assign(route.economicCapability, {
                adapterCapabilityVersion: "execution-mismatch",
              });
            }
            if (routeCatalogTrace.mutateExecutionProfileAuthority && routeCatalogTrace.executionRefreshCount >= 3) {
              const profile = route?.profiles["foundation-readonly-plan"];
              if (profile) Object.assign(profile, { timeoutMs: profile.timeoutMs + 1 });
            }
          },
        };
        routeCatalogTrace.catalogs.push(tracedCatalog);
        return tracedCatalog;
      }
      routeCatalogTrace.catalogs.push(catalog);
      return catalog;
    }),
  };
});

vi.mock("../../src/config/managed-agent-direct-adapters.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/managed-agent-direct-adapters.js")>();
  return {
    ...actual,
    createManagedDirectProviderAdapterFactory: vi.fn(() => async (route, accountBinding, _abortSignal, committedRequest) => {
      adapterTrace.createCalls += 1;
      adapterTrace.requests.push({ route, accountBinding, committedRequest });
      return adapterTrace.adapter as never;
    }),
  };
});

/**
 * Regression proof for #56 revised S1: the operator-supervised project Runtime
 * composition must derive its managed-route config
 * (`modelGateway`, `engines`, `routing`, `models`, `managedAgents`, ...) from
 * canonical global/project config with the correct authority split, not from
 * `readConfigStatusSnapshot().effectiveConfig` (a project/status projection
 * that never carries global-only Runtime route authority). Unlike
 * `operator-project-managed-jobs.test.ts`, this file does not mock `config-status.js`,
 * `global-config.js`, or `kiln-yaml.js`: it drives the real production
 * `readGlobalConfig()` + `readKilnYaml()` reads against real fixture files on
 * disk, through the real composition boundary
 * (`createOperatorProjectManagedJobApplicationComposition`) and the real MCP
 * surface (`NativeHarnessMcpTools`). A fake `effectiveConfig` mock (as the
 * existing sibling test uses) can assert whatever shape it likes, including a
 * `modelGateway` field that `KilnYaml` never actually produces -- which is
 * exactly how the original defect went uncaught.
 */
const FIXTURE_OBSERVED_AT = "2026-07-01T12:00:00.000Z";

function managedCatalogRequirements(): ProviderModelEligibilityRequirements {
  return {
    use: "managed-agent",
    evaluatedAt: FIXTURE_OBSERVED_AT,
    requiredStates: [
      "discovered",
      "configured",
      "authenticated",
      "capabilityCompatible",
      "policyAdmitted",
      "routeHealthy",
    ],
    requiredCapabilities: [],
    minimumCapabilityAuthority: "harness-reported",
    minimumStateAuthority: "harness-reported",
    requireProbe: false,
  };
}

/** Synthesizes a deterministic, network-free eligible provider/model catalog for one direct route. */
function eligibleDirectProviderCatalog(providerId: string, model: string): ManagedAgentProviderModelCatalogDiagnostics {
  const catalog = normalizeRuntimeProviderDiscoveryCatalog({
    providerId,
    family: "direct-provider",
    discovery: {
      models: [model],
      status: "available",
      reason: "fixture catalog",
      authState: "authenticated",
    },
    observedAt: FIXTURE_OBSERVED_AT,
    freshness: "fresh",
  });
  return {
    [providerId]: Object.fromEntries(catalog.routes.map((route) => [
      route.identity.route.providerModelId,
      {
        catalogDiagnosticEvidence: route,
        catalogDiagnosticDecision: deriveProviderModelEligibility(route, managedCatalogRequirements(), []),
      },
    ])),
  };
}

const ECONOMIC_WORKER_AGENT = [
  "---",
  "name: economic-worker",
  "role: Policy-bound worker",
  "goal: Prove economic policy binding reaches native-harness composition.",
  "tier: fast",
  "mode: managed-child",
  "economicPolicyId: default-economic-policy",
  "---",
  "Regression fixture agent; not used for real work.",
].join("\n");

function accountlessEconomicConfig(): KilnGlobalConfig {
  const configured = economicConfig();
  return {
    ...configured,
    managedAgents: {
      ...configured.managedAgents!,
      routes: configured.managedAgents!.routes.map((route) => ({
        ...route,
        credentials: { mode: "credentialless" as const, economicsRouteId: "codex-standard-policy" },
      })),
    },
    modelGateway: {
      ...configured.modelGateway!,
      virtualModels: configured.modelGateway!.virtualModels.map((model) => ({
        ...model,
        accountIds: [],
      })),
    },
  };
}

/** A provider-free OpenCode Go route used to prove the direct-provider path without live credentials. */
function accountlessOpenCodeGoEconomicConfig(): KilnGlobalConfig {
  const configured = accountlessEconomicConfig();
  return {
    ...configured,
    managedAgents: {
      ...configured.managedAgents!,
      routes: configured.managedAgents!.routes.map((route) => ({
        ...route,
        id: "opencode-go-direct",
        provider: "opencode-go",
        model: "kimi-k2.6",
        credentials: { mode: "credentialless" as const, economicsRouteId: "opencode-go-policy" },
      })),
      economicPolicies: configured.managedAgents!.economicPolicies!.map((policy) => ({
        ...policy,
        candidates: policy.candidates.map((candidate) => ({ ...candidate, routeId: "opencode-go-direct" })),
      })),
    },
    modelGateway: {
      ...configured.modelGateway!,
      principals: configured.modelGateway!.principals.map((principal) => ({
        ...principal,
        virtualModelIds: ["opencode-go-policy"],
      })),
      virtualModels: configured.modelGateway!.virtualModels.map((model) => ({
        ...model,
        id: "opencode-go-policy",
        providerId: "opencode-go",
        providerModelId: "kimi-k2.6",
        economics: { ...model.economics, adapterCapabilityId: "opencode-go-direct" },
      })),
    },
  };
}

describe("native-harness managed-route runtime config authority (#56 S1)", () => {
  const tempDirs: string[] = [];
  const isolatedEnvKeys = ["XDG_CONFIG_HOME", "HOME", "USERPROFILE"] as const;
  const originalEnv: Partial<Record<typeof isolatedEnvKeys[number], string | undefined>> = {};

  afterEach(() => {
    for (const key of isolatedEnvKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    routeCatalogTrace.contexts.length = 0;
    routeCatalogTrace.catalogs.length = 0;
    routeCatalogTrace.mutateExecutionCapabilityVersion = false;
    routeCatalogTrace.mutateExecutionProfileAuthority = false;
    routeCatalogTrace.executionRefreshCount = 0;
    adapterTrace.createCalls = 0;
    adapterTrace.requests.length = 0;
    adapterTrace.adapter.invoke.mockClear();
  });

  /**
   * Isolates both the global-config path (`XDG_CONFIG_HOME`, read by
   * `readGlobalConfig()`) and `os.homedir()` (`HOME`/`USERPROFILE`, read by
   * `loadAgentDefinitions()`'s global agents directory). Without the latter,
   * this test would pick up the real operator's `~/.kiln/agents` definitions
   * and become machine-dependent.
   */
  function useIsolatedGlobalConfigHome(): void {
    for (const key of isolatedEnvKeys) {
      originalEnv[key] = process.env[key];
    }
    const globalHome = mkdtempSync(join(tmpdir(), "kiln-global-config-"));
    tempDirs.push(globalHome);
    process.env.XDG_CONFIG_HOME = globalHome;
    process.env.HOME = globalHome;
    process.env.USERPROFILE = globalHome;
  }

  function createProjectRoot(kilnYamlContents: string, agents: Readonly<Record<string, string>> = {}): string {
    const projectRoot = mkdtempSync(join(tmpdir(), "kiln-native-harness-runtime-config-"));
    tempDirs.push(projectRoot);
    mkdirSync(join(projectRoot, ".kiln"), { recursive: true });
    writeFileSync(join(projectRoot, ".kiln", "kiln.yaml"), kilnYamlContents, "utf8");
    if (Object.keys(agents).length > 0) {
      mkdirSync(join(projectRoot, ".kiln", "agents"), { recursive: true });
      for (const [fileName, contents] of Object.entries(agents)) {
        writeFileSync(join(projectRoot, ".kiln", "agents", fileName), contents, "utf8");
      }
    }
    return projectRoot;
  }

  it("constructs the real composition from canonical schema-v2 config and surfaces the admitted managed agent through the real MCP server", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig(economicConfig());
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });

    const composition = await createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      const economicWorker = composition.configuredAgents.find((agent) => agent.configuredAgentProfileId === "economic-worker");
      expect(economicWorker).toBeDefined();
      expect(economicWorker).toMatchObject({
        configuredAgentProfileId: "economic-worker",
        availability: "admitted",
        providerFamily: "codex-oauth",
      });

      const server = new NativeHarnessMcpTools({
        harness: "codex",
        managedJobs: composition.application,
        inspection: createNativeHarnessInspectionService({
          harness: "codex",
          managedAgents: composition.configuredAgents,
          readProjectRoot: async () => ({ status: "resolved", rootPath: projectRoot }),
        }),
      });
      const tools = server.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "kiln_managed_agent_invoke",
        "kiln_managed_agent_status",
        "kiln_managed_agent_result",
        "kiln_managed_agent_cancel",
        "kiln_managed_agent_replay",
      ]));
      const invokeTool = tools.find((tool) => tool.name === "kiln_managed_agent_invoke");
      expect(invokeTool).toBeDefined();
      expect((invokeTool!.inputSchema.properties as { configuredAgentProfileId: Record<string, unknown> }).configuredAgentProfileId)
        .toEqual({ type: "string", minLength: 1, maxLength: 200 });
    } finally {
      await composition.close();
    }
  });

  it("rebuilds an execution composition after the economic dispatch fence", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig(accountlessEconomicConfig());
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockImplementation(async (
      _request,
      _adapter,
      _capabilitySnapshot,
      _lifecycleOptions,
    ) => {
      return { status: "started" } as never;
    });
    const join = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "join").mockResolvedValue({
      status: "completed",
      record: {
        invocationId: "managed-job-runtime",
        lifecycleState: "completed",
        resultHandoff: {
          provenance: {
            delivery: "native-structured-output",
            configuredModelId: "gpt-5.6-codex",
            primaryObservedModelId: "gpt-5.6-codex",
            observedModelIds: ["gpt-5.6-codex"],
          },
          summary: "Synthetic managed execution completed.",
          resourceUris: [],
          memoryWriteProposalUris: [],
        },
      },
    } as never);

    const composition = await createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      expect(routeCatalogTrace.contexts[0]).toMatchObject({ compositionMode: "candidate-admission" });
      expect(routeCatalogTrace.catalogs[0]?.managedInvocation?.invocationService).toBeUndefined();

      const result = await composition.application.accept({
        objective: "Prove post-fence managed execution.",
        configuredAgentProfileId: "economic-worker",
        callerId: "codex-app",
        idempotencyKey: "post-fence-managed-execution",
      });

      expect(result.state).toBe("queued");
      await composition.close();
      await expect(composition.application.getStatus({ callerId: "codex-app" }, result.id)).resolves.toMatchObject({ state: "succeeded" });
      expect(adapterTrace.createCalls).toBe(1);
      expect(start).toHaveBeenCalledOnce();
      expect(join).toHaveBeenCalledWith(`managed-job:${result.id}`);
      expect(start.mock.calls[0]?.[1]).toBe(adapterTrace.adapter);
      const executionIndex = routeCatalogTrace.contexts.findIndex((context) => context.compositionMode === "execution");
      expect(executionIndex).toBeGreaterThan(0);
      expect(routeCatalogTrace.contexts[executionIndex]).toMatchObject({
        compositionMode: "execution",
        managedAccountComposition: expect.any(Object),
      });
      expect(routeCatalogTrace.catalogs[executionIndex]?.managedInvocation?.invocationService).toBeDefined();
    } finally {
      await composition.close();
      start.mockRestore();
      join.mockRestore();
    }
  });

  it("admits, commits, dispatches, and replays the exact credentialless opencode-go direct route", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig(accountlessOpenCodeGoEconomicConfig());
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockResolvedValue({ status: "started" } as never);
    const join = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "join").mockResolvedValue({
      status: "completed",
      record: {
        invocationId: "managed-job-opencode-go",
        lifecycleState: "completed",
        resultHandoff: {
          provenance: {
            delivery: "native-structured-output",
            configuredModelId: "kimi-k2.6",
            primaryObservedModelId: "kimi-k2.6",
            observedModelIds: ["kimi-k2.6"],
          },
          summary: "Synthetic OpenCode Go managed execution completed.",
          resourceUris: [],
          memoryWriteProposalUris: [],
        },
      },
    } as never);
    const composition = await createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => eligibleDirectProviderCatalog("opencode-go", "kimi-k2.6"),
    });
    try {
      // Candidate admission must not construct an adapter or touch a credential binding.
      expect(adapterTrace.createCalls).toBe(0);
      expect(adapterTrace.requests).toEqual([]);

      const accepted = await composition.application.accept({
        objective: "Prove deterministic OpenCode Go managed dispatch.",
        configuredAgentProfileId: "economic-worker",
        callerId: "codex-app",
        idempotencyKey: "opencode-go-managed-regression",
      });
      expect(accepted).toMatchObject({
        state: "queued",
        dispatch: { kind: "economic", candidateSet: { candidates: [{ routeId: "opencode-go-direct", providerId: "opencode-go", model: "kimi-k2.6" }] } },
      });

      await composition.close();
      const status = await composition.application.getStatus({ callerId: "codex-app" }, accepted.id);
      const result = await composition.application.getResult({ callerId: "codex-app" }, accepted.id);
      const replay = await composition.application.getReplay({ callerId: "codex-app" }, accepted.id);
      expect(status).toMatchObject({
        state: "succeeded",
        result: { runtimeInvocationId: "managed-job-opencode-go", routeId: "opencode-go-direct", providerId: "opencode-go" },
      });
      expect(result).toMatchObject({
        availability: "available",
        routeId: "opencode-go-direct",
        providerId: "opencode-go",
        handoff: { summary: "Synthetic OpenCode Go managed execution completed." },
      });
      expect(replay).toMatchObject({
        lifecycleState: "succeeded",
        routeId: "opencode-go-direct",
        providerId: "opencode-go",
        resultAvailability: "available",
        dispatch: { kind: "economic" },
      });
      expect(adapterTrace.createCalls).toBe(1);
      expect(adapterTrace.requests).toMatchObject([{
        route: { id: "opencode-go-direct", provider: "opencode-go", model: "kimi-k2.6" },
        accountBinding: undefined,
        committedRequest: { commitment: { reservation: { selectedIdentity: { route: { routeId: "opencode-go-direct", providerId: "opencode-go", modelId: "kimi-k2.6" } } } } },
      }]);
      expect(start).toHaveBeenCalledWith(expect.objectContaining({
        invocationId: `managed-job:${accepted.id}`,
        providerRoute: { providerId: "opencode-go", surface: "direct-provider", model: "kimi-k2.6" },
      }), adapterTrace.adapter, expect.anything(), expect.anything());
      expect(join).toHaveBeenCalledWith(`managed-job:${accepted.id}`);
      const projections = JSON.stringify([status, result, replay]);
      expect(projections).not.toContain("credential");
      expect(projections).not.toMatch(/accountRef|credentialRevision|api[_-]?key/iu);
    } finally {
      await composition.close();
      start.mockRestore();
      join.mockRestore();
    }
  });

  it("fails closed before Runtime start when post-fence adapter capability changes", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig(accountlessEconomicConfig());
    routeCatalogTrace.mutateExecutionCapabilityVersion = true;
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockResolvedValue({
      status: "started",
    } as never);
    const composition = await createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      const result = await composition.application.accept({
        objective: "Reject a changed post-fence capability.",
        configuredAgentProfileId: "economic-worker",
        callerId: "codex-app",
        idempotencyKey: "post-fence-capability-mismatch",
      });
      expect(result.state).toBe("queued");
      await composition.close();
      await expect(composition.application.getStatus({ callerId: "codex-app" }, result.id)).resolves.toMatchObject({ state: "failed", diagnostic: "invocation_failed" });
      expect(start).not.toHaveBeenCalled();
      expect(adapterTrace.adapter.invoke).not.toHaveBeenCalled();
    } finally {
      await composition.close();
      start.mockRestore();
    }
  });

  it("fails closed before Runtime start when execution authority changes under the same adapter identity", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig(accountlessEconomicConfig());
    routeCatalogTrace.mutateExecutionProfileAuthority = true;
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });
    const start = vi.spyOn(RuntimeManagedAgentInvocationService.prototype, "start").mockResolvedValue({
      status: "started",
    } as never);
    const composition = await createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      const result = await composition.application.accept({
        objective: "Reject changed execution authority with a stable adapter identity.",
        configuredAgentProfileId: "economic-worker",
        callerId: "codex-app",
        idempotencyKey: "post-fence-profile-authority-mismatch",
      });
      expect(result.state).toBe("queued");
      await composition.close();
      await expect(composition.application.getStatus({ callerId: "codex-app" }, result.id)).resolves.toMatchObject({ state: "failed", diagnostic: "invocation_failed" });
      expect(start).not.toHaveBeenCalled();
      expect(adapterTrace.adapter.invoke).not.toHaveBeenCalled();
    } finally {
      await composition.close();
      start.mockRestore();
    }
  });

  it("keeps a globally disabled provider engine unavailable through the real composition boundary", async () => {
    useIsolatedGlobalConfigHome();
    const globalConfig: KilnGlobalConfig = {
      ...economicConfig(),
      engines: { "codex-oauth": { enabled: false } },
    };
    writeGlobalConfig(globalConfig);
    const projectRoot = createProjectRoot('version: "1"\n', { "economic-worker.md": ECONOMIC_WORKER_AGENT });

    const composition = await createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      // Same fixture as the positive test above -- the eligibility catalog would
      // admit this exact route -- except the global engine is disabled, so this
      // proves the denial and not mere eligibility-catalog absence.
      const economicWorker = composition.configuredAgents.find((agent) => agent.configuredAgentProfileId === "economic-worker");
      expect(economicWorker).toBeDefined();
      expect(economicWorker).toMatchObject({
        configuredAgentProfileId: "economic-worker",
        availability: "unresolved",
        diagnostic: "eligibility_unresolved",
      });
    } finally {
      await composition.close();
    }
  });

  it("does not let a project kiln.yaml override global modelGateway or engine authority", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig(economicConfig());
    // `KilnYaml` has neither a `modelGateway` nor an `engines` field; this
    // simulates an operator (or a regression) hand-editing project kiln.yaml
    // with out-of-schema keys attempting to disable the provider the global
    // config allows, and to replace modelGateway with a value that would crash
    // `ConfiguredManagedAccountRuntime` if it were ever used. Both global
    // authorities must keep governing composition unchanged.
    const projectRoot = createProjectRoot([
      'version: "1"',
      "engines:",
      "  codex-oauth:",
      "    enabled: false",
      "modelGateway: not-a-gateway",
    ].join("\n"), { "economic-worker.md": ECONOMIC_WORKER_AGENT });

    const composition = await createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => eligibleDirectProviderCatalog("codex-oauth", "gpt-5.6-codex"),
    });
    try {
      const economicWorker = composition.configuredAgents.find((agent) => agent.configuredAgentProfileId === "economic-worker");
      expect(economicWorker).toBeDefined();
      expect(economicWorker).toMatchObject({
        configuredAgentProfileId: "economic-worker",
        availability: "admitted",
        providerFamily: "codex-oauth",
      });
    } finally {
      await composition.close();
    }
  });

  it("stays fail-closed when a project-declared runtime-selected route has no reachable global modelGateway", async () => {
    useIsolatedGlobalConfigHome();
    writeGlobalConfig({ version: "1" });
    const projectRoot = createProjectRoot([
      'version: "1"',
      "managedAgents:",
      "  schemaVersion: 2",
      "  routes:",
      "    - id: project-declared-route",
      "      kind: direct",
      "      provider: codex-oauth",
      "      model: gpt-5.6-terra",
      "      credentials:",
      "        mode: runtime-selected",
      "        accountPolicyId: unresolvable-policy",
    ].join("\n"));

    await expect(createOperatorProjectManagedJobApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => ({}),
    })).rejects.toThrow("Managed account or economic routes require modelGateway configuration.");
  });
});
