import { describe, expect, it, vi } from "vitest";
import type { AgentResponse, ProviderAdapter } from "@kilnai/core";
import { createSessionBuiltinToolOptions, textParts } from "@kilnai/core";
import { ManagedDirectProviderRuntimeAdapter } from "@kilnai/runtime";
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
