import { describe, expect, it } from "vitest";
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
  };
  return new SessionRegistry([descriptor]);
}

function baseConfig(overrides: Partial<KilnGlobalConfig["managedAgents"]> = {}): KilnGlobalConfig {
  return {
    version: "2",
    managedAgents: {
      enabled: true,
      defaultProvider: "codex",
      defaultProfile: "foundation-readonly-plan",
      requireApproval: true,
      ...overrides,
    },
  };
}

function makeDirectAdapter(): ManagedAgentRuntimeAdapter {
  return {
    descriptor: defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:openai:direct-provider",
      providerId: "openai",
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
      version: "2",
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
      version: "2",
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

  it("does not synthesize managed routes when no supported child engine is enabled", async () => {
    await expect(resolveManagedInvocationToolOptions({
      version: "2",
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
    const result = await resolveManagedInvocationToolOptions(baseConfig({
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
    }), {
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

  it("synthesizes one read-only harness route when enabled without explicit routes", async () => {
    const result = await resolveManagedInvocationToolOptions(baseConfig({
      defaultProvider: "opencode",
      model: "openai/gpt-4o:free",
    }), {
      cwd: "C:/repo",
      registry: createRegistry("opencode"),
      surface: "tui",
    });

    expect(result.routeHealth).toEqual([{
      routeId: "opencode-readonly",
      kind: "harness",
      provider: "opencode",
      model: "openai/gpt-4o:free",
      profiles: ["foundation-readonly-plan"],
      available: true,
    }]);
    expect(result.managedInvocation?.routes[0]?.routeId).toBe("opencode-readonly");
    expect(result.managedInvocation?.requestSource).toBe("tui");
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
      version: "2",
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

  it("rejects write-capable routes before live-proven write adapter support", async () => {
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
      reason: "Write-capable managed invocation routes require explicit write authority and live-proven adapter support.",
    });
  });
});
