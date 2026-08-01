import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSessionBuiltinToolOptions,
  deriveProviderModelEligibility,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
  type ManagedAgentInvocationRequest,
  type ProviderModelEvidenceFreshness,
  type ProviderModelEligibilityRequirements,
  type ToolResourceProvider,
} from "@kilnai/core";
import type { KilnPermissionPolicy } from "../../src/wrapper/index.js";
import type {
  ProviderCreateConfig,
  ProviderId,
  SessionProviderDescriptor,
} from "../../src/wrapper/session-registry.js";
import { SessionRegistry } from "../../src/wrapper/session-registry.js";
import { validateGlobalConfig, type KilnGlobalConfig } from "../../src/config/global-config.js";
import {
  createManagedInvocationToolOptionsCatalog,
  resolveManagedInvocationToolOptions,
} from "../../src/config/managed-agent-routes.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "../../src/config/managed-agent-provider-models.js";
import {
  normalizeRuntimeProviderDiscoveryCatalog,
  RuntimeManagedAgentInvocationService,
  type ManagedAgentRuntimeAdapter,
} from "@kilnai/runtime";

const READONLY_POLICY: KilnPermissionPolicy = {
  approval: "on-request",
  sandbox: "read-only",
};
const FIXTURE_OBSERVED_AT = "2026-07-01T12:00:00.000Z";
const LIVE_PROVEN_DIRECT_WRITE_AUTHORITY = {
  proposalSupported: true,
  approvedApplySupported: true,
  memoryProposalSupported: true,
  rollbackEvidence: true,
  cleanupEvidence: true,
  scopeReduction: true,
} as const;

