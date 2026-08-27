import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defineManagedAgentAdapterDescriptor,
  deriveProviderModelEligibility,
  type ExecutionTargetCatalog,
  type ProviderModelEligibilityRequirements,
} from "@kilnai/core/agents";
import {
  normalizeRuntimeProviderDiscoveryCatalog,
  RuntimeManagedAgentInvocationService,
  SqliteManagedAccountLeaseAuthority,
  type ManagedInvocationToolRoute,
} from "@kilnai/runtime";
import type { ManagedAgentRuntimeAdapter } from "@kilnai/runtime";
import { createStagedManagedInvocationRouteCatalog } from "./managed-agent-route-catalog.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "./managed-agent-provider-models.js";
import {
  closeManagedAccountRuntimeComposition,
  createManagedAccountRuntimeComposition,
  resolveManagedInvocationToolOptions,
} from "./managed-agent-routes.js";
import type { ManagedAgentRouteConfigSource } from "./managed-agent-routes.js";
import { resolveProjectStateBinding } from "../application/project-state-root.js";
import { SessionRegistry } from "../wrapper/session-registry.js";
import type { ProviderCreateConfig, ProviderId, SessionProviderDescriptor } from "../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../wrapper/index.js";

const tempRoots: string[] = [];
const READONLY_POLICY: KilnPermissionPolicy = {
  approval: "on-request",
  sandbox: "read-only",
};
const FIXTURE_OBSERVED_AT = "2026-07-01T12:00:00.000Z";

function profileByAdmission(
  route: ManagedInvocationToolRoute | undefined,
  admissionProfile: string,
) {
  return route?.profiles.find((profile) => profile.admissionProfile === admissionProfile);
}

function makeExecutionTargetCatalog(
  routeId: string,
  providerId = "opencode-go",
  providerModelId = "qwen3.6-plus",
  accountId = "research",
): ExecutionTargetCatalog {
  return {
    accounts: [{
      id: accountId,
      providerId,
      credentialId: `credential-${accountId}`,
      maxConcurrency: 1,
      reservedAffinitySlots: 0,
      economics: {
        capacityIdentity: `capacity-${accountId}`,
        subscriptionClass: "metered",
        quotaClassId: `quota-${accountId}`,
        creditPosture: "disabled",
        overagePosture: "disabled",
      },
    }],
    accountPolicies: [{
      id: `policy-${accountId}`,
      accountIds: [accountId],
      strategy: "economic-least-pressure",
    }],
    targets: [{
      id: routeId,
      label: routeId,
      providerId,
      providerModelId,
      accountPolicyId: `policy-${accountId}`,
      economics: {
        adapterCapabilityId: `${providerId}:managed-agent`,
        adapterCapabilityVersion: "v1",
        authBillingChannel: "fixture",
        executionMode: "direct",
        serviceTier: "default",
        rateCardBasis: "fixture",
        envelopeSemantics: "request",
        fallbackPosture: "disabled",
        overagePosture: "disabled",
        contextClass: "standard",
        cacheClass: "none",
        priceEvidence: {
          kind: "free",
          rateCardId: "fixture",
          rateCardRevision: "v1",
          evidence: {
            sourceIdentity: "managed-agent-route-catalog.test",
            sourceRevision: "v1",
            sourceDigest: "fixture",
            observedAt: FIXTURE_OBSERVED_AT,
            validUntil: "2027-07-01T12:00:00.000Z",
            confidence: "high",
            authority: "configured",
          },
        },
        auxiliaryCharges: [],
        executionEnvelope: { limits: [] },
      },
    }],
  };
}

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-managed-route-catalog-"));
  // Project resolution is identity-first: a real fixture needs repository
  // root evidence rather than the removed repository-local `.kiln` marker.
  mkdirSync(join(root, ".git"), { recursive: true });
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
  const executionCatalog = makeExecutionTargetCatalog("opencode-go-research-readonly");
  return {
    executionCatalog,
    targetCatalog: {
      accounts: executionCatalog.accounts,
      accountPolicies: executionCatalog.accountPolicies,
      targets: executionCatalog.targets.map((target) => ({ ...target, kind: "direct" as const })),
    },
    authorityProfiles: [{
      id: "readonly-plan",
      admissionProfile: "foundation-readonly-plan",
      workingDirectory: "project",
      tools: { allowed: ["read", "web_search"], network, writes: false },
      memory: { access: "read-only" },
    }],
    managedAgents: {
      enabled: true,
      defaultAuthorityProfileId: "readonly-plan",
      intents: [{
        id: "research-agent",
        purpose: "Run bounded research route.",
        authorityProfileId: "readonly-plan",
        target: { mode: "explicit", targetId: "opencode-go-research-readonly" },
        paidUsage: "ask-before-spend",
      }],
    },
  };
}

