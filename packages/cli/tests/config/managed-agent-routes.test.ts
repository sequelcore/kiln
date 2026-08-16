import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defineExecutionCatalog,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
  type DeliberationResolution,
  deriveProviderModelEligibility,
  type ManagedAgentInvocationRequest,
  type ProviderModelEligibilityRequirements,
  type ProviderModelEvidenceFreshness,
} from "@kilnai/core/agents";
import { createSessionBuiltinToolOptions, type ToolResourceProvider } from "@kilnai/core/tools";
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
  projectManagedEconomicJobAdoption,
  resolveManagedInvocationToolOptions,
} from "../../src/config/managed-agent-routes.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "../../src/config/managed-agent-provider-models.js";
import {
  normalizeRuntimeProviderDiscoveryCatalog,
  RuntimeManagedAgentInvocationService,
  type ManagedAgentRuntimeAdapter,
  type ManagedInvocationToolRoute,
} from "@kilnai/runtime";

function profileByAdmission(
  route: ManagedInvocationToolRoute | undefined,
  admissionProfile: string,
) {
  return route?.profiles.find((profile) => profile.admissionProfile === admissionProfile);
}

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

function withDiscoveredDeliberation(
  diagnostics: ManagedAgentProviderModelCatalogDiagnostics,
  provider: string,
  model: string,
): ManagedAgentProviderModelCatalogDiagnostics {
  const entry = diagnostics[provider]?.[model];
  if (!entry) throw new Error(`Missing fixture diagnostic for ${provider}/${model}.`);
  return {
    ...diagnostics,
    [provider]: {
      ...diagnostics[provider],
      [model]: {
        ...entry,
        provenProfiles: ["foundation-readonly-plan"],
        deliberationCapabilities: {
          provider,
          model,
          levels: [{ id: "low" }, { id: "high" }],
          defaultLevel: "high",
          supportsAdaptive: true,
        evidence: {
            sourceIdentity: provider === "claude"
              ? "claude-code-model-catalog"
              : "opencode-cli-model-catalog",
            sourceRevision: provider === "claude" ? "2.1.226" : "1.18.16:catalog-fixture",
            observedAt: FIXTURE_OBSERVED_AT,
          },
        },
      },
    },
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
    deliberationTransport: provider === "claude" || provider === "codex" ? "native-level" : "none",
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
  captureRun: (options: {
    readonly system?: string;
    readonly prompt: string;
    readonly deliberationResolution?: DeliberationResolution;
  }) => void,
  captureConfig?: (config: ProviderCreateConfig) => void,
): SessionRegistry {
  const descriptor: SessionProviderDescriptor = {
    id: provider,
    deliberationTransport: provider === "claude" || provider === "codex" ? "native-level" : "none",
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
    create: (config: ProviderCreateConfig) => {
      captureConfig?.(config);
      return {
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
        async *run(options: {
          readonly system?: string;
          readonly prompt: string;
          readonly deliberationResolution?: DeliberationResolution;
        }) {
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
      };
    },
  };
  return new SessionRegistry([descriptor]);
}

type AuthorityProfileFixture = NonNullable<KilnGlobalConfig["authorityProfiles"]>[number];
type ManagedTargetFixture = {
  readonly id: string;
  readonly kind: "direct" | "harness";
  readonly provider?: string;
  readonly model?: string;
  readonly profiles?: readonly AuthorityProfileFixture["admissionProfile"][];
  readonly workingDirectory?: AuthorityProfileFixture["workingDirectory"];
  readonly timeoutMs?: number;
  readonly tools?: AuthorityProfileFixture["tools"];
  readonly memory?: AuthorityProfileFixture["memory"];
  readonly readAuthority?: AuthorityProfileFixture["readAuthority"];
  readonly writeAuthority?: AuthorityProfileFixture["writeAuthority"];
  readonly remoteHarness?: NonNullable<KilnGlobalConfig["targetCatalog"]>["targets"][number] extends infer _Target
    ? import("../../src/kiln-yaml-types.js").KilnManagedAgentRemoteHarnessConfig
    : never;
  readonly externalRuntimeAttachment?: import("../../src/kiln-yaml-types.js").KilnManagedAgentExternalRuntimeAttachmentConfig;
};

type ManagedConfigFixture = Omit<NonNullable<KilnGlobalConfig["managedAgents"]>, "defaultAuthorityProfileId"> & {
  readonly targetFixtures?: readonly ManagedTargetFixture[];
};

function baseConfig(overrides: ManagedConfigFixture = {}): KilnGlobalConfig {
  const { targetFixtures = [], ...managedAgents } = overrides;
  const directTargets = targetFixtures.filter((target) => target.kind === "direct");
  const executionCatalog = defineExecutionCatalog({
    accounts: directTargets.map((target) => {
      const targetId = target.id;
      const identity = testExecutionIdentity(targetId);
      return {
        id: `account:${targetId}`,
        providerId: identity.providerId,
        credentialId: `credential:${targetId}`,
        maxConcurrency: 1,
        reservedAffinitySlots: 0,
        economics: {
          capacityIdentity: `capacity:${targetId}`,
          subscriptionClass: "subscription",
          quotaClassId: `quota:${targetId}`,
          creditPosture: "disabled" as const,
          overagePosture: "disabled" as const,
        },
      };
    }),
    accountPolicies: directTargets.map((target) => ({
      id: `policy:${target.id}`,
      accountIds: [`account:${target.id}`],
      strategy: "economic-least-pressure" as const,
    })),
    routes: directTargets.map((target) => {
      const targetId = target.id;
      const identity = testExecutionIdentity(targetId);
      return {
        id: targetId,
        label: targetId,
        providerId: identity.providerId,
        providerModelId: identity.providerModelId,
        dataClassification: "internal" as const,
        dataPolicyEvidence: {
          providerId: identity.providerId,
          providerModelId: identity.providerModelId,
          dataUse: "not-used" as const,
          trainingPosture: "prohibited" as const,
          retention: { posture: "zero" as const, days: 0 },
          permittedMaximumClassification: "internal" as const,
          permittedClassifications: ["public", "internal"] as const,
          sourceIdentity: "fixture-privacy",
          sourceRevision: "rev-1",
          sourceDigest: `sha256:${"f".repeat(64)}` as const,
          observedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2027-01-01T00:00:00.000Z",
        },
        accountSelection: {
          mode: "automatic" as const,
          accountPolicyId: `policy:${targetId}`,
        },
        economics: {
          adapterCapabilityId: "test-direct-adapter",
          adapterCapabilityVersion: "1",
          authBillingChannel: "test",
          executionMode: "direct",
          serviceTier: "test",
          rateCardBasis: "configured",
          envelopeSemantics: "bounded",
          fallbackPosture: "disabled" as const,
          overagePosture: "disabled" as const,
          contextClass: "test",
          cacheClass: "none",
          priceEvidence: {
            kind: "subscription" as const,
            rateCardId: "test",
            rateCardRevision: "1",
            evidence: {
              sourceIdentity: "managed-agent-routes-test",
              sourceRevision: "1",
              sourceDigest: `sha256:${"a".repeat(64)}`,
              observedAt: "2026-08-01T00:00:00.000Z",
              validUntil: "2026-09-01T00:00:00.000Z",
              confidence: "high" as const,
              authority: "configured" as const,
            },
          },
          auxiliaryCharges: [],
          executionEnvelope: {
            limits: [{
              atoms: "200000",
              scale: 0,
              unit: "input-token",
              scheme: { kind: "unit" as const },
            }],
          },
        },
      };
    }),
  });

  const authorityProfiles = targetFixtures.flatMap((target) =>
    (target.profiles ?? ["foundation-readonly-plan"]).map((admissionProfile) => ({
      id: `authority:${admissionProfile}`,
      admissionProfile,
      ...(target.workingDirectory ? { workingDirectory: target.workingDirectory } : {}),
      ...(target.timeoutMs ? { timeoutMs: target.timeoutMs } : {}),
      ...(target.tools ? { tools: target.tools } : {}),
      ...(target.memory ? { memory: target.memory } : {}),
      ...(target.readAuthority ? { readAuthority: target.readAuthority } : {}),
      ...(target.writeAuthority ? { writeAuthority: target.writeAuthority } : {}),
    })))
    .filter((profile, index, profiles) => profiles.findIndex((candidate) => candidate.id === profile.id) === index);

  return {
    version: "3",
    targetCatalog: {
      accounts: executionCatalog.accounts,
      accountPolicies: executionCatalog.accountPolicies,
      targets: targetFixtures.map((target) => {
        const targetId = target.id;
        if (target.kind === "direct") {
          const route = executionCatalog.routes.find((candidate) => candidate.id === targetId)!;
          return { ...route, id: target.id, kind: "direct" as const };
        }
        return {
          id: target.id,
          kind: "harness" as const,
          label: target.id,
          providerId: target.provider ?? "",
          providerModelId: target.model as string,
          dataClassification: "internal" as const,
          dataPolicyEvidence: {
            providerId: target.provider ?? "",
            providerModelId: target.model as string,
            dataUse: "not-used" as const,
            trainingPosture: "prohibited" as const,
            retention: { posture: "zero" as const, days: 0 },
            permittedMaximumClassification: "internal" as const,
            permittedClassifications: ["public", "internal"] as const,
            sourceIdentity: "managed-agent-routes-test",
            sourceRevision: "1",
            sourceDigest: `sha256:${"d".repeat(64)}` as const,
            observedAt: "2026-08-01T00:00:00.000Z",
            expiresAt: "2027-08-01T00:00:00.000Z",
          },
          ...(target.remoteHarness ? { remoteHarness: target.remoteHarness } : {}),
          ...(target.externalRuntimeAttachment ? { externalRuntimeAttachment: target.externalRuntimeAttachment } : {}),
        };
      }),
    },
    authorityProfiles,
    managedAgents: {
      enabled: true,
      ...(authorityProfiles[0] ? { defaultAuthorityProfileId: authorityProfiles[0].id } : {}),
      requireApproval: true,
      ...managedAgents,
    },
  };
}

function testExecutionIdentity(targetId: string): {
  readonly providerId: string;
  readonly providerModelId: string;
} {
  if (targetId.startsWith("opencode-go-")) {
    return { providerId: "opencode-go", providerModelId: "kimi-k2.6" };
  }
  if (targetId.startsWith("openai-")) {
    return { providerId: "openai", providerModelId: "gpt-5.4-mini" };
  }
  if (targetId === "codex-oauth-auto-review-readonly") {
    return { providerId: "codex-oauth", providerModelId: "codex-auto-review" };
  }
  if (targetId === "codex-oauth-reasoning-readonly") {
    return { providerId: "codex-oauth", providerModelId: "gpt-5.5" };
  }
  if (targetId === "codex-luna") {
    return { providerId: "codex-oauth", providerModelId: "gpt-5.6-luna" };
  }
  return { providerId: "codex-oauth", providerModelId: "gpt-5.4-mini" };
}

// Minimal economic-policy coverage for a direct route under test. Direct
// routes now fail route health unconditionally without at least one
// covering policy (H1/H2 closure); this fixture exists purely to keep
// unrelated route-composition tests exercising their own concern instead of
// tripping the policy-coverage gate.
function economicPolicyCovering(
  targetIds: readonly string[],
  policyId = "test-coverage-policy",
): NonNullable<KilnGlobalConfig["managedAgents"]>["economicPolicies"] {
  return [{
    id: policyId,
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
    candidates: targetIds.map((targetId, priorityRank) => ({
      targetId,
      comparisonDomainId: "priority-only",
      priorityRank,
      ceiling: { kind: "none" as const },
      worstCaseReservation: { kind: "not-comparable" as const, reason: "subscription-basis" as const },
    })),
  }];
}

const MANAGED_OPENAI_MODEL_GATEWAY: NonNullable<KilnGlobalConfig["modelGateway"]> = {
  port: 4819,
  replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
  principals: [],
  virtualModels: [{
    id: "managed-openai",
    targetId: "openai-readonly",
    capabilities: ["text", "reasoning-controls"],
    deliberation: {
      levels: ["low", "high"],
      defaultLevel: "low",
      supportsAdaptive: false,
      evidenceRevision: "revision-1",
    },
    affinity: { continuity: "none" },
  }],
};

const TEST_MANAGED_ACCOUNT_COMPOSITION = {
  routing: {} as never,
  authority: {} as never,
  updateCatalog() {},
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
      version: "3",
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

  it.each(["codex", "opencode"] as const)(
    "fails closed when an explicit %s harness route omits its exact model",
    async (provider) => {
      const result = await resolveManagedInvocationToolOptions(baseConfig({
        targetFixtures: [{
          id: `${provider}-missing-model`,
          kind: "harness",
          provider,
          profiles: ["foundation-readonly-plan"],
          workingDirectory: "project",
          tools: {
            allowed: ["read", "tree", "grep", "glob"],
            network: false,
            writes: false,
          },
          memory: { access: "read-only" },
          credentials: { mode: "credentialless" },
        }],
      }), {
        cwd: "C:/repo",
        registry: createRegistry(provider),
        surface: "gui",
        providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      });

      expect(result.managedInvocation?.routes).toBeUndefined();
      expect(result.routeHealth).toEqual([
        expect.objectContaining({
          routeId: `${provider}-missing-model`,
          available: false,
          reason: `Managed invocation route '${provider}-missing-model' requires a model.`,
        }),
      ]);
    },
  );

  it("resolves an explicit healthy Codex harness route", async () => {
    const result = await resolveManagedInvocationToolOptions({
      ...baseConfig({
        targetFixtures: [{
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
    expect(result.managedInvocation?.routes[0]?.capability).toMatchObject({
      target: { providerId: "codex", modelId: "gpt-5.3-codex-spark" },
      adapter: { kind: "cli-harness" },
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
    expect(profileByAdmission(result.managedInvocation?.routes[0], "foundation-readonly-plan")).toMatchObject({
      authorityProfileId: "authority:foundation-readonly-plan",
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

  it("binds the native route revision to its configured authority", async () => {
    const route = {
      id: "codex-readonly",
      kind: "harness" as const,
      provider: "codex" as const,
      model: "gpt-5.3-codex-spark",
      profiles: ["foundation-readonly-plan" as const],
      timeoutMs: 120000,
      workingDirectory: "project" as const,
      tools: { allowed: ["read", "tree"], network: false, writes: false },
      memory: { access: "read-only" as const },
    };
    const resolve = async (timeoutMs: number) => await resolveManagedInvocationToolOptions(
      baseConfig({ targetFixtures: [{ ...route, timeoutMs }] }),
      {
        cwd: "C:/repo",
        registry: createRegistry("codex"),
        surface: "gui",
        providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      },
    );

    const firstRevision = (await resolve(120000)).managedInvocation?.routes[0]?.capability.identity.revision;
    const repeatedRevision = (await resolve(120000)).managedInvocation?.routes[0]?.capability.identity.revision;
    const changedRevision = (await resolve(180000)).managedInvocation?.routes[0]?.capability.identity.revision;

    expect(firstRevision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(repeatedRevision).toBe(firstRevision);
    expect(changedRevision).not.toBe(firstRevision);
  });

  it("creates a managed invocation service for catalog-selected account routes without worktree leases", async () => {
    const result = await resolveManagedInvocationToolOptions({
      ...baseConfig({
        economicPolicies: economicPolicyCovering(["openai-readonly"]),
        targetFixtures: [{
        id: "openai-readonly",
        kind: "direct",
        profiles: ["foundation-readonly-plan"],
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
    expect(result.managedInvocation?.invocationServiceKey).toContain("openai-readonly");
    expect(result.managedInvocation?.routes.find((route) => route.routeId === "openai-readonly")?.capability.capacity).toEqual({
      kind: "policy-bound",
      accountPolicyId: "policy:openai-readonly",
    });
  });

  // Roadmap 01 Slice 3.1 (F6) - the route's declared external-runtime
  // attachment must be reachable from real route configuration, not just
  // from programmatically-constructed test fixtures.
  it("reads a route's declared external-runtime attachment from configuration (F6)", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      targetFixtures: [{
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
      targetFixtures: [{
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
      targetFixtures: [{
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
      targetFixtures: [{
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
      targetFixtures: [{
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
    const profile = profileByAdmission(route, "foundation-readonly-plan");
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
    }), await route!.createAdapter!(), {
      routeId: route!.routeId,
      routeSource: route!.routeSource,
    });

    expect(invokeResult.status).toBe("completed");
    expect(readUris).toEqual(["kiln://test/current-harness-resource"]);
    expect(capturedRun?.prompt).toBe("Summarize the supplied resource.");
    expect(capturedRun?.system).toContain("kiln://test/current-harness-resource");
    expect(capturedRun?.system).toContain("Harness resource body.");
  });

  it("derives account-leased credential evidence and service keys from the execution catalog", async () => {
    const result = await resolveManagedInvocationToolOptions({
      ...baseConfig({
        economicPolicies: economicPolicyCovering(["openai-readonly"]),
        targetFixtures: [{
        id: "openai-readonly",
        kind: "direct",
        profiles: ["foundation-readonly-plan"],
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

    expect(profileByAdmission(result.managedInvocation?.routes[0], "foundation-readonly-plan")?.credentialRoute).toEqual({
      mode: "account-leased",
      routeId: "openai-readonly",
      accountPolicyId: "policy:openai-readonly",
    });
    expect(result.managedInvocation?.routes[0]?.deliberationCapabilities).toBeUndefined();
    expect(result.managedInvocation?.invocationService).toBeDefined();
    expect(result.managedInvocation?.invocationServiceKey).toContain("openai-readonly");
  });

  it("creates an invocation service for credentialless routes without lease-backed resources", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      targetFixtures: [{
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

    expect(result.managedInvocation?.invocationService).toBeDefined();
    expect(result.managedInvocation?.invocationServiceKey).toBeUndefined();
    expect(result.managedInvocation?.economicDispatch).toBeUndefined();
    expect(result.managedInvocation?.workspaceRoot).toBeUndefined();
  });

  it("admits direct sandbox working-directory routes with a shared sandbox lease manager", async () => {
    validateGlobalConfig(baseConfig({
      economicPolicies: economicPolicyCovering(["codex-oauth-sandbox-readonly"]),
      targetFixtures: [{
        id: "codex-oauth-sandbox-readonly",
        kind: "direct",
        profiles: ["foundation-readonly-plan"],
        workingDirectory: "sandbox",
      }],
    }));

    const result = await resolveManagedInvocationToolOptions(baseConfig({
      economicPolicies: economicPolicyCovering(["codex-oauth-sandbox-readonly"]),
      targetFixtures: [{
        id: "codex-oauth-sandbox-readonly",
        kind: "direct",
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
    expect(profileByAdmission(result.managedInvocation?.routes[0], "foundation-readonly-plan")).toMatchObject({
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
      targetFixtures: [{
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
      targetFixtures: [{
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
    expect(result.managedInvocation?.routes[0]?.capability).toMatchObject({
      target: { providerId: "codex-cloud" },
      adapter: { kind: "governed-external-runtime" },
    });
    expect(profileByAdmission(result.managedInvocation?.routes[0], "foundation-readonly-plan")).toMatchObject({
      workingDirectory: {
        path: "C:/repo",
        mode: "sandbox",
      },
    });
    expect(result.managedInvocation?.invocationService).toBeDefined();
    expect(result.managedInvocation?.invocationServiceKey).toContain("sandboxPolicy");
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
          "authorityProfileId: authority:foundation-readonly-plan",
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
        targetFixtures: [{
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

  it("isolates missing or widening policy bindings to the affected agent", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-agent-policy-"));
    try {
      const agentsDir = join(root, ".kiln", "agents");
      mkdirSync(agentsDir, { recursive: true });
      const agentPath = join(agentsDir, "economic-worker.md");
      writeFileSync(join(agentsDir, "harness-advisor.md"), [
        "---",
        "name: harness-advisor",
        "role: Native harness advisor",
        "goal: Preserve harness work when another agent policy is invalid.",
        "tier: reasoning",
        "mode: managed-child",
        "targetId: codex-readonly",
        "authorityProfileId: authority:foundation-readonly-plan",
        "---",
        "Remain within the native harness route.",
      ].join("\n"));
      const writeAgent = (policyLine: string, routeLine = "") => writeFileSync(agentPath, [
        "---",
        "name: economic-worker",
        "role: Economic managed worker",
        "goal: Execute only policy-admitted work.",
        "tier: reasoning",
        "mode: managed-child",
        "authorityProfileId: authority:foundation-readonly-plan",
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
          targetId: "admitted-route",
          comparisonDomainId: "priority-only",
          priorityRank: 0,
          ceiling: { kind: "none" as const },
          worstCaseReservation: { kind: "not-comparable" as const, reason: "economic-basis-unavailable" as const },
        }],
      }];
      const config = baseConfig({
        economicPolicies,
        targetFixtures: [{
          id: "admitted-route",
          kind: "direct",
          profiles: ["foundation-readonly-plan"],
        }, {
          id: "codex-readonly",
          kind: "harness",
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          profiles: ["foundation-readonly-plan"],
        }],
      });
      let adapterConstructions = 0;
      const resolve = () => resolveManagedInvocationToolOptions(config, {
        cwd: root,
        userHome: root,
        registry: createRegistryForProviders([
          { provider: "codex-oauth" },
          { provider: "codex" },
        ]),
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
      expect(missing.routeHealth).toContainEqual(expect.objectContaining({
        routeId: "admitted-route",
        available: true,
      }));
      expect(missing.managedInvocation?.agentCatalog ?? []).not.toContainEqual(expect.objectContaining({
        name: "economic-worker",
      }));
      expect(missing.managedInvocation?.agentCatalog).toContainEqual(expect.objectContaining({
        name: "harness-advisor",
        routeId: "codex-readonly",
      }));
      expect(adapterConstructions).toBe(0);

      writeAgent("economicPolicyId: bounded-policy", "targetId: outside-policy");
      const widening = await resolve();
      expect(widening.agentHealth).toContainEqual(expect.objectContaining({
        agentName: "economic-worker",
        available: false,
        reason: expect.stringContaining("not admitted"),
      }));
      expect(widening.routeHealth).toContainEqual(expect.objectContaining({
        routeId: "admitted-route",
        available: true,
      }));
      expect(widening.managedInvocation?.agentCatalog ?? []).not.toContainEqual(expect.objectContaining({
        name: "economic-worker",
      }));
      expect(widening.managedInvocation?.agentCatalog).toContainEqual(expect.objectContaining({
        name: "harness-advisor",
        routeId: "codex-readonly",
      }));
      expect(adapterConstructions).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("consumes a valid agent policy binding without selecting a target hint", async () => {
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
        "authorityProfileId: authority:foundation-readonly-plan",
        "economicPolicyId: bounded-policy",
        "---",
        "Remain within the configured economic policy.",
      ].join("\n"));
      const result = await resolveManagedInvocationToolOptions(baseConfig({
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
            targetId: "admitted-route",
            comparisonDomainId: "priority-only",
            priorityRank: 0,
            ceiling: { kind: "none" },
            worstCaseReservation: { kind: "not-comparable", reason: "economic-basis-unavailable" },
          }],
        }],
        targetFixtures: [{
          id: "admitted-route",
          kind: "direct",
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
          targetId: "admitted-route",
          comparisonDomainId: "priority-only",
          priorityRank: 0,
          ceiling: { kind: "none" },
          worstCaseReservation: { kind: "not-comparable", reason: "economic-basis-unavailable" },
        }],
      }],
      targetFixtures: [{
        id: "admitted-route",
        kind: "direct",
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
        "authorityProfileId: authority:foundation-readonly-plan",
        "taskAffinity:",
        "  - mechanical-edit",
        "---",
        "Collect bounded evidence without modifying files.",
      ].join("\n"));
      const result = await resolveManagedInvocationToolOptions(baseConfig({
        economicPolicies: economicPolicyCovering(["codex-oauth-reasoning-readonly", "codex-oauth-bounded-readonly"]),
        targetFixtures: [{
          id: "codex-oauth-reasoning-readonly",
          kind: "direct",
          profiles: ["foundation-readonly-plan"],
          taskSuitability: [{ task: "mechanical-edit", level: "limited" }],
        }, {
          id: "codex-oauth-bounded-readonly",
          kind: "direct",
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
          "targetId: opencode-go-kimi-k2-6-readonly",
          "authorityProfileId: authority:foundation-readonly-plan",
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
        ...baseConfig({
          economicPolicies: economicPolicyCovering(["opencode-go-kimi-k2-6-readonly"]),
          targetFixtures: [{
            id: "opencode-go-kimi-k2-6-readonly",
            kind: "direct",
            profiles: ["foundation-readonly-plan"],
            tools: {
              allowed: ["read", "tree", "grep", "glob", "web_search", "web_fetch", "browser_session_start", "browser_navigate", "browser_observe"],
              network: true,
              writes: false,
            },
          }],
        }),
        engines: {
          "opencode-go": { enabled: true, billing: "subscription" },
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
      expect(profileByAdmission(visualRoute, "foundation-readonly-plan")).toMatchObject({
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
        targetFixtures: [{
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
      targetFixtures: [{
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

  it("keeps direct routes unhealthy without a covering economic policy, even when an adapter factory exists", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      targetFixtures: [{
        id: "openai-readonly",
        kind: "direct",
        profiles: ["foundation-readonly-plan"],
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("openai"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      directAdapterFactory: () => makeDirectAdapter(),
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth[0]).toMatchObject({
      routeId: "openai-readonly",
      kind: "direct",
      provider: "openai",
      available: false,
      reason: "Direct managed invocation route 'openai-readonly' has no covering economic policy; managed invocation requires a durable economic commitment before adapter construction.",
    });
  });

  it("resolves direct routes when the host supplies a direct runtime adapter factory", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      economicPolicies: economicPolicyCovering(["openai-readonly"]),
      targetFixtures: [{
        id: "openai-readonly",
        kind: "direct",
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
    expect(result.managedInvocation?.routes[0]?.createCommittedAdapter).toBeInstanceOf(Function);
    expect(result.managedInvocation?.routes[0]?.surface).toBe("direct-provider");
  });

  it("resolves explicit Codex OAuth auto-review routes when direct discovery advertises the model", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      economicPolicies: economicPolicyCovering(["codex-oauth-auto-review-readonly"]),
      targetFixtures: [{
        id: "codex-oauth-auto-review-readonly",
        kind: "direct",
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
      targetFixtures: [{
        id: "codex-write",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.4-mini",
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
      targetFixtures: [{
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
      reason: "Provider 'claude' model 'default' is a moving alias and cannot carry live-proof admission.",
    });
  });

  it("keeps a managed Claude route closed when no operator Claude Code executable resolves", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      targetFixtures: [{
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
      targetFixtures: [{
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

    expect(result.routeHealth[0]).toMatchObject({
      routeId: "claude-readonly",
      available: true,
    });
  });

  it("keeps a managed OpenCode route closed when its discovered executable is unavailable", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      targetFixtures: [{
        id: "opencode-readonly",
        kind: "harness",
        provider: "opencode",
        model: "opencode/minimax-m2.5-free",
        profiles: ["foundation-readonly-plan"],
        tools: { allowed: ["read"], writes: false },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("opencode"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      resolveOpenCodeExecutable: () => undefined,
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth[0]).toMatchObject({
      routeId: "opencode-readonly",
      available: false,
      reason: "OpenCode executable was not found; a managed OpenCode child must run the binary whose catalog admitted this route.",
    });
  });

  it("projects only the exact discovered Claude deliberation capability into a managed route", async () => {
    let capturedResolution: DeliberationResolution | undefined;
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      targetFixtures: [{
        id: "claude-readonly",
        kind: "harness",
        provider: "claude",
        model: "claude-fable-5[1m]",
        profiles: ["foundation-readonly-plan"],
        tools: { allowed: ["read"], writes: false },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistryWithCapturedHarnessRun("claude", (options) => {
        capturedResolution ??= options.deliberationResolution;
      }, (config) => {
        capturedResolution = config.deliberationResolution;
      }),
      surface: "gui",
      providerModelEligibility: withDiscoveredDeliberation(
        COMMON_OBSERVED_PROVIDER_MODELS,
        "claude",
        "claude-fable-5[1m]",
      ),
      resolveClaudeExecutable: () => ({
        path: "C:/tools/claude.exe",
        evidence: { executable: "<operator-harness>/claude.exe", version: "2.1.226" },
      }),
    });

    expect(result.managedInvocation?.routes[0]?.deliberationCapabilities).toEqual({
      provider: "claude",
      model: "claude-fable-5[1m]",
      levels: [{ id: "low" }, { id: "high" }],
      defaultLevel: "high",
      supportsAdaptive: true,
      evidence: {
        sourceIdentity: "claude-code-model-catalog",
        sourceRevision: "2.1.226",
        observedAt: FIXTURE_OBSERVED_AT,
      },
    });

    const route = result.managedInvocation?.routes[0];
    const profile = profileByAdmission(route, "foundation-readonly-plan");
    expect(route).toBeDefined();
    expect(profile).toBeDefined();
    await (result.managedInvocation?.invocationService ?? new RuntimeManagedAgentInvocationService()).invoke(
      defineManagedAgentInvocationRequest({
        invocationId: "claude-deliberation-route-1",
        agentId: "claude-readonly:foundation-readonly-plan",
        parentSessionId: "claude-parent-session",
        parentTurnId: "claude-parent-session:turn:1",
        profile: "foundation-readonly-plan",
        requestedBy: "assistant",
        requestSource: "test",
        providerRoute: {
          providerId: "claude",
          surface: "cli-harness",
          model: "claude-fable-5[1m]",
          deliberationIntent: { mode: "fixed", preferredLevel: "low", onUnsupported: "deny" },
        },
        adapterKind: "harness",
        executionMode: "cli-harness",
        authority: {
          authorityProfileId: profile!.authorityProfileId,
          permissionProfile: profile!.permissionProfile,
          toolAuthority: {
            allowedToolNames: profile!.allowedToolNames,
            writeAllowed: false,
            networkAllowed: false,
          },
          workingDirectory: profile!.workingDirectory,
          timeoutMs: profile!.timeoutMs,
          credentialRoute: profile!.credentialRoute,
          memoryScope: profile!.memoryScope,
        },
        input: { summary: "Inspect the deliberation route." },
      }),
      await route!.createAdapter!(),
      { routeId: route!.routeId, routeSource: route!.routeSource },
    );

    expect(capturedResolution).toMatchObject({
      status: "exact",
      selectedLevel: "low",
      capabilityEvidence: { sourceRevision: "2.1.226" },
    });
  });

  it("does not substitute configured gateway deliberation for missing Claude discovery evidence", async () => {
    const result = await resolveManagedInvocationToolOptions({
      ...baseConfig({
        targetFixtures: [{
          id: "claude-readonly",
          kind: "harness",
          provider: "claude",
          model: "claude-fable-5[1m]",
          profiles: ["foundation-readonly-plan"],
          tools: { allowed: ["read"], writes: false },
        }],
      }),
      modelGateway: {
        ...MANAGED_OPENAI_MODEL_GATEWAY,
        virtualModels: [{
          ...MANAGED_OPENAI_MODEL_GATEWAY.virtualModels[0],
          id: "managed-claude",
        }],
      },
    }, {
      cwd: "C:/repo",
      registry: createRegistry("claude"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      resolveClaudeExecutable: () => ({
        path: "C:/tools/claude.exe",
        evidence: { executable: "<operator-harness>/claude.exe", version: "2.1.226" },
      }),
    });

    expect(result.managedInvocation?.routes[0]?.deliberationCapabilities).toBeUndefined();
  });

  it("projects exact native OpenCode discovery into the managed harness without gateway fallback", async () => {
    let capturedResolution: DeliberationResolution | undefined;
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      targetFixtures: [{
        id: "opencode-readonly",
        kind: "harness",
        provider: "opencode",
        model: "opencode/gpt-5.4",
        profiles: ["foundation-readonly-plan"],
        tools: { allowed: ["read"], writes: false },
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistryWithCapturedHarnessRun("opencode", (options) => {
        capturedResolution ??= options.deliberationResolution;
      }, (config) => {
        capturedResolution = config.deliberationResolution;
      }),
      surface: "gui",
      providerModelEligibility: withDiscoveredDeliberation(
        observedProviderModels({ opencode: ["opencode/gpt-5.4"] }),
        "opencode",
        "opencode/gpt-5.4",
      ),
    });

    expect(result.managedInvocation?.routes[0]?.deliberationCapabilities).toMatchObject({
      provider: "opencode",
      model: "opencode/gpt-5.4",
      levels: [{ id: "low" }, { id: "high" }],
      evidence: {
        sourceIdentity: "opencode-cli-model-catalog",
        sourceRevision: "1.18.16:catalog-fixture",
      },
    });

    const route = result.managedInvocation?.routes[0];
    const profile = profileByAdmission(route, "foundation-readonly-plan");
    expect(route).toBeDefined();
    expect(profile).toBeDefined();
    await (result.managedInvocation?.invocationService ?? new RuntimeManagedAgentInvocationService()).invoke(
      defineManagedAgentInvocationRequest({
        invocationId: "opencode-deliberation-route-1",
        agentId: "opencode-readonly:foundation-readonly-plan",
        parentSessionId: "opencode-parent-session",
        parentTurnId: "opencode-parent-session:turn:1",
        profile: "foundation-readonly-plan",
        requestedBy: "assistant",
        requestSource: "test",
        providerRoute: {
          providerId: "opencode",
          surface: "cli-harness",
          model: "opencode/gpt-5.4",
          deliberationIntent: { mode: "fixed", preferredLevel: "low", onUnsupported: "deny" },
        },
        adapterKind: "harness",
        executionMode: "cli-harness",
        authority: {
          authorityProfileId: profile!.authorityProfileId,
          permissionProfile: profile!.permissionProfile,
          toolAuthority: {
            allowedToolNames: profile!.allowedToolNames,
            writeAllowed: false,
            networkAllowed: false,
          },
          workingDirectory: profile!.workingDirectory,
          timeoutMs: profile!.timeoutMs,
          credentialRoute: profile!.credentialRoute,
          memoryScope: profile!.memoryScope,
        },
        input: { summary: "Inspect the native OpenCode deliberation route." },
      }),
      await route!.createAdapter!(),
      { routeId: route!.routeId, routeSource: route!.routeSource },
    );

    expect(capturedResolution).toMatchObject({
      status: "exact",
      selectedLevel: "low",
      capabilityEvidence: {
        sourceIdentity: "opencode-cli-model-catalog",
        sourceRevision: "1.18.16:catalog-fixture",
      },
    });
  });

  it("does not substitute model-gateway deliberation for missing native OpenCode discovery", async () => {
    const result = await resolveManagedInvocationToolOptions({
      ...baseConfig({
        targetFixtures: [{
          id: "opencode-readonly",
          kind: "harness",
          provider: "opencode",
          model: "opencode/gpt-5.4",
          profiles: ["foundation-readonly-plan"],
          tools: { allowed: ["read"], writes: false },
        }],
      }),
      modelGateway: {
        ...MANAGED_OPENAI_MODEL_GATEWAY,
        virtualModels: [{
          ...MANAGED_OPENAI_MODEL_GATEWAY.virtualModels[0],
          id: "managed-opencode-native",
          deliberation: {
            levels: ["low", "high"],
            supportsAdaptive: false,
            evidenceRevision: "gateway-must-not-authorize-native",
          },
        }],
      },
    }, {
      cwd: "C:/repo",
      registry: createRegistry("opencode"),
      surface: "gui",
      providerModelEligibility: observedProviderModels({ opencode: ["opencode/gpt-5.4"] }),
    });

    expect(result.managedInvocation?.routes[0]?.deliberationCapabilities).toBeUndefined();
  });

  it("fails closed when the observed Claude version lacks the admitted private plan artifact capability", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      targetFixtures: [{
        id: "claude-readonly",
        kind: "harness",
        provider: "claude",
        model: "claude-sonnet-5",
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
          version: "2.1.221",
        },
      }),
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth[0]).toMatchObject({
      available: false,
      reason: "Claude Code executable version lacks the admitted private plan artifact-location capability.",
    });
  });

  it("does not require a Kiln economic policy for a native harness target", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-economic-harness-agent-"));
    try {
      const agentsDir = join(root, ".kiln", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "harness-advisor.md"), [
        "---",
        "name: harness-advisor",
        "role: Native harness advisor",
        "goal: Review through native harness authority.",
        "tier: reasoning",
        "mode: managed-child",
        "targetId: codex-readonly",
        "authorityProfileId: authority:foundation-readonly-plan",
        "---",
        "Remain within the native harness route.",
      ].join("\n"));

      const result = await resolveManagedInvocationToolOptions(baseConfig({
        targetFixtures: [{
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

      expect(result.agentHealth).toBeUndefined();
      expect(result.managedInvocation?.agentCatalog).toContainEqual(expect.objectContaining({
        name: "harness-advisor",
        routeId: "codex-readonly",
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["claude-sonnet-readonly", "claude-sonnet-5"],
    ["claude-opus-readonly", "claude-opus-5"],
    ["claude-haiku-readonly", "claude-haiku-4-5-20251001"],
  ])("admits the exact live-proven Claude read-only route %s", async (routeId, model) => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      targetFixtures: [{
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
        targetFixtures: [{
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
      targetFixtures: [{
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
    expect(result.managedInvocation?.routes[0]?.capability.proof.provenProfiles).toEqual([
      "foundation-apply-approved-writes",
    ]);
    expect(result.managedInvocation?.routes[0]?.capability.supportsWrite).toBe(true);
    expect(profileByAdmission(result.managedInvocation?.routes[0], "foundation-apply-approved-writes")).toMatchObject({
      authorityProfileId: "authority:foundation-apply-approved-writes",
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
      economicPolicies: economicPolicyCovering(["codex-oauth-approved-write"]),
      targetFixtures: [{
        id: "codex-oauth-approved-write",
        kind: "direct",
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
    expect(result.managedInvocation?.routes[0]?.createCommittedAdapter).toBeInstanceOf(Function);
    expect(profileByAdmission(result.managedInvocation?.routes[0], "foundation-apply-approved-writes")).toMatchObject({
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
      targetFixtures: [{
        id: "opencode-go-frontend-approved-write",
        kind: "direct",
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
      accountPolicyId: "policy:opencode-go-frontend-approved-write",
      providerId: "opencode-go",
      model: "kimi-k2.6",
      profiles: ["foundation-apply-approved-writes"],
      reason: "foundation-apply-approved-writes routes cannot enable tools.network. Use a separate foundation-readonly-plan route for web, browser, computer-use, or visual-reference research phases.",
    }]);
  });

  // H1/H2 closure (issue #34): a configured direct route not covered by any
  // economic policy must fail route health at composition, not silently
  // dispatch. This must hold when no economicPolicies are declared at all.
  it("fails direct route health with a named reason when no economic policy covers it", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      targetFixtures: [{
        id: "openai-uncovered",
        kind: "direct",
        profiles: ["foundation-readonly-plan"],
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("openai"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      directAdapterFactory: (route) => makeDirectAdapter(route.provider),
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth).toEqual([{
      routeId: "openai-uncovered",
      routeSource: "explicit-managed-route",
      kind: "direct",
      provider: "openai",
      model: "gpt-5.4-mini",
      profiles: ["foundation-readonly-plan"],
      available: false,
      reason: "Direct managed invocation route 'openai-uncovered' has no covering economic policy; managed invocation requires a durable economic commitment before adapter construction.",
    }]);
  });

  // Same closure, schema v2: the route exists and economicPolicies are
  // declared, but this specific route is simply never named as a candidate
  // in any of them.
  it("fails direct route health with a named reason when no economic policy covers it (schema v2, route not a candidate)", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      economicPolicies: economicPolicyCovering(["openai-covered"]),
      targetFixtures: [{
        id: "openai-covered",
        kind: "direct",
        profiles: ["foundation-readonly-plan"],
      }, {
        id: "openai-uncovered",
        kind: "direct",
        profiles: ["foundation-readonly-plan"],
      }],
    }), {
      cwd: "C:/repo",
      userHome: "C:/repo",
      registry: createRegistry("openai"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      directAdapterFactory: (route) => makeDirectAdapter(route.provider),
    });

    const uncovered = result.routeHealth.find((route) => route.routeId === "openai-uncovered");
    expect(uncovered).toMatchObject({
      available: false,
      reason: "Direct managed invocation route 'openai-uncovered' has no covering economic policy; managed invocation requires a durable economic commitment before adapter construction.",
    });
    const covered = result.routeHealth.find((route) => route.routeId === "openai-covered");
    expect(covered).toMatchObject({ available: true });
  });

  // H1/H2 closure (issue #34), binding decision 8: harness routes are
  // rejection-only for economics and must never be named as economic-policy
  // candidates - they never get a committed-adapter factory, so admitting
  // them here would silently create a permanently undispatchable route.
  // H2 closure: a policy-uncovered direct route must never trigger adapter
  // construction at composition time - no credential resolution, no MCP
  // connection. The directAdapterFactory spy standing in for both proves
  // zero calls, which is the strongest evidence that neither ran.
  it("never calls the direct adapter factory (zero credential/MCP work) for a policy-uncovered direct route", async () => {
    const directAdapterFactory = vi.fn(async (route: { readonly provider: string }) => makeDirectAdapter(route.provider));
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      targetFixtures: [{
        id: "openai-uncovered",
        kind: "direct",
        profiles: ["foundation-readonly-plan"],
      }],
    }), {
      cwd: "C:/repo",
      registry: createRegistry("openai"),
      surface: "gui",
      providerModelEligibility: COMMON_OBSERVED_PROVIDER_MODELS,
      directAdapterFactory,
    });

    expect(directAdapterFactory).not.toHaveBeenCalled();
    expect(result.routeHealth[0]?.available).toBe(false);
  });

  it("uses the one canonical target id for direct-target capacity resolution", async () => {
    const canonicalTargetId = "codex-luna";
    const config = baseConfig({
      economicPolicies: economicPolicyCovering([canonicalTargetId]),
      targetFixtures: [{
        id: canonicalTargetId,
        kind: "direct",
        profiles: ["foundation-readonly-plan"],
      }],
    });
    const resolve = vi.fn(async () => []);

    await projectManagedEconomicJobAdoption(config, {
      projectId: "project-a",
      callerId: "caller-a",
      adoptedDecisionAt: "2026-08-01T12:00:00.000Z",
      dispatch: {
        kind: "economic",
        economicAttemptId: "economic-attempt:canonical-target-001",
        economicPolicyId: "test-coverage-policy",
        economicPolicyRevision: "rev-1",
        constraints: {},
        candidateSet: {
          economicPolicyId: "test-coverage-policy",
          economicPolicyRevision: "rev-1",
          admissionProfileId: "foundation-readonly-plan",
          constraints: {},
          candidates: [{
            routeId: canonicalTargetId,
            routeSource: "explicit-managed-route",
            providerId: "codex-oauth",
            model: "gpt-5.6-luna",
            accountPolicyId: `policy:${canonicalTargetId}`,
            adapterCapabilityId: "test-direct-adapter",
            adapterCapabilityVersion: "1",
            profileAuthorityDigest: `sha256:${"9".repeat(64)}`,
          }],
          rejections: [],
        },
      },
    } as never, { modelGatewayCandidates: { resolve } } as never);

    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      admission: expect.objectContaining({ routeId: canonicalTargetId }),
      route: expect.objectContaining({ routeId: canonicalTargetId }),
    }));
  });

  it("rejects a harness route named as an economic-policy candidate at config validation", () => {
    expect(() => validateGlobalConfig(baseConfig({
      economicPolicies: economicPolicyCovering(["codex-harness-readonly"]),
      targetFixtures: [{
        id: "codex-harness-readonly",
        kind: "harness",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        profiles: ["foundation-readonly-plan"],
      }],
    }))).toThrow(/targetId must reference a direct target/u);
  });
});
