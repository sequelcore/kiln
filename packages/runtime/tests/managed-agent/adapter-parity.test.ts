import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { ManagedDirectProviderRuntimeAdapter } from "../../src/agents/managed-invocation/direct-runtime-adapter.js";
import { ManagedCliHarnessAdapter } from "../../src/agents/managed-invocation/cli-harness-adapter.js";
import type { CliSessionFactory } from "../../src/execution/cli-session-contract.js";
import { createFixtureModelRoundStore, createFixtureToolActionStore } from "../session/runtime-claim-fixture.js";

const WRITE_AUTHORITY = {
  proposalSupported: true,
  approvedApplySupported: true,
  memoryProposalSupported: true,
  rollbackEvidence: true,
  cleanupEvidence: true,
  scopeReduction: true,
} as const;

describe("managed agent adapter parity", () => {
  it("keeps direct-provider and CLI-harness routes on the same authority and evidence contract", () => {
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
      writeAuthority: WRITE_AUTHORITY,
      runtimeToolActionClaims: createFixtureToolActionStore(),
      readAuthorityAdmission: () => undefined,
      runtimeModelRoundActionClaims: createFixtureModelRoundStore(),
    });
    const harness = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: cliFactory,
      writeAuthority: WRITE_AUTHORITY,
    });

    expect(direct.descriptor).toMatchObject({
      adapterKind: "direct",
      supportedExecutionModes: ["direct-provider"],
      lifecycle: harness.descriptor.lifecycle,
      cancellation: harness.descriptor.cancellation,
      timeout: harness.descriptor.timeout,
      transcript: harness.descriptor.transcript,
      resultHandoff: harness.descriptor.resultHandoff,
      credentialRoute: harness.descriptor.credentialRoute,
      memoryContext: harness.descriptor.memoryContext,
      unsupportedFieldPolicy: "reject",
      cleanup: harness.descriptor.cleanup,
      writeAuthority: harness.descriptor.writeAuthority,
    });
    expect(harness.descriptor).toMatchObject({
      adapterKind: "harness",
      supportedExecutionModes: ["cli-harness"],
      usage: {
        tokenClasses: ["input", "output", "cache_read"],
        semanticSourceGranularity: "unknown",
        evidenceBasis: "adapter",
      },
      unsupportedFieldPolicy: "reject",
    });
    expect(direct.descriptor.usage).toMatchObject({
      tokenClasses: ["input", "output", "cache_read", "cache_write"],
      semanticSourceGranularity: "estimated",
      evidenceBasis: "runtime",
    });
    expect(direct.descriptor.supportedAccess).toEqual(harness.descriptor.supportedAccess);
  });
});