function makeIsolatedWorktreeWriteConfig(
  worktreeRootPath = "managed-worktrees",
): ManagedAgentRouteConfigSource {
  return {
    targetCatalog: {
      accounts: [],
      accountPolicies: [],
      targets: [{
        id: "codex-approved-write",
        kind: "harness",
        label: "Codex approved write",
        providerId: "codex",
        providerModelId: "gpt-5.3-codex-spark",
        dataClassification: "internal",
        dataPolicyEvidence: harnessDataPolicy("codex", "gpt-5.3-codex-spark"),
      }],
    },
    authorityProfiles: [{
      id: "approved-write",
      admissionProfile: "foundation-apply-approved-writes",
      workingDirectory: "isolated-worktree",
      tools: { allowed: ["read", "grep", "glob", "apply-patch"], network: false, writes: true },
      memory: { access: "read-only" },
      writeAuthority: {
        workspace: { mode: "apply-approved", allowedPaths: ["packages/cli/src/config"] },
        approval: { mode: "required-before-apply" },
      },
    }],
    managedAgents: {
      enabled: true,
      defaultAuthorityProfileId: "approved-write",
      worktreeLease: {
        mode: "git",
        rootPath: worktreeRootPath,
      },
    },
  };
}

function harnessDataPolicy(providerId: string, providerModelId: string) {
  return {
    providerId,
    providerModelId,
    dataUse: "not-used" as const,
    trainingPosture: "prohibited" as const,
    retention: { posture: "zero" as const, days: 0 },
    permittedMaximumClassification: "internal" as const,
    permittedClassifications: ["public", "internal"] as const,
    sourceIdentity: "managed-agent-route-catalog.test",
    sourceRevision: "v1",
    sourceDigest: `sha256:${"c".repeat(64)}` as const,
    observedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2027-07-01T00:00:00.000Z",
  };
}

