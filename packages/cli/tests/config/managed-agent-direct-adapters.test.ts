import { describe, expect, it, vi } from "vitest";
import {
  type AgentResponse,
  createExecutionAccountPolicyId,
  defineManagedAgentInvocationRequest,
  type ProviderAdapter,
} from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import type { ResolvedMcpServer } from "@kilnai/core/mcp";
import { createSessionBuiltinToolOptions, type ToolResourceProvider } from "@kilnai/core/tools";
import {
  ManagedDirectProviderRuntimeAdapter,
  RuntimeManagedAgentInvocationService,
  type ManagedCommittedInvocationRequest,
  type ManagedInvocationRouteProfile,
} from "@kilnai/runtime";
import { createManagedDirectProviderAdapterFactory } from "../../src/config/managed-agent-direct-adapters.js";
import type {
  DirectProviderAdapterOptions,
  DirectProviderCredentialBinding,
} from "../../src/wrapper/direct-provider-adapter-factory.js";

function committedRequestFor(
  routeId: string,
  providerId: string,
  modelId: string,
): ManagedCommittedInvocationRequest {
  return {
    commitment: {
      reservation: {
        selectedIdentity: {
          route: { routeId, providerId, modelId, accountPolicyId: null },
          account: { kind: "accountless" },
        },
      },
    },
    dispatchFenceId: "dispatch-fence-test",
    abortSignal: new AbortController().signal,
  } as ManagedCommittedInvocationRequest;
}

function economicDispatchFor(routeId: string, providerId: string, modelId: string) {
  const selectedIdentity = {
    route: { routeId, providerId, modelId, accountPolicyId: null },
    account: { kind: "accountless" as const },
  } as never;
  return {
    commitment: {
      commitmentId: "commitment-cli-direct-test",
      reservation: {
        reservationId: "reservation-cli-direct-test",
        jobId: "job-cli-direct-test",
        economicAttemptId: "economic-attempt-cli-direct-test",
        policy: {} as never,
        selectedIdentity,
        priceIdentity: null,
        envelope: { kind: "bounded", digest: `sha256:${"a".repeat(64)}`, limits: [] },
        amounts: [],
        authorityRevision: `sha256:${"b".repeat(64)}`,
      },
      rejected: [],
      notSelected: [],
    } as never,
    dispatchFenceId: "dispatch-fence-cli-direct-test",
    recordExecutionSettlementPending: () => undefined,
    createExecutionSettlement: () => ({} as never),
    registerEconomicSettlement: () => undefined,
  };
}

function credentialBindingFor(routeId: string, accountId = "account-b"): DirectProviderCredentialBinding {
  return {
    routeId,
    accountId,
    credentialId: `credential-${accountId}`,
    credentialRevision: "revision-1",
  };
}

const READONLY_PROFILE: ManagedInvocationRouteProfile = {
  authorityProfileId: "readonly-plan",
  admissionProfile: "foundation-readonly-plan",
  permissionProfile: "read-only",
  allowedToolNames: ["read", "grep"],
  workingDirectory: { path: "C:/repo", mode: "read-only" },
  timeoutMs: 60_000,
  credentialRoute: { mode: "account-leased", routeId: "readonly-plan", accountPolicyId: createExecutionAccountPolicyId("policy:readonly-plan") },
  memoryScope: { scope: { kind: "project", id: "test" }, access: "read-only" },
};

