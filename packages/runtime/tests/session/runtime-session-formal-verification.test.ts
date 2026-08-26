import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter, ToolDefinition } from "@kilnai/core/agents";
import { formalVerificationToolMetadata } from "@kilnai/core/tools";
import { EventBus } from "@kilnai/core/events";
import { textParts } from "@kilnai/core/engine";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { RuntimeSessionToolExecutor } from "../../src/session/runtime-session-orchestrator-tool-executor.js";
import { createFixtureClaimConfig, createFixtureToolPermission } from "./runtime-claim-fixture.js";

const executionScope = {
  kind: "work_item",
  goalRunId: "goal-1",
  workItemId: "work-1",
  attemptId: "attempt-1",
} as const;

function formalMetadata(version = "4.11.0") {
  return formalVerificationToolMetadata({
    verifier: { name: "dafny", version },
    artifact: { contentDigest: `sha256:${"a".repeat(64)}` },
    subjects: [{ path: "src/Test.dfy", contentDigest: `sha256:${"e".repeat(64)}` }],
    checks: [{ symbol: "Invariant", check: "correctness", outcome: "proved", durationMs: 0, resourceCount: 0 }],
  });
}

function session(): RuntimeSession {
  return new RuntimeSession({
    appName: "kiln",
    tenantId: "test-tenant",
    userId: "operator",
    systemPrompt: "test",
  });
}

function tool(name: string): ToolDefinition {
  return { name, description: name, inputSchema: { type: "object" }, tags: new Set() };
}

