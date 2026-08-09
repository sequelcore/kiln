import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveProviderModelEligibility,
  defineManagedAgentAdapterDescriptor,
  type ProviderModelEligibilityRequirements,
} from "@kilnai/core";
import { normalizeRuntimeProviderDiscoveryCatalog, RuntimeManagedAgentInvocationService } from "@kilnai/runtime";
import type { ManagedAgentRuntimeAdapter } from "@kilnai/runtime";
import { createStagedManagedInvocationRouteCatalog } from "./managed-agent-route-catalog.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "./managed-agent-provider-models.js";
import {
  closeManagedAccountRuntimeComposition,
  createManagedAccountRuntimeComposition,
  resolveManagedInvocationToolOptions,
} from "./managed-agent-routes.js";
import type { ManagedAgentRouteConfigSource } from "./managed-agent-routes.js";
import { SessionRegistry } from "../wrapper/session-registry.js";
import type { ProviderCreateConfig, ProviderId, SessionProviderDescriptor } from "../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../wrapper/index.js";

const tempRoots: string[] = [];
const READONLY_POLICY: KilnPermissionPolicy = {
  approval: "on-request",
  sandbox: "read-only",
};
const FIXTURE_OBSERVED_AT = "2026-07-01T12:00:00.000Z";

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-managed-route-catalog-"));
  tempRoots.push(root);
  return root;
}

function makeAdapter(): ManagedAgentRuntimeAdapter {
  return {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:opencode-go:direct",
      providerId: "opencode-go",
      adapterKind: "direct",
      supportedProfiles: ["foundation-readonly-plan"],
      supportedExecutionModes: ["direct-provider"],
      lifecycle: {
        exposesStart: true,
        exposesTerminal: true,
        exposesCleanup: true,
      },
      cancellation: { supported: true },
      timeout: { supported: true, diagnosticArtifactOnTimeout: true },
      transcript: {
        supported: true,
        redactionKnown: true,
        truncationKnown: true,
        persistenceKnown: true,
        retentionKnown: true,
      },
      usage: {
        supported: true,
        preservesProviderTokenClasses: true,
        supportsExplicitUnknowns: true,
        tokenClasses: ["input", "output", "cache_read", "cache_write"],
        semanticSourceGranularity: "estimated",
        evidenceBasis: "runtime",
      },
      resultHandoff: {
        boundedSummary: true,
        resourcePointers: true,
      },
      credentialRoute: { supported: true },
      memoryContext: { governedAdmission: true },
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    }),
    invoke: vi.fn(),
  };
}

function observedProviderModels(
  models: Readonly<Record<string, readonly string[]>>,
): ManagedAgentProviderModelCatalogDiagnostics {
  return Object.fromEntries(Object.entries(models).map(([providerId, providerModels]) => {
    const catalog = normalizeRuntimeProviderDiscoveryCatalog({
      providerId,
      family: providerId === "codex"
        ? "codex-harness"
        : providerId === "opencode"
          ? "opencode-harness"
          : "direct-provider",
      discovery: {
        models: providerModels,
        status: "available",
        reason: "fixture catalog",
        authState: "authenticated",
      },
      observedAt: FIXTURE_OBSERVED_AT,
      freshness: "fresh",
      ...(providerId === "codex" || providerId === "opencode"
        ? { harnessId: providerId, reportedProviderId: providerId }
        : {}),
    });
    return [
      providerId,
      Object.fromEntries(catalog.routes.map((route) => [
        route.identity.route.providerModelId,
        {
          catalogDiagnosticEvidence: route,
          catalogDiagnosticDecision: deriveProviderModelEligibility(route, managedCatalogRequirements(), []),
        },
      ])),
    ];
  }));
}

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

function createRegistry(provider: ProviderId): SessionRegistry {
  const descriptor: SessionProviderDescriptor = {
    id: provider,
    costTier: "low",
    capabilities: {
      mcp: false,
      streaming: true,
      resumable: false,
      resume: false,
      costTrackingMode: "computed",
      supportedTools: [],
      maxContextTokens: null,
      priority: 1,
      fallbackTo: null,
      permissionPolicy: READONLY_POLICY,
    },
    isAvailable: () => true,
    create: (_config: ProviderCreateConfig) => ({
      sessionId: `${provider}-session`,
      providerSessionId: `${provider}-provider-session`,
      capabilities: {
        mcp: false,
        streaming: true,
        resumable: false,
        resume: false,
        costTrackingMode: "computed",
        supportedTools: [],
        maxContextTokens: null,
        priority: 1,
        fallbackTo: null,
        permissionPolicy: READONLY_POLICY,
      },
      async *run() {
        yield {
          type: "completed" as const,
          totalUsd: 0,
          durationMs: 1,
          isError: false,
          isPreflightCrash: false,
        };
      },
      async dispose() {},
    }),
  };
  return new SessionRegistry([descriptor]);
}

