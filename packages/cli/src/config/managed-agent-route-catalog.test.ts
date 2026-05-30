import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineManagedAgentAdapterDescriptor } from "@kilnai/core";
import { RuntimeManagedAgentInvocationService } from "@kilnai/runtime";
import type { ManagedAgentRuntimeAdapter } from "@kilnai/runtime";
import { createStagedManagedInvocationRouteCatalog } from "./managed-agent-route-catalog.js";
import { resolveManagedInvocationToolOptions } from "./managed-agent-routes.js";
import type { ManagedAgentRouteConfigSource } from "./managed-agent-routes.js";
import { SessionRegistry } from "../wrapper/session-registry.js";
import type { ProviderCreateConfig, ProviderId, SessionProviderDescriptor } from "../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../wrapper/index.js";

const tempRoots: string[] = [];
const READONLY_POLICY: KilnPermissionPolicy = {
  approval: "on-request",
  sandbox: "read-only",
};

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
    managedAgents: {
      enabled: true,
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
        credentials: { mode: "runtime-selected" },
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
        credentials: { mode: "runtime-selected" },
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
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refreshes live managed invocation routes from the current config source", async () => {
    const cwd = createTempRoot();
    const staleConfig = makeConfig(false);
    let currentConfig = staleConfig;
    const catalog = await createStagedManagedInvocationRouteCatalog(staleConfig, {
      cwd,
      registry: createRegistry("opencode-go"),
      surface: "gui",
      isProviderAvailable: () => true,
      directAdapterFactory: () => makeAdapter(),
    }, {
      reloadConfig: () => currentConfig,
      discoverProviderModels: async () => ({}),
    });

    expect(catalog.managedInvocation?.routes[0]?.profiles["foundation-readonly-plan"]?.networkAllowed).toBe(false);

    currentConfig = makeConfig(true);
    await catalog.refreshNow();

    expect(catalog.managedInvocation?.routes[0]?.profiles["foundation-readonly-plan"]?.networkAllowed).toBe(true);
  });

  it("projects explicit read-only reference roots for managed frontend research routes", async () => {
    const cwd = createTempRoot();
    const resolution = await resolveManagedInvocationToolOptions({
      managedAgents: {
        enabled: true,
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
                "C:/Proyectos/Sequel/t1code",
                "C:/Proyectos/Sequel/vllm-studio",
              ],
              deniedPaths: [],
            },
          },
          memory: { access: "read-only" },
          credentials: { mode: "runtime-selected" },
        }],
      },
    }, {
      cwd,
      registry: createRegistry("opencode-go"),
      surface: "gui",
      isProviderAvailable: () => true,
      providerModels: {
        "opencode-go": ["qwen3.6-plus"],
      },
      directAdapterFactory: async () => makeAdapter(),
    });

    expect(resolution.routeHealth[0]).toMatchObject({ available: true });
    expect(resolution.managedInvocation?.routes[0]?.profiles["foundation-readonly-plan"]).toMatchObject({
      permissionProfile: "read-only",
      readAuthority: {
        workspace: {
          allowedPaths: [
            "C:\\Proyectos\\Sequel\\t1code",
            "C:\\Proyectos\\Sequel\\vllm-studio",
          ],
          deniedPaths: [],
        },
      },
    });
  });

  it("projects isolated worktree routes with a shared runtime invocation service", async () => {
    const cwd = createTempRoot();
    const resolution = await resolveManagedInvocationToolOptions(makeIsolatedWorktreeWriteConfig(), {
      cwd,
      registry: createRegistry("codex"),
      surface: "run",
      isProviderAvailable: () => true,
      providerModels: {
        codex: ["gpt-5.3-codex-spark"],
      },
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
      providerModels: {
        codex: ["gpt-5.3-codex-spark"],
      },
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
    }, {
      reloadConfig: () => currentConfig,
      discoverProviderModels: async () => ({ codex: ["gpt-5.3-codex-spark"] }),
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
    }, {
      reloadConfig: () => currentConfig,
      discoverProviderModels: async () => ({ codex: ["gpt-5.3-codex-spark"] }),
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
      providerModels: {
        codex: ["gpt-5.3-codex-spark"],
      },
      includeUnavailableRoutes: true,
    });

    expect(resolution.routeHealth[0]).toMatchObject({
      available: false,
      reason: "isolated-worktree write routes require writeAuthority.workspace.allowedPaths to stay inside the repository root.",
    });
  });
});