describe("managed agent route catalog", () => {
  it("does not open a project-local authority when an operator-runtime authority is supplied", async () => {
    const cwd = createTempRoot();
    const runtimeDirectory = resolveProjectStateBinding(cwd).runtimePath;
    mkdirSync(runtimeDirectory, { recursive: true });
    const existingOwner = new SqliteManagedAccountLeaseAuthority({
      path: join(runtimeDirectory, "managed-account-leases.sqlite"),
    });
    try {
      const catalog = await createStagedManagedInvocationRouteCatalog(makeConfig(false), {
        cwd,
        registry: createRegistry("opencode-go"),
        surface: "gui",
        isProviderAvailable: () => true,
        directAdapterFactory: () => makeAdapter(),
        managedEconomicAuthority: {
          acquire: vi.fn(),
          releasePreFence: vi.fn(),
          fenceDispatch: vi.fn(),
          settleExecution: vi.fn(),
          recordExecutionSettlementPending: vi.fn(),
        },
      });

      expect(catalog.managedInvocation).toBeDefined();
      await catalog.dispose();
    } finally {
      existingOwner.close();
    }
  });

  it("shares one explicitly global managed-account owner across project roots", () => {
    const firstProject = createTempRoot();
    const secondProject = createTempRoot();
    const globalRuntime = createTempRoot();
    const databasePath = join(globalRuntime, "model-gateway.sqlite");
    const first = createManagedAccountRuntimeComposition(makeConfig(false), firstProject, {
      compositionKey: globalRuntime,
      databasePath,
    });
    const second = createManagedAccountRuntimeComposition(makeConfig(false), secondProject, {
      compositionKey: globalRuntime,
      databasePath,
    });

    expect(second).toBe(first);
    expect(second?.authority).toBe(first?.authority);
    closeManagedAccountRuntimeComposition(globalRuntime);
  });

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
    expect(profileByAdmission(catalog.managedInvocation?.routes[0], "foundation-readonly-plan")?.networkAllowed).toBe(false);

    currentConfig = makeConfig(true);
    await catalog.refreshNow();
    const refreshedComposition = createManagedAccountRuntimeComposition(currentConfig, cwd);

    expect(profileByAdmission(catalog.managedInvocation?.routes[0], "foundation-readonly-plan")?.networkAllowed).toBe(true);
    expect(refreshedComposition?.authority).toBe(initialComposition?.authority);
    expect(refreshedComposition?.routing).toBe(initialComposition?.routing);
  });

  it("stops scheduled discovery refreshes when the catalog is disposed", async () => {
    vi.useFakeTimers();
    try {
      const discoverProviderModels = vi.fn(async () => observedProviderModels({
        "opencode-go": ["qwen3.6-plus"],
      }));
      const catalog = await createStagedManagedInvocationRouteCatalog(makeConfig(false), {
        cwd: createTempRoot(),
        registry: createRegistry("opencode-go"),
        surface: "gui",
        isProviderAvailable: () => true,
        directAdapterFactory: () => makeAdapter(),
      }, {
        discoverProviderModels,
        refreshIntervalMs: 1_000,
      });

      catalog.startBackgroundRefresh();
      await catalog.dispose();
      await vi.advanceTimersByTimeAsync(3_000);

      expect(discoverProviderModels).toHaveBeenCalledTimes(1);
      await catalog.refreshNow();
      expect(discoverProviderModels).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disposes immediately and rejects a late discovery result", async () => {
    let resolveDiscovery!: (value: ManagedAgentProviderModelCatalogDiagnostics) => void;
    const pendingDiscovery = new Promise<ManagedAgentProviderModelCatalogDiagnostics>((resolve) => {
      resolveDiscovery = resolve;
    });
    const catalog = await createStagedManagedInvocationRouteCatalog(makeConfig(false), {
      cwd: createTempRoot(),
      registry: createRegistry("opencode-go"),
      surface: "gui",
      isProviderAvailable: () => true,
      directAdapterFactory: () => makeAdapter(),
    }, {
      discoverProviderModels: () => pendingDiscovery,
    });

    const refresh = catalog.refreshNow();
    await expect(catalog.dispose()).resolves.toBeUndefined();
    resolveDiscovery(observedProviderModels({ "opencode-go": ["qwen3.6-plus"] }));
    await refresh;

    expect(catalog.managedInvocation?.routes).toEqual([]);
    expect(catalog.managedInvocation?.unavailableRoutes?.[0]?.reason).toContain("pending");
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
    const cwd = createTempRoot();
    const referenceRoots = [
      "C:/workspace/references/t1code",
      "C:/workspace/references/vllm-studio",
    ];
    const protectedEntries = [".git", "node_modules", ".kiln"];
    const catalog = makeExecutionTargetCatalog("opencode-go-frontend-reference-readonly");
    const resolution = await resolveManagedInvocationToolOptions({
      executionCatalog: catalog,
      targetCatalog: {
        accounts: catalog.accounts,
        accountPolicies: catalog.accountPolicies,
        targets: catalog.targets.map((target) => ({ ...target, kind: "direct" as const })),
      },
      authorityProfiles: [{
        id: "frontend-reference-readonly",
        admissionProfile: "foundation-readonly-plan",
        workingDirectory: "project",
        tools: { allowed: ["read", "grep", "glob", "web_search"], network: true, writes: false },
        readAuthority: {
          workspace: {
            allowedPaths: referenceRoots,
            deniedPaths: [],
          },
        },
        memory: { access: "read-only" },
      }],
      managedAgents: {
        enabled: true,
        defaultAuthorityProfileId: "frontend-reference-readonly",
        intents: [{
          id: "frontend-reference-agent",
          purpose: "Inspect bounded reference material.",
          authorityProfileId: "frontend-reference-readonly",
          target: { mode: "explicit", targetId: "opencode-go-frontend-reference-readonly" },
          paidUsage: "ask-before-spend",
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
    expect(profileByAdmission(resolution.managedInvocation?.routes[0], "foundation-readonly-plan")).toMatchObject({
      permissionProfile: "read-only",
      readAuthority: {
        workspace: {
          allowedPaths: [
            ...referenceRoots.map((rootPath) => win32.normalize(rootPath)),
          ],
          deniedPaths: [
            ...protectedEntries.map((entry) => join(cwd, entry)),
            ...referenceRoots.flatMap((rootPath) => protectedEntries.map((entry) => win32.join(rootPath, entry))),
          ],
        },
      },
    });
  });

  it("does not admit agent definitions that use removed route/provider fields", async () => {
    const cwd = createTempRoot();
    const agentsDirectory = resolveProjectStateBinding(cwd).agentsPath;
    mkdirSync(agentsDirectory, { recursive: true });
    writeFileSync(join(agentsDirectory, "contradictory.md"), [
      "---",
      "name: contradictory",
      "role: reviewer",
      "goal: Review repository evidence.",
      "tier: reasoning",
      "economicPolicyId: codex-reviewer-economic-policy",
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

    expect(resolution.managedInvocation?.agentCatalog?.some((agent) => agent.name === "contradictory") ?? false).toBe(false);
    expect(resolution.agentHealth?.some((agent) => agent.agentName === "contradictory") ?? false).toBe(false);
  });

  it("projects isolated worktree routes with a shared runtime invocation service", async () => {
    const cwd = createTempRoot();
    const worktreeRootPath = join(resolveProjectStateBinding(cwd).tmpPath, "managed-worktrees");
    const resolution = await resolveManagedInvocationToolOptions(makeIsolatedWorktreeWriteConfig(worktreeRootPath), {
      cwd,
      registry: createRegistry("codex"),
      surface: "run",
      isProviderAvailable: () => true,
      providerModelEligibility: observedProviderModels({
        codex: ["gpt-5.3-codex-spark"],
      }),
    });

    expect(resolution.routeHealth[0]).toMatchObject({ available: true });
    const profile = profileByAdmission(resolution.managedInvocation?.routes[0], "foundation-apply-approved-writes");

    expect(profile?.workingDirectory).toEqual({
      path: worktreeRootPath,
      mode: "isolated-worktree",
    });
    expect(profile?.workingDirectoryLease).toEqual({
      mode: "git-worktree",
      sourcePath: cwd,
      rootPath: worktreeRootPath,
    });
    expect(resolution.managedInvocation?.invocationService).toBeInstanceOf(RuntimeManagedAgentInvocationService);
  });

  it("fails closed when isolated worktree write scopes point outside the repository", async () => {
    const cwd = createTempRoot();
    const config = makeIsolatedWorktreeWriteConfig(join(resolveProjectStateBinding(cwd).tmpPath, "managed-worktrees"));
    const profile = config.authorityProfiles?.[0];
    if (!profile?.writeAuthority) {
      throw new Error("expected test authority profile write authority");
    }
    const resolution = await resolveManagedInvocationToolOptions({
      ...config,
      authorityProfiles: [{
          ...profile,
          writeAuthority: {
            ...profile.writeAuthority,
            workspace: {
              ...profile.writeAuthority.workspace,
              mode: "apply-approved",
              allowedPaths: [`${cwd}/../outside`],
            },
          },
        }],
    }, {
      cwd,
      registry: createRegistry("codex"),
      surface: "run",
      isProviderAvailable: () => true,
      providerModelEligibility: observedProviderModels({
        codex: ["gpt-5.3-codex-spark"],
      }),
      invocationService: new RuntimeManagedAgentInvocationService(),
      includeUnavailableRoutes: true,
    });

    expect(resolution.routeHealth[0]).toMatchObject({
      available: false,
      reason: "isolated-worktree write routes require writeAuthority.workspace.allowedPaths to stay inside the repository root.",
    });
  });

  it("keeps the managed invocation service stable and clears routes when refresh disables managed agents", async () => {
    const cwd = createTempRoot();
    let currentConfig: ManagedAgentRouteConfigSource = makeIsolatedWorktreeWriteConfig(
      join(resolveProjectStateBinding(cwd).tmpPath, "managed-worktrees"),
    );
    const catalog = await createStagedManagedInvocationRouteCatalog(currentConfig, {
      cwd,
      registry: createRegistry("codex"),
      surface: "gui",
      isProviderAvailable: () => true,
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
    const projectTmpPath = resolveProjectStateBinding(cwd).tmpPath;
    let currentConfig: ManagedAgentRouteConfigSource = makeIsolatedWorktreeWriteConfig(
      join(projectTmpPath, "managed-worktrees"),
    );
    const catalog = await createStagedManagedInvocationRouteCatalog(currentConfig, {
      cwd,
      registry: createRegistry("codex"),
      surface: "gui",
      isProviderAvailable: () => true,
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
          rootPath: join(projectTmpPath, "alternate-managed-worktrees"),
        },
      },
    };
    await catalog.refreshNow();

    const profile = profileByAdmission(catalog.managedInvocation?.routes[0], "foundation-apply-approved-writes");
    expect(initialService).toBeInstanceOf(RuntimeManagedAgentInvocationService);
    expect(catalog.managedInvocation?.invocationService).toBeInstanceOf(RuntimeManagedAgentInvocationService);
    expect(catalog.managedInvocation?.invocationService).not.toBe(initialService);
    expect(profile?.workingDirectoryLease?.rootPath).toBe(join(projectTmpPath, "alternate-managed-worktrees"));
  });

  it("fails closed when isolated worktree absolute paths only match the repository by POSIX case folding", async () => {
    const actualRoot = createTempRoot();
    const cwd = actualRoot
      .replace(/^[A-Za-z]:[\\/]/u, "/")
      .replaceAll("\\", "/");
    // The POSIX spelling still resolves to the existing Windows fixture, but
    // the declared paths differ only by case. A POSIX comparison must reject
    // that as an outside-repository scope rather than inheriting Windows
    // case-folding semantics.
    const caseVariantRoot = cwd.replace("/kiln-managed-route-catalog-", "/KILN-managed-route-catalog-");
    const config = makeIsolatedWorktreeWriteConfig(`${caseVariantRoot}/managed-worktrees`);
    const profile = config.authorityProfiles?.[0];
    if (!profile?.writeAuthority) {
      throw new Error("expected test authority profile write authority");
    }
    const resolution = await resolveManagedInvocationToolOptions({
      ...config,
      authorityProfiles: [{
        ...profile,
        writeAuthority: {
          ...profile.writeAuthority,
          workspace: {
            ...profile.writeAuthority.workspace,
            mode: "apply-approved",
            allowedPaths: [`${caseVariantRoot}/packages/runtime/src`],
          },
        },
      }],
      managedAgents: {
        ...config.managedAgents,
        worktreeLease: {
          mode: "git",
          rootPath: `${caseVariantRoot}/managed-worktrees`,
        },
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
      compositionMode: "candidate-admission",
    });

    expect(resolution.routeHealth[0]).toMatchObject({
      available: false,
      reason: "isolated-worktree write routes require writeAuthority.workspace.allowedPaths to stay inside the repository root.",
    });
  });
});