function makeConfig(network: boolean): ManagedAgentRouteConfigSource {
  return {
    modelGateway: {
      port: 4819,
      accounts: [{
        id: "research",
        providerId: "opencode-go",
        credentialId: "synthetic-research",
        maxConcurrency: 1,
        reservedAffinitySlots: 0,
      }],
      replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
      surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
      principals: [],
      virtualModels: [{
        id: "managed-research",
        providerId: "opencode-go",
        providerModelId: "qwen3.6-plus",
        accountIds: ["research"],
        capabilities: ["text"],
        affinity: { continuity: "none" },
      }],
    },
    managedAgents: {
      enabled: true,
      economicPolicies: [{
        id: "research-policy",
        revision: "rev-1",
        evidenceRequirements: { quota: "optional", price: "optional" },
        noRouteAction: "deny",
        comparisonDomains: [{
          id: "priority-only",
          rank: 0,
          unit: "request",
          scheme: { kind: "unit" },
          rateCardBasis: "configured",
          envelopeSemantics: "bounded",
        }],
        candidates: [{
          routeId: "opencode-go-research-readonly",
          comparisonDomainId: "priority-only",
          priorityRank: 0,
          ceiling: { kind: "none" },
          worstCaseReservation: { kind: "not-comparable", reason: "economic-basis-unavailable" },
        }],
      }],
      routes: [{
        id: "opencode-go-research-readonly",
        kind: "direct",
        provider: "opencode-go",
        model: "qwen3.6-plus",
        profiles: ["foundation-readonly-plan"],
        workingDirectory: "project",
        tools: {
          allowed: ["read", "web_search"],
          network,
          writes: false,
        },
        memory: { access: "read-only" },
        credentials: { mode: "runtime-selected", accountPolicyId: "managed-research" },
      }],
    },
  };
}

function makeIsolatedWorktreeWriteConfig(): ManagedAgentRouteConfigSource {
  return {
    managedAgents: {
      enabled: true,
      worktreeLease: {
        mode: "git",
        rootPath: ".kiln/managed-worktrees",
      },
      routes: [{
        id: "codex-approved-write",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-apply-approved-writes"],
        workingDirectory: "isolated-worktree",
        tools: {
          allowed: ["read", "grep", "glob", "apply-patch"],
          network: false,
          writes: true,
        },
        memory: { access: "read-only" },
        credentials: { mode: "credentialless" },
        writeAuthority: {
          workspace: {
            mode: "apply-approved",
            allowedPaths: ["packages/cli/src/config"],
          },
          approval: {
            mode: "required-before-apply",
          },
        },
      }],
    },
  };
}