function providerForRounds(): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn()
      .mockResolvedValueOnce({
        parts: textParts("verify"),
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [{ id: "formal-1", name: "formal_verify", input: {} }],
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        parts: textParts("finish"),
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [{ id: "finish-1", name: "work_item.execution.finish", input: {} }],
        stopReason: "tool_use",
      })
      .mockResolvedValueOnce({
        parts: textParts("done"),
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
      }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

describe("runtime formal-verification transport", () => {
  it("exposes a same-batch formal observation to the following builtin", async () => {
    const finish = vi.fn().mockImplementation(async (_input, context) => ({
      output: JSON.stringify({ observationCount: context?.formalVerificationObservations?.length ?? 0 }),
      isError: false,
    }));
    const executor = new RuntimeSessionToolExecutor(
      { provider: { name: "mock" } as ProviderAdapter },
      new EventBus(100),
      async () => ({ approved: true }),
      vi.fn(),
      new Map([
        ["formal_verify", vi.fn().mockResolvedValue({ output: "verified", isError: false, metadata: formalMetadata() })],
        ["work_item.execution.finish", finish],
      ]),
    );
    const currentSession = session();
    const perCallConfig = {
      ...createFixtureClaimConfig({
        session: currentSession,
        provider: { name: "mock" } as ProviderAdapter,
        turnId: "turn-1",
        includeToolClaims: true,
        toolPermissions: [
          createFixtureToolPermission("formal_verify"),
          createFixtureToolPermission("work_item.execution.finish"),
        ],
      }),
      executionScope,
    };

    await executor.executeToolCalls(
      currentSession,
      [
        { id: "formal-1", name: "formal_verify", input: {} },
        { id: "finish-1", name: "work_item.execution.finish", input: {} },
      ],
      "turn-1:response:1",
      perCallConfig,
    );

    expect(finish).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        formalVerificationObservations: [expect.objectContaining({
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "formal-1",
          executionScope,
        })],
      }),
    );
  });

  it("does not let mutation of a returned summary alter private observations", async () => {
    let observedVersion: string | undefined;
    const finish = vi.fn().mockImplementation(async (_input, context) => {
      observedVersion = context?.formalVerificationObservations?.[0]?.metadata.verifier.version;
      return { output: "finished", isError: false };
    });
    const executor = new RuntimeSessionToolExecutor(
      { provider: { name: "mock" } as ProviderAdapter },
      new EventBus(100),
      async () => ({ approved: true }),
      vi.fn(),
      new Map([
        ["formal_verify", vi.fn().mockResolvedValue({ output: "verified", isError: false, metadata: formalMetadata() })],
        ["work_item.execution.finish", finish],
      ]),
    );
    const currentSession = session();
    const perCallConfig = {
      ...createFixtureClaimConfig({
        session: currentSession,
        provider: { name: "mock" } as ProviderAdapter,
        turnId: "turn-1",
        includeToolClaims: true,
        toolPermissions: [
          createFixtureToolPermission("formal_verify"),
          createFixtureToolPermission("work_item.execution.finish"),
        ],
      }),
      executionScope,
    };

    const firstRound = await executor.executeToolCalls(
      currentSession,
      [{ id: "formal-1", name: "formal_verify", input: {} }],
      "turn-1:response:1",
      perCallConfig,
    );
    const returnedSummary = firstRound.toolExecutions[0];
    if (!returnedSummary) throw new Error("expected a returned formal summary");
    Object.assign(returnedSummary, { metadata: formalMetadata("forged") });

    await executor.executeToolCalls(
      currentSession,
      [{ id: "finish-1", name: "work_item.execution.finish", input: {} }],
      "turn-1:response:2",
      {
        ...createFixtureClaimConfig({
          session: currentSession,
          provider: { name: "mock" } as ProviderAdapter,
          turnId: "turn-1",
          includeToolClaims: true,
          toolPermissions: [
            createFixtureToolPermission("formal_verify"),
            createFixtureToolPermission("work_item.execution.finish"),
          ],
        }),
        executionScope,
      },
    );

    expect(observedVersion).toBe("4.11.0");
  });

  it("fails closed when a directly reused executor starts a new turn without scope", async () => {
    let observedCount = -1;
    const finish = vi.fn().mockImplementation(async (_input, context) => {
      observedCount = context?.formalVerificationObservations?.length ?? 0;
      return { output: "finished", isError: false };
    });
    const executor = new RuntimeSessionToolExecutor(
      { provider: { name: "mock" } as ProviderAdapter },
      new EventBus(100),
      async () => ({ approved: true }),
      vi.fn(),
      new Map([
        ["formal_verify", vi.fn().mockResolvedValue({ output: "verified", isError: false, metadata: formalMetadata() })],
        ["work_item.execution.finish", finish],
      ]),
    );
    const currentSession = session();

    await executor.executeToolCalls(
      currentSession,
      [{ id: "formal-1", name: "formal_verify", input: {} }],
      "turn-1:response:1",
      {
        ...createFixtureClaimConfig({
          session: currentSession,
          provider: { name: "mock" } as ProviderAdapter,
          turnId: "turn-1",
          includeToolClaims: true,
          toolPermissions: [createFixtureToolPermission("formal_verify")],
        }),
        executionScope,
      },
    );
    await executor.executeToolCalls(
      currentSession,
      [{ id: "finish-1", name: "work_item.execution.finish", input: {} }],
      "turn-2:response:1",
      {
        ...createFixtureClaimConfig({
          session: currentSession,
          provider: { name: "mock" } as ProviderAdapter,
          turnId: "turn-2",
          includeToolClaims: true,
          toolPermissions: [createFixtureToolPermission("work_item.execution.finish")],
        }),
      },
    );

    expect(observedCount).toBe(0);
  });

  it("retains prior-round observations inside the Runtime executor for the next builtin", async () => {
    const finish = vi.fn().mockResolvedValue({ output: "finished", isError: false });
    const builtinTools = new Map([
      ["formal_verify", vi.fn().mockResolvedValue({ output: "verified", isError: false, metadata: formalMetadata() })],
      ["work_item.execution.finish", finish],
    ]);
    const orchestrator = new RuntimeSessionOrchestrator({
      provider: providerForRounds(),
      model: "unknown",
      tools: [tool("formal_verify"), tool("work_item.execution.finish")],
      builtinTools,
    });
    const currentSession = session();

    await orchestrator.processMessage(
      currentSession,
      textParts("verify and finish"),
      undefined,
      builtinTools,
      {
        ...createFixtureClaimConfig({
          session: currentSession,
          provider: providerForRounds(),
          turnId: "turn-1",
          includeToolClaims: true,
          toolPermissions: [
            createFixtureToolPermission("formal_verify"),
            createFixtureToolPermission("work_item.execution.finish"),
          ],
        }),
        executionScope,
      },
    );

    expect(finish).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        formalVerificationObservations: [expect.objectContaining({
          toolCallScopeId: expect.stringContaining(":response:1"),
          toolCallId: "formal-1",
          executionScope,
        })],
      }),
    );
  });
});
