import { describe, expect, it, vi } from "vitest";
import type { AgentResponse, ProviderAdapter, ResolvedMcpServer, ToolResourceProvider } from "@kilnai/core";
import { createSessionBuiltinToolOptions, defineManagedAgentInvocationRequest, textParts } from "@kilnai/core";
import {
  ManagedDirectProviderRuntimeAdapter,
  RuntimeManagedAgentInvocationService,
  type ManagedCommittedInvocationRequest,
} from "@kilnai/runtime";
import { createManagedDirectProviderAdapterFactory } from "../../src/config/managed-agent-direct-adapters.js";
import type { DirectProviderAdapterOptions } from "../../src/wrapper/direct-provider-adapter-factory.js";

function provider(): ProviderAdapter {
  const response: AgentResponse = {
    parts: textParts("child result"),
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: [],
    stopReason: "end_turn",
  };
  return {
    name: "openai",
    createMessage: vi.fn(async () => response),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

describe("createManagedDirectProviderAdapterFactory", () => {
  it("does not construct a pooled provider for runtime-selected routes", async () => {
    const createProviderAdapter = vi.fn(async () => provider());
    const factory = createManagedDirectProviderAdapterFactory({ createProviderAdapter });

    const adapter = await factory({
      id: "openai-managed",
      kind: "direct",
      provider: "openai",
      model: "gpt-5.4-mini",
      profiles: ["foundation-readonly-plan"],
      credentials: {
        mode: "runtime-selected",
        accountPolicyId: "managed-openai",
      },
    });

    expect(adapter).toBeInstanceOf(ManagedDirectProviderRuntimeAdapter);
    expect(createProviderAdapter).not.toHaveBeenCalled();
  });

  it("constructs a runtime-selected adapter only for the exact committed account binding", async () => {
    const createProviderAdapter = vi.fn(async () => provider());
    const factory = createManagedDirectProviderAdapterFactory({ createProviderAdapter });
    const accountBinding = {
      virtualModelId: "managed-codex",
      accountId: "account-b",
      credentialId: "credential-b",
    };

    await expect(factory({
      id: "codex-managed",
      kind: "direct",
      provider: "codex-oauth",
      model: "gpt-5.4",
      profiles: ["foundation-readonly-plan"],
      credentials: { mode: "runtime-selected", accountPolicyId: "managed-codex" },
    }, accountBinding)).resolves.toBeInstanceOf(ManagedDirectProviderRuntimeAdapter);
    expect(createProviderAdapter).toHaveBeenCalledWith(expect.objectContaining({
      provider: "codex-oauth",
      model: "gpt-5.4",
      accountBinding,
    }));
  });

  it("rejects a committed route mismatch before provider or credential materialization", async () => {
    const createProviderAdapter = vi.fn(async () => provider());
    const factory = createManagedDirectProviderAdapterFactory({ createProviderAdapter });
    const committedRequest = {
      commitment: {
        reservation: {
          selectedIdentity: {
            route: {
              routeId: "codex-managed",
              providerId: "codex-oauth",
              modelId: "different-model",
            },
          },
        },
      },
      dispatchFenceId: "dispatch-fence-test",
      abortSignal: new AbortController().signal,
    } as ManagedCommittedInvocationRequest;

    await expect(factory({
      id: "codex-managed",
      kind: "direct",
      provider: "codex-oauth",
      model: "gpt-5.4",
      profiles: ["foundation-readonly-plan"],
      credentials: { mode: "runtime-selected", accountPolicyId: "managed-codex" },
    }, {
      virtualModelId: "managed-codex",
      accountId: "account-b",
      credentialId: "credential-b",
    }, undefined, committedRequest)).rejects.toThrow(/committed economic route/u);
    expect(createProviderAdapter).not.toHaveBeenCalled();
  });

  it("builds a direct managed runtime adapter from a tool-capable direct provider route", async () => {
    const createProviderAdapter = vi.fn(async (_options: DirectProviderAdapterOptions) => provider());
    const factory = createManagedDirectProviderAdapterFactory({
      builtinToolOptions: createSessionBuiltinToolOptions(),
      runtimeEnv: { OPENAI_API_KEY: "runtime-key" },
      createProviderAdapter,
    });

    const adapter = await factory({
      id: "openai-readonly",
      kind: "direct",
      provider: "openai",
      model: "gpt-5.4-mini",
      profiles: ["foundation-readonly-plan"],
    });

    expect(adapter).toBeInstanceOf(ManagedDirectProviderRuntimeAdapter);
    expect(adapter?.descriptor).toMatchObject({
      adapterDescriptorId: "adapter:openai:direct-provider",
      adapterKind: "direct",
      providerId: "openai",
      supportedProfiles: ["foundation-readonly-plan"],
      supportedExecutionModes: ["direct-provider"],
    });
    expect(createProviderAdapter).toHaveBeenCalledWith({
      provider: "openai",
      model: "gpt-5.4-mini",
      configEnv: undefined,
      runtimeEnv: { OPENAI_API_KEY: "runtime-key" },
      processEnv: undefined,
    });
  });

  it("admits only route-qualified MCP selectors and dispatches them through the owning client", async () => {
    const selector = "mcp:fixture:tool:echo";
    const executeCapability = vi.fn(async () => ({ echoed: true }));
    const disconnect = vi.fn(async () => undefined);
    const createMcpClient = vi.fn(() => ({
      serverName: "fixture",
      discoverProviderCapabilities: vi.fn(async () => [{
        name: selector,
        description: "echo",
        schema: { type: "object" },
        tags: ["mcp", "fixture"],
      }]),
      executeCapability,
      disconnect,
    }));
    const canonicalMcpServers: ResolvedMcpServer[] = [{
      id: "fixture", enabled: true, transport: "stdio", command: "node", args: ["fixture.mjs"],
      source: "project", provenance: {}, connection: { state: "not-tested" }, projection: { state: "not-synchronized" },
      admission: { state: "admitted" },
    }];
    const factory = createManagedDirectProviderAdapterFactory({
      canonicalMcpServers,
      createMcpClient,
      createProviderAdapter: vi.fn(async () => provider()),
    });

    const adapter = await factory({
      id: "openai-mcp", kind: "direct", provider: "openai", model: "gpt-5.4-mini",
      profiles: ["foundation-readonly-plan"], tools: { allowed: [selector] },
    });
    const internals = adapter as unknown as {
      readonly tools: readonly { readonly name: string }[];
      readonly builtinTools: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
    };
    expect(internals.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: selector })]));
    await expect(internals.builtinTools.get(selector)?.({ value: "hi" })).resolves.toEqual({ echoed: true });
    expect(executeCapability).toHaveBeenCalledWith(selector, { value: "hi" });
    expect(disconnect).toHaveBeenCalledTimes(2);

    const withoutSelector = await factory({
      id: "openai-no-mcp", kind: "direct", provider: "openai", model: "gpt-5.4-mini",
      profiles: ["foundation-readonly-plan"], tools: { allowed: ["read"] },
    });
    expect((withoutSelector as unknown as { tools: readonly { name: string }[] }).tools.some((tool) => tool.name.startsWith("mcp:"))).toBe(false);
    expect(createMcpClient).toHaveBeenCalledTimes(1);
  });

  it("marks direct managed runtime adapters write-capable only for explicit write routes", async () => {
    const createProviderAdapter = vi.fn(async (_options: DirectProviderAdapterOptions) => provider());
    const factory = createManagedDirectProviderAdapterFactory({
      builtinToolOptions: createSessionBuiltinToolOptions(),
      createProviderAdapter,
    });

    const adapter = await factory({
      id: "codex-oauth-approved-write",
      kind: "direct",
      provider: "codex-oauth",
      model: "gpt-5.5",
      profiles: ["foundation-apply-approved-writes"],
      tools: {
        allowed: ["read", "grep", "apply-patch"],
        writes: true,
      },
      writeAuthority: {
        workspace: {
          mode: "apply-approved",
          allowedPaths: ["packages/runtime"],
        },
        approval: {
          mode: "required-before-apply",
        },
      },
    });

    expect(adapter?.descriptor).toMatchObject({
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
  });

  it("hydrates direct-provider resource context from current builtin tool options", async () => {
    let builtinToolOptions = createSessionBuiltinToolOptions();
    const providerAdapter = provider();
    const createProviderAdapter = vi.fn(async (_options: DirectProviderAdapterOptions) => providerAdapter);
    const factory = createManagedDirectProviderAdapterFactory({
      builtinToolOptions: () => builtinToolOptions,
      createProviderAdapter,
    });

    const adapter = await factory({
      id: "openai-readonly",
      kind: "direct",
      provider: "openai",
      model: "gpt-5.4-mini",
      profiles: ["foundation-readonly-plan"],
    });

    const resourceProvider: ToolResourceProvider = {
      listResources: () => [],
      listTemplates: () => [],
      read: vi.fn(async (uri: string) => ({
        contents: [{
          uri,
          mimeType: "text/markdown",
          text: "# Late CLI Resource\n\nHydrated through current direct route options.",
        }],
      })),
    };
    builtinToolOptions = createSessionBuiltinToolOptions({
      ...builtinToolOptions,
      resourceProviders: [resourceProvider],
    });
    const service = new RuntimeManagedAgentInvocationService();

    const result = await service.invoke(defineManagedAgentInvocationRequest({
      invocationId: "cli-direct-resource-1",
      agentId: "openai-readonly:foundation-readonly-plan",
      parentSessionId: "cli-parent-session",
      parentTurnId: "cli-parent-session:turn:1",
      profile: "foundation-readonly-plan",
      requestedBy: "assistant",
      requestSource: "test",
      providerRoute: {
        providerId: "openai",
        surface: "direct-provider",
        model: "gpt-5.4-mini",
      },
      adapterKind: "direct",
      executionMode: "direct-provider",
      authority: {
        authorityProfileId: "authority:openai-readonly:foundation-readonly-plan",
        permissionProfile: "read-only",
        toolAuthority: {
          allowedToolNames: ["read"],
          writeAllowed: false,
          networkAllowed: false,
        },
        workingDirectory: {
          path: "C:/repo",
          mode: "read-only",
        },
        timeoutMs: 5000,
        credentialRoute: {
          mode: "credentialless",
        },
        memoryScope: {
          scope: { kind: "project", id: "repo" },
          access: "read-only",
        },
      },
      input: {
        summary: "Summarize current resource.",
        prompt: "Summarize the supplied resource.",
        resourceUris: ["kiln://test/current-direct-resource"],
        context: {
          mode: "resources",
        },
      },
    }), adapter!, {
      routeId: "openai-readonly",
      routeSource: "explicit-managed-route",
    });

    expect(result.status).toBe("completed");
    expect(resourceProvider.read).toHaveBeenCalledWith("kiln://test/current-direct-resource", {});
    const firstProviderCall = (providerAdapter.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system: string;
    };
    expect(firstProviderCall.system).toContain("kiln://test/current-direct-resource");
    expect(firstProviderCall.system).toContain("Hydrated through current direct route options.");
  });

  it("returns undefined for harness routes so harness projection remains owned by the route resolver", async () => {
    const createProviderAdapter = vi.fn(async (_options: DirectProviderAdapterOptions) => provider());
    const factory = createManagedDirectProviderAdapterFactory({ createProviderAdapter });

    await expect(factory({
      id: "codex-readonly",
      kind: "harness",
      provider: "codex",
      model: "gpt-5.3-codex-spark",
      profiles: ["foundation-readonly-plan"],
    })).resolves.toBeUndefined();
    expect(createProviderAdapter).not.toHaveBeenCalled();
  });

  it("rejects non-direct providers instead of silently routing them through the direct adapter", async () => {
    const factory = createManagedDirectProviderAdapterFactory({
      createProviderAdapter: vi.fn(async (_options: DirectProviderAdapterOptions) => provider()),
    });

    await expect(factory({
      id: "codex-direct",
      kind: "direct",
      provider: "codex",
      model: "gpt-5.3-codex-spark",
      profiles: ["foundation-readonly-plan"],
    })).rejects.toThrow("Provider 'codex' is not a direct provider.");
  });

  it("rejects direct models that cannot execute Kiln runtime tools", async () => {
    const createProviderAdapter = vi.fn(async (_options: DirectProviderAdapterOptions) => provider());
    const factory = createManagedDirectProviderAdapterFactory({ createProviderAdapter });

    await expect(factory({
      id: "ollama-readonly",
      kind: "direct",
      provider: "ollama",
      model: "ollama-local",
      profiles: ["foundation-readonly-plan"],
    })).rejects.toThrow("requires a tool-call-capable model");
    expect(createProviderAdapter).not.toHaveBeenCalled();
  });

  it("requires an explicit model for direct managed routes", async () => {
    const createProviderAdapter = vi.fn(async (_options: DirectProviderAdapterOptions) => provider());
    const factory = createManagedDirectProviderAdapterFactory({ createProviderAdapter });

    await expect(factory({
      id: "openai-readonly",
      kind: "direct",
      provider: "openai",
      profiles: ["foundation-readonly-plan"],
    })).rejects.toThrow("Direct managed invocation route 'openai-readonly' requires a model.");
    expect(createProviderAdapter).not.toHaveBeenCalled();
  });
});
