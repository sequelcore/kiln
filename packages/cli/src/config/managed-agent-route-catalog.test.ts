import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineManagedAgentAdapterDescriptor } from "@kilnai/core";
import type { ManagedAgentRuntimeAdapter } from "@kilnai/runtime";
import { createStagedManagedInvocationRouteCatalog } from "./managed-agent-route-catalog.js";
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
});