describe("managed agent route catalog", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      closeManagedAccountRuntimeComposition(root);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refreshes live routes without replacing the managed account capacity authority", async () => {
    const cwd = createTempRoot();
    const staleConfig = makeConfig(false);
    let currentConfig = staleConfig;
    const initialComposition = createManagedAccountRuntimeComposition(staleConfig, cwd);
    const catalog = await createStagedManagedInvocationRouteCatalog(staleConfig, {
      cwd,
      registry: createRegistry("opencode-go"),
      surface: "gui",
      isProviderAvailable: () => true,
      directAdapterFactory: () => makeAdapter(),
    }, {
      reloadConfig: () => currentConfig,
      discoverProviderModels: async () => observedProviderModels({ "opencode-go": ["qwen3.6-plus"] }),
    });

    expect(catalog.managedInvocation?.routes).toEqual([]);
    expect(catalog.managedInvocation?.unavailableRoutes?.[0]?.reason)
      .toBe("Provider/model eligibility evidence is pending for direct managed invocation route 'opencode-go-research-readonly'.");

    await catalog.refreshNow();
    expect(catalog.managedInvocation?.routes[0]?.profiles["foundation-readonly-plan"]?.networkAllowed).toBe(false);

    currentConfig = makeConfig(true);
    await catalog.refreshNow();
    const refreshedComposition = createManagedAccountRuntimeComposition(currentConfig, cwd);

    expect(catalog.managedInvocation?.routes[0]?.profiles["foundation-readonly-plan"]?.networkAllowed).toBe(true);
    expect(refreshedComposition?.authority).toBe(initialComposition?.authority);
    expect(refreshedComposition?.routing).toBe(initialComposition?.routing);
  });

  it("does not construct direct provider adapters while staged provider discovery is pending", async () => {
    const cwd = createTempRoot();
    const directAdapterFactory = vi.fn(async () => makeAdapter());
    const catalog = await createStagedManagedInvocationRouteCatalog(makeConfig(false), {
      cwd,
      registry: createRegistry("opencode-go"),
      surface: "gui",
      isProviderAvailable: () => true,
      directAdapterFactory,
    }, {
      discoverProviderModels: async () => observedProviderModels({ "opencode-go": ["qwen3.6-plus"] }),
    });

    expect(directAdapterFactory).not.toHaveBeenCalled();
    expect(catalog.managedInvocation?.routes).toEqual([]);
    expect(catalog.managedInvocation?.unavailableRoutes?.[0]).toMatchObject({
      providerId: "opencode-go",
      model: "qwen3.6-plus",
      reason: "Provider/model eligibility evidence is pending for direct managed invocation route 'opencode-go-research-readonly'.",
    });

    await catalog.refreshNow();

    // H1/H2 closure (issue #34): direct-route adapter construction is always
    // deferred to the committed factory now, so the route becomes available
    // once discovery resolves without ever calling directAdapterFactory
    // eagerly - it is only invoked later, through createCommittedAdapter,
    // once a real economic commitment exists.
    expect(directAdapterFactory).not.toHaveBeenCalled();
    expect(catalog.managedInvocation?.routes[0]?.routeId).toBe("opencode-go-research-readonly");
    expect(catalog.managedInvocation?.routes[0]?.createCommittedAdapter).toBeInstanceOf(Function);
  });

  it("projects explicit read-only reference roots with default protected descendants", async () => {
    const cwd = "C:/workspace/kiln";
    const resolution = await resolveManagedInvocationToolOptions({
      managedAgents: {
        enabled: true,
        economicPolicies: [{
          id: "frontend-reference-policy",
          revision: "rev-1",
          evidenceRequirements: { quota: "optional", price: "optional" },
          noRouteAction: "deny",
          comparisonDomains: [{
            id: "priority-only",
            rank: 0,
            unit: "request",
            scheme: { kind: "unit" },
            rateCardBasis: "configured",
            envelopeSemantics: "bounded",
          }],
          candidates: [{
            routeId: "opencode-go-frontend-reference-readonly",
            comparisonDomainId: "priority-only",
            priorityRank: 0,
            ceiling: { kind: "none" },
            worstCaseReservation: { kind: "not-comparable", reason: "economic-basis-unavailable" },
          }],
        }],
        routes: [{
          id: "opencode-go-frontend-reference-readonly",
          kind: "direct",
          provider: "opencode-go",
          model: "qwen3.6-plus",
          profiles: ["foundation-readonly-plan"],
          workingDirectory: "project",
          tools: {
            allowed: ["read", "grep", "glob", "web_search"],
            network: true,
            writes: false,
          },
          readAuthority: {
            workspace: {
              allowedPaths: [
                "C:/workspace/references/t1code",
                "C:/workspace/references/vllm-studio",
              ],
              deniedPaths: [],
            },
          },
          memory: { access: "read-only" },
          credentials: { mode: "credentialless" },
        }],
      },
    }, {
      cwd,
      registry: createRegistry("opencode-go"),
      surface: "gui",
      isProviderAvailable: () => true,
      providerModelEligibility: observedProviderModels({
        "opencode-go": ["qwen3.6-plus"],
      }),
      directAdapterFactory: async () => makeAdapter(),
    });

    expect(resolution.routeHealth[0]).toMatchObject({ available: true });
    expect(resolution.managedInvocation?.routes[0]?.profiles["foundation-readonly-plan"]).toMatchObject({
      permissionProfile: "read-only",
      readAuthority: {
        workspace: {
          allowedPaths: [
            "C:\\workspace\\references\\t1code",
            "C:\\workspace\\references\\vllm-studio",
          ],
          deniedPaths: [
            "C:\\workspace\\kiln\\.git",
            "C:\\workspace\\kiln\\node_modules",
            "C:\\workspace\\kiln\\.kiln",
            "C:\\workspace\\references\\t1code\\.git",
            "C:\\workspace\\references\\t1code\\node_modules",
            "C:\\workspace\\references\\t1code\\.kiln",
            "C:\\workspace\\references\\vllm-studio\\.git",
            "C:\\workspace\\references\\vllm-studio\\node_modules",
            "C:\\workspace\\references\\vllm-studio\\.kiln",
          ],
        },
      },
    });
  });

  it("rejects agent profiles whose explicit provider route contradicts their route id", async () => {
    const cwd = createTempRoot();
    const agentsDirectory = join(cwd, ".kiln", "agents");
    mkdirSync(agentsDirectory, { recursive: true });
    writeFileSync(join(agentsDirectory, "contradictory.md"), [
      "---",
      "name: contradictory",
      "role: reviewer",
      "goal: Review repository evidence.",
      "tier: reasoning",
      "routeId: opencode-go-research-readonly",
      "providerRoute:",
      "  providerId: codex-oauth",
      "  model: gpt-5.6-terra",
      "---",
      "Review evidence without modifying the workspace.",
    ].join("\n"));

    const resolution = await resolveManagedInvocationToolOptions(makeConfig(true), {
      cwd,
      registry: createRegistry("opencode-go"),
      surface: "operator",
      isProviderAvailable: () => true,
      providerModelEligibility: observedProviderModels({
        "opencode-go": ["qwen3.6-plus"],
      }),
      directAdapterFactory: async () => makeAdapter(),
    });

    expect(resolution.managedInvocation?.agentCatalog?.some((agent) => agent.name === "contradictory")).toBe(false);
    expect(resolution.agentHealth).toContainEqual({
      agentName: "contradictory",
      available: false,
      routeId: "opencode-go-research-readonly",
      reason: "Agent provider 'codex-oauth' does not match route provider 'opencode-go'.",
    });
  });

  it("projects isolated worktree routes with a shared runtime invocation service", async () => {
    const cwd = createTempRoot();
    const resolution = await resolveManagedInvocationToolOptions(makeIsolatedWorktreeWriteConfig(), {
      cwd,
      registry: createRegistry("codex"),
      surface: "run",
      isProviderAvailable: () => true,
      providerModelEligibility: observedProviderModels({
        codex: ["gpt-5.3-codex-spark"],
      }),
    });

    expect(resolution.routeHealth[0]).toMatchObject({ available: true });
    const profile = resolution.managedInvocation?.routes[0]?.profiles["foundation-apply-approved-writes"];

    expect(profile?.workingDirectory).toEqual({
      path: join(cwd, ".kiln", "managed-worktrees"),
      mode: "isolated-worktree",
    });
    expect(profile?.workingDirectoryLease).toEqual({
      mode: "git-worktree",
      sourcePath: cwd,
      rootPath: join(cwd, ".kiln", "managed-worktrees"),
    });
    expect(resolution.managedInvocation?.invocationService).toBeInstanceOf(RuntimeManagedAgentInvocationService);
  });

  it("fails closed when isolated worktree write scopes point outside the repository", async () => {
    const cwd = createTempRoot();
    const config = makeIsolatedWorktreeWriteConfig();
    const route = config.managedAgents?.routes?.[0];
    if (!route?.writeAuthority) {
      throw new Error("expected test route write authority");
    }
    const resolution = await resolveManagedInvocationToolOptions({
      ...config,
      managedAgents: {
        ...config.managedAgents,
        routes: [{
          ...route,
          writeAuthority: {
            ...route.writeAuthority,
            workspace: {
              ...route.writeAuthority.workspace,
              mode: "apply-approved",
              allowedPaths: [`${cwd}/../outside`],
            },
          },
        }],
      },
    }, {
      cwd,
      registry: createRegistry("codex"),
      surface: "run",
      isProviderAvailable: () => true,
      providerModelEligibility: observedProviderModels({
        codex: ["gpt-5.3-codex-spark"],
      }),
      includeUnavailableRoutes: true,
    });

    expect(resolution.routeHealth[0]).toMatchObject({
      available: false,
      reason: "isolated-worktree write routes require writeAuthority.workspace.allowedPaths to stay inside the repository root.",
    });
  });

  it("keeps the managed invocation service stable and clears routes when refresh disables managed agents", async () => {
    const cwd = createTempRoot();
    let currentConfig: ManagedAgentRouteConfigSource = makeIsolatedWorktreeWriteConfig();
    const catalog = await createStagedManagedInvocationRouteCatalog(currentConfig, {
      cwd,
      registry: createRegistry("codex"),
      surface: "gui",
      isProviderAvailable: () => true,
      userHome: cwd,
    }, {
      reloadConfig: () => currentConfig,
      discoverProviderModels: async () => observedProviderModels({ codex: ["gpt-5.3-codex-spark"] }),
    });
    const service = catalog.managedInvocation?.invocationService;

    currentConfig = { managedAgents: { enabled: false } };
    await catalog.refreshNow();

    expect(service).toBeInstanceOf(RuntimeManagedAgentInvocationService);
    expect(catalog.managedInvocation?.invocationService).toBe(service);
    expect(catalog.managedInvocation?.routes).toEqual([]);
    expect(catalog.managedInvocation?.unavailableRoutes).toEqual([]);
    expect(catalog.managedInvocation?.agentCatalog).toEqual([]);
    expect(catalog.managedInvocation?.skillCatalog).toEqual([]);
  });

  it("replaces the managed invocation service when worktree lease configuration changes", async () => {
    const cwd = createTempRoot();
    let currentConfig: ManagedAgentRouteConfigSource = makeIsolatedWorktreeWriteConfig();
    const catalog = await createStagedManagedInvocationRouteCatalog(currentConfig, {
      cwd,
      registry: createRegistry("codex"),
      surface: "gui",
      isProviderAvailable: () => true,
      userHome: cwd,
    }, {
      reloadConfig: () => currentConfig,
      discoverProviderModels: async () => observedProviderModels({ codex: ["gpt-5.3-codex-spark"] }),
    });
    await catalog.refreshNow();
    const initialService = catalog.managedInvocation?.invocationService;

    currentConfig = {
      ...currentConfig,
      managedAgents: {
        ...currentConfig.managedAgents,
        worktreeLease: {
          mode: "git",
          rootPath: ".kiln/alternate-managed-worktrees",
        },
      },
    };
    await catalog.refreshNow();

    const profile = catalog.managedInvocation?.routes[0]?.profiles["foundation-apply-approved-writes"];
    expect(initialService).toBeInstanceOf(RuntimeManagedAgentInvocationService);
    expect(catalog.managedInvocation?.invocationService).toBeInstanceOf(RuntimeManagedAgentInvocationService);
    expect(catalog.managedInvocation?.invocationService).not.toBe(initialService);
    expect(profile?.workingDirectoryLease?.rootPath).toBe(join(cwd, ".kiln", "alternate-managed-worktrees"));
  });

  it("fails closed when isolated worktree absolute paths only match the repository by POSIX case folding", async () => {
    const config = makeIsolatedWorktreeWriteConfig();
    const route = config.managedAgents?.routes?.[0];
    if (!route?.writeAuthority) {
      throw new Error("expected test route write authority");
    }
    const resolution = await resolveManagedInvocationToolOptions({
      ...config,
      managedAgents: {
        ...config.managedAgents,
        worktreeLease: {
          mode: "git",
          rootPath: "/Users/test/repo/.kiln/managed-worktrees",
        },
        routes: [{
          ...route,
          writeAuthority: {
            ...route.writeAuthority,
            workspace: {
              ...route.writeAuthority.workspace,
              mode: "apply-approved",
              allowedPaths: ["/Users/test/Repo/packages/runtime/src"],
            },
          },
        }],
      },
    }, {
      cwd: "/Users/test/repo",
      registry: createRegistry("codex"),
      surface: "run",
      isProviderAvailable: () => true,
      providerModelEligibility: observedProviderModels({
        codex: ["gpt-5.3-codex-spark"],
      }),
      includeUnavailableRoutes: true,
    });

    expect(resolution.routeHealth[0]).toMatchObject({
      available: false,
      reason: "isolated-worktree write routes require writeAuthority.workspace.allowedPaths to stay inside the repository root.",
    });
  });
});