function profileWith(input: Partial<ManagedInvocationRouteProfile>): ManagedInvocationRouteProfile {
  return { ...READONLY_PROFILE, ...input };
}

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
  it("fails closed when a direct route has no committed credential binding", async () => {
    const createProviderAdapter = vi.fn(async () => provider());
    const factory = createManagedDirectProviderAdapterFactory({ createProviderAdapter });

    await expect(factory({
      id: "openai-managed",
      kind: "direct",
      authorityProfiles: [],
    }, undefined, undefined, committedRequestFor("openai-managed", "openai", "gpt-5.4-mini"), READONLY_PROFILE))
      .rejects.toThrow("has no committed credential binding");

    expect(createProviderAdapter).not.toHaveBeenCalled();
  });

  it("constructs a runtime-selected adapter only for the exact committed account binding", async () => {
    const createProviderAdapter = vi.fn(async () => provider());
    const factory = createManagedDirectProviderAdapterFactory({ createProviderAdapter });
    const credentialBinding = credentialBindingFor("codex-managed");

    await expect(factory({
      id: "codex-managed",
      kind: "direct",
      authorityProfiles: [],
    }, credentialBinding, undefined, committedRequestFor("codex-managed", "codex-oauth", "gpt-5.4"), READONLY_PROFILE))
      .resolves.toBeInstanceOf(ManagedDirectProviderRuntimeAdapter);
    expect(createProviderAdapter).toHaveBeenCalledWith(expect.objectContaining({
      provider: "codex-oauth",
      model: "gpt-5.4",
      credentialBinding,
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
              routeId: "different-route",
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
      authorityProfiles: [],
    }, credentialBindingFor("codex-managed"), undefined, committedRequest, READONLY_PROFILE)).rejects.toThrow(/committed economic route/u);
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
      authorityProfiles: [],
    }, credentialBindingFor("openai-readonly"), undefined, committedRequestFor("openai-readonly", "openai", "gpt-5.4-mini"), READONLY_PROFILE);

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
      credentialBinding: credentialBindingFor("openai-readonly"),
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
      id: "openai-mcp", kind: "direct",
      authorityProfiles: [],
    }, credentialBindingFor("openai-mcp"), undefined, committedRequestFor("openai-mcp", "openai", "gpt-5.4-mini"), profileWith({ allowedToolNames: [selector] }));
    const internals = adapter as unknown as {
      readonly tools: readonly { readonly name: string }[];
      readonly builtinTools: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
    };
    expect(internals.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: selector })]));
    await expect(internals.builtinTools.get(selector)?.({ value: "hi" })).resolves.toEqual({ echoed: true });
    expect(executeCapability).toHaveBeenCalledWith(selector, { value: "hi" });
    expect(disconnect).toHaveBeenCalledTimes(2);

    const withoutSelector = await factory({
      id: "openai-no-mcp", kind: "direct",
      authorityProfiles: [],
    }, credentialBindingFor("openai-no-mcp"), undefined, committedRequestFor("openai-no-mcp", "openai", "gpt-5.4-mini"), READONLY_PROFILE);
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
      authorityProfiles: [],
    }, credentialBindingFor("codex-oauth-approved-write"), undefined, committedRequestFor("codex-oauth-approved-write", "codex-oauth", "gpt-5.5"), profileWith({
      authorityProfileId: "approved-write",
      admissionProfile: "foundation-apply-approved-writes",
      permissionProfile: "apply-approved-writes",
      allowedToolNames: ["read", "grep", "apply-patch"],
      writeAllowed: true,
    }));

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
      authorityProfiles: [],
    }, credentialBindingFor("openai-readonly"), undefined, committedRequestFor("openai-readonly", "openai", "gpt-5.4-mini"), READONLY_PROFILE);

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
    }, {
      economicDispatch: economicDispatchFor("openai-readonly", "openai", "gpt-5.4-mini"),
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
      authorityProfiles: [],
    }, undefined, undefined, committedRequestFor("codex-readonly", "codex", "gpt-5.3-codex-spark"), READONLY_PROFILE))
      .resolves.toBeUndefined();
    expect(createProviderAdapter).not.toHaveBeenCalled();
  });

  it("rejects non-direct providers instead of silently routing them through the direct adapter", async () => {
    const factory = createManagedDirectProviderAdapterFactory({
      createProviderAdapter: vi.fn(async (_options: DirectProviderAdapterOptions) => provider()),
    });

    await expect(factory({
      id: "codex-direct",
      kind: "direct",
      authorityProfiles: [],
    }, credentialBindingFor("codex-direct"), undefined, committedRequestFor("codex-direct", "codex", "gpt-5.3-codex-spark"), READONLY_PROFILE))
      .rejects.toThrow("Provider 'codex' is not a direct provider.");
  });

  it("rejects direct models that cannot execute Kiln runtime tools", async () => {
    const createProviderAdapter = vi.fn(async (_options: DirectProviderAdapterOptions) => provider());
    const factory = createManagedDirectProviderAdapterFactory({ createProviderAdapter });

    await expect(factory({
      id: "ollama-readonly",
      kind: "direct",
      authorityProfiles: [],
    }, credentialBindingFor("ollama-readonly"), undefined, committedRequestFor("ollama-readonly", "ollama", "ollama-local"), READONLY_PROFILE))
      .rejects.toThrow("requires a tool-call-capable model");
    expect(createProviderAdapter).not.toHaveBeenCalled();
  });

  it("requires a committed credential binding for direct managed routes", async () => {
    const createProviderAdapter = vi.fn(async (_options: DirectProviderAdapterOptions) => provider());
    const factory = createManagedDirectProviderAdapterFactory({ createProviderAdapter });

    await expect(factory({
      id: "openai-readonly",
      kind: "direct",
      authorityProfiles: [],
    }, undefined, undefined, committedRequestFor("openai-readonly", "openai", "gpt-5.4-mini"), READONLY_PROFILE))
      .rejects.toThrow("has no committed credential binding");
    expect(createProviderAdapter).not.toHaveBeenCalled();
  });
});
