import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { ManagedCliHarnessAdapter } from "../../src/agents/managed-invocation/cli-harness-adapter.js";
import { ManagedDirectProviderRuntimeAdapter } from "../../src/agents/managed-invocation/direct-runtime-adapter.js";
import { ManagedRemoteHarnessAdapter } from "../../src/agents/managed-invocation/remote-harness-adapter.js";
import type { CliSessionFactory } from "../../src/execution/cli-session-contract.js";

describe("managed agent lifecycle attribution route parity", () => {
  it("normalizes direct, CLI harness, and remote harness usage evidence with explicit source-granularity gaps", () => {
    const provider: ProviderAdapter = {
      name: "openai",
      createMessage: vi.fn(async () => ({
        parts: textParts("done"),
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
      })),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const cliFactory: CliSessionFactory = vi.fn();

    const direct = new ManagedDirectProviderRuntimeAdapter({
      providerId: "openai",
      model: "gpt-test",
      provider,
      tools: [],
      builtinTools: new Map(),
    });
    const cliHarness = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: cliFactory,
    });
    const remoteHarness = new ManagedRemoteHarnessAdapter({
      providerId: "codex-cloud",
      model: "gpt-5.5",
      invokeUrl: "https://managed.example.com/invoke",
      cancelUrl: "https://managed.example.com/cancel",
    });

    expect(normalizedUsageEvidence(direct.descriptor)).toEqual({
      adapterKind: "direct",
      executionModes: ["direct-provider"],
      tokenClasses: ["input", "output", "cache_read", "cache_write"],
      semanticSourceGranularity: "estimated",
      evidenceBasis: "runtime",
      supportsExplicitUnknowns: true,
    });
    expect(normalizedUsageEvidence(cliHarness.descriptor)).toEqual({
      adapterKind: "harness",
      executionModes: ["cli-harness"],
      tokenClasses: ["input", "output", "cache_read"],
      semanticSourceGranularity: "unknown",
      evidenceBasis: "adapter",
      supportsExplicitUnknowns: true,
    });
    expect(normalizedUsageEvidence(remoteHarness.descriptor)).toEqual({
      adapterKind: "harness",
      executionModes: ["remote-harness"],
      tokenClasses: ["input", "output"],
      semanticSourceGranularity: "unknown",
      evidenceBasis: "adapter",
      supportsExplicitUnknowns: true,
    });
  });
});

function normalizedUsageEvidence(descriptor: {
  readonly adapterKind: "direct" | "harness";
  readonly supportedExecutionModes: readonly string[];
  readonly usage: {
    readonly tokenClasses: readonly string[];
    readonly semanticSourceGranularity: string;
    readonly evidenceBasis: string;
    readonly supportsExplicitUnknowns: boolean;
  };
}) {
  return {
    adapterKind: descriptor.adapterKind,
    executionModes: descriptor.supportedExecutionModes,
    tokenClasses: descriptor.usage.tokenClasses,
    semanticSourceGranularity: descriptor.usage.semanticSourceGranularity,
    evidenceBasis: descriptor.usage.evidenceBasis,
    supportsExplicitUnknowns: descriptor.usage.supportsExplicitUnknowns,
  };
}