function observedProviderModels(
  models: Readonly<Record<string, readonly string[]>>,
  freshness: ProviderModelEvidenceFreshness = "fresh",
): ManagedAgentProviderModelCatalogDiagnostics {
  return Object.fromEntries(Object.entries(models).map(([providerId, providerModels]) => {
    const catalog = normalizeRuntimeProviderDiscoveryCatalog({
      providerId,
      family: providerId === "codex"
        ? "codex-harness"
        : providerId === "claude"
          ? "claude-harness"
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
      freshness,
      ...(providerId === "codex" || providerId === "claude" || providerId === "opencode"
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

const COMMON_OBSERVED_PROVIDER_MODELS = observedProviderModels({
  claude: [
    "default",
    "opus",
    "haiku",
    "claude-fable-5[1m]",
    "claude-sonnet-5",
    "claude-opus-5",
    "claude-haiku-4-5-20251001",
  ],
  codex: ["gpt-5.3-codex-spark", "gpt-5.4-mini"],
  opencode: ["opencode/minimax-m2.5-free", "opencode/nemotron-3-super-free"],
  "codex-oauth": ["gpt-5.5", "gpt-5.4-mini", "codex-auto-review"],
  "opencode-go": ["qwen3.6-plus", "deepseek-v4-flash", "deepseek-v4-pro", "kimi-k2.6", "minimax-m2.7"],
  "opencode-zen": ["deepseek-v4-flash-free"],
  openai: ["gpt-5.4-mini"],
  openrouter: ["openrouter/free", "qwen/qwen3-coder:free"],
});

function createRegistry(provider: ProviderId, available = true): SessionRegistry {
  return createRegistryForProviders([{ provider, available }]);
}

function createRegistryForProviders(
  providers: readonly { readonly provider: ProviderId; readonly available?: boolean }[],
): SessionRegistry {
  const descriptors: SessionProviderDescriptor[] = providers.map(({ provider, available = true }) => ({
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
    isAvailable: () => available,
    create: (_config: ProviderCreateConfig) => ({
      sessionId: `${provider}-session`,
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
  }));
  return new SessionRegistry(descriptors);
}

function createRegistryWithCapturedHarnessRun(
  provider: ProviderId,
  captureRun: (options: { readonly system?: string; readonly prompt: string }) => void,
): SessionRegistry {
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
      async *run(options: { readonly system?: string; readonly prompt: string }) {
        captureRun(options);
        yield {
          type: "text_delta" as const,
          content: options.system?.includes("Harness resource body.") ? "Harness context read." : "Harness context missing.",
        };
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

function baseConfig(overrides: Partial<KilnGlobalConfig["managedAgents"]> = {}): KilnGlobalConfig {
  const routes = overrides.routes?.map((route) => ({
    credentials: { mode: "credentialless" as const },
    ...route,
  }));
  return {
    version: "1",
    managedAgents: {
      enabled: true,
      defaultProvider: "codex",
      defaultProfile: "foundation-readonly-plan",
      requireApproval: true,
      ...overrides,
      ...(routes ? { routes } : {}),
    },
  };
}

const MANAGED_OPENAI_MODEL_GATEWAY: NonNullable<KilnGlobalConfig["modelGateway"]> = {
  port: 4819,
  accounts: [{
    id: "managed-openai-account",
    providerId: "openai",
    credentialId: "synthetic-openai",
    maxConcurrency: 1,
    reservedAffinitySlots: 0,
  }],
  replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
  principals: [],
  virtualModels: [{
    id: "managed-openai",
    providerId: "openai",
    providerModelId: "gpt-5.4-mini",
    accountIds: ["managed-openai-account"],
    capabilities: ["text"],
    affinity: { continuity: "none" },
  }],
};

const TEST_MANAGED_ACCOUNT_COMPOSITION = {
  routing: {} as never,
  authority: {} as never,
  updateConfig() {},
};

function makeDirectAdapter(providerId = "openai", writeCapable = false): ManagedAgentRuntimeAdapter {
  return {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: `adapter:${providerId}:direct-provider`,
      providerId,
      adapterKind: "direct",
      supportedProfiles: writeCapable
        ? [
          "foundation-readonly-plan",
          "foundation-propose-writes",
          "foundation-apply-approved-writes",
          "foundation-memory-write-proposals",
        ]
        : ["foundation-readonly-plan"],
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
      ...(writeCapable ? { writeAuthority: LIVE_PROVEN_DIRECT_WRITE_AUTHORITY } : {}),
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    }),
    invoke: async ({ request }: { readonly request: ManagedAgentInvocationRequest }) =>
      defineManagedAgentInvocationRecord({
        invocationId: request.invocationId,
        agentId: request.agentId,
        parentSessionId: request.parentSessionId,
        parentTurnId: request.parentTurnId,
        profile: request.profile,
        lifecycleState: "completed",
        providerRoute: request.providerRoute,
        adapterKind: request.adapterKind,
        executionMode: request.executionMode,
        authority: request.authority,
      }),
  };
}

describe("resolveManagedInvocationToolOptions", () => {
  const OPENCODE_UNADVERTISED_MODEL_REASON =
    "Provider 'opencode' has no eligible managed-agent decision for model 'openai/gpt-4o:free'.";
  const OPENCODE_UNPROVEN_BOUNDARY_REASON =
    "Provider 'opencode' native harness has no admitted hard filesystem boundary for managed child execution; use an authorized direct provider route or keep the route unavailable.";

  it("does not expose managed invocation when config is absent or disabled", async () => {
    await expect(resolveManagedInvocationToolOptions(null, {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
    })).resolves.toEqual({
      routeHealth: [],
    });

    await expect(resolveManagedInvocationToolOptions(baseConfig({ enabled: false }), {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
    })).resolves.toEqual({
      routeHealth: [],
    });
  });

  it("does not synthesize managed routes when no supported child engine is enabled", async () => {
    await expect(resolveManagedInvocationToolOptions({
      version: "1",
      engines: {
        claude: { enabled: true, billing: "subscription" },
        codex: { enabled: false, billing: "plus-quota" },
        opencode: { enabled: false, billing: "free" },
      },
    }, {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
    })).resolves.toEqual({
      routeHealth: [],
    });
  });

  it("resolves an explicit healthy Codex harness route", async () => {
    const result = await resolveManagedInvocationToolOptions({
      ...baseConfig({
        routes: [{
          id: "codex-readonly",
          kind: "harness",
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          profiles: ["foundation-readonly-plan"],
          timeoutMs: 120000,
          workingDirectory: "project",
          tools: {
            allowed: ["read", "tree", "grep", "glob"],
            network: false,
            writes: false,
          },
          memory: { access: "read-only" },
          credentials: { mode: "credentialless" },
        }],
      }),
      modelTaskSuitability: [{
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        task: "frontend-design",
        level: "limited",
        reason: "Use a stronger visual-design route when available.",
      }],
    }, {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    });

    expect(result.routeHealth).toEqual([{
      routeId: "codex-readonly",
      routeSource: "explicit-managed-route",
      kind: "harness",
      provider: "codex",
      model: "gpt-5.3-codex-spark",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes).toHaveLength(1);
    expect(result.managedInvocation?.routes[0]?.routeSource).toBe("explicit-managed-route");
    expect(result.managedInvocation?.routes[0]?.adapter.descriptor).toMatchObject({
      adapterKind: "harness",
      providerId: "codex",
    });
    expect(result.managedInvocation?.routes[0]?.taskSuitability).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: "backend-coding",
          level: "capable",
          source: "static-profile",
        }),
        expect.objectContaining({
          task: "frontend-design",
          level: "limited",
          source: "operator-override",
          reason: "Use a stronger visual-design route when available.",
        }),
        expect.objectContaining({
          task: "mechanical-edit",
          level: "preferred",
          source: "static-profile",
        }),
      ]),
    );
    expect(result.managedInvocation?.routes[0]?.profiles["foundation-readonly-plan"]).toMatchObject({
      authorityProfileId: "authority:codex-readonly:foundation-readonly-plan",
      permissionProfile: "read-only",
      allowedToolNames: ["read", "tree", "grep", "glob"],
      workingDirectory: {
        path: "C:/repo",
        mode: "read-only",
      },
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      memoryScope: {
        scope: { kind: "project", id: "repo" },
        access: "read-only",
      },
    });
  });

  it("creates a managed invocation service for runtime-selected credential routes without worktree leases", async () => {
    const result = await resolveManagedInvocationToolOptions({
      ...baseConfig({
        routes: [{
        id: "openai-readonly",
        kind: "direct",
        provider: "openai",
        model: "gpt-5.4-mini",
        profiles: ["foundation-readonly-plan"],
        credentials: {
          mode: "runtime-selected",
          routeId: "credential-route:openai:primary",
          accountPolicyId: "managed-openai",
        },
      }],
      }),
      modelGateway: MANAGED_OPENAI_MODEL_GATEWAY,
    }, {
      cwd: "C:/repo",
      registry: createRegistry("openai"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      directAdapterFactory: () => makeDirectAdapter("openai"),
      managedAccountComposition: TEST_MANAGED_ACCOUNT_COMPOSITION,
    });

    expect(result.managedInvocation?.invocationService).toBeDefined();
    expect(result.managedInvocation?.invocationServiceKey).toContain("credential-route:openai:primary");
  });

  // Roadmap 01 Slice 3.1 (F6) - the route's declared external-runtime
  // attachment must be reachable from real route configuration, not just
  // from programmatically-constructed test fixtures.
  it("reads a route's declared external-runtime attachment from configuration (F6)", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-readonly",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-readonly-plan"],
        externalRuntimeAttachment: {
          runtimeId: "mcp-external-runtime",
          attachmentId: "instance-a",
        },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    });

    expect(result.managedInvocation?.routes[0]?.externalRuntimeAttachment).toEqual({
      kind: "external-runtime",
      runtimeId: "mcp-external-runtime",
      attachmentId: "instance-a",
    });
  });

  it("rejects a route with a blank external-runtime attachment field instead of treating it as absent (F6)", async () => {
    await expect(resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-readonly",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-readonly-plan"],
        externalRuntimeAttachment: {
          runtimeId: "mcp-external-runtime",
          attachmentId: "   ",
        },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    })).rejects.toThrow("externalRuntimeAttachment requires non-empty runtimeId and attachmentId");
  });

  it("rejects a blank external-runtime runtimeId as well as a blank attachmentId (F6)", async () => {
    await expect(resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-readonly",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-readonly-plan"],
        externalRuntimeAttachment: {
          runtimeId: "",
          attachmentId: "instance-a",
        },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    })).rejects.toThrow("externalRuntimeAttachment requires non-empty runtimeId and attachmentId");
  });

  // The configured identity is opaque: config resolution validates that it is
  // not whitespace-only, but must persist the operator's exact string so the
  // admission gate compares what was actually configured.
  it("preserves configured external-runtime identities byte-for-byte, including peripheral whitespace (F6)", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-readonly",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-readonly-plan"],
        externalRuntimeAttachment: {
          runtimeId: " mcp-external-runtime ",
          attachmentId: " instance-a",
        },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    });

    expect(result.managedInvocation?.routes[0]?.externalRuntimeAttachment).toEqual({
      kind: "external-runtime",
      runtimeId: " mcp-external-runtime ",
      attachmentId: " instance-a",
    });
  });

  it("wires current resource_read hydration into resolved CLI harness routes", async () => {
    let capturedRun: { readonly system?: string; readonly prompt: string } | undefined;
    const readUris: string[] = [];
    const resourceProvider: ToolResourceProvider = {
      listResources: () => [],
      listTemplates: () => [],
      read: async (uri: string) => {
        readUris.push(uri);
        return {
          contents: [{
            uri,
            mimeType: "text/markdown",
            text: "# Harness Resource\n\nHarness resource body.",
          }],
        };
      },
    };
    const builtinToolOptions = createSessionBuiltinToolOptions({
      resourceProviders: [resourceProvider],
    });
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-readonly",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-readonly-plan"],
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistryWithCapturedHarnessRun("codex", (options) => {
        capturedRun = options;
      }),
      surface: "gui",
      providerModelEligibility: observedProviderModels({
        codex: ["gpt-5.3-codex-spark"],
      }),
      builtinToolOptions: () => builtinToolOptions,
    });

    const route = result.managedInvocation?.routes[0];
    expect(route).toBeDefined();
    const profile = route?.profiles["foundation-readonly-plan"];
    expect(profile).toBeDefined();
    const service = result.managedInvocation?.invocationService ?? new RuntimeManagedAgentInvocationService();

    const invokeResult = await service.invoke(defineManagedAgentInvocationRequest({
      invocationId: "cli-harness-resource-1",
      agentId: "codex-readonly:foundation-readonly-plan",
      parentSessionId: "cli-parent-session",
      parentTurnId: "cli-parent-session:turn:1",
      profile: "foundation-readonly-plan",
      requestedBy: "assistant",
      requestSource: "test",
      providerRoute: {
        providerId: "codex",
        surface: "cli-harness",
        model: "gpt-5.3-codex-spark",
      },
      adapterKind: "harness",
      executionMode: "cli-harness",
      authority: {
        authorityProfileId: profile!.authorityProfileId,
        permissionProfile: profile!.permissionProfile,
        toolAuthority: {
          allowedToolNames: profile!.allowedToolNames,
          writeAllowed: profile!.writeAllowed === true,
          networkAllowed: profile!.networkAllowed === true,
        },
        workingDirectory: profile!.workingDirectory,
        timeoutMs: profile!.timeoutMs,
        credentialRoute: profile!.credentialRoute,
        memoryScope: profile!.memoryScope,
        ...(profile!.writeAuthority ? { writeAuthority: profile!.writeAuthority } : {}),
      },
      input: {
        summary: "Summarize current resource.",
        prompt: "Summarize the supplied resource.",
        resourceUris: ["kiln://test/current-harness-resource"],
        context: {
          mode: "resources",
        },
      },
    }), route!.adapter, {
      routeId: route!.routeId,
      routeSource: route!.routeSource,
    });

    expect(invokeResult.status).toBe("completed");
    expect(readUris).toEqual(["kiln://test/current-harness-resource"]);
    expect(capturedRun?.prompt).toBe("Summarize the supplied resource.");
    expect(capturedRun?.system).toContain("kiln://test/current-harness-resource");
    expect(capturedRun?.system).toContain("Harness resource body.");
  });

  it("normalizes explicit runtime-selected credential route ids for profiles and service keys", async () => {
    const result = await resolveManagedInvocationToolOptions({
      ...baseConfig({
        routes: [{
        id: "openai-readonly",
        kind: "direct",
        provider: "openai",
        model: "gpt-5.4-mini",
        profiles: ["foundation-readonly-plan"],
        credentials: {
          mode: "runtime-selected",
          routeId: " credential-route:openai:primary ",
          accountPolicyId: "managed-openai",
        },
      }],
      }),
      modelGateway: MANAGED_OPENAI_MODEL_GATEWAY,
    }, {
      cwd: "C:/repo",
      registry: createRegistry("openai"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      directAdapterFactory: () => makeDirectAdapter("openai"),
      managedAccountComposition: TEST_MANAGED_ACCOUNT_COMPOSITION,
    });

    expect(result.managedInvocation?.routes[0]?.profiles["foundation-readonly-plan"].credentialRoute).toEqual({
      mode: "account-leased",
      routeId: "credential-route:openai:primary",
      accountPolicyId: "managed-openai",
    });
    expect(result.managedInvocation?.invocationService).toBeDefined();
    expect(result.managedInvocation?.invocationServiceKey).toContain("credential-route:openai:primary");
    expect(result.managedInvocation?.invocationServiceKey).not.toContain(" credential-route:openai:primary ");
  });

  it("does not create a managed invocation service for credentialless routes without lease-backed resources", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-readonly",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-readonly-plan"],
        credentials: {
          mode: "credentialless",
        },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    });

    expect(result.managedInvocation?.invocationService).toBeUndefined();
    expect(result.managedInvocation?.invocationServiceKey).toBeUndefined();
  });

  it("admits direct sandbox working-directory routes with a shared sandbox lease manager", async () => {
    validateGlobalConfig(baseConfig({
      routes: [{
        id: "codex-oauth-sandbox-readonly",
        kind: "direct",
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        profiles: ["foundation-readonly-plan"],
        workingDirectory: "sandbox",
      }],
    }));

    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-oauth-sandbox-readonly",
        kind: "direct",
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        profiles: ["foundation-readonly-plan"],
        workingDirectory: "sandbox",
        tools: {
          allowed: ["read", "grep"],
          writes: false,
        },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex-oauth"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      directAdapterFactory: (route) => makeDirectAdapter(route.provider),
    });

    expect(result.routeHealth).toEqual([{
      routeId: "codex-oauth-sandbox-readonly",
      routeSource: "explicit-managed-route",
      kind: "direct",
      provider: "codex-oauth",
      model: "gpt-5.4-mini",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes[0]?.profiles["foundation-readonly-plan"]).toMatchObject({
      workingDirectory: {
        path: "C:/repo",
        mode: "sandbox",
      },
    });
    expect(result.managedInvocation?.invocationService).toBeDefined();
    expect(result.managedInvocation?.invocationServiceKey).toContain("sandboxPolicy");
  });

  it("keeps harness sandbox working-directory routes unavailable until harness sandbox proof exists", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-sandbox-readonly",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-readonly-plan"],
        workingDirectory: "sandbox",
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      includeUnavailableRoutes: true,
    });

    expect(result.routeHealth).toEqual([{
      routeId: "codex-sandbox-readonly",
      routeSource: "explicit-managed-route",
      kind: "harness",
      provider: "codex",
      model: "gpt-5.3-codex-spark",
      profiles: ["foundation-readonly-plan"],
      available: false,
      reason: "Harness sandbox working-directory routes require live-proven sandbox enforcement.",
    }]);
    expect(result.managedInvocation?.routes).toEqual([]);
    expect(result.managedInvocation?.unavailableRoutes).toContainEqual(expect.objectContaining({
      routeId: "codex-sandbox-readonly",
      reason: "Harness sandbox working-directory routes require live-proven sandbox enforcement.",
    }));
  });

  it("resolves explicit remote harness sandbox routes with endpoint-backed limitations", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-cloud-remote-readonly",
        kind: "harness",
        provider: "codex-cloud",
        model: "gpt-5.5",
        profiles: ["foundation-readonly-plan"],
        workingDirectory: "sandbox",
        remoteHarness: {
          invokeUrl: "https://remote.example.test/managed-agent/invoke",
          cancelUrl: "https://remote.example.test/managed-agent/cancel",
          authTokenEnv: "KILN_REMOTE_HARNESS_TOKEN",
          limitations: [
            "Remote harness reports aggregate token classes only.",
            "Remote harness cannot expose local live terminal streaming.",
          ],
        },
      }],
    }), {
      cwd: "C:/repo",
      registry: new SessionRegistry([]),
      surface: "gui",
    });

    expect(result.routeHealth).toEqual([{
      routeId: "codex-cloud-remote-readonly",
      routeSource: "explicit-managed-route",
      kind: "harness",
      provider: "codex-cloud",
      model: "gpt-5.5",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes[0]).toMatchObject({
      routeId: "codex-cloud-remote-readonly",
      providerId: "codex-cloud",
      model: "gpt-5.5",
      surface: "remote-harness",
      providerModelProof: {
        status: "configured",
        source: "remote-harness-config",
        requiresToolCalls: false,
      },
    });
    expect(result.managedInvocation?.routes[0]?.taskSuitability).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: expect.arrayContaining([
            expect.objectContaining({
              source: "configured-route",
              status: "declared",
            }),
          ]),
        }),
      ]),
    );
    expect(JSON.stringify(result.managedInvocation?.routes[0]?.taskSuitability)).not.toContain("\"source\":\"live-proof\"");
    expect(result.managedInvocation?.routes[0]?.adapter.descriptor).toMatchObject({
      adapterKind: "harness",
      providerId: "codex-cloud",
      supportedExecutionModes: ["remote-harness"],
      limitations: [
        "Remote harness reports aggregate token classes only.",
        "Remote harness cannot expose local live terminal streaming.",
      ],
    });
    expect(result.managedInvocation?.routes[0]?.profiles["foundation-readonly-plan"]).toMatchObject({
      workingDirectory: {
        path: "C:/repo",
        mode: "sandbox",
      },
    });
    expect(result.managedInvocation?.invocationService).toBeDefined();
    expect(result.managedInvocation?.invocationServiceKey).toContain("sandboxPolicy");
  });

  it("keeps policy-owned harness routes adapter-free during candidate admission", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      schemaVersion: 2,
      economicPolicies: [{
        id: "bounded-policy",
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
        candidates: ["local-harness", "remote-harness"].map((routeId, priorityRank) => ({
          routeId,
          comparisonDomainId: "priority-only",
          priorityRank,
          ceiling: { kind: "none" as const },
          worstCaseReservation: { kind: "not-comparable" as const, reason: "economic-basis-unavailable" as const },
        })),
      }],
      routes: [{
        id: "local-harness",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-readonly-plan"],
      }, {
        id: "remote-harness",
        kind: "harness",
        provider: "codex-cloud",
        model: "gpt-5.5",
        profiles: ["foundation-readonly-plan"],
        workingDirectory: "sandbox",
        remoteHarness: {
          invokeUrl: "https://remote.example.test/managed-agent/invoke",
          cancelUrl: "https://remote.example.test/managed-agent/cancel",
        },
      }],
    }), {
      cwd: "C:/repo",
      userHome: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      compositionMode: "candidate-admission",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    });

    expect(result.managedInvocation?.routes).toHaveLength(2);
    expect(result.managedInvocation?.routes.map((route) => ({
      routeId: route.routeId,
      adapter: route.adapter,
      createCommittedAdapter: route.createCommittedAdapter,
      economicCapability: route.economicCapability,
    }))).toEqual([
      {
        routeId: "local-harness",
        adapter: undefined,
        createCommittedAdapter: undefined,
        economicCapability: { status: "unverified" },
      },
      {
        routeId: "remote-harness",
        adapter: undefined,
        createCommittedAdapter: undefined,
        economicCapability: { status: "unverified" },
      },
    ]);
  });

  it("exposes canonical agent profiles as managed invocation selection catalog", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-managed-agent-catalog-"));
    try {
      const agentsDir = join(root, ".kiln", "agents");
      const testSkillDir = join(root, ".kiln", "skills", "test-generator");
      const repoReviewSkillDir = join(root, ".kiln", "skills", "repo-review");
      mkdirSync(agentsDir, { recursive: true });
      mkdirSync(testSkillDir, { recursive: true });
      mkdirSync(repoReviewSkillDir, { recursive: true });
      writeFileSync(
        join(agentsDir, "tdd.md"),
        [
          "---",
          "name: tdd",
          "displayName: Malcolm",
          "nicknameCandidates:",
          "  - tdd-guide",
          "role: TDD guide",
          "goal: Write tests before behavior changes",
          "tier: reasoning",
          "taskAffinity:",
          "  - test-writing",
          "skills:",
          "  - test-generator",
          "---",
          "Write failing tests first.",
          "",
        ].join("\n"),
        "utf-8",
      );
      writeFileSync(
        join(testSkillDir, "SKILL.md"),
        [
          "---",
          "name: test-generator",
          "description: Generate focused tests.",
          "tags:",
          "  - test",
          "---",
          "",
          "Write tests.",
          "",
        ].join("\n"),
        "utf-8",
      );
      writeFileSync(
        join(repoReviewSkillDir, "SKILL.md"),
        [
          "---",
          "name: repo-review",
          "description: Review repository evidence.",
          "tags:",
          "  - review",
          "---",
          "",
          "Review repo facts.",
          "",
        ].join("\n"),
        "utf-8",
      );
      const codexLocalSkillDir = join(root, ".codex", "skills", "shadcn");
      mkdirSync(codexLocalSkillDir, { recursive: true });
      writeFileSync(
        join(codexLocalSkillDir, "SKILL.md"),
        [
          "---",
          "name: shadcn",
          "description: Native Codex-local shadcn skill.",
          "---",
          "",
          "Native only.",
          "",
        ].join("\n"),
        "utf-8",
      );

      const result = await resolveManagedInvocationToolOptions(baseConfig({
        routes: [{
          id: "codex-readonly",
          kind: "harness",
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          profiles: ["foundation-readonly-plan"],
        }],
      }), {
        cwd: root,
        userHome: root,
        registry: createRegistry("codex"),
        surface: "gui",
        providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      });

      expect(result.managedInvocation?.agentCatalog).toContainEqual(expect.objectContaining({
        name: "tdd",
        displayName: "Malcolm",
        nicknameCandidates: ["tdd-guide"],
        role: "TDD guide",
        goal: "Write tests before behavior changes",
        tier: "reasoning",
        taskAffinity: ["test-writing"],
        skills: ["test-generator"],
      }));
      expect(result.managedInvocation?.skillCatalog).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: "repo-review",
          description: "Review repository evidence.",
          origin: "project",
          configured: true,
          tags: ["review"],
          admission: expect.objectContaining({ state: "available" }),
        }),
        expect.objectContaining({
          name: "test-generator",
          description: "Generate focused tests.",
          origin: "project",
          configured: true,
          tags: ["test"],
        }),
        expect.objectContaining({
          name: "managed-agent-risk-review",
          origin: "builtin",
          configured: true,
        }),
        expect.objectContaining({
          name: "shadcn",
          origin: "native-harness",
          configured: false,
          omissionReason: "native-harness-local-only",
        }),
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects missing or widening schema-v2 agent policy bindings before adapter construction", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-agent-policy-"));
    try {
      const agentsDir = join(root, ".kiln", "agents");
      mkdirSync(agentsDir, { recursive: true });
      const agentPath = join(agentsDir, "economic-worker.md");
      const writeAgent = (policyLine: string, routeLine = "") => writeFileSync(agentPath, [
        "---",
        "name: economic-worker",
        "role: Economic managed worker",
        "goal: Execute only policy-admitted work.",
        "tier: reasoning",
        "mode: managed-child",
        policyLine,
        routeLine,
        "---",
        "Remain within the configured economic policy.",
      ].filter(Boolean).join("\n"));
      const economicPolicies = [{
        id: "bounded-policy",
        revision: "rev-1",
        evidenceRequirements: { quota: "optional" as const, price: "optional" as const },
        noRouteAction: "deny" as const,
        comparisonDomains: [{
          id: "priority-only",
          rank: 0,
          unit: "request",
          scheme: { kind: "unit" as const },
          rateCardBasis: "configured",
          envelopeSemantics: "bounded",
        }],
        candidates: [{
          routeId: "admitted-route",
          comparisonDomainId: "priority-only",
          priorityRank: 0,
          ceiling: { kind: "none" as const },
          worstCaseReservation: { kind: "not-comparable" as const, reason: "economic-basis-unavailable" as const },
        }],
      }];
      const config = baseConfig({
        schemaVersion: 2,
        economicPolicies,
        routes: [{
          id: "admitted-route",
          kind: "direct",
          provider: "codex-oauth",
          model: "gpt-5.4-mini",
          profiles: ["foundation-readonly-plan"],
        }],
      });
      let adapterConstructions = 0;
      const resolve = () => resolveManagedInvocationToolOptions(config, {
        cwd: root,
        userHome: root,
        registry: createRegistry("codex-oauth"),
        surface: "gui",
        providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
        directAdapterFactory: (route) => {
          adapterConstructions += 1;
          return makeDirectAdapter(route.provider);
        },
      });

      writeAgent("");
      const missing = await resolve();
      expect(missing.agentHealth).toContainEqual(expect.objectContaining({
        agentName: "economic-worker",
        available: false,
        reason: expect.stringContaining("economicPolicyId"),
      }));
      expect(adapterConstructions).toBe(0);

      writeAgent("economicPolicyId: bounded-policy", "routeId: outside-policy");
      const widening = await resolve();
      expect(widening.agentHealth).toContainEqual(expect.objectContaining({
        agentName: "economic-worker",
        available: false,
        reason: expect.stringContaining("not admitted"),
      }));
      expect(adapterConstructions).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("consumes a valid schema-v2 agent policy binding without selecting a route hint", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-agent-policy-valid-"));
    try {
      const agentsDir = join(root, ".kiln", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "economic-worker.md"), [
        "---",
        "name: economic-worker",
        "role: Economic managed worker",
        "goal: Execute only policy-admitted work.",
        "tier: reasoning",
        "mode: managed-child",
        "economicPolicyId: bounded-policy",
        "---",
        "Remain within the configured economic policy.",
      ].join("\n"));
      const result = await resolveManagedInvocationToolOptions(baseConfig({
        schemaVersion: 2,
        economicPolicies: [{
          id: "bounded-policy",
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
            routeId: "admitted-route",
            comparisonDomainId: "priority-only",
            priorityRank: 0,
            ceiling: { kind: "none" },
            worstCaseReservation: { kind: "not-comparable", reason: "economic-basis-unavailable" },
          }],
        }],
        routes: [{
          id: "admitted-route",
          kind: "direct",
          provider: "codex-oauth",
          model: "gpt-5.4-mini",
          profiles: ["foundation-readonly-plan"],
        }],
      }), {
        cwd: root,
        userHome: root,
        registry: createRegistry("codex-oauth"),
        surface: "gui",
        providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
        directAdapterFactory: (route) => makeDirectAdapter(route.provider),
      });

      expect(result.managedInvocation?.agentCatalog).toContainEqual(expect.objectContaining({
        name: "economic-worker",
      }));
      const agent = result.managedInvocation?.agentCatalog?.find((candidate) => candidate.name === "economic-worker");
      expect(agent).not.toHaveProperty("routeId");
      expect(agent).not.toHaveProperty("providerRoute");
      expect(result.managedInvocation?.agentCatalog?.map((candidate) => candidate.name)).toEqual(["economic-worker"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a committed route mismatch before constructing its adapter", async () => {
    const directAdapterFactory = vi.fn((route) => makeDirectAdapter(route.provider));
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      schemaVersion: 2,
      economicPolicies: [{
        id: "bounded-policy",
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
          routeId: "admitted-route",
          comparisonDomainId: "priority-only",
          priorityRank: 0,
          ceiling: { kind: "none" },
          worstCaseReservation: { kind: "not-comparable", reason: "economic-basis-unavailable" },
        }],
      }],
      routes: [{
        id: "admitted-route",
        kind: "direct",
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        profiles: ["foundation-readonly-plan"],
      }],
    }), {
      cwd: "C:/repo",
      userHome: "C:/repo",
      registry: createRegistry("codex-oauth"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      directAdapterFactory,
    });
    const createCommittedAdapter = result.managedInvocation?.routes[0]?.createCommittedAdapter;
    expect(createCommittedAdapter).toBeDefined();
    expect(directAdapterFactory).not.toHaveBeenCalled();

    await expect(createCommittedAdapter!({
      commitment: {
        reservation: {
          selectedIdentity: {
            route: { routeId: "wrong route <secret>", providerId: "other provider", modelId: "other model" },
          },
        },
      },
      dispatchFenceId: "dispatch-fence:test",
    } as never)).rejects.toMatchObject({
      code: "committed-route-mismatch",
      message: "Committed managed route does not match the configured execution route.",
      evidence: {
        code: "committed-route-mismatch",
        expected: { routeId: "admitted-route", providerId: "codex-oauth", modelId: "gpt-5.4-mini" },
        committed: { routeId: "wrong-route-secret", providerId: "other-provider", modelId: "other-model" },
      },
    });
    expect(directAdapterFactory).not.toHaveBeenCalled();
  });

  it("projects agent route hints from configured task suitability without model-name heuristics", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-route-suitability-"));
    try {
      const agentsDir = join(root, ".kiln", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "bounded-scout.md"), [
        "---",
        "name: bounded-scout",
        "role: Repository scout",
        "goal: Collect bounded repository evidence.",
        "tier: fast",
        "taskAffinity:",
        "  - mechanical-edit",
        "---",
        "Collect bounded evidence without modifying files.",
      ].join("\n"));
      const result = await resolveManagedInvocationToolOptions(baseConfig({
        routes: [{
          id: "codex-oauth-reasoning-readonly",
          kind: "direct",
          provider: "codex-oauth",
          model: "gpt-5.5",
          profiles: ["foundation-readonly-plan"],
          taskSuitability: [{ task: "mechanical-edit", level: "limited" }],
        }, {
          id: "codex-oauth-bounded-readonly",
          kind: "direct",
          provider: "codex-oauth",
          model: "gpt-5.4-mini",
          profiles: ["foundation-readonly-plan"],
          taskSuitability: [{ task: "mechanical-edit", level: "preferred" }],
        }],
      }), {
        cwd: root,
        registry: createRegistry("codex-oauth"),
        surface: "gui",
        providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
        directAdapterFactory: (route) => makeDirectAdapter(route.provider),
      });

      expect(result.managedInvocation?.agentCatalog).toContainEqual(expect.objectContaining({
        name: "bounded-scout",
        routeId: "codex-oauth-bounded-readonly",
        providerRoute: {
          providerId: "codex-oauth",
          model: "gpt-5.4-mini",
        },
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("binds an explicit visual read-only route to a matching agent profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-visual-route-"));
    try {
      const agentsDir = join(root, ".kiln", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, "visual-researcher.md"),
        [
          "---",
          "name: visual-researcher",
          "displayName: Kimi",
          "role: Visual reference research specialist",
          "goal: Collect real product UI evidence before frontend implementation.",
          "tier: reasoning",
          "routeId: opencode-go-kimi-k2-6-readonly",
          "providerRoute:",
          "  providerId: opencode-go",
          "  model: kimi-k2.6",
          "taskAffinity:",
          "  - frontend-design",
          "  - research",
          "---",
          "Collect visual evidence.",
          "",
        ].join("\n"),
        "utf-8",
      );

      const result = await resolveManagedInvocationToolOptions({
        version: "1",
        engines: {
          "opencode-go": { enabled: true, billing: "subscription" },
        },
        routing: {
          routes: [
            {
              provider: "opencode-go",
              model: "kimi-k2.6",
            },
            {
              provider: "opencode-go",
              model: "qwen3.6-plus",
            },
          ],
        },
        managedAgents: {
          enabled: true,
          routes: [{
            id: "opencode-go-kimi-k2-6-readonly",
            kind: "direct",
            provider: "opencode-go",
            model: "kimi-k2.6",
            profiles: ["foundation-readonly-plan"],
            credentials: { mode: "credentialless" },
            tools: {
              allowed: ["read", "tree", "grep", "glob", "web_search", "web_fetch", "browser_session_start", "browser_navigate", "browser_observe"],
              network: true,
              writes: false,
            },
          }],
        },
      }, {
        cwd: root,
        userHome: root,
        registry: createRegistryForProviders([{ provider: "opencode-go" }]),
        surface: "gui",
        providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
        directAdapterFactory: (route) => makeDirectAdapter(route.provider),
      });

      const visualRoute = result.managedInvocation?.routes.find((route) =>
        route.routeId === "opencode-go-kimi-k2-6-readonly"
      );
      expect(result.managedInvocation?.routes.filter((route) =>
        route.routeId === "opencode-go-kimi-k2-6-readonly"
      )).toHaveLength(1);
      expect(visualRoute?.profiles["foundation-readonly-plan"]).toMatchObject({
        allowedToolNames: ["read", "tree", "grep", "glob", "web_search", "web_fetch", "browser_session_start", "browser_navigate", "browser_observe"],
        networkAllowed: true,
      });
      expect(result.managedInvocation?.agentCatalog).toContainEqual(expect.objectContaining({
        name: "visual-researcher",
        routeId: "opencode-go-kimi-k2-6-readonly",
        providerRoute: {
          providerId: "opencode-go",
          model: "kimi-k2.6",
        },
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps explicit routes unhealthy when their engine is disabled", async () => {
    const result = await resolveManagedInvocationToolOptions({
      ...baseConfig({
        routes: [{
          id: "codex-readonly",
          kind: "harness",
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          profiles: ["foundation-readonly-plan"],
        }],
      }),
      engines: {
        codex: { enabled: false, billing: "plus-quota" },
      },
    }, {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth[0]).toMatchObject({
      routeId: "codex-readonly",
      available: false,
      reason: "Provider 'codex' is disabled in engine config.",
    });
  });

  it("fails closed when the provider is unavailable", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-readonly",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-readonly-plan"],
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex", false),
      surface: "gui",
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth).toEqual([{
      routeId: "codex-readonly",
      routeSource: "explicit-managed-route",
      kind: "harness",
      provider: "codex",
      model: "gpt-5.3-codex-spark",
      profiles: ["foundation-readonly-plan"],
      available: false,
      reason: "Provider 'codex' is unavailable.",
    }]);
  });

  it("keeps direct routes unhealthy until the direct provider adapter slice exists", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "openai-readonly",
        kind: "direct",
        provider: "openai",
        model: "gpt-5.4-mini",
        profiles: ["foundation-readonly-plan"],
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("openai"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth[0]).toMatchObject({
      routeId: "openai-readonly",
      kind: "direct",
      provider: "openai",
      available: false,
      reason: "Direct managed invocation routes require the direct provider managed runtime adapter.",
    });
  });

  it("resolves direct routes when the host supplies a direct runtime adapter factory", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "openai-readonly",
        kind: "direct",
        provider: "openai",
        model: "gpt-5.4-mini",
        profiles: ["foundation-readonly-plan"],
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("openai"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      directAdapterFactory: () => makeDirectAdapter(),
    });

    expect(result.routeHealth).toEqual([{
      routeId: "openai-readonly",
      routeSource: "explicit-managed-route",
      kind: "direct",
      provider: "openai",
      model: "gpt-5.4-mini",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes[0]?.adapter.descriptor).toMatchObject({
      adapterKind: "direct",
      providerId: "openai",
    });
    expect(result.managedInvocation?.routes[0]?.surface).toBe("direct-provider");
  });

  it("resolves explicit Codex OAuth auto-review routes when direct discovery advertises the model", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-oauth-auto-review-readonly",
        kind: "direct",
        provider: "codex-oauth",
        model: "codex-auto-review",
        profiles: ["foundation-readonly-plan"],
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex-oauth"),
      surface: "gui",
      providerModelEligibility: observedProviderModels({
        "codex-oauth": ["gpt-5.5", "codex-auto-review"],
      }),
      directAdapterFactory: (route) => makeDirectAdapter(route.provider),
    });

    expect(result.routeHealth).toEqual([{
      routeId: "codex-oauth-auto-review-readonly",
      routeSource: "explicit-managed-route",
      kind: "direct",
      provider: "codex-oauth",
      model: "codex-auto-review",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes[0]).toMatchObject({
      routeId: "codex-oauth-auto-review-readonly",
      providerId: "codex-oauth",
      model: "codex-auto-review",
      surface: "direct-provider",
    });
  });

  it("rejects write-capable routes without explicit write authority", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-write",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.4",
        profiles: ["foundation-apply-approved-writes"],
        tools: {
          allowed: ["read", "grep", "write"],
          writes: true,
        },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth[0]).toMatchObject({
      routeId: "codex-write",
      available: false,
      reason: "Write-capable managed invocation routes require explicit writeAuthority scope and approval config.",
    });
  });

  it("rejects Claude write routes even when configuration requests write authority", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "claude-write",
        kind: "harness",
        provider: "claude",
        model: "default",
        profiles: ["foundation-apply-approved-writes"],
        tools: { allowed: ["read", "write"], writes: true },
        writeAuthority: {
          workspace: { mode: "apply-approved", allowedPaths: ["packages"] },
          memory: { mode: "none", operations: [] },
          artifacts: { mode: "none", resourceUris: [], retention: "session" },
          tools: { allowed: ["read", "write"], denied: [] },
          approval: { mode: "required-before-apply" },
        },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("claude"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth[0]).toMatchObject({
      routeId: "claude-write",
      available: false,
      reason: "Provider 'claude' does not have live-proven write evidence support.",
    });
  });

  it("keeps a managed Claude route closed when no operator Claude Code executable resolves", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "claude-readonly",
        kind: "harness",
        provider: "claude",
        model: "default",
        profiles: ["foundation-readonly-plan"],
        tools: { allowed: ["read"], writes: false },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("claude"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      resolveClaudeExecutable: () => undefined,
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth[0]).toMatchObject({
      routeId: "claude-readonly",
      available: false,
      reason: "Claude Code executable was not found; a managed Claude child must not run the Agent SDK bundled build.",
    });
  });

  it("advances past executable binding once the operator Claude Code executable resolves", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "claude-readonly",
        kind: "harness",
        provider: "claude",
        model: "claude-fable-5[1m]",
        profiles: ["foundation-readonly-plan"],
        tools: { allowed: ["read"], writes: false },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("claude"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      resolveClaudeExecutable: () => ({
        path: "C:/tools/claude.exe",
        evidence: {
          executable: "<operator-harness>/claude.exe",
          version: "2.1.220",
        },
      }),
    });

    // The route still fails, but on the live-proof allowlist rather than on
    // executable binding.  Claude stays fail-closed until its own live proof.
    expect(result.routeHealth[0]).toMatchObject({
      routeId: "claude-readonly",
      available: false,
      reason: "Provider 'claude' model 'claude-fable-5[1m]' does not have live-proven read-only managed result handoff support for foundation-readonly-plan.",
    });
  });

  it.each([
    ["claude-sonnet-readonly", "claude-sonnet-5"],
    ["claude-opus-readonly", "claude-opus-5"],
    ["claude-haiku-readonly", "claude-haiku-4-5-20251001"],
  ])("admits the exact live-proven Claude read-only route %s", async (routeId, model) => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: routeId,
        kind: "harness",
        provider: "claude",
        model,
        profiles: ["foundation-readonly-plan"],
        tools: { allowed: ["read"], writes: false },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("claude"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      resolveClaudeExecutable: () => ({
        path: "C:/tools/claude.exe",
        evidence: {
          executable: "<operator-harness>/claude.exe",
          version: "2.1.220",
        },
      }),
    });

    expect(result.routeHealth).toEqual([{
      routeId,
      routeSource: "explicit-managed-route",
      kind: "harness",
      provider: "claude",
      model,
      profiles: ["foundation-readonly-plan"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes[0]).toMatchObject({
      routeId,
      providerId: "claude",
      model,
      surface: "cli-harness",
    });
  });

  it.each(["default", "sonnet", "opus", "haiku"])(
    "rejects the moving Claude model alias '%s' before live-proof admission",
    async (model) => {
      const result = await resolveManagedInvocationToolOptions(baseConfig({
        routes: [{
          id: "claude-readonly",
          kind: "harness",
          provider: "claude",
          model,
          profiles: ["foundation-readonly-plan"],
          tools: { allowed: ["read"], writes: false },
        }],
      }), {
        cwd: "C:/repo",
        registry: createRegistry("claude"),
        surface: "gui",
        providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
        resolveClaudeExecutable: () => ({
          path: "C:/tools/claude.exe",
          evidence: {
            executable: "<operator-harness>/claude.exe",
            version: "2.1.220",
          },
        }),
      });

      expect(result.routeHealth[0]).toMatchObject({
        available: false,
        reason: `Provider 'claude' model '${model}' is a moving alias and cannot carry live-proof admission.`,
      });
    },
  );

  it("resolves explicit live-proven harness routes for approved workspace writes", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-approved-write",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-apply-approved-writes"],
        tools: {
          allowed: ["read", "grep", "apply-patch"],
          writes: true,
        },
        memory: { access: "write-proposals" },
        writeAuthority: {
          workspace: {
            mode: "apply-approved",
            allowedPaths: ["packages/cli/src/config"],
          },
          memory: {
            mode: "propose",
            operations: ["create", "update"],
          },
          artifacts: {
            mode: "propose",
            resourceUris: ["kiln://artifacts/managed-agent-write/codex-approved-write"],
            retention: "session",
          },
          tools: {
            allowed: ["read", "grep", "apply-patch"],
            denied: ["git-commit"],
          },
          approval: {
            mode: "required-before-apply",
          },
        },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
    });

    expect(result.routeHealth).toEqual([{
      routeId: "codex-approved-write",
      routeSource: "explicit-managed-route",
      kind: "harness",
      provider: "codex",
      model: "gpt-5.3-codex-spark",
      profiles: ["foundation-apply-approved-writes"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes[0]?.adapter.descriptor).toMatchObject({
      supportedProfiles: [
        "foundation-readonly-plan",
        "foundation-propose-writes",
        "foundation-apply-approved-writes",
        "foundation-memory-write-proposals",
      ],
      writeAuthority: {
        proposalSupported: true,
        approvedApplySupported: true,
        rollbackEvidence: true,
        cleanupEvidence: true,
        scopeReduction: true,
      },
    });
    expect(result.managedInvocation?.routes[0]?.profiles["foundation-apply-approved-writes"]).toMatchObject({
      authorityProfileId: "authority:codex-approved-write:foundation-apply-approved-writes",
      permissionProfile: "apply-approved-writes",
      writeAllowed: true,
      workingDirectory: {
        path: "C:/repo",
        mode: "workspace-write",
      },
      memoryScope: {
        access: "write-proposals",
      },
      writeAuthority: {
        profile: "foundation-apply-approved-writes",
        scope: {
          workspace: {
            mode: "apply-approved",
            allowedPaths: ["C:\\repo\\packages\\cli\\src\\config"],
            deniedPaths: [
              "C:\\repo\\.git",
              "C:\\repo\\node_modules",
              "C:\\repo\\.kiln",
              "C:\\repo\\packages\\cli\\src\\config\\.git",
              "C:\\repo\\packages\\cli\\src\\config\\node_modules",
              "C:\\repo\\packages\\cli\\src\\config\\.kiln",
            ],
          },
          memory: {
            mode: "propose",
            operations: ["create", "update"],
          },
          artifacts: {
            mode: "propose",
            resourceUris: ["kiln://artifacts/managed-agent-write/codex-approved-write"],
            retention: "session",
          },
          tools: {
            allowedToolNames: ["read", "grep", "apply-patch"],
            deniedToolNames: ["git-commit"],
          },
        },
        approval: {
          mode: "required-before-apply",
          evidenceRequired: true,
        },
      },
    });
  });

  it("resolves explicit live-proven direct provider routes for approved workspace writes", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "codex-oauth-approved-write",
        kind: "direct",
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
        profiles: ["foundation-apply-approved-writes"],
        tools: {
          allowed: ["read", "write"],
          writes: true,
        },
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
    }), {
      cwd: "C:/repo",
      registry: createRegistry("codex-oauth"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      directAdapterFactory: (route) => makeDirectAdapter(route.provider, true),
    });

    expect(result.routeHealth).toEqual([{
      routeId: "codex-oauth-approved-write",
      routeSource: "explicit-managed-route",
      kind: "direct",
      provider: "codex-oauth",
      model: "gpt-5.4-mini",
      profiles: ["foundation-apply-approved-writes"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes[0]?.adapter.descriptor).toMatchObject({
      adapterKind: "direct",
      supportedProfiles: [
        "foundation-readonly-plan",
        "foundation-propose-writes",
        "foundation-apply-approved-writes",
        "foundation-memory-write-proposals",
      ],
      writeAuthority: LIVE_PROVEN_DIRECT_WRITE_AUTHORITY,
    });
    expect(result.managedInvocation?.routes[0]?.profiles["foundation-apply-approved-writes"]).toMatchObject({
      permissionProfile: "apply-approved-writes",
      writeAllowed: true,
      workingDirectory: {
        path: "C:/repo",
        mode: "workspace-write",
      },
      writeAuthority: {
        scope: {
          workspace: {
            mode: "apply-approved",
            allowedPaths: ["C:\\repo\\packages\\cli\\src\\config"],
            deniedPaths: [
              "C:\\repo\\.git",
              "C:\\repo\\node_modules",
              "C:\\repo\\.kiln",
              "C:\\repo\\packages\\cli\\src\\config\\.git",
              "C:\\repo\\packages\\cli\\src\\config\\node_modules",
              "C:\\repo\\packages\\cli\\src\\config\\.kiln",
            ],
          },
        },
      },
    });
  });

  it("marks approved-write routes with network authority unavailable so visual research must use a separate read-only route", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      routes: [{
        id: "opencode-go-frontend-approved-write",
        kind: "direct",
        provider: "opencode-go",
        model: "kimi-k2.6",
        profiles: ["foundation-apply-approved-writes"],
        tools: {
          allowed: ["read", "web_search", "browser_observe", "write"],
          network: true,
          writes: true,
        },
        writeAuthority: {
          workspace: {
            mode: "apply-approved",
            allowedPaths: ["."],
          },
          approval: {
            mode: "required-before-apply",
          },
        },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("opencode-go"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      includeUnavailableRoutes: true,
      directAdapterFactory: (route) => makeDirectAdapter(route.provider, true),
    });

    expect(result.managedInvocation?.routes).toEqual([]);
    expect(result.managedInvocation?.unavailableRoutes).toEqual([{
      routeId: "opencode-go-frontend-approved-write",
      routeSource: "explicit-managed-route",
      providerId: "opencode-go",
      model: "kimi-k2.6",
      profiles: ["foundation-apply-approved-writes"],
      reason: "foundation-apply-approved-writes routes cannot enable tools.network. Use a separate foundation-readonly-plan route for web, browser, computer-use, or visual-reference research phases.",
    }]);
  });
});
