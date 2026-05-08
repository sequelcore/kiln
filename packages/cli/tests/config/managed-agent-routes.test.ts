import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core";
import type { KilnPermissionPolicy } from "../../src/wrapper/index.js";
import type {
  ProviderCreateConfig,
  ProviderId,
  SessionProviderDescriptor,
} from "../../src/wrapper/session-registry.js";
import { SessionRegistry } from "../../src/wrapper/session-registry.js";
import type { KilnGlobalConfig } from "../../src/config/global-config.js";
import { resolveManagedInvocationToolOptions } from "../../src/config/managed-agent-routes.js";
import type { ManagedAgentRuntimeAdapter } from "@kilnai/runtime";

const READONLY_POLICY: KilnPermissionPolicy = {
  approval: "on-request",
  sandbox: "read-only",
};

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

function baseConfig(overrides: Partial<KilnGlobalConfig["managedAgents"]> = {}): KilnGlobalConfig {
  return {
    version: "1",
    managedAgents: {
      enabled: true,
      defaultProvider: "codex",
      defaultProfile: "foundation-readonly-plan",
      requireApproval: true,
      ...overrides,
    },
  };
}

function makeDirectAdapter(providerId = "openai"): ManagedAgentRuntimeAdapter {
  return {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: `adapter:${providerId}:direct-provider`,
      providerId,
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
    "Provider 'opencode' does not advertise model 'openai/gpt-4o:free'.";
  const OPENCODE_UNPROVEN_MODEL_REASON =
    "Provider 'opencode' model 'opencode/nemotron-3-super-free' does not have live-proven read-only managed result handoff support for foundation-readonly-plan.";

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

  it("synthesizes a read-only harness route from enabled supported engines", async () => {
    const result = await resolveManagedInvocationToolOptions({
      version: "1",
      engines: {
        claude: { enabled: true, billing: "subscription" },
        codex: { enabled: true, billing: "plus-quota" },
        opencode: { enabled: false, billing: "free" },
      },
      routing: {
        defaultWorker: "claude",
      },
      models: {
        codex: "gpt-5.4-mini",
      },
    }, {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
    });

    expect(result.routeHealth).toEqual([{
      routeId: "codex-readonly",
      kind: "harness",
      provider: "codex",
      model: "gpt-5.4-mini",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes[0]?.routeId).toBe("codex-readonly");
    expect(result.managedInvocation?.requestSource).toBe("gui");
  });

  it("does not reuse the global default model across managed child engine namespaces", async () => {
    const result = await resolveManagedInvocationToolOptions({
      version: "1",
      engines: {
        codex: { enabled: true, billing: "plus-quota" },
      },
      models: {
        default: "claude-opus-4-7",
      },
    }, {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
    });

    expect(result.routeHealth[0]).toMatchObject({
      routeId: "codex-readonly",
      provider: "codex",
      model: "gpt-5.3-codex-spark",
      available: true,
    });
  });

  it("projects ordered routing routes into read-only managed routes when no explicit managed routes exist", async () => {
    const result = await resolveManagedInvocationToolOptions({
      version: "1",
      engines: {
        "codex-oauth": { enabled: true, billing: "subscription" },
        openrouter: { enabled: true, billing: "api-key" },
        codex: { enabled: true, billing: "plus-quota" },
        opencode: { enabled: true, billing: "free" },
      },
      routing: {
        routes: [
          { provider: "codex-oauth", model: "gpt-5.4-mini" },
          { provider: "openrouter", model: "qwen/qwen3-coder:free" },
          { provider: "codex", model: "gpt-5.4-mini" },
          { provider: "opencode", model: "openai/gpt-4o:free" },
        ],
      },
    }, {
      cwd: "C:/repo",
      registry: createRegistryForProviders([
        { provider: "codex-oauth" },
        { provider: "openrouter" },
        { provider: "codex" },
        { provider: "opencode" },
      ]),
      surface: "gui",
      providerModels: {
        opencode: ["opencode/minimax-m2.5-free"],
      },
      directAdapterFactory: (route) => makeDirectAdapter(route.provider),
    });

    expect(result.routeHealth).toEqual([{
      routeId: "codex-oauth-readonly",
      kind: "direct",
      provider: "codex-oauth",
      model: "gpt-5.4-mini",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }, {
      routeId: "openrouter-readonly",
      kind: "direct",
      provider: "openrouter",
      model: "qwen/qwen3-coder:free",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }, {
      routeId: "codex-readonly",
      kind: "harness",
      provider: "codex",
      model: "gpt-5.4-mini",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }, {
      routeId: "opencode-readonly",
      kind: "harness",
      provider: "opencode",
      model: "openai/gpt-4o:free",
      profiles: ["foundation-readonly-plan"],
      available: false,
      reason: OPENCODE_UNADVERTISED_MODEL_REASON,
    }]);
    expect(result.managedInvocation?.routes.map((route) => route.routeId)).toEqual([
      "codex-oauth-readonly",
      "openrouter-readonly",
      "codex-readonly",
    ]);
    expect(result.managedInvocation?.unavailableRoutes).toContainEqual({
      routeId: "opencode-readonly",
      providerId: "opencode",
      model: "openai/gpt-4o:free",
      profiles: ["foundation-readonly-plan"],
      reason: OPENCODE_UNADVERTISED_MODEL_REASON,
    });
  });

  it("exposes unhealthy direct routing projections as unavailable tool routes", async () => {
    const result = await resolveManagedInvocationToolOptions({
      version: "1",
      engines: {
        openrouter: { enabled: true, billing: "api-key" },
        codex: { enabled: true, billing: "plus-quota" },
      },
      routing: {
        routes: [
          { provider: "openrouter", model: "openrouter/free" },
          { provider: "codex", model: "gpt-5.4-mini" },
        ],
      },
    }, {
      cwd: "C:/repo",
      registry: createRegistryForProviders([
        { provider: "openrouter" },
        { provider: "codex" },
      ]),
      surface: "gui",
      directAdapterFactory: () => {
        throw new Error("Direct provider route 'openrouter-readonly' requires a tool-call-capable model; 'openrouter/openrouter/free' is not eligible.");
      },
    });

    expect(result.routeHealth[0]).toMatchObject({
      routeId: "openrouter-readonly",
      kind: "direct",
      provider: "openrouter",
      model: "openrouter/free",
      available: false,
      reason: "Direct provider route 'openrouter-readonly' requires a tool-call-capable model; 'openrouter/openrouter/free' is not eligible.",
    });
    expect(result.managedInvocation?.routes.map((route) => route.routeId)).toEqual(["codex-readonly"]);
    expect(result.managedInvocation?.unavailableRoutes).toEqual([{
      routeId: "openrouter-readonly",
      providerId: "openrouter",
      model: "openrouter/free",
      profiles: ["foundation-readonly-plan"],
      reason: "Direct provider route 'openrouter-readonly' requires a tool-call-capable model; 'openrouter/openrouter/free' is not eligible.",
    }]);
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
          credentials: { mode: "runtime-selected" },
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
    });

    expect(result.routeHealth).toEqual([{
      routeId: "codex-readonly",
      kind: "harness",
      provider: "codex",
      model: "gpt-5.3-codex-spark",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes).toHaveLength(1);
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
      memoryScope: {
        scope: { kind: "project", id: "repo" },
        access: "read-only",
      },
    });
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
      expect(result.managedInvocation?.skillCatalog).toEqual([
        {
          name: "repo-review",
          description: "Review repository evidence.",
          tags: ["review"],
        },
        {
          name: "test-generator",
          description: "Generate focused tests.",
          tags: ["test"],
        },
      ]);
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
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth[0]).toMatchObject({
      routeId: "codex-readonly",
      available: false,
      reason: "Provider 'codex' is disabled in engine config.",
    });
  });

  it("fails closed for OpenCode read-only routes when the configured model is not advertised", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      defaultProvider: "opencode",
      model: "openai/gpt-4o:free",
    }), {
      cwd: "C:/repo",
      registry: createRegistry("opencode"),
      surface: "tui",
      providerModels: {
        opencode: ["opencode/minimax-m2.5-free"],
      },
    });

    expect(result.routeHealth).toEqual([{
      routeId: "opencode-readonly",
      kind: "harness",
      provider: "opencode",
      model: "openai/gpt-4o:free",
      profiles: ["foundation-readonly-plan"],
      available: false,
      reason: OPENCODE_UNADVERTISED_MODEL_REASON,
    }]);
    expect(result.managedInvocation).toBeUndefined();
  });

  it("resolves the live-proven OpenCode read-only handoff model when it is advertised", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      defaultProvider: "opencode",
    }), {
      cwd: "C:/repo",
      registry: createRegistry("opencode"),
      surface: "tui",
      providerModels: {
        opencode: ["opencode/minimax-m2.5-free"],
      },
    });

    expect(result.routeHealth).toEqual([{
      routeId: "opencode-readonly",
      kind: "harness",
      provider: "opencode",
      model: "opencode/minimax-m2.5-free",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes[0]?.providerId).toBe("opencode");
    expect(result.managedInvocation?.routes[0]?.taskSuitability).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: "architecture-review",
          level: "capable",
          source: "static-profile",
        }),
      ]),
    );
  });

  it("fails closed for advertised OpenCode models without live-proven result handoff support", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      defaultProvider: "opencode",
      model: "opencode/nemotron-3-super-free",
    }), {
      cwd: "C:/repo",
      registry: createRegistry("opencode"),
      surface: "tui",
      providerModels: {
        opencode: ["opencode/minimax-m2.5-free", "opencode/nemotron-3-super-free"],
      },
    });

    expect(result.routeHealth).toEqual([{
      routeId: "opencode-readonly",
      kind: "harness",
      provider: "opencode",
      model: "opencode/nemotron-3-super-free",
      profiles: ["foundation-readonly-plan"],
      available: false,
      reason: OPENCODE_UNPROVEN_MODEL_REASON,
    }]);
    expect(result.managedInvocation).toBeUndefined();
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
      kind: "harness",
      provider: "codex",
      model: "gpt-5.3-codex-spark",
      profiles: ["foundation-readonly-plan"],
      available: false,
      reason: "Provider 'codex' is unavailable.",
    }]);
  });

  it("fails closed when engine probing marks the provider unavailable", async () => {
    const result = await resolveManagedInvocationToolOptions({
      version: "1",
      engines: {
        codex: { enabled: true, billing: "plus-quota" },
      },
    }, {
      cwd: "C:/repo",
      registry: createRegistry("codex"),
      surface: "gui",
      isProviderAvailable: (provider) => provider !== "codex",
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth).toEqual([{
      routeId: "codex-readonly",
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
      directAdapterFactory: () => makeDirectAdapter(),
    });

    expect(result.routeHealth).toEqual([{
      routeId: "openai-readonly",
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
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth[0]).toMatchObject({
      routeId: "codex-write",
      available: false,
      reason: "Write-capable managed invocation routes require explicit writeAuthority scope and approval config.",
    });
  });

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
            deniedPaths: [".git", "node_modules"],
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
    });

    expect(result.routeHealth).toEqual([{
      routeId: "codex-approved-write",
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
            deniedPaths: ["C:\\repo\\.git", "C:\\repo\\node_modules"],
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

  it("keeps direct provider write-capable routes unavailable until direct write proof exists", async () => {
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
      directAdapterFactory: (route) => makeDirectAdapter(route.provider),
    });

    expect(result.managedInvocation).toBeUndefined();
    expect(result.routeHealth[0]).toMatchObject({
      routeId: "codex-oauth-approved-write",
      available: false,
      reason: "Direct managed invocation write-capable routes are not live-proven yet.",
    });
  });
});
